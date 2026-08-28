import assert from "node:assert/strict";

const {
  DEFAULT_VOICE_MODE,
  canSwitchVoiceMode,
  deriveVoiceModeCapabilities,
  getVoiceModeAvailability,
  normalizeVoiceInteractionMode,
  resolveVoiceModeSelection,
} = await import("../../shared/renderer/src/voice/voiceMode.ts");

assert.equal(DEFAULT_VOICE_MODE, "serial");
assert.equal(normalizeVoiceInteractionMode("serial"), "serial");
assert.equal(normalizeVoiceInteractionMode("streaming"), "serial");
assert.equal(normalizeVoiceInteractionMode("duplex"), "duplex");
assert.equal(normalizeVoiceInteractionMode("future-mode"), "serial");
assert.equal(normalizeVoiceInteractionMode(null), "serial");

const serialRuntime = {
  runtimeId: "mock-local",
  state: "ready",
  supportedMimeTypes: ["audio/wav"],
  maxBytes: 1024,
  maxDurationSeconds: 60,
  supportsPartial: false,
  providerDisclosure: "fixture",
  message: "ready",
};
const serialCapabilities = deriveVoiceModeCapabilities(serialRuntime, { audioWorklet: true });
assert.deepEqual(serialCapabilities, {
  audioWorklet: true,
  serialStt: true,
  serialTts: true,
  duplex: false,
});
assert.deepEqual(getVoiceModeAvailability("serial", serialCapabilities), { available: true, reason: null });
assert.deepEqual(Object.keys(serialCapabilities).sort(), ["audioWorklet", "duplex", "serialStt", "serialTts"], "public capability projection contains only serial and duplex products");
assert.match(getVoiceModeAvailability("streaming", serialCapabilities).reason, /unsupported/i);
const duplexProviderCapabilities = {
  protocolVersion: 2,
  inputAudioEncodings: ["pcm_s16le"],
  outputAudioEncodings: ["pcm_s16le"],
  inputSampleRatesHz: [24_000],
  outputSampleRatesHz: [24_000],
  supportsInputTranscription: true,
  supportsOutputTranscription: true,
  supportsServerVad: true,
  supportsResponseCancel: true,
  supportsConversationTruncation: true,
  supportsToolCalling: true,
  supportsSessionResume: false,
  maxUplinkBufferedAudioMs: 2_000,
  maxPlaybackBufferedAudioMs: 3_000,
};
const duplexCapabilities = deriveVoiceModeCapabilities(serialRuntime, {
  audioWorklet: true,
  duplexEnabled: true,
  duplexCapabilities: duplexProviderCapabilities,
});
assert.equal(duplexCapabilities.duplex, true);
assert.deepEqual(getVoiceModeAvailability("duplex", duplexCapabilities), { available: true, reason: null });
assert.match(getVoiceModeAvailability("duplex", { ...duplexCapabilities, audioWorklet: false }).reason, /AudioWorklet/);
assert.match(
  getVoiceModeAvailability("streaming", duplexCapabilities).reason,
  /unsupported/i,
);

for (const phase of ["idle", "completed", "failed"]) assert.equal(canSwitchVoiceMode(phase), true, phase);
for (const phase of ["requesting_permission", "recording", "transcribing", "reviewing", "submitting", "awaiting_response", "synthesizing", "playing", "paused", "cancelling"]) {
  assert.equal(canSwitchVoiceMode(phase), false, phase);
}

assert.equal(normalizeVoiceInteractionMode("streaming"), "serial", "legacy streaming selections migrate to single voice input");
assert.deepEqual(resolveVoiceModeSelection("duplex", "serial", "idle", duplexCapabilities), {
  accepted: true,
  mode: "duplex",
  reason: null,
});
const activeRejection = resolveVoiceModeSelection("duplex", "serial", "recording", duplexCapabilities);
assert.equal(activeRejection.accepted, false);
assert.equal(activeRejection.mode, "serial");
assert.match(activeRejection.reason, /active voice turn/i);
const capabilityRejection = resolveVoiceModeSelection("duplex", "serial", "idle", serialCapabilities);
assert.equal(capabilityRejection.accepted, false);
assert.equal(capabilityRejection.mode, "serial");
assert.deepEqual(resolveVoiceModeSelection("serial", "serial", "recording", serialCapabilities), {
  accepted: true,
  mode: "serial",
  reason: null,
});

console.log("Voice mode verification passed (default, migration normalization, capability gating, and turn switching)." );
