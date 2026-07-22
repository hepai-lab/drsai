import type { DesktopStreamingVoiceTtsAudioSegment } from "@shared/desktopApi";

export type StreamingPlaybackPhase = "idle" | "buffering" | "playing" | "paused" | "draining" | "completed" | "failed" | "cancelled";
export interface StreamingAudioPlaybackHandle { pause(): void; resume(): void; stop(): void; }
export interface StreamingAudioPlaybackAdapter {
  prepare?(segment: DesktopStreamingVoiceTtsAudioSegment): void;
  release?(segment: DesktopStreamingVoiceTtsAudioSegment): void;
  play(segment: DesktopStreamingVoiceTtsAudioSegment, onEnded: () => void, onError: (error: Error) => void): StreamingAudioPlaybackHandle;
}

export class OrderedStreamingAudioPlaybackQueue {
  readonly adapter: StreamingAudioPlaybackAdapter;
  readonly maxBufferedSegments: number;
  readonly onPhase: (phase: StreamingPlaybackPhase) => void;
  readonly onGap: (gapMs: number, previousIndex: number, nextIndex: number) => void;
  readonly now: () => number;
  #segments = new Map<number, DesktopStreamingVoiceTtsAudioSegment>();
  #nextIndex = 0;
  #finalIndex: number | null = null;
  #phase: StreamingPlaybackPhase = "idle";
  #handle: StreamingAudioPlaybackHandle | null = null;
  #played = new Set<number>();
  #lastEndedAt: number | null = null;
  #lastEndedIndex: number | null = null;

  constructor(adapter: StreamingAudioPlaybackAdapter, options: { maxBufferedSegments?: number; onPhase?: (phase: StreamingPlaybackPhase) => void; onGap?: (gapMs: number, previousIndex: number, nextIndex: number) => void; now?: () => number } = {}) {
    this.adapter = adapter;
    this.maxBufferedSegments = options.maxBufferedSegments ?? 8;
    this.onPhase = options.onPhase ?? (() => {});
    this.onGap = options.onGap ?? (() => {});
    this.now = options.now ?? (() => performance.now());
    if (!Number.isInteger(this.maxBufferedSegments) || this.maxBufferedSegments <= 0) throw new Error("maxBufferedSegments must be positive.");
  }

  get phase(): StreamingPlaybackPhase { return this.#phase; }
  get nextIndex(): number { return this.#nextIndex; }
  get bufferedCount(): number { return this.#segments.size; }
  get playedIndexes(): number[] { return [...this.#played].sort((a, b) => a - b); }

  enqueue(segment: DesktopStreamingVoiceTtsAudioSegment): boolean {
    if (["completed", "failed", "cancelled"].includes(this.#phase) || segment.segmentIndex < this.#nextIndex || this.#segments.has(segment.segmentIndex)) return false;
    if (this.#segments.size >= this.maxBufferedSegments) return false;
    this.adapter.prepare?.(segment);
    this.#segments.set(segment.segmentIndex, segment);
    if (!this.#handle && this.#phase !== "paused") this.#playNext();
    return true;
  }

  finish(finalIndex: number): void {
    if (!Number.isInteger(finalIndex) || finalIndex < -1) throw new Error("finalIndex is invalid.");
    this.#finalIndex = finalIndex;
    if (finalIndex === -1) this.#setPhase("completed");
    else if (!this.#handle) this.#playNext();
  }

  pause(): boolean {
    if (this.#phase !== "playing" || !this.#handle) return false;
    this.#handle.pause(); this.#setPhase("paused"); return true;
  }
  resume(): boolean {
    if (this.#phase !== "paused" || !this.#handle) return false;
    this.#handle.resume(); this.#setPhase("playing"); return true;
  }
  stop(): void {
    this.#handle?.stop(); this.#handle = null; this.#releaseBuffered(); this.#setPhase("cancelled");
  }

  #playNext(): void {
    if (this.#finalIndex !== null && this.#nextIndex > this.#finalIndex) { this.#setPhase("completed"); return; }
    const segment = this.#segments.get(this.#nextIndex);
    if (!segment) { this.#setPhase(this.#finalIndex === null ? "buffering" : "draining"); return; }
    this.#segments.delete(this.#nextIndex);
    const playingIndex = this.#nextIndex;
    if (this.#lastEndedAt !== null && this.#lastEndedIndex !== null) {
      this.onGap(Math.max(0, this.now() - this.#lastEndedAt), this.#lastEndedIndex, playingIndex);
      this.#lastEndedAt = null;
      this.#lastEndedIndex = null;
    }
    this.#setPhase("playing");
    let ready = false;
    let syncEnd = false;
    let syncError = false;
    const ended = (): void => {
      if (!ready) { syncEnd = true; return; }
      if (this.#phase === "cancelled") return;
      this.#handle = null;
      this.#played.add(playingIndex);
      this.#lastEndedAt = this.now();
      this.#lastEndedIndex = playingIndex;
      this.#nextIndex = playingIndex + 1;
      this.#playNext();
    };
    const failed = (): void => {
      if (!ready) { syncError = true; return; }
      this.#handle = null; this.#releaseBuffered(); this.#setPhase("failed");
    };
    this.#handle = this.adapter.play(segment, ended, failed);
    ready = true;
    if (syncError) queueMicrotask(failed);
    else if (syncEnd) queueMicrotask(ended);
  }

  #setPhase(phase: StreamingPlaybackPhase): void { if (this.#phase !== phase) { this.#phase = phase; this.onPhase(phase); } }
  #releaseBuffered(): void {
    for (const segment of this.#segments.values()) this.adapter.release?.(segment);
    this.#segments.clear();
  }
}
