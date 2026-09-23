export const VOICE_LEVEL_COUNT = 72;
export const VOICE_LEVEL_SAMPLE_INTERVAL_MS = 32;
export const VOICE_NOISE_FLOOR = 0.018;

export type VoiceRecordingState =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "processing"
  | "failed";

export function getPreferredVoiceMimeType(
  recorder: Pick<typeof MediaRecorder, "isTypeSupported"> | undefined = typeof MediaRecorder === "undefined"
    ? undefined
    : MediaRecorder,
): string | undefined {
  if (!recorder) return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/wav",
  ];
  return candidates.find((candidate) => recorder.isTypeSupported(candidate));
}

export function createSilentVoiceLevels(count = VOICE_LEVEL_COUNT): number[] {
  return Array.from({ length: count }, () => 0);
}

export function calculateVoiceLevel(samples: Float32Array, previousLevel: number): number {
  if (!samples.length) return 0;
  let sumOfSquares = 0;
  let peak = 0;
  for (const sample of samples) {
    sumOfSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const rms = Math.sqrt(sumOfSquares / samples.length);
  const signal = Math.max(rms * 2.8, peak * 0.75);
  const normalized = signal <= VOICE_NOISE_FLOOR
    ? 0
    : Math.min(1, (signal - VOICE_NOISE_FLOOR) / (0.5 - VOICE_NOISE_FLOOR));
  const attack = normalized > previousLevel ? 0.62 : 0.28;
  const smoothed = previousLevel + (normalized - previousLevel) * attack;
  return smoothed < 0.012 ? 0 : smoothed;
}

export { getVoicePermissionError } from "./voiceFailureCopy";

export function getVoiceStatusLabel(state: VoiceRecordingState, elapsedSeconds: number, zh = true): string {
  if (state === "requesting_permission") return zh ? "正在请求麦克风权限…" : "Requesting microphone permission...";
  if (state === "recording") return zh ? `正在录音 ${formatVoiceDuration(elapsedSeconds)}` : `Recording ${formatVoiceDuration(elapsedSeconds)}`;
  if (state === "processing") return zh ? "正在准备语音识别…" : "Preparing voice transcript...";
  if (state === "failed") return zh ? "语音输入需要处理" : "Voice input needs attention.";
  return "";
}

export function formatVoiceDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}
