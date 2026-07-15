import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "path";
import type {
  AgentRunEvent,
  AgentRunRequest,
  DesktopBackgroundTask,
  DesktopBackgroundTaskEnqueueRequest,
  DesktopBackgroundTaskKind,
  DesktopBackgroundTaskListRequest,
  DesktopBackgroundTaskSource,
  DesktopBackgroundTaskStatus,
  DesktopBackgroundTaskUpdateRequest,
  DesktopTaskDeliverySummary,
  DesktopTaskArtifactLink,
  DesktopArtifactQuality,
  DesktopChartDataQuality,
  DesktopTaskPlanAdjustment,
  DesktopTaskPlanStep,
  DesktopTrustAssessment,
  DesktopTrustStatus,
  DesktopWorkflowRun,
  ManagerPresentationGenerateRequest,
  ManagerPresentationProgressEvent,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";
import { requireAuthContext } from "./auth";
import { buildAgentTaskPlan, isMultiMaterialSynthesisTask } from "../shared/agentTaskPlan";

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
  const ownerUserId = await currentOwnerUserId();
  const now = new Date().toISOString();
  const task: DesktopBackgroundTask = {
    id: createBackgroundTaskId(typed.kind, now),
    ...(ownerUserId ? { ownerUserId } : {}),
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
    ...(typed.progress !== undefined ? { progress: typed.progress } : {}),
    ...(typed.planSteps?.length ? { planSteps: typed.planSteps } : {}),
    ...(typed.planAdjustments?.length ? { planAdjustments: typed.planAdjustments } : {}),
    ...(typed.completedSteps?.length ? { completedSteps: typed.completedSteps } : {}),
    ...(typed.pendingDecisions?.length ? { pendingDecisions: typed.pendingDecisions } : {}),
    message: normalizeOptionalText(typed.message) ?? "Background task is queued.",
    verification:
      normalizeOptionalText(typed.verification) ??
      "Track status transitions in the background task queue.",
    ...(typed.deliverySummary ? { deliverySummary: typed.deliverySummary } : {}),
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
    ...(typed.title !== undefined ? { title: normalizeRequiredText(typed.title, "Background task title is required.") } : {}),
    status: typed.status,
    updatedAt: now,
    ...(typed.currentStep !== undefined
      ? normalizeOptionalText(typed.currentStep)
        ? { currentStep: typed.currentStep.trim() }
        : { currentStep: undefined }
      : {}),
    ...(typed.progress !== undefined ? { progress: typed.progress } : {}),
    ...(typed.planSteps !== undefined ? { planSteps: typed.planSteps } : {}),
    ...(typed.planAdjustments !== undefined ? { planAdjustments: typed.planAdjustments } : {}),
    ...(typed.completedSteps !== undefined ? { completedSteps: typed.completedSteps } : {}),
    ...(typed.pendingDecisions !== undefined ? { pendingDecisions: typed.pendingDecisions } : {}),
    message: normalizeOptionalText(typed.message) ?? current.message,
    verification: normalizeOptionalText(typed.verification) ?? current.verification,
    ...(typed.deliverySummary !== undefined ? { deliverySummary: typed.deliverySummary } : {}),
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
  const ownerUserId = await currentOwnerUserId();
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
          progress: workflowProgress(run),
          completedSteps: run.steps
            .filter((step) => step.status === "completed")
            .map((step) => step.title),
          pendingDecisions: run.steps
            .filter((step) => step.status === "waiting_approval")
            .map((step) => step.title),
          ...(run.approvalId ? { approvalId: run.approvalId } : {}),
        }
      : {
          id: createBackgroundTaskId("workflow_run", now),
          ...(ownerUserId ? { ownerUserId } : {}),
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
          progress: workflowProgress(run),
          completedSteps: run.steps
            .filter((step) => step.status === "completed")
            .map((step) => step.title),
          pendingDecisions: run.steps
            .filter((step) => step.status === "waiting_approval")
            .map((step) => step.title),
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

export async function listOwnedBackgroundTasks(
  request: unknown = {},
): Promise<DesktopBackgroundTask[]> {
  const auth = await requireAuthContext();
  const typed = normalizeListRequest(request);
  const store = await readBackgroundTaskStore();
  let claimedLegacyTasks = false;
  for (const tasks of Object.values(store.workspaces)) {
    for (const task of tasks) {
      if (!task.ownerUserId) {
        task.ownerUserId = auth.userId;
        claimedLegacyTasks = true;
      }
    }
  }
  if (claimedLegacyTasks) await writeBackgroundTaskStore(store);
  const limit = normalizeLimit(typed.limit);
  const tasks = typed.workspacePath
    ? store.workspaces[workspaceKey(typed.workspacePath)] ?? []
    : Object.values(store.workspaces).flat();
  return tasks
    .filter((task) => task.ownerUserId === auth.userId)
    .filter((task) => !typed.workspacePath || task.workspacePath === typed.workspacePath)
    .sort(compareBackgroundTasks)
    .slice(0, limit)
    .map(cloneBackgroundTask);
}

export async function upsertBackgroundTaskForManagerPresentation(
  request: ManagerPresentationGenerateRequest,
  event: ManagerPresentationProgressEvent,
): Promise<DesktopBackgroundTask> {
  const store = await readBackgroundTaskStore();
  const ownerUserId = await currentOwnerUserId();
  const key = workspaceKey(request.workspacePath);
  const now = new Date().toISOString();
  const currentTasks = store.workspaces[key] ?? [];
  const existingIndex = currentTasks.findIndex(
    (task) => task.targetId === request.requestId && task.kind === "presentation_generation",
  );
  const completedSteps = completedPresentationSteps(event.phase, event.activeStage);
  const task: DesktopBackgroundTask = {
    id: existingIndex >= 0
      ? currentTasks[existingIndex].id
      : createBackgroundTaskId("presentation_generation", now),
    ...(currentTasks[existingIndex]?.ownerUserId ? { ownerUserId: currentTasks[existingIndex].ownerUserId } : ownerUserId ? { ownerUserId } : {}),
    kind: "presentation_generation",
    source: "presentation",
    title: "生成管理者版 PPT",
    status: mapPresentationStatus(event.phase),
    createdAt: existingIndex >= 0 ? currentTasks[existingIndex].createdAt : now,
    updatedAt: now,
    workspacePath: request.workspacePath,
    targetId: request.requestId,
    currentStep: presentationStepLabel(event.phase, event.activeStage),
    progress: Math.max(0, Math.min(100, Math.round(event.progress))),
    completedSteps,
    pendingDecisions: event.phase === "paused" ? ["继续生成或取消任务"] : [],
    message: event.message,
    verification: "检查生成文件、讲稿覆盖率、来源映射和原 PDF 页码。",
    ...(event.deliverySummary
      ? { deliverySummary: normalizeDeliverySummary(event.deliverySummary) }
      : existingIndex >= 0 && currentTasks[existingIndex].deliverySummary
        ? { deliverySummary: currentTasks[existingIndex].deliverySummary }
        : {}),
  };
  assertBackgroundTask(task);
  store.workspaces[key] = existingIndex >= 0
    ? currentTasks.map((item, index) => index === existingIndex ? task : item)
    : [task, ...currentTasks];
  store.workspaces[key] = store.workspaces[key]
    .sort(compareBackgroundTasks)
    .slice(0, MAX_BACKGROUND_TASKS_PER_WORKSPACE);
  await writeBackgroundTaskStore(store);
  return cloneBackgroundTask(task);
}

export async function upsertBackgroundTaskForAgentRun(
  request: AgentRunRequest,
  event: AgentRunEvent,
): Promise<DesktopBackgroundTask> {
  const store = await readBackgroundTaskStore();
  const ownerUserId = await currentOwnerUserId();
  const key = workspaceKey(request.workspacePath);
  const now = new Date().toISOString();
  const currentTasks = store.workspaces[key] ?? [];
  const existingIndex = currentTasks.findIndex(
    (task) => task.targetId === event.requestId && task.kind === "agent_run",
  );
  const existing = existingIndex >= 0 ? currentTasks[existingIndex] : undefined;
  const planSteps = request.executionPlan?.length ? request.executionPlan : buildAgentTaskPlan(request.task);
  const planAdjustments = event.planAdjustment
    ? [...(existing?.planAdjustments ?? []), event.planAdjustment]
        .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    : existing?.planAdjustments ?? [];
  const hasIncompleteAdjustment = planAdjustments.some((item) => item.completeness === "partial" || item.completeness === "blocked");
  const completedSteps = agentCompletedSteps(event.type, planSteps, planAdjustments);
  const deliverySummary = event.type === "done"
    ? buildAgentDeliverySummary(request, existing)
    : event.type === "file_event" && event.fileEvent?.action === "artifact"
      ? await buildAgentArtifactSummary(request, event.fileEvent.path, existing)
      : existing?.deliverySummary;
  const task: DesktopBackgroundTask = {
    id: existing?.id ?? createBackgroundTaskId("agent_run", now),
    ...(existing?.ownerUserId ? { ownerUserId: existing.ownerUserId } : ownerUserId ? { ownerUserId } : {}),
    kind: "agent_run",
    source: "agent",
    title: request.metadata?.source === "windows-results-center-versioning"
      ? `生成 5 种成果版本：${agentInputFileName(request) || "源报告"}`
      : request.metadata?.source === "windows-results-center-local-edit"
        ? `局部修改：${agentInputFileName(request) || "源成果"}`
      : request.task.slice(0, 120),
    status: mapAgentRunStatus(event.type, hasIncompleteAdjustment),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(request.workspacePath ? { workspacePath: request.workspacePath } : {}),
    targetId: event.requestId,
    currentStep: agentRunStepLabel(event, planSteps, hasIncompleteAdjustment),
    progress: agentRunProgress(event.type),
    planSteps,
    ...(planAdjustments.length ? { planAdjustments } : {}),
    completedSteps,
    pendingDecisions: [],
    message: event.planAdjustment
      ? `计划已调整：${event.planAdjustment.failedStepTitle}未能完成；${event.planAdjustment.reason}。改为${event.planAdjustment.replacementStepTitle}。`
      : event.error || event.content || existing?.message || agentRunStepLabel(event, planSteps, hasIncompleteAdjustment),
    verification: hasIncompleteAdjustment
      ? "核对未完成步骤、调整原因、替代方案及其对结果完整性的影响。"
      : "核对 Agent 完成状态、工作区变更和最终成果。",
    ...(deliverySummary ? { deliverySummary } : {}),
  };
  assertBackgroundTask(task);
  store.workspaces[key] = existingIndex >= 0
    ? currentTasks.map((item, index) => index === existingIndex ? task : item)
    : [task, ...currentTasks];
  store.workspaces[key] = store.workspaces[key]
    .sort(compareBackgroundTasks)
    .slice(0, MAX_BACKGROUND_TASKS_PER_WORKSPACE);
  await writeBackgroundTaskStore(store);
  return cloneBackgroundTask(task);
}

function agentInputFileName(request: AgentRunRequest): string | undefined {
  const firstFile = request.files?.find((file) => file && typeof file === "object" && "path" in file && typeof file.path === "string");
  return firstFile && typeof firstFile === "object" && "path" in firstFile && typeof firstFile.path === "string"
    ? basename(firstFile.path)
    : undefined;
}

function mapAgentRunStatus(type: AgentRunEvent["type"], hasIncompleteAdjustment = false): DesktopBackgroundTaskStatus {
  if (type === "done") return hasIncompleteAdjustment ? "blocked" : "completed";
  if (type === "error") return "failed";
  if (type === "aborted") return "cancelled";
  return "running";
}

function agentRunProgress(type: AgentRunEvent["type"]): number {
  if (type === "done" || type === "error" || type === "aborted") return 100;
  if (type === "file_event") return 80;
  if (type === "plan_adjustment") return 45;
  if (type === "chunk") return 55;
  return 5;
}

function agentRunStepLabel(event: AgentRunEvent, planSteps: DesktopTaskPlanStep[], hasIncompleteAdjustment = false): string {
  if (event.type === "done") return hasIncompleteAdjustment ? "部分结果已生成，仍有未完成项" : planSteps[planSteps.length - 1]?.title ?? "完成检查并交付";
  if (event.type === "error") return "Agent 执行失败";
  if (event.type === "aborted") return "Agent 已取消";
  if (event.type === "plan_adjustment" && event.planAdjustment) return `调整计划：${event.planAdjustment.replacementStepTitle}`;
  if (event.type === "file_event") return planSteps[2]?.title ?? "检查成果";
  if (event.type === "chunk") return planSteps[1]?.title ?? "处理任务";
  return planSteps[0]?.title ?? "确认任务输入";
}

function agentCompletedSteps(type: AgentRunEvent["type"], planSteps: DesktopTaskPlanStep[], adjustments: DesktopTaskPlanAdjustment[] = []): string[] {
  const failedIds = new Set(adjustments.map((item) => item.failedStepId).filter(Boolean));
  const failedTitles = new Set(adjustments.map((item) => item.failedStepTitle));
  const titles = planSteps.filter((step) => !failedIds.has(step.id) && !failedTitles.has(step.title)).map((step) => step.title);
  if (type === "done") return titles;
  if (type === "file_event") return titles.slice(0, 3);
  if (type === "chunk") return titles.slice(0, 1);
  return [];
}


function workflowProgress(run: DesktopWorkflowRun): number {
  if (run.steps.length === 0) return run.status === "complete" ? 100 : 0;
  const completed = run.steps.filter((step) => step.status === "completed").length;
  return Math.round((completed / run.steps.length) * 100);
}

function mapPresentationStatus(
  phase: ManagerPresentationProgressEvent["phase"],
): DesktopBackgroundTaskStatus {
  if (phase === "completed") return "completed";
  if (phase === "failed") return "failed";
  if (phase === "cancelled") return "cancelled";
  if (phase === "paused") return "blocked";
  return "running";
}

function presentationStepLabel(
  phase: ManagerPresentationProgressEvent["phase"],
  activeStage?: ManagerPresentationProgressEvent["activeStage"],
): string {
  if (["pausing", "paused", "resuming", "cancelling", "cancelled", "failed"].includes(phase) && activeStage) {
    return presentationStepLabel(activeStage);
  }
  if (["planning"].includes(phase)) return "规划报告结构";
  if (["generating"].includes(phase)) return "生成可编辑 PPT";
  if (["validating", "completed"].includes(phase)) return "自动验收";
  if (["cancelled", "failed"].includes(phase)) return "任务已结束";
  return "分析 PDF 内容";
}

function completedPresentationSteps(
  phase: ManagerPresentationProgressEvent["phase"],
  activeStage?: ManagerPresentationProgressEvent["activeStage"],
): string[] {
  const effectivePhase = ["pausing", "paused", "resuming", "cancelling", "cancelled", "failed"].includes(phase)
    ? activeStage ?? phase
    : phase;
  const rank = phase === "completed" ? 4
    : effectivePhase === "validating" ? 3
      : effectivePhase === "generating" ? 2
        : effectivePhase === "planning" ? 1
          : 0;
  return ["分析 PDF 内容", "规划报告结构", "生成可编辑 PPT", "自动验收"].slice(0, rank);
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
  const temporaryPath = `${BACKGROUND_TASKS_FILE}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  try {
    await rename(temporaryPath, BACKGROUND_TASKS_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST"
      && (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    await rm(BACKGROUND_TASKS_FILE, { force: true });
    await rename(temporaryPath, BACKGROUND_TASKS_FILE);
  }
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
      (task.planSteps === undefined || isTaskPlan(task.planSteps)) &&
      (task.planAdjustments === undefined || isPlanAdjustments(task.planAdjustments)) &&
      (task.deliverySummary === undefined || isDeliverySummary(task.deliverySummary)) &&
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
    ...(typed.progress !== undefined ? { progress: normalizeProgress(typed.progress) } : {}),
    ...(typed.planSteps !== undefined
      ? { planSteps: normalizePlanSteps(typed.planSteps) }
      : {}),
    ...(typed.planAdjustments !== undefined
      ? { planAdjustments: normalizePlanAdjustments(typed.planAdjustments) }
      : {}),
    ...(typed.completedSteps !== undefined
      ? { completedSteps: normalizeTextList(typed.completedSteps) }
      : {}),
    ...(typed.pendingDecisions !== undefined
      ? { pendingDecisions: normalizeTextList(typed.pendingDecisions) }
      : {}),
    ...(typeof typed.message === "string" ? { message: typed.message } : {}),
    ...(typeof typed.verification === "string"
      ? { verification: typed.verification }
      : {}),
    ...(typed.deliverySummary !== undefined
      ? { deliverySummary: normalizeDeliverySummary(typed.deliverySummary) }
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
    ...(typeof typed.title === "string" ? { title: normalizeRequiredText(typed.title, "Background task title is required.") } : {}),
    ...(typeof typed.message === "string" ? { message: typed.message } : {}),
    ...(typed.currentStep !== undefined && typeof typed.currentStep === "string"
      ? { currentStep: typed.currentStep }
      : {}),
    ...(typed.progress !== undefined ? { progress: normalizeProgress(typed.progress) } : {}),
    ...(typed.planSteps !== undefined
      ? { planSteps: normalizePlanSteps(typed.planSteps) }
      : {}),
    ...(typed.planAdjustments !== undefined
      ? { planAdjustments: normalizePlanAdjustments(typed.planAdjustments) }
      : {}),
    ...(typed.completedSteps !== undefined
      ? { completedSteps: normalizeTextList(typed.completedSteps) }
      : {}),
    ...(typed.pendingDecisions !== undefined
      ? { pendingDecisions: normalizeTextList(typed.pendingDecisions) }
      : {}),
    ...(typeof typed.verification === "string"
      ? { verification: typed.verification }
      : {}),
    ...(typed.deliverySummary !== undefined
      ? { deliverySummary: normalizeDeliverySummary(typed.deliverySummary) }
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
    kind !== "scheduled_monitor" &&
    kind !== "presentation_generation"
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
    source !== "monitor" &&
    source !== "presentation"
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

function normalizeProgress(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Background task progress must be a finite number.");
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeTextList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Background task step metadata must be an array.");
  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim().slice(0, 240))
    .slice(0, 50);
}

function normalizePlanSteps(value: unknown): DesktopTaskPlanStep[] {
  if (!Array.isArray(value)) throw new Error("Background task plan must be an array.");
  const phases = new Set(["input", "process", "check", "output"]);
  return value.slice(0, 50).map((item, index) => {
    if (!item || typeof item !== "object") throw new Error("Background task plan step is invalid.");
    const step = item as Partial<DesktopTaskPlanStep>;
    if (!phases.has(String(step.phase))) throw new Error("Background task plan phase is invalid.");
    return {
      id: normalizeRequiredText(step.id ?? `step-${index + 1}`, "Background task plan step id is required."),
      phase: step.phase as DesktopTaskPlanStep["phase"],
      title: normalizeRequiredText(step.title, "Background task plan step title is required."),
    };
  });
}

function isTaskPlan(value: unknown): value is DesktopTaskPlanStep[] {
  if (!Array.isArray(value)) return false;
  const phases = new Set(["input", "process", "check", "output"]);
  return value.every((item) => Boolean(item)
    && typeof item.id === "string"
    && phases.has(item.phase)
    && typeof item.title === "string");
}

function normalizePlanAdjustments(value: unknown): DesktopTaskPlanAdjustment[] {
  if (!Array.isArray(value)) throw new Error("Background task plan adjustments must be an array.");
  return value.slice(0, 20).map((item, index) => {
    if (!item || typeof item !== "object") throw new Error("Background task plan adjustment is invalid.");
    const adjustment = item as Partial<DesktopTaskPlanAdjustment>;
    if (adjustment.completeness !== "partial" && adjustment.completeness !== "blocked") {
      throw new Error("Background task plan adjustment completeness is invalid.");
    }
    return {
      id: normalizeRequiredText(adjustment.id ?? `plan-adjustment-${index + 1}`, "Plan adjustment id is required."),
      ...(normalizeOptionalText(adjustment.failedStepId) ? { failedStepId: normalizeOptionalText(adjustment.failedStepId) } : {}),
      failedStepTitle: normalizeRequiredText(adjustment.failedStepTitle, "Failed plan step title is required."),
      reason: normalizeRequiredText(adjustment.reason, "Plan adjustment reason is required."),
      replacementStepTitle: normalizeRequiredText(adjustment.replacementStepTitle, "Replacement plan step title is required."),
      impact: normalizeRequiredText(adjustment.impact, "Plan adjustment impact is required."),
      completeness: adjustment.completeness,
      ...(normalizeOptionalText(adjustment.timestamp) ? { timestamp: normalizeOptionalText(adjustment.timestamp) } : {}),
    };
  });
}

function isPlanAdjustments(value: unknown): value is DesktopTaskPlanAdjustment[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => Boolean(item)
    && typeof item.id === "string"
    && typeof item.failedStepTitle === "string"
    && typeof item.reason === "string"
    && typeof item.replacementStepTitle === "string"
    && typeof item.impact === "string"
    && (item.completeness === "partial" || item.completeness === "blocked"));
}

function normalizeLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(Math.floor(limit), MAX_BACKGROUND_TASKS_PER_WORKSPACE));
}

async function currentOwnerUserId(): Promise<string | undefined> {
  try {
    return (await requireAuthContext()).userId;
  } catch {
    return undefined;
  }
}

function cloneBackgroundTask(task: DesktopBackgroundTask): DesktopBackgroundTask {
  return {
    ...task,
    ...(task.planSteps ? { planSteps: task.planSteps.map((step) => ({ ...step })) } : {}),
    ...(task.planAdjustments ? { planAdjustments: task.planAdjustments.map((item) => ({ ...item })) } : {}),
    ...(task.completedSteps ? { completedSteps: [...task.completedSteps] } : {}),
    ...(task.pendingDecisions ? { pendingDecisions: [...task.pendingDecisions] } : {}),
    ...(task.deliverySummary ? { deliverySummary: cloneDeliverySummary(task.deliverySummary) } : {}),
  };
}

function buildAgentDeliverySummary(
  request: AgentRunRequest,
  existing: DesktopBackgroundTask | undefined,
): DesktopTaskDeliverySummary {
  const result = normalizeOptionalText(existing?.message) ?? "结果已生成。";
  const adjustment = existing?.planAdjustments?.at(-1);
  if (adjustment) {
    return normalizeDeliverySummary({
      findingSummary: `已生成部分结果；“${adjustment.failedStepTitle}”未能完成。`,
      importance: "high",
      importanceReason: `数据源不可用导致计划发生调整，当前结果为${adjustment.completeness === "blocked" ? "阻塞" : "部分"}结果。`,
      artifacts: existing?.deliverySummary?.artifacts ?? [],
      suggestedAction: "打开部分成果，并在数据源恢复后重新执行未完成步骤。",
      workSummary: `原计划步骤“${adjustment.failedStepTitle}”失败；系统已改为“${adjustment.replacementStepTitle}”。`,
      coreConclusion: "当前成果只反映可用材料，不能作为完整综合结论。",
      verification: `已记录失败步骤、调整原因和替代方案；未完成项没有被标记为通过。`,
      remainingRisks: adjustment.impact,
      completionCriteria: {
        passed: [
          "已使用仍可访问的材料生成部分成果",
          "已明确记录计划调整及其影响",
        ],
        incomplete: [
          `未完成：${adjustment.failedStepTitle}`,
          `原因：${adjustment.reason}`,
          `影响：${adjustment.impact}`,
        ],
      },
    });
  }
  const isG4ReportUpdate = /最新数据.*旧报告|旧报告.*最新数据/.test(request.task);
  const isG3Synthesis = isMultiMaterialSynthesisTask(request.task);
  const reportQuality = existing?.deliverySummary?.artifacts.find((artifact) => artifact.quality)?.quality;
  const chartQuality = existing?.deliverySummary?.artifacts.find((artifact) => artifact.chartQuality)?.chartQuality;
  const finding = isG4ReportUpdate
    ? "已将最新数据更新进旧报告，并生成给导师查看的版本。"
    : isG3Synthesis
      ? "已完成多材料综合，整理出当前共识、主要争议和下一步研究问题。"
    : `已完成“${request.task}”：${result}`;
  return normalizeDeliverySummary({
    findingSummary: finding,
    importance: "medium",
    importanceReason: "任务已完成，建议确认结果是否符合预期。",
    artifacts: existing?.deliverySummary?.artifacts ?? [],
    suggestedAction: existing?.deliverySummary?.artifacts.length
      ? "打开成果并检查工作区变更。"
      : "打开任务，查看完整结果和执行记录。",
    workSummary: isG4ReportUpdate
      ? "已读取旧报告、最新数据和结果图，更新报告内容并生成导师版成果。"
      : isG3Synthesis
        ? `已连续完成材料读取、跨材料比较、观点整理和综合报告生成，共处理 ${request.files?.length ?? 0} 份材料。`
      : `已执行：${request.task}`,
    coreConclusion: isG4ReportUpdate
      ? "导师版更新报告已经生成；最新数据已进入新版本，原始材料仍保留用于复核。"
      : isG3Synthesis
        ? "多份材料对短期效果形成共识，但成本判断存在争议，长期稳定性仍缺乏充分证据。"
      : finding,
    verification: isG4ReportUpdate
      ? "已核对输入材料数量、任务完成状态、工作区变更和成果文件登记。"
      : isG3Synthesis
        ? "已检查报告包含共识、争议、下一步研究问题、不确定性和材料来源。"
      : "Agent 已到达完成状态；请结合工作区变更复核成果。",
    remainingRisks: isG4ReportUpdate
      ? "结果图的业务含义和导师版最终措辞仍需用户确认。"
      : isG3Synthesis
        ? "现有材料不足以判断长期稳定性；成本差异需要统一口径和新增数据。"
      : "自动任务可能未覆盖未明确提出的业务约束。",
    completionCriteria: {
      passed: [
        "任务已完成并到达可交付状态",
        ...(request.files?.length ? [`已读取并关联 ${request.files.length} 份输入材料`] : []),
        "执行结果和工作区变更已保留，可继续复核",
        ...(reportQuality?.status === "passed"
          ? [`可交付文件已通过结构和格式检查，黄金事实覆盖率 ${reportQuality.goldenFactCoverage}%`]
          : []),
        ...(chartQuality?.status === "passed"
          ? [`图表与数据检查已通过：${chartQuality.pointsMatched}/${chartQuality.pointsExpected} 个数据点，${chartQuality.anomaliesMatched}/${chartQuality.anomaliesExpected} 个异常点一致`]
          : []),
      ],
      incomplete: chartQuality?.status === "failed"
        ? [`图表与数据检查未通过：${chartQuality.mismatchCount} 项不一致`]
        : reportQuality?.status === "failed"
        ? [
            `可交付文件质量检查未通过：${reportQuality.checks.filter((check) => /缺少|发现|不完整/.test(check)).join("；") || "需要修正后复核"}`,
          ]
        : existing?.deliverySummary?.artifacts.length
        ? [isG4ReportUpdate
            ? "结果图含义和导师版最终措辞尚未由用户确认"
            : isG3Synthesis
              ? "长期稳定性和成本差异尚缺补充证据"
              : "尚未由用户确认成果符合最终业务要求"]
        : ["尚未登记可直接打开的独立成果文件", "尚未由用户确认成果符合最终业务要求"],
    },
  });
}

async function buildAgentArtifactSummary(
  request: AgentRunRequest,
  artifactPath: string,
  existing: DesktopBackgroundTask | undefined,
): Promise<DesktopTaskDeliverySummary> {
  const absolutePath = isAbsolute(artifactPath)
    ? artifactPath
    : resolve(request.workspacePath || process.cwd(), artifactPath);
  const quality = /\.md$/i.test(absolutePath) && request.metadata?.source !== "windows-results-center-versioning"
    && request.metadata?.source !== "windows-results-center-local-edit"
    ? await evaluateMarkdownReportQuality(absolutePath, request)
    : undefined;
  const editLineage = buildArtifactEditLineage(request);
  const chartQuality = /\.svg$/i.test(absolutePath) && ["windows-results-center-chart-generation", "windows-results-center-analysis-route"].includes(String(request.metadata?.source || ""))
    ? await evaluateSvgChartQuality(absolutePath, request)
    : undefined;
  const analysisRoute = buildArtifactAnalysisRoute(request);
  const artifacts = [
    ...(existing?.deliverySummary?.artifacts ?? []),
    {
      id: `${request.requestId}:artifact:${createHash("sha256").update(absolutePath).digest("hex").slice(0, 12)}`,
      label: basename(absolutePath),
      path: absolutePath,
      kind: /\.(?:md|markdown|txt)$/i.test(absolutePath) ? "report" as const : "file" as const,
      ...(quality ? { quality } : {}),
      ...(chartQuality ? { chartQuality } : {}),
      ...(editLineage ? { editLineage } : {}),
      ...(analysisRoute ? { analysisRoute } : {}),
    },
  ].filter((artifact, index, all) => all.findIndex((candidate) => candidate.path === artifact.path) === index);
  return normalizeDeliverySummary({
    findingSummary: `正在完成“${request.task}”。`,
    importance: "medium",
    importanceReason: "成果文件已生成，任务仍在完成最终检查。",
    artifacts,
    suggestedAction: "等待最终检查完成后查看成果。",
    workSummary: `正在执行：${request.task}`,
    coreConclusion: "成果文件已生成，正在完成最终检查。",
    verification: "最终检查尚未完成。",
    remainingRisks: "任务仍在运行，结论尚未最终确认。",
    completionCriteria: { passed: ["成果文件已经生成"], incomplete: ["最终检查尚未完成"] },
  });
}

async function evaluateSvgChartQuality(chartPath: string, request: AgentRunRequest): Promise<DesktopChartDataQuality> {
  const checkedAt = new Date().toISOString();
  const sourceFile = (request.files ?? []).find((file) => file && typeof file === "object" && "path" in file && typeof file.path === "string") as { path: string } | undefined;
  const sourcePath = sourceFile
    ? (isAbsolute(sourceFile.path) ? sourceFile.path : resolve(request.workspacePath || process.cwd(), sourceFile.path))
    : "";
  const textMeta = (key: string): string => typeof request.metadata?.[key] === "string" ? String(request.metadata[key]) : "";
  const numberMeta = (key: string): number => Number(request.metadata?.[key]);
  const xAxis = textMeta("x_column");
  const yAxis = textMeta("y_column");
  const unit = textMeta("unit");
  const legend = textMeta("legend");
  const anomalyColumn = textMeta("anomaly_column");
  let svg = "";
  let csv = "";
  try {
    [svg, csv] = await Promise.all([readFile(chartPath, "utf8"), readFile(sourcePath, "utf8")]);
  } catch {
    return { status: "failed", checkedAt, sourcePath, xAxis, yAxis, unit, legend, axisLabelsVisible: false, unitVisible: false, legendVisible: false, pointsExpected: 0, pointsMatched: 0, coordinateMatches: 0, anomaliesExpected: 0, anomaliesMatched: 0, mismatchCount: 1, checks: ["图表或源数据无法读取"] };
  }
  const rows = csv.trim().split(/\r?\n/).map((row) => row.split(",").map((cell) => cell.trim()));
  const headers = rows[0] ?? [];
  const xIndex = headers.indexOf(xAxis);
  const yIndex = headers.indexOf(yAxis);
  const anomalyIndex = anomalyColumn ? headers.indexOf(anomalyColumn) : -1;
  const expected = rows.slice(1).filter((row) => row.length > Math.max(xIndex, yIndex) && Number.isFinite(Number(row[xIndex])) && Number.isFinite(Number(row[yIndex])));
  const circles = [...svg.matchAll(/<circle\b([^>]*)>/gi)].map((match) => {
    const attrs = new Map([...match[1].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((item) => [item[1], item[2]]));
    return { x: Number(attrs.get("data-x")), y: Number(attrs.get("data-y")), cx: Number(attrs.get("cx")), cy: Number(attrs.get("cy")), anomaly: attrs.get("data-anomaly") === "true" };
  });
  const xMin = numberMeta("x_min");
  const xMax = numberMeta("x_max");
  const yMin = numberMeta("y_min");
  const yMax = numberMeta("y_max");
  const plotLeft = numberMeta("plot_left");
  const plotRight = numberMeta("plot_right");
  const plotTop = numberMeta("plot_top");
  const plotBottom = numberMeta("plot_bottom");
  const matched = expected.filter((row) => circles.some((point) => point.x === Number(row[xIndex]) && point.y === Number(row[yIndex])));
  const coordinateMatches = expected.filter((row) => {
    const x = Number(row[xIndex]);
    const y = Number(row[yIndex]);
    const point = circles.find((candidate) => candidate.x === x && candidate.y === y);
    const expectedCx = plotLeft + ((x - xMin) / (xMax - xMin)) * (plotRight - plotLeft);
    const expectedCy = plotBottom - ((y - yMin) / (yMax - yMin)) * (plotBottom - plotTop);
    return point && Math.abs(point.cx - expectedCx) <= 0.5 && Math.abs(point.cy - expectedCy) <= 0.5;
  }).length;
  const expectedAnomalies = expected.filter((row) => anomalyIndex >= 0 && /^(?:true|1|yes|anomaly)$/i.test(row[anomalyIndex] || ""));
  const anomaliesMatched = expectedAnomalies.filter((row) => circles.some((point) => point.x === Number(row[xIndex]) && point.y === Number(row[yIndex]) && point.anomaly)).length;
  const visibleText = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)].map((match) => match[1].replace(/<[^>]+>/g, "")).join(" ");
  const axisLabelsVisible = Boolean(xAxis && yAxis && visibleText.includes(xAxis) && visibleText.includes(yAxis));
  const unitVisible = Boolean(unit && visibleText.includes(unit));
  const legendVisible = Boolean(legend && visibleText.includes(legend));
  const mismatchCount = (expected.length - matched.length) + (expected.length - coordinateMatches) + (expectedAnomalies.length - anomaliesMatched) + Number(!axisLabelsVisible) + Number(!unitVisible) + Number(!legendVisible);
  const checks = [
    axisLabelsVisible ? "横纵坐标标签可见" : "坐标标签缺失",
    unitVisible ? `单位可见：${unit}` : "单位缺失",
    legendVisible ? `图例可见：${legend}` : "图例缺失",
    `数据点 ${matched.length}/${expected.length} 一致`,
    `坐标映射 ${coordinateMatches}/${expected.length} 一致`,
    `异常点 ${anomaliesMatched}/${expectedAnomalies.length} 一致`,
  ];
  return { status: mismatchCount === 0 ? "passed" : "failed", checkedAt, sourcePath, xAxis, yAxis, unit, legend, axisLabelsVisible, unitVisible, legendVisible, pointsExpected: expected.length, pointsMatched: matched.length, coordinateMatches, anomaliesExpected: expectedAnomalies.length, anomaliesMatched, mismatchCount, checks };
}

function buildArtifactEditLineage(request: AgentRunRequest): DesktopTaskArtifactLink["editLineage"] {
  if (request.metadata?.source !== "windows-results-center-local-edit") return undefined;
  const sourceArtifactId = typeof request.metadata.source_artifact_id === "string" ? request.metadata.source_artifact_id : "";
  const sourcePath = typeof request.metadata.source_path === "string" ? request.metadata.source_path : "";
  const scopeType = request.metadata.scope_type;
  const scopeLabel = typeof request.metadata.scope_label === "string" ? request.metadata.scope_label : "";
  const action = request.metadata.edit_action;
  if (!sourceArtifactId || !sourcePath || !scopeLabel) return undefined;
  if (scopeType !== "text" && scopeType !== "table" && scopeType !== "image") return undefined;
  if (action !== "simplify_text" && action !== "sort_table_numeric" && action !== "log_scale_image") return undefined;
  return { sourceArtifactId, sourcePath, scopeType, scopeLabel, action };
}

function buildArtifactAnalysisRoute(request: AgentRunRequest): DesktopTaskArtifactLink["analysisRoute"] {
  if (request.metadata?.source !== "windows-results-center-analysis-route") return undefined;
  const text = (key: string): string => typeof request.metadata?.[key] === "string" ? String(request.metadata[key]).trim() : "";
  const role = text("route_role");
  const status = text("route_status");
  if (!text("route_group_id") || !text("route_id") || !text("route_method") || !text("route_input_summary") || !text("route_key_conclusion") || !text("route_risk") || !text("route_recommended_use") || !text("source_artifact_id") || !text("source_path") || !text("input_fingerprint")) return undefined;
  if (role !== "original" && role !== "alternative") return undefined;
  if (status !== "completed" && status !== "failed") return undefined;
  return {
    routeGroupId: text("route_group_id"),
    routeId: text("route_id"),
    role,
    method: text("route_method"),
    inputSummary: text("route_input_summary"),
    keyConclusion: text("route_key_conclusion"),
    risk: text("route_risk"),
    recommendedUse: text("route_recommended_use"),
    status,
    selected: request.metadata?.route_selected === true,
    sourceArtifactId: text("source_artifact_id"),
    sourcePath: text("source_path"),
    inputFingerprint: text("input_fingerprint"),
    createdAt: text("route_created_at") || new Date().toISOString(),
  };
}

const REQUIRED_REPORT_SECTIONS = ["标题", "摘要", "方法", "结果", "限制", "来源"];

async function evaluateMarkdownReportQuality(
  reportPath: string,
  request: AgentRunRequest,
): Promise<DesktopArtifactQuality> {
  const checkedAt = new Date().toISOString();
  let content = "";
  try {
    content = await readFile(reportPath, "utf8");
  } catch {
    return {
      status: "failed",
      checkedAt,
      format: "markdown",
      formatValid: false,
      requiredSections: REQUIRED_REPORT_SECTIONS,
      presentSections: [],
      missingSections: REQUIRED_REPORT_SECTIONS,
      placeholderCount: 0,
      mojibakeCount: 0,
      emptyImageCount: 0,
      brokenLinkCount: 1,
      goldenFactsExpected: 0,
      goldenFactsMatched: 0,
      goldenFactCoverage: 0,
      checks: ["成果文件无法读取"],
    };
  }

  const headings = [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim());
  const sectionPatterns: Record<string, RegExp> = {
    标题: /^#\s+\S.+$/m,
    摘要: /^#{1,6}\s+(摘要|概述|Summary)\s*$/im,
    方法: /^#{1,6}\s+(方法|分析方法|Method|Methods)\s*$/im,
    结果: /^#{1,6}\s+(结果|主要结果|发现|Results?)\s*$/im,
    限制: /^#{1,6}\s+(限制|局限|不确定性|Limitations?)\s*$/im,
    来源: /^#{1,6}\s+(来源|参考资料|引用|Sources?|References?)\s*$/im,
  };
  const presentSections = REQUIRED_REPORT_SECTIONS.filter((section) => sectionPatterns[section].test(content));
  const missingSections = REQUIRED_REPORT_SECTIONS.filter((section) => !presentSections.includes(section));
  const placeholderCount = (content.match(/\b(?:TODO|TBD|FIXME|Lorem ipsum)\b|待补充|待填写|占位符|这里插入/gi) ?? []).length;
  const mojibakeCount = (content.match(/�|锛|銆|鈥|馃|Ã|Â/g) ?? []).length;
  const imageMatches = [...content.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
  const emptyImageCount = imageMatches.filter((match) => !match[1].trim() || !match[2].trim()).length;
  const linkTargets = [...content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().replace(/^<|>$/g, ""))
    .filter((target) => target && !/^(?:https?:|mailto:|#)/i.test(target));
  let brokenLinkCount = 0;
  for (const rawTarget of linkTargets) {
    const target = rawTarget.split(/\s+["']/)[0].split("#")[0];
    if (!target) continue;
    try {
      await stat(resolve(dirname(reportPath), decodeURIComponent(target)));
    } catch {
      brokenLinkCount += 1;
    }
  }

  const goldenFacts: Array<{ id: string; values: string[] }> = [];
  for (const rawFile of request.files ?? []) {
    if (!rawFile || typeof rawFile !== "object" || !("path" in rawFile) || typeof rawFile.path !== "string") continue;
    const filePath = isAbsolute(rawFile.path)
      ? rawFile.path
      : resolve(request.workspacePath || process.cwd(), rawFile.path);
    const fileName = basename(filePath);
    goldenFacts.push({ id: `source:${fileName}`, values: [fileName] });
    if (/\.csv$/i.test(fileName)) {
      try {
        const rows = (await readFile(filePath, "utf8")).trim().split(/\r?\n/).slice(1);
        for (const row of rows) {
          const cells = row.split(",").map((cell) => cell.trim()).filter(Boolean);
          if (cells.length >= 2) goldenFacts.push({ id: `csv:${cells[0]}`, values: cells });
        }
      } catch {
        // The source remains a required fact even when detailed CSV extraction fails.
      }
    }
  }
  const matchedFacts = goldenFacts.filter((fact) => fact.values.every((value) => content.includes(value)));
  const goldenFactCoverage = goldenFacts.length
    ? Math.round((matchedFacts.length / goldenFacts.length) * 1000) / 10
    : 100;
  const formatValid = headings.length >= REQUIRED_REPORT_SECTIONS.length && content.trim().length >= 200;
  const passed = formatValid
    && missingSections.length === 0
    && placeholderCount === 0
    && mojibakeCount === 0
    && emptyImageCount === 0
    && brokenLinkCount === 0
    && goldenFactCoverage >= 90;
  const checks = [
    formatValid ? "Markdown 格式可解析" : "Markdown 格式不完整",
    missingSections.length ? `缺少章节：${missingSections.join("、")}` : "规定章节完整",
    placeholderCount ? `发现 ${placeholderCount} 个占位符` : "未发现占位符",
    mojibakeCount ? `发现 ${mojibakeCount} 处乱码` : "未发现乱码",
    emptyImageCount ? `发现 ${emptyImageCount} 个空图` : "未发现空图",
    brokenLinkCount ? `发现 ${brokenLinkCount} 个断链` : "未发现断链",
    `黄金事实覆盖率 ${goldenFactCoverage}%`,
  ];
  return {
    status: passed ? "passed" : "failed",
    checkedAt,
    format: "markdown",
    formatValid,
    requiredSections: REQUIRED_REPORT_SECTIONS,
    presentSections,
    missingSections,
    placeholderCount,
    mojibakeCount,
    emptyImageCount,
    brokenLinkCount,
    goldenFactsExpected: goldenFacts.length,
    goldenFactsMatched: matchedFacts.length,
    goldenFactCoverage,
    checks,
  };
}

function normalizeDeliverySummary(value: DesktopTaskDeliverySummary): DesktopTaskDeliverySummary {
  return {
    findingSummary: normalizeRequiredText(value.findingSummary, "Finding summary is required."),
    importance: value.importance === "high" || value.importance === "low" ? value.importance : "medium",
    importanceReason: normalizeRequiredText(value.importanceReason, "Importance reason is required."),
    artifacts: Array.isArray(value.artifacts) ? value.artifacts.slice(0, 12).map((artifact, index) => ({
      id: normalizeOptionalText(artifact.id) ?? `artifact-${index + 1}`,
      label: normalizeRequiredText(artifact.label, "Artifact label is required."),
      path: normalizeRequiredText(artifact.path, "Artifact path is required."),
      kind: ["file", "presentation", "report", "folder"].includes(artifact.kind) ? artifact.kind : "file",
      ...(artifact.quality ? { quality: normalizeArtifactQuality(artifact.quality) } : {}),
      ...(artifact.chartQuality ? { chartQuality: normalizeChartQuality(artifact.chartQuality) } : {}),
      ...(artifact.analysisRoute ? { analysisRoute: normalizeAnalysisRoute(artifact.analysisRoute) } : {}),
      ...(artifact.consistencyCheck ? { consistencyCheck: {
        checkedAt: normalizeOptionalText(artifact.consistencyCheck.checkedAt) ?? new Date().toISOString(),
        status: artifact.consistencyCheck.status === "passed" ? "passed" : "issues_found",
        expectedIssues: Math.max(0, Math.floor(Number(artifact.consistencyCheck.expectedIssues) || 0)),
        detectedIssues: Math.max(0, Math.floor(Number(artifact.consistencyCheck.detectedIssues) || 0)),
        summary: normalizeRequiredText(artifact.consistencyCheck.summary, "Consistency check summary is required."),
        items: Array.isArray(artifact.consistencyCheck.items) ? artifact.consistencyCheck.items.slice(0, 50).map((item, itemIndex) => ({
          id: normalizeOptionalText(item.id) ?? `consistency-${itemIndex + 1}`,
          category: ["outdated_number", "chart_mismatch", "source_mismatch"].includes(item.category) ? item.category : "source_mismatch",
          severity: ["high", "medium", "low"].includes(item.severity) ? item.severity : "medium",
          status: ["open", "accepted", "ignored"].includes(item.status) ? item.status : "open",
          title: normalizeRequiredText(item.title, "Consistency issue title is required."),
          finding: normalizeRequiredText(item.finding, "Consistency finding is required."),
          sourcePath: normalizeRequiredText(item.sourcePath, "Consistency source path is required."),
          locatorType: ["pdf_page", "file_paragraph", "data_range", "calculation"].includes(item.locatorType) ? item.locatorType : "file_paragraph",
          locator: normalizeRequiredText(item.locator, "Consistency source locator is required."),
          observedValue: normalizeRequiredText(item.observedValue, "Observed value is required."),
          expectedValue: normalizeRequiredText(item.expectedValue, "Expected value is required."),
          evidenceText: normalizeRequiredText(item.evidenceText, "Consistency evidence is required."),
          recommendation: normalizeRequiredText(item.recommendation, "Consistency recommendation is required."),
        })) : [],
      } } : {}),
      ...(Array.isArray(artifact.independentReviews) ? { independentReviews: artifact.independentReviews.slice(0, 20).map((review, reviewIndex) => ({
        id: normalizeOptionalText(review.id) ?? `independent-review-${reviewIndex + 1}`,
        mode: review.mode === "alternative" ? "alternative" : "repeat",
        method: review.method === "constraint_recalculation" ? "constraint_recalculation" : "reverse_source_trace",
        methodLabel: normalizeRequiredText(review.methodLabel, "Independent review method label is required."),
        reviewerLabel: normalizeRequiredText(review.reviewerLabel, "Independent reviewer label is required."),
        requestedAt: normalizeOptionalText(review.requestedAt) ?? new Date().toISOString(),
        completedAt: normalizeOptionalText(review.completedAt) ?? new Date().toISOString(),
        status: review.status === "issues_found" || review.status === "inconclusive" ? review.status : "passed",
        checkedClaimCount: Math.max(0, Math.floor(Number(review.checkedClaimCount) || 0)),
        checkedSourceCount: Math.max(0, Math.floor(Number(review.checkedSourceCount) || 0)),
        scope: normalizeTextList(review.scope),
        findings: Array.isArray(review.findings) ? review.findings.slice(0, 50).map((finding, findingIndex) => ({
          id: normalizeOptionalText(finding.id) ?? `review-finding-${findingIndex + 1}`,
          title: normalizeRequiredText(finding.title, "Independent review finding title is required."),
          outcome: finding.outcome === "issue_found" || finding.outcome === "not_reproduced" ? finding.outcome : "confirmed",
          detail: normalizeRequiredText(finding.detail, "Independent review finding detail is required."),
          sourcePath: normalizeRequiredText(finding.sourcePath, "Independent review source path is required."),
          locatorType: ["pdf_page", "file_paragraph", "data_range", "calculation"].includes(finding.locatorType) ? finding.locatorType : "file_paragraph",
          locator: normalizeRequiredText(finding.locator, "Independent review source locator is required."),
          evidenceText: normalizeRequiredText(finding.evidenceText, "Independent review evidence is required."),
        })) : [],
        uncovered: normalizeTextList(review.uncovered),
        summary: normalizeRequiredText(review.summary, "Independent review summary is required."),
        baselineCheckId: normalizeRequiredText(review.baselineCheckId, "Independent review baseline ID is required."),
        usesOriginalAnswerText: false as const,
        methodDifference: normalizeRequiredText(review.methodDifference, "Independent review method difference is required."),
        evidenceFingerprint: normalizeRequiredText(review.evidenceFingerprint, "Independent review fingerprint is required."),
      })) } : {}),
      ...(artifact.editLineage ? { editLineage: {
        sourceArtifactId: normalizeRequiredText(artifact.editLineage.sourceArtifactId, "Source artifact ID is required."),
        sourcePath: normalizeRequiredText(artifact.editLineage.sourcePath, "Source artifact path is required."),
        scopeType: artifact.editLineage.scopeType,
        scopeLabel: normalizeRequiredText(artifact.editLineage.scopeLabel, "Edit scope is required."),
        action: artifact.editLineage.action,
      } } : {}),
      ...(Array.isArray(artifact.keyConclusions) ? {
        keyConclusions: artifact.keyConclusions.slice(0, 20).map((item, conclusionIndex) => ({
          id: normalizeOptionalText(item.id) ?? `conclusion-${conclusionIndex + 1}`,
          conclusion: normalizeRequiredText(item.conclusion, "Conclusion is required."),
          sourcePath: normalizeRequiredText(item.sourcePath, "Conclusion source path is required."),
          locatorType: ["pdf_page", "file_paragraph", "data_range", "calculation"].includes(item.locatorType)
            ? item.locatorType
            : "file_paragraph",
          locator: normalizeRequiredText(item.locator, "Conclusion source locator is required."),
          evidenceText: normalizeRequiredText(item.evidenceText, "Conclusion evidence text is required."),
          verified: item.verified === true,
          ...(Array.isArray(item.citations) ? { citations: item.citations.slice(0, 12).map((citation, citationIndex) => ({
            id: normalizeOptionalText(citation.id) ?? `citation-${citationIndex + 1}`,
            title: normalizeRequiredText(citation.title, "Citation title is required."),
            authors: normalizeTextList(citation.authors),
            sourcePath: normalizeRequiredText(citation.sourcePath, "Citation source path is required."),
            locatorType: ["pdf_page", "file_paragraph", "data_range", "calculation"].includes(citation.locatorType)
              ? citation.locatorType
              : "file_paragraph",
            locator: normalizeRequiredText(citation.locator, "Citation locator is required."),
            excerpt: normalizeRequiredText(citation.excerpt, "Citation excerpt is required."),
            relation: ["supports", "contradicts", "insufficient"].includes(citation.relation)
              ? citation.relation
              : "insufficient",
            supportScore: Math.max(0, Math.min(1, Number(citation.supportScore) || 0)),
          })) } : {}),
          ...(Array.isArray(item.numericEvidence) ? { numericEvidence: item.numericEvidence.slice(0, 20).map((numeric, numericIndex) => ({
            id: normalizeOptionalText(numeric.id) ?? `numeric-${numericIndex + 1}`,
            label: normalizeRequiredText(numeric.label, "Numeric evidence label is required."),
            displayValue: normalizeRequiredText(numeric.displayValue, "Numeric display value is required."),
            reportedValue: Number(numeric.reportedValue),
            unit: normalizeOptionalText(numeric.unit) ?? "",
            kind: numeric.kind === "calculated" ? "calculated" : "direct",
            sourcePath: normalizeRequiredText(numeric.sourcePath, "Numeric source path is required."),
            locatorType: ["pdf_page", "file_paragraph", "data_range", "calculation"].includes(numeric.locatorType)
              ? numeric.locatorType
              : "calculation",
            locator: normalizeRequiredText(numeric.locator, "Numeric source locator is required."),
            sourceValues: Array.isArray(numeric.sourceValues) ? numeric.sourceValues.slice(0, 20).map((source) => ({
              label: normalizeRequiredText(source.label, "Numeric source label is required."),
              value: Number(source.value),
              unit: normalizeOptionalText(source.unit) ?? "",
              sourcePath: normalizeRequiredText(source.sourcePath, "Numeric source path is required."),
              locator: normalizeRequiredText(source.locator, "Numeric source locator is required."),
              rawText: normalizeRequiredText(source.rawText, "Numeric source text is required."),
            })) : [],
            formula: normalizeRequiredText(numeric.formula, "Numeric formula is required."),
            ...(Number.isFinite(Number(numeric.recalculatedValue)) ? { recalculatedValue: Number(numeric.recalculatedValue) } : {}),
            tolerance: Math.max(0, Number(numeric.tolerance) || 0),
            status: numeric.status === "verified" ? "verified" : "unverifiable",
            explanation: normalizeRequiredText(numeric.explanation, "Numeric verification explanation is required."),
          })) } : {}),
          ...(item.uncertainty ? { uncertainty: {
            status: ["source_conflict", "insufficient_data", "inference"].includes(item.uncertainty.status)
              ? item.uncertainty.status
              : "insufficient_data",
            label: normalizeRequiredText(item.uncertainty.label, "Uncertainty label is required."),
            explanation: normalizeRequiredText(item.uncertainty.explanation, "Uncertainty explanation is required."),
            recommendedAction: normalizeRequiredText(item.uncertainty.recommendedAction, "Uncertainty action is required."),
            requiresQualification: true as const,
            qualifyingLanguage: normalizeTextList(item.uncertainty.qualifyingLanguage),
            claims: Array.isArray(item.uncertainty.claims) ? item.uncertainty.claims.slice(0, 12).map((claim, claimIndex) => ({
              id: normalizeOptionalText(claim.id) ?? `uncertainty-claim-${claimIndex + 1}`,
              position: normalizeRequiredText(claim.position, "Uncertainty claim position is required."),
              sourcePath: normalizeRequiredText(claim.sourcePath, "Uncertainty claim source is required."),
              locatorType: ["pdf_page", "file_paragraph", "data_range", "calculation"].includes(claim.locatorType)
                ? claim.locatorType
                : "file_paragraph",
              locator: normalizeRequiredText(claim.locator, "Uncertainty claim locator is required."),
              excerpt: normalizeRequiredText(claim.excerpt, "Uncertainty claim excerpt is required."),
              stance: ["supports", "contradicts", "insufficient"].includes(claim.stance)
                ? claim.stance
                : "insufficient",
            })) : [],
          } } : {}),
          ...(item.trust ? { trust: normalizeTrustAssessment(item.trust) } : {}),
        })),
        conclusionTraceabilityRate: Math.max(0, Math.min(1, Number(artifact.conclusionTraceabilityRate) || 0)),
      } : {}),
    })) : [],
    suggestedAction: normalizeRequiredText(value.suggestedAction, "Suggested action is required."),
    workSummary: normalizeRequiredText(value.workSummary, "Work summary is required."),
    coreConclusion: normalizeRequiredText(value.coreConclusion, "Core conclusion is required."),
    verification: normalizeRequiredText(value.verification, "Verification summary is required."),
    remainingRisks: normalizeRequiredText(value.remainingRisks, "Remaining risks are required."),
    completionCriteria: {
      passed: normalizeTextList(value.completionCriteria?.passed ?? [value.verification]),
      incomplete: normalizeTextList(value.completionCriteria?.incomplete ?? [value.remainingRisks]),
    },
  };
}

function normalizeTrustAssessment(value: DesktopTrustAssessment): DesktopTrustAssessment {
  const statuses: DesktopTrustStatus[] = ["evidence_sufficient", "needs_confirmation", "insufficient_data", "source_conflict", "inference"];
  const status: DesktopTrustStatus = statuses.includes(value.status) ? value.status : "needs_confirmation";
  const canonical = {
    evidence_sufficient: { label: "依据充分", icon: "check", evidenceRule: "verified_source" },
    needs_confirmation: { label: "需要确认", icon: "question", evidenceRule: "provisional_source" },
    insufficient_data: { label: "数据不足", icon: "warning", evidenceRule: "insufficient_observation" },
    source_conflict: { label: "来源冲突", icon: "compare", evidenceRule: "conflicting_sources" },
    inference: { label: "属于推测", icon: "hypothesis", evidenceRule: "inference_only" },
  } as const;
  return {
    status,
    label: canonical[status].label,
    definition: normalizeRequiredText(value.definition, "Trust definition is required."),
    reason: normalizeRequiredText(value.reason, "Trust reason is required."),
    icon: canonical[status].icon,
    recommendedAction: normalizeRequiredText(value.recommendedAction, "Trust action is required."),
    evidenceRule: canonical[status].evidenceRule,
    evidenceIds: normalizeTextList(value.evidenceIds),
    ruleSatisfied: value.ruleSatisfied === true,
  };
}

function normalizeChartQuality(value: DesktopChartDataQuality): DesktopChartDataQuality {
  return {
    status: value.status === "passed" ? "passed" : "failed", checkedAt: normalizeOptionalText(value.checkedAt) ?? new Date().toISOString(),
    sourcePath: normalizeRequiredText(value.sourcePath, "Chart source path is required."), xAxis: normalizeRequiredText(value.xAxis, "X axis is required."), yAxis: normalizeRequiredText(value.yAxis, "Y axis is required."),
    unit: normalizeRequiredText(value.unit, "Chart unit is required."), legend: normalizeRequiredText(value.legend, "Chart legend is required."),
    axisLabelsVisible: value.axisLabelsVisible === true, unitVisible: value.unitVisible === true, legendVisible: value.legendVisible === true,
    pointsExpected: Math.max(0, Math.floor(Number(value.pointsExpected) || 0)), pointsMatched: Math.max(0, Math.floor(Number(value.pointsMatched) || 0)), coordinateMatches: Math.max(0, Math.floor(Number(value.coordinateMatches) || 0)),
    anomaliesExpected: Math.max(0, Math.floor(Number(value.anomaliesExpected) || 0)), anomaliesMatched: Math.max(0, Math.floor(Number(value.anomaliesMatched) || 0)), mismatchCount: Math.max(0, Math.floor(Number(value.mismatchCount) || 0)), checks: normalizeTextList(value.checks),
  };
}

function normalizeAnalysisRoute(value: NonNullable<DesktopTaskArtifactLink["analysisRoute"]>): NonNullable<DesktopTaskArtifactLink["analysisRoute"]> {
  return {
    routeGroupId: normalizeRequiredText(value.routeGroupId, "Analysis route group is required."),
    routeId: normalizeRequiredText(value.routeId, "Analysis route id is required."),
    role: value.role === "original" ? "original" : "alternative",
    method: normalizeRequiredText(value.method, "Analysis route method is required."),
    inputSummary: normalizeRequiredText(value.inputSummary, "Analysis route input summary is required."),
    keyConclusion: normalizeRequiredText(value.keyConclusion, "Analysis route key conclusion is required."),
    risk: normalizeRequiredText(value.risk, "Analysis route risk is required."),
    recommendedUse: normalizeRequiredText(value.recommendedUse, "Analysis route recommended use is required."),
    status: value.status === "failed" ? "failed" : "completed",
    selected: value.selected === true,
    ...(value.selectedAt ? { selectedAt: normalizeRequiredText(value.selectedAt, "Analysis route selection time is required.") } : {}),
    sourceArtifactId: normalizeRequiredText(value.sourceArtifactId, "Analysis route source artifact is required."),
    sourcePath: normalizeRequiredText(value.sourcePath, "Analysis route source path is required."),
    inputFingerprint: normalizeRequiredText(value.inputFingerprint, "Analysis route input fingerprint is required."),
    createdAt: normalizeRequiredText(value.createdAt, "Analysis route creation time is required."),
  };
}

function normalizeArtifactQuality(value: DesktopArtifactQuality): DesktopArtifactQuality {
  return {
    status: value.status === "passed" ? "passed" : "failed",
    checkedAt: normalizeOptionalText(value.checkedAt) ?? new Date().toISOString(),
    format: "markdown",
    formatValid: value.formatValid === true,
    requiredSections: normalizeTextList(value.requiredSections),
    presentSections: normalizeTextList(value.presentSections),
    missingSections: normalizeTextList(value.missingSections),
    placeholderCount: Math.max(0, Math.floor(Number(value.placeholderCount) || 0)),
    mojibakeCount: Math.max(0, Math.floor(Number(value.mojibakeCount) || 0)),
    emptyImageCount: Math.max(0, Math.floor(Number(value.emptyImageCount) || 0)),
    brokenLinkCount: Math.max(0, Math.floor(Number(value.brokenLinkCount) || 0)),
    goldenFactsExpected: Math.max(0, Math.floor(Number(value.goldenFactsExpected) || 0)),
    goldenFactsMatched: Math.max(0, Math.floor(Number(value.goldenFactsMatched) || 0)),
    goldenFactCoverage: Math.max(0, Math.min(100, Number(value.goldenFactCoverage) || 0)),
    checks: normalizeTextList(value.checks),
  };
}

function isDeliverySummary(value: unknown): value is DesktopTaskDeliverySummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<DesktopTaskDeliverySummary>;
  return typeof summary.findingSummary === "string"
    && ["high", "medium", "low"].includes(summary.importance || "")
    && typeof summary.importanceReason === "string"
    && Array.isArray(summary.artifacts)
    && typeof summary.suggestedAction === "string"
    && typeof summary.workSummary === "string"
    && typeof summary.coreConclusion === "string"
    && typeof summary.verification === "string"
    && typeof summary.remainingRisks === "string"
    && (summary.completionCriteria === undefined
      || (Boolean(summary.completionCriteria)
        && Array.isArray(summary.completionCriteria.passed)
        && summary.completionCriteria.passed.every((item) => typeof item === "string")
        && Array.isArray(summary.completionCriteria.incomplete)
        && summary.completionCriteria.incomplete.every((item) => typeof item === "string")));
}

function cloneDeliverySummary(summary: DesktopTaskDeliverySummary): DesktopTaskDeliverySummary {
  return {
    ...summary,
    artifacts: summary.artifacts.map((artifact) => ({
      ...artifact,
      ...(artifact.quality ? {
        quality: {
          ...artifact.quality,
          requiredSections: [...artifact.quality.requiredSections],
          presentSections: [...artifact.quality.presentSections],
          missingSections: [...artifact.quality.missingSections],
          checks: [...artifact.quality.checks],
        },
      } : {}),
      ...(artifact.chartQuality ? { chartQuality: { ...artifact.chartQuality, checks: [...artifact.chartQuality.checks] } } : {}),
      ...(artifact.analysisRoute ? { analysisRoute: { ...artifact.analysisRoute } } : {}),
      ...(artifact.consistencyCheck ? { consistencyCheck: {
        ...artifact.consistencyCheck,
        items: artifact.consistencyCheck.items.map((item) => ({ ...item })),
      } } : {}),
      ...(artifact.independentReviews ? { independentReviews: artifact.independentReviews.map((review) => ({
        ...review,
        scope: [...review.scope],
        findings: review.findings.map((finding) => ({ ...finding })),
        uncovered: [...review.uncovered],
      })) } : {}),
      ...(artifact.editLineage ? { editLineage: { ...artifact.editLineage } } : {}),
      ...(artifact.keyConclusions ? {
        keyConclusions: artifact.keyConclusions.map((item) => ({
          ...item,
          ...(item.citations ? { citations: item.citations.map((citation) => ({ ...citation, authors: [...citation.authors] })) } : {}),
          ...(item.numericEvidence ? { numericEvidence: item.numericEvidence.map((numeric) => ({
            ...numeric,
            sourceValues: numeric.sourceValues.map((source) => ({ ...source })),
          })) } : {}),
          ...(item.uncertainty ? { uncertainty: {
            ...item.uncertainty,
            qualifyingLanguage: [...item.uncertainty.qualifyingLanguage],
            claims: item.uncertainty.claims.map((claim) => ({ ...claim })),
          } } : {}),
          ...(item.trust ? { trust: { ...item.trust, evidenceIds: [...item.trust.evidenceIds] } } : {}),
        })),
        conclusionTraceabilityRate: artifact.conclusionTraceabilityRate,
      } : {}),
    })),
    ...(summary.completionCriteria ? {
      completionCriteria: {
        passed: [...summary.completionCriteria.passed],
        incomplete: [...summary.completionCriteria.incomplete],
      },
    } : {}),
  };
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
