import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type {
  DesktopScheduledTask,
  DesktopScheduledTaskCadence,
  DesktopScheduledTaskCreateRequest,
  DesktopScheduledTaskKind,
  DesktopScheduledTaskListRequest,
  DesktopScheduledTaskRunItem,
  DesktopScheduledTaskRunRequest,
  DesktopScheduledTaskRunResult,
  DesktopScheduledTaskWorkerStatus,
  DesktopScheduledTaskStatus,
  DesktopScheduledTaskUpdateRequest,
  DesktopWorkflowRunPrepareRequest,
  DesktopWorkflowRunPrepareResult,
  DesktopWorkflowRunStartRequest,
  DesktopWorkflowRunStartResult,
  DesktopWorkflowRun,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";

const SCHEDULED_TASKS_FILE = join(DRSAI_HOME, "desktop", "scheduled-tasks.json");
const MAX_SCHEDULED_TASKS_PER_WORKSPACE = 100;
const GLOBAL_SCHEDULED_TASK_KEY = "__global__";

interface ScheduledTaskStore {
  workspaces: Record<string, DesktopScheduledTask[]>;
}

interface ScheduledTaskRuntime {
  prepareWorkflowRun(
    request: DesktopWorkflowRunPrepareRequest,
  ): Promise<DesktopWorkflowRunPrepareResult>;
  startWorkflowRun(
    request: DesktopWorkflowRunStartRequest,
  ): Promise<DesktopWorkflowRunStartResult>;
  listWorkflowRuns?(workspacePath?: string): Promise<DesktopWorkflowRun[]>;
  onWorkflowRun?(run: DesktopScheduledTaskRunResult["runs"][number]): Promise<void>;
}

export interface ScheduledTaskWorkerHandle {
  runOnce(): Promise<DesktopScheduledTaskRunResult | null>;
  getStatus(): DesktopScheduledTaskWorkerStatus;
  stop(): void;
}

export async function listScheduledTasks(
  request: unknown = {},
): Promise<DesktopScheduledTask[]> {
  const typed = normalizeListRequest(request);
  const store = await readScheduledTaskStore();
  const limit = normalizeLimit(typed.limit);
  const tasks = typed.workspacePath
    ? store.workspaces[workspaceKey(typed.workspacePath)] ?? []
    : Object.values(store.workspaces).flat();
  return tasks
    .filter((task) => !typed.workspacePath || task.workspacePath === typed.workspacePath)
    .sort(compareScheduledTasks)
    .slice(0, limit)
    .map(cloneScheduledTask);
}

export async function createScheduledTask(
  request: unknown,
): Promise<DesktopScheduledTask> {
  const typed = normalizeCreateRequest(request);
  const now = new Date().toISOString();
  const task: DesktopScheduledTask = {
    id: createScheduledTaskId(typed.kind, now),
    kind: typed.kind,
    title: normalizeRequiredText(typed.title, "Scheduled task title is required."),
    status: typed.status ?? "enabled",
    cadence: typed.cadence,
    createdAt: now,
    updatedAt: now,
    ...(typed.workspacePath ? { workspacePath: typed.workspacePath } : {}),
    target: normalizeRequiredText(typed.target, "Scheduled task target is required."),
    ...(typed.workflowTemplateId ? { workflowTemplateId: typed.workflowTemplateId } : {}),
    nextRunAt:
      typed.nextRunAt ?? getNextScheduledRunAt(now, typed.cadence),
    approvalRequired: typed.approvalRequired ?? true,
    message:
      normalizeOptionalText(typed.message) ??
      "Scheduled task is configured for approval-gated trigger execution.",
    verification:
      normalizeOptionalText(typed.verification) ??
      "Verify persisted schedule state and due trigger results in the Skills Square scheduler panel.",
  };
  assertScheduledTask(task);
  const store = await readScheduledTaskStore();
  const key = workspaceKey(task.workspacePath);
  store.workspaces[key] = [task, ...(store.workspaces[key] ?? [])]
    .sort(compareScheduledTasks)
    .slice(0, MAX_SCHEDULED_TASKS_PER_WORKSPACE);
  await writeScheduledTaskStore(store);
  return cloneScheduledTask(task);
}

export async function updateScheduledTask(
  request: unknown,
): Promise<DesktopScheduledTask> {
  const typed = normalizeUpdateRequest(request);
  const store = await readScheduledTaskStore();
  const location = findScheduledTaskLocation(store, typed.taskId);
  if (!location) {
    throw new Error("Scheduled task was not found.");
  }
  const now = new Date().toISOString();
  const { key, taskIndex } = location;
  const current = store.workspaces[key][taskIndex];
  const updated: DesktopScheduledTask = {
    ...current,
    status: typed.status,
    updatedAt: now,
    ...(typed.nextRunAt !== undefined
      ? normalizeOptionalText(typed.nextRunAt)
        ? { nextRunAt: typed.nextRunAt.trim() }
        : { nextRunAt: undefined }
      : {}),
    message: normalizeOptionalText(typed.message) ?? current.message,
    verification: normalizeOptionalText(typed.verification) ?? current.verification,
  };
  assertScheduledTask(updated);
  store.workspaces[key][taskIndex] = updated;
  store.workspaces[key] = store.workspaces[key]
    .sort(compareScheduledTasks)
    .slice(0, MAX_SCHEDULED_TASKS_PER_WORKSPACE);
  await writeScheduledTaskStore(store);
  return cloneScheduledTask(updated);
}

export async function runDueScheduledTasks(
  request: unknown,
  runtime: ScheduledTaskRuntime,
): Promise<DesktopScheduledTaskRunResult> {
  const typed = normalizeRunRequest(request);
  const now = new Date(typed.now ?? new Date().toISOString());
  if (Number.isNaN(now.getTime())) {
    throw new Error("Scheduled task run timestamp is invalid.");
  }
  const generatedAt = now.toISOString();
  const store = await readScheduledTaskStore();
  const limit = normalizeLimit(typed.limit);
  const workspaceKeys = typed.workspacePath
    ? [workspaceKey(typed.workspacePath)]
    : Object.keys(store.workspaces);
  const items: DesktopScheduledTaskRunItem[] = [];
  const runs: DesktopScheduledTaskRunResult["runs"] = [];
  let checked = 0;

  for (const key of workspaceKeys) {
    const tasks = store.workspaces[key] ?? [];
    for (const task of tasks) {
      if (items.length >= limit) break;
      if (typed.workspacePath && task.workspacePath !== typed.workspacePath) continue;
      if (!isTaskDue(task, now)) continue;
      checked += 1;
      const taskIndex = tasks.findIndex((item) => item.id === task.id);
      const result = await runSingleScheduledTask(task, generatedAt, runtime);
      items.push(result.item);
      if (result.run) runs.push(result.run);
      if (taskIndex >= 0) {
        tasks[taskIndex] = result.task;
      }
    }
    store.workspaces[key] = tasks
      .sort(compareScheduledTasks)
      .slice(0, MAX_SCHEDULED_TASKS_PER_WORKSPACE);
  }

  await writeScheduledTaskStore(store);
  return {
    generatedAt,
    checked,
    triggered: items.filter(
      (item) => item.status === "started" || item.status === "queued_approval",
    ).length,
    reconnected: items.filter((item) => item.status === "reconnected").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    blocked: items.filter((item) => item.status === "blocked").length,
    items,
    runs,
  };
}

export function startScheduledTaskWorker(
  runtime: ScheduledTaskRuntime,
  options: {
    intervalMs?: number;
    initialDelayMs?: number;
    limit?: number;
  } = {},
): ScheduledTaskWorkerHandle {
  const intervalMs = normalizeWorkerIntervalMs(options.intervalMs);
  const initialDelayMs = normalizeWorkerInitialDelayMs(options.initialDelayMs);
  const limit = normalizeLimit(options.limit);
  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;
  let nextRunAt: string | undefined;
  let lastStartedAt: string | undefined;
  let lastFinishedAt: string | undefined;
  let lastResult: DesktopScheduledTaskWorkerStatus["lastResult"];
  let lastError: string | undefined;

  const runOnce = async (): Promise<DesktopScheduledTaskRunResult | null> => {
    if (stopped || running) return null;
    running = true;
    lastStartedAt = new Date().toISOString();
    lastError = undefined;
    try {
      const result = await runDueScheduledTasks({ limit }, runtime);
      if (runtime.onWorkflowRun) {
        await Promise.all(result.runs.map((run) => runtime.onWorkflowRun?.(run)));
      }
      lastResult = {
        generatedAt: result.generatedAt,
        checked: result.checked,
        triggered: result.triggered,
        reconnected: result.reconnected,
        skipped: result.skipped,
        blocked: result.blocked,
      };
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(
        "[desktop] Scheduled task worker scan failed:",
        lastError,
      );
      return null;
    } finally {
      lastFinishedAt = new Date().toISOString();
      running = false;
    }
  };

  const scheduleNext = (delayMs: number): void => {
    if (stopped) return;
    nextRunAt = new Date(Date.now() + delayMs).toISOString();
    timer = setTimeout(() => {
      void runOnce().finally(() => scheduleNext(intervalMs));
    }, delayMs);
    timer.unref?.();
  };

  scheduleNext(initialDelayMs);

  return {
    runOnce,
    getStatus() {
      return {
        enabled: true,
        running,
        stopped,
        intervalMs,
        initialDelayMs,
        ...(nextRunAt ? { nextRunAt } : {}),
        ...(lastStartedAt ? { lastStartedAt } : {}),
        ...(lastFinishedAt ? { lastFinishedAt } : {}),
        ...(lastResult ? { lastResult } : {}),
        ...(lastError ? { lastError } : {}),
        message: stopped
          ? "Scheduled task worker is stopped."
          : running
            ? "Scheduled task worker is scanning due monitors."
            : "Scheduled task worker is waiting for the next due scan.",
      };
    },
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      nextRunAt = undefined;
    },
  };
}

async function runSingleScheduledTask(
  task: DesktopScheduledTask,
  now: string,
  runtime: ScheduledTaskRuntime,
): Promise<{
  task: DesktopScheduledTask;
  item: DesktopScheduledTaskRunItem;
  run?: DesktopScheduledTaskRunResult["runs"][number];
}> {
  const activeRun = await getActiveWorkflowRun(task, runtime);
  if (activeRun) {
    if (activeRun.status === "running" || activeRun.status === "waiting_approval") {
      const reconnectMessage = getActiveWorkflowRunReconnectMessage(activeRun);
      return {
        task: {
          ...task,
          updatedAt: now,
          activeWorkflowRunId: activeRun.id,
          activeWorkflowRunStatus: activeRun.status,
          activeWorkflowRunUpdatedAt: activeRun.updatedAt,
          message: reconnectMessage,
          verification: activeRun.verification,
        },
        item: {
          taskId: task.id,
          title: task.title,
          status: "reconnected",
          message: activeRun.resumePlan?.message ?? activeRun.message,
          workflowRunId: activeRun.id,
          ...(activeRun.approvalId ? { approvalId: activeRun.approvalId } : {}),
          reason: "active_workflow_run",
        },
        run: activeRun,
      };
    }
    if (activeRun.status === "blocked") {
      return {
        task: {
          ...task,
          status: "blocked",
          updatedAt: now,
          activeWorkflowRunId: activeRun.id,
          activeWorkflowRunStatus: activeRun.status,
          activeWorkflowRunUpdatedAt: activeRun.updatedAt,
          message: "Scheduled monitor is blocked by its active workflow run.",
          verification: activeRun.verification,
        },
        item: {
          taskId: task.id,
          title: task.title,
          status: "blocked",
          message: activeRun.message,
          workflowRunId: activeRun.id,
          reason: "active_workflow_blocked",
        },
        run: activeRun,
      };
    }
  }

  const dispatchTask =
    task.activeWorkflowRunId && (!activeRun || activeRun.status === "complete")
      ? clearActiveWorkflowRun(task, now)
      : task;

  if (!dispatchTask.workflowTemplateId) {
    return {
      task: {
        ...dispatchTask,
        updatedAt: now,
        nextRunAt: getNextScheduledRunAt(now, dispatchTask.cadence),
        message: "Scheduled task was due but has no workflow template to dispatch.",
      },
      item: {
        taskId: dispatchTask.id,
        title: dispatchTask.title,
        status: "skipped",
        message: "No workflow template is bound to this scheduled task.",
        nextRunAt: getNextScheduledRunAt(now, dispatchTask.cadence),
        reason: "missing_workflow_template",
      },
    };
  }

  const prepared = await runtime.prepareWorkflowRun({
    templateId: dispatchTask.workflowTemplateId,
    ...(dispatchTask.workspacePath ? { workspacePath: dispatchTask.workspacePath } : {}),
  });
  if (prepared.blocked || prepared.recipe.status === "blocked") {
    return {
      task: {
        ...dispatchTask,
        status: "blocked",
        updatedAt: now,
        message: prepared.reason,
        verification: prepared.recipe.verification,
      },
      item: {
        taskId: dispatchTask.id,
        title: dispatchTask.title,
        status: "blocked",
        message: prepared.reason,
        reason: prepared.reason,
      },
    };
  }

  const started = await runtime.startWorkflowRun({
    recipe: prepared.recipe,
  });
  const nextRunAt = getNextScheduledRunAt(now, dispatchTask.cadence);
  const status =
    started.run.status === "waiting_approval" ? "queued_approval" : "started";
  return {
    task: {
      ...dispatchTask,
      updatedAt: now,
      lastRunAt: now,
      ...(nextRunAt ? { nextRunAt } : { nextRunAt: undefined }),
      activeWorkflowRunId: started.run.id,
      activeWorkflowRunStatus: started.run.status,
      activeWorkflowRunUpdatedAt: started.run.updatedAt,
      message:
        status === "queued_approval"
          ? "Scheduled task queued a workflow run that is waiting in Approval Center."
          : "Scheduled task started an approval-gated workflow run.",
      verification: started.run.verification,
    },
    item: {
      taskId: dispatchTask.id,
      title: dispatchTask.title,
      status,
      message: started.run.message,
      ...(nextRunAt ? { nextRunAt } : {}),
      workflowRunId: started.run.id,
      ...(started.run.approvalId ? { approvalId: started.run.approvalId } : {}),
    },
    run: started.run,
  };
}

async function getActiveWorkflowRun(
  task: DesktopScheduledTask,
  runtime: ScheduledTaskRuntime,
): Promise<DesktopWorkflowRun | null> {
  if (!task.activeWorkflowRunId || !runtime.listWorkflowRuns) return null;
  const runs = await runtime.listWorkflowRuns(task.workspacePath);
  return runs.find((run) => run.id === task.activeWorkflowRunId) ?? null;
}

function getActiveWorkflowRunReconnectMessage(
  run: DesktopWorkflowRun,
): string {
  if (run.resumePlan) {
    return run.resumePlan.resumableStepIds.length > 0
      ? "Scheduled monitor reconnected to a restart-recovered workflow run with resumable steps."
      : "Scheduled monitor reconnected to a restart-recovered workflow run waiting in Approval Center.";
  }
  return run.status === "waiting_approval"
    ? "Scheduled monitor reconnected to an in-flight workflow run waiting in Approval Center."
    : "Scheduled monitor reconnected to an in-flight workflow run.";
}

function clearActiveWorkflowRun(
  task: DesktopScheduledTask,
  now: string,
): DesktopScheduledTask {
  const {
    activeWorkflowRunId: _activeWorkflowRunId,
    activeWorkflowRunStatus: _activeWorkflowRunStatus,
    activeWorkflowRunUpdatedAt: _activeWorkflowRunUpdatedAt,
    ...rest
  } = task;
  return {
    ...rest,
    updatedAt: now,
    message:
      "Scheduled monitor cleared its completed or missing workflow link before the next dispatch.",
  };
}

async function readScheduledTaskStore(): Promise<ScheduledTaskStore> {
  try {
    const parsed = JSON.parse(await readFile(SCHEDULED_TASKS_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object") return { workspaces: {} };
    const rawWorkspaces = (parsed as ScheduledTaskStore).workspaces;
    if (!rawWorkspaces || typeof rawWorkspaces !== "object") {
      return { workspaces: {} };
    }
    const workspaces: ScheduledTaskStore["workspaces"] = {};
    for (const [key, tasks] of Object.entries(rawWorkspaces)) {
      if (!Array.isArray(tasks)) continue;
      const validTasks = tasks
        .filter(isScheduledTask)
        .sort(compareScheduledTasks)
        .slice(0, MAX_SCHEDULED_TASKS_PER_WORKSPACE)
        .map(cloneScheduledTask);
      if (validTasks.length) workspaces[key] = validTasks;
    }
    return { workspaces };
  } catch {
    return { workspaces: {} };
  }
}

async function writeScheduledTaskStore(store: ScheduledTaskStore): Promise<void> {
  await mkdir(dirname(SCHEDULED_TASKS_FILE), { recursive: true });
  await writeFile(SCHEDULED_TASKS_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function normalizeListRequest(request: unknown): DesktopScheduledTaskListRequest {
  if (!request || typeof request !== "object") return {};
  const typed = request as DesktopScheduledTaskListRequest;
  return {
    ...(typeof typed.workspacePath === "string" && typed.workspacePath.trim()
      ? { workspacePath: typed.workspacePath.trim() }
      : {}),
    ...(typeof typed.limit === "number" ? { limit: typed.limit } : {}),
  };
}

function normalizeCreateRequest(
  request: unknown,
): DesktopScheduledTaskCreateRequest {
  if (!request || typeof request !== "object") {
    throw new Error("Scheduled task create request is required.");
  }
  const typed = request as DesktopScheduledTaskCreateRequest;
  assertScheduledTaskKind(typed.kind);
  assertScheduledTaskCadence(typed.cadence);
  if (typed.status !== undefined) assertScheduledTaskStatus(typed.status);
  return {
    kind: typed.kind,
    title: normalizeRequiredText(typed.title, "Scheduled task title is required."),
    cadence: typed.cadence,
    target: normalizeRequiredText(typed.target, "Scheduled task target is required."),
    ...(typeof typed.workspacePath === "string" && typed.workspacePath.trim()
      ? { workspacePath: typed.workspacePath.trim() }
      : {}),
    ...(typeof typed.workflowTemplateId === "string" && typed.workflowTemplateId.trim()
      ? { workflowTemplateId: typed.workflowTemplateId.trim() }
      : {}),
    ...(typeof typed.nextRunAt === "string" && typed.nextRunAt.trim()
      ? { nextRunAt: typed.nextRunAt.trim() }
      : {}),
    ...(typeof typed.approvalRequired === "boolean"
      ? { approvalRequired: typed.approvalRequired }
      : {}),
    ...(typeof typed.verification === "string"
      ? { verification: typed.verification }
      : {}),
    ...(typeof typed.message === "string" ? { message: typed.message } : {}),
    ...(typed.status ? { status: typed.status } : {}),
  };
}

function normalizeUpdateRequest(
  request: unknown,
): DesktopScheduledTaskUpdateRequest {
  if (!request || typeof request !== "object") {
    throw new Error("Scheduled task update request is required.");
  }
  const typed = request as DesktopScheduledTaskUpdateRequest;
  assertScheduledTaskStatus(typed.status);
  return {
    taskId: normalizeRequiredText(typed.taskId, "Scheduled task id is required."),
    status: typed.status,
    ...(typed.nextRunAt !== undefined && typeof typed.nextRunAt === "string"
      ? { nextRunAt: typed.nextRunAt }
      : {}),
    ...(typeof typed.message === "string" ? { message: typed.message } : {}),
    ...(typeof typed.verification === "string"
      ? { verification: typed.verification }
      : {}),
  };
}

function normalizeRunRequest(request: unknown): DesktopScheduledTaskRunRequest {
  if (!request || typeof request !== "object") return {};
  const typed = request as DesktopScheduledTaskRunRequest;
  return {
    ...(typeof typed.workspacePath === "string" && typed.workspacePath.trim()
      ? { workspacePath: typed.workspacePath.trim() }
      : {}),
    ...(typeof typed.now === "string" && typed.now.trim()
      ? { now: typed.now.trim() }
      : {}),
    ...(typeof typed.limit === "number" ? { limit: typed.limit } : {}),
  };
}

function findScheduledTaskLocation(
  store: ScheduledTaskStore,
  taskId: string,
): { key: string; taskIndex: number } | null {
  for (const [key, tasks] of Object.entries(store.workspaces)) {
    const taskIndex = tasks.findIndex((task) => task.id === taskId);
    if (taskIndex >= 0) return { key, taskIndex };
  }
  return null;
}

function isScheduledTask(value: unknown): value is DesktopScheduledTask {
  const task = value as DesktopScheduledTask;
  return Boolean(
    task &&
      typeof task.id === "string" &&
      task.id.startsWith("scheduled-task:") &&
      isScheduledTaskKind(task.kind) &&
      typeof task.title === "string" &&
      isScheduledTaskStatus(task.status) &&
      isScheduledTaskCadence(task.cadence) &&
      typeof task.createdAt === "string" &&
      typeof task.updatedAt === "string" &&
      typeof task.target === "string" &&
      typeof task.approvalRequired === "boolean" &&
      typeof task.message === "string" &&
      typeof task.verification === "string",
  );
}

function assertScheduledTask(task: DesktopScheduledTask): void {
  if (!isScheduledTask(task)) {
    throw new Error("Scheduled task is invalid.");
  }
}

function assertScheduledTaskKind(
  kind: unknown,
): asserts kind is DesktopScheduledTaskKind {
  if (!isScheduledTaskKind(kind)) {
    throw new Error("Scheduled task kind is invalid.");
  }
}

function assertScheduledTaskStatus(
  status: unknown,
): asserts status is DesktopScheduledTaskStatus {
  if (!isScheduledTaskStatus(status)) {
    throw new Error("Scheduled task status is invalid.");
  }
}

function assertScheduledTaskCadence(
  cadence: unknown,
): asserts cadence is DesktopScheduledTaskCadence {
  if (!isScheduledTaskCadence(cadence)) {
    throw new Error("Scheduled task cadence is invalid.");
  }
}

function isScheduledTaskKind(value: unknown): value is DesktopScheduledTaskKind {
  return value === "scheduled" || value === "monitor";
}

function isScheduledTaskStatus(
  value: unknown,
): value is DesktopScheduledTaskStatus {
  return value === "enabled" || value === "paused" || value === "blocked";
}

function isScheduledTaskCadence(
  value: unknown,
): value is DesktopScheduledTaskCadence {
  return (
    value === "manual" ||
    value === "hourly" ||
    value === "daily" ||
    value === "weekly"
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
  return Math.max(1, Math.min(Math.floor(limit), MAX_SCHEDULED_TASKS_PER_WORKSPACE));
}

function normalizeWorkerIntervalMs(intervalMs: unknown): number {
  if (typeof intervalMs !== "number" || !Number.isFinite(intervalMs)) {
    return 5 * 60 * 1000;
  }
  return Math.max(60 * 1000, Math.min(Math.floor(intervalMs), 24 * 60 * 60 * 1000));
}

function normalizeWorkerInitialDelayMs(initialDelayMs: unknown): number {
  if (typeof initialDelayMs !== "number" || !Number.isFinite(initialDelayMs)) {
    return 15 * 1000;
  }
  return Math.max(0, Math.min(Math.floor(initialDelayMs), 5 * 60 * 1000));
}

function isTaskDue(task: DesktopScheduledTask, now: Date): boolean {
  if (task.status !== "enabled") return false;
  if (task.cadence === "manual") return false;
  if (!task.nextRunAt) return false;
  const nextRunAt = new Date(task.nextRunAt);
  return !Number.isNaN(nextRunAt.getTime()) && nextRunAt.getTime() <= now.getTime();
}

function getNextScheduledRunAt(
  fromIso: string,
  cadence: DesktopScheduledTaskCadence,
): string | undefined {
  if (cadence === "manual") return undefined;
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return undefined;
  const next = new Date(from.getTime());
  if (cadence === "hourly") next.setHours(next.getHours() + 1);
  if (cadence === "daily") next.setDate(next.getDate() + 1);
  if (cadence === "weekly") next.setDate(next.getDate() + 7);
  return next.toISOString();
}

function cloneScheduledTask(task: DesktopScheduledTask): DesktopScheduledTask {
  return { ...task };
}

function compareScheduledTasks(
  left: DesktopScheduledTask,
  right: DesktopScheduledTask,
): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function createScheduledTaskId(kind: string, createdAt: string): string {
  return `scheduled-task:${kind}:${Date.parse(createdAt).toString(36)}:${randomUUID()}`;
}

function workspaceKey(workspacePath?: string): string {
  if (!workspacePath) return GLOBAL_SCHEDULED_TASK_KEY;
  return createHash("sha256")
    .update(workspacePath.trim().toLowerCase())
    .digest("hex");
}
