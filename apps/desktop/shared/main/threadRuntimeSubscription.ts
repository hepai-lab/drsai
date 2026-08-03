import type {
  DesktopRuntimeLogEvent,
  DesktopThread,
  DesktopThreadHistoryState,
  DesktopThreadSnapshot,
} from "../api/desktopApi";
import { connectRuntimeClientForWorkspace, type OaepEvent, type OaepItem, type RuntimeConversationItem } from "./runtimeClient";
import { selectRuntimeConversationProtocol } from "./runtimeProtocolSelection";
import { projectOaepThreadSnapshot, projectRuntimeThreadSnapshot } from "./threadRuntimeProjection";
import {
  subscribeSessionConversation,
  type SessionConversationSubscription,
} from "./sessionConversationSubscription";
import { sessionSyncState } from "./sessionSyncState";
import { desktopDiagnostics } from "./diagnostics";
import { subscribeOaepSession } from "./oaepSessionStream";

interface ThreadSnapshotEvent {
  threadId: string;
  runtimeSessionId: string;
  sessionSequence: number;
  snapshot: DesktopThreadSnapshot;
}

export interface ThreadSnapshotTarget {
  isDestroyed?(): boolean;
  send(channel: "desktop:thread-snapshot", event: ThreadSnapshotEvent): void;
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
  channel: "desktop:runtime-log",
  event: DesktopRuntimeLogEvent,
): void;
function sendThreadSnapshotEvent(
  target: ThreadSnapshotTarget,
  channel: "desktop:thread-snapshot" | "desktop:runtime-log",
  event: ThreadSnapshotEvent | DesktopRuntimeLogEvent,
): void {
  try {
    if (target.isDestroyed?.()) return;
    if (channel === "desktop:thread-snapshot") {
      target.send(channel, event as ThreadSnapshotEvent);
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
  sync: { backend_id: string; imported: number; total: number; runs?: number; warnings?: number },
  runCount: number,
  itemCount: number,
): DesktopThreadHistoryState {
  const warningCount = Math.max(0, Number(sync.warnings || 0));
  return {
    state: warningCount ? "partial" : "ready",
    source: sync.backend_id === "codex" || thread.boundAgentId === "my-codex" ? "codex" : "opendrsai",
    syncedAt: new Date().toISOString(),
    loadedRuns: runCount,
    totalRuns: Math.max(runCount, Number(sync.runs || 0)),
    loadedItems: itemCount,
    totalItems: Math.max(itemCount, Number(sync.total || 0)),
    correctedItems: Math.max(0, Number(sync.imported || 0)),
    warningCount,
    ...(warningCount ? { message: "Some historical content required a safe fallback." } : {}),
  };
}

export async function getRuntimeThreadSnapshot(
  thread: DesktopThread,
): Promise<DesktopThreadSnapshot | null> {
  const runtime = await runtimeForThread(thread);
  if (!runtime) return null;
  // The Runtime owns the backend binding. Legacy imported Codex threads may
  // predate Desktop's boundAgentId marker, so agent-id based gating leaves
  // their stale projection permanently uncorrected. Non-import backends return
  // an idempotent no-op from this endpoint.
  const sync = await runtime.resolved.client.syncBackendSessionHistory(runtime.runtimeSessionId);
  const capabilities = await runtime.resolved.client.getCapabilities();
  if (selectRuntimeConversationProtocol(capabilities) === "oaep") {
    const snapshot = await runtime.resolved.client.getOaepSnapshot(runtime.runtimeSessionId);
    return projectOaepThreadSnapshot(
      thread,
      snapshot.items,
      snapshot.runs,
      readyHistory(thread, sync, snapshot.runs.length, snapshot.items.length),
    );
  }
  const snapshot = await runtime.resolved.client.getConversationSnapshot(runtime.runtimeSessionId);
  return projectRuntimeThreadSnapshot(
    thread, snapshot.items,
  );
}

export async function subscribeRuntimeThreadSnapshot(
  thread: DesktopThread,
  target: ThreadSnapshotTarget,
): Promise<SessionConversationSubscription | null> {
  const runtime = await runtimeForThread(thread);
  if (!runtime) return null;
  const sync = await runtime.resolved.client.syncBackendSessionHistory(runtime.runtimeSessionId);
  const capabilities = await runtime.resolved.client.getCapabilities();
  const selectedProtocol = selectRuntimeConversationProtocol(capabilities);
  if (selectedProtocol === "oaep") {
    emitRuntimeLog(target, thread, runtime.runtimeSessionId, {
      level: "info", status: "completed", protocol: "oaep/1", phase: "capability",
      operation: "runtime.protocol.selected", message: "Runtime selected OAEP v1 for this session.",
      details: { capabilities: capabilities.capabilities },
    });
    const publish = (
      sequence: number,
      items: ReadonlyMap<string, OaepItem>,
      runs: ReadonlyMap<string, import("./runtimeClient").OaepRun>,
    ) => {
      sendThreadSnapshotEvent(target, "desktop:thread-snapshot", {
        threadId: thread.id,
        runtimeSessionId: runtime.runtimeSessionId,
        sessionSequence: sequence,
        snapshot: projectOaepThreadSnapshot(
          thread,
          items.values(), runs.values(),
          readyHistory(thread, sync, runs.size, items.size),
        ),
      });
    };
    let lastSharedCursor = 0;
    const shared = await subscribeOaepSession(runtime.resolved.client, runtime.runtimeSessionId, {
      async onSnapshot(state, source) {
        lastSharedCursor = state.cursor;
        emitRuntimeLog(target, thread, runtime.runtimeSessionId, {
          level: "info", status: "completed", protocol: "oaep/1", phase: "snapshot",
          operation: source === "snapshot" ? "oaep.snapshot.loaded" : "oaep.snapshot.reloaded",
          message: `Loaded OAEP snapshot at sequence ${state.cursor}.`, sequence: state.cursor, cursor: state.cursor,
          details: { itemCount: state.items.size, runCount: state.runs.size },
        });
        publish(state.cursor, state.items, state.runs);
        await sessionSyncState.advanceCursor(runtime.runtimeSessionId, state.cursor);
      },
      async onEvent(event, state, source) {
        lastSharedCursor = state.cursor;
        emitOaepEventLog(target, thread, runtime.runtimeSessionId, event, source === "stream" ? "event" : "replay");
        publish(state.cursor, state.items, state.runs);
        await sessionSyncState.advanceCursor(runtime.runtimeSessionId, state.cursor);
      },
      onConnection(status, attempt, error) {
        emitRuntimeLog(target, thread, runtime.runtimeSessionId, {
          level: status === "connected" ? "info" : "warn",
          status: status === "connected" ? "running" : "waiting",
          protocol: "oaep/1", phase: status === "connected" ? "stream" : "retry",
          operation: status === "connected" ? "oaep.stream.connected" : "oaep.subscription.retry",
          message: status === "connected" ? `OAEP event stream restored at sequence ${lastSharedCursor}.`
            : `OAEP subscription interrupted: ${errorMessage(error)}`,
          cursor: lastSharedCursor, details: { attempt, error: error ? errorMessage(error) : undefined },
        });
      },
    });
    return {
      sessionId: runtime.runtimeSessionId,
      get cursor() { return shared.cursor; },
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
  const items = new Map<string, RuntimeConversationItem>();
  const publish = (sequence: number) => {
    sendThreadSnapshotEvent(target, "desktop:thread-snapshot", {
      threadId: thread.id,
      runtimeSessionId: runtime.runtimeSessionId,
      sessionSequence: sequence,
      snapshot: projectRuntimeThreadSnapshot(thread, items.values()),
    });
  };
  return subscribeSessionConversation(runtime.resolved.client, runtime.runtimeSessionId, {
    onSnapshot(snapshot) {
      items.clear();
      for (const item of snapshot.items) items.set(item.item_id, item);
      emitRuntimeLog(target, thread, runtime.runtimeSessionId, {
        level: "info", status: "completed", protocol: "conversation/1", phase: "snapshot",
        operation: "conversation.snapshot.loaded", message: `Loaded conversation snapshot at sequence ${snapshot.snapshot_sequence}.`,
        sequence: snapshot.snapshot_sequence, cursor: snapshot.snapshot_sequence, details: { itemCount: snapshot.items.length },
      });
      publish(snapshot.snapshot_sequence);
      return sessionSyncState.advanceCursor(runtime.runtimeSessionId, snapshot.snapshot_sequence).then(() => undefined);
    },
    async onEvent(event) {
      emitRuntimeLog(target, thread, runtime.runtimeSessionId, {
        level: "debug", status: "running", protocol: "conversation/1", phase: "event",
        operation: "conversation.event.received", message: `${event.kind} · sequence ${event.session_sequence}`,
        sequence: event.session_sequence, cursor: event.session_sequence, runId: event.run_id ?? undefined, eventType: event.kind,
        details: { payload: event.payload },
      });
      if (
        event.kind === "conversation.item.created"
        || event.kind === "conversation.item.delta"
        || event.kind === "conversation.item.upsert"
      ) {
        const payload = event.payload;
        const itemPayload = payload.payload;
        if (typeof payload.item_id === "string" && itemPayload && typeof itemPayload === "object") {
          items.set(payload.item_id, {
            item_id: payload.item_id,
            session_id: event.session_id,
            run_id: event.run_id,
            kind: String(payload.kind) as RuntimeConversationItem["kind"],
            role: (payload.role ?? null) as RuntimeConversationItem["role"],
            revision: Number(payload.revision),
            session_sequence: event.session_sequence,
            source_client: String(payload.source_client) as RuntimeConversationItem["source_client"],
            source_message_id: typeof payload.source_message_id === "string" ? payload.source_message_id : null,
            created_at: String(payload.created_at),
            updated_at: String(payload.updated_at),
            payload: itemPayload as Record<string, unknown>,
          });
        }
      }
      publish(event.session_sequence);
      await sessionSyncState.advanceCursor(runtime.runtimeSessionId, event.session_sequence);
    },
  });
}
