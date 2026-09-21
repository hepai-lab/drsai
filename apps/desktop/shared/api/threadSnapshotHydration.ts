import type {
  DesktopThread,
  DesktopThreadSnapshot,
  DesktopThreadSnapshotEnvelope,
  DesktopThreadSnapshotRequest,
} from "./desktopApi";

/** The pseudo Runtime session id a persisted-only projection carries. */
const PERSISTED_SESSION_PREFIX = "persisted:";

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
    runtimeSessionId: runtimeSessionId ?? `${PERSISTED_SESSION_PREFIX}${threadId}`,
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

/**
 * A generation/sequence boundary that a Patch stream can agree with.
 * A persisted projection has none of its own (it is ``0``/``0``).
 */
export interface ThreadSnapshotWaterline {
  generation: number;
  sessionSequence: number;
  runtimeSessionId?: string;
}

/**
 * Whether a Hydration request asks for something only a live Runtime can
 * answer.
 *
 * ``forceFresh``, ``expectedGeneration`` and ``minimumSequence`` are how the
 * renderer says "I have already displayed a later boundary for this Thread and
 * need a snapshot at or above it"; a ``historyCursor`` asks for a page the
 * local projection simply does not have.
 */
export function threadSnapshotRequestDemandsWaterline(request: DesktopThreadSnapshotRequest): boolean {
  return request.forceFresh === true
    || request.minimumSequence !== undefined
    || request.expectedGeneration !== undefined
    || request.historyCursor !== undefined;
}

/**
 * Whether Hydration must ask the Runtime instead of answering from the local
 * projection.
 *
 * A persisted snapshot carries no Runtime waterline (generation ``0``,
 * sequence ``0``).  Answering a *waterline request* with one stranded the
 * renderer permanently: ``ThreadSnapshotCoordinator.commitEnvelope`` keeps the
 * higher generation the renderer already displayed, silently discards the
 * snapshot, and then refuses every following Patch -- including the terminal
 * ``run.completed`` of the turn -- because its ``baseSequence`` can never
 * equal the accepted sequence again.  The conversation stayed on "running" and
 * every later turn looked blocked, which is exactly the "the second message
 * never starts" report.
 *
 * Asking the Runtime is the only way to obtain a waterline the live Patch
 * stream agrees with.  A Thread without a Runtime binding (remote Workspace
 * sessions, legacy imported chats) has nothing to ask, so the local projection
 * remains the answer there.  ``coalesceHydrationEnvelope`` still lets the
 * richer persisted conversation body win *inside* a Runtime-answered result.
 */
export function threadSnapshotHydrationConsultsRuntime(input: {
  hasPersistedConversation: boolean;
  hasRuntimeBinding: boolean;
  request: DesktopThreadSnapshotRequest;
}): boolean {
  if (!input.hasRuntimeBinding) return false;
  return threadSnapshotRequestDemandsWaterline(input.request) || !input.hasPersistedConversation;
}

/**
 * Stamp an envelope that has no Runtime waterline of its own with the waterline
 * the Runtime -- or the last event this process published for the Thread --
 * reported.  The conversation body is deliberately left alone: the persisted
 * projection is frequently the fuller one, and replacing it is what used to
 * blank a restored conversation.
 */
export function rewaterlineEnvelope(
  envelope: DesktopThreadSnapshotEnvelope,
  waterline: ThreadSnapshotWaterline | null | undefined,
): DesktopThreadSnapshotEnvelope {
  if (!waterline) return envelope;
  const ephemeral = envelope.runtimeSessionId.startsWith(PERSISTED_SESSION_PREFIX);
  // A sequence belongs to exactly one Runtime session: never carry it across.
  if (!ephemeral && waterline.runtimeSessionId && waterline.runtimeSessionId !== envelope.runtimeSessionId) {
    return envelope;
  }
  if (envelope.generation > waterline.generation) return envelope;
  if (envelope.generation === waterline.generation && envelope.sessionSequence >= waterline.sessionSequence) {
    return envelope;
  }
  return {
    ...envelope,
    runtimeSessionId: ephemeral && waterline.runtimeSessionId ? waterline.runtimeSessionId : envelope.runtimeSessionId,
    generation: waterline.generation,
    sessionSequence: waterline.sessionSequence,
  };
}

/**
 * How a pushed Snapshot envelope must be applied to the body the renderer
 * already displays.
 *
 * ``keep_richer_body`` is the case that used to stall a Thread: a restarted
 * Runtime republishes the Thread from a fresh generation with an empty message
 * list, and the renderer dropped the whole envelope to protect the conversation
 * the reader was in.  The waterline is what Patch v2 continues from, so the
 * envelope must still be committed -- only its body is discarded.
 */
export type ThreadSnapshotBodyDecision = "replace" | "keep_richer_body" | "ignore";

export function threadSnapshotBodyDecision(input: {
  incomingHasConversation: boolean;
  existingHasConversation: boolean;
  envelopeHasWaterline: boolean;
}): ThreadSnapshotBodyDecision {
  if (input.incomingHasConversation) return "replace";
  if (!input.existingHasConversation) return "replace";
  return input.envelopeHasWaterline ? "keep_richer_body" : "ignore";
}
