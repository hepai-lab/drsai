import type { DesktopThread, DesktopThreadSnapshot, DesktopThreadSnapshotEnvelope } from "./desktopApi";

export function threadSnapshotHasConversation(snapshot: DesktopThreadSnapshot | null | undefined): snapshot is DesktopThreadSnapshot {
  if (!snapshot) return false;
  if ((snapshot.messageCount ?? 0) > 0) return true;
  return snapshot.messages.some((message) => message.id !== "welcome" && (
    Boolean(message.content?.trim())
    || Boolean(message.reasoningContent?.trim())
    || Boolean(message.structuredTurn)
  ));
}

export function persistedThreadSnapshotEnvelope(
  threadId: string,
  snapshot: DesktopThreadSnapshot,
  runtimeSessionId?: string,
): DesktopThreadSnapshotEnvelope {
  return {
    version: 1,
    projection: "conversation/1",
    threadId,
    runtimeSessionId: runtimeSessionId ?? `persisted:${threadId}`,
    sessionSequence: 0,
    generation: 0,
    source: "persisted",
    snapshot,
  };
}

/** Prefer a local snapshot when Runtime/cache only has an empty or thinner shell. */
export function snapshotConversationSize(snapshot: DesktopThreadSnapshot | null | undefined): number {
  if (!snapshot) return 0;
  const stored = Number.isFinite(snapshot.messageCount) ? Math.max(0, snapshot.messageCount) : 0;
  const visible = snapshot.messages.filter((message) => message.id !== "welcome").length;
  return Math.max(stored, visible);
}

export function coalesceHydrationEnvelope(
  threadId: string,
  thread: Pick<DesktopThread, "runtimeSessionId"> | undefined,
  runtimeEnvelope: DesktopThreadSnapshotEnvelope | null | undefined,
  persisted: DesktopThreadSnapshot | null | undefined,
): DesktopThreadSnapshotEnvelope | null {
  const runtimeSize = snapshotConversationSize(runtimeEnvelope?.snapshot);
  const persistedSize = snapshotConversationSize(persisted);
  if (persisted && persistedSize > runtimeSize) {
    return persistedThreadSnapshotEnvelope(threadId, persisted, thread?.runtimeSessionId);
  }
  if (runtimeEnvelope) return runtimeEnvelope;
  if (persisted) return persistedThreadSnapshotEnvelope(threadId, persisted, thread?.runtimeSessionId);
  return null;
}
