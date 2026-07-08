import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type {
  DesktopBackgroundTask,
  DesktopBackgroundTaskEnqueueRequest,
  DesktopBackgroundTaskKind,
  DesktopBackgroundTaskListRequest,
  DesktopBackgroundTaskSource,
  DesktopBackgroundTaskStatus,
  DesktopBackgroundTaskUpdateRequest,
  DesktopWorkflowRun,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";

const BACKGROUND_TASKS_FILE = join(DRSAI_HOME, "desktop", "background-tasks.json");
const MAX_BACKGROUND_TASKS_PER_WORKSPACE = 100;
const GLOBAL_BACKGROUND_TASK_KEY = "__global__";

interface BackgroundTaskStore {
  workspaces: Record<string, DesktopBackgroundTask[]>;
}

export async function listBackgroundTasks(
  request: unknown = {},
): Promise<DesktopBackgroundTask[]> {
  const typed = normalizeListRequest(request);
  const store = await readBackgroundTaskStore();
  const limit = normalizeLimit(typed.limit);
  const tasks = typed.workspacePath
    ? store.workspaces[workspaceKey(typed.workspacePath)] ?? []
    : Object.values(store.workspaces).flat();
  return tasks
    .filter((task) => !typed.workspacePath || task.workspacePath === typed.workspacePath)
    .sort(compareBackgroundTasks)
    .slice(0, limit)
    .map(cloneBackgroundTask);
}

export async function enqueueBackgroundTask(
  request: unknown,
): Promise<DesktopBackgroundTask> {
  const typed = normalizeEnqueueRequest(request);
  const now = new Date().toISOString();
  const task: DesktopBackgroundTask = {
    id: createBackgroundTaskId(typed.kind, now),
    kind: typed.kind,
    source: typed.source,
    title: normalizeRequiredText(typed.title, "Background task title is required."),
    status: typed.status ?? "queued",
    createdAt: now,
    updatedAt: now,
    ...(typed.workspacePath ? { workspacePath: typed.workspacePath } : {}),
    ...(typed.targetId ? { targetId: typed.targetId } : {}),
    ...(typed.approvalId ? { approvalId: typed.approvalId } : {}),
    ...(typed.currentStep ? { currentStep: typed.currentStep } : {}),
    message: normalizeOptionalText(typed.message) ?? "Background task is queued.",
    verification:
      normalizeOptionalText(typed.verification) ??
      "Track status transitions in the background task queue.",
  };
  assertBackgroundTask(task);
  const store = await readBackgroundTaskStore();
  const key = workspaceKey(task.workspacePath);
  store.workspaces[key] = [task, ...(store.workspaces[key] ?? [])]
    .sort(compareBackgroundTasks)
    .slice(0, MAX_BACKGROUND_TASKS_PER_WORKSPACE);
  await writeBackgroundTaskStore(store);
  return cloneBackgroundTask(task);
}

export async function updateBackgroundTask(
  request: unknown,
): Promise<DesktopBackgroundTask> {
  const typed = normalizeUpdateRequest(request);
  const taskId = normalizeRequiredText(typed.taskId, "Background task id is required.");
  assertBackgroundTaskStatus(typed.status);
  const store = await readBackgroundTaskStore();
  const location = findBackgroundTaskLocation(store, taskId);
  if (!location) {
    throw new Error("Background task was not found.");
  }
  const now = new Date().toISOString();
  const { key, taskIndex } = location;
  const current = store.workspaces[key][taskIndex];
  const updated: DesktopBackgroundTask = {
    ...current,
    status: typed.status,
    updatedAt: now,
    ...(typed.currentStep !== undefined
      ? normalizeOptionalText(typed.currentStep)
        ? { currentStep: typed.currentStep.trim() }
        : { currentStep: undefined }
      : {}),
    message: normalizeOptionalText(typed.message) ?? current.message,
    verification: normalizeOptionalText(typed.verification) ?? current.verification,
  };
  store.workspaces[key][taskIndex] = updated;
  store.workspaces[key] = store.workspaces[key]
    .sort(compareBackgroundTasks)
    .slice(0, MAX_BACKGROUND_TASKS_PER_WORKSPACE);
  await writeBackgroundTaskStore(store);
  return cloneBackgroundTask(updated);
}

export async function upsertBackgroundTaskForWorkflowRun(
  run: DesktopWorkflowRun,
): Promise<DesktopBackgroundTask> {
  const store = await readBackgroundTaskStore();
  const key = workspaceKey(run.workspacePath);
  const now = new Date().toISOString();
  const existingIndex = (store.workspaces[key] ?? []).findIndex(
    (task) => task.targetId === run.id && task.kind === "workflow_run",
  );
  const task: DesktopBackgroundTask =
    existingIndex >= 0
      ? {
          ...store.workspaces[key][existingIndex],
          status: mapWorkflowRunStatus(run.status),
          updatedAt: now,
          currentStep: run.currentStepId,
          message: run.message,
          verification: run.verification,
          ...(run.approvalId ? { approvalId: run.approvalId } : {}),
        }
      : {
          id: createBackgroundTaskId("workflow_run", now),
          kind: "workflow_run",
          source: "workflow",
          title: run.name,
          status: mapWorkflowRunStatus(run.status),
          createdAt: now,
          updatedAt: now,
          ...(run.workspacePath ? { workspacePath: run.workspacePath } : {}),
          targetId: run.id,
          ...(run.approvalId ? { approvalId: run.approvalId } : {}),
          ...(run.currentStepId ? { currentStep: run.currentStepId } : {}),
          message: run.message,
          verification: run.verification,
        };
  assertBackgroundTask(task);
  const currentTasks = store.workspaces[key] ?? [];
  store.workspaces[key] =
    existingIndex >= 0
      ? currentTasks.map((item, index) => (index === existingIndex ? task : item))
      : [task, ...currentTasks];
  store.workspaces[key] = store.workspaces[key]
    .sort(compareBackgroundTasks)
    .slice(0, MAX_BACKGROUND_TASKS_PER_WORKSPACE);
  await writeBackgroundTaskStore(store);
  return cloneBackgroundTask(task);
}

function mapWorkflowRunStatus(
  status: DesktopWorkflowRun["status"],
): DesktopBackgroundTaskStatus {
  if (status === "complete") return "completed";
  if (status === "waiting_approval") return "waiting_approval";
  if (status === "blocked") return "blocked";
  return "running";
}

async function readBackgroundTaskStore(): Promise<BackgroundTaskStore> {
  try {
    const parsed = JSON.parse(await readFile(BACKGROUND_TASKS_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object") return { workspaces: {} };
    const rawWorkspaces = (parsed as BackgroundTaskStore).workspaces;
    if (!rawWorkspaces || typeof rawWorkspaces !== "object") {
      return { workspaces: {} };
    }
    const workspaces: BackgroundTaskStore["workspaces"] = {};
    for (const [key, tasks] of Object.entries(rawWorkspaces)) {
      if (!Array.isArray(tasks)) continue;
      const validTasks = tasks
        .filter(isBackgroundTask)
        .sort(compareBackgroundTasks)
        .slice(0, MAX_BACKGROUND_TASKS_PER_WORKSPACE)
        .map(cloneBackgroundTask);
      if (validTasks.length) workspaces[key] = validTasks;
    }
    return { workspaces };
  } catch {
    return { workspaces: {} };
  }
}

async function writeBackgroundTaskStore(store: BackgroundTaskStore): Promise<void> {
  await mkdir(dirname(BACKGROUND_TASKS_FILE), { recursive: true });
  await writeFile(BACKGROUND_TASKS_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function findBackgroundTaskLocation(
  store: BackgroundTaskStore,
  taskId: string,
): { key: string; taskIndex: number } | null {
  for (const [key, tasks] of Object.entries(store.workspaces)) {
    const taskIndex = tasks.findIndex((task) => task.id === taskId);
    if (taskIndex >= 0) return { key, taskIndex };
  }
  return null;
}

function isBackgroundTask(value: unknown): value is DesktopBackgroundTask {
  const task = value as DesktopBackgroundTask;
  return Boolean(
    task &&
      typeof task.id === "string" &&
      task.id.startsWith("background-task:") &&
      typeof task.kind === "string" &&
      typeof task.source === "string" &&
      typeof task.title === "string" &&
      typeof task.createdAt === "string" &&
      typeof task.updatedAt === "string" &&
      typeof task.message === "string" &&
      typeof task.verification === "string" &&
      isBackgroundTaskStatus(task.status),
  );
}

function assertBackgroundTask(task: DesktopBackgroundTask): void {
  if (!isBackgroundTask(task)) {
    throw new Error("Background task is invalid.");
  }
}

function assertBackgroundTaskStatus(status: unknown): asserts status is DesktopBackgroundTaskStatus {
  if (!isBackgroundTaskStatus(status)) {
    throw new Error("Background task status is invalid.");
  }
}

function normalizeListRequest(request: unknown): DesktopBackgroundTaskListRequest {
  if (!request || typeof request !== "object") return {};
  const typed = request as DesktopBackgroundTaskListRequest;
  return {
    ...(typeof typed.workspacePath === "string" && typed.workspacePath.trim()
      ? { workspacePath: typed.workspacePath.trim() }
      : {}),
    ...(typeof typed.limit === "number" ? { limit: typed.limit } : {}),
  };
}

function normalizeEnqueueRequest(
  request: unknown,
): DesktopBackgroundTaskEnqueueRequest {
  if (!request || typeof request !== "object") {
    throw new Error("Background task enqueue request is required.");
  }
  const typed = request as DesktopBackgroundTaskEnqueueRequest;
  assertBackgroundTaskKind(typed.kind);
  assertBackgroundTaskSource(typed.source);
  if (typed.status !== undefined) assertBackgroundTaskStatus(typed.status);
  return {
    kind: typed.kind,
    source: typed.source,
    title: normalizeRequiredText(typed.title, "Background task title is required."),
    ...(typeof typed.workspacePath === "string" && typed.workspacePath.trim()
      ? { workspacePath: typed.workspacePath.trim() }
      : {}),
    ...(typeof typed.targetId === "string" && typed.targetId.trim()
      ? { targetId: typed.targetId.trim() }
      : {}),
    ...(typeof typed.approvalId === "string" && typed.approvalId.trim()
      ? { approvalId: typed.approvalId.trim() }
      : {}),
    ...(typeof typed.currentStep === "string" && typed.currentStep.trim()
      ? { currentStep: typed.currentStep.trim() }
      : {}),
    ...(typeof typed.message === "string" ? { message: typed.message } : {}),
    ...(typeof typed.verification === "string"
      ? { verification: typed.verification }
      : {}),
    ...(typed.status ? { status: typed.status } : {}),
  };
}

function normalizeUpdateRequest(
  request: unknown,
): DesktopBackgroundTaskUpdateRequest {
  if (!request || typeof request !== "object") {
    throw new Error("Background task update request is required.");
  }
  const typed = request as DesktopBackgroundTaskUpdateRequest;
  assertBackgroundTaskStatus(typed.status);
  return {
    taskId: normalizeRequiredText(typed.taskId, "Background task id is required."),
    status: typed.status,
    ...(typeof typed.message === "string" ? { message: typed.message } : {}),
    ...(typed.currentStep !== undefined && typeof typed.currentStep === "string"
      ? { currentStep: typed.currentStep }
      : {}),
    ...(typeof typed.verification === "string"
      ? { verification: typed.verification }
      : {}),
  };
}

function assertBackgroundTaskKind(
  kind: unknown,
): asserts kind is DesktopBackgroundTaskKind {
  if (
    kind !== "chat_run" &&
    kind !== "workflow_run" &&
    kind !== "agent_run" &&
    kind !== "connector_sync" &&
    kind !== "scheduled_monitor"
  ) {
    throw new Error("Background task kind is invalid.");
  }
}

function assertBackgroundTaskSource(
  source: unknown,
): asserts source is DesktopBackgroundTaskSource {
  if (
    source !== "chat" &&
    source !== "workflow" &&
    source !== "agent" &&
    source !== "connector" &&
    source !== "manual" &&
    source !== "scheduled" &&
    source !== "monitor"
  ) {
    throw new Error("Background task source is invalid.");
  }
}

function isBackgroundTaskStatus(
  value: unknown,
): value is DesktopBackgroundTaskStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "waiting_approval" ||
    value === "blocked" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function normalizeRequiredText(value: unknown, errorMessage: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(errorMessage);
  }
  return value.trim().slice(0, 240);
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim().slice(0, 2000);
}

function normalizeLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(Math.floor(limit), MAX_BACKGROUND_TASKS_PER_WORKSPACE));
}

function cloneBackgroundTask(task: DesktopBackgroundTask): DesktopBackgroundTask {
  return { ...task };
}

function compareBackgroundTasks(
  left: DesktopBackgroundTask,
  right: DesktopBackgroundTask,
): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function createBackgroundTaskId(kind: string, createdAt: string): string {
  return `background-task:${kind}:${Date.parse(createdAt).toString(36)}:${randomUUID()}`;
}

function workspaceKey(workspacePath?: string): string {
  if (!workspacePath) return GLOBAL_BACKGROUND_TASK_KEY;
  return createHash("sha256")
    .update(workspacePath.trim().toLowerCase())
    .digest("hex");
}
