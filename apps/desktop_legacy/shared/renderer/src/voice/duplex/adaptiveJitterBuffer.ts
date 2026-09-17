export interface DuplexJitterSnapshot { targetMs: number; jitterMs: number; samples: number; underruns: number }

export class DuplexAdaptiveJitterBuffer {
  readonly minMs: number; readonly maxMs: number; readonly initialMs: number;
  #targetMs: number; #jitterMs = 0; #lastArrivalMs: number | null = null; #samples = 0; #underruns = 0; #underrunPenaltyMs = 0;
  constructor(options: { minMs?: number; maxMs?: number; initialMs?: number } = {}) {
    this.minMs = options.minMs ?? 60; this.maxMs = options.maxMs ?? 400; this.initialMs = options.initialMs ?? 80;
    if (!(this.minMs >= 20 && this.minMs <= this.initialMs && this.initialMs <= this.maxMs && this.maxMs <= 1_000)) throw new Error("Duplex jitter buffer bounds are invalid.");
    this.#targetMs = this.initialMs;
  }
  observeArrival(arrivalMs: number, mediaDurationMs: number): DuplexJitterSnapshot {
    if (!Number.isFinite(arrivalMs) || !Number.isFinite(mediaDurationMs) || mediaDurationMs <= 0) return this.snapshot;
    if (this.#lastArrivalMs !== null) {
      const deviation = Math.abs((arrivalMs - this.#lastArrivalMs) - mediaDurationMs);
      this.#jitterMs += (deviation - this.#jitterMs) / 16;
      this.#underrunPenaltyMs *= 0.98;
      const desired = clamp(this.minMs + this.#jitterMs * 4 + this.#underrunPenaltyMs, this.minMs, this.maxMs);
      const gain = desired > this.#targetMs ? 0.35 : 0.04;
      this.#targetMs += (desired - this.#targetMs) * gain;
    }
    this.#lastArrivalMs = arrivalMs; this.#samples += 1; return this.snapshot;
  }
  observeUnderrun(): DuplexJitterSnapshot { this.#underruns += 1; this.#underrunPenaltyMs = Math.min(120, this.#underrunPenaltyMs + 40); this.#targetMs = Math.min(this.maxMs, Math.max(this.#targetMs + 40, this.minMs + this.#jitterMs * 4 + this.#underrunPenaltyMs)); return this.snapshot; }
  resetResponse(): void { this.#lastArrivalMs = null; }
  get snapshot(): DuplexJitterSnapshot { return Object.freeze({ targetMs: Math.round(this.#targetMs), jitterMs: this.#jitterMs, samples: this.#samples, underruns: this.#underruns }); }
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
