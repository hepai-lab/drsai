import assert from "node:assert/strict";
const { LocalVoiceActivityDetector, pcm16Rms, resolveEndpointReason } = await import("../../shared/renderer/src/voice/streaming/localVad.ts");
const samples = (amplitude, length = 1_600) => Int16Array.from({ length }, (_, index) => Math.round(Math.sin(index / 5) * amplitude));
assert.equal(pcm16Rms(new Int16Array(100)), 0);
assert.ok(pcm16Rms(samples(16_000)) > 0.3);

const vad = new LocalVoiceActivityDetector({ minSpeechMs: 200, endpointSilenceMs: 800, initialSilenceTimeoutMs: 2_000 });
assert.equal(vad.observe(samples(12_000), 100).speechDetected, false);
assert.equal(vad.observe(samples(12_000), 100).speechDetected, true);
for (let index = 0; index < 7; index += 1) assert.equal(vad.observe(samples(0), 100).endpoint, null);
assert.equal(vad.observe(samples(0), 100).endpoint, "local_vad");
assert.equal(vad.observe(samples(12_000), 100).endpoint, null, "terminal VAD must not endpoint twice");
vad.reset();
assert.equal(vad.observe(samples(12_000), 200).speechDetected, true);

const noise = new LocalVoiceActivityDetector({ speechThreshold: 0.05, initialSilenceTimeoutMs: 500 });
for (let index = 0; index < 4; index += 1) assert.equal(noise.observe(samples(300), 100).endpoint, null);
assert.equal(noise.observe(samples(300), 100).endpoint, "empty_input");
assert.equal(resolveEndpointReason(["local_vad", "provider", "manual"]), "manual");
assert.equal(resolveEndpointReason(["local_vad", "provider"]), "provider");
assert.equal(resolveEndpointReason(["local_vad"]), "local_vad");
assert.equal(resolveEndpointReason([]), null);

console.log("Local VAD tests passed (RMS, speech qualification, pause tolerance, endpoint silence, empty input, reset, and endpoint priority).");
