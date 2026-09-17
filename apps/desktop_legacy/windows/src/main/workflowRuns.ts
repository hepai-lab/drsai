import { createHash, randomUUID } from "crypto";
import { join } from "path";
import type {
  DesktopWorkflowRun,
  DesktopWorkflowRunRecipe,
  DesktopWorkflowRunResumePlan,
  DesktopWorkflowRunStartResult,
  DesktopWorkflowRunStep,
  DesktopWorkflowRunStepCompleteResult,
  DesktopWorkflowRunStepDispatchResult,
  DesktopWorkflowRunStepExecution,
  DesktopWorkflowRunStepStatus,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";
import { readDurableJson, writeDurableJson } from "../../../shared/main/durableJsonStore";

const WORKFLOW_RUNS_FILE = join(DRSAI_HOME, "desktop", "workflow-runs.json");
const MAX_WORKFLOW_RUN_STORE_BYTES = 32 * 1024 * 1024;
const MAX_WORKFLOW_RUNS_PER_WORKSPACE = 100;
const GLOBAL_WORKFLOW_RUN_KEY = "__global__";

interface WorkflowRunStore {
  workspaces: Record<string, DesktopWorkflowRun[]>;
}

export async function listWorkflowRuns(workspacePath?: string): Promise<DesktopWorkflowRun[]> {
  const store = await readWorkflowRunStore();
  const runs = workspacePath
    ? store.workspaces[workspaceKey(workspacePath)] ?? []
    : Object.values(store.workspaces).flat();
  return runs
    .filter((run) => !workspacePath || run.workspacePath === workspacePath)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(cloneWorkflowRun);
}

export async function recoverWorkflowRunsAfterRestart(): Promise<{
  recovered: number;
  runs: DesktopWorkflowRun[];
}> {
  const store = await readWorkflowRunStore();
  const recoveredRuns: DesktopWorkflowRun[] = [];
  const recoveredAt = new Date().toISOString();
  for (const [key, runs] of Object.entries(store.workspaces)) {
    store.workspaces[key] = runs.map((run) => {
      const recovered = buildRestartResumePlan(run, recoveredAt);
      if (recovered !== run) {
        recoveredRuns.push(cloneWorkflowRun(recovered));
      }
      return recovered;
    });
  }
  if (recoveredRuns.length) {
    await writeWorkflowRunStore(store);
  }
  return {
    recovered: recoveredRuns.length,
    runs: recoveredRuns,
  };
}

export async function startWorkflowRun(
  request: unknown,
): Promise<DesktopWorkflowRunStartResult> {
  const recipe = normalizeWorkflowRunRecipe(
    (request as { recipe?: DesktopWorkflowRunRecipe } | null)?.recipe,
  );
  if (!recipe) {
    throw new Error("Workflow run start request is incomplete.");
  }

  const idempotencyKey = (request as { idempotencyKey?: unknown } | null)?.idempotencyKey;
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || !/^[a-f0-9]{64}$/.test(idempotencyKey))) {
    throw new Error("Workflow run idempotency key is invalid.");
  }
  const store = await readWorkflowRunStore();
  const key = workspaceKey(recipe.workspacePath);
  const existing = idempotencyKey ? (store.workspaces[key] ?? []).find((run) => run.recipeId === recipe.id) : undefined;
  if (existing) return createWorkflowRunStartResult(recipe, existing);

  const now = new Date().toISOString();
  const steps = recipe.steps.map((step) =>
    createInitialStepExecution(recipe, step, now),
  );
  const currentStep = steps.find((step) => step.status !== "completed");
  const run: DesktopWorkflowRun = {
    id: createWorkflowRunExecutionId(recipe.templateId, now),
    recipeId: recipe.id,
    templateId: recipe.templateId,
    name: recipe.name,
    ...(recipe.workspacePath ? { workspacePath: recipe.workspacePath } : {}),
    status: getInitialRunStatus(recipe, steps),
    createdAt: now,
    updatedAt: now,
    ...(currentStep ? { currentStepId: currentStep.id } : {}),
    ...(recipe.approvalId ? { approvalId: recipe.approvalId } : {}),
    steps,
    verification: recipe.verification,
    message: getInitialRunMessage(recipe, steps),
  };
  store.workspaces[key] = [run, ...(store.workspaces[key] ?? [])]
    .sort(compareWorkflowRuns)
    .slice(0, MAX_WORKFLOW_RUNS_PER_WORKSPACE);
  await writeWorkflowRunStore(store);
  return createWorkflowRunStartResult(recipe, run);
}

function createWorkflowRunStartResult(recipe: DesktopWorkflowRunRecipe, run: DesktopWorkflowRun): DesktopWorkflowRunStartResult {
  return {
    run: cloneWorkflowRun(run),
    chatCommands: getCommandsByKind(run.steps, "chat_command"),
    terminalCommands: getCommandsByKind(run.steps, "terminal_command"),
    approvalIds: recipe.approvalId ? [recipe.approvalId] : [],
    manualCheckpoints: run.steps.filter((step) => step.kind === "manual_review").map((step) => step.title),
  };
}

export async function dispatchWorkflowRunStep(
  request: unknown,
): Promise<DesktopWorkflowRunStepDispatchResult> {
  const runId = (request as { runId?: unknown } | null)?.runId;
  const stepId = (request as { stepId?: unknown } | null)?.stepId;
  if (typeof runId !== "string" || !runId.trim()) {
    throw new Error("Workflow run dispatch request is missing a run id.");
  }
  if (typeof stepId !== "string" || !stepId.trim()) {
    throw new Error("Workflow run dispatch request is missing a step id.");
  }

  const store = await readWorkflowRunStore();
  const location = findWorkflowRunLocation(store, runId);
  if (!location) {
    throw new Error("Workflow run was not found.");
  }
  const { key, runIndex } = location;
  const run = cloneWorkflowRun(store.workspaces[key][runIndex]);
  const stepIndex = run.steps.findIndex((step) => step.id === stepId);
  if (stepIndex < 0) {
    throw new Error("Workflow run step was not found.");
  }

  const step = run.steps[stepIndex];
  const result = buildWorkflowStepDispatchResult(run, step);
  if (result.dispatched && step.kind !== "terminal_command") {
    const now = new Date().toISOString();
    const waitsForChatResult = step.kind === "chat_command";
    run.steps[stepIndex] = {
      ...step,
      status: waitsForChatResult ? "running" : "completed",
      ...(waitsForChatResult ? {} : { completedAt: now }),
      message: waitsForChatResult
        ? "Chat command prepared; confirm this step only after the chat action finishes."
        : result.message,
    };
    run.updatedAt = now;
    run.currentStepId = run.steps.find((item) => item.status !== "completed")?.id;
    run.status = getUpdatedRunStatus(run.steps);
    run.message = getUpdatedRunMessage(run.steps);
    store.workspaces[key][runIndex] = run;
    store.workspaces[key] = store.workspaces[key]
      .sort(compareWorkflowRuns)
      .slice(0, MAX_WORKFLOW_RUNS_PER_WORKSPACE);
    await writeWorkflowRunStore(store);
    return {
      ...result,
      run: cloneWorkflowRun(run),
    };
  }

  return {
    ...result,
    run: cloneWorkflowRun(run),
  };
}

export async function completeWorkflowRunStep(
  request: unknown,
): Promise<DesktopWorkflowRunStepCompleteResult> {
  const runId = (request as { runId?: unknown } | null)?.runId;
  const stepId = (request as { stepId?: unknown } | null)?.stepId;
  const exitCode = (request as { exitCode?: unknown } | null)?.exitCode;
  const output = (request as { output?: unknown } | null)?.output;
  if (typeof runId !== "string" || !runId.trim()) {
    throw new Error("Workflow run completion request is missing a run id.");
  }
  if (typeof stepId !== "string" || !stepId.trim()) {
    throw new Error("Workflow run completion request is missing a step id.");
  }
  if (typeof exitCode !== "number" || !Number.isFinite(exitCode)) {
    throw new Error("Workflow run completion request is missing an exit code.");
  }

  const store = await readWorkflowRunStore();
  const location = findWorkflowRunLocation(store, runId);
  if (!location) {
    throw new Error("Workflow run was not found.");
  }
  const { key, runIndex } = location;
  const run = cloneWorkflowRun(store.workspaces[key][runIndex]);
  const stepIndex = run.steps.findIndex((step) => step.id === stepId);
  if (stepIndex < 0) {
    throw new Error("Workflow run step was not found.");
  }

  const step = run.steps[stepIndex];
  if (step.kind !== "terminal_command" && step.kind !== "chat_command" && step.kind !== "external_runtime") {
    throw new Error("Only dispatched terminal/chat steps or explicitly reconnected external runtimes can be completed.");
  }
  if (step.status === "completed") {
    return {
      run,
      completed: true,
      blocked: false,
      message: "Workflow run step has already been completed.",
    };
  }

  const now = new Date().toISOString();
  const outputSummary =
    typeof output === "string" && output.trim()
      ? ` Output: ${summarizeWorkflowStepOutput(output)}`
      : "";
  const completable = step.status === "running" ||
    (step.kind === "external_runtime" && step.status === "waiting_approval");
  if (!completable) {
    throw new Error("Only a running workflow step or waiting external runtime can be completed.");
  }
  const succeeded = exitCode === 0;
  const label = step.kind === "terminal_command"
    ? "Terminal command"
    : step.kind === "chat_command"
      ? "Chat action"
      : "External runtime reconnect";
  run.steps[stepIndex] = {
    ...step,
    status: succeeded ? "completed" : "blocked",
    ...(succeeded ? { completedAt: now } : {}),
    message: succeeded
      ? `${label} completed with exit code 0.${outputSummary}`
      : `${label} failed with exit code ${exitCode}.${outputSummary}`,
  };
  run.updatedAt = now;
  run.currentStepId = run.steps.find((item) => item.status !== "completed")?.id;
  run.status = getUpdatedRunStatus(run.steps);
  run.message = getUpdatedRunMessage(run.steps);
  store.workspaces[key][runIndex] = run;
  store.workspaces[key] = store.workspaces[key]
    .sort(compareWorkflowRuns)
    .slice(0, MAX_WORKFLOW_RUNS_PER_WORKSPACE);
  await writeWorkflowRunStore(store);

  return {
    run: cloneWorkflowRun(run),
    completed: succeeded,
    blocked: !succeeded,
    message: run.steps[stepIndex].message,
  };
}

export async function markWorkflowRunTerminalStepRunning(
  request: unknown,
): Promise<DesktopWorkflowRun | null> {
  const runId = (request as { runId?: unknown } | null)?.runId;
  const stepId = (request as { stepId?: unknown } | null)?.stepId;
  if (typeof runId !== "string" || !runId.trim()) return null;
  if (typeof stepId !== "string" || !stepId.trim()) return null;

  const store = await readWorkflowRunStore();
  const location = findWorkflowRunLocation(store, runId);
  if (!location) return null;
  const { key, runIndex } = location;
  const run = cloneWorkflowRun(store.workspaces[key][runIndex]);
  const stepIndex = run.steps.findIndex((step) => step.id === stepId);
  if (stepIndex < 0) return null;

  const step = run.steps[stepIndex];
  if (step.kind !== "terminal_command" || step.status === "completed") {
    return cloneWorkflowRun(run);
  }

  const now = new Date().toISOString();
  run.steps[stepIndex] = {
    ...step,
    status: "running",
    message: "Terminal command is running after shell approval.",
  };
  run.updatedAt = now;
  run.currentStepId = step.id;
  run.status = getUpdatedRunStatus(run.steps);
  run.message = getUpdatedRunMessage(run.steps);
  store.workspaces[key][runIndex] = run;
  store.workspaces[key] = store.workspaces[key]
    .sort(compareWorkflowRuns)
    .slice(0, MAX_WORKFLOW_RUNS_PER_WORKSPACE);
  await writeWorkflowRunStore(store);
  return cloneWorkflowRun(run);
}

function buildRestartResumePlan(
  run: DesktopWorkflowRun,
  recoveredAt: string,
): DesktopWorkflowRun {
  if (run.status === "complete" || run.status === "blocked") return run;

  const steps = run.steps.map((step) =>
    buildRestartResumeStep(step, recoveredAt),
  );
  const resumableStepIds = steps
    .filter((step) => step.resumableAfterRestart)
    .map((step) => step.id);
  const waitingApprovalStepIds = steps
    .filter((step) => step.status === "waiting_approval")
    .map((step) => step.id);
  const pendingStepCount = steps.filter((step) => step.status !== "completed")
    .length;
  if (pendingStepCount === 0) {
    return {
      ...run,
      steps,
      status: "complete",
      updatedAt: recoveredAt,
      currentStepId: undefined,
      resumePlan: undefined,
      message: "Workflow run completed.",
    };
  }

  const resumePlan: DesktopWorkflowRunResumePlan = {
    restartDetectedAt: recoveredAt,
    pendingStepCount,
    resumableStepIds,
    waitingApprovalStepIds,
    message:
      resumableStepIds.length > 0
        ? `Recovered after app restart; ${resumableStepIds.length} step(s) can be resumed without bypassing approvals.`
        : "Recovered after app restart and is waiting for Approval Center.",
  };
  return {
    ...run,
    steps,
    status: waitingApprovalStepIds.length > 0 ? "waiting_approval" : "running",
    updatedAt: recoveredAt,
    currentStepId: steps.find((step) => step.status !== "completed")?.id,
    resumePlan,
    message: resumePlan.message,
  };
}

function buildRestartResumeStep(
  step: DesktopWorkflowRunStepExecution,
  recoveredAt: string,
): DesktopWorkflowRunStepExecution {
  if (step.status === "completed" || step.status === "blocked") return step;
  if (step.status === "waiting_approval" || step.kind === "approval") {
    return {
      ...step,
      status: "waiting_approval",
      resumableAfterRestart: false,
      resumeAction: "wait_approval",
      resumeMessage:
        "Approval Center still owns this step after restart; approve or reject it there.",
      lastResumedAt: recoveredAt,
      message:
        step.message || "Waiting for Approval Center after restart recovery.",
    };
  }
  if (step.kind === "chat_command") {
    return {
      ...step,
      status: "ready",
      resumableAfterRestart: true,
      resumeAction: "dispatch_chat",
      resumeMessage:
        "Send this command back into the chat bar to continue the workflow.",
      lastResumedAt: recoveredAt,
      message: step.command
        ? `Recovered after restart; ready to send to chat: ${step.command}`
        : "Recovered after restart; ready for chat dispatch.",
    };
  }
  if (step.kind === "terminal_command") {
    return {
      ...step,
      status: "ready",
      resumableAfterRestart: true,
      resumeAction: "prepare_terminal",
      resumeMessage:
        "Prepare this terminal command again; the terminal approval path still applies.",
      lastResumedAt: recoveredAt,
      message: step.command
        ? `Recovered after restart; prepare terminal command again: ${step.command}`
        : "Recovered after restart; terminal step is ready for preparation.",
    };
  }
  if (step.kind === "external_runtime") {
    return {
      ...step,
      status: "ready",
      resumableAfterRestart: true,
      resumeAction: "reconnect_external",
      resumeMessage:
        "Reconnect this external runtime through its provider control plane; the app will not auto-run it after restart.",
      lastResumedAt: recoveredAt,
      message:
        "Recovered after restart; external runtime step needs explicit reconnect or restart.",
    };
  }
  return {
    ...step,
    status: "ready",
    resumableAfterRestart: true,
    resumeAction: "confirm_manual",
    resumeMessage:
      "Confirm this manual checkpoint to continue the workflow after restart.",
    lastResumedAt: recoveredAt,
    message: "Recovered after restart; manual checkpoint is ready for confirmation.",
  };
}

function normalizeWorkflowRunRecipe(
  recipe: DesktopWorkflowRunRecipe | undefined,
): DesktopWorkflowRunRecipe | null {
  if (!recipe || typeof recipe !== "object") return null;
  if (!recipe.id || !recipe.templateId || !recipe.name) return null;
  if (!Array.isArray(recipe.steps)) return null;
  return recipe;
}

function createInitialStepExecution(
  recipe: DesktopWorkflowRunRecipe,
  step: DesktopWorkflowRunStep,
  now: string,
): DesktopWorkflowRunStepExecution {
  const status = getInitialStepStatus(recipe, step);
  return {
    ...step,
    status,
    message: getStepDispatchMessage(recipe, step, status),
    ...(status === "completed" ? { completedAt: now } : {}),
  };
}

function getInitialStepStatus(
  recipe: DesktopWorkflowRunRecipe,
  step: DesktopWorkflowRunStep,
): DesktopWorkflowRunStepStatus {
  if (recipe.status === "blocked") return "blocked";
  if (recipe.status === "approval_queued") {
    if (step.kind === "approval" || step.requiresApproval) {
      return "waiting_approval";
    }
    return "pending";
  }
  if (step.kind === "chat_command") return "ready";
  if (step.kind === "terminal_command") {
    return step.requiresApproval ? "waiting_approval" : "ready";
  }
  if (step.kind === "approval" || step.requiresApproval) {
    return "waiting_approval";
  }
  return "pending";
}

function getStepDispatchMessage(
  recipe: DesktopWorkflowRunRecipe,
  step: DesktopWorkflowRunStep,
  status: DesktopWorkflowRunStepStatus,
): string {
  if (status === "blocked") return recipe.message;
  if (step.kind === "chat_command") {
    return step.command
      ? `Ready to paste into the chat bar: ${step.command}`
      : "Ready for chat bar execution.";
  }
  if (step.kind === "terminal_command") {
    return step.requiresApproval
      ? "Prepare this terminal command through the existing command approval path."
      : "Ready to run in the active workspace terminal.";
  }
  if (step.kind === "external_runtime") {
    return step.requiresApproval
      ? "External runtime reconnect requires the existing approval boundary before provider-specific execution."
      : "External runtime reconnect is ready for provider-specific handling.";
  }
  if (step.kind === "approval") {
    return recipe.approvalId
      ? `Waiting for Approval Center item ${recipe.approvalId}.`
      : "Waiting for Approval Center confirmation.";
  }
  return "Manual checkpoint remains for the operator or agent to confirm.";
}

function getInitialRunStatus(
  recipe: DesktopWorkflowRunRecipe,
  steps: DesktopWorkflowRunStepExecution[],
): DesktopWorkflowRun["status"] {
  if (recipe.status === "blocked") return "blocked";
  if (steps.some((step) => step.status === "waiting_approval")) {
    return "waiting_approval";
  }
  if (steps.every((step) => step.status === "completed")) return "complete";
  return "running";
}

function getInitialRunMessage(
  recipe: DesktopWorkflowRunRecipe,
  steps: DesktopWorkflowRunStepExecution[],
): string {
  if (recipe.status === "blocked") return recipe.message;
  if (recipe.status === "approval_queued") {
    return "Workflow run is waiting for Approval Center before dispatch continues.";
  }
  const chatCount = steps.filter((step) => step.kind === "chat_command").length;
  const terminalCount = steps.filter(
    (step) => step.kind === "terminal_command",
  ).length;
  return `Workflow run started with ${chatCount} chat command step(s) and ${terminalCount} terminal command step(s).`;
}

function getCommandsByKind(
  steps: DesktopWorkflowRunStepExecution[],
  kind: "chat_command" | "terminal_command",
): string[] {
  return steps
    .filter((step) => step.kind === kind && step.command)
    .map((step) => step.command as string);
}

function buildWorkflowStepDispatchResult(
  run: DesktopWorkflowRun,
  step: DesktopWorkflowRunStepExecution,
): DesktopWorkflowRunStepDispatchResult {
  if (run.status === "blocked" || step.status === "blocked") {
    return {
      run: cloneWorkflowRun(run),
      dispatched: false,
      kind: step.kind,
      ...(step.command ? { command: step.command } : {}),
      requiresApproval: step.requiresApproval,
      message: step.message || "Workflow run step is blocked.",
    };
  }
  if (step.status === "waiting_approval" || step.kind === "approval") {
    return {
      run: cloneWorkflowRun(run),
      dispatched: false,
      kind: step.kind,
      ...(step.command ? { command: step.command } : {}),
      requiresApproval: step.requiresApproval,
      message: step.message || "Workflow run step is waiting for Approval Center.",
    };
  }
  if (step.status === "completed") {
    return {
      run: cloneWorkflowRun(run),
      dispatched: false,
      kind: step.kind,
      ...(step.command ? { command: step.command } : {}),
      requiresApproval: step.requiresApproval,
      message: "Workflow run step has already been completed.",
    };
  }
  if (step.kind === "chat_command") {
    if (!step.command) {
      return {
        run: cloneWorkflowRun(run),
        dispatched: false,
        kind: step.kind,
        requiresApproval: false,
        message: "Chat workflow step has no command to dispatch.",
      };
    }
    return {
      run: cloneWorkflowRun(run),
      dispatched: true,
      kind: step.kind,
      command: step.command,
      requiresApproval: false,
      message: `Dispatched to the chat bar: ${step.command}`,
    };
  }
  if (step.kind === "terminal_command") {
    return {
      run: cloneWorkflowRun(run),
      dispatched: Boolean(step.command),
      kind: step.kind,
      ...(step.command ? { command: step.command } : {}),
      requiresApproval: step.requiresApproval,
      message: step.requiresApproval
        ? "Terminal command is ready; run it through the terminal command approval path."
        : "Terminal command is ready for the active workspace terminal.",
    };
  }
  if (step.kind === "external_runtime") {
    return {
      run: cloneWorkflowRun(run),
      dispatched: false,
      kind: step.kind,
      requiresApproval: step.requiresApproval,
      message:
        "External runtime steps need provider-specific reconnect or restart; no process was started automatically.",
    };
  }
  return {
    run: cloneWorkflowRun(run),
    dispatched: true,
    kind: step.kind,
    requiresApproval: step.requiresApproval,
    message: "Manual workflow checkpoint was marked complete.",
  };
}

function getUpdatedRunStatus(
  steps: DesktopWorkflowRunStepExecution[],
): DesktopWorkflowRun["status"] {
  if (steps.some((step) => step.status === "blocked")) return "blocked";
  if (steps.some((step) => step.status === "waiting_approval")) {
    return "waiting_approval";
  }
  if (steps.every((step) => step.status === "completed")) return "complete";
  return "running";
}

function getUpdatedRunMessage(steps: DesktopWorkflowRunStepExecution[]): string {
  const remaining = steps.filter((step) => step.status !== "completed").length;
  if (remaining === 0) return "Workflow run completed.";
  if (steps.some((step) => step.status === "blocked")) {
    return "Workflow run is blocked by a failed or blocked step.";
  }
  if (steps.some((step) => step.status === "waiting_approval")) {
    return "Workflow run is waiting for Approval Center before dispatch continues.";
  }
  return `Workflow run has ${remaining} remaining step(s).`;
}

function summarizeWorkflowStepOutput(output: string): string {
  return output
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/__DRSAI_AGENT_COMMAND_DONE:[^:]+:-?\d+__/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-500);
}

function cloneWorkflowRun(run: DesktopWorkflowRun): DesktopWorkflowRun {
  return {
    ...run,
    steps: run.steps.map((step) => ({ ...step })),
    ...(run.resumePlan
      ? {
          resumePlan: {
            ...run.resumePlan,
            resumableStepIds: [...run.resumePlan.resumableStepIds],
            waitingApprovalStepIds: [...run.resumePlan.waitingApprovalStepIds],
          },
        }
      : {}),
  };
}

function findWorkflowRunLocation(
  store: WorkflowRunStore,
  runId: string,
): { key: string; runIndex: number } | null {
  for (const [key, runs] of Object.entries(store.workspaces)) {
    const runIndex = runs.findIndex((run) => run.id === runId);
    if (runIndex >= 0) return { key, runIndex };
  }
  return null;
}

function createWorkflowRunExecutionId(templateId: string, createdAt: string): string {
  return `workflow-run:${templateId}:${Date.parse(createdAt).toString(36)}:${randomUUID()}`;
}

async function readWorkflowRunStore(): Promise<WorkflowRunStore> {
  return (await readDurableJson(WORKFLOW_RUNS_FILE, decodeWorkflowRunStore, { maxBytes: MAX_WORKFLOW_RUN_STORE_BYTES }))?.value ?? { workspaces: {} };
}

function decodeWorkflowRunStore(parsed: unknown): WorkflowRunStore {
    if (!parsed || typeof parsed !== "object") throw new Error("Workflow run store schema is invalid.");
    const rawWorkspaces = (parsed as WorkflowRunStore).workspaces;
    if (!rawWorkspaces || typeof rawWorkspaces !== "object" || Array.isArray(rawWorkspaces)) throw new Error("Workflow run store schema is invalid.");
    const workspaces: WorkflowRunStore["workspaces"] = {};
    for (const [key, runs] of Object.entries(rawWorkspaces)) {
      if (!Array.isArray(runs)) continue;
      const validRuns = runs
        .filter(isWorkflowRun)
        .sort(compareWorkflowRuns)
        .slice(0, MAX_WORKFLOW_RUNS_PER_WORKSPACE)
        .map(cloneWorkflowRun);
      if (validRuns.length) workspaces[key] = validRuns;
    }
    return { workspaces };
}

async function writeWorkflowRunStore(store: WorkflowRunStore): Promise<void> {
  await writeDurableJson(WORKFLOW_RUNS_FILE, store, { maxBytes: MAX_WORKFLOW_RUN_STORE_BYTES });
}

function compareWorkflowRuns(
  left: DesktopWorkflowRun,
  right: DesktopWorkflowRun,
): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function isWorkflowRun(value: unknown): value is DesktopWorkflowRun {
  const run = value as DesktopWorkflowRun;
  return Boolean(
    run &&
      typeof run.id === "string" &&
      run.id.startsWith("workflow-run:") &&
      typeof run.recipeId === "string" &&
      typeof run.templateId === "string" &&
      typeof run.name === "string" &&
      typeof run.createdAt === "string" &&
      typeof run.updatedAt === "string" &&
      Array.isArray(run.steps) &&
      typeof run.verification === "string" &&
      typeof run.message === "string" &&
      isWorkflowRunStatus(run.status) &&
      run.steps.every(isWorkflowRunStepExecution),
  );
}

function isWorkflowRunStepExecution(
  value: unknown,
): value is DesktopWorkflowRunStepExecution {
  const step = value as DesktopWorkflowRunStepExecution;
  return Boolean(
    step &&
      typeof step.id === "string" &&
      typeof step.title === "string" &&
      typeof step.detail === "string" &&
      typeof step.requiresApproval === "boolean" &&
      typeof step.message === "string" &&
      isWorkflowStepKind(step.kind) &&
      isWorkflowStepStatus(step.status),
  );
}

function isWorkflowRunStatus(
  value: unknown,
): value is DesktopWorkflowRun["status"] {
  return (
    value === "running" ||
    value === "waiting_approval" ||
    value === "blocked" ||
    value === "complete"
  );
}

function isWorkflowStepKind(value: unknown): value is DesktopWorkflowRunStep["kind"] {
  return (
    value === "chat_command" ||
    value === "terminal_command" ||
    value === "external_runtime" ||
    value === "manual_review" ||
    value === "approval"
  );
}

function isWorkflowStepStatus(
  value: unknown,
): value is DesktopWorkflowRunStepStatus {
  return (
    value === "pending" ||
    value === "ready" ||
    value === "running" ||
    value === "waiting_approval" ||
    value === "blocked" ||
    value === "completed"
  );
}

function workspaceKey(workspacePath?: string): string {
  if (!workspacePath) return GLOBAL_WORKFLOW_RUN_KEY;
  return createHash("sha256")
    .update(workspacePath.trim().toLowerCase())
    .digest("hex");
}
