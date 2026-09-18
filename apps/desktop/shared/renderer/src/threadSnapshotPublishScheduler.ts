/**
 * Coalesces conversation-snapshot publishes.
 *
 * A streaming turn renders once per animation frame and used to publish a full
 * conversation snapshot on every one of them. Each publish serializes every
 * message over IPC and makes the main process rewrite the whole thread shard
 * plus the entire thread catalog, so a long answer wrote tens of MiB/s of JSON
 * and saturated the main-process event loop that also delivered the stream
 * patches that produced the next delta. The cost fed back into the stream as a
 * stutter.
 *
 * This scheduler owns the decision of *when* a snapshot is built and published:
 * a streaming update rides along with a trailing window, while a terminal or
 * one-shot update goes out immediately, and nothing is built on the render path
 * itself. It is deliberately free of React and of the DOM so the write-path
 * contract can be exercised directly.
 */

/** Trailing window a streaming publish is coalesced into. */
export const THREAD_SNAPSHOT_STREAM_INTERVAL_MS = 750;

export interface ThreadSnapshotPublishScheduler<Message> {
  /**
   * Records the newest state. Cheap by design: it never builds a snapshot, so
   * the caller may invoke it as often as it renders.
   */
  schedule: (messages: Message[]) => void;
  /** Publishes a pending state right away; a no-op when nothing is pending. */
  flush: (publishThreadId?: string) => void;
  /**
   * Drops pending state without publishing it and opens a fresh window, for a
   * conversation that is being replaced. The previous thread's tail has already
   * been flushed by the caller, and a swap never schedules a publish of its own,
   * so starting the clock over cannot add churn - it only keeps one
   * conversation's write cadence from delaying the next one's first update.
   */
  reset: () => void;
}

export interface ThreadSnapshotPublishSchedulerOptions<Message> {
  /** Classifies the update that is arriving, from the caller's live state. */
  isStreaming: () => boolean;
  /**
   * Builds and persists the snapshot. Returns whether anything was published;
   * a skipped publish must not advance the trailing window.
   *
   * ``publishThreadId`` is set only by an explicit flush: the caller is
   * publishing a conversation it is about to leave, while its live thread
   * reference has already moved to the incoming thread. Without it the flushed
   * snapshot would be persisted under the new thread's id.
   */
  publish: (messages: Message[], publishThreadId?: string) => boolean;
  now?: () => number;
  setTimeout?: (handler: () => void, timeout: number) => number;
  clearTimeout?: (handle: number) => void;
  queueMicrotask?: (task: () => void) => void;
}

export function createThreadSnapshotPublishScheduler<Message>(
  options: ThreadSnapshotPublishSchedulerOptions<Message>,
): ThreadSnapshotPublishScheduler<Message> {
  const now = options.now ?? (() => Date.now());
  const scheduleTimeout = options.setTimeout ?? ((handler, timeout) => window.setTimeout(handler, timeout));
  const cancelTimeout = options.clearTimeout ?? ((handle) => window.clearTimeout(handle));
  const runMicrotask = options.queueMicrotask ?? ((task) => queueMicrotask(task));

  let pendingMessages: Message[] | null = null;
  let queued = false;
  let timer: number | null = null;
  let lastPublishAt = 0;

  function publishPending(publishThreadId?: string): void {
    queued = false;
    if (timer !== null) {
      cancelTimeout(timer);
      timer = null;
    }
    const nextMessages = pendingMessages;
    pendingMessages = null;
    if (!nextMessages) return;
    if (options.publish(nextMessages, publishThreadId)) lastPublishAt = now();
  }

  function schedule(messages: Message[]): void {
    pendingMessages = messages;
    const streaming = options.isStreaming();
    if (queued) {
      // A publish is already pending. Streaming updates ride along with it; a
      // terminal update must not wait out a window that started mid-run.
      if (streaming) return;
      publishPending();
      return;
    }
    queued = true;
    if (!streaming) {
      runMicrotask(publishPending);
      return;
    }
    timer = scheduleTimeout(
      publishPending,
      Math.max(0, THREAD_SNAPSHOT_STREAM_INTERVAL_MS - (now() - lastPublishAt)),
    );
  }

  function flush(publishThreadId?: string): void {
    if (!queued) return;
    publishPending(publishThreadId);
  }

  function reset(): void {
    pendingMessages = null;
    queued = false;
    lastPublishAt = 0;
    if (timer !== null) {
      cancelTimeout(timer);
      timer = null;
    }
  }

  return { schedule, flush, reset };
}
