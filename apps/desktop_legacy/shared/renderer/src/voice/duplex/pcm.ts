export interface DuplexPcmBatch { sequence: number; durationMs: number; samples: Int16Array; audioData: Uint8Array }

export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  if (!channels.length) return new Float32Array();
  const length = Math.min(...channels.map((channel) => channel.length));
  const result = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    let value = 0;
    for (const channel of channels) value += Number.isFinite(channel[index]) ? channel[index] : 0;
    result[index] = Math.max(-1, Math.min(1, value / channels.length));
  }
  return result;
}

export function floatToPcm16(input: Float32Array): Int16Array {
  const result = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const value = Number.isFinite(input[index]) ? Math.max(-1, Math.min(1, input[index])) : 0;
    result[index] = value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff);
  }
  return result;
}

/**
 * Stateful band-limited resampler. The windowed-sinc kernel removes frequencies
 * above the destination Nyquist limit before decimation and the fractional input
 * cursor is retained across pushes, so worklet block boundaries cannot reset phase.
 */
export class DuplexSincResampler {
  readonly inputRate: number; readonly outputRate: number;
  readonly halfWidth: number;
  #buffer: number[] = []; #position: number;
  constructor(inputRate: number, outputRate: number, halfWidth = 24) {
    if (!Number.isInteger(inputRate) || inputRate <= 0 || !Number.isInteger(outputRate) || outputRate <= 0) throw new Error("Duplex PCM sample rates are invalid.");
    if (!Number.isInteger(halfWidth) || halfWidth < 8 || halfWidth > 64) throw new Error("Duplex resampler kernel width is invalid.");
    this.inputRate = inputRate; this.outputRate = outputRate; this.halfWidth = halfWidth; this.#position = halfWidth;
    this.#buffer = Array.from({ length: halfWidth }, () => 0);
  }
  push(input: Float32Array): Float32Array {
    for (const value of input) this.#buffer.push(Number.isFinite(value) ? value : 0);
    const ratio = this.inputRate / this.outputRate; const output: number[] = [];
    const cutoff = Math.min(1, this.outputRate / this.inputRate) * 0.94;
    while (this.#position + this.halfWidth < this.#buffer.length) {
      const center = Math.floor(this.#position); let sum = 0; let weightSum = 0;
      for (let index = center - this.halfWidth + 1; index <= center + this.halfWidth; index += 1) {
        const distance = this.#position - index;
        const window = 0.5 + 0.5 * Math.cos(Math.PI * distance / this.halfWidth);
        const x = Math.PI * cutoff * distance;
        const weight = cutoff * (Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x) * window;
        sum += this.#buffer[index] * weight; weightSum += weight;
      }
      output.push(weightSum === 0 ? 0 : sum / weightSum);
      this.#position += ratio;
    }
    const consumed = Math.max(0, Math.floor(this.#position) - this.halfWidth);
    if (consumed > 0) { this.#buffer.splice(0, consumed); this.#position -= consumed; }
    return Float32Array.from(output);
  }
  reset(): void { this.#buffer = Array.from({ length: this.halfWidth }, () => 0); this.#position = this.halfWidth; }
}

export class DuplexPcmBatcher {
  readonly sampleRateHz: number; readonly batchDurationMs: number; readonly batchSamples: number;
  #pending: number[] = []; #sequence = 0;
  constructor(sampleRateHz = 24_000, batchDurationMs = 40) {
    if (!Number.isInteger(sampleRateHz) || sampleRateHz <= 0 || !Number.isInteger(batchDurationMs) || batchDurationMs < 20 || batchDurationMs > 100) throw new Error("Duplex PCM batch configuration is invalid.");
    this.sampleRateHz = sampleRateHz; this.batchDurationMs = batchDurationMs; this.batchSamples = Math.round(sampleRateHz * batchDurationMs / 1_000);
  }
  push(samples: Int16Array): DuplexPcmBatch[] {
    for (const value of samples) this.#pending.push(value);
    const result: DuplexPcmBatch[] = [];
    while (this.#pending.length >= this.batchSamples) result.push(this.#take(this.batchSamples));
    return result;
  }
  flush(): DuplexPcmBatch[] { return this.#pending.length ? [this.#take(this.#pending.length)] : []; }
  reset(): void { this.#pending = []; this.#sequence = 0; }
  #take(count: number): DuplexPcmBatch {
    const samples = Int16Array.from(this.#pending.splice(0, count));
    return { sequence: this.#sequence++, durationMs: count / this.sampleRateHz * 1_000, samples, audioData: new Uint8Array(samples.buffer.slice(0)) };
  }
}
