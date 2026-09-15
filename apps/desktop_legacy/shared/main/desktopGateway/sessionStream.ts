/**
 * The OAEP session subscription: snapshot, replay, live stream, recover.
 *
 * This is the whole of feature 3.1's read path and the reason the write path can
 * return 202.  A subscription is not "the response to my run" -- it is a view of
 * the session that happens to be receiving one.  Everything below follows from
 * that: a second window subscribing mid-run sees the same state, a reconnect
 * resumes rather than restarts, and closing the window that started a run does
 * not end it.
 *
 * ## The three phases exist as a set, not as fallbacks
 *
 *     snapshot          "here is everything up to sequence N"
 *     events?after=N    "here is what you missed"
 *     events/stream     "here is what happens next"
 *
 * Skipping the middle step is the classic bug: subscribe, then snapshot, and
 * every event between the two arrives before the state it mutates.  Snapshot
 * first, then replay from the snapshot's sequence, then attach the live stream at
 * the replay's last sequence -- each hand-off is exact because the sequence space
 * is dense and `after_sequence` is exclusive.
 *
 * ## Why an expired cursor is not an error the user should see
 *
 * `after_sequence` is exclusive over a dense space, so "no events after N" and
 * "the events after N are gone" are the same empty list.  The server
 * distinguishes them with a 409, and the only correct response is to throw away
 * local state and re-snapshot.  Showing the user an error here would be showing
 * them a recoverable condition.
 */

import {
  DesktopGatewayError,
  type OaepEvent,
  type OaepItem,
  type OaepRun,
} from "../../api/desktopGateway";
import type {
  BridgeSessionEvent,
  SessionRunState,
  SessionStreamPhase,
} from "../../api/desktopBridge";
import { toBridgeFailure } from "../../api/desktopBridge";
import type { DesktopGatewayClient } from "./client";

export type SessionEventListener = (event: BridgeSessionEvent) => void;

export interface SessionSubscription {
  readonly sessionId: string;
  close(): void;
}

interface RetryPolicy {
  /** Attempt 1 waits this long; each further attempt doubles up to `maxDelayMs`. */
  baseDelayMs: number;
  maxDelayMs: number;
  /** After this many consecutive failures the subscription degrades and stops. */
  maxAttempts: number;
}

const DEFAULT_RETRY: RetryPolicy = { baseDelayMs: 500, maxDelayMs: 10_000, maxAttempts: 8 };

/** Replay is paged; this is the page size, matched to the server's cap. */
const REPLAY_PAGE = 500;

/**
 * Events that carry no information a user can see.
 *
 * `event.session.updated` fires on every run transition to refresh the session
 * row, and a bare `event.run.resumed` is the journal's own heartbeat.  Forwarding
 * them would spend the renderer's dispatch budget on repaints that change
 * nothing -- and under load that budget is what protects the visible token
 * stream.
 */
function isPresentationNoise(event: OaepEvent): boolean {
  if (event.type === "event.session.updated") return true;
  if (event.type === "event.run.resumed") {
    const reason = (event.data as { reason?: unknown }).reason;
    return typeof reason !== "string" || !reason.trim();
  }
  return false;
}

function runState(run: OaepRun): SessionRunState {
  return { runId: run.id, status: run.status, updatedAt: run.updated_at };
}

/**
 * Maps a delta onto the pane that renders it.
 *
 * The `kind` on an OAEP delta names the backend's channel; the renderer needs to
 * know which surface the text belongs on.  `output` is command/tool output, which
 * shares a code block rather than the message bubble.
 */
function deltaChannel(kind: string): "message" | "reasoning" | "output" | null {
  if (kind === "message" || kind === "text" || kind === "message.text") return "message";
  if (kind === "reasoning" || kind === "thinking" || kind === "reasoning.text") return "reasoning";
  if (kind === "output" || kind === "stdout" || kind === "stderr") return "output";
  return null;
}

/**
 * One live view of one session, shared by every listener that asks for it.
 *
 * Sharing matters: two windows on the same conversation must not open two SSE
 * connections, or the Runtime does the journal poll twice and the two windows can
 * disagree about what arrived. The controller keeps one connection and one
 * authoritative item map; a listener joining late gets a synthetic `snapshot`
 * from that map rather than a second HTTP snapshot.
 */
class SessionController {
  readonly items = new Map<string, OaepItem>();
  readonly runs = new Map<string, OaepRun>();
  readonly listeners = new Set<SessionEventListener>();
  readonly sessionId: string;
  private readonly client: DesktopGatewayClient;
  private readonly retry: RetryPolicy;
  private readonly onIdle: (sessionId: string) => void;
  private readonly abort = new AbortController();
  private cursor = 0;
  private phase: SessionStreamPhase = "idle";
  private attempt = 0;
  private closed = false;
  private hasSnapshot = false;
  private pump: Promise<void> | null = null;

  constructor(
    client: DesktopGatewayClient,
    sessionId: string,
    retry: RetryPolicy,
    onIdle: (sessionId: string) => void,
  ) {
    this.client = client;
    this.sessionId = sessionId;
    this.retry = retry;
    this.onIdle = onIdle;
  }

  start(): void {
    if (this.pump) return;
    this.pump = this.run().catch(() => undefined);
  }

  addListener(listener: SessionEventListener): void {
    this.listeners.add(listener);
    // A late joiner is served from the controller's own state rather than a
    // second HTTP snapshot. The condition is `hasSnapshot`, not "are there any
    // items": an empty conversation is a legitimate state, and gating on
    // emptiness would leave a new session's window waiting for a first message
    // that has not been sent yet -- a loading spinner that never resolves.
    if (this.hasSnapshot) listener(this.snapshotEvent());
    listener({ kind: "phase", sessionId: this.sessionId, phase: this.phase });
  }

  private snapshotEvent(): BridgeSessionEvent {
    return {
      kind: "snapshot",
      sessionId: this.sessionId,
      items: [...this.items.values()],
      runs: [...this.runs.values()].map(runState),
      cursor: this.cursor,
    };
  }

  removeListener(listener: SessionEventListener): void {
    this.listeners.delete(listener);
    if (!this.listeners.size) this.onIdle(this.sessionId);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.setPhase("closed");
    this.abort.abort();
    this.listeners.clear();
  }

  private emit(event: BridgeSessionEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A thrown listener is that listener's bug. Letting it escape here would
        // tear down the stream for every other window on the same session.
      }
    }
  }

  private setPhase(phase: SessionStreamPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.emit({ kind: "phase", sessionId: this.sessionId, phase });
  }

  private async run(): Promise<void> {
    while (!this.closed) {
      try {
        await this.snapshot();
        await this.replay();
        await this.connect();
        // A clean stream end (the server closed it) is not a failure; loop back
        // around and resume from the cursor we already hold.
        this.attempt = 0;
      } catch (error) {
        if (this.closed || this.abort.signal.aborted) return;
        if (error instanceof DesktopGatewayError && error.isCursorExpired) {
          // Recoverable by construction: drop local state and re-snapshot. Not
          // an attempt, so it does not consume the retry budget.
          this.items.clear();
          this.runs.clear();
          this.cursor = 0;
          continue;
        }
        if (!this.shouldRetry(error)) {
          this.degrade(error, true);
          return;
        }
        this.attempt += 1;
        if (this.attempt > this.retry.maxAttempts) {
          this.degrade(error, false);
          return;
        }
        this.setPhase("retrying");
        this.emit({
          kind: "error",
          sessionId: this.sessionId,
          error: toBridgeFailure(error),
          fatal: false,
        });
        await this.sleep(
          Math.min(this.retry.maxDelayMs, this.retry.baseDelayMs * 2 ** (this.attempt - 1)),
        );
      }
    }
  }

  /**
   * A 404 means the session is gone and a 401/403 means this Runtime will never
   * accept us; retrying either just spins. Everything else -- transport blips, a
   * Runtime mid-restart, a 5xx -- is worth backing off and trying again.
   */
  private shouldRetry(error: unknown): boolean {
    if (!(error instanceof DesktopGatewayError)) return true;
    if (error.status === 404) return false;
    if (error.isUnauthorized) return false;
    return true;
  }

  private degrade(error: unknown, fatal: boolean): void {
    this.setPhase("degraded");
    this.emit({
      kind: "error",
      sessionId: this.sessionId,
      error: toBridgeFailure(error),
      fatal,
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.abort.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  private async snapshot(): Promise<void> {
    this.setPhase("snapshot");
    let cursor: string | null = null;
    const items: OaepItem[] = [];
    let sequence = 0;
    // Paged: a long conversation's Item set does not fit one response, and the
    // server tells us where the page ended rather than making us guess.
    for (;;) {
      const page = await this.client.getSessionSnapshot(this.sessionId, { cursor, limit: 200 });
      items.push(...page.items);
      sequence = page.snapshot_sequence;
      for (const run of page.runs) this.runs.set(run.id, run);
      const window = page.window;
      if (!window?.has_more || !window.next_cursor) break;
      cursor = window.next_cursor;
    }
    this.items.clear();
    for (const item of items) this.items.set(item.id, item);
    this.cursor = sequence;
    this.hasSnapshot = true;
    this.emit(this.snapshotEvent());
  }

  private async replay(): Promise<void> {
    this.setPhase("replay");
    for (;;) {
      const page = await this.client.listSessionEvents(this.sessionId, this.cursor, REPLAY_PAGE);
      for (const event of page.data) this.ingest(event, { silentDeltas: true });
      this.cursor = page.next_sequence;
      if (!page.has_more) return;
    }
  }

  private async connect(): Promise<void> {
    const body = await this.client.streamSessionEvents(
      this.sessionId,
      this.cursor,
      this.abort.signal,
    );
    this.setPhase("connected");
    this.attempt = 0;
    await consumeSse(body, this.abort.signal, (event) => this.ingest(event, { silentDeltas: false }));
  }

  /**
   * Fold one event into state and tell the listeners what changed.
   *
   * `silentDeltas` is set during replay.  Replayed deltas are historical: the
   * Item they belong to is already complete in the same page, so re-emitting them
   * would type out text the user is about to see appear whole. The fold still
   * happens -- only the animation is suppressed.
   */
  private ingest(event: OaepEvent, options: { silentDeltas: boolean }): void {
    if (event.sequence > this.cursor) this.cursor = event.sequence;

    const run = (event.data as { run?: OaepRun }).run;
    if (run && typeof run === "object" && "id" in run) {
      const previous = this.runs.get(run.id);
      this.runs.set(run.id, run);
      if (!previous || previous.status !== run.status) {
        this.emit({
          kind: "run",
          sessionId: this.sessionId,
          run: runState(run),
          cursor: this.cursor,
        });
      }
    }

    if (event.type === "event.item.delta") {
      if (options.silentDeltas) return;
      const delta = event.data.delta;
      const itemId = event.item_id;
      if (!delta || !itemId) return;
      const channel = deltaChannel(String(delta.kind ?? ""));
      const text = typeof delta.text === "string" ? delta.text : "";
      if (!channel || !text) return;
      this.emit({ kind: "delta", sessionId: this.sessionId, itemId, channel, text });
      return;
    }

    const item = event.data.item;
    if (item && typeof item === "object" && "id" in item) {
      this.items.set(item.id, item);
      this.emit({
        kind: "items",
        sessionId: this.sessionId,
        items: [item],
        cursor: this.cursor,
      });
      return;
    }

    if (isPresentationNoise(event)) return;
  }
}

/**
 * Parses `text/event-stream` frames.
 *
 * Hand-written rather than using `EventSource` for two reasons the desktop needs:
 * `EventSource` cannot send the pairing and bearer headers, and its reconnect
 * policy is fixed -- it would resume from `Last-Event-ID` on its own schedule,
 * bypassing the snapshot/replay recovery above and silently producing the hole in
 * the conversation this module exists to prevent.
 */
export async function consumeSse(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: OaepEvent) => void,
): Promise<void> {
  const reader = stream.getReader();
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      let value: Uint8Array | undefined;
      let done: boolean;
      try {
        ({ value, done } = await reader.read());
      } catch (error) {
        // Cancelling a reader makes the pending `read()` reject with the abort
        // reason. That is an ordinary unsubscribe -- every closed window and
        // every reconnect goes through it -- so it must return, not throw:
        // otherwise each teardown surfaces as an unhandled rejection and the
        // retry loop treats a deliberate close as a transport failure.
        if (signal.aborted) return;
        throw error;
      }
      // Normalise CRLF: a proxy may rewrite line endings, and the frame
      // separator is defined in terms of "\n\n".
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      let consumed = 0;
      let boundary = buffer.indexOf("\n\n", consumed);
      while (boundary >= 0) {
        const frame = buffer.slice(consumed, boundary);
        consumed = boundary + 2;
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        // Heartbeats are comment frames (": heartbeat") with no data field.
        if (data) {
          try {
            onEvent(JSON.parse(data) as OaepEvent);
          } catch {
            // A frame we cannot parse is a protocol violation, but dropping the
            // whole connection over one would lose every event after it. The
            // sequence check on the next good frame will catch a real gap.
          }
        }
        boundary = buffer.indexOf("\n\n", consumed);
      }
      if (consumed > 0) buffer = buffer.slice(consumed);
      if (done) return;
      if (signal.aborted) return;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * The registry of live subscriptions, one per session regardless of how many
 * windows are watching.
 */
export class SessionStreamRegistry {
  private readonly controllers = new Map<string, SessionController>();
  private readonly client: DesktopGatewayClient;
  private readonly retry: RetryPolicy;

  constructor(client: DesktopGatewayClient, retry: RetryPolicy = DEFAULT_RETRY) {
    this.client = client;
    this.retry = retry;
  }

  subscribe(sessionId: string, listener: SessionEventListener): SessionSubscription {
    let controller = this.controllers.get(sessionId);
    if (!controller) {
      controller = new SessionController(this.client, sessionId, this.retry, (id) =>
        this.release(id),
      );
      this.controllers.set(sessionId, controller);
      controller.start();
    }
    controller.addListener(listener);
    let released = false;
    return {
      sessionId,
      close: () => {
        if (released) return;
        released = true;
        controller.removeListener(listener);
      },
    };
  }

  /**
   * The last listener left.  The connection is torn down rather than parked:
   * an idle SSE connection still holds a Runtime thread in `wait_oaep_events`,
   * and a desktop that opens twenty sessions over a session would hold twenty.
   */
  private release(sessionId: string): void {
    const controller = this.controllers.get(sessionId);
    if (!controller || controller.listeners.size) return;
    controller.close();
    this.controllers.delete(sessionId);
  }

  closeAll(): void {
    for (const controller of this.controllers.values()) controller.close();
    this.controllers.clear();
  }

  get activeSessionIds(): string[] {
    return [...this.controllers.keys()];
  }
}
