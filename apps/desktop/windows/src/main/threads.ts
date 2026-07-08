import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type { CreateThreadRequest, DesktopThread, DesktopThreadForkMetadata, UpdateThreadRequest } from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";

const THREADS_FILE = join(DRSAI_HOME, "desktop", "threads.json");
const MAX_THREADS = 200;
const MAX_TITLE_CHARS = 120;
const MAX_WORKSPACE_PATH_CHARS = 2048;
const MAX_FORK_SUMMARY_CHARS = 500;
const MAX_FORK_LIFECYCLE_MESSAGE_CHARS = 1200;
const MAX_FORK_QUEUE_MESSAGE_CHARS = 800;
const MAX_FORK_BRANCH_CLEANUP_MESSAGE_CHARS = 800;
const THREAD_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,160}$/;

export async function listThreads(): Promise<DesktopThread[]> {
  return (await readThreads()).sort(compareThreads);
}

export async function createThread(rawRequest: unknown): Promise<DesktopThread> {
  const request = validateCreateThreadRequest(rawRequest);
  const now = new Date().toISOString();
  const thread: DesktopThread = {
    id: `thread-${randomUUID()}`,
    kind: request.kind,
    title: request.title || defaultTitle(request.kind),
    workspacePath: request.workspacePath,
    fork: request.fork,
    createdAt: now,
    updatedAt: now,
    status: "idle",
    messageCount: 0,
  };
  const threads = [thread, ...(await readThreads())].slice(0, MAX_THREADS);
  await writeThreads(threads);
  return thread;
}

export async function updateThread(rawRequest: unknown): Promise<DesktopThread> {
  const request = validateUpdateThreadRequest(rawRequest);
  const threads = await readThreads();
  const now = new Date().toISOString();
  const existing = threads.find((thread) => thread.id === request.id);
  const next: DesktopThread = {
    id: request.id,
    kind: request.kind || existing?.kind || "chat",
    title: request.title || existing?.title || defaultTitle(request.kind || existing?.kind || "chat"),
    workspacePath: request.workspacePath ?? existing?.workspacePath,
    fork: request.fork ?? existing?.fork,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastRunId: request.lastRunId ?? existing?.lastRunId,
    lastRequestId: request.lastRequestId ?? existing?.lastRequestId,
    status: request.status ?? existing?.status ?? "idle",
    messageCount: request.messageCount ?? existing?.messageCount,
    pinned: request.pinned ?? existing?.pinned,
    archived: request.archived ?? existing?.archived,
    unread: request.unread ?? existing?.unread,
  };
  const withoutCurrent = threads.filter((thread) => thread.id !== request.id);
  await writeThreads([next, ...withoutCurrent].slice(0, MAX_THREADS));
  return next;
}

export async function upsertThreadFromRun(input: {
  id: string;
  kind: DesktopThread["kind"];
  title?: string;
  workspacePath?: string;
  lastRunId?: string;
  lastRequestId?: string;
  status?: DesktopThread["status"];
  messageCount?: number;
}): Promise<DesktopThread> {
  return updateThread(input);
}

async function readThreads(): Promise<DesktopThread[]> {
  try {
    const parsed = JSON.parse(await readFile(THREADS_FILE, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isThread).slice(0, MAX_THREADS);
  } catch {
    return [];
  }
}

async function writeThreads(threads: DesktopThread[]): Promise<void> {
  await mkdir(dirname(THREADS_FILE), { recursive: true });
  await writeFile(THREADS_FILE, `${JSON.stringify(threads, null, 2)}\n`, "utf8");
}

function validateCreateThreadRequest(rawRequest: unknown): CreateThreadRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Thread request must be an object.");
  }
  const request = rawRequest as Partial<CreateThreadRequest>;
  if (request.kind !== "chat" && request.kind !== "agent_run") {
    throw new Error("Thread kind is invalid.");
  }
  return {
    kind: request.kind,
    title: sanitizeTitle(request.title),
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
    fork: sanitizeForkMetadata(request.fork),
  };
}

function validateUpdateThreadRequest(rawRequest: unknown): UpdateThreadRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Thread update must be an object.");
  }
  const request = rawRequest as Partial<UpdateThreadRequest>;
  if (typeof request.id !== "string" || !THREAD_ID_PATTERN.test(request.id) || /[\r\n]/.test(request.id)) {
    throw new Error("Thread id is invalid.");
  }
  if (request.kind !== undefined && request.kind !== "chat" && request.kind !== "agent_run") {
    throw new Error("Thread kind is invalid.");
  }
  if (
    request.status !== undefined &&
    request.status !== "idle" &&
    request.status !== "running" &&
    request.status !== "error"
  ) {
    throw new Error("Thread status is invalid.");
  }
  return {
    id: request.id,
    kind: request.kind,
    title: sanitizeTitle(request.title),
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
    fork: sanitizeForkMetadata(request.fork),
    lastRunId: sanitizeOptionalId(request.lastRunId, "Thread run id is invalid."),
    lastRequestId: sanitizeOptionalId(request.lastRequestId, "Thread request id is invalid."),
    status: request.status,
    messageCount: Number.isFinite(request.messageCount) ? Math.max(0, Number(request.messageCount)) : undefined,
    pinned: typeof request.pinned === "boolean" ? request.pinned : undefined,
    archived: typeof request.archived === "boolean" ? request.archived : undefined,
    unread: typeof request.unread === "boolean" ? request.unread : undefined,
  };
}

function sanitizeTitle(title: unknown): string | undefined {
  if (title === undefined) return undefined;
  if (typeof title !== "string" || /[\r\n]/.test(title)) {
    throw new Error("Thread title is invalid.");
  }
  return title.trim().slice(0, MAX_TITLE_CHARS) || undefined;
}

function sanitizeWorkspacePath(path: unknown): string | undefined {
  if (path === undefined) return undefined;
  if (typeof path !== "string" || path.length > MAX_WORKSPACE_PATH_CHARS || /[\r\n]/.test(path)) {
    throw new Error("Thread workspace path is invalid.");
  }
  return path.trim() || undefined;
}

function sanitizeForkMetadata(value: unknown): DesktopThreadForkMetadata | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    throw new Error("Thread fork metadata is invalid.");
  }
  const fork = value as Partial<DesktopThreadForkMetadata>;
  const lifecycleStatus =
    fork.lifecycleStatus === "merge_pending" ||
    fork.lifecycleStatus === "merged" ||
    fork.lifecycleStatus === "cleanup_pending" ||
    fork.lifecycleStatus === "closed"
      ? fork.lifecycleStatus
      : "active";
  const queueStatus =
    fork.queueStatus === "waiting_approval" ||
    fork.queueStatus === "ready" ||
    fork.queueStatus === "running" ||
    fork.queueStatus === "blocked" ||
    fork.queueStatus === "completed"
      ? fork.queueStatus
      : fork.queueStatus === "queued"
        ? "queued"
        : undefined;
  return {
    sourceWorkspacePath: sanitizeRequiredPath(fork.sourceWorkspacePath, "Fork source workspace path is invalid."),
    repoRoot: sanitizeRequiredPath(fork.repoRoot, "Fork repo root is invalid."),
    worktreePath: sanitizeRequiredPath(fork.worktreePath, "Fork worktree path is invalid."),
    branch: sanitizeRequiredText(fork.branch, "Fork branch is invalid.", 200),
    baseRef: sanitizeRequiredText(fork.baseRef, "Fork base ref is invalid.", 80),
    createdAt: sanitizeIsoLike(fork.createdAt) || new Date().toISOString(),
    sourceHasChanges: Boolean(fork.sourceHasChanges),
    sourceStatusSummary:
      typeof fork.sourceStatusSummary === "string"
        ? fork.sourceStatusSummary.replace(/[\r\n]+/g, "; ").trim().slice(0, MAX_FORK_SUMMARY_CHARS) || undefined
        : undefined,
    lifecycleStatus,
    lifecycleMessage:
      typeof fork.lifecycleMessage === "string"
        ? fork.lifecycleMessage.replace(/\u0000/g, "").trim().slice(0, MAX_FORK_LIFECYCLE_MESSAGE_CHARS) || undefined
        : undefined,
    lifecycleUpdatedAt: sanitizeIsoLike(fork.lifecycleUpdatedAt),
    mergedCommit:
      typeof fork.mergedCommit === "string" && /^[a-zA-Z0-9._/-]{1,80}$/.test(fork.mergedCommit)
        ? fork.mergedCommit
        : undefined,
    branchCleanupStatus:
      fork.branchCleanupStatus === "pending" ||
      fork.branchCleanupStatus === "deleted" ||
      fork.branchCleanupStatus === "archived" ||
      fork.branchCleanupStatus === "retained"
        ? fork.branchCleanupStatus
        : undefined,
    branchCleanupMessage:
      typeof fork.branchCleanupMessage === "string"
        ? fork.branchCleanupMessage.replace(/\u0000/g, "").trim().slice(0, MAX_FORK_BRANCH_CLEANUP_MESSAGE_CHARS) || undefined
        : undefined,
    archivedBranch:
      typeof fork.archivedBranch === "string" && /^[a-zA-Z0-9._/-]{1,200}$/.test(fork.archivedBranch)
        ? fork.archivedBranch
        : undefined,
    queueGroupId: sanitizeOptionalId(fork.queueGroupId, "Fork queue group id is invalid."),
    queueIndex: Number.isInteger(fork.queueIndex) && Number(fork.queueIndex) > 0 ? Number(fork.queueIndex) : undefined,
    queueSize: Number.isInteger(fork.queueSize) && Number(fork.queueSize) > 0 ? Number(fork.queueSize) : undefined,
    queueStatus,
    queueApprovalId: sanitizeOptionalId(fork.queueApprovalId, "Fork queue approval id is invalid."),
    queueAgentHint:
      typeof fork.queueAgentHint === "string"
        ? fork.queueAgentHint.replace(/[\r\n]+/g, " ").trim().slice(0, 160) || undefined
        : undefined,
    queueAgentId:
      typeof fork.queueAgentId === "string"
        ? fork.queueAgentId.replace(/[\r\n]+/g, " ").trim().slice(0, 120) || undefined
        : undefined,
    queueAgentName:
      typeof fork.queueAgentName === "string"
        ? fork.queueAgentName.replace(/[\r\n]+/g, " ").trim().slice(0, 160) || undefined
        : undefined,
    queueMessage:
      typeof fork.queueMessage === "string"
        ? fork.queueMessage.replace(/\u0000/g, "").trim().slice(0, MAX_FORK_QUEUE_MESSAGE_CHARS) || undefined
        : undefined,
    queueUpdatedAt: sanitizeIsoLike(fork.queueUpdatedAt),
  };
}

function sanitizeRequiredPath(value: unknown, message: string): string {
  const path = sanitizeWorkspacePath(value);
  if (!path) throw new Error(message);
  return path;
}

function sanitizeRequiredText(value: unknown, message: string, maxChars: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxChars || /[\r\n]/.test(value)) {
    throw new Error(message);
  }
  return value.trim();
}

function sanitizeIsoLike(value: unknown): string | undefined {
  if (typeof value !== "string" || /[\r\n]/.test(value)) return undefined;
  const trimmed = value.trim();
  return trimmed && Number.isFinite(Date.parse(trimmed)) ? trimmed : undefined;
}

function sanitizeOptionalId(value: unknown, message: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !THREAD_ID_PATTERN.test(value) || /[\r\n]/.test(value)) {
    throw new Error(message);
  }
  return value;
}

function isThread(value: unknown): value is DesktopThread {
  const thread = value as DesktopThread;
  return Boolean(
    thread &&
      typeof thread.id === "string" &&
      THREAD_ID_PATTERN.test(thread.id) &&
      (thread.kind === "chat" || thread.kind === "agent_run") &&
      typeof thread.title === "string" &&
      typeof thread.createdAt === "string" &&
      typeof thread.updatedAt === "string" &&
      (thread.fork === undefined || isForkMetadata(thread.fork)),
  );
}

function isForkMetadata(value: unknown): boolean {
  try {
    return Boolean(sanitizeForkMetadata(value));
  } catch {
    return false;
  }
}

function compareThreads(left: DesktopThread, right: DesktopThread): number {
  if (Boolean(left.pinned) !== Boolean(right.pinned)) {
    return left.pinned ? -1 : 1;
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

function defaultTitle(kind: DesktopThread["kind"]): string {
  return kind === "agent_run" ? "Agent run" : "New chat";
}
