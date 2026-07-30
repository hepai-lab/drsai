import { randomUUID } from "crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type {
  CreateThreadRequest,
  DesktopThread,
  DesktopThreadForkMetadata,
  DesktopThreadContentSearchRequest,
  DesktopThreadContentSearchResult,
  DesktopThreadMessageSnapshot,
  DesktopThreadSnapshot,
  ChatToolTimelineEvent,
  ChatMessagePart,
  UpdateThreadRequest,
} from "../api/desktopApi";
import { DRSAI_HOME } from "./paths";
import { sanitizeStructuredTurnState } from "../api/structuredConversation";
import { replaceFileSafely } from "./atomicFileReplace";

const THREADS_FILE = join(DRSAI_HOME, "desktop", "threads.json");
const THREAD_SNAPSHOTS_FILE = join(DRSAI_HOME, "desktop", "thread-snapshots.json");
const MAX_THREADS = 200;
const MAX_ARCHIVED_THREADS = 2_000;
const MAX_THREAD_SNAPSHOTS = 2_000;
const MAX_SNAPSHOT_MESSAGES = 500;
const MAX_MESSAGE_CHARS = 200_000;
const MAX_STATUS_CHARS = 80_000;
const MAX_TITLE_CHARS = 120;
const MAX_WORKSPACE_PATH_CHARS = 2048;
const MAX_AGENT_ID_CHARS = 160;
const MAX_AGENT_NAME_CHARS = 160;
const MAX_FORK_SUMMARY_CHARS = 500;
const MAX_FORK_LIFECYCLE_MESSAGE_CHARS = 1200;
const MAX_FORK_QUEUE_MESSAGE_CHARS = 800;
const MAX_FORK_BRANCH_CLEANUP_MESSAGE_CHARS = 800;
const THREAD_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,160}$/;
const atomicJsonWriteQueues = new Map<string, Promise<void>>();
const jsonMutationQueues = new Map<string, Promise<void>>();
let staleThreadFilesCleaned = false;

export async function listThreads(): Promise<DesktopThread[]> {
  if (!staleThreadFilesCleaned) {
    staleThreadFilesCleaned = true;
    await cleanupStaleThreadTemporaryFiles();
  }
  return (await readThreads()).sort(compareThreads);
}

async function cleanupStaleThreadTemporaryFiles(): Promise<void> {
  const directory = dirname(THREADS_FILE);
  const baseName = THREADS_FILE.slice(directory.length + 1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${baseName}\\.\\d+\\.[0-9a-f-]{36}\\.tmp$`, "i");
  const cutoff = Date.now() - 5 * 60_000;
  try {
    for (const name of await readdir(directory)) {
      if (!pattern.test(name)) continue;
      const path = join(directory, name);
      try { if ((await stat(path)).mtimeMs < cutoff) await rm(path, { force: true }); } catch { /* best-effort startup hygiene */ }
    }
  } catch { /* the primary thread file remains usable without cleanup */ }
}

export async function createThread(rawRequest: unknown): Promise<DesktopThread> {
  const request = validateCreateThreadRequest(rawRequest);
  return serializeJsonMutation(THREADS_FILE, async () => {
    const now = new Date().toISOString();
    const thread: DesktopThread = {
      id: `thread-${randomUUID()}`,
      kind: request.kind,
      title: request.title || defaultTitle(request.kind),
      workspacePath: request.workspacePath,
      boundAgentId: request.boundAgentId,
      boundAgentName: request.boundAgentName,
      fork: request.fork,
      execution: request.execution,
      createdAt: now,
      updatedAt: now,
      status: "idle",
      messageCount: 0,
    };
    const threads = retainThreads([thread, ...(await readThreads())]);
    await writeThreads(threads);
    return thread;
  });
}

export async function updateThread(rawRequest: unknown): Promise<DesktopThread> {
  const request = validateUpdateThreadRequest(rawRequest);
  return serializeJsonMutation(THREADS_FILE, async () => {
    const threads = await readThreads();
    const now = new Date().toISOString();
    const existing = threads.find((thread) => thread.id === request.id);
    const next: DesktopThread = {
      id: request.id,
      kind: request.kind || existing?.kind || "chat",
      title: request.title || existing?.title || defaultTitle(request.kind || existing?.kind || "chat"),
      workspacePath: request.workspacePath ?? existing?.workspacePath,
      boundAgentId: request.boundAgentId ?? existing?.boundAgentId,
      boundAgentName: request.boundAgentName ?? existing?.boundAgentName,
      fork: request.fork ?? existing?.fork,
      execution: request.execution ?? existing?.execution,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastRunId: request.lastRunId ?? existing?.lastRunId,
      lastRequestId: request.lastRequestId ?? existing?.lastRequestId,
      runtimeSessionId: request.runtimeSessionId ?? existing?.runtimeSessionId,
      status: request.status ?? existing?.status ?? "idle",
      messageCount: request.messageCount ?? existing?.messageCount,
      pinned: request.pinned ?? existing?.pinned,
      archived: request.archived ?? existing?.archived,
      archivedAt: request.archived === true ? now : request.archived === false ? undefined : existing?.archivedAt,
      archiveSource: request.archived === true ? request.archiveSource ?? existing?.archiveSource ?? "opendrsai" : request.archived === false ? undefined : existing?.archiveSource,
      unread: request.unread ?? existing?.unread,
    };
    const withoutCurrent = threads.filter((thread) => thread.id !== request.id);
    await writeThreads(retainThreads([next, ...withoutCurrent]));
    return next;
  });
}

export async function deleteThread(rawThreadId: unknown): Promise<boolean> {
  const threadId = sanitizeThreadId(rawThreadId);
  const deleted = await serializeJsonMutation(THREADS_FILE, async () => {
    const threads = await readThreads();
    if (!threads.some((thread) => thread.id === threadId)) return false;
    await writeThreads(threads.filter((thread) => thread.id !== threadId));
    return true;
  });
  if (!deleted) return false;
  await serializeJsonMutation(THREAD_SNAPSHOTS_FILE, async () => {
    const snapshots = await readThreadSnapshots();
    if (snapshots[threadId]) {
      delete snapshots[threadId];
      await writeThreadSnapshots(snapshots);
    }
  });
  return true;
}

export async function getThreadSnapshot(rawThreadId: unknown): Promise<DesktopThreadSnapshot | null> {
  const threadId = sanitizeThreadId(rawThreadId);
  const snapshots = await readThreadSnapshots();
  return snapshots[threadId] ?? null;
}

export async function searchThreadMessages(
  rawRequest: unknown,
): Promise<DesktopThreadContentSearchResult[]> {
  if (!rawRequest || typeof rawRequest !== "object") return [];
  const request = rawRequest as Partial<DesktopThreadContentSearchRequest>;
  const query = typeof request.query === "string" ? request.query.trim().slice(0, 200) : "";
  if (!query) return [];

  const allowedThreadIds = Array.isArray(request.threadIds)
    ? new Set(request.threadIds.slice(0, MAX_THREADS).map(sanitizeThreadId))
    : null;
  const limit = Math.max(1, Math.min(50, Math.trunc(request.limit ?? 24)));
  const normalizedQuery = query.toLocaleLowerCase();
  const snapshots = Object.values(await readThreadSnapshots())
    .filter((snapshot) => !allowedThreadIds || allowedThreadIds.has(snapshot.threadId))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const results: DesktopThreadContentSearchResult[] = [];

  for (const snapshot of snapshots) {
    const messages = [...snapshot.messages].reverse();
    for (const message of messages) {
      if (message.role === "system") continue;
      const normalizedContent = message.content.replace(/\s+/g, " ").trim();
      const matchIndex = normalizedContent.toLocaleLowerCase().indexOf(normalizedQuery);
      if (matchIndex < 0) continue;
      results.push({
        threadId: snapshot.threadId,
        messageId: message.id,
        role: message.role,
        snippet: createSearchSnippet(normalizedContent, matchIndex, query.length),
        updatedAt: snapshot.updatedAt,
      });
      break;
    }
    if (results.length >= limit) break;
  }

  return results;
}

function createSearchSnippet(content: string, matchIndex: number, matchLength: number): string {
  const contextLength = 72;
  const start = Math.max(0, matchIndex - contextLength);
  const end = Math.min(content.length, matchIndex + matchLength + contextLength);
  return `${start > 0 ? "..." : ""}${content.slice(start, end)}${end < content.length ? "..." : ""}`;
}

export async function updateThreadSnapshot(rawRequest: unknown): Promise<DesktopThreadSnapshot> {
  const snapshot = validateThreadSnapshot(rawRequest);
  return serializeJsonMutation(THREAD_SNAPSHOTS_FILE, async () => {
    const snapshots = await readThreadSnapshots();
    const nextSnapshots = {
      ...snapshots,
      [snapshot.threadId]: snapshot,
    };
    await writeThreadSnapshots(nextSnapshots);
    return snapshot;
  });
}

export async function upsertThreadFromRun(input: {
  id: string;
  kind: DesktopThread["kind"];
  title?: string;
  workspacePath?: string;
  boundAgentId?: string;
  boundAgentName?: string;
  lastRunId?: string;
  lastRequestId?: string;
  runtimeSessionId?: string;
  status?: DesktopThread["status"];
  messageCount?: number;
}): Promise<DesktopThread> {
  return updateThread(input);
}

async function readThreads(): Promise<DesktopThread[]> {
  try {
    const parsed = parseStoredJson(await readFile(THREADS_FILE, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return retainThreads(parsed.filter(isThread));
  } catch {
    return [];
  }
}

async function writeThreads(threads: DesktopThread[]): Promise<void> {
  await writeAtomicJson(THREADS_FILE, threads);
}

function retainThreads(threads: DesktopThread[]): DesktopThread[] {
  const active: DesktopThread[] = [];
  const archived: DesktopThread[] = [];
  for (const thread of threads) {
    (thread.archived ? archived : active).push(thread);
  }
  return [...active.slice(0, MAX_THREADS), ...archived.slice(0, MAX_ARCHIVED_THREADS)];
}

async function readThreadSnapshots(): Promise<Record<string, DesktopThreadSnapshot>> {
  try {
    const parsed = parseStoredJson(await readFile(THREAD_SNAPSHOTS_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const entries = Object.values(parsed)
      .map((value) => {
        try {
          return validateThreadSnapshot(value);
        } catch {
          return null;
        }
      })
      .filter((value): value is DesktopThreadSnapshot => Boolean(value))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_THREAD_SNAPSHOTS);
    return Object.fromEntries(entries.map((snapshot) => [snapshot.threadId, snapshot]));
  } catch {
    return {};
  }
}

async function writeThreadSnapshots(snapshots: Record<string, DesktopThreadSnapshot>): Promise<void> {
  const capped = Object.fromEntries(
    Object.values(snapshots)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_THREAD_SNAPSHOTS)
      .map((snapshot) => [snapshot.threadId, snapshot]),
  );
  await writeAtomicJson(THREAD_SNAPSHOTS_FILE, capped);
}

async function serializeJsonMutation<T>(path: string, mutation: () => Promise<T>): Promise<T> {
  const previousMutation = jsonMutationQueues.get(path) ?? Promise.resolve();
  const result = previousMutation.catch(() => undefined).then(mutation);
  const queueTail = result.then(() => undefined, () => undefined);
  jsonMutationQueues.set(path, queueTail);
  try {
    return await result;
  } finally {
    if (jsonMutationQueues.get(path) === queueTail) jsonMutationQueues.delete(path);
  }
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  const previousWrite = atomicJsonWriteQueues.get(path) ?? Promise.resolve();
  const pendingWrite = previousWrite
    .catch(() => undefined)
    .then(() => persistAtomicJson(path, value));
  atomicJsonWriteQueues.set(path, pendingWrite);
  try {
    await pendingWrite;
  } finally {
    if (atomicJsonWriteQueues.get(path) === pendingWrite) atomicJsonWriteQueues.delete(path);
  }
}

async function persistAtomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await replaceFileSafely(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function parseStoredJson(serialized: string): unknown {
  try {
    return JSON.parse(serialized);
  } catch {
    // A legacy interrupted write can leave a single string-valued property
    // without its closing quote. Repair only that narrow, line-oriented form;
    // all repaired data is rewritten atomically on the next normal update.
    const repaired = serialized.replace(
      /^(\s*"(?:id|kind|title|workspacePath|boundAgentId|boundAgentName|createdAt|updatedAt|lastRunId|lastRequestId|runtimeSessionId|status|archivedAt|archiveSource)"\s*:\s*".*?)(,\s*)$/gm,
      (line, prefix: string, suffix: string) => prefix.endsWith('"') ? line : `${prefix}"${suffix}`,
    );
    return JSON.parse(repaired);
  }
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
    boundAgentId: sanitizeOptionalAgentText(request.boundAgentId, MAX_AGENT_ID_CHARS, "Thread agent id is invalid."),
    boundAgentName: sanitizeOptionalAgentText(request.boundAgentName, MAX_AGENT_NAME_CHARS, "Thread agent name is invalid."),
    fork: sanitizeForkMetadata(request.fork),
    execution: sanitizeExecutionBinding(request.execution),
  };
}

function validateUpdateThreadRequest(rawRequest: unknown): UpdateThreadRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Thread update must be an object.");
  }
  const request = rawRequest as Partial<UpdateThreadRequest>;
  const id = sanitizeThreadId(request.id);
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
    id,
    kind: request.kind,
    title: sanitizeTitle(request.title),
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
    boundAgentId: sanitizeOptionalAgentText(request.boundAgentId, MAX_AGENT_ID_CHARS, "Thread agent id is invalid."),
    boundAgentName: sanitizeOptionalAgentText(request.boundAgentName, MAX_AGENT_NAME_CHARS, "Thread agent name is invalid."),
    fork: sanitizeForkMetadata(request.fork),
    execution: sanitizeExecutionBinding(request.execution),
    lastRunId: sanitizeOptionalId(request.lastRunId, "Thread run id is invalid."),
    lastRequestId: sanitizeOptionalId(request.lastRequestId, "Thread request id is invalid."),
    runtimeSessionId: sanitizeOptionalId(request.runtimeSessionId, "Thread Runtime session id is invalid."),
    status: request.status,
    messageCount: Number.isFinite(request.messageCount) ? Math.max(0, Number(request.messageCount)) : undefined,
    pinned: typeof request.pinned === "boolean" ? request.pinned : undefined,
    archived: typeof request.archived === "boolean" ? request.archived : undefined,
    archiveSource: request.archiveSource === "opendrsai" || request.archiveSource === "codex" ? request.archiveSource : undefined,
    unread: typeof request.unread === "boolean" ? request.unread : undefined,
  };
}

function sanitizeExecutionBinding(value: unknown): DesktopThread["execution"] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("Thread execution binding is invalid.");
  const binding = value as Partial<NonNullable<DesktopThread["execution"]>>;
  const validId = (candidate: unknown): candidate is string => typeof candidate === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(candidate);
  if (!validId(binding.sourceWorkspaceId) || !validId(binding.workspaceId) || !validId(binding.worktreeId)) {
    throw new Error("Thread execution resource identity is invalid.");
  }
  const canonicalPath = sanitizeWorkspacePath(binding.canonicalPath);
  if (!canonicalPath) throw new Error("Thread execution Workspace path is invalid.");
  return { sourceWorkspaceId: binding.sourceWorkspaceId, workspaceId: binding.workspaceId, worktreeId: binding.worktreeId, canonicalPath };
}

function validateThreadSnapshot(rawRequest: unknown): DesktopThreadSnapshot {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Thread snapshot must be an object.");
  }
  const request = rawRequest as Partial<DesktopThreadSnapshot>;
  const messages = Array.isArray(request.messages)
    ? request.messages.slice(0, MAX_SNAPSHOT_MESSAGES).map(sanitizeSnapshotMessage)
    : [];
  const updatedAt =
    typeof request.updatedAt === "number" && Number.isFinite(request.updatedAt)
      ? request.updatedAt
      : Date.now();
  const title = sanitizeTitle(request.title) || defaultTitle("chat");
  return {
    threadId: sanitizeThreadId(request.threadId),
    title,
    messages,
    updatedAt,
    messageCount: Number.isFinite(request.messageCount)
      ? Math.max(0, Number(request.messageCount))
      : messages.filter((message) => message.id !== "welcome").length,
  };
}

function sanitizeSnapshotMessage(rawMessage: unknown, index: number): DesktopThreadMessageSnapshot {
  if (!rawMessage || typeof rawMessage !== "object") {
    throw new Error("Thread snapshot message is invalid.");
  }
  const message = rawMessage as Partial<DesktopThreadMessageSnapshot>;
  if (message.role !== "system" && message.role !== "user" && message.role !== "assistant") {
    throw new Error("Thread snapshot message role is invalid.");
  }
  if (typeof message.content !== "string") {
    throw new Error("Thread snapshot message content is invalid.");
  }
  const id =
    typeof message.id === "string" && message.id.trim() && !/[\r\n]/.test(message.id)
      ? message.id.trim().slice(0, 160)
      : `message-${index + 1}`;
  const structuredTurn = sanitizeStructuredTurnState(message.structuredTurn);
  return {
    id,
    role: message.role,
    content: message.content.slice(0, MAX_MESSAGE_CHARS),
    ...(message.streaming ? { streaming: true } : {}),
    ...(message.error ? { error: true } : {}),
    ...(typeof message.statusContent === "string"
      ? { statusContent: message.statusContent.slice(0, MAX_STATUS_CHARS) }
      : {}),
    ...(typeof message.reasoningContent === "string"
      ? { reasoningContent: message.reasoningContent.slice(0, MAX_STATUS_CHARS) }
      : {}),
    ...(Array.isArray(message.toolTimeline)
      ? { toolTimeline: message.toolTimeline.slice(-20).flatMap(sanitizeToolTimelineEvent) }
      : {}),
    ...(Array.isArray(message.parts)
      ? { parts: message.parts.slice(0, 64).flatMap(sanitizeMessagePart) }
      : {}),
    ...(structuredTurn ? { structuredTurn } : {}),
    ...(typeof message.startedAt === "number" && Number.isFinite(message.startedAt)
      ? { startedAt: message.startedAt }
      : {}),
    ...(typeof message.lastEventAt === "number" && Number.isFinite(message.lastEventAt)
      ? { lastEventAt: message.lastEventAt }
      : {}),
  };
}

function sanitizeMessagePart(raw: unknown): ChatMessagePart[] {
  if (!raw || typeof raw !== "object") return [];
  const part = raw as Record<string, unknown>;
  const id = typeof part.id === "string" ? part.id.trim().slice(0, 200) : "";
  const type = typeof part.type === "string" ? part.type : "";
  const allowedStatuses = ["pending", "running", "completed", "error", "cancelled"] as const;
  const status = typeof part.status === "string" && (allowedStatuses as readonly string[]).includes(part.status)
    ? part.status as (typeof allowedStatuses)[number]
    : "completed";
  if (!id) return [];
  if (type === "text" && typeof part.text === "string") {
    return [{ id, type, text: part.text.slice(0, MAX_MESSAGE_CHARS), format: part.format === "plain" ? "plain" : "markdown", status }];
  }
  if (type === "reasoning" && typeof part.text === "string") {
    return [{ id, type, text: part.text.slice(0, MAX_STATUS_CHARS), visibility: part.visibility === "summary" ? "summary" : "raw", status }];
  }
  if (type === "status" && typeof part.text === "string") {
    return [{ id, type, text: part.text.slice(0, MAX_STATUS_CHARS), ...(typeof part.level === "string" ? { level: part.level.slice(0, 40) } : {}), status }];
  }
  if (type === "error" && typeof part.message === "string") {
    return [{ id, type, message: part.message.slice(0, MAX_STATUS_CHARS), ...(typeof part.code === "string" ? { code: part.code.slice(0, 120) } : {}), retryable: part.retryable === true, status: "error" }];
  }
  if (type === "file" && typeof part.name === "string" && typeof part.path === "string") {
    return [{ id, type, name: part.name.slice(0, 260), path: part.path.slice(0, 2048), ...(typeof part.mime === "string" ? { mime: part.mime.slice(0, 120) } : {}), status }];
  }
  if (type === "patch" && typeof part.diff === "string") {
    return [{ id, type, diff: part.diff.slice(0, MAX_STATUS_CHARS), ...(typeof part.path === "string" ? { path: part.path.slice(0, 2048) } : {}), status }];
  }
  if (type === "approval" && typeof part.requestId === "string" && typeof part.prompt === "string") {
    return [{ id, type, requestId: part.requestId.slice(0, 160), prompt: part.prompt.slice(0, MAX_STATUS_CHARS), status }];
  }
  if (type === "tool") {
    const events = sanitizeToolTimelineEvent(part.event);
    return events.length ? [{ id, type, event: events[0], status }] : [];
  }
  return [];
}

function sanitizeToolTimelineEvent(raw: unknown): ChatToolTimelineEvent[] {
  if (!raw || typeof raw !== "object") return [];
  const event = raw as Record<string, unknown>;
  const kind = event.kind;
  if (!(["tool_call", "tool_result", "log", "diff", "artifact"] as unknown[]).includes(kind)) return [];
  const id = typeof event.id === "string" ? event.id.slice(0, 160) : "";
  const title = typeof event.title === "string" ? event.title.slice(0, 500) : "";
  if (!id || !title) return [];
  const statuses = ["started", "running", "completed", "failed"];
  return [{
    id,
    kind: kind as "tool_call" | "tool_result" | "log" | "diff" | "artifact",
    title,
    ...(typeof event.status === "string" && statuses.includes(event.status) ? { status: event.status as "started" | "running" | "completed" | "failed" } : {}),
    ...(typeof event.content === "string" ? { content: event.content.slice(0, MAX_STATUS_CHARS) } : {}),
    ...(typeof event.toolName === "string" ? { toolName: event.toolName.slice(0, 160) } : {}),
    ...(typeof event.path === "string" ? { path: event.path.slice(0, 2048) } : {}),
    ...(typeof event.timestamp === "string" ? { timestamp: event.timestamp.slice(0, 80) } : {}),
    ...(typeof event.level === "string" ? { level: event.level.slice(0, 40) } : {}),
  }];
}

function sanitizeThreadId(value: unknown): string {
  if (typeof value !== "string" || !THREAD_ID_PATTERN.test(value) || /[\r\n]/.test(value)) {
    throw new Error("Thread id is invalid.");
  }
  return value;
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

function sanitizeOptionalAgentText(value: unknown, maxChars: number, message: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxChars || /[\r\n]/.test(value)) {
    throw new Error(message);
  }
  return value.trim() || undefined;
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
    worktreeId: sanitizeOptionalId(fork.worktreeId, "Fork Worktree id is invalid."),
    sourceWorkspaceId: sanitizeOptionalId(fork.sourceWorkspaceId, "Fork source Workspace id is invalid."),
    workspaceId: sanitizeOptionalId(fork.workspaceId, "Fork execution Workspace id is invalid."),
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
