import type {
  DesktopStreamingVoiceAudioChunk,
  DesktopStreamingVoiceStartRequest,
} from "../../api/desktopApi";

export const STREAMING_VOICE_SAMPLE_RATES_HZ = [16_000, 24_000, 48_000] as const;
export const MIN_STREAMING_FRAME_DURATION_MS = 10;
export const MAX_STREAMING_FRAME_DURATION_MS = 200;
export const MAX_STREAMING_AUDIO_CHUNK_BYTES = 48_000;

export function validateStreamingVoiceStartRequest(request: DesktopStreamingVoiceStartRequest): void {
  if (request.protocolVersion !== undefined && request.protocolVersion !== 1 && request.protocolVersion !== 2) throw new Error("Unsupported streaming voice protocol version.");
  if (!isSafeId(request.turnId)) throw new Error("A valid streaming voice turn ID is required.");
  if (request.encoding !== "pcm_s16le") throw new Error("Only pcm_s16le streaming audio is supported.");
  if (!STREAMING_VOICE_SAMPLE_RATES_HZ.includes(request.sampleRateHz as typeof STREAMING_VOICE_SAMPLE_RATES_HZ[number])) {
    throw new Error("Unsupported streaming voice sample rate.");
  }
  if (request.channels !== 1) throw new Error("Streaming voice requires mono audio.");
  if (!Number.isInteger(request.frameDurationMs)
    || request.frameDurationMs < MIN_STREAMING_FRAME_DURATION_MS
    || request.frameDurationMs > MAX_STREAMING_FRAME_DURATION_MS) {
    throw new Error("Streaming voice frame duration is outside the allowed range.");
  }
  if (request.languageHint !== undefined && (!request.languageHint.trim() || request.languageHint.length > 32)) {
    throw new Error("Invalid streaming voice language hint.");
  }
}

export function validateStreamingVoiceAudioChunk(
  chunk: DesktopStreamingVoiceAudioChunk,
  expected: Pick<DesktopStreamingVoiceStartRequest, "turnId" | "encoding" | "sampleRateHz" | "channels" | "protocolVersion"> & { sessionId: string },
): void {
  if ((chunk.protocolVersion ?? 1) !== (expected.protocolVersion ?? 1)) throw new Error("Streaming audio protocol version changed during the session.");
  if (!isSafeId(chunk.sessionId) || chunk.sessionId !== expected.sessionId) throw new Error("Streaming audio session mismatch.");
  if (!isSafeId(chunk.turnId) || chunk.turnId !== expected.turnId) throw new Error("Streaming audio turn mismatch.");
  if (!Number.isSafeInteger(chunk.sequence) || chunk.sequence < 0) throw new Error("Invalid streaming audio sequence.");
  if (!Number.isFinite(chunk.capturedAtMs) || chunk.capturedAtMs < 0) throw new Error("Invalid streaming audio capture timestamp.");
  if (!Number.isFinite(chunk.durationMs)
    || chunk.durationMs < MIN_STREAMING_FRAME_DURATION_MS
    || chunk.durationMs > MAX_STREAMING_FRAME_DURATION_MS) {
    throw new Error("Streaming audio duration is outside the allowed range.");
  }
  if (chunk.encoding !== expected.encoding || chunk.sampleRateHz !== expected.sampleRateHz || chunk.channels !== expected.channels) {
    throw new Error("Streaming audio format changed during the session.");
  }
  if (!(chunk.audioData instanceof Uint8Array) || chunk.audioData.byteLength === 0) throw new Error("Streaming audio data is empty.");
  if (chunk.audioData.byteLength > MAX_STREAMING_AUDIO_CHUNK_BYTES) throw new Error("Streaming audio chunk is too large.");
  if (chunk.audioData.byteLength % 2 !== 0) throw new Error("PCM16 streaming audio must contain complete samples.");
  const expectedBytes = Math.round(chunk.sampleRateHz * (chunk.durationMs / 1_000) * chunk.channels * 2);
  const toleranceBytes = Math.max(4, Math.round(chunk.sampleRateHz * 0.002 * 2));
  if (Math.abs(chunk.audioData.byteLength - expectedBytes) > toleranceBytes) {
    throw new Error("Streaming audio byte length does not match its declared duration.");
  }
}

function isSafeId(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
}
