import type { DesktopThread, WorkspaceProject } from "./desktopApi";

export function isDesktopThreadId(id: string): boolean {
  return id.startsWith("thread-");
}

export function isRuntimeCatalogSessionId(id: string): boolean {
  return id.startsWith("session-");
}

function comparableWorkspacePath(path: string | undefined): string {
  return (path ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** A Desktop thread-* id is never a Runtime Session. Codex may use other id shapes. */
export function effectiveRuntimeSessionId(thread: Pick<DesktopThread, "id" | "runtimeSessionId">): string | undefined {
  const sessionId = thread.runtimeSessionId;
  if (!sessionId || !isRuntimeCatalogSessionId(sessionId)) return undefined;
  return sessionId;
}

/**
 * Session id used to read Runtime history. Desktop `thread-*` ids were
 * historically stored as `runtimeSessionId`; looking those up returns an empty
 * conversation and blanks the persisted snapshot.
 */
export function runtimeSessionIdForLookup(thread: Pick<DesktopThread, "runtimeSessionId">): string | undefined {
  const sessionId = thread.runtimeSessionId?.trim();
  if (!sessionId || isDesktopThreadId(sessionId)) return undefined;
  return sessionId;
}

function preferDesktopThread(left: DesktopThread, right: DesktopThread): DesktopThread {
  const desktop = isDesktopThreadId(left.id) ? left : isDesktopThreadId(right.id) ? right : left;
  const other = desktop.id === left.id ? right : left;
  const newer = (desktop.updatedAt || "") >= (other.updatedAt || "") ? desktop : other;
  return {
    ...other,
    ...desktop,
    id: desktop.id,
    kind: desktop.kind,
    title: newer.title || desktop.title || other.title,
    updatedAt: newer.updatedAt,
    runtimeSessionId: effectiveRuntimeSessionId(desktop) || effectiveRuntimeSessionId(other) || desktop.runtimeSessionId,
    status: desktop.status ?? other.status,
    pinned: desktop.pinned ?? other.pinned,
    boundAgentId: desktop.boundAgentId ?? other.boundAgentId,
    boundAgentName: desktop.boundAgentName ?? other.boundAgentName,
    lastRunId: desktop.lastRunId ?? other.lastRunId,
    lastRequestId: desktop.lastRequestId ?? other.lastRequestId,
    fork: desktop.fork ?? other.fork,
    execution: desktop.execution ?? other.execution,
    messageCount: Math.max(desktop.messageCount ?? 0, other.messageCount ?? 0) || desktop.messageCount || other.messageCount,
  };
}

export function resolveBoundDesktopThreadId(
  threads: readonly DesktopThread[],
  sessionId: string,
): string | undefined {
  return threads.find((thread) => effectiveRuntimeSessionId(thread) === sessionId && thread.id !== sessionId)?.id;
}

export function shouldMaterializeCatalogThread(input: {
  mode: "live" | "bootstrap";
  sourceChannel?: DesktopThread["sourceChannel"];
  ownerThreadId?: string;
}): boolean {
  if (input.ownerThreadId) return true;
  if (input.sourceChannel === "wechat") return true;
  return input.mode === "bootstrap";
}

function sameWorkspace(left?: string, right?: string): boolean {
  const a = comparableWorkspacePath(left);
  const b = comparableWorkspacePath(right);
  if (!a || !b) return false;
  return a === b;
}

const MAX_SIDEBAR_TITLE_CHARS = 120;

/** Single title form for Desktop rows, pending binds, and Runtime catalog matching. */
export function sanitizeDesktopThreadTitle(title: string | undefined): string {
  return normalizeCatalogTitle(title).slice(0, MAX_SIDEBAR_TITLE_CHARS);
}

export function normalizeCatalogTitle(title: string | undefined): string {
  return String(title ?? "").replace(/\s+/g, " ").trim();
}

/** Desktop sanitizes newlines to spaces and truncates; Runtime catalog keeps the raw prompt. */
export function catalogTitlesLikelySame(left: string | undefined, right: string | undefined): boolean {
  const a = normalizeCatalogTitle(left);
  const b = normalizeCatalogTitle(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 16) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function sameCreatedAt(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const a = Date.parse(left);
  const b = Date.parse(right);
  return Number.isFinite(a) && a === b;
}

function bindCatalogOrphan(thread: DesktopThread, orphan: DesktopThread): DesktopThread {
  return {
    ...preferDesktopThread(thread, orphan),
    runtimeSessionId: effectiveRuntimeSessionId(thread) || effectiveRuntimeSessionId(orphan) || orphan.id,
  };
}

function takeMatchingOrphan(
  catalog: readonly DesktopThread[],
  consumed: Set<string>,
  matches: (item: DesktopThread) => boolean,
): DesktopThread | undefined {
  const orphan = catalog.find((item) => !consumed.has(item.id) && matches(item));
  if (!orphan) return undefined;
  consumed.add(orphan.id);
  return orphan;
}

/** Collapse Desktop thread-* rows and Runtime session-* orphans to one sidebar entry. */
export function canonicalizeSidebarThreads(threads: readonly DesktopThread[]): DesktopThread[] {
  const byId = new Map<string, DesktopThread>();
  for (const thread of threads) {
    const existing = byId.get(thread.id);
    byId.set(thread.id, existing ? preferDesktopThread(existing, thread) : thread);
  }
  const unique = [...byId.values()];
  const desktop = unique.filter((thread) => isDesktopThreadId(thread.id));
  const catalog = unique.filter((thread) =>
    isRuntimeCatalogSessionId(thread.id) && thread.sourceChannel !== "wechat");
  const rest = unique.filter((thread) =>
    !isDesktopThreadId(thread.id) && !(isRuntimeCatalogSessionId(thread.id) && thread.sourceChannel !== "wechat"));
  const consumed = new Set<string>();

  const bindUnboundUniquely = (
    current: DesktopThread[],
    matches: (thread: DesktopThread, item: DesktopThread) => boolean,
  ): DesktopThread[] => current.map((thread) => {
    if (effectiveRuntimeSessionId(thread)) return thread;
    const candidates = catalog.filter((item) => !consumed.has(item.id) && matches(thread, item));
    if (candidates.length !== 1) return thread;
    const orphan = candidates[0];
    const owners = current.filter((candidate) =>
      !effectiveRuntimeSessionId(candidate) && matches(candidate, orphan));
    if (owners.length !== 1) return thread;
    consumed.add(orphan.id);
    return orphan ? bindCatalogOrphan(thread, orphan) : thread;
  });

  // Bind by Runtime session id first. Title matching is order-sensitive when the
  // user retries the same prompt, which made the workspace tree jump 6/9/12.
  const sessionBound = desktop.map((thread) => {
    const sessionId = effectiveRuntimeSessionId(thread);
    const bySession = sessionId
      ? takeMatchingOrphan(catalog, consumed, (item) =>
        item.id === sessionId || effectiveRuntimeSessionId(item) === sessionId)
      : undefined;
    if (!bySession) return {
      ...thread,
      ...(sessionId ? { runtimeSessionId: sessionId } : { runtimeSessionId: undefined }),
    };
    return bindCatalogOrphan(thread, bySession);
  });

  // Historical Desktop rows stored thread-* as runtimeSessionId and never bound.
  // Runtime catalog copies the Desktop createdAt, so that pair is unambiguous.
  const createdAtBound = bindUnboundUniquely(sessionBound, (thread, item) =>
    sameWorkspace(item.workspacePath, thread.workspacePath) && sameCreatedAt(item.createdAt, thread.createdAt));

  // A title is presentation data, not Session identity.  Unmatched Runtime
  // rows remain independent until an explicit runtimeSessionId, a pending bind,
  // or an unambiguous legacy createdAt binding establishes ownership.
  const leftoverCatalog = catalog.filter((item) => !consumed.has(item.id));

  return [...createdAtBound, ...leftoverCatalog, ...rest];
}

type SidebarWorkspace = Pick<WorkspaceProject, "id" | "path">;

function workspaceOwnsSidebarThread(
  workspace: SidebarWorkspace,
  thread: DesktopThread,
): boolean {
  return thread.execution?.workspaceId === workspace.id
    || sameWorkspace(workspace.path, thread.workspacePath);
}

function sidebarThreadWorkspaceKey(
  thread: DesktopThread,
  workspaces: readonly SidebarWorkspace[],
): string {
  const registered = workspaces.find((workspace) => workspaceOwnsSidebarThread(workspace, thread));
  if (registered) return registered.id;
  const path = comparableWorkspacePath(thread.workspacePath);
  return path ? `path:${path}` : "unassigned";
}

/**
 * Keep an independent recent catalog for every registered Workspace.
 * The active Workspace may retain a loaded page; inactive Workspaces retain a
 * compact preview instead of disappearing when another Workspace refreshes.
 */
export function boundWorkspaceSidebarThreads(
  threads: readonly DesktopThread[],
  options: {
    activeThreadId: string;
    activeWorkspaceId: string;
    workspaces: readonly SidebarWorkspace[];
    activeLimit: number;
    workspacePreviewLimit: number;
    archivedLimit: number;
  },
): DesktopThread[] {
  const sorted = canonicalizeSidebarThreads(threads).sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  const protectedThreads = sorted.filter((thread) => !thread.archived && (
    thread.id === options.activeThreadId || thread.pinned || thread.status === "running"
  ));
  const protectedIds = new Set(protectedThreads.map((thread) => thread.id));
  const counts = new Map<string, number>();
  const recent = sorted.filter((thread) => {
    if (thread.archived || protectedIds.has(thread.id)) return false;
    const key = sidebarThreadWorkspaceKey(thread, options.workspaces);
    const limit = key === options.activeWorkspaceId
      ? options.activeLimit
      : options.workspacePreviewLimit;
    const count = counts.get(key) ?? 0;
    if (count >= limit) return false;
    counts.set(key, count + 1);
    return true;
  });
  const archived = sorted.filter((thread) => thread.archived).slice(0, options.archivedLimit);
  return [...protectedThreads, ...recent, ...archived].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

/** Replace only Workspaces whose catalog request succeeded; retain all others. */
export function mergeWorkspaceSidebarCatalogPages(
  current: readonly DesktopThread[],
  pages: readonly { workspace: SidebarWorkspace; threads: readonly DesktopThread[] }[],
  options: Parameters<typeof boundWorkspaceSidebarThreads>[1],
): DesktopThread[] {
  const preserved = current.filter((thread) =>
    !pages.some(({ workspace }) => workspaceOwnsSidebarThread(workspace, thread)));
  return boundWorkspaceSidebarThreads(
    [...pages.flatMap(({ threads }) => threads), ...preserved],
    options,
  );
}
