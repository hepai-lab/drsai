/**
 * Backpressure between the session stream and the renderer.
 *
 * A fast model produces deltas faster than Electron's IPC can serialise them and
 * far faster than React can paint them.  Without a bound, the queue between the
 * two grows until the main process is spending its time on `structuredClone` of
 * text the user will never see as separate frames -- and the visible symptom is
 * the *whole app* going unresponsive, not just the chat pane.
 *
 * Two rules keep it bounded:
 *
 * 1. **Consecutive deltas on the same item and channel merge.**  Ten deltas of
 *    one character each render identically to one delta of ten characters, so
 *    merging is free in the only sense that matters.  Merging is restricted to
 *    *consecutive* entries because a `run` or `items` event between two deltas
 *    changes what the second one means.
 *
 * 2. **Over capacity, deltas are dropped -- never `snapshot`, `items`, `run`,
 *    `phase` or `error`.**  Deltas are presentation-only: the authoritative text
 *    arrives on the next `items` event, which is why dropping them cannot lose a
 *    message.  Dropping a `run` event, by contrast, would strand the UI showing
 *    a spinner for a turn that finished.
 *
 * This is the mechanism the IPC contract refers to when it says a renderer must
 * never treat accumulated deltas as the message.
 */

import type { BridgeSessionEvent } from "../../api/desktopBridge";

export interface DispatchTarget {
  send(channel: string, payload: BridgeSessionEvent): void;
  isDestroyed(): boolean;
}

export interface BoundedDispatcherOptions {
  capacity?: number;
  /** Injectable so tests can drain deterministically instead of waiting. */
  schedule?: (flush: () => void) => void;
}

const DEFAULT_CAPACITY = 256;

export interface DispatcherMetrics {
  sent: number;
  merged: number;
  dropped: number;
}

export class BoundedEventDispatcher {
  private readonly queue: BridgeSessionEvent[] = [];
  private readonly target: DispatchTarget;
  private readonly channel: string;
  private readonly capacity: number;
  private readonly schedule: (flush: () => void) => void;
  private scheduled = false;
  private closed = false;
  readonly metrics: DispatcherMetrics = { sent: 0, merged: 0, dropped: 0 };

  constructor(
    target: DispatchTarget,
    channel: string,
    options: BoundedDispatcherOptions = {},
  ) {
    this.target = target;
    this.channel = channel;
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.schedule = options.schedule ?? ((flush) => setImmediate(flush));
  }

  push(event: BridgeSessionEvent): void {
    if (this.closed) return;
    if (event.kind === "delta") {
      const tail = this.queue[this.queue.length - 1];
      if (
        tail?.kind === "delta" &&
        tail.itemId === event.itemId &&
        tail.channel === event.channel &&
        tail.sessionId === event.sessionId
      ) {
        this.queue[this.queue.length - 1] = { ...tail, text: tail.text + event.text };
        this.metrics.merged += 1;
        this.arm();
        return;
      }
      if (this.queue.length >= this.capacity) {
        this.metrics.dropped += 1;
        this.arm();
        return;
      }
    } else if (this.queue.length >= this.capacity) {
      // Structural events are never dropped. Evicting the oldest delta keeps the
      // queue bounded while preserving every event that carries state.
      const victim = this.queue.findIndex((entry) => entry.kind === "delta");
      if (victim >= 0) {
        this.queue.splice(victim, 1);
        this.metrics.dropped += 1;
      }
    }
    this.queue.push(event);
    this.arm();
  }

  private arm(): void {
    if (this.scheduled || this.closed) return;
    this.scheduled = true;
    this.schedule(() => this.flush());
  }

  /**
   * Drains the queue.  Public so tests can flush synchronously; production always
   * reaches it through `arm()`.
   */
  flush(): void {
    this.scheduled = false;
    if (this.closed) return;
    if (this.target.isDestroyed()) {
      this.close();
      return;
    }
    const batch = this.queue.splice(0, this.queue.length);
    for (const event of batch) {
      // The window can close mid-batch; `send` on a destroyed WebContents throws
      // and would abandon the rest of the queue.
      if (this.target.isDestroyed()) {
        this.close();
        return;
      }
      this.target.send(this.channel, event);
      this.metrics.sent += 1;
    }
  }

  close(): void {
    this.closed = true;
    this.queue.length = 0;
  }

  get pending(): number {
    return this.queue.length;
  }
}
