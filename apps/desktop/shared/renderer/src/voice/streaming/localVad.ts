export interface LocalVadOptions {
  speechThreshold: number;
  minSpeechMs: number;
  endpointSilenceMs: number;
  initialSilenceTimeoutMs: number;
}

export interface LocalVadResult {
  level: number;
  speechDetected: boolean;
  endpoint: "local_vad" | "empty_input" | null;
}

const DEFAULT_OPTIONS: LocalVadOptions = {
  speechThreshold: 0.018,
  minSpeechMs: 200,
  endpointSilenceMs: 900,
  initialSilenceTimeoutMs: 10_000,
};

export class LocalVoiceActivityDetector {
  readonly options: LocalVadOptions;
  #elapsedMs = 0;
  #speechMs = 0;
  #silenceAfterSpeechMs = 0;
  #speechDetected = false;
  #terminal = false;

  constructor(options: Partial<LocalVadOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    if (this.options.speechThreshold <= 0 || this.options.speechThreshold >= 1) throw new Error("speechThreshold must be between zero and one.");
    for (const key of ["minSpeechMs", "endpointSilenceMs", "initialSilenceTimeoutMs"] as const) {
      if (!Number.isFinite(this.options[key]) || this.options[key] <= 0) throw new Error(`${key} must be positive.`);
    }
  }

  observe(samples: Int16Array, durationMs: number): LocalVadResult {
    if (this.#terminal) return { level: 0, speechDetected: this.#speechDetected, endpoint: null };
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("VAD duration must be positive.");
    const level = pcm16Rms(samples);
    this.#elapsedMs += durationMs;
    if (level >= this.options.speechThreshold) {
      this.#speechMs += durationMs;
      this.#silenceAfterSpeechMs = 0;
      if (this.#speechMs >= this.options.minSpeechMs) this.#speechDetected = true;
    } else if (this.#speechDetected) {
      this.#silenceAfterSpeechMs += durationMs;
    } else {
      this.#speechMs = 0;
    }
    let endpoint: LocalVadResult["endpoint"] = null;
    if (this.#speechDetected && this.#silenceAfterSpeechMs >= this.options.endpointSilenceMs) endpoint = "local_vad";
    else if (!this.#speechDetected && this.#elapsedMs >= this.options.initialSilenceTimeoutMs) endpoint = "empty_input";
    if (endpoint) this.#terminal = true;
    return { level, speechDetected: this.#speechDetected, endpoint };
  }

  reset(): void { this.#elapsedMs = 0; this.#speechMs = 0; this.#silenceAfterSpeechMs = 0; this.#speechDetected = false; this.#terminal = false; }
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
