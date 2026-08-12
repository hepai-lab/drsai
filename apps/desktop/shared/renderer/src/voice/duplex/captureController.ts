import type { DesktopDuplexVoiceAudioChunk } from "../../../../api/desktopApi";
import { DuplexLocalVad, type DuplexVadSignal } from "./localVad";
import { DuplexLinearResampler, DuplexPcmBatcher, floatToPcm16, mixToMono } from "./pcm";

export type DuplexCaptureState = "idle" | "requesting_permission" | "active" | "recovering" | "failed" | "disposed";
export interface DuplexCaptureConstraintReport { requestedDeviceId: string; actualDeviceId?: string; sampleRate?: number; channelCount?: number; echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean }
export interface DuplexCaptureEnvironment {
  mediaDevices: Pick<MediaDevices, "getUserMedia" | "enumerateDevices" | "addEventListener" | "removeEventListener">;
  createAudioContext: () => AudioContext;
  createWorkletNode: (context: AudioContext, name: string, options: AudioWorkletNodeOptions) => AudioWorkletNode;
  now: () => number;
  workletModuleUrl: string;
}
export interface DuplexCaptureOptions {
  sessionId: string; deviceId?: string; targetSampleRateHz?: number;
  onChunk: (chunk: DesktopDuplexVoiceAudioChunk) => boolean;
  onState: (state: DuplexCaptureState) => void; onError: (error: Error) => void;
  onDevices?: (devices: MediaDeviceInfo[]) => void; onConstraints?: (report: DuplexCaptureConstraintReport) => void;
  onVadSignal?: (signal: DuplexVadSignal) => void; onRecoveryRequired?: (reason: "device_lost" | "sleep" | "audio_context") => void;
}

export class DuplexCaptureController {
  readonly environment: DuplexCaptureEnvironment; readonly options: DuplexCaptureOptions;
  state: DuplexCaptureState = "idle";
  #context: AudioContext | null = null; #stream: MediaStream | null = null; #source: MediaStreamAudioSourceNode | null = null;
  #worklet: AudioWorkletNode | null = null; #silentGain: GainNode | null = null; #resampler: DuplexLinearResampler | null = null;
  #batcher: DuplexPcmBatcher; #vad = new DuplexLocalVad(); #generation = 0; #startedAt = 0; #disposed = false;
  #deviceChange = (): void => { void this.#refreshDevices(true); };

  constructor(environment: DuplexCaptureEnvironment, options: DuplexCaptureOptions) {
    this.environment = environment; this.options = options; this.#batcher = new DuplexPcmBatcher(options.targetSampleRateHz ?? 24_000, 40);
    environment.mediaDevices.addEventListener?.("devicechange", this.#deviceChange);
  }

  async startFromUserGesture(): Promise<boolean> {
    if (this.#disposed || this.state === "requesting_permission" || this.state === "active") return false;
    const generation = ++this.#generation; this.#setState("requesting_permission");
    try {
      const constraints = createDuplexAudioConstraints(this.options.deviceId ?? "", this.#batcher.sampleRateHz);
      const stream = await this.environment.mediaDevices.getUserMedia(constraints);
      if (!this.#current(generation)) { stopStream(stream); return false; }
      const context = this.environment.createAudioContext();
      await context.audioWorklet.addModule(this.environment.workletModuleUrl);
      if (!this.#current(generation)) { stopStream(stream); await context.close(); return false; }
      await context.resume();
      this.#stream = stream; this.#context = context; this.#resampler = new DuplexLinearResampler(context.sampleRate, this.#batcher.sampleRateHz);
      this.#source = context.createMediaStreamSource(stream);
      this.#worklet = this.environment.createWorkletNode(context, "opendrsai-duplex-pcm-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.#silentGain = context.createGain(); this.#silentGain.gain.value = 0;
      this.#worklet.port.onmessage = (event: MessageEvent<{ type: string; channels: Float32Array[] }>) => this.#onAudio(event.data);
      for (const track of stream.getAudioTracks()) track.addEventListener("ended", () => { if (this.#current(generation)) void this.#failForRecovery("device_lost", new Error("The active microphone disconnected.")); }, { once: true });
      this.#startedAt = this.environment.now(); this.#reportConstraints(stream); await this.#refreshDevices(false);
      this.#source.connect(this.#worklet).connect(this.#silentGain).connect(context.destination);
      this.#setState("active"); return true;
    } catch (error) { if (this.#current(generation)) await this.#fail(error); return false; }
  }

  async handleLifecycle(kind: "sleep" | "resume" | "hidden" | "visible"): Promise<void> {
    if (this.state !== "active") return;
    if (kind === "sleep") { await this.#failForRecovery("sleep", new Error("Voice Session stopped while Windows entered sleep.")); return; }
    if (kind === "visible" || kind === "resume") {
      if (!this.#stream?.getAudioTracks().some((track) => track.readyState === "live")) { await this.#failForRecovery("device_lost", new Error("The microphone is no longer active.")); return; }
      if (this.#context?.state === "suspended") {
        try { await this.#context.resume(); } catch { await this.#failForRecovery("audio_context", new Error("Audio capture could not resume.")); }
      }
    }
  }

  async stop(flush = false): Promise<void> {
    if (this.#disposed) return; this.#generation += 1;
    if (flush) for (const batch of this.#batcher.flush()) this.#emit(batch);
    await this.#release(); this.#setState("idle");
  }
  async dispose(): Promise<void> { if (this.#disposed) return; this.#disposed = true; this.#generation += 1; this.environment.mediaDevices.removeEventListener?.("devicechange", this.#deviceChange); await this.#release(); this.#setState("disposed"); }

  #onAudio(data: { type: string; channels: Float32Array[] }): void {
    if (this.state !== "active" || data.type !== "audio" || !this.#resampler) return;
    try { for (const batch of this.#batcher.push(floatToPcm16(this.#resampler.push(mixToMono(data.channels))))) this.#emit(batch); }
    catch (error) { void this.#fail(error); }
  }
  #emit(batch: { sequence: number; durationMs: number; samples: Int16Array; audioData: Uint8Array }): void {
    const signal = this.#vad.observe(batch.samples, batch.durationMs); this.options.onVadSignal?.(signal);
    const accepted = this.options.onChunk({ protocolVersion: 1, sessionId: this.options.sessionId, sequence: batch.sequence, capturedAtMs: this.#startedAt + batch.sequence * this.#batcher.batchDurationMs, durationMs: batch.durationMs, encoding: "pcm_s16le", sampleRateHz: this.#batcher.sampleRateHz, channels: 1, audioData: batch.audioData });
    if (!accepted) void this.#fail(new Error("The Duplex audio channel rejected an input frame."));
  }
  async #refreshDevices(enforceActive: boolean): Promise<void> {
    const devices = (await this.environment.mediaDevices.enumerateDevices().catch(() => [])).filter((item) => item.kind === "audioinput"); this.options.onDevices?.(devices);
    if (!enforceActive || this.state !== "active") return;
    const actual = this.#stream?.getAudioTracks()[0]?.getSettings().deviceId;
    if (actual && !devices.some((device) => device.deviceId === actual)) await this.#failForRecovery("device_lost", new Error("The active microphone is no longer available."));
  }
  #reportConstraints(stream: MediaStream): void { const settings = stream.getAudioTracks()[0]?.getSettings() ?? {}; this.options.onConstraints?.({ requestedDeviceId: this.options.deviceId ?? "", actualDeviceId: settings.deviceId, sampleRate: settings.sampleRate, channelCount: settings.channelCount, echoCancellation: settings.echoCancellation, noiseSuppression: settings.noiseSuppression, autoGainControl: settings.autoGainControl }); }
  async #failForRecovery(reason: "device_lost" | "sleep" | "audio_context", error: Error): Promise<void> { this.#setState("recovering"); this.options.onRecoveryRequired?.(reason); await this.#release(); this.#setState("failed"); this.options.onError(error); }
  async #fail(error: unknown): Promise<void> { await this.#release(); this.#setState("failed"); this.options.onError(error instanceof Error ? error : new Error(String(error))); }
  async #release(): Promise<void> { if (this.#worklet) this.#worklet.port.onmessage = null; this.#source?.disconnect(); this.#worklet?.disconnect(); this.#silentGain?.disconnect(); stopStream(this.#stream); const context = this.#context; this.#stream = null; this.#context = null; this.#source = null; this.#worklet = null; this.#silentGain = null; this.#resampler?.reset(); this.#resampler = null; this.#batcher.reset(); this.#vad.reset(); if (context && context.state !== "closed") await context.close().catch(() => undefined); }
  #setState(state: DuplexCaptureState): void { this.state = state; this.options.onState(state); }
  #current(generation: number): boolean { return !this.#disposed && this.#generation === generation; }
}

export function createDuplexAudioConstraints(deviceId: string, sampleRateHz: number): MediaStreamConstraints { return { audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: { ideal: 1 }, sampleRate: { ideal: sampleRateHz }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }; }
function stopStream(stream: MediaStream | null): void { for (const track of stream?.getTracks() ?? []) track.stop(); }
