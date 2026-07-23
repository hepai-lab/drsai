import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  ManagerPresentationGenerateRequest,
  ManagerPresentationProgressEvent,
  ManagerPresentationRecoveryRequest,
  ManagerPresentationRecoveryResult,
  ManagerPresentationRecoveryDecisionRequest,
  ManagerPresentationRecoveryDecisionResult,
  ManagerPresentationStageArtifact,
} from "../api/desktopApi";
import { DRSAI_HOME } from "./paths";

let tasksPath = join(DRSAI_HOME, "desktop", "manager-presentation-tasks.json");
const ACTIVE_PHASES = new Set([
  "analyzing",
  "planning",
  "generating",
  "validating",
  "pausing",
  "paused",
  "resuming",
  "cancelling",
  "interrupted",
]);

interface PersistedManagerPresentationTask {
  requestId: string;
  workspacePath: string;
  sourcePath: string;
  audience?: ManagerPresentationGenerateRequest["audience"];
  phase: ManagerPresentationProgressEvent["phase"];
  activeStage?: ManagerPresentationProgressEvent["activeStage"];
  progress: number;
  message: string;
  outputPath?: string;
  requirements?: string[];
  stageArtifacts?: ManagerPresentationStageArtifact[];
  createdAt: string;
  updatedAt: string;
}

export function configureManagerPresentationTaskStorage(path?: string): void {
  tasksPath = path ? resolve(path) : join(DRSAI_HOME, "desktop", "manager-presentation-tasks.json");
}

export function recordManagerPresentationStart(request: ManagerPresentationGenerateRequest): void {
  const now = new Date().toISOString();
  const tasks = readTasks();
  const previous = tasks.find((task) => task.requestId === request.requestId);
  if (previous && ACTIVE_PHASES.has(previous.phase)) cleanupPartialArtifacts(previous);
  const next: PersistedManagerPresentationTask = {
    requestId: request.requestId,
    workspacePath: resolve(request.workspacePath),
    sourcePath: resolve(request.sourcePath),
    audience: request.audience,
    phase: "analyzing",
    activeStage: "analyzing",
    progress: 1,
    message: "正在恢复或启动管理者版 PPT 生成任务。",
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    requirements: sanitizeRequirements(request.requirements),
    stageArtifacts: sanitizeStageArtifacts(previous?.stageArtifacts),
  };
  writeTasks([next, ...tasks.filter((task) => task.requestId !== request.requestId)]);
}

export function recordManagerPresentationProgress(
  request: ManagerPresentationGenerateRequest,
  event: ManagerPresentationProgressEvent,
): void {
  const tasks = readTasks();
  const previous = tasks.find((task) => task.requestId === event.requestId);
  const now = new Date().toISOString();
  const next: PersistedManagerPresentationTask = {
    requestId: event.requestId,
    workspacePath: resolve(request.workspacePath),
    sourcePath: resolve(request.sourcePath),
    audience: request.audience ?? previous?.audience,
    phase: event.phase,
    activeStage: event.activeStage ?? previous?.activeStage,
    progress: event.progress,
    message: event.message,
    outputPath: event.outputPath ?? previous?.outputPath,
    requirements: sanitizeRequirements(request.requirements ?? previous?.requirements),
    stageArtifacts: sanitizeStageArtifacts(event.stageArtifacts ?? previous?.stageArtifacts),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  writeTasks([next, ...tasks.filter((task) => task.requestId !== event.requestId)]);
}

export function getManagerPresentationRecovery(
  request: ManagerPresentationRecoveryRequest,
): ManagerPresentationRecoveryResult | null {
  const workspacePath = resolve(request.workspacePath);
  const sourcePath = resolve(request.sourcePath);
  const task = readTasks().find((candidate) =>
    ACTIVE_PHASES.has(candidate.phase)
    && samePath(candidate.workspacePath, workspacePath)
    && samePath(candidate.sourcePath, sourcePath));
  if (!task) return null;
  return {
    requestId: task.requestId,
    workspacePath,
    sourcePath,
    audience: task.audience,
    phase: "interrupted",
    activeStage: task.activeStage,
    progress: task.progress,
    message: "检测到上次关闭应用时未完成的 PPT 任务，可以从安全检查点继续。",
    outputPath: task.outputPath,
    requirements: task.requirements,
    stageArtifacts: sanitizeStageArtifacts(task.stageArtifacts),
    updatedAt: task.updatedAt,
  };
}

export function resolveManagerPresentationRecovery(
  request: ManagerPresentationRecoveryDecisionRequest,
): ManagerPresentationRecoveryDecisionResult {
  const workspacePath = resolve(request.workspacePath);
  const sourcePath = resolve(request.sourcePath);
  const tasks = readTasks();
  const task = tasks.find((candidate) =>
    candidate.requestId === request.requestId
    && ACTIVE_PHASES.has(candidate.phase)
    && samePath(candidate.workspacePath, workspacePath)
    && samePath(candidate.sourcePath, sourcePath));
  if (!task) return { requestId: request.requestId, decision: request.decision, accepted: false };
  cleanupPartialArtifacts(task);
  const now = new Date().toISOString();
  const terminal: PersistedManagerPresentationTask = {
    ...task,
    phase: "cancelled",
    progress: 100,
    message: request.decision === "restart"
      ? "上次中断的任务已结束，正在以相同材料重新开始。"
      : "已放弃上次中断的任务；原始材料和已完成成果均已保留。",
    updatedAt: now,
  };
  writeTasks([terminal, ...tasks.filter((candidate) => candidate.requestId !== task.requestId)]);
  return { requestId: request.requestId, decision: request.decision, accepted: true };
}

function cleanupPartialArtifacts(task: PersistedManagerPresentationTask): void {
  if (!task.outputPath) return;
  const workspacePath = resolve(task.workspacePath);
  const outputPath = resolve(task.outputPath);
  const pathWithinWorkspace = relative(workspacePath, outputPath);
  if (pathWithinWorkspace.startsWith("..") || isAbsolute(pathWithinWorkspace)) return;
  if (extname(outputPath).toLowerCase() !== ".pptx") return;
  for (const path of [outputPath, outputPath.replace(/\.pptx$/i, ".provenance.json")]) {
    if (existsSync(path)) unlinkSync(path);
  }
}

function readTasks(): PersistedManagerPresentationTask[] {
  for (const path of [tasksPath, `${tasksPath}.bak`]) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (Array.isArray(parsed)) return parsed.filter(isTask).slice(0, 50);
    } catch {
      // A backup remains readable if the process stopped during atomic replacement.
    }
  }
  return [];
}

function writeTasks(tasks: PersistedManagerPresentationTask[]): void {
  mkdirSync(dirname(tasksPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${tasksPath}.${process.pid}.${Date.now()}.tmp`;
  const backupPath = `${tasksPath}.bak`;
  writeFileSync(temporaryPath, `${JSON.stringify(tasks.slice(0, 50), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (existsSync(backupPath)) unlinkSync(backupPath);
  if (existsSync(tasksPath)) renameSync(tasksPath, backupPath);
  try {
    renameSync(temporaryPath, tasksPath);
    chmodSync(tasksPath, 0o600);
    if (existsSync(backupPath)) unlinkSync(backupPath);
  } catch (error) {
    if (!existsSync(tasksPath) && existsSync(backupPath)) renameSync(backupPath, tasksPath);
    throw error;
  }
}

function isTask(value: unknown): value is PersistedManagerPresentationTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<PersistedManagerPresentationTask>;
  return typeof task.requestId === "string"
    && typeof task.workspacePath === "string"
    && typeof task.sourcePath === "string"
    && typeof task.phase === "string"
    && typeof task.progress === "number"
    && typeof task.message === "string"
    && typeof task.createdAt === "string"
    && typeof task.updatedAt === "string";
}

function samePath(left: string, right: string): boolean {
  const resolvedLeft = resolve(left);
  const resolvedRight = resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function sanitizeRequirements(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 240) : "")
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
    .slice(0, 5);
}

function sanitizeStageArtifacts(values: ManagerPresentationStageArtifact[] | undefined): ManagerPresentationStageArtifact[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value) => value
    && typeof value.id === "string"
    && typeof value.requestId === "string"
    && ["analysis", "outline"].includes(value.stage)
    && typeof value.label === "string"
    && typeof value.summary === "string"
    && typeof value.path === "string"
    && typeof value.createdAt === "string"
    && typeof value.taskElapsedMs === "number"
    && value.temporary === true
    && value.immutable === true).slice(0, 8);
}
