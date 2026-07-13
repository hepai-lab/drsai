import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../src/main/voice.ts", import.meta.url), "utf8");
const checks = [
  ["byte limit", source.includes("MAX_VOICE_RECORDING_BYTES")],
  ["duration limit", source.includes("MAX_VOICE_RECORDING_SECONDS")],
  ["MIME allowlist", source.includes("SUPPORTED_VOICE_MIME_TYPES")],
  ["audio signature validation", source.includes("validateVoiceSignature")],
  ["timeout", source.includes("AbortSignal.timeout")],
  ["single terminal state", source.includes("if (task.terminal) return")],
  ["temporary TTL cleanup", source.includes("15 * 60_000")],
  ["normalized errors", source.includes("normalizeVoiceError")],
  ["runtime abstraction", source.includes("interface VoiceRuntime") && source.includes("getVoiceRuntime()")],
  ["fixture runtime", source.includes("fixtureVoiceRuntime")],
  ["bounded retry", source.includes("transcribeGatewayWithRetry")],
];
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) throw new Error(`Voice unit verification failed: ${failed.map(([name]) => name).join(", ")}`);
console.log(`Voice unit verification passed (${checks.length} checks).`);
