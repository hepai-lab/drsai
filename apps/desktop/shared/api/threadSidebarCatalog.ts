import type { DesktopThread } from "./desktopApi";

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
  return !a || !b || a === b;
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

  const mergedDesktop = desktop.map((thread) => {
    const sessionId = effectiveRuntimeSessionId(thread);
    const bySession = sessionId
      ? catalog.find((item) => item.id === sessionId || effectiveRuntimeSessionId(item) === sessionId)
      : undefined;
    const byTitle = catalog.find((item) =>
      !consumed.has(item.id)
      && item.title === thread.title
      && sameWorkspace(item.workspacePath, thread.workspacePath));
    const orphan = bySession && !consumed.has(bySession.id) ? bySession : byTitle;
    if (!orphan) return {
      ...thread,
      ...(sessionId ? { runtimeSessionId: sessionId } : { runtimeSessionId: undefined }),
    };
    consumed.add(orphan.id);
    return {
      ...preferDesktopThread(thread, orphan),
      runtimeSessionId: sessionId || effectiveRuntimeSessionId(orphan) || orphan.id,
    };
  });

  return [...mergedDesktop, ...catalog.filter((item) => !consumed.has(item.id)), ...rest];
}
