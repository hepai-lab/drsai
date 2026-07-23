import { createHash, randomUUID } from "crypto";
import { join } from "path";
import type {
  DesktopScheduledTask,
  DesktopScheduledTaskCadence,
  DesktopScheduledTaskCreateRequest,
  DesktopScheduledTaskDeleteRequest,
  DesktopScheduledTaskDeleteResult,
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
import {
  createScheduledTriggerAudit,
  DEFAULT_MISSED_RUN_POLICY,
  getNextRunAfterTrigger,
} from "../../../shared/main/scheduleTiming";
import { redactDesktopSecrets } from "../../../shared/main/secretRedaction";
import { readDurableJson, writeDurableJson } from "../../../shared/main/durableJsonStore";

const SCHEDULED_TASKS_FILE = join(DRSAI_HOME, "desktop", "scheduled-tasks.json");
const MAX_SCHEDULED_TASK_STORE_BYTES = 16 * 1024 * 1024;
const MAX_SCHEDULED_TASKS_PER_WORKSPACE = 100;
const GLOBAL_SCHEDULED_TASK_KEY = "__global__";
let scheduledTaskRunQueue: Promise<void> = Promise.resolve();

interface ScheduledTaskStore {
  workspaces: Record<string, DesktopScheduledTask[]>;
}

interface ScheduledTaskRuntime {
  prepareWorkflowRun(
    request: DesktopWorkflowRunPrepareRequest & { triggerKey: string },
  ): Promise<DesktopWorkflowRunPrepareResult>;
  startWorkflowRun(
    request: DesktopWorkflowRunStartRequest & { idempotencyKey: string },
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
    missedRunPolicy: DEFAULT_MISSED_RUN_POLICY,
    message:
      normalizeOptionalText(typed.message) ??
      "Scheduled task is configured for approval-gated trigger execution.",
    verification:
      normalizeOptionalText(typed.verification) ??
      "Verify persisted schedule state and due trigger results in the Skills Square scheduler panel.",
    ...(typed.userDefinition
      ? { userDefinition: normalizeUserDefinition(typed.userDefinition) }
      : {}),
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
    title: typed.title ?? current.title,
    cadence: typed.cadence ?? current.cadence,
    target: typed.target ?? current.target,
    updatedAt: now,
    ...(typed.nextRunAt !== undefined
      ? normalizeOptionalText(typed.nextRunAt)
        ? { nextRunAt: typed.nextRunAt.trim() }
        : { nextRunAt: undefined }
      : {}),
    message: normalizeOptionalText(typed.message) ?? current.message,
    verification: normalizeOptionalText(typed.verification) ?? current.verification,
    ...(typed.userDefinition
      ? { userDefinition: normalizeUserDefinition(typed.userDefinition) }
      : {}),
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
  const previous = scheduledTaskRunQueue;
  let releaseQueue!: () => void;
  scheduledTaskRunQueue = new Promise<void>((resolve) => { releaseQueue = resolve; });
  await previous;
  try {
    return await runDueScheduledTasksUnlocked(request, runtime);
  } finally {
    releaseQueue();
  }
}

export async function deleteScheduledTask(
  request: unknown,
): Promise<DesktopScheduledTaskDeleteResult> {
  const typed = normalizeDeleteRequest(request);
  const store = await readScheduledTaskStore();
  const location = findScheduledTaskLocation(store, typed.taskId);
  if (!location) {
    return {
      taskId: typed.taskId,
      removed: false,
      historyPolicy: "retain_results",
      message: "Scheduled task was already absent. Historical results remain available.",
    };
  }
  const { key, taskIndex } = location;
  const [removed] = store.workspaces[key].splice(taskIndex, 1);
  if (store.workspaces[key].length === 0) delete store.workspaces[key];
  await writeScheduledTaskStore(store);
  return {
    taskId: typed.taskId,
    removed: true,
    historyPolicy: "retain_results",
    ...(removed.activeWorkflowRunId
      ? { retainedWorkflowRunId: removed.activeWorkflowRunId }
      : {}),
    message: "Future runs were deleted. Historical results remain available.",
  };
}

async function runDueScheduledTasksUnlocked(
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
      try {
        const result = await runSingleScheduledTask(task, generatedAt, runtime);
        items.push(result.item);
        if (result.run) runs.push(result.run);
        if (taskIndex >= 0) tasks[taskIndex] = result.task;
      } catch (error) {
        const triggerAudit = createScheduledTriggerAudit(task, generatedAt);
        const message = redactDesktopSecrets(error instanceof Error ? error.message : "Scheduled Workflow trigger failed.").slice(0, 1000);
        if (taskIndex >= 0) tasks[taskIndex] = { ...task, updatedAt: generatedAt, lastTriggerAudit: triggerAudit, message: `Scheduled Workflow trigger failed and remains due for retry: ${message}` };
        items.push({ taskId: task.id, title: task.title, status: "failed", message, reason: "workflow_trigger_failed", triggerAudit });
      }
      await writeScheduledTaskStore(store);
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
    failed: items.filter((item) => item.status === "failed").length,
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
        for (const run of result.runs) {
          await runtime.onWorkflowRun(run);
        }
      }
      lastResult = {
        generatedAt: result.generatedAt,
        checked: result.checked,
        triggered: result.triggered,
        reconnected: result.reconnected,
        skipped: result.skipped,
        failed: result.failed,
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
  const triggerAudit = createScheduledTriggerAudit(task, now);
  const nextRunAfterTrigger = getNextRunAfterTrigger(task, now);
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
          lastTriggerAudit: triggerAudit,
          ...(nextRunAfterTrigger ? { nextRunAt: nextRunAfterTrigger } : { nextRunAt: undefined }),
        },
        item: {
          taskId: task.id,
          title: task.title,
          status: "reconnected",
          message: activeRun.resumePlan?.message ?? activeRun.message,
          workflowRunId: activeRun.id,
          ...(activeRun.approvalId ? { approvalId: activeRun.approvalId } : {}),
          reason: "active_workflow_run",
          triggerAudit,
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
          lastTriggerAudit: triggerAudit,
          ...(nextRunAfterTrigger ? { nextRunAt: nextRunAfterTrigger } : { nextRunAt: undefined }),
        },
        item: {
          taskId: task.id,
          title: task.title,
          status: "blocked",
          message: activeRun.message,
          workflowRunId: activeRun.id,
          reason: "active_workflow_blocked",
          triggerAudit,
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
        nextRunAt: nextRunAfterTrigger,
        message: "Scheduled task was due but has no workflow template to dispatch.",
        lastTriggerAudit: triggerAudit,
      },
      item: {
        taskId: dispatchTask.id,
        title: dispatchTask.title,
        status: "skipped",
        message: "No workflow template is bound to this scheduled task.",
        nextRunAt: nextRunAfterTrigger,
        reason: "missing_workflow_template",
        triggerAudit,
      },
    };
  }

  const prepared = await runtime.prepareWorkflowRun({
    templateId: dispatchTask.workflowTemplateId,
    ...(dispatchTask.workspacePath ? { workspacePath: dispatchTask.workspacePath } : {}),
    triggerKey: triggerAudit.triggerKey,
  });
  prepared.recipe.id = scheduledRecipeId(dispatchTask.workflowTemplateId, triggerAudit.triggerKey);
  if (prepared.blocked || prepared.recipe.status === "blocked") {
    return {
      task: {
        ...dispatchTask,
        status: "blocked",
        updatedAt: now,
        message: prepared.reason,
        verification: prepared.recipe.verification,
        lastTriggerAudit: triggerAudit,
        ...(nextRunAfterTrigger ? { nextRunAt: nextRunAfterTrigger } : { nextRunAt: undefined }),
      },
      item: {
        taskId: dispatchTask.id,
        title: dispatchTask.title,
        status: "blocked",
        message: prepared.reason,
        reason: prepared.reason,
        triggerAudit,
      },
    };
  }

  if (prepared.queued || prepared.recipe.status === "approval_queued") {
    return {
      task: { ...dispatchTask, updatedAt: now, message: "Waiting for Workflow approval; scheduled time is retained.", verification: prepared.recipe.verification, lastTriggerAudit: triggerAudit },
      item: { taskId: dispatchTask.id, title: dispatchTask.title, status: "queued_approval", message: prepared.reason, ...(prepared.recipe.approvalId ? { approvalId: prepared.recipe.approvalId } : {}), triggerAudit },
    };
  }

  const started = await runtime.startWorkflowRun({
    recipe: prepared.recipe,
    idempotencyKey: triggerAudit.triggerKey,
  });
  const nextRunAt = nextRunAfterTrigger;
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
      lastTriggerAudit: triggerAudit,
    },
    item: {
      taskId: dispatchTask.id,
      title: dispatchTask.title,
      status,
      message: started.run.message,
      ...(nextRunAt ? { nextRunAt } : {}),
      workflowRunId: started.run.id,
      ...(started.run.approvalId ? { approvalId: started.run.approvalId } : {}),
      triggerAudit,
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
  return (await readDurableJson(SCHEDULED_TASKS_FILE, decodeScheduledTaskStore, { maxBytes: MAX_SCHEDULED_TASK_STORE_BYTES }))?.value ?? { workspaces: {} };
}

function decodeScheduledTaskStore(parsed: unknown): ScheduledTaskStore {
    if (!parsed || typeof parsed !== "object") throw new Error("Scheduled task store schema is invalid.");
    const rawWorkspaces = (parsed as ScheduledTaskStore).workspaces;
    if (!rawWorkspaces || typeof rawWorkspaces !== "object" || Array.isArray(rawWorkspaces)) throw new Error("Scheduled task store schema is invalid.");
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
}

async function writeScheduledTaskStore(store: ScheduledTaskStore): Promise<void> {
  await writeDurableJson(SCHEDULED_TASKS_FILE, store, { maxBytes: MAX_SCHEDULED_TASK_STORE_BYTES });
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
    ...(typed.userDefinition
      ? { userDefinition: normalizeUserDefinition(typed.userDefinition) }
      : {}),
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
    ...(typeof typed.title === "string"
      ? { title: normalizeRequiredText(typed.title, "Scheduled task title is required.") }
      : {}),
    ...(typed.cadence !== undefined
      ? (assertScheduledTaskCadence(typed.cadence), { cadence: typed.cadence })
      : {}),
    ...(typeof typed.target === "string"
      ? { target: normalizeRequiredText(typed.target, "Scheduled task target is required.") }
      : {}),
    ...(typed.userDefinition
      ? { userDefinition: normalizeUserDefinition(typed.userDefinition) }
      : {}),
  };
}

function normalizeDeleteRequest(
  request: unknown,
): DesktopScheduledTaskDeleteRequest {
  if (!request || typeof request !== "object") {
    throw new Error("Scheduled task delete request is required.");
  }
  const typed = request as DesktopScheduledTaskDeleteRequest;
  return {
    taskId: normalizeRequiredText(typed.taskId, "Scheduled task id is required."),
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
      typeof task.verification === "string" &&
      (!task.userDefinition || isUserDefinition(task.userDefinition)) &&
      (!task.missedRunPolicy || task.missedRunPolicy === DEFAULT_MISSED_RUN_POLICY) &&
      (!task.lastTriggerAudit || isTriggerAudit(task.lastTriggerAudit)),
  );
}

function isTriggerAudit(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const audit = value as NonNullable<DesktopScheduledTask["lastTriggerAudit"]>;
  return (
    typeof audit.triggerKey === "string" && audit.triggerKey.length === 64 &&
    typeof audit.scheduledFor === "string" &&
    typeof audit.triggeredAt === "string" &&
    typeof audit.missed === "boolean" &&
    typeof audit.missedByMs === "number" && audit.missedByMs >= 0 &&
    audit.missedRunPolicy === DEFAULT_MISSED_RUN_POLICY &&
    typeof audit.timezone === "string" &&
    audit.daylightSavingPolicy === "follow_timezone_wall_clock"
  );
}

function isUserDefinition(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const definition = value as NonNullable<DesktopScheduledTask["userDefinition"]>;
  return (
    typeof definition.sourceText === "string" &&
    typeof definition.timeDescription === "string" &&
    typeof definition.materialDescription === "string" &&
    typeof definition.actionDescription === "string" &&
    typeof definition.notificationDescription === "string" &&
    typeof definition.timezone === "string" &&
    typeof definition.confirmedAt === "string" &&
    (definition.weekday === undefined ||
      (Number.isInteger(definition.weekday) && definition.weekday >= 0 && definition.weekday <= 6)) &&
    (definition.localTime === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(definition.localTime))
  );
}

function normalizeUserDefinition(
  value: NonNullable<DesktopScheduledTask["userDefinition"]>,
): NonNullable<DesktopScheduledTask["userDefinition"]> {
  if (!isUserDefinition(value)) {
    throw new Error("Scheduled task user definition is invalid.");
  }
  return {
    sourceText: normalizeRequiredText(value.sourceText, "Schedule source text is required."),
    timeDescription: normalizeRequiredText(value.timeDescription, "Schedule time is required."),
    materialDescription: normalizeRequiredText(value.materialDescription, "Schedule material is required."),
    actionDescription: normalizeRequiredText(value.actionDescription, "Schedule action is required."),
    notificationDescription: normalizeRequiredText(
      value.notificationDescription,
      "Schedule notification is required.",
    ),
    timezone: normalizeRequiredText(value.timezone, "Schedule timezone is required."),
    ...(value.weekday !== undefined ? { weekday: value.weekday } : {}),
    ...(value.localTime ? { localTime: value.localTime } : {}),
    confirmedAt: normalizeRequiredText(value.confirmedAt, "Schedule confirmation time is required."),
  };
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
  return {
    ...task,
    ...(task.userDefinition ? { userDefinition: { ...task.userDefinition } } : {}),
    ...(task.lastTriggerAudit ? { lastTriggerAudit: { ...task.lastTriggerAudit } } : {}),
  };
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

function scheduledRecipeId(templateId: string, triggerKey: string): string {
  const hex = triggerKey.slice(0, 32);
  return `workflow:${templateId}:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function workspaceKey(workspacePath?: string): string {
  if (!workspacePath) return GLOBAL_SCHEDULED_TASK_KEY;
  return createHash("sha256")
    .update(workspacePath.trim().toLowerCase())
    .digest("hex");
}
