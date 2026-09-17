import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_TTS_AUDIO_BYTES,
  normalizeAndValidateTtsAudio,
  normalizeVoiceSynthesisRequest,
  readBoundedVoiceAudio,
} from "../../shared/main/voiceTtsValidation.ts";

const expectCode = (code) => (error) => error?.code === code;

assert.deepEqual(normalizeVoiceSynthesisRequest({ text: "  hello  " }), { text: "hello", speed: 1, format: "mp3" });
assert.equal(normalizeVoiceSynthesisRequest({ text: "hello", speed: 0.5, format: "wav" }).speed, 0.5);
assert.equal(normalizeVoiceSynthesisRequest({ text: "hello", speed: 2, format: "opus" }).speed, 2);
assert.throws(() => normalizeVoiceSynthesisRequest({ text: "" }), expectCode("provider_error"));
assert.throws(() => normalizeVoiceSynthesisRequest({ text: "x".repeat(12_001) }), expectCode("provider_error"));
assert.throws(() => normalizeVoiceSynthesisRequest({ text: "hello", speed: 2.01 }), expectCode("provider_error"));

const mp3 = new TextEncoder().encode("ID3fixture");
const wav = new TextEncoder().encode("RIFF0000WAVEfixture");
const ogg = new TextEncoder().encode("OggSfixture");
assert.equal(normalizeAndValidateTtsAudio(mp3, "audio/mpeg", "mp3"), "audio/mpeg");
assert.equal(normalizeAndValidateTtsAudio(mp3, "audio/mp3; charset=binary", "mp3"), "audio/mpeg");
assert.equal(normalizeAndValidateTtsAudio(wav, "audio/x-wav", "wav"), "audio/wav");
assert.equal(normalizeAndValidateTtsAudio(ogg, "audio/opus", "opus"), "audio/ogg");
assert.throws(() => normalizeAndValidateTtsAudio(mp3, "text/html", "mp3"), expectCode("unsupported_format"));
assert.throws(() => normalizeAndValidateTtsAudio(mp3, "audio/wav", "wav"), expectCode("unsupported_format"));
assert.throws(() => normalizeAndValidateTtsAudio(new Uint8Array([1, 2, 3]), "audio/mpeg", "mp3"), expectCode("unsupported_format"));

const bounded = await readBoundedVoiceAudio(new Response(mp3));
assert.deepEqual(bounded, mp3);
await assert.rejects(readBoundedVoiceAudio(new Response(new Uint8Array())), expectCode("provider_error"));

let cancelled = false;
const oversizedStream = new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array(6 * 1024 * 1024));
    controller.enqueue(new Uint8Array(5 * 1024 * 1024));
  },
  cancel() { cancelled = true; },
});
await assert.rejects(
  readBoundedVoiceAudio(new Response(oversizedStream)),
  (error) => error?.code === "provider_error" && /10 MB/.test(error.message),
);
assert.equal(cancelled, true, "oversized TTS response stream must be cancelled before full buffering");
assert.equal(MAX_TTS_AUDIO_BYTES, 10 * 1024 * 1024);

const ttsRuntimeSource = readFileSync(new URL("../../shared/main/voiceTts.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../../shared/main/settings.ts", import.meta.url), "utf8");
const devLauncherSource = readFileSync(new URL("./dev.ps1", import.meta.url), "utf8");
assert.match(ttsRuntimeSource, /return "gateway-provider";/, "provider TTS must be the default task runtime");
assert.match(ttsRuntimeSource, /syncSavedApiKeyToGateway\(\)/, "saved TTS credentials must be synchronized before synthesis");
assert.match(settingsSource, /getGatewayRequestHeaders\(\)/, "credential sync must use the gateway instance token");
assert.match(devLauncherSource, /OPENDRSAI_VOICE_TTS_RUNTIME = "gateway-provider"/, "desktop dev must enable provider TTS explicitly");

console.log("Voice TTS validation tests passed (request, MIME, runtime, credential sync, and bounded streaming response).");
