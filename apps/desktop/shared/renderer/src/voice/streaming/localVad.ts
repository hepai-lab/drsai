export interface LocalVadOptions {
  speechThreshold: number;
  minSpeechMs: number;
  endpointSilenceMs: number;
  initialSilenceTimeoutMs: number;
  adaptive: boolean;
  noiseMultiplier: number;
  maxAdaptiveThreshold: number;
  languageHint?: string;
}

export interface LocalVadResult {
  level: number;
  speechDetected: boolean;
  endpoint: "local_vad" | "empty_input" | null;
  threshold: number;
  noiseFloor: number;
  endpointSilenceMs: number;
}

const DEFAULT_OPTIONS: LocalVadOptions = {
  speechThreshold: 0.018,
  minSpeechMs: 200,
  endpointSilenceMs: 900,
  initialSilenceTimeoutMs: 10_000,
  adaptive: true,
  noiseMultiplier: 3.2,
  maxAdaptiveThreshold: 0.12,
};

export class LocalVoiceActivityDetector {
  readonly options: LocalVadOptions;
  #elapsedMs = 0;
  #speechMs = 0;
  #silenceAfterSpeechMs = 0;
  #speechDetected = false;
  #terminal = false;
  #noiseFloor = 0;
  #noiseSamples = 0;
  #voicedMs = 0;

  constructor(options: Partial<LocalVadOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    if (this.options.speechThreshold <= 0 || this.options.speechThreshold >= 1) throw new Error("speechThreshold must be between zero and one.");
    if (this.options.noiseMultiplier <= 1 || this.options.maxAdaptiveThreshold <= this.options.speechThreshold) throw new Error("Adaptive VAD thresholds are invalid.");
    for (const key of ["minSpeechMs", "endpointSilenceMs", "initialSilenceTimeoutMs"] as const) {
      if (!Number.isFinite(this.options[key]) || this.options[key] <= 0) throw new Error(`${key} must be positive.`);
    }
  }

  observe(samples: Int16Array, durationMs: number): LocalVadResult {
    if (this.#terminal) return this.#result(0, null);
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("VAD duration must be positive.");
    const level = pcm16Rms(samples);
    this.#elapsedMs += durationMs;
    const threshold = this.#threshold();
    const calibratingNoise = this.options.adaptive && this.#noiseSamples < 5 && level < Math.max(0.05, this.options.speechThreshold * 3);
    if (calibratingNoise) {
      this.#speechMs = 0;
      this.#observeNoise(level);
    } else if (level >= threshold) {
      this.#speechMs += durationMs;
      this.#voicedMs += durationMs;
      this.#silenceAfterSpeechMs = 0;
      if (this.#speechMs >= this.options.minSpeechMs) this.#speechDetected = true;
    } else if (this.#speechDetected) {
      this.#silenceAfterSpeechMs += durationMs;
    } else {
      this.#speechMs = 0;
      this.#observeNoise(level);
    }
    let endpoint: LocalVadResult["endpoint"] = null;
    if (this.#speechDetected && this.#silenceAfterSpeechMs >= this.#adaptiveEndpointSilenceMs()) endpoint = "local_vad";
    else if (!this.#speechDetected && this.#elapsedMs >= this.options.initialSilenceTimeoutMs) endpoint = "empty_input";
    if (endpoint) this.#terminal = true;
    return this.#result(level, endpoint);
  }

  reset(): void { this.#elapsedMs = 0; this.#speechMs = 0; this.#silenceAfterSpeechMs = 0; this.#speechDetected = false; this.#terminal = false; this.#noiseFloor = 0; this.#noiseSamples = 0; this.#voicedMs = 0; }

  #observeNoise(level: number): void {
    if (!this.options.adaptive || level > this.options.maxAdaptiveThreshold) return;
    const alpha = this.#noiseSamples < 5 ? 1 / (this.#noiseSamples + 1) : 0.08;
    this.#noiseFloor += (level - this.#noiseFloor) * alpha;
    this.#noiseSamples += 1;
  }

  #threshold(): number {
    if (!this.options.adaptive || this.#noiseSamples === 0) return this.options.speechThreshold;
    return Math.min(this.options.maxAdaptiveThreshold, Math.max(this.options.speechThreshold, this.#noiseFloor * this.options.noiseMultiplier));
  }

  #adaptiveEndpointSilenceMs(): number {
    if (!this.options.adaptive) return this.options.endpointSilenceMs;
    const language = this.options.languageHint?.toLowerCase() ?? "";
    const languageFactor = /^(zh|ja|ko)/.test(language) ? 0.85 : 1;
    const activeMs = Math.max(1, this.#elapsedMs - this.#silenceAfterSpeechMs);
    const speechDensity = this.#voicedMs / activeMs;
    const rateFactor = speechDensity >= 0.75 ? 0.8 : speechDensity <= 0.35 ? 1.2 : 1;
    return Math.max(450, Math.min(1_500, this.options.endpointSilenceMs * languageFactor * rateFactor));
  }

  #result(level: number, endpoint: LocalVadResult["endpoint"]): LocalVadResult {
    return { level, speechDetected: this.#speechDetected, endpoint, threshold: this.#threshold(), noiseFloor: this.#noiseFloor, endpointSilenceMs: this.#adaptiveEndpointSilenceMs() };
  }
}

export function pcm16Rms(samples: Int16Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) { const normalized = sample / 32768; sum += normalized * normalized; }
  return Math.sqrt(sum / samples.length);
}

export function resolveEndpointReason(reasons: Array<"provider" | "local_vad" | "manual">): "provider" | "local_vad" | "manual" | null {
  if (reasons.includes("manual")) return "manual";
  if (reasons.includes("provider")) return "provider";
  if (reasons.includes("local_vad")) return "local_vad";
  return null;
}
