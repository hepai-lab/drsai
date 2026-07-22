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
}

const ALLOWED_METRICS = new Set<keyof StreamingVoiceDiagnosticMetrics>([
  "sequence", "bufferedAudioMs", "partialCount", "finalCount", "segmentCount",
  "playedSegmentCount", "latencyMs", "paused",
]);

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
