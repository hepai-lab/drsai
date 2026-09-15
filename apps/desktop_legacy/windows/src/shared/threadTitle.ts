const DEFAULT_THREAD_TITLES = new Set(["New chat", "新会话", "Agent run"]);

export function isDefaultThreadTitle(title: string | undefined): boolean {
  if (!title) return true;
  const trimmed = title.trim();
  return !trimmed || DEFAULT_THREAD_TITLES.has(trimmed);
}

export function resolveThreadDisplayTitle(
  threadTitle: string,
  snapshotTitle?: string | null,
): string {
  if (!isDefaultThreadTitle(threadTitle)) return threadTitle;
  if (snapshotTitle && !isDefaultThreadTitle(snapshotTitle)) return snapshotTitle;
  return threadTitle;
}

export function resolvePersistedThreadTitle(options: {
  hasRequestedTitle: boolean;
  requestedTitle?: string;
  existingTitle?: string;
  snapshotTitle?: string;
  fallbackTitle: string;
}): string {
  if (options.hasRequestedTitle) {
    return options.requestedTitle || options.fallbackTitle;
  }
  if (options.existingTitle && !isDefaultThreadTitle(options.existingTitle)) {
    return options.existingTitle;
  }
  if (options.snapshotTitle && !isDefaultThreadTitle(options.snapshotTitle)) {
    return options.snapshotTitle;
  }
  return options.existingTitle || options.fallbackTitle;
}

/** Minimal thread shape for empty-chat reuse (avoids coupling to DesktopThread). */
export type EmptyChatReuseCandidate = {
  id: string;
  kind: string;
  title: string;
  workspacePath?: string;
  messageCount?: number;
  archived?: boolean;
  updatedAt: string;
  fork?: unknown;
};

/**
 * True when a chat thread is still unused: default title, no messages, not archived/forked.
 * Prefer snapshot counts/titles when available so stale thread rows are not reused.
 */
export function isReusableEmptyChatThread(
  thread: EmptyChatReuseCandidate,
  snapshot?: { messageCount?: number; title?: string } | null,
): boolean {
  if (thread.archived) return false;
  if (thread.kind !== "chat") return false;
  if (thread.fork) return false;
  const messageCount = snapshot?.messageCount ?? thread.messageCount ?? 0;
  if (messageCount > 0) return false;
  const title = snapshot?.title ?? thread.title;
  return isDefaultThreadTitle(title);
}

/**
 * Prefer the most recently updated empty default chat in the same workspace
 * so "New chat" does not keep stacking duplicate "新会话" rows.
 */
export function findReusableEmptyChatThread<T extends EmptyChatReuseCandidate>(
  threads: T[],
  workspacePath: string | undefined,
  samePath: (left?: string | null, right?: string | null) => boolean,
  getSnapshot?: (
    threadId: string,
  ) => { messageCount?: number; title?: string } | null | undefined,
): T | undefined {
  const empties = listReusableEmptyChatThreads(
    threads,
    workspacePath,
    samePath,
    getSnapshot,
  );
  return empties[0];
}

/** Empty default chats for a workspace, newest first. */
export function listReusableEmptyChatThreads<T extends EmptyChatReuseCandidate>(
  threads: T[],
  workspacePath: string | undefined,
  samePath: (left?: string | null, right?: string | null) => boolean,
  getSnapshot?: (
    threadId: string,
  ) => { messageCount?: number; title?: string } | null | undefined,
): T[] {
  const path = workspacePath?.trim() || "";
  const candidates = threads.filter((thread) => {
    if (!isReusableEmptyChatThread(thread, getSnapshot?.(thread.id))) return false;
    if (!path) return !(thread.workspacePath?.trim());
    return samePath(thread.workspacePath, path);
  });
  return [...candidates].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

/** Ids of duplicate empty chats to drop, keeping the newest per workspace. */
export function duplicateEmptyChatThreadIds<T extends EmptyChatReuseCandidate>(
  threads: T[],
  samePath: (left?: string | null, right?: string | null) => boolean,
  getSnapshot?: (
    threadId: string,
  ) => { messageCount?: number; title?: string } | null | undefined,
): string[] {
  const empties = threads.filter((thread) =>
    isReusableEmptyChatThread(thread, getSnapshot?.(thread.id)),
  );
  const keep = new Set<string>();
  const drop: string[] = [];
  const sorted = [...empties].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  for (const thread of sorted) {
    const alreadyKept = [...keep].some((keptId) => {
      const kept = empties.find((item) => item.id === keptId);
      if (!kept) return false;
      const leftPath = kept.workspacePath?.trim() || "";
      const rightPath = thread.workspacePath?.trim() || "";
      if (!leftPath && !rightPath) return true;
      return samePath(kept.workspacePath, thread.workspacePath);
    });
    if (alreadyKept) {
      drop.push(thread.id);
    } else {
      keep.add(thread.id);
    }
  }
  return drop;
}
