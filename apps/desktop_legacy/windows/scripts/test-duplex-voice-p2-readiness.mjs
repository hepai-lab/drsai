import assert from "node:assert/strict";
import { buildDuplexVoiceReadiness, hasUsableDuplexCredential } from "../../shared/main/voice/duplex/readiness.ts";

const readyInput = {
  rolloutReady: true,
  gatewayReady: true,
  credentialReady: true,
  providerId: "zhizengzeng",
  modelId: "gpt-realtime-2",
  capabilities: {
    protocolVersion: 2, inputAudioEncodings: ["pcm_s16le"], outputAudioEncodings: ["pcm_s16le"], inputSampleRatesHz: [24_000], outputSampleRatesHz: [24_000],
    supportsInputTranscription: true, supportsOutputTranscription: true, supportsServerVad: true, supportsResponseCancel: true, supportsConversationTruncation: true, supportsToolCalling: true, supportsSessionResume: false,
    maxUplinkBufferedAudioMs: 2_000, maxPlaybackBufferedAudioMs: 3_000,
  },
  checkedAt: "2026-08-14T00:00:00.000Z",
  liveProbe: {
    status: "verified",
    provider_id: "zhizengzeng",
    model_id: "gpt-realtime-2",
    checked_at: "2026-08-13T23:59:55.000Z",
    expires_at: "2026-08-14T00:05:00.000Z",
    evidence_kind: "real_provider",
    capabilities: { input_transcription: true, output_transcription: true, server_vad: true, response_cancel: true, conversation_truncation: true, tool_calling: true },
  },
};

const ready = buildDuplexVoiceReadiness(readyInput);
assert.equal(hasUsableDuplexCredential(true, null), true, "OIDC Gateway sessions carry a bearer credential");
assert.equal(hasUsableDuplexCredential(false, readyInput.liveProbe), true, "a verified local Provider probe proves its saved credential works");
assert.equal(hasUsableDuplexCredential(false, { ...readyInput.liveProbe, status: "unavailable" }), false);
assert.equal(hasUsableDuplexCredential(false, null), false);
assert.equal(ready.available, true);
assert.equal(ready.reasonCode, "ready");
assert.equal(ready.checks.length, 6);
assert.ok(ready.checks.every((check) => check.ready));
assert.equal(ready.capabilities?.supportsResponseCancel, true);

for (const [field, value, reasonCode] of [
  ["rolloutReady", false, "rollout_disabled"],
  ["gatewayReady", false, "gateway_unavailable"],
  ["credentialReady", false, "credential_unavailable"],
]) {
  const result = buildDuplexVoiceReadiness({ ...readyInput, [field]: value });
  assert.equal(result.available, false, field);
  assert.equal(result.reasonCode, reasonCode, field);
  assert.equal(result.capabilities, null, field);
}

assert.equal(buildDuplexVoiceReadiness({ ...readyInput, providerId: null, modelId: null }).reasonCode, "model_unconfigured");
assert.equal(buildDuplexVoiceReadiness({ ...readyInput, credentialReady: false, providerId: null, modelId: null }).reasonCode, "model_unconfigured", "actionable model configuration must not be masked by a credential check that depends on the model probe");
assert.equal(buildDuplexVoiceReadiness({ ...readyInput, providerId: "other" }).reasonCode, "provider_unsupported");
assert.equal(buildDuplexVoiceReadiness({ ...readyInput, modelId: "gpt-4.1" }).reasonCode, "model_unsupported");
assert.equal(buildDuplexVoiceReadiness({ ...readyInput, liveProbe: null }).reasonCode, "capability_unverified");
assert.equal(buildDuplexVoiceReadiness({ ...readyInput, liveProbe: { ...readyInput.liveProbe, expires_at: "2026-08-13T23:59:59.000Z" } }).reasonCode, "capability_unverified");
assert.equal(buildDuplexVoiceReadiness({ ...readyInput, liveProbe: { ...readyInput.liveProbe, model_id: "other" } }).reasonCode, "capability_unverified");
const partial = buildDuplexVoiceReadiness({ ...readyInput, liveProbe: { ...readyInput.liveProbe, capabilities: { ...readyInput.liveProbe.capabilities, tool_calling: false } } });
assert.equal(partial.available, true);
assert.equal(partial.capabilities?.supportsToolCalling, false);
assert.equal(buildDuplexVoiceReadiness({ ...readyInput, modelId: "vendor/gpt-realtime-2", liveProbe: { ...readyInput.liveProbe, model_id: "vendor/gpt-realtime-2" } }).available, true);

console.log("Duplex Voice P2 readiness verified (ordered fail-closed checks, fresh live evidence, and capability intersection).");
