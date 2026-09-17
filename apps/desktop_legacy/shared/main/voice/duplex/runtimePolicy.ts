export interface DuplexUsageSnapshot { inputAudioMs: number; outputAudioMs: number; inputTokens: number | null; outputTokens: number | null; estimatedCostUsd: number | null; warning: boolean; exceeded: boolean }
export class DuplexSessionBudget {
  readonly maxAudioMs: number; readonly maxEstimatedCostUsd: number | null; #inputAudioMs = 0; #outputAudioMs = 0; #inputTokens: number | null = null; #outputTokens: number | null = null; #cost: number | null = null;
  constructor(options: { maxAudioMs: number; maxEstimatedCostUsd?: number | null }) { this.maxAudioMs = options.maxAudioMs; this.maxEstimatedCostUsd = options.maxEstimatedCostUsd ?? null; }
  addInputAudio(ms: number): boolean { if (!validMs(ms) || this.#inputAudioMs + ms > this.maxAudioMs) return false; this.#inputAudioMs += ms; return true; }
  addOutputAudio(ms: number): boolean { if (!validMs(ms) || this.#outputAudioMs + ms > this.maxAudioMs) return false; this.#outputAudioMs += ms; return true; }
  observeProviderUsage(value: { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number }): void { if (validCount(value.inputTokens)) this.#inputTokens = value.inputTokens!; if (validCount(value.outputTokens)) this.#outputTokens = value.outputTokens!; if (typeof value.estimatedCostUsd === "number" && Number.isFinite(value.estimatedCostUsd) && value.estimatedCostUsd >= 0) this.#cost = value.estimatedCostUsd; }
  snapshot(): DuplexUsageSnapshot { const audioRatio = Math.max(this.#inputAudioMs, this.#outputAudioMs) / this.maxAudioMs; const costRatio = this.maxEstimatedCostUsd && this.#cost !== null ? this.#cost / this.maxEstimatedCostUsd : 0; return { inputAudioMs: this.#inputAudioMs, outputAudioMs: this.#outputAudioMs, inputTokens: this.#inputTokens, outputTokens: this.#outputTokens, estimatedCostUsd: this.#cost, warning: Math.max(audioRatio, costRatio) >= 0.8, exceeded: audioRatio >= 1 || costRatio >= 1 }; }
}

export interface DuplexMetricSnapshot { connectMs: number | null; firstInputEventMs: number | null; ttfaMs: number | null; reconnects: number; interrupts: number; maxBufferedAudioMs: number; inputAudioMs: number; outputAudioMs: number }
export class DuplexRuntimeMetrics {
  readonly #startedAt: number; #connectedAt: number | null = null; #firstInputAt: number | null = null; #firstAudioAt: number | null = null; #reconnects = 0; #interrupts = 0; #maxBuffer = 0; #input = 0; #output = 0;
  constructor(startedAt: number) { this.#startedAt = startedAt; }
  connected(at: number): void { this.#connectedAt ??= at; }
  inputEvent(at: number): void { this.#firstInputAt ??= at; }
  outputAudio(at: number, durationMs: number): void { this.#firstAudioAt ??= at; this.#output += durationMs; }
  inputAudio(durationMs: number, bufferedMs: number): void { this.#input += durationMs; this.#maxBuffer = Math.max(this.#maxBuffer, bufferedMs); }
  reconnected(): void { this.#reconnects += 1; }
  interrupted(): void { this.#interrupts += 1; }
  snapshot(): DuplexMetricSnapshot { return { connectMs: this.#connectedAt === null ? null : Math.max(0, this.#connectedAt - this.#startedAt), firstInputEventMs: this.#firstInputAt === null ? null : Math.max(0, this.#firstInputAt - this.#startedAt), ttfaMs: this.#firstAudioAt === null ? null : Math.max(0, this.#firstAudioAt - this.#startedAt), reconnects: this.#reconnects, interrupts: this.#interrupts, maxBufferedAudioMs: this.#maxBuffer, inputAudioMs: this.#input, outputAudioMs: this.#output }; }
}

export function reconnectDelayMs(attempt: number, baseMs = 250, maxMs = 4_000): number { if (!Number.isInteger(attempt) || attempt < 1) throw new Error("Reconnect attempt is invalid."); return Math.min(maxMs, baseMs * 2 ** (attempt - 1)); }
export function redactDuplexDiagnostic(value: unknown): unknown {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return `[binary:${value.byteLength}]`;
  if (Array.isArray(value)) return value.map(redactDuplexDiagnostic);
  if (!value || typeof value !== "object") return typeof value === "string" && value.length > 240 ? `${value.slice(0, 220)}…[redacted-text]` : value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [/token|authorization|api[_-]?key|secret|password|transcript|audioData/i.test(key) ? [key, "[redacted]"] : [key, redactDuplexDiagnostic(item)]]));
}
export function summarizeDuplexMetric(values: number[]): { count: number; p50: number | null; p95: number | null; p99: number | null } { const sorted = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b); const at = (percentile: number): number | null => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1)] : null; return { count: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99) }; }
function validMs(value: number): boolean { return Number.isFinite(value) && value > 0; }
function validCount(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0; }
