import type { DesktopDuplexVoiceAudioDelta } from "../../../../api/desktopApi";
import type { DuplexPlaybackSchedule, DuplexPlaybackSink, DuplexPlaybackSourceEnd } from "./playbackController";

export class BrowserPcmPlaybackSink implements DuplexPlaybackSink {
  readonly #context: AudioContext;
  readonly #gain: GainNode;
  readonly #sources = new Map<AudioBufferSourceNode, { ended: boolean; onEnded: (event: DuplexPlaybackSourceEnd) => void }>();
  #sinkId = "";
  constructor(context = new AudioContext({ latencyHint: "interactive", sampleRate: 24_000 })) { this.#context = context; this.#gain = context.createGain(); this.#gain.gain.value = 1; this.#gain.connect(context.destination); }
  get clockSeconds(): number { return this.#context.currentTime; }
  get baseLatencySeconds(): number { return Number.isFinite(this.#context.baseLatency) ? this.#context.baseLatency : 0; }
  get outputLatencySeconds(): number { const latency = (this.#context as AudioContext & { outputLatency?: number }).outputLatency; return typeof latency === "number" && Number.isFinite(latency) ? latency : 0; }
  get sinkId(): string { return this.#sinkId; }
  get supportsSinkSelection(): boolean { return typeof (this.#context as AudioContext & { setSinkId?: unknown }).setSinkId === "function"; }
  get state(): "running" | "suspended" | "closed" { return this.#context.state === "running" || this.#context.state === "closed" ? this.#context.state : "suspended"; }
  async resume(): Promise<void> { await this.#context.resume(); }
  async setSinkId(sinkId: string): Promise<void> { const context = this.#context as AudioContext & { setSinkId?: (id: string) => Promise<void> }; if (!context.setSinkId) { if (sinkId) throw new Error("Output device selection is unavailable on this platform."); this.#sinkId = ""; return; } await context.setSinkId(sinkId); this.#sinkId = sinkId; }
  setGain(value: number, rampMs: number): void { const now = this.#context.currentTime; const gain = this.#gain.gain; const target = Math.max(0, Math.min(1, value)); gain.cancelScheduledValues(now); gain.setValueAtTime(gain.value, now); if (rampMs > 0) gain.linearRampToValueAtTime(target, now + rampMs / 1_000); else gain.setValueAtTime(target, now); }
  schedule(delta: DesktopDuplexVoiceAudioDelta, startAtSeconds: number, onEnded: (event: DuplexPlaybackSourceEnd) => void): DuplexPlaybackSchedule {
    const samples = delta.audioData.byteLength / 2;
    const buffer = this.#context.createBuffer(1, samples, delta.sampleRateHz);
    const channel = buffer.getChannelData(0); const view = new DataView(delta.audioData.buffer, delta.audioData.byteOffset, delta.audioData.byteLength);
    for (let index = 0; index < samples; index += 1) channel[index] = view.getInt16(index * 2, true) / 32_768;
    const source = this.#context.createBufferSource(); source.buffer = buffer; source.connect(this.#gain);
    const state = { ended: false, onEnded }; this.#sources.set(source, state);
    source.onended = () => { if (state.ended) return; state.ended = true; source.disconnect(); this.#sources.delete(source); onEnded({ endedAtSeconds: this.#context.currentTime, cancelled: false }); };
    const scheduledAtSeconds = this.#context.currentTime; source.start(startAtSeconds); return { durationSeconds: buffer.duration, scheduledAtSeconds, startAtSeconds, endAtSeconds: startAtSeconds + buffer.duration };
  }
  stop(): void { for (const [source, state] of this.#sources) { if (!state.ended) { state.ended = true; state.onEnded({ endedAtSeconds: this.#context.currentTime, cancelled: true }); } try { source.stop(); } catch {} source.disconnect(); } this.#sources.clear(); }
  async close(): Promise<void> { this.stop(); this.#gain.disconnect(); if (this.#context.state !== "closed") await this.#context.close(); }
}
