import assert from "node:assert/strict";
import {
  clampVoiceDuration,
  decodeVoiceAudioData,
  MAX_VOICE_RECORDING_BYTES,
  normalizeVoiceMimeType,
  validateVoiceSignature,
} from "../src/main/voiceValidation.ts";

const request = (audioData) => ({ audioData, durationSeconds: 1, mimeType: "audio/webm" });
const expectCode = (code) => (error) => error?.code === code;

assert.equal(decodeVoiceAudioData(request(new Uint8Array(MAX_VOICE_RECORDING_BYTES - 1))).length, MAX_VOICE_RECORDING_BYTES - 1);
assert.equal(decodeVoiceAudioData(request(new Uint8Array(MAX_VOICE_RECORDING_BYTES))).length, MAX_VOICE_RECORDING_BYTES);
assert.throws(() => decodeVoiceAudioData(request(new Uint8Array(MAX_VOICE_RECORDING_BYTES + 1))), expectCode("audio_too_large"));
assert.throws(() => decodeVoiceAudioData(request(new Uint8Array())), expectCode("empty_audio"));

assert.equal(clampVoiceDuration(0.3754), 0.375);
assert.equal(clampVoiceDuration(120), 120);
assert.throws(() => clampVoiceDuration(120.001), expectCode("duration_exceeded"));
assert.throws(() => clampVoiceDuration(-1), expectCode("duration_exceeded"));
assert.throws(() => clampVoiceDuration(Number.NaN), expectCode("duration_exceeded"));

assert.equal(normalizeVoiceMimeType("audio/WebM;codecs=opus"), "audio/webm");
assert.throws(() => normalizeVoiceMimeType("audio/flac"), expectCode("unsupported_format"));
assert.throws(() => normalizeVoiceMimeType(""), expectCode("unsupported_format"));

const signatures = [
  ["audio/webm", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])],
  ["audio/ogg", new TextEncoder().encode("OggS")],
  ["audio/wav", new TextEncoder().encode("RIFF0000WAVE")],
  ["audio/mp4", new TextEncoder().encode("0000ftyp")],
  ["audio/mpeg", new TextEncoder().encode("ID3")],
  ["audio/mpeg", new Uint8Array([0xff, 0xe3])],
];
for (const [mimeType, bytes] of signatures) validateVoiceSignature(bytes, mimeType);
for (const mimeType of ["audio/webm", "audio/ogg", "audio/wav", "audio/mp4", "audio/mpeg"]) {
  assert.throws(() => validateVoiceSignature(new Uint8Array([1, 2, 3, 4]), mimeType), expectCode("unsupported_format"));
}

console.log("Voice validation behavior tests passed (byte, duration, MIME, and signature boundaries).");
