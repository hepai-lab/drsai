import type { DesktopVoiceError, DesktopVoiceTranscriptionRequest } from "../shared/desktopApi";

export const MAX_VOICE_RECORDING_BYTES = 10 * 1024 * 1024;
export const MAX_VOICE_RECORDING_SECONDS = 120;
export const SUPPORTED_VOICE_MIME_TYPES = ["audio/webm", "audio/ogg", "audio/wav", "audio/mp4", "audio/mpeg"] as const;

export function decodeVoiceAudioData(request: DesktopVoiceTranscriptionRequest): Uint8Array {
  const bytes = request.audioData instanceof Uint8Array ? request.audioData : new Uint8Array();
  if (!bytes.length) throw validationFailure("empty_audio", "Voice recording was empty.");
  if (bytes.length > MAX_VOICE_RECORDING_BYTES) {
    throw validationFailure("audio_too_large", "Voice recording exceeds the 10 MB limit.");
  }
  return bytes;
}

export function clampVoiceDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw validationFailure("duration_exceeded", "Voice recording duration is required.");
  }
  if (value > MAX_VOICE_RECORDING_SECONDS) {
    throw validationFailure("duration_exceeded", "Voice recording exceeds the 120 second desktop limit.");
  }
  return Math.round(value * 1000) / 1000;
}

export function normalizeVoiceMimeType(value: string): string {
  const mimeType = typeof value === "string" ? value.split(";", 1)[0].trim().toLowerCase() : "";
  if (!mimeType || value.length > 120 || !SUPPORTED_VOICE_MIME_TYPES.includes(mimeType as typeof SUPPORTED_VOICE_MIME_TYPES[number])) {
    throw validationFailure("unsupported_format", mimeType ? `Unsupported voice format: ${mimeType}.` : "Voice MIME type is required.");
  }
  return mimeType;
}

export function validateVoiceSignature(audio: Uint8Array, mimeType: string): void {
  const ascii = (start: number, length: number): string =>
    String.fromCharCode(...audio.slice(start, start + length));
  const valid = mimeType === "audio/webm"
    ? audio.length >= 4 && audio[0] === 0x1a && audio[1] === 0x45 && audio[2] === 0xdf && audio[3] === 0xa3
    : mimeType === "audio/ogg"
      ? ascii(0, 4) === "OggS"
      : mimeType === "audio/wav"
        ? ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE"
        : mimeType === "audio/mp4"
          ? ascii(4, 4) === "ftyp"
          : mimeType === "audio/mpeg"
            ? ascii(0, 3) === "ID3" || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0)
            : false;
  if (!valid) {
    throw validationFailure("unsupported_format", "The recording content does not match its declared audio format.");
  }
}

function validationFailure(code: DesktopVoiceError["code"], message: string): DesktopVoiceError {
  return { code, message, retryable: false };
}
