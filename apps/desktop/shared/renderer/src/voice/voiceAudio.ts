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

export function getVoicePermissionError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone permission was denied.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No microphone was found.";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "The microphone is already in use or unavailable.";
    }
  }
  return error instanceof Error ? error.message : "Unable to start voice recording.";
}

export function getVoiceStatusLabel(state: VoiceRecordingState, elapsedSeconds: number): string {
  if (state === "requesting_permission") return "Requesting microphone permission...";
  if (state === "recording") return `Recording ${formatVoiceDuration(elapsedSeconds)}`;
  if (state === "processing") return "Preparing voice transcript...";
  if (state === "failed") return "Voice input needs attention.";
  return "";
}

export function formatVoiceDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}
