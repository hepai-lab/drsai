import type { DesktopDuplexVoiceAudioDelta, DesktopDuplexVoicePlaybackAck } from "../../../../api/desktopApi";
import { DuplexAdaptiveJitterBuffer } from "./adaptiveJitterBuffer";

export interface DuplexPlaybackSourceEnd { endedAtSeconds: number; cancelled: boolean }
export interface DuplexPlaybackSchedule { durationSeconds: number; scheduledAtSeconds: number; startAtSeconds: number; endAtSeconds: number }

export interface DuplexPlaybackSink {
  readonly clockSeconds: number;
  readonly baseLatencySeconds: number;
  readonly outputLatencySeconds: number;
  readonly sinkId: string;
  readonly supportsSinkSelection: boolean;
  readonly state: "running" | "suspended" | "closed";
  resume(): Promise<void>;
  setSinkId(sinkId: string): Promise<void>;
  setGain(value: number, rampMs: number): void;
  schedule(delta: DesktopDuplexVoiceAudioDelta, startAtSeconds: number, onEnded: (event: DuplexPlaybackSourceEnd) => void): DuplexPlaybackSchedule;
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
  gaps: number;
  jitterBufferTargetMs: number;
  jitterMs: number;
  networkQuality: "stable" | "variable" | "poor";
  sinkId: string;
  volume: number;
  ducked: boolean;
  outputState: "running" | "suspended" | "closed";
  outputReferenceLevel: number;
}

export interface DuplexPlaybackGap { responseId: string; fromSequence: number; toSequence: number }
export interface DuplexPlaybackTimelineEntry { responseId: string; sequence: number; scheduledAtSeconds: number; startAtSeconds: number; endAtSeconds: number; endedAtSeconds: number | null; cancelledAtSeconds: number | null; status: "scheduled" | "playing" | "ended" | "cancelled" }

export class DuplexPlaybackController {
  readonly #sink: DuplexPlaybackSink;
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
  #gaps = 0; #finalSequence: number | null = null; #gapTimer: ReturnType<typeof setTimeout> | null = null;
  #receivedSequence = -1; #scheduledSequence = -1; #playedSequence = -1;
  #receivedAudioMs = 0; #scheduledAudioMs = 0; #playedAudioMsBase = 0;
  #responseSequenceKnown = false;
  #scheduledFrames: Array<{ sequence: number; endSeconds: number; durationMs: number }> = [];
  readonly #gapTimeoutMs: number; readonly #maxReorderFrames: number;
  readonly #scheduleTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly #cancelTimer: (timer: ReturnType<typeof setTimeout>) => void; readonly #onGap?: (gap: DuplexPlaybackGap) => void;
  readonly #jitter: DuplexAdaptiveJitterBuffer; readonly #nowMs: () => number; readonly #timeline: DuplexPlaybackTimelineEntry[] = [];
  #lastUnderrunSequence = -1;
  #playedAudioMsFloor = 0;
  #volume = 1; #ducked = false;
  #outputReferenceLevel = 0;

  constructor(sink: DuplexPlaybackSink, options: { startWatermarkMs?: number; highWatermarkMs?: number; gapTimeoutMs?: number; maxReorderFrames?: number; schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>; cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void; onGap?: (gap: DuplexPlaybackGap) => void; nowMs?: () => number; jitterBuffer?: DuplexAdaptiveJitterBuffer } = {}) {
    this.#sink = sink;
    this.#highWatermarkMs = options.highWatermarkMs ?? 1_000;
    this.#gapTimeoutMs = options.gapTimeoutMs ?? 120; this.#maxReorderFrames = options.maxReorderFrames ?? 32;
    this.#scheduleTimer = options.schedule ?? setTimeout; this.#cancelTimer = options.cancelSchedule ?? clearTimeout; this.#onGap = options.onGap;
    this.#jitter = options.jitterBuffer ?? new DuplexAdaptiveJitterBuffer({ initialMs: options.startWatermarkMs ?? 80 }); this.#nowMs = options.nowMs ?? (() => performance.now());
  }

  beginResponse(responseId: string, firstAudioSequence?: number): void {
    if (this.#responseId === responseId) return;
    this.stop();
    this.#responseId = responseId; this.#responseSequenceKnown = firstAudioSequence !== undefined; this.#nextSequence = firstAudioSequence ?? 0; this.#jitter.resetResponse();
  }

  enqueue(delta: DesktopDuplexVoiceAudioDelta): boolean {
    if (delta.responseId !== this.#responseId || this.#cancelled.has(delta.responseId)) { this.#dropped += 1; return false; }
    if (delta.encoding !== "pcm_s16le" || delta.channels !== 1 || !Number.isInteger(delta.sampleRateHz) || delta.sampleRateHz <= 0 || delta.audioData.byteLength === 0 || delta.audioData.byteLength % 2 !== 0) throw new Error("Invalid realtime PCM audio delta.");
    if (this.#seen.has(delta.sequence)) return false;
    const durationMs = delta.audioData.byteLength / 2 / delta.sampleRateHz * 1_000;
    this.#outputReferenceLevel = pcm16Level(delta.audioData);
    if (this.bufferedAudioMs + durationMs > this.#highWatermarkMs) { this.#dropped += 1; return false; }
    this.#jitter.observeArrival(Number.isFinite(delta.providerReceivedAtMs) ? delta.providerReceivedAtMs : this.#nowMs(), durationMs); this.#seen.add(delta.sequence); this.#queue.set(delta.sequence, delta); this.#receivedSequence = Math.max(this.#receivedSequence, delta.sequence); this.#receivedAudioMs += durationMs;
    if (!this.#responseSequenceKnown && !this.#started) this.#nextSequence = this.#seen.size === 1 ? delta.sequence : Math.min(this.#nextSequence, delta.sequence);
    this.#pump(); this.#armGapTimer(); return true;
  }

  async recover(): Promise<boolean> {
    if (this.#sink.state === "closed") return false;
    try { if (this.#sink.state === "suspended") await this.#sink.resume(); this.#pump(); return this.#sink.state === "running"; }
    catch { return false; }
  }

  async switchOutputDevice(sinkId: string): Promise<boolean> { try { await this.#sink.setSinkId(sinkId); return true; } catch { return false; } }
  setVolume(value: number, rampMs = 80): void { if (!Number.isFinite(value)) return; this.#volume = Math.max(0, Math.min(1, value)); this.#sink.setGain(this.#ducked ? this.#volume * 0.25 : this.#volume, rampMs); }
  duck(level = 0.25, rampMs = 100): void { if (this.#ducked) return; this.#ducked = true; this.#sink.setGain(this.#volume * Math.max(0, Math.min(1, level)), rampMs); }
  restoreVolume(rampMs = 100): void { if (!this.#ducked) return; this.#ducked = false; this.#sink.setGain(this.#volume, rampMs); }

  finishResponse(responseId: string, finalSequence: number): void { if (responseId === this.#responseId) { this.#finalSequence = finalSequence; this.#pump(true); this.#armGapTimer(); } }

  cancelResponse(responseId: string): number {
    const played = responseId === this.#responseId ? this.playedAudioMs : 0;
    this.#cancelled.add(responseId);
    if (responseId === this.#responseId) this.stop();
    return played;
  }

  stop(): void {
    this.#updatePlayedCursor(); this.#playedAudioMsBase += this.playedAudioMs;
    this.#playedSequence = Math.max(this.#playedSequence, this.#scheduledSequence);
    if (this.#gapTimer !== null) this.#cancelTimer(this.#gapTimer); this.#gapTimer = null;
    this.#sink.stop(); this.#queue.clear(); this.#seen.clear(); this.#responseId = null;
    this.#outputReferenceLevel = 0;
    this.#ducked = false; this.#sink.setGain(this.#volume, 0);
    this.#nextSequence = 0; this.#nextStartSeconds = 0; this.#firstStartSeconds = 0; this.#scheduledDurationMs = 0; this.#started = false; this.#finalSequence = null; this.#scheduledFrames = []; this.#responseSequenceKnown = false; this.#playedAudioMsFloor = 0;
  }

  async dispose(): Promise<void> { this.stop(); await this.#sink.close(); }
  get playedAudioMs(): number { if (!this.#started) return 0; const measured = Math.max(0, Math.min(this.#scheduledDurationMs, (this.#audibleClockSeconds - this.#firstStartSeconds) * 1_000)); this.#playedAudioMsFloor = Math.max(this.#playedAudioMsFloor, measured); return this.#playedAudioMsFloor; }
  get bufferedAudioMs(): number {
    let queued = 0; for (const delta of this.#queue.values()) queued += delta.audioData.byteLength / 2 / delta.sampleRateHz * 1_000;
    return queued + Math.max(0, this.#scheduledDurationMs - this.playedAudioMs);
  }
  get snapshot(): DuplexPlaybackSnapshot { const jitter = this.#jitter.snapshot; return { responseId: this.#responseId, bufferedAudioMs: this.bufferedAudioMs, playedAudioMs: this.playedAudioMs, started: this.#started, underruns: this.#underruns, dropped: this.#dropped, gaps: this.#gaps, jitterBufferTargetMs: jitter.targetMs, jitterMs: jitter.jitterMs, networkQuality: jitter.targetMs >= 240 ? "poor" : jitter.targetMs >= 120 ? "variable" : "stable", sinkId: this.#sink.sinkId, volume: this.#volume, ducked: this.#ducked, outputState: this.#sink.state, outputReferenceLevel: this.#outputReferenceLevel }; }
  get timeline(): readonly DuplexPlaybackTimelineEntry[] { this.#refreshTimeline(); return this.#timeline.map((entry) => Object.freeze({ ...entry })); }
  acknowledgement(sessionId: string): DesktopDuplexVoicePlaybackAck { this.#updatePlayedCursor(); return { protocolVersion: 2, sessionId, receivedSequence: this.#receivedSequence, scheduledSequence: this.#scheduledSequence, playedSequence: this.#playedSequence, receivedAudioMs: this.#receivedAudioMs, scheduledAudioMs: this.#scheduledAudioMs, playedAudioMs: this.#playedAudioMsBase + this.playedAudioMs }; }

  #pump(force = false): void {
    if (this.#sink.state !== "running") return;
    if (!force && !this.#started && this.bufferedAudioMs < this.#jitter.snapshot.targetMs) return;
    let scheduled = false;
    while (this.#queue.has(this.#nextSequence)) {
      const delta = this.#queue.get(this.#nextSequence)!; this.#queue.delete(this.#nextSequence);
      const start = Math.max(this.#sink.clockSeconds + 0.01, this.#nextStartSeconds);
      if (!this.#started) { this.#started = true; this.#firstStartSeconds = start; }
      const source = this.#sink.schedule(delta, start, (event) => this.#endTimelineSource(delta.sequence, event)); const durationSeconds = source.durationSeconds;
      this.#scheduledDurationMs += durationSeconds * 1_000; this.#nextStartSeconds = source.endAtSeconds; this.#nextSequence += 1; scheduled = true;
      this.#scheduledSequence = Math.max(this.#scheduledSequence, delta.sequence); this.#scheduledAudioMs += durationSeconds * 1_000; this.#scheduledFrames.push({ sequence: delta.sequence, endSeconds: source.endAtSeconds, durationMs: durationSeconds * 1_000 });
      this.#timeline.push({ responseId: delta.responseId, sequence: delta.sequence, scheduledAtSeconds: source.scheduledAtSeconds, startAtSeconds: source.startAtSeconds, endAtSeconds: source.endAtSeconds, endedAtSeconds: null, cancelledAtSeconds: null, status: "scheduled" }); if (this.#timeline.length > 2_048) this.#timeline.splice(0, this.#timeline.length - 2_048);
    }
    if (this.#started && !scheduled && this.#nextStartSeconds < this.#sink.clockSeconds && this.#lastUnderrunSequence !== this.#nextSequence) { this.#lastUnderrunSequence = this.#nextSequence; this.#underruns += 1; this.#jitter.observeUnderrun(); }
    if (!this.#queue.size || this.#queue.has(this.#nextSequence)) this.#clearGapTimer();
  }

  #armGapTimer(): void {
    if (!this.#responseId || this.#gapTimer !== null || this.#queue.has(this.#nextSequence)) return;
    const candidates = [...this.#queue.keys()].filter((sequence) => sequence > this.#nextSequence);
    const target = candidates.length ? Math.min(...candidates) : this.#finalSequence !== null && this.#nextSequence <= this.#finalSequence ? this.#finalSequence + 1 : null;
    if (target === null) return;
    if (candidates.length >= this.#maxReorderFrames) { this.#skipGap(target); return; }
    this.#gapTimer = this.#scheduleTimer(() => { this.#gapTimer = null; this.#skipGap(target); }, this.#gapTimeoutMs);
  }
  #skipGap(target: number): void {
    if (!this.#responseId || target <= this.#nextSequence) return;
    const gap = { responseId: this.#responseId, fromSequence: this.#nextSequence, toSequence: target - 1 }; this.#gaps += 1; this.#dropped += target - this.#nextSequence; this.#nextSequence = target; this.#onGap?.(gap); this.#pump(true); this.#armGapTimer();
  }
  #updatePlayedCursor(): void { this.#refreshTimeline(); for (const frame of this.#scheduledFrames) if (frame.endSeconds <= this.#audibleClockSeconds) this.#playedSequence = Math.max(this.#playedSequence, frame.sequence); }
  #endTimelineSource(sequence: number, event: DuplexPlaybackSourceEnd): void { const entry = this.#timeline.findLast((item) => item.sequence === sequence); if (!entry) return; if (event.cancelled) { entry.cancelledAtSeconds = event.endedAtSeconds; entry.status = "cancelled"; } else entry.endedAtSeconds = event.endedAtSeconds; }
  #refreshTimeline(): void { const audible = this.#audibleClockSeconds; for (const entry of this.#timeline) { if (entry.status === "cancelled") continue; if (audible >= entry.endAtSeconds) entry.status = "ended"; else if (audible >= entry.startAtSeconds) entry.status = "playing"; else entry.status = "scheduled"; } }
  get #audibleClockSeconds(): number { return Math.max(0, this.#sink.clockSeconds - Math.max(0, this.#sink.baseLatencySeconds) - Math.max(0, this.#sink.outputLatencySeconds)); }
  #clearGapTimer(): void { if (this.#gapTimer !== null) this.#cancelTimer(this.#gapTimer); this.#gapTimer = null; }
}

function pcm16Level(audio: Uint8Array): number { const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength); let squares = 0; const samples = audio.byteLength / 2; for (let index = 0; index < samples; index += 1) { const value = view.getInt16(index * 2, true) / 32768; squares += value * value; } return samples ? Math.sqrt(squares / samples) : 0; }
