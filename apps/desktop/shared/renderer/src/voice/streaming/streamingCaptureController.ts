import type { DesktopStreamingVoiceAudioChunk } from "@shared/desktopApi";
import pcmCaptureWorkletUrl from "./pcmCapture.worklet.js?url";
import { float32ToPcm16, mixAudioChannelsToMono, Pcm16Batcher, StreamingLinearResampler } from "./streamingAudio";

export interface StreamingCaptureControllerOptions {
  sessionId: string;
  turnId: string;
  deviceId?: string;
  targetSampleRateHz?: number;
  onChunk: (chunk: DesktopStreamingVoiceAudioChunk) => boolean;
  onAudioBatch?: (samples: Int16Array, durationMs: number) => void;
  onError: (error: Error) => void;
  onStreamStarted?: (stream: MediaStream) => void;
  onStreamStopped?: () => void;
}

export class StreamingCaptureController {
  readonly options: StreamingCaptureControllerOptions;
  #context: AudioContext | null = null;
  #stream: MediaStream | null = null;
  #source: MediaStreamAudioSourceNode | null = null;
  #worklet: AudioWorkletNode | null = null;
  #silentGain: GainNode | null = null;
  #resampler: StreamingLinearResampler | null = null;
  #batcher: Pcm16Batcher;
  #startedAt = 0;

  constructor(options: StreamingCaptureControllerOptions) {
    this.options = options;
    this.#batcher = new Pcm16Batcher({ sampleRateHz: options.targetSampleRateHz ?? 16_000 });
  }

  async start(): Promise<void> {
    if (this.#context || this.#stream) throw new Error("Streaming capture is already active.");
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
      throw new Error("Streaming audio capture requires MediaDevices and AudioWorklet support.");
    }
    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({
        audio: this.options.deviceId ? { deviceId: { exact: this.options.deviceId } } : true,
      });
      this.#context = new AudioContext();
      await this.#context.audioWorklet.addModule(pcmCaptureWorkletUrl);
      await this.#context.resume();
      this.#resampler = new StreamingLinearResampler(this.#context.sampleRate, this.#batcher.sampleRateHz);
      this.#source = this.#context.createMediaStreamSource(this.#stream);
      this.#worklet = new AudioWorkletNode(this.#context, "opendrsai-pcm-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.#silentGain = this.#context.createGain();
      this.#silentGain.gain.value = 0;
      this.#worklet.port.onmessage = (event: MessageEvent<{ type: string; channels: Float32Array[] }>) => {
        if (event.data.type !== "audio" || !this.#resampler) return;
        try {
          const mono = mixAudioChannelsToMono(event.data.channels);
          const resampled = this.#resampler.push(mono);
          const batches = this.#batcher.push(float32ToPcm16(resampled));
          for (const batch of batches) this.#emit(batch);
        } catch (error) {
          this.options.onError(error instanceof Error ? error : new Error(String(error)));
        }
      };
      this.#startedAt = performance.now();
      this.options.onStreamStarted?.(this.#stream);
      this.#source.connect(this.#worklet).connect(this.#silentGain).connect(this.#context.destination);
    } catch (error) {
      await this.stop(false);
      throw error;
    }
  }

  async stop(flush = true): Promise<void> {
    if (flush) for (const batch of this.#batcher.flush()) this.#emit(batch);
    if (this.#worklet) this.#worklet.port.onmessage = null;
    this.#source?.disconnect();
    this.#worklet?.disconnect();
    this.#silentGain?.disconnect();
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    if (this.#stream) this.options.onStreamStopped?.();
    const context = this.#context;
    this.#context = null;
    this.#stream = null;
    this.#source = null;
    this.#worklet = null;
    this.#silentGain = null;
    this.#resampler?.reset();
    this.#resampler = null;
    this.#batcher.reset();
    if (context && context.state !== "closed") await context.close();
  }

  #emit(batch: { sequence: number; durationMs: number; audioData: Uint8Array }): void {
    this.options.onAudioBatch?.(
      new Int16Array(batch.audioData.buffer, batch.audioData.byteOffset, batch.audioData.byteLength / Int16Array.BYTES_PER_ELEMENT),
      batch.durationMs,
    );
    const accepted = this.options.onChunk({
      protocolVersion: 2,
      sessionId: this.options.sessionId,
      turnId: this.options.turnId,
      sequence: batch.sequence,
      capturedAtMs: this.#startedAt + batch.sequence * this.#batcher.batchDurationMs,
      durationMs: batch.durationMs,
      encoding: "pcm_s16le",
      sampleRateHz: this.#batcher.sampleRateHz,
      channels: 1,
      audioData: batch.audioData,
    });
    if (!accepted) this.options.onError(new Error("The streaming audio channel is not available."));
  }
}
