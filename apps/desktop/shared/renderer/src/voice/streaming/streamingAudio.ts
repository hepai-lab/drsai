export interface PcmAudioBatch {
  sequence: number;
  durationMs: number;
  audioData: Uint8Array;
}

export function mixAudioChannelsToMono(channels: readonly Float32Array[]): Float32Array {
  if (!channels.length) return new Float32Array();
  const frameCount = Math.min(...channels.map((channel) => channel.length));
  const mono = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (const channel of channels) sum += Number.isFinite(channel[frame]) ? channel[frame] : 0;
    mono[frame] = Math.max(-1, Math.min(1, sum / channels.length));
  }
  return mono;
}

export class StreamingLinearResampler {
  readonly inputSampleRate: number;
  readonly outputSampleRate: number;
  #buffer: number[] = [];
  #position = 0;

  constructor(inputSampleRate: number, outputSampleRate: number) {
    if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) throw new Error("Input sample rate must be positive.");
    if (!Number.isFinite(outputSampleRate) || outputSampleRate <= 0) throw new Error("Output sample rate must be positive.");
    this.inputSampleRate = inputSampleRate;
    this.outputSampleRate = outputSampleRate;
  }

  push(input: Float32Array): Float32Array {
    for (const sample of input) this.#buffer.push(Number.isFinite(sample) ? sample : 0);
    if (this.#buffer.length < 2) return new Float32Array();
    const ratio = this.inputSampleRate / this.outputSampleRate;
    const output: number[] = [];
    while (this.#position + 1 < this.#buffer.length) {
      const lower = Math.floor(this.#position);
      const fraction = this.#position - lower;
      output.push(this.#buffer[lower] + (this.#buffer[lower + 1] - this.#buffer[lower]) * fraction);
      this.#position += ratio;
    }
    const consumed = Math.min(Math.floor(this.#position), this.#buffer.length - 1);
    if (consumed > 0) {
      this.#buffer.splice(0, consumed);
      this.#position -= consumed;
    }
    return Float32Array.from(output);
  }

  reset(): void {
    this.#buffer = [];
    this.#position = 0;
  }
}

export function float32ToPcm16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Number.isFinite(input[index]) ? Math.max(-1, Math.min(1, input[index])) : 0;
    output[index] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return output;
}

export class Pcm16Batcher {
  readonly sampleRateHz: number;
  readonly frameDurationMs: number;
  readonly batchDurationMs: number;
  readonly frameSamples: number;
  readonly batchSamples: number;
  #pending: number[] = [];
  #sequence = 0;

  constructor(options: { sampleRateHz: number; frameDurationMs?: number; batchDurationMs?: number }) {
    this.sampleRateHz = options.sampleRateHz;
    this.frameDurationMs = options.frameDurationMs ?? 20;
    this.batchDurationMs = options.batchDurationMs ?? 100;
    if (!Number.isInteger(this.sampleRateHz) || this.sampleRateHz <= 0) throw new Error("sampleRateHz must be a positive integer.");
    if (!Number.isInteger(this.frameDurationMs) || this.frameDurationMs <= 0) throw new Error("frameDurationMs must be a positive integer.");
    if (!Number.isInteger(this.batchDurationMs) || this.batchDurationMs < this.frameDurationMs || this.batchDurationMs % this.frameDurationMs !== 0) {
      throw new Error("batchDurationMs must be an integer multiple of frameDurationMs.");
    }
    this.frameSamples = Math.round(this.sampleRateHz * this.frameDurationMs / 1_000);
    this.batchSamples = this.frameSamples * (this.batchDurationMs / this.frameDurationMs);
  }

  push(samples: Int16Array): PcmAudioBatch[] {
    for (const sample of samples) this.#pending.push(sample);
    const batches: PcmAudioBatch[] = [];
    while (this.#pending.length >= this.batchSamples) {
      batches.push(this.#take(this.batchSamples));
    }
    return batches;
  }

  flush(): PcmAudioBatch[] {
    return this.#pending.length ? [this.#take(this.#pending.length)] : [];
  }

  reset(): void {
    this.#pending = [];
    this.#sequence = 0;
  }

  #take(sampleCount: number): PcmAudioBatch {
    const samples = Int16Array.from(this.#pending.splice(0, sampleCount));
    const audioData = new Uint8Array(samples.buffer.slice(0));
    return {
      sequence: this.#sequence++,
      durationMs: sampleCount / this.sampleRateHz * 1_000,
      audioData,
    };
  }
}
