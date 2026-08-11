import type { OaepEvent, OaepItem, OaepRun, OaepSnapshot, RuntimeClient } from "./runtimeClient";
import { retainRuntimeClient } from "./runtimeClient";

export interface OaepSessionState {
  sessionId: string;
  cursor: number;
  items: ReadonlyMap<string, OaepItem>;
  /**
   * Presentation-only delta accumulators for runtimes that emit a delta
   * before the corresponding canonical Item.  These are deliberately kept
   * outside `items`: OAEP Event sequence is Session-scoped and must never be
   * persisted as an Item's Run-local sequence.
   */
  deltaShadows: ReadonlyMap<string, OaepDeltaShadow>;
  runs: ReadonlyMap<string, OaepRun>;
}

export interface OaepDeltaShadow {
  id: string;
  sessionId: string;
  runId: string;
  type: OaepItem["type"];
  status: "running";
  createdAt: string;
  updatedAt: string;
  source: OaepItem["source"];
  content: Record<string, unknown>;
  lastEventSequence: number;
}

export type OaepStreamPhase = "idle" | "snapshot" | "replay" | "connected" | "retrying" | "resnapshot" | "degraded" | "closed" | "fatal";

const OAEP_STREAM_TRANSITIONS: Record<OaepStreamPhase, ReadonlySet<OaepStreamPhase>> = {
  idle: new Set(["snapshot", "closed"]),
  snapshot: new Set(["replay", "retrying", "degraded", "fatal", "closed"]),
  replay: new Set(["connected", "retrying", "degraded", "fatal", "closed"]),
  connected: new Set(["retrying", "degraded", "fatal", "closed"]),
  retrying: new Set(["replay", "connected", "resnapshot", "retrying", "degraded", "fatal", "closed"]),
  resnapshot: new Set(["replay", "retrying", "degraded", "fatal", "closed"]),
  degraded: new Set(["closed"]),
  closed: new Set(),
  fatal: new Set(),
};

export function assertOaepStreamTransition(from: OaepStreamPhase, to: OaepStreamPhase): void {
  if (!OAEP_STREAM_TRANSITIONS[from].has(to)) throw new Error(`oaep_stream_transition_invalid:${from}:${to}`);
}

export interface OaepSessionMetrics {
  snapshots: number;
  resnapshots: number;
  replayEvents: number;
  streamEvents: number;
  reconnects: number;
  protocolViolations: number;
  listenerFailures: number;
  backpressureRecoveries: number;
  fatalErrors: number;
  degradedErrors: number;
}

export interface OaepSessionListener {
  onSnapshot?(state: OaepSessionState, source: "snapshot" | "resnapshot"): void | Promise<void>;
  onReplayPage?(count: number, fromSequence: number, toSequence: number, hasMore: boolean): void | Promise<void>;
  onEvent?(event: OaepEvent, state: OaepSessionState, source: "replay" | "stream"): void | Promise<void>;
  onConnection?(state: "connected" | "retrying" | "degraded", attempt: number, error?: unknown): void | Promise<void>;
  onFatal?(error: unknown, state: OaepSessionState): void | Promise<void>;
  onState?(state: OaepStreamPhase, previous: OaepStreamPhase): void | Promise<void>;
}

export interface OaepSessionSubscription {
  readonly cursor: number;
  readonly state: OaepSessionState;
  readonly metrics: Readonly<OaepSessionMetrics>;
  readonly done: Promise<void>;
  readonly terminalError: unknown;
  readonly phase: OaepStreamPhase;
  stop(): void;
}

class OaepEventGap extends Error {
  constructor() {
    super("Runtime OAEP Event sequence has a gap.");
  }
}

function isCursorExpired(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown };
  return candidate.code === "cursor_expired" || Number(candidate.status) === 410;
}

export type OaepStreamErrorDisposition = "retryable" | "cursor_expired" | "fatal";

export function classifyOaepStreamError(error: unknown): OaepStreamErrorDisposition {
  if (isCursorExpired(error)) return "cursor_expired";
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; retryable?: unknown; status?: unknown; name?: unknown };
    if (candidate.retryable === false) return "fatal";
    if ([401, 403, 404, 405, 422].includes(Number(candidate.status))) return "fatal";
    if (candidate.name === "RuntimeProtocolCompatibilityError") return "fatal";
    if (["unauthorized", "forbidden", "not_found", "session_missing", "protocol_incompatible", "unsupported_protocol"]
      .includes(String(candidate.code ?? ""))) return "fatal";
  }
  return error instanceof SyntaxError ? "fatal" : "retryable";
}

export function oaepRetryDelayMs(attempt: number, jitterUnit = Math.random()): number {
  const base = Math.min(2000, 100 * 2 ** Math.min(10, Math.max(0, attempt - 1)));
  const boundedJitter = Math.max(0, Math.min(1, jitterUnit));
  return Math.min(2000, Math.round(base * (0.8 + boundedJitter * 0.4)));
}

/**
 * Keep the same Session subscription alive through a three-minute network
 * interruption.  Backoff is capped at two seconds, so 120 attempts retain a
 * little margin even when jitter chooses the shortest delay every time.
 * Reconnecting only re-subscribes from the last contiguous Session cursor;
 * it never executes the Run again.
 */
export const MAX_AUTOMATIC_RETRY_ATTEMPTS = 120;

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

// Keep OAEP recovery aligned with the desktop chat/agent recovery contract.
// Tests may shorten this window, while production retains the three-minute
// interruption tolerance documented above.
const OAEP_NETWORK_RECOVERY_WINDOW_MS = positiveIntEnv("OPENDRSAI_NETWORK_RECOVERY_WINDOW_MS", 180_000);

export class OaepSyncDegradedError extends Error {
  readonly code = "oaep_sync_degraded";
  readonly retryable = false;

  constructor(readonly cause: unknown) {
    super("Runtime OAEP synchronization repeatedly failed and requires an explicit reconnect.");
    this.name = "OaepSyncDegradedError";
  }
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function textFromDelta(event: OaepEvent): string {
  const delta = event.data.delta;
  return delta && typeof delta === "object" && typeof delta.text === "string" ? delta.text : "";
}

function deltaType(event: OaepEvent): OaepItem["type"] {
  const delta = event.data.delta;
  const kind = delta && typeof delta === "object" ? String(delta.kind ?? "") : "";
  if (kind.startsWith("reasoning.")) return "reasoning";
  if (kind.startsWith("plan.")) return "plan";
  if (kind.startsWith("command.")) return "command_execution";
  if (kind.startsWith("tool.")) return "tool_call";
  if (kind.startsWith("subtask.")) return "subtask";
  return "message";
}

function appendDelta(
  items: Map<string, OaepItem>,
  shadows: Map<string, OaepDeltaShadow>,
  event: OaepEvent,
): void {
  if (!event.item_id) return;
  const id = event.item_id;
  const text = textFromDelta(event);
  const rawDelta = event.data.delta;
  const reasoningVisibility = rawDelta && typeof rawDelta === "object"
    ? String(rawDelta.visibility ?? "user") : "user";
  if (deltaType(event) === "reasoning" && reasoningVisibility !== "user") return;
  const existing = items.get(id);
  if (existing) {
    if (["completed", "failed", "cancelled"].includes(existing.status)) {
      throw new Error("oaep_item_event_after_terminal");
    }
    const content = { ...existing.content } as Record<string, unknown>;
    if (existing.type === "reasoning") {
      const segments = Array.isArray(content.segments) ? [...content.segments] as Array<Record<string, unknown>> : [];
      const delta = event.data.delta as unknown as Record<string, unknown>;
      const kind = String(delta.kind ?? "");
      const segmentId = typeof delta.segment_id === "string" && delta.segment_id
        ? delta.segment_id
        : `${id}:text`;
      const index = segments.findIndex((segment) => String(segment.id) === segmentId);
      if (kind === "reasoning.segment.added") {
        if (index < 0) segments.push({
          id: segmentId, text,
          kind: delta.reasoning_kind ?? "summary",
          visibility: delta.visibility ?? "user",
          source: delta.reasoning_source ?? "backend",
        });
      } else if (index >= 0) {
        const target = segments[index];
        segments[index] = { ...target, text: `${typeof target.text === "string" ? target.text : ""}${text}` };
      } else {
        segments.push({
          id: segmentId, text,
          kind: delta.reasoning_kind ?? "summary",
          visibility: delta.visibility ?? "user",
          source: delta.reasoning_source ?? "backend",
        });
      }
      content.segments = segments;
    } else if (existing.type === "command_execution") {
      content.output = `${typeof content.output === "string" ? content.output : ""}${text}`;
    } else if (existing.type === "tool_call") {
      content.result = `${typeof content.result === "string" ? content.result : ""}${text}`;
    } else if (existing.type === "subtask") {
      content.summary = `${typeof content.summary === "string" ? content.summary : ""}${text}`;
    } else {
      content.text = `${typeof content.text === "string" ? content.text : ""}${text}`;
    }
    // Preserve the canonical Item sequence. Event.sequence belongs to the
    // Session journal and is only used by the stream cursor.
    items.set(id, { ...existing, status: "running",
      updated_at: event.timestamp, content } as unknown as OaepItem);
    return;
  }
  const type = deltaType(event);
  const previous = shadows.get(id);
  if (previous && previous.type !== type) throw new Error("oaep_item_type_changed");
  const common = {
    id,
    sessionId: event.session_id,
    runId: event.run_id ?? "",
    type,
    status: "running" as const,
    createdAt: previous?.createdAt ?? event.timestamp,
    updatedAt: event.timestamp,
    source: event.source,
    lastEventSequence: event.sequence,
  };
  const previousContent = previous?.content ?? {};
  if (type === "reasoning") {
    const delta = event.data.delta as unknown as Record<string, unknown>;
    const segmentId = typeof delta.segment_id === "string" && delta.segment_id ? delta.segment_id : `${id}:text`;
    const segments = Array.isArray(previousContent.segments)
      ? [...previousContent.segments] as Array<Record<string, unknown>> : [];
    const index = segments.findIndex((segment) => String(segment.id) === segmentId);
    if (String(delta.kind ?? "") === "reasoning.segment.added") {
      if (index < 0) segments.push({
        id: segmentId, text,
        kind: delta.reasoning_kind ?? "summary",
        visibility: delta.visibility ?? "user",
        source: delta.reasoning_source ?? "backend",
      });
    } else if (index >= 0) {
      segments[index] = { ...segments[index], text: `${String(segments[index].text ?? "")}${text}` };
    } else {
      segments.push({
        id: segmentId, text,
        kind: delta.reasoning_kind ?? "summary",
        visibility: delta.visibility ?? "user",
        source: delta.reasoning_source ?? "backend",
      });
    }
    shadows.set(id, { ...common, content: { ...previousContent, segments } });
  } else if (type === "plan") {
    shadows.set(id, { ...common, content: { ...previousContent, text: `${String(previousContent.text ?? "")}${text}`, steps: [] } });
  } else if (type === "command_execution") {
    shadows.set(id, { ...common, content: { ...previousContent, command: [], display_command: "", cwd: ".", output: `${String(previousContent.output ?? "")}${text}`,
      exit_code: null, duration_ms: null } });
  } else if (type === "tool_call") {
    shadows.set(id, { ...common, content: { ...previousContent, tool_kind: "tool", tool_name: "tool", call_id: id,
      arguments: {}, result: `${String(previousContent.result ?? "")}${text}` } });
  } else if (type === "subtask") {
    shadows.set(id, { ...common, content: { ...previousContent, title: "Subtask", summary: `${String(previousContent.summary ?? "")}${text}` } });
  } else {
    shadows.set(id, { ...common, type: "message", content: { ...previousContent, role: "assistant", phase: "final", text: `${String(previousContent.text ?? "")}${text}`,
      parts: [], citations: [] } });
  }
}

/** Materialize a shadow only for rendering. It never enters canonical state. */
export function materializeOaepDeltaShadow(shadow: OaepDeltaShadow): OaepItem {
  return {
    id: shadow.id,
    session_id: shadow.sessionId,
    run_id: shadow.runId,
    type: shadow.type,
    status: shadow.status,
    sequence: 0,
    created_at: shadow.createdAt,
    updated_at: shadow.updatedAt,
    source: shadow.source,
    content: shadow.content,
  } as unknown as OaepItem;
}

export function presentationItemForOaepEvent(state: OaepSessionState, event: OaepEvent): OaepItem | undefined {
  if (!event.item_id) return undefined;
  return state.items.get(event.item_id)
    ?? (state.deltaShadows.get(event.item_id) ? materializeOaepDeltaShadow(state.deltaShadows.get(event.item_id)!) : undefined);
}

export function reduceOaepEvent(
  items: Map<string, OaepItem>,
  runs: Map<string, OaepRun>,
  event: OaepEvent,
  shadows: Map<string, OaepDeltaShadow> = new Map(),
): void {
  const run = event.data.run;
  if (run && typeof run === "object" && "id" in run) {
    const incoming = run as OaepRun;
    const existingRun = runs.get(String(incoming.id));
    if (existingRun && ["completed", "failed", "cancelled"].includes(existingRun.status)
      && ["completed", "failed", "cancelled"].includes(incoming.status)) {
      throw new Error("oaep_run_duplicate_terminal");
    }
    runs.set(String(incoming.id), incoming);
  }
  if (event.type === "event.item.delta") {
    appendDelta(items, shadows, event);
    return;
  }
  const item = event.data.item;
  if (item && typeof item === "object" && "id" in item) {
    const value = item as OaepItem;
    const existing = items.get(value.id);
    if (existing && existing.type !== value.type) throw new Error("oaep_item_type_changed");
    items.set(value.id, value);
    shadows.delete(value.id);
  }
}

async function consumeSse(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: OaepEvent) => Promise<void>,
): Promise<void> {
  const reader = stream.getReader();
  const abortReader = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", abortReader, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      let consumed = 0;
      let boundary = buffer.indexOf("\n\n", consumed);
      while (boundary >= 0) {
        const frame = buffer.slice(consumed, boundary);
        consumed = boundary + 2;
        const data = frame.split("\n").filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart()).join("\n");
        if (data) await onEvent(JSON.parse(data) as OaepEvent);
        boundary = buffer.indexOf("\n\n", consumed);
      }
      if (consumed > 0) buffer = buffer.slice(consumed);
      if (done) return;
    }
  } finally {
    signal.removeEventListener("abort", abortReader);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

class SharedOaepSessionController {
  readonly items = new Map<string, OaepItem>();
  readonly deltaShadows = new Map<string, OaepDeltaShadow>();
  readonly runs = new Map<string, OaepRun>();
  readonly listeners = new Set<OaepSessionListener>();
  readonly listenerQueues = new Map<OaepSessionListener, Promise<void>>();
  readonly listenerPending = new Map<OaepSessionListener, number>();
  readonly listenerNeedsSnapshot = new Set<OaepSessionListener>();
  readonly abort = new AbortController();
  cursor = 0;
  retryAttempt = 0;
  readonly metrics: OaepSessionMetrics = {
    snapshots: 0,
    resnapshots: 0,
    replayEvents: 0,
    streamEvents: 0,
    reconnects: 0,
    protocolViolations: 0,
    listenerFailures: 0,
    backpressureRecoveries: 0,
    fatalErrors: 0,
    degradedErrors: 0,
  };
  private readyResolve!: () => void;
  private readyReject!: (error: unknown) => void;
  private readySettled = false;
  terminalError: unknown;
  phase: OaepStreamPhase = "idle";
  readonly ready = new Promise<void>((resolve, reject) => {
    this.readyResolve = resolve;
    this.readyReject = reject;
  });
  readonly done: Promise<void>;
  private readonly releaseClient: () => void;
  private released = false;

  constructor(readonly client: RuntimeClient, readonly sessionId: string, readonly onEmpty: () => void) {
    this.releaseClient = retainRuntimeClient(client);
    this.done = Promise.resolve().then(() => this.run());
  }

  get state(): OaepSessionState {
    return { sessionId: this.sessionId, cursor: this.cursor, items: this.items, deltaShadows: this.deltaShadows, runs: this.runs };
  }

  add(listener: OaepSessionListener): () => void {
    this.listeners.add(listener);
    if (this.cursor > 0) this.dispatch(listener, () => listener.onSnapshot?.(this.state, "snapshot"), false);
    return () => {
      this.listeners.delete(listener);
      this.listenerQueues.delete(listener);
      this.listenerPending.delete(listener);
      this.listenerNeedsSnapshot.delete(listener);
      if (!this.listeners.size) {
        this.abort.abort("oaep_session_unused");
        if (!this.released) { this.released = true; this.releaseClient(); }
        this.onEmpty();
      }
    };
  }

  private dispatch(
    listener: OaepSessionListener,
    invoke: () => void | Promise<void> | undefined,
    recoverWithSnapshot = true,
    bounded = false,
  ): void {
    const pending = this.listenerPending.get(listener) ?? 0;
    if (bounded && pending >= 256) {
      this.listenerNeedsSnapshot.add(listener);
      return;
    }
    this.listenerPending.set(listener, pending + 1);
    const previous = this.listenerQueues.get(listener) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (!this.listeners.has(listener)) return;
      await invoke();
    }).catch(async () => {
      this.metrics.listenerFailures += 1;
      if (!recoverWithSnapshot || !this.listeners.has(listener) || !listener.onSnapshot) return;
      try {
        await listener.onSnapshot(this.state, "resnapshot");
      } catch {
        this.metrics.listenerFailures += 1;
      }
    });
    this.listenerQueues.set(listener, next);
    void next.finally(() => {
      const remaining = Math.max(0, (this.listenerPending.get(listener) ?? 1) - 1);
      if (remaining) this.listenerPending.set(listener, remaining);
      else this.listenerPending.delete(listener);
      if (this.listenerQueues.get(listener) === next) this.listenerQueues.delete(listener);
      if (!remaining && this.listenerNeedsSnapshot.delete(listener) && this.listeners.has(listener)) {
        this.metrics.backpressureRecoveries += 1;
        this.dispatch(listener, () => listener.onSnapshot?.(this.state, "resnapshot"), false);
      }
    });
  }

  private notifySnapshot(source: "snapshot" | "resnapshot"): void {
    if (source === "snapshot") this.metrics.snapshots += 1;
    else this.metrics.resnapshots += 1;
    for (const listener of this.listeners) {
      this.dispatch(listener, () => listener.onSnapshot?.(this.state, source), false);
    }
  }

  private notifyEvent(event: OaepEvent, source: "replay" | "stream"): void {
    for (const listener of this.listeners) {
      this.dispatch(listener, () => listener.onEvent?.(event, this.state, source), true, true);
    }
  }

  private notifyReplayPage(
    count: number, fromSequence: number, toSequence: number, hasMore: boolean,
  ): void {
    for (const listener of this.listeners) {
      this.dispatch(
        listener,
        () => listener.onReplayPage?.(count, fromSequence, toSequence, hasMore),
        false,
      );
    }
  }

  private notifyConnection(state: "connected" | "retrying" | "degraded", error?: unknown): void {
    for (const listener of this.listeners) {
      this.dispatch(listener, () => listener.onConnection?.(state, this.retryAttempt, error), false);
    }
  }

  private notifyFatal(error: unknown): void {
    for (const listener of this.listeners) {
      this.dispatch(listener, () => listener.onFatal?.(error, this.state), false);
    }
  }

  private transition(next: OaepStreamPhase): void {
    if (this.phase === next && next === "retrying") return;
    assertOaepStreamTransition(this.phase, next);
    const previous = this.phase;
    this.phase = next;
    for (const listener of this.listeners) {
      this.dispatch(listener, () => listener.onState?.(next, previous), false);
    }
  }

  private markReady(): void {
    if (this.readySettled) return;
    this.readySettled = true;
    this.readyResolve();
  }

  private markReadyFailed(error: unknown): void {
    if (this.readySettled) return;
    this.readySettled = true;
    this.readyReject(error);
  }

  private replaceSnapshot(snapshot: OaepSnapshot): void {
    if (snapshot.session.id !== this.sessionId || snapshot.snapshot_sequence < 0) {
      throw new Error("Runtime OAEP snapshot is invalid.");
    }
    this.items.clear();
    this.deltaShadows.clear();
    this.runs.clear();
    snapshot.items.forEach((item) => this.items.set(item.id, item));
    snapshot.runs.forEach((run) => this.runs.set(run.id, run));
    this.cursor = snapshot.snapshot_sequence;
  }

  private async accept(event: OaepEvent, source: "replay" | "stream"): Promise<void> {
    if (event.session_id !== this.sessionId) throw new Error("Cross-Session OAEP Event rejected.");
    if (event.sequence <= this.cursor) return;
    if (event.sequence !== this.cursor + 1) throw new OaepEventGap();
    reduceOaepEvent(this.items, this.runs, event, this.deltaShadows);
    this.cursor = event.sequence;
    if (source === "replay") {
      this.metrics.replayEvents += 1;
      // Publish restoration before the first recovered Event. A terminal
      // Event can make the owner stop synchronously, so a page-level callback
      // after delivery is too late and loses the observable restored state.
      if (this.retryAttempt) {
        this.notifyConnection("connected");
        this.retryAttempt = 0;
      }
    }
    else this.metrics.streamEvents += 1;
    this.notifyEvent(event, source);
  }

  private async run(): Promise<void> {
    let needsSnapshot = true;
    let firstReady = false;
    let retryStartedAt = 0;
    while (!this.abort.signal.aborted) {
      try {
        if (needsSnapshot) {
          const isResnapshot = this.metrics.snapshots > 0;
          this.transition(isResnapshot ? "resnapshot" : "snapshot");
          this.replaceSnapshot(await this.client.getOaepSnapshot(this.sessionId));
          this.notifySnapshot(isResnapshot ? "resnapshot" : "snapshot");
          needsSnapshot = false;
        }
        this.transition("replay");
        while (true) {
          const fromSequence = this.cursor;
          const page = await this.client.listOaepEvents(this.sessionId, this.cursor);
          for (const event of page.data) await this.accept(event, "replay");
          this.notifyReplayPage(page.data.length, fromSequence, this.cursor, page.has_more);
          if (!page.has_more) break;
        }
        if (!firstReady) { firstReady = true; this.markReady(); }
        // Replay itself is an authoritative Runtime connection. A terminal
        // may arrive during replay and synchronously stop this subscription,
        // so publish restoration before attempting the next long-lived SSE.
        const opened = await this.client.openOaepEventStream(this.sessionId, this.cursor, this.abort.signal);
        this.transition("connected");
        if (this.retryAttempt) this.notifyConnection("connected");
        // A TCP handshake followed by an immediate close is not a recovered
        // subscription. Only reset the consecutive-recovery budget after the
        // stream has remained healthy for a short interval; this prevents a
        // connect/close loop from keeping a Run in `running` forever.
        const stableConnection = setTimeout(() => {
          this.retryAttempt = 0;
          retryStartedAt = 0;
        }, Math.min(5_000, Math.max(250, Math.floor(OAEP_NETWORK_RECOVERY_WINDOW_MS / 2))));
        try {
          await consumeSse(opened.events, this.abort.signal, (event) => this.accept(event, "stream"));
        } finally {
          clearTimeout(stableConnection);
        }
        if (!this.abort.signal.aborted) throw new Error("Runtime OAEP stream ended before cancellation.");
      } catch (error) {
        if (this.abort.signal.aborted) break;
        const disposition = classifyOaepStreamError(error);
        if (disposition === "fatal") {
          this.metrics.fatalErrors += 1;
          this.terminalError = error;
          this.transition("fatal");
          this.markReadyFailed(error);
          this.notifyFatal(error);
          break;
        }
        this.metrics.reconnects += 1;
        if (error instanceof OaepEventGap || (
          error instanceof Error && /^(?:oaep_|Cross-Session OAEP)/.test(error.message)
        )) this.metrics.protocolViolations += 1;
        // A sequence gap is not snapshot corruption. Re-enter replay from the
        // last contiguous cursor so every missing Event is delivered to live
        // listeners in order. A snapshot would advance past those Events and
        // the chat projection could silently lose content or the Run terminal.
        // Only an explicitly expired cursor requires a canonical resnapshot.
        needsSnapshot ||= disposition === "cursor_expired";
        this.retryAttempt += 1;
        if (!retryStartedAt) retryStartedAt = Date.now();
        if (
          this.retryAttempt >= MAX_AUTOMATIC_RETRY_ATTEMPTS
          || Date.now() - retryStartedAt >= OAEP_NETWORK_RECOVERY_WINDOW_MS
        ) {
          this.metrics.degradedErrors += 1;
          this.terminalError = new OaepSyncDegradedError(error);
          this.transition("degraded");
          this.markReadyFailed(this.terminalError);
          this.notifyConnection("degraded", this.terminalError);
          break;
        }
        this.transition("retrying");
        this.notifyConnection("retrying", error);
        await waitForRetry(oaepRetryDelayMs(this.retryAttempt), this.abort.signal);
      }
    }
    if (this.phase !== "fatal" && this.phase !== "degraded" && this.phase !== "closed") this.transition("closed");
    if (!firstReady && !this.terminalError) this.markReady();
  }
}

const controllers = new Map<string, Map<string, SharedOaepSessionController>>();

export function getOaepSessionOwnershipDiagnostics(): Array<{
  endpointKey: string;
  sessionId: string;
  subscribers: number;
  sse: number;
  phase: OaepStreamPhase;
  cursor: number;
}> {
  return [...controllers.entries()].flatMap(([endpointKey, sessions]) =>
    [...sessions.entries()].map(([sessionId, controller]) => ({
      endpointKey,
      sessionId,
      subscribers: controller.listeners.size,
      sse: controller.phase === "connected" ? 1 : 0,
      phase: controller.phase,
      cursor: controller.cursor,
    })),
  );
}

export async function subscribeOaepSession(
  client: RuntimeClient,
  sessionId: string,
  listener: OaepSessionListener,
): Promise<OaepSessionSubscription> {
  const ownerKey = client.streamIdentity || `${client.location}:legacy-client`;
  let sessions = controllers.get(ownerKey);
  if (!sessions) { sessions = new Map(); controllers.set(ownerKey, sessions); }
  let controller = sessions.get(sessionId);
  if (!controller) {
    controller = new SharedOaepSessionController(client, sessionId, () => {
      sessions?.delete(sessionId);
      if (!sessions?.size) controllers.delete(ownerKey);
    });
    sessions.set(sessionId, controller);
  }
  const remove = controller.add(listener);
  await controller.ready;
  return {
    get cursor() { return controller!.cursor; },
    get state() { return controller!.state; },
    get metrics() { return { ...controller!.metrics }; },
    get terminalError() { return controller!.terminalError; },
    get phase() { return controller!.phase; },
    done: controller.done,
    stop: remove,
  };
}
