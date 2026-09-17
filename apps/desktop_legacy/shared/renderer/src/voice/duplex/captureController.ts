import type { DesktopDuplexVoiceAudioChunk, DesktopDuplexVoiceUplinkCredit } from "../../../../api/desktopApi";
import { DuplexLocalVad, type DuplexVadSignal } from "./localVad";
import { DuplexSincResampler, DuplexPcmBatcher, floatToPcm16, mixToMono } from "./pcm";
import { classifyDuplexCaptureConstraints, DuplexCaptureQualityMonitor, type DuplexCaptureQualityIssue, type DuplexCaptureQualitySnapshot } from "./captureQuality";

export type DuplexCaptureState = "idle" | "requesting_permission" | "prepared" | "active" | "paused" | "switching_device" | "recovering" | "failed" | "disposed";
export interface DuplexCaptureConstraintReport { requestedDeviceId: string; actualDeviceId?: string; sampleRate?: number; channelCount?: number; echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean; degradations: DuplexCaptureQualityIssue[] }
export interface DuplexCaptureEnvironment {
  mediaDevices: Pick<MediaDevices, "getUserMedia" | "enumerateDevices" | "addEventListener" | "removeEventListener">;
  createAudioContext: () => AudioContext;
  createWorkletNode: (context: AudioContext, name: string, options: AudioWorkletNodeOptions) => AudioWorkletNode;
  now: () => number;
  workletModuleUrl: string;
}
export interface DuplexCaptureOptions {
  sessionId: string; deviceId?: string; targetSampleRateHz?: number;
  initialUplinkCredit: DesktopDuplexVoiceUplinkCredit;
  onChunk: (chunk: DesktopDuplexVoiceAudioChunk) => boolean;
  onState: (state: DuplexCaptureState) => void; onError: (error: DuplexLocalFailure) => void;
  onDevices?: (devices: MediaDeviceInfo[]) => void; onConstraints?: (report: DuplexCaptureConstraintReport) => void;
  onVadSignal?: (signal: DuplexVadSignal) => void; onQuality?: (quality: DuplexCaptureQualitySnapshot) => void; onRecoveryRequired?: (reason: "device_lost" | "sleep" | "audio_context") => void;
  onDeviceSwitchError?: (error: Error) => void;
}

export type DuplexLocalFailureStage = "microphone_permission" | "microphone_device" | "audio_context" | "audio_worklet" | "audio_graph" | "output_device" | "audio_processing" | "audio_uplink";
export type DuplexLocalFailureCode = "permission_denied" | "device_missing" | "unsupported" | "timeout" | "invalid_invocation" | "resource_exhausted" | "unknown";
export interface DuplexLocalFailure {
  domain: "local_media";
  stage: DuplexLocalFailureStage;
  code: DuplexLocalFailureCode;
  retryable: boolean;
  userMessageKey: string;
  traceId: string;
  message: string;
  technicalDetail?: string;
}

export function classifyDuplexLocalFailure(stage: DuplexLocalFailureStage, error: unknown, traceId: string): DuplexLocalFailure {
  if (isDuplexLocalFailure(error)) return error;
  const detail = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  const code: DuplexLocalFailureCode = name === "NotAllowedError" || name === "SecurityError"
    ? "permission_denied"
    : name === "NotFoundError" || name === "OverconstrainedError"
      ? "device_missing"
      : name === "NotSupportedError"
        ? "unsupported"
        : name === "TimeoutError"
          ? "timeout"
          : /illegal invocation/i.test(detail)
            ? "invalid_invocation"
            : name === "QuotaExceededError" || /out of memory|resource/i.test(detail)
              ? "resource_exhausted"
              : "unknown";
  const labels: Record<DuplexLocalFailureStage, string> = {
    microphone_permission: "获取麦克风",
    microphone_device: "读取麦克风设备",
    audio_context: "启动音频引擎",
    audio_worklet: "加载音频处理器",
    audio_graph: "连接音频通道",
    output_device: "启动声音播放",
    audio_processing: "处理麦克风音频",
    audio_uplink: "发送麦克风音频",
  };
  const retryable = !["permission_denied", "unsupported"].includes(code);
  return { domain: "local_media", stage, code, retryable, userMessageKey: `voice.duplex.local_failure.${stage}.${code}`, traceId, message: `实时音频在“${labels[stage]}”阶段失败。`, ...(detail ? { technicalDetail: detail } : {}) };
}

function isDuplexLocalFailure(value: unknown): value is DuplexLocalFailure { return Boolean(value && typeof value === "object" && (value as { domain?: unknown }).domain === "local_media"); }

export class DuplexCaptureController {
  readonly environment: DuplexCaptureEnvironment; readonly options: DuplexCaptureOptions;
  state: DuplexCaptureState = "idle";
  #context: AudioContext | null = null; #stream: MediaStream | null = null; #source: MediaStreamAudioSourceNode | null = null;
  #worklet: AudioWorkletNode | null = null; #silentGain: GainNode | null = null; #resampler: DuplexSincResampler | null = null;
  #batcher: DuplexPcmBatcher; #vad = new DuplexLocalVad(); #quality = new DuplexCaptureQualityMonitor(); #generation = 0; #startedAt = 0; #disposed = false;
  #credit: DesktopDuplexVoiceUplinkCredit; #uplinkSequence = 0; #deferredSpeech: Array<{ capturedAtMs: number; durationMs: number; audioData: Uint8Array }> = [];
  #deviceId: string; #graphConnected = false;
  #deviceChange = (): void => { void this.#refreshDevices(true); };

  constructor(environment: DuplexCaptureEnvironment, options: DuplexCaptureOptions) {
    this.environment = environment; this.options = options; this.#batcher = new DuplexPcmBatcher(options.targetSampleRateHz ?? 24_000, 40); this.#credit = { ...options.initialUplinkCredit }; this.#deviceId = options.deviceId ?? "";
    environment.mediaDevices.addEventListener?.call(environment.mediaDevices, "devicechange", this.#deviceChange);
  }

  async startFromUserGesture(): Promise<boolean> {
    if (!await this.prepareFromUserGesture()) return false;
    return this.activate();
  }

  async prepareFromUserGesture(): Promise<boolean> {
    if (this.#disposed || this.state === "requesting_permission" || this.state === "prepared" || this.state === "active") return false;
    const generation = ++this.#generation; this.#setState("requesting_permission");
    let stage: DuplexLocalFailureStage = "microphone_permission";
    try {
      const constraints = createDuplexAudioConstraints(this.#deviceId, this.#batcher.sampleRateHz);
      const stream = await this.environment.mediaDevices.getUserMedia.call(this.environment.mediaDevices, constraints);
      if (!this.#current(generation)) { stopStream(stream); return false; }
      stage = "audio_context";
      const context = this.environment.createAudioContext();
      stage = "audio_worklet";
      await context.audioWorklet.addModule.call(context.audioWorklet, this.environment.workletModuleUrl);
      if (!this.#current(generation)) { stopStream(stream); await context.close(); return false; }
      stage = "audio_context";
      await context.resume.call(context);
      this.#stream = stream; this.#context = context; this.#resampler = new DuplexSincResampler(context.sampleRate, this.#batcher.sampleRateHz);
      stage = "audio_graph";
      this.#source = context.createMediaStreamSource.call(context, stream);
      this.#worklet = this.environment.createWorkletNode(context, "opendrsai-duplex-pcm-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.#silentGain = context.createGain.call(context); this.#silentGain.gain.value = 0;
      this.#worklet.port.onmessage = (event: MessageEvent<{ type: string; channels: Float32Array[] }>) => this.#onAudio(event.data);
      this.#listenForTrackEnd(stream, generation); this.#reportConstraints(stream); stage = "microphone_device"; await this.#refreshDevices(false);
      this.#setState("prepared"); return true;
    } catch (error) { if (this.#current(generation)) await this.#fail(classifyDuplexLocalFailure(stage, error, this.options.sessionId)); return false; }
  }

  activate(): boolean {
    if (this.#disposed || this.state !== "prepared" || !this.#source || !this.#worklet || !this.#silentGain || !this.#context) return false;
    try { this.#source.connect(this.#worklet); this.#worklet.connect(this.#silentGain).connect(this.#context.destination); this.#graphConnected = true; this.#startedAt = this.environment.now(); this.#setState("active"); return true; }
    catch (error) { void this.#fail(classifyDuplexLocalFailure("audio_graph", error, this.options.sessionId)); return false; }
  }

  async handleLifecycle(kind: "sleep" | "resume" | "hidden" | "visible"): Promise<void> {
    if (kind === "sleep" && this.state === "active") { this.#setState("recovering"); this.options.onRecoveryRequired?.("sleep"); await this.#release(); return; }
    if (kind === "resume" && this.state === "recovering") { if (await this.prepareFromUserGesture()) this.activate(); return; }
    if (this.state !== "active") return;
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
  async dispose(): Promise<void> { if (this.#disposed) return; this.#disposed = true; this.#generation += 1; this.environment.mediaDevices.removeEventListener?.call(this.environment.mediaDevices, "devicechange", this.#deviceChange); await this.#release(); this.#setState("disposed"); }

  updateUplinkCredit(credit: DesktopDuplexVoiceUplinkCredit): void {
    if (credit.acknowledgedSequence < this.#credit.acknowledgedSequence) return;
    this.#credit = { ...credit };
  }
  async pause(): Promise<boolean> { if (this.state !== "active") return this.state === "paused"; this.#setState("paused"); await this.#release(); return true; }
  async resumePaused(): Promise<boolean> { if (this.state !== "paused") return this.state === "active"; if (!await this.prepareFromUserGesture()) return false; return this.activate(); }

  async switchDevice(deviceId: string): Promise<boolean> {
    if (this.#disposed || !this.#context || !this.#worklet || !["prepared", "active", "switching_device"].includes(this.state)) return false;
    const generation = ++this.#generation; const wasActive = this.#graphConnected; this.#setState("switching_device");
    let replacement: MediaStream | null = null;
    try {
      replacement = await this.environment.mediaDevices.getUserMedia.call(this.environment.mediaDevices, createDuplexAudioConstraints(deviceId, this.#batcher.sampleRateHz));
      if (!this.#current(generation)) { stopStream(replacement); return false; }
      const replacementSource = this.#context.createMediaStreamSource.call(this.#context, replacement);
      const previousStream = this.#stream; const previousSource = this.#source;
      if (wasActive) {
        previousSource?.disconnect();
        try { replacementSource.connect(this.#worklet); }
        catch (error) { previousSource?.connect(this.#worklet); throw error; }
      }
      this.#stream = replacement; this.#source = replacementSource; this.#deviceId = deviceId;
      this.#listenForTrackEnd(replacement, generation);
      stopStream(previousStream);
      this.#resetSignalPipeline(); this.#startedAt = this.environment.now(); this.#reportConstraints(replacement); await this.#refreshDevices(false);
      if (!this.#current(generation)) return false;
      this.#setState(wasActive ? "active" : "prepared"); return true;
    } catch (error) {
      if (replacement && replacement !== this.#stream) stopStream(replacement);
      if (!this.#current(generation)) return false;
      if (this.#stream) this.#listenForTrackEnd(this.#stream, generation);
      this.#setState(wasActive ? "active" : "prepared"); this.options.onDeviceSwitchError?.(error instanceof Error ? error : new Error(String(error))); return false;
    }
  }

  #onAudio(data: { type: string; channels: Float32Array[] }): void {
    if (this.state !== "active" || data.type !== "audio" || !this.#resampler) return;
    try { for (const batch of this.#batcher.push(floatToPcm16(this.#resampler.push(mixToMono(data.channels))))) this.#emit(batch); }
    catch (error) { void this.#fail(classifyDuplexLocalFailure("audio_processing", error, this.options.sessionId)); }
  }
  #emit(batch: { sequence: number; durationMs: number; samples: Int16Array; audioData: Uint8Array }): void {
    const signal = this.#vad.observe(batch.samples, batch.durationMs); this.options.onVadSignal?.(signal); this.options.onQuality?.(this.#quality.observe(batch.samples, batch.durationMs));
    const captured = { capturedAtMs: this.#startedAt + batch.sequence * this.#batcher.batchDurationMs, durationMs: batch.durationMs, audioData: batch.audioData };
    const candidate = this.#deferredSpeech.shift() ?? captured;
    if (candidate !== captured && signal.speechCandidate) this.#queueSpeech(captured);
    if (!this.#hasCredit(candidate)) {
      if (candidate !== captured) this.#deferredSpeech.unshift(candidate);
      else if (signal.speechCandidate) this.#queueSpeech(captured);
      return;
    }
    let accepted = false;
    try { accepted = this.options.onChunk({ protocolVersion: 2, sessionId: this.options.sessionId, sequence: this.#uplinkSequence, capturedAtMs: candidate.capturedAtMs, durationMs: candidate.durationMs, encoding: "pcm_s16le", sampleRateHz: this.#batcher.sampleRateHz, channels: 1, audioData: candidate.audioData }); }
    catch (error) { throw classifyDuplexLocalFailure("audio_uplink", error, this.options.sessionId); }
    if (!accepted) { void this.#fail(new Error("The Duplex audio channel rejected an input frame.")); return; }
    this.#uplinkSequence += 1;
    this.#credit = { ...this.#credit, frames: this.#credit.frames - 1, bytes: this.#credit.bytes - candidate.audioData.byteLength, audioMs: this.#credit.audioMs - candidate.durationMs };
  }
  #hasCredit(frame: { durationMs: number; audioData: Uint8Array }): boolean { return this.#credit.frames > 0 && this.#credit.bytes >= frame.audioData.byteLength && this.#credit.audioMs >= frame.durationMs; }
  #queueSpeech(frame: { capturedAtMs: number; durationMs: number; audioData: Uint8Array }): void {
    if (this.#deferredSpeech.length >= 750) { void this.#fail(new Error("Realtime voice was paused too long to preserve speech safely.")); return; }
    this.#deferredSpeech.push({ ...frame, audioData: new Uint8Array(frame.audioData) });
  }
  async #refreshDevices(enforceActive: boolean): Promise<void> {
    const devices = (await this.environment.mediaDevices.enumerateDevices.call(this.environment.mediaDevices).catch(() => [])).filter((item) => item.kind === "audioinput"); this.options.onDevices?.(devices);
    if (!enforceActive || this.state !== "active") return;
    const actual = this.#stream?.getAudioTracks()[0]?.getSettings().deviceId;
    if (actual && !devices.some((device) => device.deviceId === actual) && !await this.switchDevice("")) await this.#failForRecovery("device_lost", new Error("The active microphone is no longer available."));
  }
  #reportConstraints(stream: MediaStream): void { const settings = stream.getAudioTracks()[0]?.getSettings() ?? {}; this.#quality.configure(settings, this.#batcher.sampleRateHz); const degradations = classifyDuplexCaptureConstraints(settings, this.#batcher.sampleRateHz); this.options.onConstraints?.({ requestedDeviceId: this.#deviceId, actualDeviceId: settings.deviceId, sampleRate: settings.sampleRate, channelCount: settings.channelCount, echoCancellation: settings.echoCancellation, noiseSuppression: settings.noiseSuppression, autoGainControl: settings.autoGainControl, degradations }); }
  #listenForTrackEnd(stream: MediaStream, generation: number): void { for (const track of stream.getAudioTracks()) track.addEventListener("ended", () => { if (this.#current(generation)) void this.#recoverLostDevice(); }, { once: true }); }
  async #recoverLostDevice(): Promise<void> { if (await this.switchDevice("")) return; await this.#failForRecovery("device_lost", new Error("The active microphone disconnected and no replacement was available.")); }
  #resetSignalPipeline(): void { this.#resampler?.reset(); this.#batcher.reset(); this.#vad.reset(); this.#quality.reset(); this.#deferredSpeech = []; }
  async #failForRecovery(reason: "device_lost" | "sleep" | "audio_context", error: Error): Promise<void> { this.#setState("recovering"); this.options.onRecoveryRequired?.(reason); await this.#release(); this.#setState("failed"); this.options.onError(classifyDuplexLocalFailure(reason === "device_lost" ? "microphone_device" : "audio_context", error, this.options.sessionId)); }
  async #fail(error: unknown): Promise<void> { await this.#release(); this.#setState("failed"); this.options.onError(classifyDuplexLocalFailure("audio_processing", error, this.options.sessionId)); }
  async #release(): Promise<void> { if (this.#worklet) this.#worklet.port.onmessage = null; this.#source?.disconnect(); this.#worklet?.disconnect(); this.#silentGain?.disconnect(); stopStream(this.#stream); const context = this.#context; this.#stream = null; this.#context = null; this.#source = null; this.#worklet = null; this.#silentGain = null; this.#graphConnected = false; this.#resampler?.reset(); this.#resampler = null; this.#resetSignalPipeline(); if (context && context.state !== "closed") await context.close().catch(() => undefined); }
  #setState(state: DuplexCaptureState): void { this.state = state; this.options.onState(state); }
  #current(generation: number): boolean { return !this.#disposed && this.#generation === generation; }
}

export function createDuplexAudioConstraints(deviceId: string, sampleRateHz: number): MediaStreamConstraints { return { audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: { ideal: 1 }, sampleRate: { ideal: sampleRateHz }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }; }
function stopStream(stream: MediaStream | null): void { for (const track of stream?.getTracks() ?? []) track.stop(); }
