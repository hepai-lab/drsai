import type {
  AgentMessageConfig,
  Message,
  Run,
  StreamV2Event,
  StreamV2Snapshot,
  WebSocketMessage,
} from "../../components/types/datamodel";
import { isDefaultContinuationPrompt } from "../../components/types/datamodel";

export type TurnPlane = "process" | "final";

export interface StreamMessageEntity {
  messageId: string;
  streamId: string;
  source: string;
  reasoning: string;
  content: string;
  status: StreamV2Snapshot["status"];
  plane: TurnPlane;
}

export interface ChatStreamState {
  runId: string;
  lastSeq: number;
  seenEventIds: Set<string>;
  byId: Record<string, StreamMessageEntity>;
  order: string[];
  pending: Map<number, StreamV2Event>;
  needsResume: boolean;
  sealedFinalIds: Set<string>;
}

export function createChatStreamState(runId: string): ChatStreamState {
  return {
    runId,
    lastSeq: 0,
    seenEventIds: new Set(),
    byId: {},
    order: [],
    pending: new Map(),
    needsResume: false,
    sealedFinalIds: new Set(),
  };
}

function demoteUnsealedCandidates(
  byId: Record<string, StreamMessageEntity>,
  order: string[],
  sealedFinalIds: Set<string>
): Record<string, StreamMessageEntity> {
  const next = { ...byId };
  let changed = false;
  for (const id of order) {
    if (sealedFinalIds.has(id)) continue;
    const entity = next[id];
    if (entity?.plane !== "final") continue;
    next[id] = { ...entity, plane: "process" };
    changed = true;
  }
  return changed ? next : byId;
}

function sealTurnPlanes(
  state: ChatStreamState,
  finalMessageId: string | undefined
): Pick<ChatStreamState, "byId" | "sealedFinalIds"> {
  const sealed = new Set(state.sealedFinalIds ?? []);
  const byId = { ...state.byId };
  const resolved =
    (finalMessageId && byId[finalMessageId] && finalMessageId) ||
    [...state.order].reverse().find((id) => {
      const entity = byId[id];
      return (
        !!entity &&
        !sealed.has(id) &&
        entity.status === "completed" &&
        entity.source !== "user" &&
        entity.source !== "user_proxy"
      );
    });
  for (const id of state.order) {
    if (sealed.has(id)) continue;
    const entity = byId[id];
    if (!entity) continue;
    if (resolved && id === resolved) {
      byId[id] = { ...entity, plane: "final" };
      sealed.add(id);
    } else if (entity.plane === "final") {
      byId[id] = { ...entity, plane: "process" };
    }
  }
  return { byId, sealedFinalIds: sealed };
}

function applyOrderedEvent(
  state: ChatStreamState,
  event: StreamV2Event
): ChatStreamState {
  const seenEventIds = new Set(state.seenEventIds).add(event.event_id);

  if (event.event === "turn.ready") {
    const sealed = sealTurnPlanes(
      state,
      event.final_message_id || event.message_id
    );
    return {
      ...state,
      ...sealed,
      lastSeq: event.seq,
      seenEventIds,
    };
  }

  // Other run-level control events advance the cursor without creating chat rows.
  if (
    event.event === "interaction.required" ||
    event.event === "agent.working"
  ) {
    return {
      ...state,
      lastSeq: event.seq,
      seenEventIds,
    };
  }

  const existing = state.byId[event.message_id];
  let byId = state.byId;
  if (!existing && event.event === "message.started") {
    byId = demoteUnsealedCandidates(
      state.byId,
      state.order,
      state.sealedFinalIds ?? new Set()
    );
  }
  const entity: StreamMessageEntity = existing || {
    messageId: event.message_id,
    streamId: event.stream_id,
    source: event.source || "assistant",
    reasoning: "",
    content: "",
    status: "streaming",
    plane: "final",
  };
  let nextEntity = entity;

  if (event.event === "message.delta" && event.delta && event.channel) {
    if (entity.status === "streaming") {
      const previous = entity[event.channel];
      // Deltas are append-only. event_id/seq dedupe prevents double application.
      nextEntity = { ...entity, [event.channel]: previous + event.delta };
    }
  } else if (
    (event.event === "message.snapshot" ||
      event.event === "message.completed") &&
    event.snapshot
  ) {
    // A stale persistence snapshot must never make visible content shorter.
    const content =
      event.snapshot.content.length >= entity.content.length
        ? event.snapshot.content
        : entity.content;
    const reasoning =
      event.snapshot.reasoning.length >= entity.reasoning.length
        ? event.snapshot.reasoning
        : entity.reasoning;
    const nextStatus =
      event.snapshot.status === "streaming" ||
      event.snapshot.status === "completed" ||
      event.snapshot.status === "interrupted"
        ? event.snapshot.status
        : entity.status;
    const sealed = state.sealedFinalIds?.has(entity.messageId);
    nextEntity = {
      ...entity,
      content,
      reasoning,
      status: nextStatus,
      plane: sealed
        ? entity.plane
        : nextStatus === "interrupted"
          ? "process"
          : "final",
    };
  } else if (event.event === "message.started") {
    nextEntity = existing
      ? entity
      : { ...entity, status: "streaming", plane: "final" };
  }

  return {
    ...state,
    lastSeq: event.seq,
    seenEventIds,
    byId: { ...byId, [event.message_id]: nextEntity },
    order: existing ? state.order : [...state.order, event.message_id],
  };
}

export function reduceStreamEvent(
  state: ChatStreamState,
  event: StreamV2Event
): ChatStreamState {
  if (
    event.run_id !== state.runId ||
    state.seenEventIds.has(event.event_id) ||
    event.seq <= state.lastSeq
  ) {
    return state;
  }
  if (event.seq > state.lastSeq + 1) {
    // A snapshot is the recovery boundary: it intentionally supersedes an
    // unavailable journal prefix and establishes a new cursor.
    if (event.event === "message.snapshot") {
      return {
        ...applyOrderedEvent(state, event),
        pending: new Map(),
        needsResume: false,
      };
    }
    const pending = new Map(state.pending);
    pending.set(event.seq, event);
    return { ...state, pending, needsResume: true };
  }

  let next = applyOrderedEvent(state, event);
  const pending = new Map(next.pending);
  while (pending.has(next.lastSeq + 1)) {
    const queued = pending.get(next.lastSeq + 1)!;
    pending.delete(next.lastSeq + 1);
    next = applyOrderedEvent({ ...next, pending }, queued);
  }
  return { ...next, pending, needsResume: pending.size > 0 };
}

export function streamMessageId(message: Message): string | undefined {
  const metadata = (message.config.metadata || {}) as Record<string, unknown>;
  return (
    (typeof metadata.message_id === "string" && metadata.message_id) ||
    message.uuid ||
    undefined
  );
}

function entityConfig(
  entity: StreamMessageEntity,
  sealedFinal: boolean
): AgentMessageConfig {
  const reasoning = entity.reasoning.trim();
  const content = entity.content;
  const isFinal = entity.plane === "final";
  const display =
    !isFinal && reasoning ? `<think>${reasoning}</think>\n\n${content}` : content;
  return {
    source: entity.source,
    type: "TextMessage",
    content: display,
    metadata: {
      message_id: entity.messageId,
      stream_id: entity.streamId,
      stream_protocol: "2",
      stream_status: entity.status,
      turn_plane: entity.plane,
      reasoning_status:
        entity.status === "streaming" ? "streaming" : "completed",
      ...(sealedFinal ? { is_turn_final: "yes" } : {}),
      ...(reasoning
        ? { _peeled_thought: reasoning, reasoning_summary: reasoning.slice(0, 2000) }
        : {}),
    },
  } as AgentMessageConfig;
}

/** Materialize only changed v2 entities while preserving legacy/process rows. */
export function materializeStreamMessages(
  current: Message[],
  state: ChatStreamState,
  sessionId: number,
  userId?: string
): Message[] {
  const positions = new Map<string, number>();
  current.forEach((message, index) => {
    const id = streamMessageId(message);
    if (id) positions.set(id, index);
  });
  const next = [...current];
  for (const id of state.order) {
    const entity = state.byId[id];
    if (!entity) continue;
    const sealedFinal = state.sealedFinalIds?.has(id) === true;
    const index = positions.get(id);
    if (index !== undefined) {
      next[index] = {
        ...next[index],
        uuid: id,
        config: entityConfig(entity, sealedFinal),
      };
    } else {
      positions.set(id, next.length);
      next.push({
        uuid: id,
        run_id: state.runId,
        session_id: sessionId,
        user_id: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        config: entityConfig(entity, sealedFinal),
      });
    }
  }
  return next;
}

function messageFingerprint(message: Message): string {
  const content =
    typeof message.config.content === "string" ? message.config.content : "";
  return `${message.config.source || ""}::${content}`;
}

/**
 * Map persisted awaiting_input + default continuation into the v2 ``ready``
 * status so reloads do not revive the "waiting for input" banner.
 */
export function normalizeRunInteractionStatus(run: Run): Run {
  if (run.status !== "awaiting_input") return run;
  const request = run.input_request as
    | { kind?: string; prompt?: string; input_type?: string }
    | undefined;
  if (
    request?.kind === "turn_ready" ||
    isDefaultContinuationPrompt(request?.prompt, request?.input_type)
  ) {
    return {
      ...run,
      status: "ready",
      input_request: undefined,
    };
  }
  return run;
}

/**
 * Merge persistence into live state.
 * Uses the persisted order as the spine so a DB user row cannot be appended
 * after a live assistant reply (that inverted "答案在上 / 问题在下").
 */
export function reconcilePersistedMessages(
  live: Message[],
  persisted: Message[]
): Message[] {
  if (!persisted.length) return live;
  if (!live.length) return persisted;

  const usedLive = new Set<number>();
  const matchLive = (persistedMessage: Message): number => {
    const persistedId = streamMessageId(persistedMessage);
    const fingerprint = messageFingerprint(persistedMessage);
    for (let index = 0; index < live.length; index++) {
      if (usedLive.has(index)) continue;
      const liveId = streamMessageId(live[index]);
      if (persistedId && liveId && persistedId === liveId) return index;
      if (messageFingerprint(live[index]) === fingerprint) return index;
    }
    return -1;
  };

  const result: Message[] = [];
  for (const persistedMessage of persisted) {
    const liveIndex = matchLive(persistedMessage);
    if (liveIndex < 0) {
      result.push(persistedMessage);
      continue;
    }
    usedLive.add(liveIndex);
    const liveMessage = live[liveIndex];
    const liveMeta = (liveMessage.config.metadata || {}) as Record<
      string,
      unknown
    >;
    const id = streamMessageId(persistedMessage) || liveMessage.uuid;
    if (liveMeta.stream_protocol === "2") {
      result.push({
        ...persistedMessage,
        ...liveMessage,
        uuid: id,
        config: {
          ...persistedMessage.config,
          ...liveMessage.config,
          metadata: {
            ...(persistedMessage.config.metadata || {}),
            ...(liveMessage.config.metadata || {}),
          },
        },
      });
    } else {
      result.push({
        ...liveMessage,
        ...persistedMessage,
        uuid: id,
        config: {
          ...liveMessage.config,
          ...persistedMessage.config,
          metadata: {
            ...(liveMessage.config.metadata || {}),
            ...(persistedMessage.config.metadata || {}),
          },
        },
      });
    }
  }

  for (let index = 0; index < live.length; index++) {
    if (!usedLive.has(index)) result.push(live[index]);
  }
  return result;
}

/** Temporary ingress adapter; all downstream state still consumes v2. */
export class LegacyStreamAdapter {
  private seq = 0;
  private active = new Map<string, { messageId: string; streamId: string }>();

  constructor(private readonly runId: string) {}

  adapt(message: WebSocketMessage): StreamV2Event[] {
    if (
      message.type !== "message_chunk" &&
      message.type !== "message_thinking" &&
      message.type !== "message"
    ) {
      return [];
    }
    const data = (message.data || {}) as AgentMessageConfig;
    const source = data.source || "assistant";
    let identity = this.active.get(source);
    const events: StreamV2Event[] = [];
    if (!identity) {
      identity = {
        messageId: crypto.randomUUID(),
        streamId: crypto.randomUUID(),
      };
      this.active.set(source, identity);
      events.push(this.event(identity, source, "message.started"));
    }
    const content = typeof data.content === "string" ? data.content : "";
    if (message.type === "message_chunk" && content) {
      events.push(
        this.event(identity, source, "message.delta", {
          channel: "content",
          delta: content,
        })
      );
    } else if (message.type === "message_thinking" && content) {
      events.push(
        this.event(identity, source, "message.snapshot", {
          snapshot: {
            reasoning: content,
            content: "",
            status: "streaming",
          },
        })
      );
    } else if (message.type === "message") {
      events.push(
        this.event(identity, source, "message.completed", {
          snapshot: {
            reasoning: "",
            content,
            status: "completed",
          },
          status: "completed",
        })
      );
      this.active.delete(source);
    }
    return events;
  }

  private event(
    identity: { messageId: string; streamId: string },
    source: string,
    event: StreamV2Event["event"],
    extra: Partial<StreamV2Event> = {}
  ): StreamV2Event {
    this.seq += 1;
    return {
      type: "stream.v2",
      protocol_version: 2,
      event_id: crypto.randomUUID(),
      run_id: this.runId,
      stream_id: identity.streamId,
      message_id: identity.messageId,
      seq: this.seq,
      event,
      source,
      ...extra,
    };
  }
}
