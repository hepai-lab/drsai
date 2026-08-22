import type {
  DesktopThread,
  DesktopThreadHistoryState,
  DesktopThreadSnapshot,
  DesktopThreadSnapshotPatchEvent,
} from "../api/desktopApi";
import type { OaepEvent, OaepItem, OaepRun } from "./runtimeClient";
import { materializeOaepDeltaShadow, type OaepSessionState } from "./oaepSessionStream";
import { projectOaepThreadSnapshot } from "./threadRuntimeProjection";

/**
 * Main-process materialized view for one OAEP Session.
 * Initial hydration is allowed to scan history; live updates only re-project
 * the affected Run and emit a bounded patch instead of the complete history.
 */
export class SessionViewStore {
  private snapshotValue: DesktopThreadSnapshot;
  private readonly messageIdsByRun = new Map<string, string[]>();
  private readonly itemIdsByRun = new Map<string, Set<string>>();
  private readonly messageIdByItem = new Map<string, string>();
  private readonly insertAtByRun = new Map<string, number>();
  private readonly pendingPatches = new Map<string, Extract<DesktopThreadSnapshotPatchEvent["patch"], { kind: "run.replace" }>>();
  private sequenceValue = 0;
  private generationValue = 0;
  private latestState: OaepSessionState | undefined;
  private readonly dirtyRuns = new Set<string>();

  constructor(
    private readonly thread: DesktopThread,
    private readonly runtimeSessionId: string,
    private readonly history: DesktopThreadHistoryState,
  ) {
    this.snapshotValue = {
      threadId: thread.id,
      title: thread.title,
      messages: [],
      updatedAt: Date.parse(thread.updatedAt) || Date.now(),
      messageCount: 0,
      history,
    };
  }

  get sequence(): number { return this.sequenceValue; }
  get generation(): number { return this.generationValue; }
  get snapshot(): DesktopThreadSnapshot {
    if (this.pendingPatches.size) {
      let messages = this.snapshotValue.messages;
      for (const patch of this.pendingPatches.values()) {
        const removed = new Set(patch.removeMessageIds);
        const found = messages.flatMap((message, index) => removed.has(message.id) ? [index] : []);
        const remaining = messages.filter((message) => !removed.has(message.id));
        const insertAt = Math.min(found.length ? Math.min(...found) : patch.insertAt, remaining.length);
        messages = [...remaining.slice(0, insertAt), ...patch.messages, ...remaining.slice(insertAt)];
      }
      this.pendingPatches.clear();
      this.snapshotValue = { ...this.snapshotValue, messages };
    }
    if (this.latestState && this.dirtyRuns.size) {
      let messages = this.snapshotValue.messages;
      for (const runId of this.dirtyRuns) {
        const projected = this.projectRun(runId, this.latestState);
        const removed = new Set(this.messageIdsByRun.get(runId) ?? []);
        const found = messages.flatMap((message, index) => removed.has(message.id) ? [index] : []);
        const remaining = messages.filter((message) => !removed.has(message.id));
        const insertAt = Math.min(found.length ? Math.min(...found)
          : this.insertAtByRun.get(runId) ?? remaining.length, remaining.length);
        messages = [...remaining.slice(0, insertAt), ...projected, ...remaining.slice(insertAt)];
        this.messageIdsByRun.set(runId, projected.map((message) => message.id));
        this.mapRunItemsToMessages(runId, projected);
      }
      this.dirtyRuns.clear();
      this.snapshotValue = { ...this.snapshotValue, messages, messageCount: messages.length,
        updatedAt: Math.max(this.snapshotValue.updatedAt, ...messages.map((message) => message.lastEventAt || 0)) };
    }
    return this.snapshotValue;
  }

  reset(state: OaepSessionState): DesktopThreadSnapshot {
    // A delayed history read or resnapshot must never replace newer live
    // content that this Store has already reduced.
    if (this.sequenceValue > 0 && state.cursor < this.sequenceValue) return this.snapshot;
    this.sequenceValue = state.cursor;
    this.generationValue += 1;
    this.snapshotValue = projectOaepThreadSnapshot(
      this.thread,
      state.items.values(),
      state.runs.values(),
      {
        ...this.history,
        loadedRuns: state.runs.size,
        totalRuns: Math.max(this.history.totalRuns, state.runs.size),
        loadedItems: state.items.size,
        totalItems: Math.max(this.history.totalItems, state.items.size),
      },
    );
    this.messageIdsByRun.clear();
    this.itemIdsByRun.clear();
    this.insertAtByRun.clear();
    this.pendingPatches.clear();
    this.messageIdByItem.clear();
    this.dirtyRuns.clear();
    this.latestState = state;
    for (const item of state.items.values()) {
      const ids = this.itemIdsByRun.get(item.run_id) ?? new Set<string>();
      ids.add(item.id);
      this.itemIdsByRun.set(item.run_id, ids);
    }
    const runByItem = new Map([...state.items.values()].map((item) => [item.id, item.run_id]));
    const runIds = [...new Set([...state.runs.keys(), ...[...state.items.values()].map((item) => item.run_id)])];
    for (const runId of runIds) this.messageIdsByRun.set(runId, []);
    for (const [index, message] of this.snapshotValue.messages.entries()) {
      const runId = runByItem.get(message.id)
        ?? runIds.find((candidate) => message.id === `oaep:${candidate}:assistant`
          || message.id.startsWith(`oaep:${candidate}:segment:`));
      if (!runId) continue;
      this.messageIdsByRun.get(runId)?.push(message.id);
      if (!this.insertAtByRun.has(runId)) this.insertAtByRun.set(runId, index);
    }
    for (const runId of runIds) this.mapRunItemsToMessages(runId, this.snapshotValue.messages);
    return this.snapshotValue;
  }

  apply(event: OaepEvent, state: OaepSessionState): DesktopThreadSnapshotPatchEvent | null {
    const embeddedRun = event.data.run;
    const runId = event.run_id || (embeddedRun && typeof embeddedRun === "object" && "id" in embeddedRun
      ? String(embeddedRun.id)
      : undefined);
    if (!runId) return null;
    const itemWasKnown = Boolean(event.item_id && this.itemIdsByRun.get(runId)?.has(event.item_id));
    if (event.item_id) {
      const ids = this.itemIdsByRun.get(runId) ?? new Set<string>();
      ids.add(event.item_id);
      this.itemIdsByRun.set(runId, ids);
    }

    const baseSequence = this.sequenceValue;
    this.sequenceValue = event.sequence;
    this.latestState = state;
    const existingMessageId = event.item_id ? this.messageIdByItem.get(event.item_id) : undefined;
    if (event.item_id && event.data.delta && itemWasKnown && existingMessageId) {
      const delta = event.data.delta as unknown as Record<string, unknown>;
      this.dirtyRuns.add(runId);
      const updatedAt = Math.max(this.snapshotValue.updatedAt, Date.parse(event.timestamp) || 0);
      this.snapshotValue = { ...this.snapshotValue, updatedAt };
      return {
        version: 2, threadId: this.thread.id, runtimeSessionId: this.runtimeSessionId,
        baseSequence, sessionSequence: event.sequence, generation: this.generationValue,
        patch: {
          kind: "item.delta", runId, itemId: event.item_id, messageId: existingMessageId,
          delta: {
            kind: String(delta.kind || ""), text: typeof delta.text === "string" ? delta.text : "",
            ...(typeof delta.segment_id === "string" ? { segmentId: delta.segment_id } : {}),
          },
          updatedAt, messageCount: this.snapshotValue.messageCount,
        },
      };
    }

    const removeMessageIds = this.messageIdsByRun.get(runId) ?? [];
    const insertAt = this.insertAtByRun.get(runId) ?? this.snapshotValue.messageCount;
    const messages = this.projectRun(runId, state);
    const boundedInsertAt = Math.min(insertAt, this.snapshotValue.messageCount - removeMessageIds.length);
    if (!this.insertAtByRun.has(runId)) this.insertAtByRun.set(runId, boundedInsertAt);
    this.messageIdsByRun.set(runId, messages.map((message) => message.id));
    this.mapRunItemsToMessages(runId, messages);
    const updatedAt = Math.max(
      this.snapshotValue.updatedAt,
      ...messages.map((message) => message.lastEventAt || 0),
    );
    const messageCount = this.snapshotValue.messageCount - removeMessageIds.length + messages.length;
    this.snapshotValue = {
      ...this.snapshotValue,
      updatedAt,
      messageCount,
    };
    const internalPatch = {
      kind: "run.replace" as const, runId, removeMessageIds, insertAt: boundedInsertAt,
      messages, updatedAt, messageCount,
    };
    this.pendingPatches.set(runId, internalPatch);
    const target = (event.item_id ? messages.find((message) => messageContainsItem(message, event.item_id!)) : undefined)
      ?? messages.at(-1);
    if (event.item_id && target) {
      return {
        version: 2, threadId: this.thread.id, runtimeSessionId: this.runtimeSessionId,
        baseSequence, sessionSequence: event.sequence, generation: this.generationValue,
        patch: {
          kind: "item.upsert", runId, itemId: event.item_id, message: target,
          insertAt: boundedInsertAt + Math.max(0, messages.indexOf(target)), updatedAt, messageCount,
        },
      };
    }
    if (target) {
      return {
        version: 2, threadId: this.thread.id, runtimeSessionId: this.runtimeSessionId,
        baseSequence, sessionSequence: event.sequence, generation: this.generationValue,
        patch: { kind: "run.state", runId, message: target,
          insertAt: boundedInsertAt + Math.max(0, messages.indexOf(target)), updatedAt, messageCount },
      };
    }
    return {
      version: 2,
      threadId: this.thread.id,
      runtimeSessionId: this.runtimeSessionId,
      baseSequence,
      sessionSequence: event.sequence,
      generation: this.generationValue,
      patch: { kind: "run.state", runId, updatedAt, messageCount },
    };
  }

  connection(state: "connected" | "retrying" | "degraded" | "action-required"): DesktopThreadSnapshotPatchEvent {
    return {
      version: 2,
      threadId: this.thread.id,
      runtimeSessionId: this.runtimeSessionId,
      baseSequence: this.sequenceValue,
      sessionSequence: this.sequenceValue,
      generation: this.generationValue,
      patch: { kind: "connection.state", state, updatedAt: Date.now() },
    };
  }

  private projectRun(runId: string, state: OaepSessionState) {
    const items = [...(this.itemIdsByRun.get(runId) ?? [])]
      .map((itemId) => state.items.get(itemId)
        ?? (state.deltaShadows.get(itemId) ? materializeOaepDeltaShadow(state.deltaShadows.get(itemId)!) : undefined))
      .filter((item): item is OaepItem => Boolean(item));
    const run = state.runs.get(runId);
    return projectOaepThreadSnapshot(
      this.thread,
      items,
      run ? [run as OaepRun] : [],
    ).messages;
  }

  private mapRunItemsToMessages(runId: string, messages: DesktopThreadSnapshot["messages"]): void {
    for (const itemId of this.itemIdsByRun.get(runId) ?? []) {
      const message = messages.find((candidate) => messageContainsItem(candidate, itemId))
        ?? (messages.length === 1 ? messages[0] : undefined);
      if (message) this.messageIdByItem.set(itemId, message.id);
    }
  }
}

function messageContainsItem(message: DesktopThreadSnapshot["messages"][number], itemId: string): boolean {
  if (message.id === itemId) return true;
  const turn = message.structuredTurn;
  return Boolean(turn?.parts.some((part) => part.id === itemId)
    || turn?.activities.some((activity) => activity.id === itemId || activity.oaepItemId === itemId));
}
