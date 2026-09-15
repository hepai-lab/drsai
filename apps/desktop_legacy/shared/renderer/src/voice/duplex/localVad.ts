export interface DuplexVadSignal { level: number; threshold: number; noiseFloor: number; speechCandidate: boolean; changed: boolean }

export class DuplexLocalVad {
  #noiseFloor = 0; #noiseSamples = 0; #speechMs = 0; #silenceMs = 0; #active = false;
  readonly attackMs: number; readonly releaseMs: number; readonly baseThreshold: number;
  constructor(options: { attackMs?: number; releaseMs?: number; baseThreshold?: number } = {}) {
    this.attackMs = options.attackMs ?? 120; this.releaseMs = options.releaseMs ?? 280; this.baseThreshold = options.baseThreshold ?? 0.018;
    if (this.attackMs <= 0 || this.releaseMs <= 0 || this.baseThreshold <= 0 || this.baseThreshold >= 1) throw new Error("Duplex VAD configuration is invalid.");
  }
  observe(samples: Int16Array, durationMs: number): DuplexVadSignal {
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("Duplex VAD duration is invalid.");
    const level = pcm16Rms(samples); const threshold = Math.min(0.15, Math.max(this.baseThreshold, this.#noiseFloor * 3.4));
    const previouslyActive = this.#active;
    if (level >= threshold) { this.#speechMs += durationMs; this.#silenceMs = 0; if (this.#speechMs >= this.attackMs) this.#active = true; }
    else {
      this.#speechMs = 0;
      if (this.#active) { this.#silenceMs += durationMs; if (this.#silenceMs >= this.releaseMs) { this.#active = false; this.#silenceMs = 0; } }
      else this.#observeNoise(level);
    }
    return { level, threshold, noiseFloor: this.#noiseFloor, speechCandidate: this.#active, changed: previouslyActive !== this.#active };
  }
  reset(): void { this.#noiseFloor = 0; this.#noiseSamples = 0; this.#speechMs = 0; this.#silenceMs = 0; this.#active = false; }
  #observeNoise(level: number): void { if (level > 0.12) return; const alpha = this.#noiseSamples < 10 ? 1 / (this.#noiseSamples + 1) : 0.04; this.#noiseFloor += (level - this.#noiseFloor) * alpha; this.#noiseSamples += 1; }
}

export function pcm16Rms(samples: Int16Array): number { if (!samples.length) return 0; let sum = 0; for (const value of samples) { const normalized = value / 32768; sum += normalized * normalized; } return Math.sqrt(sum / samples.length); }
