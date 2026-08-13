import type { DiagnosticEventInput } from "@shared/desktopApi";

export type StreamingVoiceDiagnosticStage = "asr" | "llm" | "tts" | "playback" | "transport";

export interface StreamingVoiceDiagnosticMetrics {
  sequence?: number;
  bufferedAudioMs?: number;
  partialCount?: number;
  finalCount?: number;
  segmentCount?: number;
  playedSegmentCount?: number;
  latencyMs?: number;
  paused?: boolean;
  firstAudioAckMs?: number;
  firstPartialMs?: number;
  finalMs?: number;
  firstTtsMs?: number;
  firstPlaybackMs?: number;
  repairRate?: number;
  endpointErrorRate?: number;
  underrunRate?: number;
  recoveryRate?: number;
  audioUsageMs?: number;
  ttsCharacters?: number;
  connectionCount?: number;
}

const ALLOWED_METRICS = new Set<keyof StreamingVoiceDiagnosticMetrics>([
  "sequence", "bufferedAudioMs", "partialCount", "finalCount", "segmentCount",
  "playedSegmentCount", "latencyMs", "paused",
  "firstAudioAckMs", "firstPartialMs", "finalMs", "firstTtsMs", "firstPlaybackMs",
  "repairRate", "endpointErrorRate", "underrunRate", "recoveryRate",
  "audioUsageMs", "ttsCharacters", "connectionCount",
]);

export class StreamingVoiceSloTracker {
  readonly startedAt: number;
  readonly now: () => number;
  #marks = new Map<string, number>();
  constructor(now: () => number = () => performance.now()) { this.now = now; this.startedAt = now(); }
  mark(stage: "audio_ack" | "partial" | "final" | "tts" | "playback"): void {
    if (!this.#marks.has(stage)) this.#marks.set(stage, Math.max(this.startedAt, this.now()));
  }
  metrics(): StreamingVoiceDiagnosticMetrics {
    return {
      firstAudioAckMs: this.#elapsed("audio_ack"), firstPartialMs: this.#elapsed("partial"),
      finalMs: this.#elapsed("final"), firstTtsMs: this.#elapsed("tts"), firstPlaybackMs: this.#elapsed("playback"),
    };
  }
  #elapsed(stage: string): number | undefined { const value = this.#marks.get(stage); return value === undefined ? undefined : value - this.startedAt; }
}

export function streamingVoiceQualityMetrics(input: { turns: number; repaired: number; endpointErrors: number; underruns: number; recoveries: number }): StreamingVoiceDiagnosticMetrics {
  const denominator = Math.max(1, input.turns);
  return { repairRate: input.repaired / denominator, endpointErrorRate: input.endpointErrors / denominator, underrunRate: input.underruns / denominator, recoveryRate: input.recoveries / Math.max(1, input.underruns) };
}

export class StreamingVoiceCostBudget {
  readonly limits: { audioUsageMs: number; ttsCharacters: number; connectionCount: number };
  readonly usage = { audioUsageMs: 0, ttsCharacters: 0, connectionCount: 0 };
  constructor(limits: Partial<StreamingVoiceCostBudget["limits"]> = {}) { this.limits = { audioUsageMs: 120_000, ttsCharacters: 12_000, connectionCount: 4, ...limits }; }
  consume(delta: Partial<typeof this.usage>): boolean {
    const next = { audioUsageMs: this.usage.audioUsageMs + (delta.audioUsageMs ?? 0), ttsCharacters: this.usage.ttsCharacters + (delta.ttsCharacters ?? 0), connectionCount: this.usage.connectionCount + (delta.connectionCount ?? 0) };
    if (Object.keys(next).some((key) => next[key as keyof typeof next] < 0) || next.audioUsageMs > this.limits.audioUsageMs || next.ttsCharacters > this.limits.ttsCharacters || next.connectionCount > this.limits.connectionCount) return false;
    Object.assign(this.usage, next); return true;
  }
  metrics(): StreamingVoiceDiagnosticMetrics { return { ...this.usage }; }
}

export function streamingVoiceRecoveryAdvice(stage: StreamingVoiceDiagnosticStage, errorCode: string, retryable: boolean): { retry: boolean; fallbackMode: "serial" | null; messageKey: string } {
  if (retryable) return { retry: true, fallbackMode: null, messageKey: `voice.streaming.${stage}.retry` };
  const serial = stage === "asr" || stage === "transport";
  return { retry: false, fallbackMode: serial ? "serial" : null, messageKey: `voice.streaming.${stage}.${sanitizeErrorCode(errorCode) ?? "error"}` };
}

export function createStreamingVoiceDiagnostic(input: {
  traceId: string;
  turnId: string;
  stage: StreamingVoiceDiagnosticStage;
  status: "started" | "running" | "completed" | "failed" | "cancelled";
  metrics?: StreamingVoiceDiagnosticMetrics;
  errorCode?: string;
}): DiagnosticEventInput {
  const attributes: Record<string, string | number | boolean | null> = { mode: "streaming" };
  for (const [key, value] of Object.entries(input.metrics ?? {})) {
    if (ALLOWED_METRICS.has(key as keyof StreamingVoiceDiagnosticMetrics) && value !== undefined && isSafeMetric(value)) {
      attributes[key] = value;
    }
  }
  return {
    module: "voice",
    component: input.stage,
    operation: `voice.streaming.${input.stage}`,
    message: `Streaming voice ${input.stage} ${input.status}`,
    traceId: input.traceId,
    turnId: input.turnId,
    status: input.status,
    errorCode: sanitizeErrorCode(input.errorCode),
    attributes,
  };
}

export function containsForbiddenStreamingDiagnosticData(value: unknown): boolean {
  const serialized = JSON.stringify(value).toLowerCase();
  return ["audiodata", "transcript", "committedtext", "unstabletext", "apikey", "authorization", "token"].some((key) => serialized.includes(key));
}

function isSafeMetric(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

function sanitizeErrorCode(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^[a-z0-9_.-]{1,64}$/i.test(value) ? value : "streaming_voice_error";
}
