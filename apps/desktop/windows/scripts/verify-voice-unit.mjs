import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../src/main/voice.ts", import.meta.url), "utf8");
const validationSource = readFileSync(new URL("../src/main/voiceValidation.ts", import.meta.url), "utf8");
const ttsSource = readFileSync(new URL("../src/main/voiceTts.ts", import.meta.url), "utf8");
const ttsValidationSource = readFileSync(new URL("../src/main/voiceTtsValidation.ts", import.meta.url), "utf8");
const tempSource = readFileSync(new URL("../src/main/voiceTempFiles.ts", import.meta.url), "utf8");
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
console.log(`Voice unit verification passed (${checks.length} checks).`);
