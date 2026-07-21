import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";

const fixture = process.env.OPENDRSAI_VOICE_LIVE_FIXTURE;
const streamingMode = process.argv.includes("--streaming");
const fullRoundMode = process.argv.includes("--full-round");
assert.ok(fixture, "Set OPENDRSAI_VOICE_LIVE_FIXTURE to an authorized WAV, WebM, Ogg, MP3, M4A, or MP4 fixture.");
assert.ok(existsSync(fixture), `Voice live fixture does not exist: ${fixture}`);
const fixtureSize = statSync(fixture).size;
assert.ok(fixtureSize > 0 && fixtureSize <= 10 * 1024 * 1024, "Voice live fixture must be between 1 byte and 10 MB.");
assert.ok(process.env.HEPAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim(), "Set HEPAI_API_KEY or OPENAI_API_KEY for live voice smoke.");
if (streamingMode) {
  assert.ok(process.env.OPENDRSAI_STREAMING_STT_WS_URL?.trim(), "Set OPENDRSAI_STREAMING_STT_WS_URL for production streaming ASR smoke.");
  process.env.OPENDRSAI_E2E_VOICE_STREAMING = "1";
}
if (fullRoundMode) process.env.OPENDRSAI_E2E_VOICE_FULL_ROUND = "1";

await import("./verify-packaged-voice.mjs");
