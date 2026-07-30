import type { DesktopStreamingVoiceAudioChunk } from "../../api/desktopApi";

export type StreamingAudioQueueResult =
  | { accepted: true; bufferedAudioMs: number }
  | { accepted: false; bufferedAudioMs: number; reason: "duplicate" | "out_of_order" | "backpressure" | "terminal" };

export class BoundedStreamingAudioQueue {
  readonly maxBufferedAudioMs: number;
  readonly highWatermarkMs: number;
  readonly lowWatermarkMs: number;
  #bufferedAudioMs = 0;
  #chunks: DesktopStreamingVoiceAudioChunk[] = [];
  #lastAcceptedSequence = -1;
  #lastAcknowledgedSequence = -1;
  #terminal = false;

  constructor(options: { maxBufferedAudioMs: number; highWatermarkMs: number; lowWatermarkMs: number }) {
    const { maxBufferedAudioMs, highWatermarkMs, lowWatermarkMs } = options;
    if (!Number.isFinite(maxBufferedAudioMs) || maxBufferedAudioMs <= 0) throw new Error("maxBufferedAudioMs must be positive.");
    if (!Number.isFinite(highWatermarkMs) || highWatermarkMs <= 0 || highWatermarkMs > maxBufferedAudioMs) {
      throw new Error("highWatermarkMs must be positive and no greater than maxBufferedAudioMs.");
    }
    if (!Number.isFinite(lowWatermarkMs) || lowWatermarkMs < 0 || lowWatermarkMs >= highWatermarkMs) {
      throw new Error("lowWatermarkMs must be non-negative and below highWatermarkMs.");
    }
    this.maxBufferedAudioMs = maxBufferedAudioMs;
    this.highWatermarkMs = highWatermarkMs;
    this.lowWatermarkMs = lowWatermarkMs;
  }

  get bufferedAudioMs(): number { return this.#bufferedAudioMs; }
  get size(): number { return this.#chunks.length; }
  get backpressured(): boolean { return this.#bufferedAudioMs >= this.highWatermarkMs; }
  get canResume(): boolean { return this.#bufferedAudioMs <= this.lowWatermarkMs; }
  get lastAcceptedSequence(): number { return this.#lastAcceptedSequence; }
  get lastAcknowledgedSequence(): number { return this.#lastAcknowledgedSequence; }

  enqueue(chunk: DesktopStreamingVoiceAudioChunk): StreamingAudioQueueResult {
    if (this.#terminal) return { accepted: false, bufferedAudioMs: this.#bufferedAudioMs, reason: "terminal" };
    if (!Number.isInteger(chunk.sequence) || chunk.sequence < 0) {
      return { accepted: false, bufferedAudioMs: this.#bufferedAudioMs, reason: "out_of_order" };
    }
    if (chunk.sequence === this.#lastAcceptedSequence || chunk.sequence <= this.#lastAcknowledgedSequence) {
      return { accepted: false, bufferedAudioMs: this.#bufferedAudioMs, reason: "duplicate" };
    }
    if (this.#lastAcceptedSequence >= 0 && chunk.sequence !== this.#lastAcceptedSequence + 1) {
      return { accepted: false, bufferedAudioMs: this.#bufferedAudioMs, reason: "out_of_order" };
    }
    if (this.backpressured) {
      return { accepted: false, bufferedAudioMs: this.#bufferedAudioMs, reason: "backpressure" };
    }
    if (!Number.isFinite(chunk.durationMs) || chunk.durationMs <= 0 || this.#bufferedAudioMs + chunk.durationMs > this.maxBufferedAudioMs) {
      return { accepted: false, bufferedAudioMs: this.#bufferedAudioMs, reason: "backpressure" };
    }
    this.#chunks.push(chunk);
    this.#bufferedAudioMs += chunk.durationMs;
    this.#lastAcceptedSequence = chunk.sequence;
    return { accepted: true, bufferedAudioMs: this.#bufferedAudioMs };
  }

  peek(): DesktopStreamingVoiceAudioChunk | undefined { return this.#chunks[0]; }

  acknowledge(sequence: number): { acknowledged: number; bufferedAudioMs: number } {
    if (!Number.isInteger(sequence) || sequence <= this.#lastAcknowledgedSequence) {
      return { acknowledged: this.#lastAcknowledgedSequence, bufferedAudioMs: this.#bufferedAudioMs };
    }
    let acknowledged = this.#lastAcknowledgedSequence;
    while (this.#chunks.length && this.#chunks[0].sequence <= sequence) {
      const chunk = this.#chunks.shift();
      if (!chunk) break;
      this.#bufferedAudioMs = Math.max(0, this.#bufferedAudioMs - chunk.durationMs);
      acknowledged = chunk.sequence;
    }
    this.#lastAcknowledgedSequence = Math.max(this.#lastAcknowledgedSequence, acknowledged);
    return { acknowledged: this.#lastAcknowledgedSequence, bufferedAudioMs: this.#bufferedAudioMs };
  }

  close(): void { this.#terminal = true; }

  clear(): void {
    this.#chunks = [];
    this.#bufferedAudioMs = 0;
    this.#terminal = true;
  }
}
