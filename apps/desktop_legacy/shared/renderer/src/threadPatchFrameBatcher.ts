import type { DesktopThreadSnapshotPatchEvent } from "../../api/desktopApi";

interface QueuedPatch {
  event: DesktopThreadSnapshotPatchEvent;
  deltaChunks?: string[];
  deltaChars?: number;
}

const MAX_COALESCED_DELTA_CHARS = 1024 * 1024;

/**
 * Preserve global patch order while coalescing only adjacent, contiguous
 * deltas. Chunk arrays avoid repeatedly copying the accumulated answer when a
 * backend emits thousands of fragments in one animation frame.
 */
export class ThreadPatchFrameBatcher {
  private queued: QueuedPatch[] = [];
  private frame: number | undefined;

  constructor(
    private readonly apply: (events: DesktopThreadSnapshotPatchEvent[]) => void,
    private readonly schedule: (callback: () => void) => number = (callback) => requestAnimationFrame(callback),
    private readonly cancel: (handle: number) => void = (handle) => cancelAnimationFrame(handle),
  ) {}

  enqueue(event: DesktopThreadSnapshotPatchEvent): void {
    const previous = this.queued.at(-1);
    if (previous?.event.patch.kind === "item.delta" && event.patch.kind === "item.delta"
      && previous.event.threadId === event.threadId
      && previous.event.patch.itemId === event.patch.itemId
      && previous.event.patch.messageId === event.patch.messageId
      && previous.event.generation === event.generation
      && previous.event.sessionSequence === event.baseSequence
      && previous.event.patch.delta.kind === event.patch.delta.kind
      && previous.event.patch.delta.segmentId === event.patch.delta.segmentId
      && (previous.deltaChars ?? previous.event.patch.delta.text.length) + event.patch.delta.text.length <= MAX_COALESCED_DELTA_CHARS) {
      (previous.deltaChunks ??= [previous.event.patch.delta.text]).push(event.patch.delta.text);
      previous.deltaChars = (previous.deltaChars ?? previous.event.patch.delta.text.length) + event.patch.delta.text.length;
      previous.event = event;
    } else {
      this.queued.push({
        event,
        ...(event.patch.kind === "item.delta" ? { deltaChunks: [event.patch.delta.text], deltaChars: event.patch.delta.text.length } : {}),
      });
    }
    const urgentMessages = event.patch.kind === "run.replace" ? event.patch.messages
      : event.patch.kind === "item.upsert" ? [event.patch.message]
      : event.patch.kind === "run.state" && event.patch.message ? [event.patch.message] : [];
    const urgent = urgentMessages.some((message) => {
      const status = message.structuredTurn?.status;
      return status === "completed" || status === "error" || status === "cancelled" || Boolean(message.inputRequest);
    });
    if (urgent) this.flush();
    else if (this.frame === undefined) this.frame = this.schedule(() => this.flush());
  }

  clearThread(threadId: string): void {
    this.queued = this.queued.filter(({ event }) => event.threadId !== threadId);
  }

  flush(): void {
    if (this.frame !== undefined) this.cancel(this.frame);
    this.frame = undefined;
    const batch = this.queued.map(({ event, deltaChunks }) => {
      if (!deltaChunks || event.patch.kind !== "item.delta") return event;
      const firstSequence = event.sessionSequence - deltaChunks.length;
      return {
        ...event,
        baseSequence: firstSequence,
        patch: { ...event.patch, delta: { ...event.patch.delta, text: deltaChunks.join("") } },
      } satisfies DesktopThreadSnapshotPatchEvent;
    });
    this.queued = [];
    if (batch.length) this.apply(batch);
  }

  dispose(): void {
    if (this.frame !== undefined) this.cancel(this.frame);
    this.frame = undefined;
    this.queued = [];
  }
}
