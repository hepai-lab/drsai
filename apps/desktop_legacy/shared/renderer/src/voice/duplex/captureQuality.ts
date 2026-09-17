export type DuplexCaptureQualityIssue = "input_too_quiet" | "clipping" | "dc_offset" | "sample_rate_degraded" | "aec_unavailable" | "noise_suppression_unavailable" | "agc_unavailable" | "channel_count_degraded";

export interface DuplexCaptureQualitySnapshot {
  rmsDbfs: number;
  peakDbfs: number;
  clippingRatio: number;
  dcOffset: number;
  silentDurationMs: number;
  actualSampleRateHz?: number;
  issues: DuplexCaptureQualityIssue[];
}

export interface DuplexCaptureQualityOptions { silenceDbfs?: number; silenceWarningMs?: number; clippingThreshold?: number; clippingRatio?: number; dcOffsetThreshold?: number; dcWarningMs?: number; warningHoldMs?: number }

export class DuplexCaptureQualityMonitor {
  readonly options: Required<DuplexCaptureQualityOptions>;
  #silentMs = 0; #dcMs = 0; #clippingHoldMs = 0; #dcHoldMs = 0; #actualSampleRateHz?: number; #constraintIssues: DuplexCaptureQualityIssue[] = [];
  constructor(options: DuplexCaptureQualityOptions = {}) {
    this.options = { silenceDbfs: options.silenceDbfs ?? -52, silenceWarningMs: options.silenceWarningMs ?? 2_000, clippingThreshold: options.clippingThreshold ?? 0.98, clippingRatio: options.clippingRatio ?? 0.005, dcOffsetThreshold: options.dcOffsetThreshold ?? 0.03, dcWarningMs: options.dcWarningMs ?? 1_000, warningHoldMs: options.warningHoldMs ?? 2_000 };
  }
  configure(settings: { sampleRate?: number; channelCount?: number; echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean }, targetSampleRateHz: number): void {
    this.#actualSampleRateHz = settings.sampleRate;
    this.#constraintIssues = classifyDuplexCaptureConstraints(settings, targetSampleRateHz);
  }
  observe(samples: Int16Array, durationMs: number): DuplexCaptureQualitySnapshot {
    let squares = 0; let peak = 0; let sum = 0; let clipped = 0;
    const clip = this.options.clippingThreshold * 32768;
    for (const sample of samples) { const absolute = Math.abs(sample); squares += sample * sample; sum += sample; peak = Math.max(peak, absolute); if (absolute >= clip) clipped += 1; }
    const rms = samples.length ? Math.sqrt(squares / samples.length) / 32768 : 0;
    const peakValue = peak / 32768; const dcOffset = samples.length ? sum / samples.length / 32768 : 0; const clippingRatio = samples.length ? clipped / samples.length : 0;
    const rmsDbfs = toDbfs(rms); const peakDbfs = toDbfs(peakValue);
    this.#silentMs = rmsDbfs <= this.options.silenceDbfs ? this.#silentMs + durationMs : 0;
    this.#dcMs = Math.abs(dcOffset) >= this.options.dcOffsetThreshold ? this.#dcMs + durationMs : 0;
    this.#clippingHoldMs = clippingRatio >= this.options.clippingRatio ? this.options.warningHoldMs : Math.max(0, this.#clippingHoldMs - durationMs);
    if (this.#dcMs >= this.options.dcWarningMs) this.#dcHoldMs = this.options.warningHoldMs;
    else this.#dcHoldMs = Math.max(0, this.#dcHoldMs - durationMs);
    const issues = [...this.#constraintIssues];
    if (this.#silentMs >= this.options.silenceWarningMs) issues.push("input_too_quiet");
    if (this.#clippingHoldMs > 0) issues.push("clipping");
    if (this.#dcHoldMs > 0) issues.push("dc_offset");
    return Object.freeze({ rmsDbfs, peakDbfs, clippingRatio, dcOffset, silentDurationMs: this.#silentMs, actualSampleRateHz: this.#actualSampleRateHz, issues });
  }
  reset(): void { this.#silentMs = 0; this.#dcMs = 0; this.#clippingHoldMs = 0; this.#dcHoldMs = 0; }
}

export function classifyDuplexCaptureConstraints(settings: { sampleRate?: number; channelCount?: number; echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean }, targetSampleRateHz: number): DuplexCaptureQualityIssue[] {
  const issues: DuplexCaptureQualityIssue[] = [];
  if (settings.sampleRate && settings.sampleRate < targetSampleRateHz) issues.push("sample_rate_degraded");
  if (settings.channelCount && settings.channelCount !== 1) issues.push("channel_count_degraded");
  if (settings.echoCancellation === false) issues.push("aec_unavailable");
  if (settings.noiseSuppression === false) issues.push("noise_suppression_unavailable");
  if (settings.autoGainControl === false) issues.push("agc_unavailable");
  return issues;
}

function toDbfs(value: number): number { return value > 0 ? 20 * Math.log10(value) : -120; }
