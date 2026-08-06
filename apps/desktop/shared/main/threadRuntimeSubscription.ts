import type {
  DesktopRuntimeLogEvent,
  DesktopThread,
  DesktopThreadHistoryState,
  DesktopThreadSnapshot,
  DesktopThreadSnapshotEnvelope,
  DesktopThreadSnapshotRequest,
  DesktopThreadSnapshotPatchEvent,
} from "../api/desktopApi";
import { connectRuntimeClientForWorkspace, type OaepEvent } from "./runtimeClient";
import { selectRuntimeConversationProtocol } from "./runtimeProtocolSelection";
import { projectOaepThreadSnapshot, projectRuntimeThreadSnapshot } from "./threadRuntimeProjection";
import {
  subscribeSessionConversation,
  type SessionConversationSubscription,
} from "./sessionConversationSubscription";
import { sessionSyncState } from "./sessionSyncState";
import { desktopDiagnostics } from "./diagnostics";
import { subscribeOaepSession } from "./oaepSessionStream";
import { SessionViewStore } from "./sessionViewStore";
import { syncSessionHistorySingleflight } from "./sessionHistorySync";
import { LegacyConversationAdapter } from "./legacyConversationAdapter";
import { legacyProtocolTelemetry } from "./legacyProtocolTelemetry";
import { ThreadSnapshotEnvelopeCache } from "./threadSnapshotEnvelopeCache";

interface ThreadSnapshotEvent {
  version: 1;
  projection: "oaep/1" | "conversation/1";
  threadId: string;
  runtimeSessionId: string;
  sessionSequence: number;
  generation: number;
  snapshot: DesktopThreadSnapshot;
}

const latestSnapshotEnvelopeByThread = new ThreadSnapshotEnvelopeCache();

export interface ThreadSnapshotTarget {
  isDestroyed?(): boolean;
  send(channel: "desktop:thread-snapshot", event: ThreadSnapshotEvent): void;
  send(channel: "desktop:thread-snapshot-patch", event: DesktopThreadSnapshotPatchEvent): void;
  send(channel: "desktop:runtime-log", event: DesktopRuntimeLogEvent): void;
}

let runtimeLogId = 0;

function sendThreadSnapshotEvent(
  target: ThreadSnapshotTarget,
  channel: "desktop:thread-snapshot",
  event: ThreadSnapshotEvent,
): void;
function sendThreadSnapshotEvent(
  target: ThreadSnapshotTarget,
  channel: "desktop:thread-snapshot-patch",
  event: DesktopThreadSnapshotPatchEvent,
): void;
function sendThreadSnapshotEvent(
  target: ThreadSnapshotTarget,
  channel: "desktop:runtime-log",
  event: DesktopRuntimeLogEvent,
): void;
function sendThreadSnapshotEvent(
  target: ThreadSnapshotTarget,
  channel: "desktop:thread-snapshot" | "desktop:thread-snapshot-patch" | "desktop:runtime-log",
  event: ThreadSnapshotEvent | DesktopThreadSnapshotPatchEvent | DesktopRuntimeLogEvent,
): void {
  try {
    if (target.isDestroyed?.()) return;
    if (channel === "desktop:thread-snapshot") {
      const snapshotEvent = event as ThreadSnapshotEvent;
      const current = latestSnapshotEnvelopeByThread.get(snapshotEvent.threadId);
      if (!current || snapshotEvent.generation > current.generation
        || (snapshotEvent.generation === current.generation
          && snapshotEvent.sessionSequence >= current.sessionSequence)) {
        latestSnapshotEnvelopeByThread.set(snapshotEvent.threadId, snapshotEvent);
      }
      target.send(channel, event as ThreadSnapshotEvent);
    } else if (channel === "desktop:thread-snapshot-patch") {
      latestSnapshotEnvelopeByThread.markStale((event as DesktopThreadSnapshotPatchEvent).threadId);
      target.send(channel, event as DesktopThreadSnapshotPatchEvent);
    } else {
      target.send(channel, event as DesktopRuntimeLogEvent);
    }
  } catch (error) {
    if (!/destroyed/i.test(errorMessage(error))) throw error;
  }
}

function emitRuntimeLog(
  target: ThreadSnapshotTarget,
  thread: DesktopThread,
  sessionId: string,
  event: Omit<DesktopRuntimeLogEvent, "id" | "timestamp" | "threadId" | "sessionId">,
): void {
  const runtimeEvent: DesktopRuntimeLogEvent = {
    ...event,
    id: `runtime-log-${Date.now()}-${++runtimeLogId}`,
    timestamp: new Date().toISOString(),
    threadId: thread.id,
    sessionId,
    ...(event.details ? { details: sanitizeRuntimeDetails(event.details) } : {}),
  };
  sendThreadSnapshotEvent(target, "desktop:runtime-log", runtimeEvent);
  void desktopDiagnostics.record({
    id: runtimeEvent.id,
    traceId: runtimeEvent.runId || runtimeEvent.sessionId,
    spanId: runtimeEvent.id,
    module: "runtime",
    component: runtimeEvent.protocol,
    operation: runtimeEvent.operation,
    message: runtimeEvent.message,
    kind: runtimeEvent.status === "failed" ? "error" : "log",
    level: runtimeEvent.level,
    status: runtimeEvent.status,
    domain: "protocol",
    visibility: runtimeEvent.phase === "event" || runtimeEvent.phase === "cursor" ? "raw" : "detail",
    sessionId: runtimeEvent.sessionId,
    runId: runtimeEvent.runId,
    sequence: runtimeEvent.sequence,
    attributes: {
      protocol: runtimeEvent.protocol,
      phase: runtimeEvent.phase,
      ...(runtimeEvent.eventType ? { eventType: runtimeEvent.eventType } : {}),
      ...(runtimeEvent.cursor !== undefined ? { cursor: runtimeEvent.cursor } : {}),
      ...(runtimeEvent.source ? { source: runtimeEvent.source } : {}),
    },
  }).catch(() => undefined);
}

function sanitizeRuntimeDetails(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeRuntimeValue(value, 0) as Record<string, unknown>;
}

function sanitizeRuntimeValue(value: unknown, depth: number): unknown {
  if (depth > 6) return "[depth limited]";
  if (typeof value === "string") return value.length > 4_000 ? `${value.slice(0, 4_000)}… [truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeRuntimeValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 50)) {
    output[key] = /token|secret|password|authorization|cookie|api[_-]?key/i.test(key)
      ? "[REDACTED]"
      : sanitizeRuntimeValue(item, depth + 1);
  }
  return output;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emitOaepEventLog(
  target: ThreadSnapshotTarget,
  thread: DesktopThread,
  sessionId: string,
  event: OaepEvent,
  phase: "replay" | "event",
): void {
  emitRuntimeLog(target, thread, sessionId, {
    level: "debug",
    status: event.type.endsWith(".failed") ? "failed" : event.type.endsWith(".completed") ? "completed" : "running",
    protocol: "oaep/1",
    phase,
    operation: phase === "replay" ? "oaep.event.replayed" : "oaep.event.received",
    message: `${event.type} · sequence ${event.sequence}`,
    runId: event.run_id ?? undefined,
    itemId: event.item_id,
    eventType: event.type,
    sequence: event.sequence,
    cursor: event.sequence,
    source: event.source.backend,
    details: {
      eventId: event.event_id,
      dedupeKey: event.dedupe_key,
      source: {
        backend: event.source.backend,
        runtime_id: event.source.runtime_id,
      },
      hasItem: Boolean(event.data.item),
      hasDelta: Boolean(event.data.delta),
      hasError: Boolean(event.data.error),
    },
  });
}

export { projectRuntimeThreadSnapshot } from "./threadRuntimeProjection";

async function runtimeForThread(thread: DesktopThread) {
  if (!thread.runtimeSessionId || !thread.workspacePath) return null;
  return {
    resolved: await connectRuntimeClientForWorkspace(
      thread.workspacePath,
      thread.execution?.workspaceId,
    ),
    runtimeSessionId: thread.runtimeSessionId,
  };
}

function readyHistory(
  thread: DesktopThread,
  sync: { backend_id: string; imported: number; total: number; runs?: number; warnings?: number; next_cursor?: string | null; estimated_total?: number; truncated?: boolean },
  runCount: number,
  itemCount: number,
): DesktopThreadHistoryState {
  const warningCount = Math.max(0, Number(sync.warnings || 0));
  return {
    state: warningCount ? "partial" : "ready",
    source: sync.backend_id === "codex" || thread.boundAgentId === "my-codex" ? "codex" : "opendrsai",
    syncedAt: new Date().toISOString(),
    loadedRuns: runCount,
    totalRuns: Math.max(runCount, Number(sync.estimated_total || sync.runs || 0)),
    loadedItems: itemCount,
    totalItems: Math.max(itemCount, Number(sync.total || 0)),
    correctedItems: Math.max(0, Number(sync.imported || 0)),
    warningCount,
    nextCursor: sync.next_cursor ?? null,
    truncated: Boolean(sync.truncated || sync.next_cursor),
    ...(warningCount ? { message: "Some historical content required a safe fallback." } : {}),
  };
}

export async function getRuntimeThreadSnapshot(
  thread: DesktopThread,
): Promise<DesktopThreadSnapshot | null> {
  return (await getRuntimeThreadSnapshotEnvelope(thread))?.snapshot ?? null;
}

export async function getRuntimeThreadSnapshotEnvelope(
  thread: DesktopThread,
  signal?: AbortSignal,
  options: DesktopThreadSnapshotRequest = {},
): Promise<DesktopThreadSnapshotEnvelope | null> {
  signal?.throwIfAborted();
  const runtime = await runtimeForThread(thread);
  signal?.throwIfAborted();
  if (!runtime) return null;
  const cached = latestSnapshotEnvelopeByThread.get(thread.id);
  if (canUseSnapshotCache(
    cached, latestSnapshotEnvelopeByThread.isStale(thread.id), runtime.runtimeSessionId, options,
  )) return { ...cached, source: "cache" };
  // The Runtime owns the backend binding. Legacy imported Codex threads may
  // predate Desktop's boundAgentId marker, so agent-id based gating leaves
  // their stale projection permanently uncorrected. Non-import backends return
  // an idempotent no-op from this endpoint.
  const sync = options.historyCursor
    ? await runtime.resolved.client.syncBackendSessionHistory(
      runtime.runtimeSessionId, signal, false, options.historyCursor, 100,
    )
    : await syncSessionHistorySingleflight(runtime.resolved.client, runtime.runtimeSessionId, { signal });
  signal?.throwIfAborted();
  const capabilities = await runtime.resolved.client.getCapabilities();
  signal?.throwIfAborted();
  if (selectRuntimeConversationProtocol(capabilities) === "oaep") {
    const shared = await subscribeOaepSession(runtime.resolved.client, runtime.runtimeSessionId, {});
    try {
      signal?.throwIfAborted();
      const snapshot = projectOaepThreadSnapshot(
        thread,
        shared.state.items.values(),
        shared.state.runs.values(),
        readyHistory(thread, sync, shared.state.runs.size, shared.state.items.size),
      );
      const envelope: DesktopThreadSnapshotEnvelope = {
        version: 1,
        projection: "oaep/1",
        threadId: thread.id,
        runtimeSessionId: runtime.runtimeSessionId,
        sessionSequence: shared.state.cursor,
        generation: 1,
        source: "runtime",
        snapshot,
      };
      latestSnapshotEnvelopeByThread.set(thread.id, envelope);
      return assertSnapshotWaterline(envelope, options);
    } finally {
      shared.stop();
    }
  }
  const snapshot = await runtime.resolved.client.getConversationSnapshot(runtime.runtimeSessionId);
  signal?.throwIfAborted();
  const envelope: DesktopThreadSnapshotEnvelope = {
    version: 1,
    projection: "conversation/1",
    threadId: thread.id,
    runtimeSessionId: runtime.runtimeSessionId,
    sessionSequence: snapshot.snapshot_sequence,
    generation: 1,
    source: "runtime",
    snapshot: projectRuntimeThreadSnapshot(
    thread, snapshot.items,
    ),
  };
  latestSnapshotEnvelopeByThread.set(thread.id, envelope);
  return assertSnapshotWaterline(envelope, options);
}

export function canUseSnapshotCache(
  cached: DesktopThreadSnapshotEnvelope | undefined,
  stale: boolean,
  runtimeSessionId: string,
  options: DesktopThreadSnapshotRequest,
): cached is DesktopThreadSnapshotEnvelope {
  return !options.forceFresh && !stale
    && cached?.runtimeSessionId === runtimeSessionId
    && cached.sessionSequence >= Math.max(0, options.minimumSequence ?? 0)
    && cached.generation >= Math.max(0, options.expectedGeneration ?? 0);
}

export function assertSnapshotWaterline(
  envelope: DesktopThreadSnapshotEnvelope,
  options: DesktopThreadSnapshotRequest,
): DesktopThreadSnapshotEnvelope {
  if (envelope.generation < Math.max(0, options.expectedGeneration ?? 0)) {
    throw Object.assign(new Error("Fresh snapshot generation is behind the requested waterline."), {
      code: "snapshot_generation_stale", retryable: true,
    });
  }
  if (envelope.sessionSequence < Math.max(0, options.minimumSequence ?? 0)) {
    throw Object.assign(new Error("Fresh snapshot sequence is behind the requested waterline."), {
      code: "snapshot_sequence_stale", retryable: true,
    });
  }
  return envelope;
}

export async function subscribeRuntimeThreadSnapshot(
  thread: DesktopThread,
  target: ThreadSnapshotTarget,
): Promise<SessionConversationSubscription | null> {
  let active = await subscribeRuntimeThreadSnapshotOnce(thread, target);
  if (!active) return null;
  latestSnapshotEnvelopeByThread.pin(thread.id);
  let cachePinned = true;
  const releaseCachePin = () => {
    if (!cachePinned) return;
    cachePinned = false;
    latestSnapshotEnvelopeByThread.unpin(thread.id);
  };
  const sessionId = active.sessionId;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let wakeRetry: (() => void) | undefined;
  const waitBeforeReconnect = (attempt: number) => new Promise<void>((resolve) => {
    wakeRetry = resolve;
    retryTimer = setTimeout(resolve, runtimeGenerationRetryDelayMs(attempt));
  }).finally(() => { retryTimer = undefined; wakeRetry = undefined; });
  const done = (async () => {
    try {
      await active!.done;
      let attempt = 0;
      while (!stopped && isRuntimeGenerationInvalidated(active?.terminalError) && attempt < 8) {
      attempt += 1;
      const previous = active;
      if (!previous) break;
      previous.stop();
      emitRuntimeLog(target, thread, sessionId, {
        level: "warn", status: "waiting", protocol: "oaep/1", phase: "retry",
        operation: "runtime.generation.reconnect",
        message: "Runtime generation changed; reconnecting the current session.",
        details: { attempt },
      });
      await waitBeforeReconnect(attempt);
      if (stopped) break;
      try {
        active = await subscribeRuntimeThreadSnapshotOnce(thread, target);
      } catch (error) {
        emitRuntimeLog(target, thread, sessionId, {
          level: "error", status: "failed", protocol: "oaep/1", phase: "retry",
          operation: "runtime.generation.reconnect.failed",
          message: `Runtime generation reconnect failed: ${errorMessage(error)}`,
          details: { attempt, code: errorCode(error) },
        });
        if (!isRuntimeGenerationInvalidated(error)) break;
        continue;
      }
      if (!active) break;
      await active.done;
      }
      if (!stopped && active?.terminalError && !isRuntimeGenerationInvalidated(active.terminalError)) {
      emitRuntimeLog(target, thread, sessionId, {
        level: "error", status: "failed", protocol: "oaep/1", phase: "retry",
        operation: "oaep.subscription.degraded",
        message: `Session synchronization requires an explicit reconnect: ${errorMessage(active.terminalError)}`,
        details: { code: errorCode(active.terminalError) },
      });
      }
    } finally { releaseCachePin(); }
  })();
  return {
    sessionId,
    get cursor() { return active?.cursor ?? 0; },
    stop() {
      if (stopped) return;
      stopped = true;
      active?.stop();
      releaseCachePin();
      if (retryTimer) clearTimeout(retryTimer);
      wakeRetry?.();
    },
    done,
  };
}

export function threadSnapshotCacheDiagnostics() {
  return latestSnapshotEnvelopeByThread.diagnostics();
}

export function isRuntimeGenerationInvalidated(error: unknown): boolean {
  return Boolean(error && typeof error === "object"
    && (error as { code?: unknown }).code === "runtime_client_generation_invalidated");
}

export function runtimeGenerationRetryDelayMs(attempt: number, jitterUnit = Math.random()): number {
  const base = Math.min(2_000, 250 * 2 ** Math.min(5, Math.max(0, attempt - 1)));
  return Math.round(base * (0.8 + Math.max(0, Math.min(1, jitterUnit)) * 0.4));
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code.slice(0, 160) : undefined;
}

async function persistCursorOrReport(
  target: ThreadSnapshotTarget,
  thread: DesktopThread,
  sessionId: string,
  cursor: number,
): Promise<void> {
  try {
    await sessionSyncState.advanceCursor(sessionId, cursor);
  } catch (error) {
    emitRuntimeLog(target, thread, sessionId, {
      level: "error", status: "failed", protocol: "oaep/1", phase: "cursor",
      operation: "oaep.cursor.persist.failed",
      message: `OAEP cursor persistence failed: ${errorMessage(error)}`,
      cursor,
      details: { code: errorCode(error) },
    });
  }
}

async function subscribeRuntimeThreadSnapshotOnce(
  thread: DesktopThread,
  target: ThreadSnapshotTarget,
): Promise<SessionConversationSubscription | null> {
  const runtime = await runtimeForThread(thread);
  if (!runtime) return null;
  const sync = await syncSessionHistorySingleflight(runtime.resolved.client, runtime.runtimeSessionId);
  const capabilities = await runtime.resolved.client.getCapabilities();
  const forceLegacy = process.env.OPENDRSAI_DESKTOP_PROTOCOL_ROLLBACK === "conversation/1";
  const selectedProtocol = selectRuntimeConversationProtocol(capabilities, { forceLegacy });
  legacyProtocolTelemetry.record(
    selectedProtocol === "legacy" ? "conversation/1" : selectedProtocol,
    forceLegacy ? "operator_rollback" : selectedProtocol === "legacy" ? "oaep_unavailable" : "capability_selection",
    selectedProtocol === "oaep"
      ? capabilities.protocols?.oaep?.version
      : String(capabilities.protocol_version),
  );
  if (selectedProtocol === "oaep") {
    emitRuntimeLog(target, thread, runtime.runtimeSessionId, {
      level: "info", status: "completed", protocol: "oaep/1", phase: "capability",
      operation: "runtime.protocol.selected", message: "Runtime selected OAEP v1 for this session.",
      details: { capabilities: capabilities.capabilities },
    });
    const viewStore = new SessionViewStore(
      thread,
      runtime.runtimeSessionId,
      readyHistory(thread, sync, 0, 0),
    );
    const publishInitial = (sequence: number) => {
      sendThreadSnapshotEvent(target, "desktop:thread-snapshot", {
        version: 1,
        projection: "oaep/1",
        threadId: thread.id,
        runtimeSessionId: runtime.runtimeSessionId,
        sessionSequence: sequence,
        generation: viewStore.generation,
        snapshot: viewStore.snapshot,
      });
    };
    let lastSharedCursor = 0;
    const shared = await subscribeOaepSession(runtime.resolved.client, runtime.runtimeSessionId, {
      onSnapshot(state, source) {
        lastSharedCursor = state.cursor;
        emitRuntimeLog(target, thread, runtime.runtimeSessionId, {
          level: "info", status: "completed", protocol: "oaep/1", phase: "snapshot",
          operation: source === "snapshot" ? "oaep.snapshot.loaded" : "oaep.snapshot.reloaded",
          message: `Loaded OAEP snapshot at sequence ${state.cursor}.`, sequence: state.cursor, cursor: state.cursor,
          details: { itemCount: state.items.size, runCount: state.runs.size },
        });
        viewStore.reset(state);
        publishInitial(viewStore.sequence);
        void persistCursorOrReport(target, thread, runtime.runtimeSessionId, viewStore.sequence);
      },
      onReplayPage(count, fromSequence, toSequence, hasMore) {
        emitRuntimeLog(target, thread, runtime.runtimeSessionId, {
          level: "debug", status: "completed", protocol: "oaep/1", phase: "cursor",
          operation: "oaep.events.page",
          message: `Replayed ${count} OAEP events from sequence ${fromSequence} to ${toSequence}.`,
          sequence: toSequence, cursor: toSequence,
          details: { count, fromSequence, toSequence, hasMore },
        });
      },
      onEvent(event, state, source) {
        lastSharedCursor = state.cursor;
        emitOaepEventLog(target, thread, runtime.runtimeSessionId, event, source === "stream" ? "event" : "replay");
        const patch = viewStore.apply(event, state);
        if (patch) sendThreadSnapshotEvent(target, "desktop:thread-snapshot-patch", patch);
        void persistCursorOrReport(target, thread, runtime.runtimeSessionId, state.cursor);
      },
      onConnection(status, attempt, error) {
        sendThreadSnapshotEvent(target, "desktop:thread-snapshot-patch", viewStore.connection(
          status === "connected" ? "connected" : status === "degraded" ? "degraded" : "retrying",
        ));
        emitRuntimeLog(target, thread, runtime.runtimeSessionId, {
          level: status === "connected" ? "info" : "warn",
          status: status === "connected" ? "running" : status === "degraded" ? "failed" : "waiting",
          protocol: "oaep/1", phase: status === "connected" ? "stream" : "retry",
          operation: status === "connected" ? "oaep.stream.connected"
            : status === "degraded" ? "oaep.subscription.degraded" : "oaep.subscription.retry",
          message: status === "connected" ? `OAEP event stream restored at sequence ${lastSharedCursor}.`
            : `OAEP subscription interrupted: ${errorMessage(error)}`,
          cursor: lastSharedCursor, details: { attempt, error: error ? errorMessage(error) : undefined },
        });
      },
      onFatal(error) {
        emitRuntimeLog(target, thread, runtime.runtimeSessionId, {
          level: "error", status: "failed", protocol: "oaep/1", phase: "stream",
          operation: "oaep.subscription.fatal",
          message: `OAEP subscription stopped: ${errorMessage(error)}`,
          cursor: lastSharedCursor, details: { code: errorCode(error) },
        });
      },
    });
    return {
      sessionId: runtime.runtimeSessionId,
      get cursor() { return shared.cursor; },
      get terminalError() { return shared.terminalError; },
      get phase() { return shared.phase; },
      stop: () => {
        emitRuntimeLog(target, thread, runtime.runtimeSessionId, {
          level: "info", status: "cancelled", protocol: "oaep/1", phase: "lifecycle",
          operation: "oaep.subscription.stopped", message: "OAEP session subscription stopped.", cursor: shared.cursor,
        });
        shared.stop();
      },
      done: shared.done,
    };
  }
  if (selectedProtocol !== "legacy") return null;
  emitRuntimeLog(target, thread, runtime.runtimeSessionId, {
    level: "info", status: "completed", protocol: "conversation/1", phase: "capability",
    operation: "runtime.protocol.selected", message: "Runtime selected the legacy conversation protocol for this session.",
    details: { capabilities: capabilities.capabilities },
  });
  const legacy = new LegacyConversationAdapter(thread);
  const publish = (sequence: number, snapshot: DesktopThreadSnapshot) => {
    sendThreadSnapshotEvent(target, "desktop:thread-snapshot", {
      version: 1,
      projection: "conversation/1",
      threadId: thread.id,
      runtimeSessionId: runtime.runtimeSessionId,
      sessionSequence: sequence,
      generation: 1,
      snapshot,
    });
  };
  return subscribeSessionConversation(runtime.resolved.client, runtime.runtimeSessionId, {
    onSnapshot(snapshot) {
      const projected = legacy.applySnapshot(snapshot);
      emitRuntimeLog(target, thread, runtime.runtimeSessionId, {
        level: "info", status: "completed", protocol: "conversation/1", phase: "snapshot",
        operation: "conversation.snapshot.loaded", message: `Loaded conversation snapshot at sequence ${snapshot.snapshot_sequence}.`,
        sequence: snapshot.snapshot_sequence, cursor: snapshot.snapshot_sequence, details: { itemCount: snapshot.items.length },
      });
      publish(snapshot.snapshot_sequence, projected);
      return sessionSyncState.advanceCursor(runtime.runtimeSessionId, snapshot.snapshot_sequence).then(() => undefined);
    },
    async onEvent(event) {
      emitRuntimeLog(target, thread, runtime.runtimeSessionId, {
        level: "debug", status: "running", protocol: "conversation/1", phase: "event",
        operation: "conversation.event.received", message: `${event.kind} · sequence ${event.session_sequence}`,
        sequence: event.session_sequence, cursor: event.session_sequence, runId: event.run_id ?? undefined, eventType: event.kind,
        details: { payload: event.payload },
      });
      publish(event.session_sequence, legacy.applyEvent(event));
      await sessionSyncState.advanceCursor(runtime.runtimeSessionId, event.session_sequence);
    },
  });
}
