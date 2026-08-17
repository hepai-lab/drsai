import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import { dirname, join, normalize } from "path";
import type {
  CreateThreadRequest,
  DesktopThread,
  DesktopThreadListRequest,
  DesktopThreadForkMetadata,
  DesktopThreadContentSearchRequest,
  DesktopThreadContentSearchResult,
  DesktopThreadMessageSnapshot,
  DesktopThreadSnapshot,
  DesktopDuplexVoiceHistoryAppendRequest,
  ChatAttachment,
  ChatToolTimelineEvent,
  ChatMessagePart,
  UpdateThreadRequest,
} from "../api/desktopApi";
import { LEGACY_MY_DRSAI_AGENT_ID, LOCAL_OPENDRSAI_AGENT_NAME } from "../api/desktopApi";
import {
  canonicalizeSidebarThreads,
  catalogTitlesLikelySame,
  isDesktopThreadId,
  isRuntimeCatalogSessionId,
  resolveBoundDesktopThreadId,
  effectiveRuntimeSessionId,
  sanitizeDesktopThreadTitle,
} from "../api/threadSidebarCatalog";
import { DRSAI_HOME } from "./paths";
import { sanitizeStructuredTurnState } from "../api/structuredConversation";
import { replaceFileSafely } from "./atomicFileReplace";
import { stripAttachmentContextFromUserContent } from "../api/attachmentContextDisplay";

const THREADS_FILE = join(DRSAI_HOME, "desktop", "threads.json");
const DELETED_THREADS_FILE = join(DRSAI_HOME, "desktop", "deleted-threads.json");
const THREAD_SNAPSHOTS_FILE = join(DRSAI_HOME, "desktop", "thread-snapshots.json");
const THREAD_SNAPSHOTS_DIRECTORY = join(DRSAI_HOME, "desktop", "thread-snapshots");
// The P3 session directory is metadata-only, so retaining 1,000 active entries
// does not hydrate conversation bodies. Snapshot bodies remain independently
// sharded and are opened only through getThreadSnapshot().
const MAX_THREADS = 1_000;
const MAX_ARCHIVED_THREADS = 2_000;
const MAX_THREAD_SNAPSHOTS = 2_000;
const MAX_DELETED_THREAD_TOMBSTONES = 5_000;
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
const threadSnapshotIoMetrics = { shardReads: 0, shardWrites: 0, legacyCatalogReads: 0, shardDirectoryScans: 0 };
/**
 * Tombstones for permanently deleted conversations.
 * Kept in-process for late abort/handoff races, and mirrored to disk so a
 * restart/login upsert cannot resurrect a conversation the user already deleted.
 */
const deletedThreadIds = new Set<string>();
let deletedTombstonesLoaded = false;

export function getThreadSnapshotIoMetrics(): Readonly<typeof threadSnapshotIoMetrics> {
  return { ...threadSnapshotIoMetrics };
}

export function resetThreadSnapshotIoMetrics(): void {
  threadSnapshotIoMetrics.shardReads = 0;
  threadSnapshotIoMetrics.shardWrites = 0;
  threadSnapshotIoMetrics.legacyCatalogReads = 0;
  threadSnapshotIoMetrics.shardDirectoryScans = 0;
}

async function ensureDeletedTombstonesLoaded(): Promise<void> {
  if (deletedTombstonesLoaded) return;
  deletedTombstonesLoaded = true;
  try {
    const parsed = parseStoredJson(await readFile(DELETED_THREADS_FILE, "utf8"));
    if (!Array.isArray(parsed)) return;
    for (const value of parsed.slice(-MAX_DELETED_THREAD_TOMBSTONES)) {
      if (typeof value === "string" && THREAD_ID_PATTERN.test(value) && !/[\r\n]/.test(value)) {
        deletedThreadIds.add(value);
      }
    }
  } catch {
    // First run or missing file — no durable tombstones yet.
  }
}

async function persistDeletedThreadIds(): Promise<void> {
  const ids = [...deletedThreadIds].slice(-MAX_DELETED_THREAD_TOMBSTONES);
  await writeAtomicJson(DELETED_THREADS_FILE, ids);
}

function rememberDeletedThreadIdentity(id: string | undefined): void {
  if (id && THREAD_ID_PATTERN.test(id) && !/[\r\n]/.test(id)) deletedThreadIds.add(id);
}

function isDeletedThreadIdentity(id: string | undefined): boolean {
  return Boolean(id && deletedThreadIds.has(id));
}

function isTombstonedThread(thread: Pick<DesktopThread, "id" | "runtimeSessionId">): boolean {
  return isDeletedThreadIdentity(thread.id) || isDeletedThreadIdentity(thread.runtimeSessionId);
}

function catalogGhostThread(input: RuntimeThreadCatalogEntry, catalogId: string, runtimeSessionId: string): DesktopThread {
  const now = new Date().toISOString();
  return {
    id: catalogId,
    kind: "chat",
    title: String(input.title || "New chat").slice(0, MAX_TITLE_CHARS),
    workspacePath: String(input.workspacePath || "").slice(0, MAX_WORKSPACE_PATH_CHARS),
    createdAt: validCatalogTimestamp(input.createdAt, now),
    updatedAt: validCatalogTimestamp(input.updatedAt, now),
    runtimeSessionId,
    status: "idle",
    archived: input.archived,
    sourceChannel: input.sourceChannel === "wechat" ? "wechat" : undefined,
    messageCount: Number.isFinite(input.messageCount) ? Math.max(0, Number(input.messageCount)) : undefined,
  };
}

export async function listThreads(request?: DesktopThreadListRequest): Promise<DesktopThread[]> {
  if (!staleThreadFilesCleaned) {
    staleThreadFilesCleaned = true;
    await cleanupStaleThreadTemporaryFiles();
  }
  await ensureDeletedTombstonesLoaded();
  return serializeJsonMutation(THREADS_FILE, async () => {
    const result = await readThreadsWithMigration();
    const visible = result.threads.filter((thread) => !isTombstonedThread(thread));
    const removedTombstoned = visible.length !== result.threads.length;
    if (result.migrated || removedTombstoned) await writeThreads(visible);
    const sorted = visible.sort(compareThreads);
    return request ? selectRecentThreads(sorted, request) : sorted;
  });
}

function selectRecentThreads(threads: DesktopThread[], request: DesktopThreadListRequest): DesktopThread[] {
  const limit = Math.max(1, Math.min(200, Math.trunc(request.limit ?? 50)));
  const offset = Math.max(0, Math.trunc(request.offset ?? 0));
  const wantedWorkspace = request.workspacePath ? comparableWorkspacePath(request.workspacePath) : null;
  const scoped = wantedWorkspace
    ? threads.filter((thread) => comparableWorkspacePath(thread.workspacePath) === wantedWorkspace)
    : threads;
  const required = new Set((request.requiredThreadIds ?? []).filter((id) => THREAD_ID_PATTERN.test(id)));
  const allProtectedThreads = scoped.filter((thread) => !thread.archived && (
    required.has(thread.id) || thread.pinned === true || thread.status === "running"));
  const protectedThreads = offset === 0 ? allProtectedThreads : [];
  const protectedIds = new Set(allProtectedThreads.map((thread) => thread.id));
  const active = scoped.filter((thread) => !thread.archived && !protectedIds.has(thread.id)).slice(offset, offset + limit);
  const archived = request.includeArchived
    ? scoped.filter((thread) => thread.archived && !protectedIds.has(thread.id)).slice(offset, offset + limit)
    : [];
  return [...new Map([...protectedThreads, ...active, ...archived]
    .sort(compareThreads)
    .map((thread) => [thread.id, thread])).values()];
}

function comparableWorkspacePath(value: string | undefined): string {
  const normalized = normalize(String(value ?? "").trim()).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
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

function throwThreadDeleted(): never {
  throw Object.assign(new Error("Thread was deleted."), {
    code: "thread_deleted",
    retryable: false,
  });
}

export function isThreadDeletedError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "thread_deleted");
}

export async function updateThread(rawRequest: unknown): Promise<DesktopThread> {
  const request = validateUpdateThreadRequest(rawRequest);
  await ensureDeletedTombstonesLoaded();
  // Tombstone must be checked inside the store lock. An outer-only check races
  // deleteThread: update can pass the check, wait for the lock, then recreate
  // the row after delete has already removed it from threads.json.
  return serializeJsonMutation(THREADS_FILE, async () => {
    if (isDeletedThreadIdentity(request.id) || isDeletedThreadIdentity(request.runtimeSessionId)) {
      throwThreadDeleted();
    }
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
      runtimeSessionId: normalizeStoredRuntimeSessionId(
        request.id,
        request.runtimeSessionId ?? existing?.runtimeSessionId,
      ),
      sourceChannel: request.sourceChannel ?? existing?.sourceChannel,
      status: request.status ?? existing?.status ?? "idle",
      messageCount: request.messageCount ?? existing?.messageCount,
      pinned: request.pinned ?? existing?.pinned,
      archived: request.archived ?? existing?.archived,
      archivedAt: request.archived === true ? now : request.archived === false ? undefined : existing?.archivedAt,
      archiveSource: request.archived === true ? request.archiveSource ?? existing?.archiveSource ?? "opendrsai" : request.archived === false ? undefined : existing?.archiveSource,
      unread: request.unread ?? existing?.unread,
    };
    const withoutCurrent = threads.filter((thread) => thread.id !== request.id);
    await writeThreads(retainThreads(dedupeRuntimeSessionCatalogDuplicates([next, ...withoutCurrent]).threads));
    return next;
  });
}

export async function deleteThread(rawThreadId: unknown): Promise<boolean> {
  const threadId = sanitizeThreadId(rawThreadId);
  await ensureDeletedTombstonesLoaded();
  // Durable tombstone first so restart/login cannot resurrect via upsert even if
  // the catalog rewrite loses a race or the process exits mid-delete.
  rememberDeletedThreadIdentity(threadId);
  try {
    await persistDeletedThreadIds();
  } catch {
    // Catalog removal below is still authoritative for this process; a later
    // listThreads/delete retry can persist the tombstone file.
  }
  const deleted = await serializeJsonMutation(THREADS_FILE, async () => {
    const threads = await readThreads();
    const existing = threads.find((thread) => thread.id === threadId)
      ?? threads.find((thread) => thread.runtimeSessionId === threadId);
    rememberDeletedThreadIdentity(existing?.id);
    rememberDeletedThreadIdentity(existing?.runtimeSessionId);
    try {
      await persistDeletedThreadIds();
    } catch {
      // In-process tombstones still block Runtime catalog upsert in this session.
    }
    if (!existing) return false;
    await writeThreads(threads.filter((thread) =>
      thread.id !== existing.id
      && thread.id !== existing.runtimeSessionId
      && thread.runtimeSessionId !== existing.id
      && !(existing.runtimeSessionId && thread.runtimeSessionId === existing.runtimeSessionId)));
    return true;
  });
  await rm(threadSnapshotPath(threadId), { force: true }).catch(() => undefined);
  try {
    await serializeJsonMutation(THREAD_SNAPSHOTS_FILE, async () => {
      const snapshots = await readLegacyThreadSnapshots();
      if (snapshots[threadId]) {
        delete snapshots[threadId];
        await writeThreadSnapshots(snapshots);
      }
    });
  } catch {
    // Shard removal above is enough for getThreadSnapshot(); legacy catalog is best-effort.
  }
  return deleted;
}

export async function getThreadSnapshot(rawThreadId: unknown): Promise<DesktopThreadSnapshot | null> {
  const threadId = sanitizeThreadId(rawThreadId);
  await ensureDeletedTombstonesLoaded();
  if (isDeletedThreadIdentity(threadId)) return null;
  const sharded = await readThreadSnapshotShard(threadId);
  if (sharded) return sharded;
  // One-time compatibility path for installations created before snapshots
  // were sharded. Only the requested legacy entry is migrated; subsequent
  // opens are O(size of this conversation), not O(all conversations).
  const legacy = (await readLegacyThreadSnapshots())[threadId] ?? null;
  if (legacy) await writeThreadSnapshotShard(legacy);
  return legacy;
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
  await ensureDeletedTombstonesLoaded();
  if (isDeletedThreadIdentity(snapshot.threadId)) throwThreadDeleted();
  const path = threadSnapshotPath(snapshot.threadId);
  return serializeJsonMutation(path, async () => {
    if (isDeletedThreadIdentity(snapshot.threadId)) throwThreadDeleted();
    await writeThreadSnapshotShard(snapshot);
    return snapshot;
  });
}

export async function appendDuplexVoiceHistory(rawRequest: DesktopDuplexVoiceHistoryAppendRequest): Promise<DesktopThreadSnapshot> {
  if (!rawRequest || !THREAD_ID_PATTERN.test(rawRequest.threadId) || !Array.isArray(rawRequest.messages) || rawRequest.messages.length > 100) throw new Error("Duplex voice history request is invalid.");
  const messages = rawRequest.messages.map((message) => {
    if (!message || typeof message.id !== "string" || !message.id.startsWith("duplex:") || message.id.length > 500 || !["user", "assistant"].includes(message.role) || typeof message.content !== "string") throw new Error("Duplex voice history message is invalid.");
    if (!Number.isInteger(message.revision) || message.revision < 1 || !Number.isInteger(message.expectedRevision) || message.expectedRevision < 0) throw new Error("Duplex voice history revision is invalid.");
    return { id: message.id, role: message.role, content: message.content.replace(/\0/g, "").slice(0, 20_000), revision: message.revision, expectedRevision: message.expectedRevision, ...(message.statusContent ? { statusContent: message.statusContent.replace(/\0/g, "").slice(0, 20_000) } : {}), ...(message.voice ? { voice: message.voice } : {}), ...(Array.isArray(message.toolTimeline) ? { toolTimeline: message.toolTimeline.slice(-20).flatMap(sanitizeToolTimelineEvent) } : {}), ...(Array.isArray(message.parts) ? { parts: message.parts.slice(0, 64).flatMap(sanitizeMessagePart) } : {}) };
  });
  const path = threadSnapshotPath(rawRequest.threadId);
  return serializeJsonMutation(path, async () => {
    const current = await readThreadSnapshotShard(rawRequest.threadId) ?? { threadId: rawRequest.threadId, title: rawRequest.threadId, messages: [], updatedAt: Date.now(), messageCount: 0 };
    const merged = new Map(current.messages.map((message) => [message.id, message]));
    for (const message of messages) { const existing = merged.get(message.id); const currentRevision = existing?.voice?.revision ?? 0; if (message.revision === currentRevision) { if (!existing || existing.content !== message.content || existing.role !== message.role || JSON.stringify(existing.parts ?? []) !== JSON.stringify(message.parts ?? existing.parts ?? [])) throw new Error("Duplex voice history revision conflict."); continue; } if (message.expectedRevision !== currentRevision || message.revision !== currentRevision + 1) throw new Error("Duplex voice history revision conflict."); const { revision: _revision, expectedRevision: _expectedRevision, ...value } = message; merged.set(message.id, { ...existing, ...value, voice: { ...value.voice, revision: message.revision } }); }
    const nextMessages = [...merged.values()].slice(-MAX_SNAPSHOT_MESSAGES);
    const next = validateThreadSnapshot({ ...current, messages: nextMessages, messageCount: nextMessages.length, updatedAt: Date.now() });
    await writeThreadSnapshotShard(next); return next;
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
  sourceChannel?: DesktopThread["sourceChannel"];
  status?: DesktopThread["status"];
  messageCount?: number;
}): Promise<DesktopThread> {
  try {
    return await updateThread(input);
  } catch (error) {
    // Late abort/settle events must not fail the run pipeline after delete.
    if (isThreadDeletedError(error)) {
      const now = new Date().toISOString();
      return {
        id: input.id,
        kind: input.kind,
        title: input.title || defaultTitle(input.kind),
        workspacePath: input.workspacePath,
        boundAgentId: input.boundAgentId,
        boundAgentName: input.boundAgentName,
        createdAt: now,
        updatedAt: now,
        lastRunId: input.lastRunId,
        lastRequestId: input.lastRequestId,
        runtimeSessionId: input.runtimeSessionId,
        status: input.status ?? "idle",
        messageCount: input.messageCount,
      };
    }
    throw error;
  }
}

export interface RuntimeThreadCatalogEntry {
  id: string;
  title: string;
  workspacePath: string;
  runtimeSessionId: string;
  createdAt?: string;
  updatedAt?: string;
  archived: boolean;
  sourceChannel?: DesktopThread["sourceChannel"];
  messageCount?: number;
}

const PENDING_RUNTIME_SESSION_BIND_TTL_MS = 30_000;
const RECENT_RUNTIME_SESSION_MS = 60_000;
const pendingRuntimeSessionBinds: Array<{
  threadId: string;
  workspacePath: string;
  title: string;
  createdAt: number;
}> = [];
const pendingRuntimeSessionOwners = new Map<string, { threadId: string; boundAt: number }>();

/** Register the Desktop thread that is about to create a Runtime Session. */
export function expectRuntimeSessionBind(input: {
  threadId: string;
  workspacePath: string;
  title: string;
}): void {
  const threadId = sanitizeThreadId(input.threadId);
  const workspacePath = comparableWorkspacePath(input.workspacePath);
  const title = sanitizeDesktopThreadTitle(input.title) || "New chat";
  const now = Date.now();
  expirePendingRuntimeSessionBinds(now);
  for (let index = pendingRuntimeSessionBinds.length - 1; index >= 0; index -= 1) {
    if (pendingRuntimeSessionBinds[index]?.threadId === threadId) pendingRuntimeSessionBinds.splice(index, 1);
  }
  pendingRuntimeSessionBinds.push({ threadId, workspacePath, title, createdAt: now });
}

/** Remember the owner after Runtime returns a session_id. */
export function rememberRuntimeSessionOwner(threadId: string, runtimeSessionId: string): void {
  pendingRuntimeSessionOwners.set(runtimeSessionId, { threadId: sanitizeThreadId(threadId), boundAt: Date.now() });
  if (pendingRuntimeSessionOwners.size > 200) {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [sessionId, owner] of pendingRuntimeSessionOwners) {
      if (owner.boundAt < cutoff) pendingRuntimeSessionOwners.delete(sessionId);
    }
  }
}

function expirePendingRuntimeSessionBinds(now = Date.now()): void {
  for (let index = pendingRuntimeSessionBinds.length - 1; index >= 0; index -= 1) {
    if (now - (pendingRuntimeSessionBinds[index]?.createdAt ?? 0) > PENDING_RUNTIME_SESSION_BIND_TTL_MS) {
      pendingRuntimeSessionBinds.splice(index, 1);
    }
  }
}

function isRecentRuntimeCatalogTimestamp(value?: string): boolean {
  if (!value) return true;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) && Date.now() - stamp < RECENT_RUNTIME_SESSION_MS;
}

function claimPendingRuntimeSessionBind(input: {
  workspacePath: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
}): string | undefined {
  if (!isRecentRuntimeCatalogTimestamp(input.updatedAt) && !isRecentRuntimeCatalogTimestamp(input.createdAt)) {
    return undefined;
  }
  const now = Date.now();
  expirePendingRuntimeSessionBinds(now);
  const workspacePath = comparableWorkspacePath(input.workspacePath);
  const title = sanitizeDesktopThreadTitle(input.title) || "New chat";
  const inWorkspace = pendingRuntimeSessionBinds.filter((pending) => pending.workspacePath === workspacePath);
  const match = inWorkspace.find((pending) => catalogTitlesLikelySame(pending.title, title))
    ?? (inWorkspace.length === 1 ? inWorkspace[0] : undefined);
  if (!match) return undefined;
  const index = pendingRuntimeSessionBinds.indexOf(match);
  if (index >= 0) pendingRuntimeSessionBinds.splice(index, 1);
  return match.threadId;
}

export function findDesktopOwnerThreadId(
  threads: DesktopThread[],
  input: { sessionId: string; workspacePath: string; title: string; createdAt?: string; updatedAt?: string },
): string | undefined {
  return resolveBoundDesktopThreadId(threads, input.sessionId)
    ?? pendingRuntimeSessionOwners.get(input.sessionId)?.threadId
    ?? claimPendingRuntimeSessionBind({
      workspacePath: input.workspacePath,
      title: input.title,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    ?? findUnboundDesktopOwnerThreadId(threads, input);
}

function findUnboundDesktopOwnerThreadId(
  threads: DesktopThread[],
  input: { workspacePath: string; title: string; createdAt?: string; updatedAt?: string },
): string | undefined {
  const workspacePath = comparableWorkspacePath(input.workspacePath);
  const unbound = threads.filter((thread) =>
    isDesktopThreadId(thread.id)
    && !effectiveRuntimeSessionId(thread)
    && comparableWorkspacePath(thread.workspacePath) === workspacePath);
  const byCreatedAt = input.createdAt
    ? unbound.find((thread) => thread.createdAt === input.createdAt || (
      Number.isFinite(Date.parse(thread.createdAt)) && Date.parse(thread.createdAt) === Date.parse(input.createdAt)
    ))
    : undefined;
  if (byCreatedAt) return byCreatedAt.id;
  if (!isRecentRuntimeCatalogTimestamp(input.createdAt) && !isRecentRuntimeCatalogTimestamp(input.updatedAt)) {
    return undefined;
  }
  const byTitle = unbound.filter((thread) => catalogTitlesLikelySame(thread.title, input.title));
  return byTitle.length === 1 ? byTitle[0]?.id : undefined;
}

function resolveRuntimeCatalogThreadId(
  threads: DesktopThread[],
  input: { id: string; runtimeSessionId: string; workspacePath: string; title: string; createdAt?: string; updatedAt?: string },
): string {
  return findDesktopOwnerThreadId(threads, {
    sessionId: input.runtimeSessionId,
    workspacePath: input.workspacePath,
    title: input.title,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  }) ?? input.id;
}

/** Persist one authoritative Runtime directory entry without inventing activity. */
export async function upsertThreadFromRuntimeCatalog(
  input: RuntimeThreadCatalogEntry,
): Promise<{ thread: DesktopThread; changed: boolean }> {
  const [result] = await upsertThreadsFromRuntimeCatalog([input]);
  if (!result) throw new Error("Runtime catalog entry was not persisted.");
  return result;
}

/** Apply a Runtime bootstrap page with one read and at most one atomic write. */
export async function upsertThreadsFromRuntimeCatalog(
  inputs: RuntimeThreadCatalogEntry[],
): Promise<Array<{ thread: DesktopThread; changed: boolean }>> {
  const entries = inputs.slice(0, 200).map((input) => ({ ...input, id: sanitizeThreadId(input.id) }));
  await ensureDeletedTombstonesLoaded();
  return serializeJsonMutation(THREADS_FILE, async () => {
    let threads = await readThreads();
    const now = new Date().toISOString();
    const results: Array<{ thread: DesktopThread; changed: boolean }> = [];
    let anyChanged = false;
    for (const input of entries) {
      const runtimeSessionId = sanitizeOptionalId(input.runtimeSessionId, "Thread Runtime session id is invalid.");
      const catalogId = resolveRuntimeCatalogThreadId(threads, {
        id: input.id,
        runtimeSessionId,
        workspacePath: input.workspacePath,
        title: input.title,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      });
      if (
        isDeletedThreadIdentity(catalogId)
        || isDeletedThreadIdentity(input.id)
        || isDeletedThreadIdentity(runtimeSessionId)
      ) {
        const before = threads.length;
        threads = threads.filter((item) =>
          !isTombstonedThread(item)
          && item.id !== catalogId
          && item.id !== input.id
          && item.id !== runtimeSessionId
          && item.runtimeSessionId !== runtimeSessionId);
        if (threads.length !== before) anyChanged = true;
        results.push({ thread: catalogGhostThread(input, catalogId, runtimeSessionId), changed: false });
        continue;
      }
      const existing = threads.find((thread) => thread.id === catalogId) ?? threads.find((thread) => thread.id === input.id);
      // Keep the Desktop thread's createdAt. Overwriting it with the Runtime
      // timestamp erased the only stable join key when runtimeSessionId was lost.
      const createdAt = isDesktopThreadId(catalogId)
        ? (existing?.createdAt ?? validCatalogTimestamp(input.createdAt, now))
        : validCatalogTimestamp(input.createdAt, existing?.createdAt ?? now);
      const updatedAt = validCatalogTimestamp(input.updatedAt, existing?.updatedAt ?? createdAt);
      const title = sanitizeDesktopThreadTitle(input.title || existing?.title) || "New chat";
      const workspacePath = String(input.workspacePath || existing?.workspacePath || "").slice(0, MAX_WORKSPACE_PATH_CHARS);
      const archivedAt = input.archived ? existing?.archivedAt ?? updatedAt : undefined;
      const archiveSource = input.archived ? existing?.archiveSource ?? "opendrsai" : undefined;
      const sourceChannel = input.sourceChannel === "wechat" ? "wechat" : existing?.sourceChannel;
      const incomingCount = Number.isFinite(input.messageCount) ? Math.max(0, Number(input.messageCount)) : undefined;
      // Runtime catalog rows often omit message_count (treated as 0). Do not
      // wipe a Desktop count that already reflects a persisted snapshot.
      const messageCount = incomingCount === undefined
        ? existing?.messageCount
        : Math.max(existing?.messageCount ?? 0, incomingCount);
      const unchanged = Boolean(existing
        && existing.id === catalogId
        && existing.title === title
        && existing.workspacePath === workspacePath
        && existing.runtimeSessionId === runtimeSessionId
        && existing.createdAt === createdAt
        && existing.updatedAt === updatedAt
        && Boolean(existing.archived) === input.archived
        && existing.archivedAt === archivedAt
        && existing.archiveSource === archiveSource
        && existing.sourceChannel === sourceChannel
        && existing.messageCount === messageCount);
      const withoutCatalogOrphans = threads.filter((item) =>
        item.id === catalogId || (item.id !== input.id && item.id !== runtimeSessionId));
      if (existing && unchanged && withoutCatalogOrphans.length === threads.length) {
        results.push({ thread: existing, changed: false });
        continue;
      }
      const thread: DesktopThread = {
        ...(existing ?? {}),
        id: catalogId,
        kind: existing?.kind ?? "chat",
        title,
        workspacePath,
        createdAt,
        updatedAt,
        runtimeSessionId,
        status: existing?.status ?? "idle",
        messageCount,
        archived: input.archived,
        archivedAt,
        archiveSource,
        sourceChannel,
      };
      threads = [thread, ...withoutCatalogOrphans.filter((item) => item.id !== catalogId)];
      results.push({ thread, changed: true });
      anyChanged = true;
    }
    const deduped = dedupeRuntimeSessionCatalogDuplicates(threads);
    if (deduped.migrated) {
      threads = deduped.threads;
      anyChanged = true;
    }
    if (anyChanged) await writeThreads(retainThreads(threads));
    return results;
  });
}

function validCatalogTimestamp(value: string | undefined, fallback: string): string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : fallback;
}

async function readThreads(): Promise<DesktopThread[]> {
  return (await readThreadsWithMigration()).threads;
}

async function readThreadsWithMigration(): Promise<{ threads: DesktopThread[]; migrated: boolean }> {
  try {
    const parsed = parseStoredJson(await readFile(THREADS_FILE, "utf8"));
    if (!Array.isArray(parsed)) return { threads: [], migrated: false };
    let migrated = false;
    const threads = retainThreads(parsed.filter(isThread)).map((thread) => {
      let next = migrateLocalAgentDisplayName(thread);
      if (next !== thread) migrated = true;
      const cleared = migrateInvalidRuntimeSessionBinding(next);
      if (cleared !== next) {
        migrated = true;
        next = cleared;
      }
      return next;
    });
    const deduped = dedupeRuntimeSessionCatalogDuplicates(threads);
    return { threads: deduped.threads, migrated: migrated || deduped.migrated };
  } catch {
    return { threads: [], migrated: false };
  }
}

/** Drop orphan catalog rows keyed by Runtime session_id when a Desktop thread-* already owns that Session. */
export function dedupeRuntimeSessionCatalogDuplicates(threads: DesktopThread[]): {
  threads: DesktopThread[];
  migrated: boolean;
} {
  const next = canonicalizeSidebarThreads(threads);
  if (next.length !== threads.length) return { threads: next, migrated: true };
  const before = new Map(threads.map((thread) => [thread.id, thread.runtimeSessionId ?? ""]));
  const migrated = next.some((thread) => (before.get(thread.id) ?? "") !== (thread.runtimeSessionId ?? "")
    || !before.has(thread.id));
  return { threads: next, migrated };
}

/** Desktop thread ids must never be stored as Runtime Session ids. */
export function migrateInvalidRuntimeSessionBinding(thread: DesktopThread): DesktopThread {
  if (!isDesktopThreadId(thread.id)) return thread;
  if (!thread.runtimeSessionId || isRuntimeCatalogSessionId(thread.runtimeSessionId)) return thread;
  const { runtimeSessionId: _invalid, ...rest } = thread;
  return rest;
}

export function migrateLocalAgentDisplayName(thread: DesktopThread): DesktopThread {
  if (thread.boundAgentId !== LEGACY_MY_DRSAI_AGENT_ID) return thread;
  if (thread.boundAgentName !== "My DrSai" && thread.boundAgentName !== "My Dr.Sai") return thread;
  return { ...thread, boundAgentName: LOCAL_OPENDRSAI_AGENT_NAME };
}

async function writeThreads(threads: DesktopThread[]): Promise<void> {
  await writeAtomicJson(THREADS_FILE, threads);
}

function retainThreads(threads: DesktopThread[]): DesktopThread[] {
  const protectedActive: DesktopThread[] = [];
  const ordinaryActive: DesktopThread[] = [];
  const archived: DesktopThread[] = [];
  for (const thread of threads) {
    if (thread.archived) archived.push(thread);
    else if (thread.pinned || thread.status === "running") protectedActive.push(thread);
    else ordinaryActive.push(thread);
  }
  const active = [...protectedActive.sort(compareThreads), ...ordinaryActive.sort(compareThreads)]
    .slice(0, MAX_THREADS);
  return [...active, ...archived.sort(compareThreads).slice(0, MAX_ARCHIVED_THREADS)];
}

async function readLegacyThreadSnapshots(): Promise<Record<string, DesktopThreadSnapshot>> {
  try {
    threadSnapshotIoMetrics.legacyCatalogReads += 1;
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

async function readThreadSnapshots(): Promise<Record<string, DesktopThreadSnapshot>> {
  const legacy = await readLegacyThreadSnapshots();
  let names: string[] = [];
  try {
    threadSnapshotIoMetrics.shardDirectoryScans += 1;
    names = (await readdir(THREAD_SNAPSHOTS_DIRECTORY)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
  } catch { /* No sharded snapshots yet. */ }
  const sharded = await Promise.all(names.slice(0, MAX_THREAD_SNAPSHOTS).map(async (name) => {
    try {
      threadSnapshotIoMetrics.shardReads += 1;
      return validateThreadSnapshot(parseStoredJson(await readFile(join(THREAD_SNAPSHOTS_DIRECTORY, name), "utf8")));
    } catch { return null; }
  }));
  const combined = { ...legacy };
  for (const snapshot of sharded) if (snapshot) combined[snapshot.threadId] = snapshot;
  return Object.fromEntries(Object.values(combined)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_THREAD_SNAPSHOTS)
    .map((snapshot) => [snapshot.threadId, snapshot]));
}

function threadSnapshotPath(threadId: string): string {
  return join(THREAD_SNAPSHOTS_DIRECTORY, `${createHash("sha256").update(threadId).digest("hex")}.json`);
}

async function readThreadSnapshotShard(threadId: string): Promise<DesktopThreadSnapshot | null> {
  try {
    threadSnapshotIoMetrics.shardReads += 1;
    const snapshot = validateThreadSnapshot(parseStoredJson(await readFile(threadSnapshotPath(threadId), "utf8")));
    return snapshot.threadId === threadId ? snapshot : null;
  } catch { return null; }
}

async function writeThreadSnapshotShard(snapshot: DesktopThreadSnapshot): Promise<void> {
  threadSnapshotIoMetrics.shardWrites += 1;
  await writeAtomicJson(threadSnapshotPath(snapshot.threadId), snapshot);
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
      /^(\s*"(?:id|kind|title|workspacePath|boundAgentId|boundAgentName|createdAt|updatedAt|lastRunId|lastRequestId|runtimeSessionId|sourceChannel|status|archivedAt|archiveSource)"\s*:\s*".*?)(,\s*)$/gm,
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
    sourceChannel: request.sourceChannel === "wechat" ? "wechat" : undefined,
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
  const inputRequest = sanitizeSnapshotInputRequest(message.inputRequest);
  const rawContent = message.content.slice(0, MAX_MESSAGE_CHARS);
  const content = message.role === "user"
    ? stripAttachmentContextFromUserContent(rawContent)
    : rawContent;
  const attachments = sanitizeSnapshotAttachments(message.attachments);
  return {
    id,
    role: message.role,
    content,
    ...(message.streaming ? { streaming: true } : {}),
    ...(message.error ? { error: true } : {}),
    ...(typeof message.statusContent === "string"
      ? { statusContent: message.statusContent.slice(0, MAX_STATUS_CHARS) }
      : {}),
    ...(message.voice && typeof message.voice === "object" && Number.isInteger(message.voice.revision) && message.voice.revision >= 1 ? { voice: { revision: message.voice.revision, ...(Number.isFinite(message.voice.generatedAudioMs) ? { generatedAudioMs: Math.max(0, message.voice.generatedAudioMs!) } : {}), ...(Number.isFinite(message.voice.playedAudioMs) ? { playedAudioMs: Math.max(0, message.voice.playedAudioMs!) } : {}), ...(Number.isFinite(message.voice.interruptedAt) ? { interruptedAt: message.voice.interruptedAt } : {}), ...(["none", "word_timing"].includes(message.voice.alignmentConfidence ?? "") ? { alignmentConfidence: message.voice.alignmentConfidence } : {}), ...(typeof message.voice.heardContent === "string" ? { heardContent: message.voice.heardContent.slice(0, MAX_MESSAGE_CHARS) } : {}) } } : {}),
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
    ...(inputRequest ? { inputRequest } : {}),
    ...(attachments ? { attachments } : {}),
    ...(typeof message.startedAt === "number" && Number.isFinite(message.startedAt)
      ? { startedAt: message.startedAt }
      : {}),
    ...(typeof message.lastEventAt === "number" && Number.isFinite(message.lastEventAt)
      ? { lastEventAt: message.lastEventAt }
      : {}),
  };
}

const MAX_SNAPSHOT_SCREENSHOT_DATA_URL_CHARS = 2_000_000;

function sanitizeSnapshotAttachments(raw: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const attachments = raw.slice(0, 40).flatMap((item): ChatAttachment[] => {
    if (!item || typeof item !== "object") return [];
    const attachment = item as Partial<ChatAttachment>;
    const kind = attachment.kind;
    if (
      kind !== "file"
      && kind !== "folder"
      && kind !== "browser"
      && kind !== "terminal"
      && kind !== "selection"
    ) {
      return [];
    }
    if (typeof attachment.path !== "string" || !attachment.path.trim()) return [];
    if (typeof attachment.name !== "string" || !attachment.name.trim()) return [];
    const screenshotDataUrl = typeof attachment.screenshotDataUrl === "string"
      && attachment.screenshotDataUrl.startsWith("data:image/")
      ? attachment.screenshotDataUrl.slice(0, MAX_SNAPSHOT_SCREENSHOT_DATA_URL_CHARS)
      : undefined;
    return [{
      kind,
      path: attachment.path.trim().slice(0, 2048),
      name: attachment.name.trim().slice(0, 300),
      ...(typeof attachment.url === "string" ? { url: attachment.url.slice(0, 2048) } : {}),
      ...(typeof attachment.title === "string" ? { title: attachment.title.slice(0, 300) } : {}),
      ...(typeof attachment.note === "string" ? { note: attachment.note.slice(0, 1000) } : {}),
      ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
    }];
  });
  return attachments.length ? attachments : undefined;
}

function sanitizeSnapshotInputRequest(
  raw: DesktopThreadMessageSnapshot["inputRequest"],
): DesktopThreadMessageSnapshot["inputRequest"] {
  if (!raw || typeof raw !== "object") return undefined;
  const inputTypes = ["text_input", "approval", "choice", "confirmation"] as const;
  if (
    typeof raw.requestId !== "string"
    || !raw.requestId.trim()
    || typeof raw.prompt !== "string"
    || !(inputTypes as readonly string[]).includes(raw.inputType)
  ) return undefined;
  const options = Array.isArray(raw.options)
    ? raw.options.slice(0, 50).flatMap((option) => {
        if (!option || typeof option !== "object" || typeof option.id !== "string" || typeof option.label !== "string") return [];
        const id = option.id.trim().slice(0, 200);
        const label = option.label.trim().slice(0, 1_000);
        if (!id || !label) return [];
        return [{
          id,
          label,
          ...(typeof option.value === "string" ? { value: option.value.slice(0, 10_000) } : {}),
        }];
      })
    : undefined;
  return {
    requestId: raw.requestId.trim().slice(0, 200),
    prompt: raw.prompt.slice(0, MAX_STATUS_CHARS),
    inputType: raw.inputType,
    ...(options?.length ? { options } : {}),
    ...(typeof raw.defaultValue === "string" ? { defaultValue: raw.defaultValue.slice(0, 10_000) } : {}),
    ...(raw.allowCustom === true ? { allowCustom: true } : {}),
    ...(typeof raw.timeoutAt === "string" ? { timeoutAt: raw.timeoutAt.slice(0, 80) } : {}),
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
  if (typeof title !== "string") {
    throw new Error("Thread title is invalid.");
  }
  return sanitizeDesktopThreadTitle(title) || undefined;
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

function normalizeStoredRuntimeSessionId(threadId: string, sessionId: string | undefined): string | undefined {
  if (!sessionId) return undefined;
  if (threadId.startsWith("thread-") && !isRuntimeCatalogSessionId(sessionId)) return undefined;
  return sessionId;
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
      (thread.sourceChannel === undefined || thread.sourceChannel === "wechat") &&
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
