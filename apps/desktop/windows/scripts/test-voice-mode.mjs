import assert from "node:assert/strict";

const {
  DEFAULT_VOICE_MODE,
  canSwitchVoiceMode,
  deriveVoiceModeCapabilities,
  getStreamingVoiceOutputAvailability,
  getVoiceModeAvailability,
  normalizeVoiceInteractionMode,
  resolveVoiceModeSelection,
} = await import("../../shared/renderer/src/voice/voiceMode.ts");

assert.equal(DEFAULT_VOICE_MODE, "serial");
assert.equal(normalizeVoiceInteractionMode("serial"), "serial");
assert.equal(normalizeVoiceInteractionMode("streaming"), "streaming");
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
  streamingStt: false,
  streamingTts: false,
  duplex: false,
});
assert.deepEqual(getVoiceModeAvailability("serial", serialCapabilities), { available: true, reason: null });
assert.match(getVoiceModeAvailability("streaming", serialCapabilities).reason, /transcription runtime/i);

const streamingCapabilities = deriveVoiceModeCapabilities(
  { ...serialRuntime, supportsPartial: true },
  { audioWorklet: true, streamingTts: true },
);
assert.deepEqual(getVoiceModeAvailability("streaming", streamingCapabilities), { available: true, reason: null });
assert.match(getVoiceModeAvailability("duplex", streamingCapabilities).reason, /disabled|realtime model/i);
const negotiatedCapabilities = deriveVoiceModeCapabilities(serialRuntime, {
  audioWorklet: true,
  streamingCapabilities: {
    serialStt: true,
    serialTts: true,
    streamingStt: true,
    streamingTts: true,
    audioEncodings: ["pcm_s16le"],
    sampleRatesHz: [16_000],
    supportsPartialTranscripts: true,
    supportsProviderEndpointing: true,
    supportsSessionResume: false,
    maxBufferedAudioMs: 2_000,
  },
});
assert.equal(negotiatedCapabilities.streamingStt, true, "negotiated streaming support must override the serial runtime status");
assert.equal(negotiatedCapabilities.streamingTts, true);
assert.equal(negotiatedCapabilities.duplex, false);
const duplexProviderCapabilities = {
  protocolVersion: 1,
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
  getVoiceModeAvailability("streaming", { ...streamingCapabilities, audioWorklet: false }).reason,
  /AudioWorklet/,
);
assert.deepEqual(getVoiceModeAvailability("streaming", { ...streamingCapabilities, streamingTts: false }), {
  available: true,
  reason: null,
});
assert.match(
  getStreamingVoiceOutputAvailability({ ...streamingCapabilities, streamingTts: false }).reason,
  /completed speech playback/i,
);

for (const phase of ["idle", "completed", "failed"]) assert.equal(canSwitchVoiceMode(phase), true, phase);
for (const phase of ["requesting_permission", "recording", "transcribing", "reviewing", "submitting", "awaiting_response", "synthesizing", "playing", "paused", "cancelling"]) {
  assert.equal(canSwitchVoiceMode(phase), false, phase);
}

assert.deepEqual(resolveVoiceModeSelection("streaming", "serial", "idle", streamingCapabilities), {
  accepted: true,
  mode: "streaming",
  reason: null,
});
assert.deepEqual(resolveVoiceModeSelection("duplex", "serial", "idle", duplexCapabilities), {
  accepted: true,
  mode: "duplex",
  reason: null,
});
const activeRejection = resolveVoiceModeSelection("streaming", "serial", "recording", streamingCapabilities);
assert.equal(activeRejection.accepted, false);
assert.equal(activeRejection.mode, "serial");
assert.match(activeRejection.reason, /active voice turn/i);
const capabilityRejection = resolveVoiceModeSelection("streaming", "serial", "idle", serialCapabilities);
assert.equal(capabilityRejection.accepted, false);
assert.equal(capabilityRejection.mode, "serial");
assert.deepEqual(resolveVoiceModeSelection("serial", "serial", "recording", serialCapabilities), {
  accepted: true,
  mode: "serial",
  reason: null,
});

console.log("Voice mode verification passed (default, migration normalization, capability gating, and turn switching)." );
