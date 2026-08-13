import type { DesktopDuplexVoiceAudioDelta } from "../../../../api/desktopApi";

export interface DuplexPlaybackSink {
  readonly clockSeconds: number;
  readonly state: "running" | "suspended" | "closed";
  resume(): Promise<void>;
  schedule(delta: DesktopDuplexVoiceAudioDelta, startAtSeconds: number): number;
  stop(): void;
  close(): Promise<void>;
}

export interface DuplexPlaybackSnapshot {
  responseId: string | null;
  bufferedAudioMs: number;
  playedAudioMs: number;
  started: boolean;
  underruns: number;
  dropped: number;
}

export class DuplexPlaybackController {
  readonly #sink: DuplexPlaybackSink;
  readonly #startWatermarkMs: number;
  readonly #highWatermarkMs: number;
  readonly #queue = new Map<number, DesktopDuplexVoiceAudioDelta>();
  readonly #seen = new Set<number>();
  #responseId: string | null = null;
  #nextSequence = 0;
  #nextStartSeconds = 0;
  #firstStartSeconds = 0;
  #scheduledDurationMs = 0;
  #started = false;
  #cancelled = new Set<string>();
  #underruns = 0;
  #dropped = 0;

  constructor(sink: DuplexPlaybackSink, options: { startWatermarkMs?: number; highWatermarkMs?: number } = {}) {
    this.#sink = sink;
    this.#startWatermarkMs = options.startWatermarkMs ?? 80;
    this.#highWatermarkMs = options.highWatermarkMs ?? 1_000;
  }

  beginResponse(responseId: string): void {
    if (this.#responseId === responseId) return;
    this.stop();
    this.#responseId = responseId;
  }

  enqueue(delta: DesktopDuplexVoiceAudioDelta): boolean {
    if (delta.responseId !== this.#responseId || this.#cancelled.has(delta.responseId)) { this.#dropped += 1; return false; }
    if (delta.encoding !== "pcm_s16le" || delta.channels !== 1 || !Number.isInteger(delta.sampleRateHz) || delta.sampleRateHz <= 0 || delta.audioData.byteLength === 0 || delta.audioData.byteLength % 2 !== 0) throw new Error("Invalid realtime PCM audio delta.");
    if (this.#seen.has(delta.sequence)) return false;
    const durationMs = delta.audioData.byteLength / 2 / delta.sampleRateHz * 1_000;
    if (this.bufferedAudioMs + durationMs > this.#highWatermarkMs) { this.#dropped += 1; return false; }
    this.#seen.add(delta.sequence); this.#queue.set(delta.sequence, delta);
    if (this.#seen.size === 1 || !this.#started) this.#nextSequence = Math.min(this.#nextSequence || delta.sequence, delta.sequence);
    this.#pump(); return true;
  }

  async recover(): Promise<boolean> {
    if (this.#sink.state === "closed") return false;
    if (this.#sink.state === "suspended") await this.#sink.resume();
    this.#pump(); return this.#sink.state === "running";
  }

  finishResponse(responseId: string): void { if (responseId === this.#responseId) this.#pump(true); }

  cancelResponse(responseId: string): number {
    const played = responseId === this.#responseId ? this.playedAudioMs : 0;
    this.#cancelled.add(responseId);
    if (responseId === this.#responseId) this.stop();
    return played;
  }

  stop(): void {
    this.#sink.stop(); this.#queue.clear(); this.#seen.clear(); this.#responseId = null;
    this.#nextSequence = 0; this.#nextStartSeconds = 0; this.#firstStartSeconds = 0; this.#scheduledDurationMs = 0; this.#started = false;
  }

  async dispose(): Promise<void> { this.stop(); await this.#sink.close(); }
  get playedAudioMs(): number { return !this.#started ? 0 : Math.max(0, Math.min(this.#scheduledDurationMs, (this.#sink.clockSeconds - this.#firstStartSeconds) * 1_000)); }
  get bufferedAudioMs(): number {
    let queued = 0; for (const delta of this.#queue.values()) queued += delta.audioData.byteLength / 2 / delta.sampleRateHz * 1_000;
    return queued + Math.max(0, this.#scheduledDurationMs - this.playedAudioMs);
  }
  get snapshot(): DuplexPlaybackSnapshot { return { responseId: this.#responseId, bufferedAudioMs: this.bufferedAudioMs, playedAudioMs: this.playedAudioMs, started: this.#started, underruns: this.#underruns, dropped: this.#dropped }; }

  #pump(force = false): void {
    if (this.#sink.state !== "running") return;
    if (!force && !this.#started && this.bufferedAudioMs < this.#startWatermarkMs) return;
    let scheduled = false;
    while (this.#queue.has(this.#nextSequence)) {
      const delta = this.#queue.get(this.#nextSequence)!; this.#queue.delete(this.#nextSequence);
      const start = Math.max(this.#sink.clockSeconds + 0.01, this.#nextStartSeconds);
      if (!this.#started) { this.#started = true; this.#firstStartSeconds = start; }
      const durationSeconds = this.#sink.schedule(delta, start);
      this.#scheduledDurationMs += durationSeconds * 1_000; this.#nextStartSeconds = start + durationSeconds; this.#nextSequence += 1; scheduled = true;
    }
    if (this.#started && !scheduled && this.#nextStartSeconds < this.#sink.clockSeconds) this.#underruns += 1;
  }
}
