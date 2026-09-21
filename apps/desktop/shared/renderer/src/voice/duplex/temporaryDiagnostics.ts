export interface DuplexTemporaryDiagnosticSample { at: number; metrics: Record<string, number | boolean | null>; reasonCode?: string }

/** In-memory, bounded, numeric-only diagnostics. Expiry destroys all samples. */
export class DuplexTemporaryDiagnostics {
  readonly #now: () => number; #expiresAt = 0; #samples: DuplexTemporaryDiagnosticSample[] = [];
  constructor(now: () => number = Date.now) { this.#now = now; }
  enable(durationMs = 10 * 60_000): number { if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 15 * 60_000) throw new Error("Temporary diagnostic duration is invalid."); this.#samples = []; this.#expiresAt = this.#now() + durationMs; return this.#expiresAt; }
  disable(): void { this.#expiresAt = 0; this.#samples = []; }
  get active(): boolean { this.#expire(); return this.#expiresAt > 0; }
  get expiresAt(): number { this.#expire(); return this.#expiresAt; }
  record(input: { metrics: Record<string, unknown>; reasonCode?: string }): boolean {
    if (!this.active) return false;
    const metrics = Object.fromEntries(Object.entries(input.metrics).flatMap(([key, value]) => typeof value === "number" && Number.isFinite(value) || typeof value === "boolean" || value === null ? [[key.slice(0, 80), value as number | boolean | null]] : []));
    const reasonCode = typeof input.reasonCode === "string" && /^[a-z0-9_.:-]{1,80}$/i.test(input.reasonCode) ? input.reasonCode : undefined;
    this.#samples.push({ at: this.#now(), metrics, ...(reasonCode ? { reasonCode } : {}) }); this.#samples = this.#samples.slice(-500); return true;
  }
  export(): { schemaVersion: 1; expiresAt: number; samples: DuplexTemporaryDiagnosticSample[] } { this.#expire(); return { schemaVersion: 1, expiresAt: this.#expiresAt, samples: this.#samples.map((sample) => ({ ...sample, metrics: { ...sample.metrics } })) }; }
  #expire(): void { if (this.#expiresAt && this.#now() >= this.#expiresAt) this.disable(); }
}
