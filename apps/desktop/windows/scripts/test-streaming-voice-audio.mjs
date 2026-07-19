import assert from "node:assert/strict";

const {
  Pcm16Batcher,
  StreamingLinearResampler,
  float32ToPcm16,
  mixAudioChannelsToMono,
} = await import("../src/renderer/src/voice/streaming/streamingAudio.ts");

assert.deepEqual([...mixAudioChannelsToMono([])], []);
assert.deepEqual(
  [...mixAudioChannelsToMono([new Float32Array([1, -1, 0.5]), new Float32Array([-1, 1, 0.5])])],
  [0, 0, 0.5],
);
assert.deepEqual(
  [...mixAudioChannelsToMono([new Float32Array([2, Number.NaN]), new Float32Array([2, 1])])],
  [1, 0.5],
);

assert.deepEqual(
  [...float32ToPcm16(new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2, Number.NaN]))],
  [-32768, -32768, -16384, 0, 16384, 32767, 32767, 0],
);

const inputRate = 48_000;
const outputRate = 16_000;
const frequency = 440;
const input = Float32Array.from({ length: inputRate }, (_, index) => Math.sin(2 * Math.PI * frequency * index / inputRate));
const oneShotResampler = new StreamingLinearResampler(inputRate, outputRate);
const oneShot = oneShotResampler.push(input);
assert.ok(Math.abs(oneShot.length - outputRate) <= 1, `unexpected one-shot sample count ${oneShot.length}`);
const chunkedResampler = new StreamingLinearResampler(inputRate, outputRate);
const chunkedParts = [];
for (let offset = 0; offset < input.length; offset += 128) chunkedParts.push(chunkedResampler.push(input.slice(offset, offset + 128)));
const chunked = Float32Array.from(chunkedParts.flatMap((part) => [...part]));
assert.equal(chunked.length, oneShot.length, "chunk boundaries must not change resampled duration");
let maxDifference = 0;
for (let index = 0; index < oneShot.length; index += 1) maxDifference = Math.max(maxDifference, Math.abs(oneShot[index] - chunked[index]));
assert.ok(maxDifference < 1e-6, `chunked resampling drifted by ${maxDifference}`);

const batcher = new Pcm16Batcher({ sampleRateHz: 16_000, frameDurationMs: 20, batchDurationMs: 100 });
assert.equal(batcher.frameSamples, 320);
assert.equal(batcher.batchSamples, 1_600);
const batches = [];
for (let offset = 0; offset < 16_000; offset += 128) {
  batches.push(...batcher.push(new Int16Array(Math.min(128, 16_000 - offset)).fill(offset % 32767)));
}
assert.equal(batches.length, 10);
assert.deepEqual(batches.map((batch) => batch.sequence), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
assert.ok(batches.every((batch) => batch.durationMs === 100 && batch.audioData.byteLength === 3_200));
assert.deepEqual(batcher.flush(), []);

const partialBatcher = new Pcm16Batcher({ sampleRateHz: 16_000 });
assert.deepEqual(partialBatcher.push(new Int16Array(800)), []);
const tail = partialBatcher.flush();
assert.equal(tail.length, 1);
assert.equal(tail[0].durationMs, 50);
assert.equal(tail[0].audioData.byteLength, 1_600);
assert.deepEqual(partialBatcher.flush(), []);
partialBatcher.reset();
assert.equal(partialBatcher.push(new Int16Array(1_600))[0].sequence, 0);

console.log("Streaming audio DSP tests passed (mixing, PCM16 saturation, chunk-stable resampling, 20 ms frames, 100 ms batches, and tail flush)." );
