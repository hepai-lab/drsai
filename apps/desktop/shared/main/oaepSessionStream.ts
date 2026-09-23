import { AsyncLocalStorage } from "node:async_hooks";
import type { OaepEvent, OaepItem, OaepRun, OaepSnapshot, RuntimeClient } from "./runtimeClient";
import { isRuntimeClientGenerationInvalidated, retainRuntimeClient } from "./runtimeClient";
import { assertOaepEventIntegrity, assertOaepSnapshotIntegrity, oaepProjectionDigest } from "./oaepIntegrity";

export interface OaepSessionState {
  sessionId: string;
  cursor: number;
  /** Checkpoint pagination is independent of the live Event cursor. */
  history?: { nextCursor: string | null; hasMore: boolean; totalItems: number; reloadRequired?: boolean };
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
  // A transport failure can happen before the very first snapshot has been
  // accepted.  In that case recovery must retry the initial snapshot rather
  // than misclassifying it as a resnapshot or degrading the subscription.
  retrying: new Set(["snapshot", "replay", "connected", "resnapshot", "retrying", "degraded", "fatal", "closed"]),
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
  listenerBackpressureWaits: number;
  /** Maximum on any single listener (the admission-budget scope). */
  listenerPeakPending: number;
  listenerPeakBytes: number;
  /** Aggregate executing + queued notifications across attached listeners. */
  listenerPending: number;
  listenerBytes: number;
  listenerTotalPeakPending: number;
  listenerTotalPeakBytes: number;
  /** Settled admission waits (including removal); monotonic-clock milliseconds. */
  listenerWaitMs: number;
  listenerMaxWaitMs: number;
  listenerMaxQueueDelayMs: number;
  listenerMaxTerminalDelayMs: number;
  fatalErrors: number;
  degradedErrors: number;
}

/** State maps belong to this listener's FIFO projection, stable until its returned
 * Promise settles. Do not mutate or retain them as immutable historical snapshots. */
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
  loadEarlier(cursor: string, signal?: AbortSignal): Promise<void>;
  stop(): void;
}

class OaepEventGap extends Error {
  constructor() {
    super("Runtime OAEP Event sequence has a gap.");
  }
}

// Bound only the rebase journal for unloaded Items, not canonical Event delivery.
export const MAX_PENDING_OAEP_DELTAS = 2048;
export const MAX_PENDING_OAEP_DELTA_BYTES = 4 * 1024 * 1024;

class OaepResnapshotRequired extends Error {
  constructor() { super("OAEP historical delta buffer requires a fresh checkpoint."); }
}

function historyCursorStale(cause?: unknown): Error {
  // Electron may serialize only Error.message; retain the machine-readable tag there too.
  return Object.assign(new Error("oaep_history_cursor_stale: History checkpoint expired or changed; reload the latest window."), {
    code: "oaep_history_cursor_stale", retryable: true, cause,
  });
}

function isCursorExpired(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown };
  return candidate.code === "cursor_expired" || Number(candidate.status) === 410;
}

export type OaepStreamErrorDisposition = "retryable" | "cursor_expired" | "fatal";

export function classifyOaepStreamError(error: unknown): OaepStreamErrorDisposition {
  if (isCursorExpired(error)) return "cursor_expired";
  // Local OAEP integrity/shape failures are deterministic protocol failures.
  // Retrying the same bytes cannot repair them and only leaves the user on a
  // misleading reconnecting state until the network recovery window expires.
  if (error instanceof Error && error.message.startsWith("oaep_")) return "fatal";
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

/**
 * How many times one Session subscription may replace its Runtime client
 * generation before falling back to ordinary retry backoff.
 *
 * An invalidated shared client aborts every request pre-flight, so retrying it
 * produces no traffic at all: the subscription used to burn the whole retry
 * budget (about three and a half minutes) and then degrade, which left the
 * pending outbox acknowledgement stuck. Re-resolving the client is the only
 * recovery that can make progress, but it stays bounded so a flapping Runtime
 * cannot spin the reconnect loop.
 */
export const MAX_GENERATION_REBINDS = 5;

/**
 * A transport together with one already-retained reference to it.
 *
 * The reference must be held before the promise settles: the previous holder
 * can release the last one in between, and a client disposed before it is
 * retained cannot serve the resumed stream.
 */
export interface OaepSessionClientLease {
  client: RuntimeClient;
  release: () => void;
}

function oaepSessionOwnerKey(client: RuntimeClient): string {
  return client.streamIdentity || `${client.location}:legacy-client`;
}

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

// Keep OAEP recovery aligned with the desktop chat/agent recovery contract.
// Tests may shorten this window, while production retains the three-minute
// interruption tolerance documented above.
// Execution time limits disabled: the frontend no longer enforces a
// total-time recovery window that prematurely terminates long sessions.
const OAEP_NETWORK_RECOVERY_WINDOW_MS = positiveIntEnv("OPENDRSAI_NETWORK_RECOVERY_WINDOW_MS", Number.MAX_SAFE_INTEGER);

export class OaepSyncDegradedError extends Error {
  readonly code = "oaep_sync_degraded";
  readonly retryable = false;

  constructor(readonly cause: unknown) {
    super("Runtime OAEP synchronization repeatedly failed and requires an explicit reconnect.");
    this.name = "OaepSyncDegradedError";
  }
}

/**
 * True when a stream failure degraded the subscription instead of ending the
 * Run. The Run itself may still be alive in the Runtime, so a degraded
 * subscription must not be reported as a Run failure, and its pending
 * acknowledgement has to be settled explicitly.
 */
export function isOaepSyncDegradedError(error: unknown): boolean {
  return error instanceof OaepSyncDegradedError
    || Boolean(error && typeof error === "object"
      && (error as { code?: unknown }).code === "oaep_sync_degraded");
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
  assertOaepEventIntegrity(event, event.session_id);
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

// Budgets include the executing callback. Bytes are serialized UTF-8 payload,
// not a claim about total JS heap (canonical state and transport are separate).
export const MAX_OAEP_LISTENER_PENDING = 256;
export const MAX_OAEP_LISTENER_BYTES = 8 * 1024 * 1024;
export const MAX_OAEP_SSE_FRAME_BYTES = 8 * 1024 * 1024;
const LISTENER_CONTROL_BYTES = 256;

export async function consumeSse(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: OaepEvent) => Promise<void>,
): Promise<void> {
  const reader = stream.getReader();
  const abortReader = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", abortReader, { once: true });
  const decoder = new TextDecoder();
  // Scan bytes before decoding, so even a single oversized transport chunk is
  // never copied into an unbounded string. CRLF (including split CR/LF), CR,
  // UTF-8 code points and frame delimiters may all straddle read boundaries.
  let frame = new Uint8Array(4096);
  let length = 0;
  let lineHasBytes = false;
  let skipLf = false;
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (signal.aborted || done) return; // SSE does not dispatch an unfinished EOF frame.
      for (const byte of value) {
        if (signal.aborted) return;
        if (skipLf && byte === 10) { skipLf = false; continue; }
        skipLf = false;
        if (length >= MAX_OAEP_SSE_FRAME_BYTES) throw new Error("oaep_sse_frame_too_large");
        if (length === frame.length) {
          const grown = new Uint8Array(Math.min(frame.length * 2, MAX_OAEP_SSE_FRAME_BYTES));
          grown.set(frame);
          frame = grown;
        }
        frame[length++] = byte;
        if (byte !== 10 && byte !== 13) { lineHasBytes = true; continue; }
        skipLf = byte === 13;
        if (lineHasBytes) { lineHasBytes = false; continue; }
        const data = decoder.decode(frame.subarray(0, length)).split(/\r\n|\r|\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart()).join("\n");
        length = 0;
        if (data) await onEvent(JSON.parse(data) as OaepEvent);
      }
    }
  } finally {
    signal.removeEventListener("abort", abortReader);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

interface ListenerProjection extends OaepSessionState {
  items: Map<string, OaepItem>;
  deltaShadows: Map<string, OaepDeltaShadow>;
  runs: Map<string, OaepRun>;
}

function copyProjection(state: OaepSessionState): ListenerProjection {
  return { ...state, items: new Map(state.items), runs: new Map(state.runs),
    deltaShadows: new Map(state.deltaShadows) };
}

interface ListenerQueue {
  state: ListenerProjection;
  tail: Promise<void>;
  pending: number;
  bytes: number;
  changed: Promise<void>;
  wake: () => void;
  removed: Promise<void>;
  remove: () => void;
}

// Callback-initiated history publication otherwise waits for its own FIFO tail.
const listenerContext = new AsyncLocalStorage<{ controller: SharedOaepSessionController; active: boolean }>();

/** Presentation noise; state-bearing variants still update the listener FIFO. */
export function isPresentationNoiseOaepEvent(event: OaepEvent): boolean {
  if (event.type === "event.session.updated") return true;
  if (event.type === "event.run.resumed") {
    const reason = event.data?.reason;
    return typeof reason !== "string" || !reason.trim();
  }
  return false;
}

class SharedOaepSessionController {
  readonly items = new Map<string, OaepItem>();
  readonly deltaShadows = new Map<string, OaepDeltaShadow>();
  readonly runs = new Map<string, OaepRun>();
  readonly listeners = new Set<OaepSessionListener>();
  readonly listenerQueues = new Map<OaepSessionListener, ListenerQueue>();
  readonly abort = new AbortController();
  cursor = 0;
  private checkpoint?: OaepSnapshot["checkpoint"];
  private pagedRunIds = new Set<string>();
  private checkpointItems = new Map<string, OaepItem>();
  private itemWaterlines = new Map<string, number>();
  private pendingDeltas = new Map<string, { events: OaepEvent[]; bytes: number }>();
  private pendingDeltaCount = 0;
  private pendingDeltaBytes = 0;
  private historyReloadRequired = false;
  private resnapshotRequested = false;
  private activeStreamAbort?: AbortController;
  // Serialize mutation + admission, not callback completion or network reads.
  // History publication cannot overtake an Event stalled on another listener.
  private publicationTail: Promise<void> = Promise.resolve();
  private publish<T>(action: () => Promise<T>): Promise<T> {
    const result = this.publicationTail.then(action);
    this.publicationTail = result.then(() => undefined, () => undefined);
    return result;
  }
  private historyCursor: string | null = null;
  private historyRequest?: { cursor: string; promise: Promise<void> };
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
    listenerBackpressureWaits: 0,
    listenerPeakPending: 0,
    listenerPeakBytes: 0,
    listenerPending: 0,
    listenerBytes: 0,
    listenerTotalPeakPending: 0,
    listenerTotalPeakBytes: 0,
    listenerWaitMs: 0,
    listenerMaxWaitMs: 0,
    listenerMaxQueueDelayMs: 0,
    listenerMaxTerminalDelayMs: 0,
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
  private releaseClient: () => void;
  private released = false;
  /**
   * Registry key of the transport this controller currently owns. It changes
   * when a superseded Runtime generation is replaced so the shared-controller
   * registry follows the controller instead of keeping a stale endpoint key.
   */
  ownerKey: string;
  private clientValue: RuntimeClient;
  private readonly resolveClient?: () => Promise<OaepSessionClientLease>;
  /** Bounded count of generation replacements; reset once a stream is stable. */
  generationRebinds = 0;

  constructor(
    client: RuntimeClient,
    readonly sessionId: string,
    readonly onEmpty: () => void,
    resolveClient?: () => Promise<OaepSessionClientLease>,
  ) {
    this.clientValue = client;
    this.ownerKey = oaepSessionOwnerKey(client);
    this.resolveClient = resolveClient;
    this.releaseClient = retainRuntimeClient(client);
    this.done = Promise.resolve().then(() => this.run());
  }

  get client(): RuntimeClient {
    return this.clientValue;
  }

  get state(): OaepSessionState {
    return { sessionId: this.sessionId, cursor: this.cursor,
      history: { nextCursor: this.historyCursor, hasMore: Boolean(this.historyCursor),
        totalItems: Math.max(this.checkpoint?.item_count ?? 0, this.items.size),
        reloadRequired: this.historyReloadRequired && Boolean(this.historyCursor) }, items: this.items, deltaShadows: this.deltaShadows, runs: this.runs };
  }

  add(listener: OaepSessionListener): () => void {
    this.listeners.add(listener);
    if (!this.listenerQueues.has(listener)) {
      const queue: ListenerQueue = { state: copyProjection(this.state), tail: Promise.resolve(), pending: 0, bytes: 0,
        changed: Promise.resolve(), wake: () => undefined, removed: Promise.resolve(), remove: () => undefined };
      queue.removed = new Promise<void>((resolve) => { queue.remove = resolve; });
      queue.changed = new Promise<void>((resolve) => { queue.wake = resolve; });
      this.listenerQueues.set(listener, queue);
    }
    if (this.checkpoint || this.metrics.snapshots > 0) {
      const snapshot = copyProjection(this.state);
      void this.dispatch(listener, () => this.deliverSnapshot(listener, snapshot, "snapshot"), false);
    }
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.listeners.delete(listener);
      const queue = this.listenerQueues.get(listener);
      if (queue) {
        this.metrics.listenerPending -= queue.pending;
        this.metrics.listenerBytes -= queue.bytes;
      }
      this.listenerQueues.get(listener)?.wake();
      this.listenerQueues.get(listener)?.remove();
      this.listenerQueues.delete(listener);
      if (!this.listeners.size) {
        this.abort.abort("oaep_session_unused");
        if (!this.released) { this.released = true; this.releaseClient(); }
        this.onEmpty();
      }
    };
  }

  /**
   * Replace the transport whose Runtime generation was invalidated.
   *
   * Retrying such a client can never succeed: its AbortController is already
   * aborted, so every request fails pre-flight and never reaches the network.
   * Re-resolving keeps the same Session and resumes from the current cursor, so
   * no Event is lost or delivered twice. Returns false when no resolver is
   * available, the rebind budget is exhausted, or the Runtime cannot be
   * resolved right now (ordinary backoff then applies).
   */
  private async rebindClient(): Promise<boolean> {
    if (!this.resolveClient || this.generationRebinds >= MAX_GENERATION_REBINDS) return false;
    this.generationRebinds += 1;
    let lease: OaepSessionClientLease;
    try {
      lease = await this.resolveClient();
    } catch {
      return false;
    }
    const previousRelease = this.releaseClient;
    const previousOwnerKey = this.ownerKey;
    this.clientValue = lease.client;
    this.releaseClient = lease.release;
    this.ownerKey = oaepSessionOwnerKey(lease.client);
    if (previousOwnerKey !== this.ownerKey) {
      const previous = controllers.get(previousOwnerKey);
      if (previous?.get(this.sessionId) === this) {
        previous.delete(this.sessionId);
        if (!previous.size) controllers.delete(previousOwnerKey);
      }
      let next = controllers.get(this.ownerKey);
      if (!next) { next = new Map(); controllers.set(this.ownerKey, next); }
      next.set(this.sessionId, this);
    }
    // Release the dead generation only once the replacement is in place: the
    // retired entry stays referenced until this last reference is dropped.
    previousRelease();
    return true;
  }

  private async dispatch(
    listener: OaepSessionListener,
    invoke: () => void | Promise<void> | undefined,
    recoverWithSnapshot = true,
    bytes = LISTENER_CONTROL_BYTES,
    terminal = false,
  ): Promise<void> {
    const queue = this.listenerQueues.get(listener);
    if (!queue) return;
    // All producers await admission, never the callback itself. No Promise
    // chain is extended while full, and stop wakes admission even when the
    // currently executing user callback never settles.
    const blocked = queue.pending >= MAX_OAEP_LISTENER_PENDING || queue.bytes + bytes > MAX_OAEP_LISTENER_BYTES;
    const waitingAt = blocked ? performance.now() : 0;
    if (blocked) this.metrics.listenerBackpressureWaits += 1;
    try {
      while (queue.pending >= MAX_OAEP_LISTENER_PENDING || queue.bytes + bytes > MAX_OAEP_LISTENER_BYTES) {
        await queue.changed;
        if (this.listenerQueues.get(listener) !== queue) return;
      }
    } finally {
      if (blocked) {
        const elapsed = performance.now() - waitingAt;
        this.metrics.listenerWaitMs += elapsed;
        this.metrics.listenerMaxWaitMs = Math.max(this.metrics.listenerMaxWaitMs, elapsed);
      }
    }
    if (this.listenerQueues.get(listener) !== queue) return;
    const enqueuedAt = performance.now();
    this.metrics.listenerPending += 1;
    this.metrics.listenerBytes += bytes;
    this.metrics.listenerTotalPeakPending = Math.max(this.metrics.listenerTotalPeakPending, this.metrics.listenerPending);
    this.metrics.listenerTotalPeakBytes = Math.max(this.metrics.listenerTotalPeakBytes, this.metrics.listenerBytes);
    queue.pending += 1;
    queue.bytes += bytes;
    this.metrics.listenerPeakPending = Math.max(this.metrics.listenerPeakPending, queue.pending);
    this.metrics.listenerPeakBytes = Math.max(this.metrics.listenerPeakBytes, queue.bytes);
    queue.tail = queue.tail.then(async () => {
      if (this.listenerQueues.get(listener) !== queue) return;
      const delay = performance.now() - enqueuedAt;
      this.metrics.listenerMaxQueueDelayMs = Math.max(this.metrics.listenerMaxQueueDelayMs, delay);
      if (terminal) this.metrics.listenerMaxTerminalDelayMs = Math.max(this.metrics.listenerMaxTerminalDelayMs, delay);
      const context = { controller: this, active: true };
      try {
        await listenerContext.run(context, async () => {
          try { await invoke(); }
          catch {
            this.metrics.listenerFailures += 1;
            if (!recoverWithSnapshot || this.listenerQueues.get(listener) !== queue || !listener.onSnapshot) return;
            try { await listener.onSnapshot(queue.state, "resnapshot"); }
            catch { this.metrics.listenerFailures += 1; }
          }
        });
      } finally { context.active = false; }
    }).finally(() => {
      if (this.listenerQueues.get(listener) === queue) {
        this.metrics.listenerPending -= 1;
        this.metrics.listenerBytes -= bytes;
      }
      queue.pending -= 1;
      queue.bytes -= bytes;
      const wake = queue.wake;
      queue.changed = new Promise<void>((resolve) => { queue.wake = resolve; });
      wake();
    });
  }

  private deliverSnapshot(listener: OaepSessionListener, snapshot: OaepSessionState, source: "snapshot" | "resnapshot"): void | Promise<void> {
    const queue = this.listenerQueues.get(listener);
    if (!queue) return;
    queue.state = copyProjection(snapshot);
    return listener.onSnapshot?.(queue.state, source);
  }

  private async notifySnapshot(source: "snapshot" | "resnapshot"): Promise<void> {
    if (source === "snapshot") this.metrics.snapshots += 1;
    else this.metrics.resnapshots += 1;
    // Capture once per publication, not once per Event or per admission wait.
    const snapshot = copyProjection(this.state);
    for (const listener of [...this.listeners]) {
      await this.dispatch(listener, () => this.deliverSnapshot(listener, snapshot, source), false);
    }
  }

  private async notifyEvent(event: OaepEvent, source: "replay" | "stream", bytes: number): Promise<void> {
    const noise = isPresentationNoiseOaepEvent(event);
    if (noise && !event.data.run && !event.data.item) return;
    const history = this.state.history;
    for (const listener of [...this.listeners]) {
      await this.dispatch(listener, () => {
        const state = this.listenerQueues.get(listener)!.state;
        // A newly attached listener's baseline may already include this Event.
        if (event.sequence <= state.cursor) return;
        // Copy only the changed Run/Item through the reducer, never full history.
        // Page Run summaries are provisional; canonical validation already ran.
        const run = event.data.run as OaepRun | undefined;
        if (run?.id) state.runs.delete(run.id);
        reduceOaepEvent(state.items, state.runs, event, state.deltaShadows);
        state.cursor = event.sequence;
        state.history = history;
        if (!noise) return listener.onEvent?.(event, state, source);
      }, true, bytes, /^event\.run\.(completed|failed|cancelled)$/.test(event.type));
    }
  }

  private async notifyReplayPage(
    count: number, fromSequence: number, toSequence: number, hasMore: boolean,
  ): Promise<void> {
    for (const listener of this.listeners) {
      await this.dispatch(
        listener,
        () => listener.onReplayPage?.(count, fromSequence, toSequence, hasMore),
        false,
      );
    }
  }

  private async notifyConnection(state: "connected" | "retrying" | "degraded", error?: unknown): Promise<void> {
    const attempt = this.retryAttempt;
    for (const listener of this.listeners) {
      await this.dispatch(listener, () => listener.onConnection?.(state, attempt, error), false);
    }
  }

  private async notifyFatal(error: unknown): Promise<void> {
    for (const listener of this.listeners) {
      await this.dispatch(listener, () => listener.onFatal?.(error, this.listenerQueues.get(listener)!.state), false);
    }
  }

  private async transition(next: OaepStreamPhase): Promise<void> {
    if (this.phase === next && next === "retrying") return;
    assertOaepStreamTransition(this.phase, next);
    const previous = this.phase;
    this.phase = next;
    for (const listener of this.listeners) {
      await this.dispatch(listener, () => listener.onState?.(next, previous), false);
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
    assertOaepSnapshotIntegrity(snapshot);
    if (snapshot.session.id !== this.sessionId || snapshot.snapshot_sequence < this.cursor) {
      throw new Error("oaep_snapshot_waterline_stale");
    }
    // A journal gap makes *every* previous projection suspect, including old
    // terminal Items, Runs and delta shadows outside the new snapshot window.
    // Publish only this authoritative window; older content must be paged again.
    this.historyReloadRequired = this.metrics.snapshots > 0;
    this.historyRequest = undefined; // Old in-flight pages fail the checkpoint identity check.
    this.items.clear();
    this.runs.clear();
    this.pagedRunIds.clear();
    this.deltaShadows.clear();
    this.itemWaterlines.clear();
    this.pendingDeltas.clear();
    this.pendingDeltaCount = 0;
    this.pendingDeltaBytes = 0;
    snapshot.items.forEach((item) => {
      this.items.set(item.id, item);
      this.itemWaterlines.set(item.id, snapshot.snapshot_sequence);
    });
    // A completed window needs no checkpoint baseline retained for pagination.
    this.checkpointItems = snapshot.window?.has_more
      ? new Map(snapshot.items.map((item) => [item.id, item])) : new Map();
    snapshot.runs.forEach((run) => this.runs.set(run.id, run));
    this.checkpoint = snapshot.checkpoint;
    this.historyCursor = snapshot.window?.next_cursor ?? null;
    this.cursor = snapshot.snapshot_sequence;
  }

  loadEarlier(cursor: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (listenerContext.getStore()?.controller === this && listenerContext.getStore()?.active) {
      return Promise.reject(new Error("oaep_listener_reentrant_history: schedule history loading outside the listener callback"));
    }
    if (this.resnapshotRequested || !cursor || cursor !== this.historyCursor) {
      return Promise.reject(historyCursorStale());
    }
    if (this.historyRequest?.cursor === cursor) return this.historyRequest.promise;
    if (this.historyRequest) return Promise.reject(historyCursorStale());
    const checkpoint = this.checkpoint;
    const promise = (async () => {
      // The request belongs to the shared controller, not to one window's abort
      // signal. An aborted caller must not cancel another window's same-page read.
      let page: OaepSnapshot;
      try {
        page = await this.client.getOaepSnapshot(this.sessionId, { cursor, limit: 100, signal: this.abort.signal });
      } catch (error) {
        if (!isCursorExpired(error)) throw error;
        // forceFresh reads share this controller: wake its stream so that the
        // next publication actually carries a new checkpoint, not the old cache.
        if (this.checkpoint === checkpoint && this.historyCursor === cursor) {
          this.resnapshotRequested = true;
          this.activeStreamAbort?.abort("oaep_history_cursor_expired");
        }
        throw historyCursorStale(error);
      }
      await this.publish(async () => {
        this.abort.signal.throwIfAborted();
        assertOaepSnapshotIntegrity(page);
        if (this.resnapshotRequested || this.checkpoint !== checkpoint || this.historyCursor !== cursor) {
          throw historyCursorStale();
        }
        if (!checkpoint || page.session.id !== this.sessionId || !page.window
          || page.snapshot_sequence !== checkpoint.sequence
          || page.checkpoint?.snapshot_hash !== checkpoint.snapshot_hash
          || page.checkpoint?.item_count !== checkpoint.item_count
          || page.window.next_cursor === cursor) throw new Error("oaep_history_checkpoint_mismatch");
        const checkpointItems = new Map(this.checkpointItems);
        for (const item of page.items) {
          const previous = checkpointItems.get(item.id);
          if (previous && oaepProjectionDigest([previous]) !== oaepProjectionDigest([item])) {
            throw new Error("oaep_history_item_conflict");
          }
          checkpointItems.set(item.id, item);
        }
        if (checkpointItems.size > checkpoint.item_count
          || (!page.window.has_more && (checkpointItems.size !== checkpoint.item_count
            || oaepProjectionDigest([...checkpointItems.values()]) !== checkpoint.snapshot_hash))) {
          throw new Error("oaep_history_checkpoint_digest_mismatch");
        }
        // Stage all rebases before committing: a malformed page must not partially
        // mutate the live maps. Event sequence, never Item.sequence, is revision.
        const additions = new Map<string, OaepItem>();
        for (const item of page.items) {
          if (!this.items.has(item.id)
            || (this.itemWaterlines.get(item.id) ?? 0) < checkpoint.sequence) {
            additions.set(item.id, item);
            for (const event of this.pendingDeltas.get(item.id)?.events ?? []) {
              if (event.sequence > checkpoint.sequence) appendDelta(additions, new Map(), event);
            }
          }
        }
        for (const [id, item] of additions) {
          this.items.set(id, item);
          this.itemWaterlines.set(id, Math.max(checkpoint.sequence, this.itemWaterlines.get(id) ?? 0));
          this.deltaShadows.delete(id);
          this.clearPendingDeltas(id);
        }
        this.checkpointItems = page.window.has_more ? checkpointItems : new Map();
        for (const run of page.runs) if (!this.runs.has(run.id)) {
          this.runs.set(run.id, run);
          // Runs in earlier pages are read at response time, not checkpoint time.
          // The next journal Run event must supersede this provisional value,
          // even if that value already advertises its eventual terminal status.
          this.pagedRunIds.add(run.id);
        }
        this.historyCursor = page.window.next_cursor;
        // Full merged view, not the page alone, so active SessionViewStores rebuild
        // their Run indices/counts and subsequent patches include the new history.
        const snapshot = copyProjection(this.state);
        for (const listener of [...this.listeners]) {
          await this.dispatch(listener, () => this.deliverSnapshot(listener, snapshot, "resnapshot"), false);
        }
      });
      await Promise.all([...this.listenerQueues.values()].map((queue) => Promise.race([queue.tail, queue.removed])));
    })().finally(() => { if (this.historyRequest?.promise === promise) this.historyRequest = undefined; });
    this.historyRequest = { cursor, promise };
    return promise;
  }

  private clearPendingDeltas(id: string): void {
    const pending = this.pendingDeltas.get(id);
    if (!pending) return;
    this.pendingDeltaCount -= pending.events.length;
    this.pendingDeltaBytes -= pending.bytes;
    this.pendingDeltas.delete(id);
  }

  private accept(event: OaepEvent, source: "replay" | "stream"): Promise<void> {
    return this.publish(() => this.acceptPublished(event, source));
  }

  private async acceptPublished(event: OaepEvent, source: "replay" | "stream"): Promise<void> {
    this.abort.signal.throwIfAborted();
    if (this.resnapshotRequested) throw new OaepResnapshotRequired();
    assertOaepEventIntegrity(event, this.sessionId);
    if (event.session_id !== this.sessionId) throw new Error("Cross-Session OAEP Event rejected.");
    if (event.sequence <= this.cursor) return;
    if (event.sequence !== this.cursor + 1) throw new OaepEventGap();
    const eventBytes = Buffer.byteLength(JSON.stringify(event), "utf8");
    if (eventBytes > MAX_OAEP_LISTENER_BYTES) throw new Error("oaep_listener_event_too_large");
    const missingDelta = event.type === "event.item.delta" && event.item_id && !this.items.has(event.item_id);
    const pendingBytes = missingDelta ? eventBytes : 0;
    if (missingDelta && (this.pendingDeltaCount >= MAX_PENDING_OAEP_DELTAS
      || this.pendingDeltaBytes + pendingBytes > MAX_PENDING_OAEP_DELTA_BYTES)) {
      // Do not advance the cursor or drop this Event: stop this stream and
      // recover from a canonical checkpoint, replaying everything after it.
      throw new OaepResnapshotRequired();
    }
    const incomingRun = event.data.run as OaepRun | undefined;
    if (incomingRun?.id && this.pagedRunIds.delete(incomingRun.id)) this.runs.delete(incomingRun.id);
    reduceOaepEvent(this.items, this.runs, event, this.deltaShadows);
    if (event.item_id) {
      this.itemWaterlines.set(event.item_id, event.sequence);
      if (missingDelta) {
        const pending = this.pendingDeltas.get(event.item_id) ?? { events: [], bytes: 0 };
        pending.events.push(event);
        pending.bytes += pendingBytes;
        this.pendingDeltaCount += 1;
        this.pendingDeltaBytes += pendingBytes;
        this.pendingDeltas.set(event.item_id, pending);
      } else {
        this.clearPendingDeltas(event.item_id);
      }
    }
    this.cursor = event.sequence;
    if (source === "replay") {
      this.metrics.replayEvents += 1;
      // Publish restoration before the first recovered Event. A terminal
      // Event can make the owner stop synchronously, so a page-level callback
      // after delivery is too late and loses the observable restored state.
      if (this.retryAttempt) {
        await this.notifyConnection("connected");
        this.retryAttempt = 0;
      }
    }
    else this.metrics.streamEvents += 1;
    await this.notifyEvent(event, source, eventBytes);
  }

  private async run(): Promise<void> {
    let needsSnapshot = true;
    let firstReady = false;
    let retryStartedAt = 0;
    while (!this.abort.signal.aborted) {
      try {
        if (needsSnapshot) {
          const isResnapshot = this.metrics.snapshots > 0;
          await this.transition(isResnapshot ? "resnapshot" : "snapshot");
          const snapshot = await this.client.getOaepSnapshot(this.sessionId, { signal: this.abort.signal });
          await this.publish(async () => {
            this.abort.signal.throwIfAborted();
            this.replaceSnapshot(snapshot);
            await this.notifySnapshot(isResnapshot ? "resnapshot" : "snapshot");
          });
          needsSnapshot = false;
          this.resnapshotRequested = false;
        }
        if (this.resnapshotRequested) throw new OaepResnapshotRequired();
        await this.transition("replay");
        while (true) {
          const fromSequence = this.cursor;
          const page = await this.client.listOaepEvents(this.sessionId, this.cursor);
          if (this.resnapshotRequested) throw new OaepResnapshotRequired();
          for (const event of page.data) await this.accept(event, "replay");
          await this.notifyReplayPage(page.data.length, fromSequence, this.cursor, page.has_more);
          if (!page.has_more) break;
        }
        if (!firstReady) { firstReady = true; this.markReady(); }
        // Replay itself is an authoritative Runtime connection. A terminal
        // may arrive during replay and synchronously stop this subscription,
        // so publish restoration before attempting the next long-lived SSE.
        if (this.resnapshotRequested) throw new OaepResnapshotRequired();
        const streamAbort = new AbortController();
        this.activeStreamAbort = streamAbort;
        const abortStream = () => streamAbort.abort(this.abort.signal.reason);
        this.abort.signal.addEventListener("abort", abortStream, { once: true });
        if (this.abort.signal.aborted) abortStream();
        try {
          const opened = await this.client.openOaepEventStream(this.sessionId, this.cursor, streamAbort.signal);
          await this.transition("connected");
          if (this.retryAttempt) await this.notifyConnection("connected");
          // A TCP handshake followed by an immediate close is not a recovered
          // subscription. Only reset the consecutive-recovery budget after the
          // stream has remained healthy for a short interval; this prevents a
          // connect/close loop from keeping a Run in `running` forever.
          const stableConnection = setTimeout(() => {
            this.retryAttempt = 0;
            retryStartedAt = 0;
            this.generationRebinds = 0;
          }, Math.min(5_000, Math.max(250, Math.floor(OAEP_NETWORK_RECOVERY_WINDOW_MS / 2))));
          try {
            await consumeSse(opened.events, streamAbort.signal, (event) => this.accept(event, "stream"));
          } finally {
            clearTimeout(stableConnection);
          }
          if (this.resnapshotRequested) throw new OaepResnapshotRequired();
          if (!this.abort.signal.aborted) throw new Error("Runtime OAEP stream ended before cancellation.");
        } finally {
          this.abort.signal.removeEventListener("abort", abortStream);
          if (this.activeStreamAbort === streamAbort) this.activeStreamAbort = undefined;
        }
      } catch (error) {
        if (this.abort.signal.aborted) break;
        const disposition = classifyOaepStreamError(error);
        if (disposition === "fatal") {
          this.metrics.fatalErrors += 1;
          this.terminalError = error;
          await this.transition("fatal");
          this.markReadyFailed(error);
          await this.notifyFatal(error);
          break;
        }
        // A shared client whose Runtime generation was invalidated cannot be
        // kept by retrying the same transport: every request aborts pre-flight,
        // so the loop would emit no traffic at all and end in a degraded
        // subscription that leaves the outbox acknowledgement pending.
        // Re-resolve the client and resume replay from the current cursor.
        if (isRuntimeClientGenerationInvalidated(error) && await this.rebindClient()) {
          this.metrics.reconnects += 1;
          await this.transition("retrying");
          await this.notifyConnection("retrying", error);
          continue;
        }
        this.metrics.reconnects += 1;
        if (error instanceof OaepEventGap || (
          error instanceof Error && /^(?:oaep_|Cross-Session OAEP)/.test(error.message)
        )) this.metrics.protocolViolations += 1;
        // A sequence gap is not snapshot corruption. Re-enter replay from the
        // last contiguous cursor so every missing Event is delivered to live
        // listeners in order. A snapshot would advance past those Events and
        // the chat projection could silently lose content or the Run terminal.
        // Expired cursors and a bounded historical rebase buffer require a
        // canonical resnapshot instead of retaining an incomplete projection.
        needsSnapshot ||= disposition === "cursor_expired" || error instanceof OaepResnapshotRequired || this.resnapshotRequested;
        this.resnapshotRequested ||= needsSnapshot;
        this.retryAttempt += 1;
        if (!retryStartedAt) retryStartedAt = Date.now();
        if (
          this.retryAttempt >= MAX_AUTOMATIC_RETRY_ATTEMPTS
          || Date.now() - retryStartedAt >= OAEP_NETWORK_RECOVERY_WINDOW_MS
        ) {
          this.metrics.degradedErrors += 1;
          this.terminalError = new OaepSyncDegradedError(error);
          await this.transition("degraded");
          this.markReadyFailed(this.terminalError);
          await this.notifyConnection("degraded", this.terminalError);
          break;
        }
        await this.transition("retrying");
        await this.notifyConnection("retrying", error);
        await waitForRetry(oaepRetryDelayMs(this.retryAttempt), this.abort.signal);
      }
    }
    if (this.phase !== "fatal" && this.phase !== "degraded" && this.phase !== "closed") await this.transition("closed");
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
  generationRebinds: number;
}> {
  return [...controllers.entries()].flatMap(([endpointKey, sessions]) =>
    [...sessions.entries()].map(([sessionId, controller]) => ({
      endpointKey,
      sessionId,
      subscribers: controller.listeners.size,
      sse: controller.phase === "connected" ? 1 : 0,
      phase: controller.phase,
      cursor: controller.cursor,
      generationRebinds: controller.generationRebinds,
    })),
  );
}

/**
 * Subscribe to one Session's OAEP stream.
 *
 * `options.resolveClient` is required for a subscription that must survive a
 * Runtime generation change: the controller re-resolves the transport and
 * resumes from its own cursor instead of retrying a client that is already
 * aborted. Subscriptions without it keep the retry-only behaviour.
 * `signal` can cancel even initial replay, before the subscription is returned.
 * Listeners must not await this subscription's ready/done or future events:
 * those depend on their own queue making progress. Same-controller history
 * loading and unready resubscription from a callback reject instead of self-waiting.
 * `done` remains producer completion, not a listener-drain promise.
 */
export async function subscribeOaepSession(
  client: RuntimeClient,
  sessionId: string,
  listener: OaepSessionListener,
  options: { resolveClient?: () => Promise<OaepSessionClientLease>; signal?: AbortSignal } = {},
): Promise<OaepSessionSubscription> {
  options.signal?.throwIfAborted();
  const ownerKey = oaepSessionOwnerKey(client);
  let sessions = controllers.get(ownerKey);
  if (!sessions) { sessions = new Map(); controllers.set(ownerKey, sessions); }
  let controller = sessions.get(sessionId);
  if (!controller) {
    controller = new SharedOaepSessionController(client, sessionId, () => {
      // The controller may have been re-keyed to a newer Runtime generation
      // while it was subscribed, so resolve the key it owns right now.
      const currentKey = controller!.ownerKey;
      const current = controllers.get(currentKey);
      current?.delete(sessionId);
      if (current && !current.size) controllers.delete(currentKey);
    }, options.resolveClient);
    sessions.set(sessionId, controller);
  }
  if (listenerContext.getStore()?.controller === controller && listenerContext.getStore()?.active && controller.phase !== "connected") {
    throw new Error("oaep_listener_reentrant_subscribe: schedule subscription outside the listener callback");
  }
  const remove = controller.add(listener);
  const cancel = () => remove();
  options.signal?.addEventListener("abort", cancel, { once: true });
  let rejectAbort: (() => void) | undefined;
  try {
    await Promise.race([controller.ready, new Promise<never>((_, reject) => {
      rejectAbort = () => reject(options.signal?.reason ?? new Error("oaep_subscription_aborted"));
      options.signal?.addEventListener("abort", rejectAbort, { once: true });
      if (options.signal?.aborted) { cancel(); rejectAbort(); }
    })]);
    options.signal?.throwIfAborted();
  } catch (error) {
    options.signal?.removeEventListener("abort", cancel);
    remove(); // No subscription handle will be returned to release this listener.
    throw error;
  } finally {
    if (rejectAbort) options.signal?.removeEventListener("abort", rejectAbort);
  }
  return {
    get cursor() { return controller!.cursor; },
    get state() { return controller!.state; },
    get metrics() { return { ...controller!.metrics }; },
    get terminalError() { return controller!.terminalError; },
    get phase() { return controller!.phase; },
    done: controller.done,
    loadEarlier: (cursor, signal) => controller!.loadEarlier(cursor, signal),
    stop: () => { options.signal?.removeEventListener("abort", cancel); remove(); },
  };
}
