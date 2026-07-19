import type {
  DesktopVoiceAudioFormat,
  DesktopVoiceError,
  DesktopVoiceSynthesisRequest,
} from "../shared/desktopApi";

export const MAX_TTS_TEXT_CHARS = 12_000;
export const MAX_TTS_AUDIO_BYTES = 10 * 1024 * 1024;
export const SUPPORTED_TTS_FORMATS: DesktopVoiceAudioFormat[] = ["mp3", "wav", "opus"];

export type NormalizedVoiceSynthesisRequest = DesktopVoiceSynthesisRequest & Required<
  Pick<DesktopVoiceSynthesisRequest, "text" | "speed" | "format">
>;

export function normalizeVoiceSynthesisRequest(request: DesktopVoiceSynthesisRequest): NormalizedVoiceSynthesisRequest {
  const text = typeof request.text === "string" ? request.text.trim() : "";
  if (!text) throw validationFailure("provider_error", "Voice synthesis text is required.");
  if (text.length > MAX_TTS_TEXT_CHARS) {
    throw validationFailure("provider_error", `Voice synthesis text exceeds ${MAX_TTS_TEXT_CHARS} characters.`);
  }
  const speed = request.speed ?? 1;
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
    throw validationFailure("provider_error", "Voice synthesis speed must be between 0.5 and 2.");
  }
  const format = request.format ?? "mp3";
  if (!SUPPORTED_TTS_FORMATS.includes(format)) {
    throw validationFailure("unsupported_format", "Unsupported voice synthesis audio format.");
  }
  return { ...request, text, speed, format };
}

export async function readBoundedVoiceAudio(response: Response): Promise<Uint8Array> {
  if (!response.body) return assertAudioSize(new Uint8Array(await response.arrayBuffer()));
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > MAX_TTS_AUDIO_BYTES) {
        await reader.cancel("Voice synthesis response exceeded the 10 MB limit.");
        throw validationFailure("provider_error", "Voice synthesis response exceeded the 10 MB limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return assertAudioSize(result);
}

export function normalizeAndValidateTtsAudio(
  audioData: Uint8Array,
  contentType: string | null,
  format: DesktopVoiceAudioFormat,
): string {
  assertAudioSize(audioData);
  const rawMimeType = contentType?.split(";", 1)[0].trim().toLowerCase();
  const fallback = format === "wav" ? "audio/wav" : format === "opus" ? "audio/ogg" : "audio/mpeg";
  const mimeType = rawMimeType || fallback;
  const normalized = mimeType === "audio/mp3"
    ? "audio/mpeg"
    : mimeType === "audio/x-wav"
      ? "audio/wav"
      : mimeType === "audio/opus"
        ? "audio/ogg"
        : mimeType;
  const expected = format === "wav" ? "audio/wav" : format === "opus" ? "audio/ogg" : "audio/mpeg";
  if (normalized !== expected) {
    throw validationFailure("unsupported_format", `Voice synthesis returned ${mimeType}, expected ${expected}.`);
  }
  const ascii = (start: number, length: number): string =>
    String.fromCharCode(...audioData.slice(start, start + length));
  const valid = normalized === "audio/wav"
    ? ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE"
    : normalized === "audio/ogg"
      ? ascii(0, 4) === "OggS"
      : ascii(0, 3) === "ID3" || (audioData[0] === 0xff && (audioData[1] & 0xe0) === 0xe0);
  if (!valid) {
    throw validationFailure("unsupported_format", "Voice synthesis audio did not match its declared format.");
  }
  return normalized;
}

function assertAudioSize(audioData: Uint8Array): Uint8Array {
  if (!audioData.length) throw validationFailure("provider_error", "Voice synthesis provider returned empty audio.", true);
  if (audioData.length > MAX_TTS_AUDIO_BYTES) {
    throw validationFailure("provider_error", "Voice synthesis response exceeded the 10 MB limit.");
  }
  return audioData;
}

function validationFailure(code: DesktopVoiceError["code"], message: string, retryable = false): DesktopVoiceError {
  return { code, message, retryable };
}
