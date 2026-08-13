import type { DesktopDuplexVoiceAudioDelta } from "../../../../api/desktopApi";
import type { DuplexPlaybackSink } from "./playbackController";

export class BrowserPcmPlaybackSink implements DuplexPlaybackSink {
  readonly #context: AudioContext;
  readonly #sources = new Set<AudioBufferSourceNode>();
  constructor(context = new AudioContext({ latencyHint: "interactive", sampleRate: 24_000 })) { this.#context = context; }
  get clockSeconds(): number { return this.#context.currentTime; }
  get state(): "running" | "suspended" | "closed" { return this.#context.state === "running" || this.#context.state === "closed" ? this.#context.state : "suspended"; }
  async resume(): Promise<void> { await this.#context.resume(); }
  schedule(delta: DesktopDuplexVoiceAudioDelta, startAtSeconds: number): number {
    const samples = delta.audioData.byteLength / 2;
    const buffer = this.#context.createBuffer(1, samples, delta.sampleRateHz);
    const channel = buffer.getChannelData(0); const view = new DataView(delta.audioData.buffer, delta.audioData.byteOffset, delta.audioData.byteLength);
    for (let index = 0; index < samples; index += 1) channel[index] = view.getInt16(index * 2, true) / 32_768;
    const source = this.#context.createBufferSource(); source.buffer = buffer; source.connect(this.#context.destination);
    source.onended = () => { source.disconnect(); this.#sources.delete(source); };
    this.#sources.add(source); source.start(startAtSeconds); return buffer.duration;
  }
  stop(): void { for (const source of this.#sources) { try { source.stop(); } catch {} source.disconnect(); } this.#sources.clear(); }
  async close(): Promise<void> { this.stop(); if (this.#context.state !== "closed") await this.#context.close(); }
}
