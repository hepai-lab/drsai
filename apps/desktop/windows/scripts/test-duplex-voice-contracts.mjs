import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../../shared/api/desktopApi.ts", import.meta.url), "utf8");
const mainBoundary = await import("../../shared/main/voice/duplex/index.ts");
const rendererBoundary = await import("../../shared/renderer/src/voice/duplex/index.ts");
const platformSource = readFileSync(new URL("../src/main/platform.ts", import.meta.url), "utf8");

assert.match(api, /DesktopVoiceInteractionMode = "serial" \| "streaming" \| "duplex"/);
assert.match(api, /DESKTOP_DUPLEX_VOICE_PROTOCOL_VERSION = 1/);
assert.match(api, /interface DesktopDuplexVoiceCapabilities/);
assert.match(api, /interface DesktopDuplexVoiceSessionStartRequest/);
assert.match(api, /interface DesktopDuplexVoiceAudioChunk/);
assert.match(api, /type DesktopDuplexVoiceEvent/);
for (const eventType of [
  "session_started", "connection_state", "input_audio_ack", "flow_control",
  "input_speech_started", "input_speech_stopped", "input_transcript_delta",
  "input_transcript_completed", "response_started", "response_audio_delta",
  "response_audio_completed", "response_transcript_delta", "response_transcript_completed",
  "tool_call", "usage_update", "diagnostic", "interrupted", "completed", "cancelled", "failed",
]) assert.ok(api.includes(`type: "${eventType}"`), `Duplex event contract omits ${eventType}`);
for (const errorCode of ["auth", "model", "protocol", "network", "device", "audio", "rate_limit", "policy", "cancelled", "internal"]) {
  assert.ok(api.includes(`| "${errorCode}"`) || api.includes(`=\n  | "${errorCode}"`), `Duplex error contract omits ${errorCode}`);
}

assert.equal(mainBoundary.DUPLEX_VOICE_ROUTE_IMPLEMENTED, true);
assert.equal(rendererBoundary.DUPLEX_VOICE_RENDERER_ROUTE_IMPLEMENTED, true);
assert.equal(mainBoundary.isDuplexVoiceEnabled({}), false);
assert.equal(mainBoundary.isDuplexVoiceEnabled({ OPENDRSAI_ENABLE_DUPLEX_VOICE: "0" }), false);
assert.equal(mainBoundary.isDuplexVoiceEnabled({ OPENDRSAI_ENABLE_DUPLEX_VOICE: "1" }), true);
assert.equal(mainBoundary.isDuplexVoiceEnabled({ OPENDRSAI_ENABLE_DUPLEX_VOICE: " true " }), false);
assert.match(platformSource, /duplexVoice: isDuplexVoiceEnabled\(\)/, "Windows feature capabilities must honor the Duplex feature flag");

console.log("Duplex voice M1 contracts verified (route boundary, protocol, capabilities, events, errors, and feature flag).");
