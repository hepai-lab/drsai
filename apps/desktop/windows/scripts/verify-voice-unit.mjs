import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { getVoiceProviderReadiness } from "../../shared/main/voiceProviderReadiness.ts";
const source = readFileSync(new URL("../../shared/main/voice.ts", import.meta.url), "utf8");
const validationSource = readFileSync(new URL("../../shared/main/voiceValidation.ts", import.meta.url), "utf8");
const ttsSource = readFileSync(new URL("../../shared/main/voiceTts.ts", import.meta.url), "utf8");
const ttsValidationSource = readFileSync(new URL("../../shared/main/voiceTtsValidation.ts", import.meta.url), "utf8");
const tempSource = readFileSync(new URL("../../shared/main/voiceTempFiles.ts", import.meta.url), "utf8");
const checks = [
  ["byte limit", validationSource.includes("MAX_VOICE_RECORDING_BYTES")],
  ["duration limit", validationSource.includes("MAX_VOICE_RECORDING_SECONDS")],
  ["MIME allowlist", validationSource.includes("SUPPORTED_VOICE_MIME_TYPES")],
  ["audio signature validation", validationSource.includes("validateVoiceSignature")],
  ["timeout", source.includes("AbortSignal.timeout")],
  ["single terminal state", source.includes("if (task.terminal) return")],
  ["temporary TTL cleanup", tempSource.includes("15 * 60_000")],
  ["explicit temporary cleanup", tempSource.includes("cleanupAllVoiceTempFiles")],
  ["STT sender listener cleanup", source.includes('removeListener("destroyed", handleSenderDestroyed)')],
  ["normalized errors", source.includes("normalizeVoiceError")],
  ["runtime abstraction", source.includes("interface VoiceRuntime") && source.includes("getVoiceRuntime()")],
  ["fixture runtime", source.includes("fixtureVoiceRuntime")],
  ["bounded retry", source.includes("transcribeGatewayWithRetry")],
  ["TTS text limit", ttsValidationSource.includes("MAX_TTS_TEXT_CHARS")],
  ["TTS audio limit", ttsValidationSource.includes("MAX_TTS_AUDIO_BYTES")],
  ["TTS timeout", ttsSource.includes("TTS_TIMEOUT_MS") && ttsSource.includes("AbortSignal.timeout")],
  ["TTS single terminal state", ttsSource.includes("if (task.terminal) return")],
  ["TTS per-window concurrency", ttsSource.includes("task.sender === sender")],
  ["TTS cancellation", ttsSource.includes("cancelVoiceSynthesis") && ttsSource.includes("controller.abort()")],
  ["TTS fixture", ttsSource.includes("synthesizeFixture") && ttsSource.includes("createSilentWav")],
  ["TTS provider", ttsSource.includes("/v1/audio/speech") && ttsSource.includes("synthesizeThroughGateway")],
  ["TTS sender listener cleanup", ttsSource.includes('removeListener("destroyed", handleSenderDestroyed)')],
];
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) throw new Error(`Voice unit verification failed: ${failed.map(([name]) => name).join(", ")}`);

const response = (body, ok = true) => ({ ok, json: async () => body });
const fetcher = async (url) => url.endsWith("/models")
  ? response({
      effective_speech_to_text_ref: { provider_id: "zhizengzeng", model_id: "whisper-1" },
      effective_text_to_speech_ref: { provider_id: "zhizengzeng", model_id: "tts-1" },
    })
  : response({ providers: [{ name: "zhizengzeng", requires_api_key: true, has_api_key: true }] });
assert.deepEqual(
  await getVoiceProviderReadiness("http://127.0.0.1:28642", {}, "speech_to_text", fetcher),
  { state: "ready", providerId: "zhizengzeng", modelId: "whisper-1" },
);
assert.deepEqual(
  await getVoiceProviderReadiness("http://127.0.0.1:28642", {}, "text_to_speech", fetcher),
  { state: "ready", providerId: "zhizengzeng", modelId: "tts-1" },
);
const missingCredentialFetcher = async (url) => url.endsWith("/models")
  ? fetcher(url)
  : response({ providers: [{ name: "zhizengzeng", requires_api_key: true, has_api_key: false }] });
assert.equal(
  (await getVoiceProviderReadiness("http://127.0.0.1:28642", {}, "speech_to_text", missingCredentialFetcher)).state,
  "auth_required",
);

console.log(`Voice unit verification passed (${checks.length + 3} checks).`);
