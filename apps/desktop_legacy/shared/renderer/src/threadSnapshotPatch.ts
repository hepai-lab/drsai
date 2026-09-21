import type { DesktopThreadSnapshot, DesktopThreadSnapshotPatchEvent } from "../../api/desktopApi";

export function decodeThreadSnapshotPatchEvent(value: unknown): DesktopThreadSnapshotPatchEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw incompatible();
  const event = value as Record<string, unknown>;
  if (event.version !== 2
    || typeof event.threadId !== "string" || !event.threadId
    || typeof event.runtimeSessionId !== "string" || !event.runtimeSessionId
    || !isSequence(event.baseSequence) || !isSequence(event.sessionSequence) || !isSequence(event.generation)
    || event.sessionSequence < event.baseSequence
    || !event.patch || typeof event.patch !== "object" || Array.isArray(event.patch)) throw incompatible();
  const patch = event.patch as Record<string, unknown>;
  if (patch.kind === "connection.state") {
    if (!["connected", "retrying", "degraded", "action-required"].includes(String(patch.state))
      || !Number.isFinite(patch.updatedAt)) throw incompatible();
    return value as DesktopThreadSnapshotPatchEvent;
  }
  if (typeof patch.runId !== "string" || !patch.runId
    || !Number.isFinite(patch.updatedAt) || !isSequence(patch.messageCount)) throw incompatible();
  if (patch.kind === "item.upsert") {
    if (typeof patch.itemId !== "string" || !patch.itemId || !isSequence(patch.insertAt)
      || !isMessageSnapshot(patch.message, 0)) throw incompatible();
  } else if (patch.kind === "item.delta") {
    const delta = patch.delta as Record<string, unknown> | undefined;
    if (typeof patch.itemId !== "string" || !patch.itemId || typeof patch.messageId !== "string" || !patch.messageId
      || !delta || typeof delta.kind !== "string" || typeof delta.text !== "string"
      || (delta.segmentId !== undefined && typeof delta.segmentId !== "string")) throw incompatible();
  } else if (patch.kind === "item.remove") {
    if (typeof patch.itemId !== "string" || !patch.itemId || !Array.isArray(patch.removeMessageIds)
      || !patch.removeMessageIds.every((id) => typeof id === "string")) throw incompatible();
  } else if (patch.kind === "run.state") {
    if (patch.message !== undefined && !isMessageSnapshot(patch.message, 0)) throw incompatible();
    if (patch.insertAt !== undefined && !isSequence(patch.insertAt)) throw incompatible();
  } else if (patch.kind === "run.replace") {
    if (!Array.isArray(patch.removeMessageIds) || !patch.removeMessageIds.every((id) => typeof id === "string")
      || !isSequence(patch.insertAt) || !Array.isArray(patch.messages)
      || !patch.messages.every((message) => isMessageSnapshot(message, 0)) || patch.messages.length > 10_000) throw incompatible();
  } else throw incompatible();
  if (patch.kind === "item.delta") {
    // All non-text fields were bounded above. Avoid serializing a large delta
    // a second time on the hot path; four UTF-8 bytes per UTF-16 code unit is
    // a safe upper bound.
    if ((patch.delta as { text: string }).text.length * 4 > 16 * 1024 * 1024) throw incompatible();
  } else if (encodedSize(value) > 16 * 1024 * 1024) throw incompatible();
  return value as DesktopThreadSnapshotPatchEvent;
}

function isSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isMessageSnapshot(value: unknown, depth: number): boolean {
  if (depth > 20) return false;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return typeof message.id === "string" && Boolean(message.id)
    && (message.role === "user" || message.role === "assistant" || message.role === "system")
    && typeof message.content === "string"
    && message.content.length <= 8 * 1024 * 1024
    && boundedTree(message, depth + 1);
}

function boundedTree(value: unknown, depth: number): boolean {
  if (depth > 20) return false;
  if (!value || typeof value !== "object") return true;
  if (Array.isArray(value)) return value.length <= 10_000 && value.every((item) => boundedTree(item, depth + 1));
  const entries = Object.entries(value);
  return Object.getPrototypeOf(value) === Object.prototype && entries.length <= 1_000
    && entries.every(([key, item]) => key !== "__proto__" && key !== "constructor" && key !== "prototype"
      && boundedTree(item, depth + 1));
}

function encodedSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function incompatible(): Error {
  return new Error("thread_snapshot_patch_incompatible");
}

export function applyThreadSnapshotPatch(
  snapshot: DesktopThreadSnapshot,
  rawEvent: DesktopThreadSnapshotPatchEvent | unknown,
): DesktopThreadSnapshot {
  const event = decodeThreadSnapshotPatchEvent(rawEvent);
  if (event.threadId !== snapshot.threadId) throw incompatible();
  if (event.patch.kind === "connection.state") {
    // Connection is transient Runtime/UI state. It advances the OAEP cursor,
    // but must never become a second persisted conversation fact source.
    return snapshot;
  }
  if (event.patch.kind === "item.delta") return applyItemDelta(snapshot, event.patch);
  if (event.patch.kind === "item.upsert") {
    return upsertMessage(snapshot, event.patch.message, event.patch.insertAt,
      event.patch.messageCount, event.patch.updatedAt);
  }
  if (event.patch.kind === "run.state") {
    return event.patch.message
      ? upsertMessage(snapshot, event.patch.message, event.patch.insertAt ?? snapshot.messages.length,
        event.patch.messageCount, event.patch.updatedAt)
      : { ...snapshot, messageCount: event.patch.messageCount,
        updatedAt: Math.max(snapshot.updatedAt, event.patch.updatedAt) };
  }
  const removed = new Set(event.patch.removeMessageIds);
  const found = snapshot.messages.flatMap((message, index) => removed.has(message.id) ? [index] : []);
  const remaining = snapshot.messages.filter((message) => !removed.has(message.id));
  const requestedInsert = found.length ? Math.min(...found)
    : event.patch.kind === "run.replace" ? event.patch.insertAt : remaining.length;
  const insertAt = Math.max(0, Math.min(requestedInsert, remaining.length));
  const messages = [
    ...remaining.slice(0, insertAt),
    ...(event.patch.kind === "run.replace" ? event.patch.messages : []),
    ...remaining.slice(insertAt),
  ];
  if (messages.length !== event.patch.messageCount) throw new Error("thread_snapshot_patch_count_mismatch");
  return {
    ...snapshot,
    messages,
    messageCount: event.patch.messageCount,
    updatedAt: event.patch.updatedAt,
  };
}

function upsertMessage(
  snapshot: DesktopThreadSnapshot,
  message: DesktopThreadSnapshot["messages"][number],
  requestedInsert: number,
  expectedCount: number,
  updatedAt: number,
): DesktopThreadSnapshot {
  const existingIndex = snapshot.messages.findIndex((candidate) => candidate.id === message.id);
  const messages = existingIndex >= 0
    ? snapshot.messages.map((candidate, index) => index === existingIndex ? message : candidate)
    : [...snapshot.messages.slice(0, requestedInsert), message, ...snapshot.messages.slice(requestedInsert)];
  if (messages.length !== expectedCount) throw new Error("thread_snapshot_patch_count_mismatch");
  return { ...snapshot, messages, messageCount: expectedCount, updatedAt: Math.max(snapshot.updatedAt, updatedAt) };
}

function applyItemDelta(
  snapshot: DesktopThreadSnapshot,
  patch: Extract<DesktopThreadSnapshotPatchEvent["patch"], { kind: "item.delta" }>,
): DesktopThreadSnapshot {
  const index = snapshot.messages.findIndex((message) => message.id === patch.messageId);
  if (index < 0) throw new Error("thread_snapshot_patch_delta_target_missing");
  const message = snapshot.messages[index];
  const turn = message.structuredTurn;
  if (!turn) throw new Error("thread_snapshot_patch_delta_turn_missing");
  const kind = patch.delta.kind;
  let content = message.content;
  let reasoningContent = message.reasoningContent;
  let matched = false;
  const parts = turn.parts.map((part) => {
    if (part.id !== patch.itemId) return part;
    if ((kind.startsWith("message.") || kind.startsWith("plan.")) && (part.kind === "markdown" || part.kind === "progress")) {
      matched = true;
      if (part.kind === "markdown") {
        content = `${content}${patch.delta.text}`;
        return { ...part, markdown: `${part.markdown}${patch.delta.text}` };
      }
      return { ...part, summary: `${part.summary}${patch.delta.text}` };
    }
    if (kind.startsWith("reasoning.") && part.kind === "reasoning") {
      matched = true;
      const segmentId = patch.delta.segmentId || `${patch.itemId}:text`;
      const segmentIndex = part.segments.findIndex((segment) => segment.id === segmentId);
      const segments = segmentIndex >= 0
        ? part.segments.map((segment, candidate) => candidate === segmentIndex
          ? { ...segment, text: `${segment.text}${patch.delta.text}` } : segment)
        : [...part.segments, { id: segmentId, text: patch.delta.text, status: part.status }];
      reasoningContent = segments.map((segment) => segment.text).join("\n");
      return { ...part, segments };
    }
    if (kind.startsWith("subtask.") && part.kind === "subtask") {
      matched = true;
      return { ...part, summary: `${part.summary || ""}${patch.delta.text}` };
    }
    return part;
  });
  const activities = turn.activities.map((activity) => {
    if (activity.id !== patch.itemId && activity.oaepItemId !== patch.itemId) return activity;
    if ((!kind.startsWith("command.") && !kind.startsWith("tool.")) || activity.kind !== "tool") return activity;
    matched = true;
    return { ...activity, output: `${typeof activity.output === "string" ? activity.output : ""}${patch.delta.text}` };
  });
  if (!matched) throw new Error(`thread_snapshot_patch_delta_kind_unsupported:${kind}`);
  const updated = { ...message, content, reasoningContent,
    lastEventAt: Math.max(message.lastEventAt || 0, patch.updatedAt),
    structuredTurn: { ...turn, parts, activities } };
  const messages = snapshot.messages.map((candidate, candidateIndex) => candidateIndex === index ? updated : candidate);
  if (messages.length !== patch.messageCount) throw new Error("thread_snapshot_patch_count_mismatch");
  return { ...snapshot, messages, messageCount: patch.messageCount,
    updatedAt: Math.max(snapshot.updatedAt, patch.updatedAt) };
}

export function applyThreadSnapshotPatchBatch(
  snapshot: DesktopThreadSnapshot,
  rawEvents: readonly (DesktopThreadSnapshotPatchEvent | unknown)[],
  generation: number,
): { snapshot: DesktopThreadSnapshot; appliedSequence: number } {
  let candidate = snapshot;
  let appliedSequence = 0;
  const events = rawEvents.map(decodeThreadSnapshotPatchEvent)
    .sort((left, right) => left.sessionSequence - right.sessionSequence);
  for (const event of events) {
    if (event.generation !== generation) throw new Error("thread_snapshot_patch_generation_mismatch");
    candidate = applyThreadSnapshotPatch(candidate, event);
    appliedSequence = Math.max(appliedSequence, event.sessionSequence);
  }
  return { snapshot: candidate, appliedSequence };
}
