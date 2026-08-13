import assert from "node:assert/strict";
const { LocalVoiceActivityDetector, pcm16Rms, resolveEndpointReason } = await import("../../shared/renderer/src/voice/streaming/localVad.ts");
const samples = (amplitude, length = 1_600) => Int16Array.from({ length }, (_, index) => Math.round(Math.sin(index / 5) * amplitude));
assert.equal(pcm16Rms(new Int16Array(100)), 0);
assert.ok(pcm16Rms(samples(16_000)) > 0.3);

const vad = new LocalVoiceActivityDetector({ adaptive: false, minSpeechMs: 200, endpointSilenceMs: 800, initialSilenceTimeoutMs: 2_000 });
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

for (const amplitude of [0, 250, 600, 1_000]) {
  const adaptive = new LocalVoiceActivityDetector({ minSpeechMs: 100, initialSilenceTimeoutMs: 2_000 });
  for (let index = 0; index < 5; index += 1) adaptive.observe(samples(amplitude), 100);
  const calibrated = adaptive.observe(samples(amplitude), 100);
  assert.ok(calibrated.threshold >= 0.018 && calibrated.noiseFloor >= 0, "noise floor must produce a bounded threshold");
  assert.equal(adaptive.observe(samples(8_000), 100).speechDetected, true, "speech above calibrated fan noise must be detected");
}

const noisy = new LocalVoiceActivityDetector({ minSpeechMs: 100, endpointSilenceMs: 1_000, languageHint: "zh-CN" });
for (let index = 0; index < 8; index += 1) assert.equal(noisy.observe(samples(900), 50).speechDetected, false);
let noisySpeech;
for (let index = 0; index < 8; index += 1) noisySpeech = noisy.observe(samples(7_000), 100);
assert.equal(noisySpeech.speechDetected, true);
assert.ok(noisySpeech.threshold > 0.018, "fan noise must raise the adaptive speech threshold");
assert.ok(noisySpeech.endpointSilenceMs < 1_000, "dense Chinese speech must use a shorter adaptive endpoint window");

const fixed = new LocalVoiceActivityDetector({ adaptive: false, minSpeechMs: 100, endpointSilenceMs: 700 });
assert.equal(fixed.observe(samples(8_000), 100).endpointSilenceMs, 700, "adaptive behavior must remain explicitly disableable");

console.log("Local VAD tests passed (RMS, silence/fan/noise calibration, adaptive threshold, language/rate endpointing, fixed mode, reset, and endpoint priority).");
