import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "fs/promises";
import { basename, dirname, join } from "path";
import type {
  DesktopBackgroundTask,
  DesktopReusableTask,
  DesktopReusableTaskAdjustments,
  DesktopReusableTaskAdjustmentScope,
  DesktopReusableTaskInput,
  DesktopReusableTaskResolvedInput,
  DesktopReusableTaskRunPrepareRequest,
  DesktopReusableTaskRunRecipe,
  DesktopReusableTaskSaveRequest,
} from "../shared/desktopApi";
import { requireAuthContext } from "./auth";
import { listBackgroundTasks } from "./backgroundTasks";
import { DRSAI_HOME } from "./paths";

const REUSABLE_TASKS_FILE = join(DRSAI_HOME, "desktop", "reusable-tasks.json");
const MAX_TASKS_PER_USER = 100;
const MAX_NAME_CHARS = 120;
const MAX_RULES = 12;

interface ReusableTaskStore {
  users: Record<string, DesktopReusableTask[]>;
}

export async function listReusableTasks(): Promise<DesktopReusableTask[]> {
  const { userId } = await requireAuthContext();
  const store = await readStore();
  return (store.users[userId] ?? []).map(withAdjustmentDefaults).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveReusableTask(rawRequest: unknown): Promise<DesktopReusableTask> {
  const request = validateSaveRequest(rawRequest);
  const { userId } = await requireAuthContext();
  const source = (await listBackgroundTasks({ limit: 1000 })).find((task) => task.id === request.sourceTaskId);
  if (!source) throw new Error("The successful source task was not found.");
  if (source.status !== "completed" || !source.deliverySummary?.artifacts.length) {
    throw new Error("Only a completed task with a saved result can be made reusable.");
  }
  const inputs = await inferInputs(source);
  const fixedRules = inferFixedRules(source);
  const now = new Date().toISOString();
  const store = await readStore();
  const existingRaw = (store.users[userId] ?? []).find((item) => item.name.toLocaleLowerCase() === request.name.toLocaleLowerCase());
  const existing = existingRaw ? withAdjustmentDefaults(existingRaw) : undefined;
  const reusable: DesktopReusableTask = {
    id: existing?.id ?? `reusable-task-${randomUUID()}`,
    name: request.name,
    sourceTaskId: source.id,
    sourceTaskTitle: source.title,
    ...(source.workspacePath ? { sourceWorkspacePath: source.workspacePath } : {}),
    taskTemplate: source.title,
    inputs,
    fixedRules,
    savedAdjustments: existing?.savedAdjustments ?? { checkItems: [] },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    runCount: existing?.runCount ?? 0,
    ...(existing?.lastRunAt ? { lastRunAt: existing.lastRunAt } : {}),
    ...(existing?.lastInputFingerprint ? { lastInputFingerprint: existing.lastInputFingerprint } : {}),
  };
  store.users[userId] = [reusable, ...(store.users[userId] ?? []).filter((item) => item.id !== reusable.id)]
    .slice(0, MAX_TASKS_PER_USER);
  await writeStore(store);
  return reusable;
}

export async function prepareReusableTaskRun(rawRequest: unknown): Promise<DesktopReusableTaskRunRecipe> {
  const request = validateRunRequest(rawRequest);
  const { userId } = await requireAuthContext();
  const store = await readStore();
  const reusableRaw = (store.users[userId] ?? []).find((item) => item.id === request.reusableTaskId);
  if (!reusableRaw) throw new Error("Reusable task was not found for the signed-in user.");
  const reusable = withAdjustmentDefaults(reusableRaw);
  const resolvedInputs: DesktopReusableTaskResolvedInput[] = [];
  for (const input of reusable.inputs) {
    const path = sanitizePath(request.inputs[input.id], `${input.label} is required.`);
    const info = await stat(path).catch(() => null);
    if (!info || (input.kind === "file" ? !info.isFile() : !info.isDirectory())) {
      throw new Error(`${input.label} does not point to an available ${input.kind}.`);
    }
    const bytes = info.isFile() ? info.size : 0;
    const sha256 = info.isFile()
      ? createHash("sha256").update(await readFile(path)).digest("hex")
      : createHash("sha256").update(path.toLocaleLowerCase()).digest("hex");
    resolvedInputs.push({ id: input.id, label: input.label, path, sha256, bytes });
  }
  const fingerprint = createHash("sha256")
    .update(resolvedInputs.map((input) => `${input.id}:${input.sha256}`).join("\n"))
    .digest("hex");
  if (reusable.lastInputFingerprint && reusable.lastInputFingerprint === fingerprint) {
    throw new Error("Choose new input material instead of reusing the previous run's input.");
  }
  const adjustments = normalizeAdjustments(request.adjustments);
  const now = new Date().toISOString();
  const resolvedTask = resolveTaskText(reusable, resolvedInputs, adjustments, request.adjustmentScope);
  const recipe: DesktopReusableTaskRunRecipe = {
    id: `reusable-run-${randomUUID()}`,
    reusableTaskId: reusable.id,
    reusableTaskName: reusable.name,
    workspacePath: request.workspacePath,
    resolvedTask,
    inputs: resolvedInputs,
    fixedRules: [...reusable.fixedRules],
    adjustments,
    adjustmentScope: request.adjustmentScope,
    cachePolicy: "force_fresh_input_read",
    createdAt: now,
  };
  const next: DesktopReusableTask = {
    ...reusable,
    updatedAt: now,
    runCount: reusable.runCount + 1,
    lastRunAt: now,
    lastInputFingerprint: fingerprint,
    ...(request.adjustmentScope === "update_template" ? { savedAdjustments: adjustments } : {}),
  };
  store.users[userId] = [next, ...(store.users[userId] ?? []).filter((item) => item.id !== reusable.id)];
  await writeStore(store);
  return recipe;
}

async function inferInputs(task: DesktopBackgroundTask): Promise<DesktopReusableTaskInput[]> {
  const outputPaths = new Set(task.deliverySummary?.artifacts.map((artifact) => artifact.path.toLocaleLowerCase()) ?? []);
  const candidates = new Set<string>();
  for (const artifact of task.deliverySummary?.artifacts ?? []) {
    if (artifact.chartQuality?.sourcePath) candidates.add(artifact.chartQuality.sourcePath);
    for (const conclusion of artifact.keyConclusions ?? []) candidates.add(conclusion.sourcePath);
    for (const issue of artifact.consistencyCheck?.items ?? []) candidates.add(issue.sourcePath);
  }
  const available: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || outputPaths.has(candidate.toLocaleLowerCase())) continue;
    const info = await stat(candidate).catch(() => null);
    if (info?.isFile() || info?.isDirectory()) available.push(candidate);
  }
  if (!available.length && task.workspacePath) {
    const entries = await readdir(task.workspacePath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      const path = join(task.workspacePath, entry.name);
      if (!outputPaths.has(path.toLocaleLowerCase())) available.push(path);
    }
  }
  const selected = available.slice(0, 8);
  if (!selected.length) {
    return [{ id: "primary_input", label: "Primary input", kind: "file", required: true, originalValue: "" }];
  }
  return selected.map((path, index) => ({
    id: index === 0 ? "primary_input" : `input_${index + 1}`,
    label: index === 0 ? "Primary input" : `Input ${index + 1}`,
    kind: "file",
    required: true,
    originalValue: path,
  }));
}

function inferFixedRules(task: DesktopBackgroundTask): string[] {
  const rules = [
    ...(task.planSteps ?? []).map((step) => `${step.phase}: ${step.title}`),
    task.verification,
    "Use the replacement input material and regenerate the result from its current contents.",
    "Do not reuse output text, extracted values, or cached conclusions from an earlier run.",
  ].map((rule) => rule.trim()).filter(Boolean);
  return [...new Set(rules)].slice(0, MAX_RULES);
}

function resolveTaskText(
  task: DesktopReusableTask,
  inputs: DesktopReusableTaskResolvedInput[],
  adjustments: DesktopReusableTaskAdjustments,
  adjustmentScope: DesktopReusableTaskAdjustmentScope,
): string {
  let taskText = task.taskTemplate;
  for (const input of task.inputs) {
    const replacement = inputs.find((item) => item.id === input.id)?.path ?? "";
    if (input.originalValue) {
      taskText = taskText.split(input.originalValue).join(replacement);
      taskText = taskText.split(basename(input.originalValue)).join(basename(replacement));
    }
  }
  return [
    `Run reusable task: ${task.name}`,
    `Workflow: ${taskText}`,
    "Replacement inputs (read these files now):",
    ...inputs.map((input) => `- ${input.label}: ${input.path} (sha256 ${input.sha256})`),
    "Fixed rules:",
    ...task.fixedRules.map((rule) => `- ${rule}`),
    "Run adjustments:",
    `- Scope: ${adjustmentScope === "this_run" ? "this run only; do not change the saved template" : "update the saved template and apply from this run onward"}`,
    ...(adjustments.outputLanguage ? [`- Output language: ${adjustments.outputLanguage === "zh" ? "Chinese" : "English"}`] : []),
    ...(adjustments.deadline ? [`- Deadline: ${adjustments.deadline}`] : []),
    ...adjustments.checkItems.map((item) => `- Check item: ${item}`),
    "Freshness requirement: ignore all earlier outputs and caches; derive every claim from the replacement inputs above.",
  ].join("\n");
}

async function readStore(): Promise<ReusableTaskStore> {
  try {
    const parsed = JSON.parse(await readFile(REUSABLE_TASKS_FILE, "utf8")) as Partial<ReusableTaskStore>;
    return parsed.users && typeof parsed.users === "object" ? { users: parsed.users } : { users: {} };
  } catch {
    return { users: {} };
  }
}

async function writeStore(store: ReusableTaskStore): Promise<void> {
  await mkdir(dirname(REUSABLE_TASKS_FILE), { recursive: true });
  const temporaryPath = `${REUSABLE_TASKS_FILE}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temporaryPath, REUSABLE_TASKS_FILE);
}

function validateSaveRequest(rawRequest: unknown): DesktopReusableTaskSaveRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Reusable task save request must be an object.");
  const request = rawRequest as Partial<DesktopReusableTaskSaveRequest>;
  if (typeof request.sourceTaskId !== "string" || !request.sourceTaskId.trim()) throw new Error("Source task id is required.");
  if (typeof request.name !== "string" || !request.name.trim() || request.name.length > MAX_NAME_CHARS || /[\r\n]/.test(request.name)) throw new Error("Reusable task name is invalid.");
  return { sourceTaskId: request.sourceTaskId.trim(), name: request.name.trim() };
}

function validateRunRequest(rawRequest: unknown): DesktopReusableTaskRunPrepareRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Reusable task run request must be an object.");
  const request = rawRequest as Partial<DesktopReusableTaskRunPrepareRequest>;
  if (typeof request.reusableTaskId !== "string" || !/^reusable-task-[a-zA-Z0-9-]{36}$/.test(request.reusableTaskId)) throw new Error("Reusable task id is invalid.");
  if (!request.inputs || typeof request.inputs !== "object" || Array.isArray(request.inputs)) throw new Error("Reusable task inputs are required.");
  if (request.adjustmentScope !== "this_run" && request.adjustmentScope !== "update_template") throw new Error("Reusable task adjustment scope is invalid.");
  return {
    reusableTaskId: request.reusableTaskId,
    workspacePath: sanitizePath(request.workspacePath, "Workspace path is required."),
    inputs: request.inputs,
    adjustments: normalizeAdjustments(request.adjustments),
    adjustmentScope: request.adjustmentScope,
  };
}

function normalizeAdjustments(value: unknown): DesktopReusableTaskAdjustments {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Reusable task adjustments are required.");
  const candidate = value as Partial<DesktopReusableTaskAdjustments>;
  if (candidate.outputLanguage !== undefined && candidate.outputLanguage !== "zh" && candidate.outputLanguage !== "en") {
    throw new Error("Reusable task output language is invalid.");
  }
  const deadline = typeof candidate.deadline === "string" ? candidate.deadline.trim() : "";
  if (deadline.length > 160 || /[\r\n]/.test(deadline)) throw new Error("Reusable task deadline is invalid.");
  if (!Array.isArray(candidate.checkItems)) throw new Error("Reusable task check items are required.");
  const checkItems = [...new Set(candidate.checkItems.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))];
  if (checkItems.length > 20 || checkItems.some((item) => item.length > 240 || /[\r\n]/.test(item))) throw new Error("Reusable task check items are invalid.");
  return {
    ...(candidate.outputLanguage ? { outputLanguage: candidate.outputLanguage } : {}),
    ...(deadline ? { deadline } : {}),
    checkItems,
  };
}

function withAdjustmentDefaults(task: DesktopReusableTask): DesktopReusableTask {
  return {
    ...task,
    savedAdjustments: task.savedAdjustments && Array.isArray(task.savedAdjustments.checkItems)
      ? normalizeAdjustments(task.savedAdjustments)
      : { checkItems: [] },
  };
}

function sanitizePath(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2048 || /[\r\n]/.test(value)) throw new Error(message);
  return value.trim();
}
