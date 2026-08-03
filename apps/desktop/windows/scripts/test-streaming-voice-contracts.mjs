import assert from "node:assert/strict";

const { BoundedStreamingAudioQueue } = await import("../../shared/main/voiceStreaming/audioQueue.ts");
const { StreamingVoiceSessionRegistry } = await import("../../shared/main/voiceStreaming/sessionRegistry.ts");
const { FixtureStreamingTranscriptionRuntime } = await import("../../shared/main/voiceStreaming/fixtureStreamingRuntime.ts");
const { StreamingVoiceEventCursor } = await import("../../shared/main/voiceStreaming/eventCursor.ts");
const {
  MAX_STREAMING_AUDIO_CHUNK_BYTES,
  validateStreamingVoiceAudioChunk,
  validateStreamingVoiceStartRequest,
} = await import("../../shared/main/voiceStreaming/validation.ts");

function chunk(sequence, durationMs = 100, overrides = {}) {
  return {
    sessionId: "session-1",
    turnId: "turn-1",
    sequence,
    capturedAtMs: sequence * durationMs,
    durationMs,
    encoding: "pcm_s16le",
    sampleRateHz: 16_000,
    channels: 1,
    audioData: new Uint8Array(3_200),
    ...overrides,
  };
}

const startRequest = {
  turnId: "turn-1",
  languageHint: "zh-CN",
  encoding: "pcm_s16le",
  sampleRateHz: 16_000,
  channels: 1,
  frameDurationMs: 20,
  providerEndpointing: true,
};
assert.doesNotThrow(() => validateStreamingVoiceStartRequest(startRequest));
assert.throws(() => validateStreamingVoiceStartRequest({ ...startRequest, sampleRateHz: 44_100 }), /sample rate/);
assert.throws(() => validateStreamingVoiceStartRequest({ ...startRequest, channels: 2 }), /mono/);
assert.throws(() => validateStreamingVoiceStartRequest({ ...startRequest, frameDurationMs: 1 }), /duration/);
assert.throws(() => validateStreamingVoiceStartRequest({ ...startRequest, turnId: "../unsafe" }), /turn ID/);
assert.doesNotThrow(() => validateStreamingVoiceAudioChunk(chunk(0), { ...startRequest, sessionId: "session-1" }));
assert.throws(() => validateStreamingVoiceAudioChunk(chunk(0, 100, { sessionId: "other" }), { ...startRequest, sessionId: "session-1" }), /session mismatch/);
assert.throws(() => validateStreamingVoiceAudioChunk(chunk(0, 100, { audioData: new Uint8Array(3_000) }), { ...startRequest, sessionId: "session-1" }), /byte length/);
assert.throws(() => validateStreamingVoiceAudioChunk(chunk(0, 100, { audioData: new Uint8Array(MAX_STREAMING_AUDIO_CHUNK_BYTES + 2) }), { ...startRequest, sessionId: "session-1" }), /too large/);

const cursor = new StreamingVoiceEventCursor("session-1", "turn-1");
assert.equal(cursor.accept({ sessionId: "session-1", turnId: "turn-1", sequence: 0 }), "accepted");
assert.equal(cursor.accept({ sessionId: "session-1", turnId: "turn-1", sequence: 0 }), "duplicate");
assert.equal(cursor.accept({ sessionId: "session-1", turnId: "turn-1", sequence: 2 }), "out_of_order");
assert.equal(cursor.accept({ sessionId: "other", turnId: "turn-1", sequence: 1 }), "wrong_session");
assert.equal(cursor.accept({ sessionId: "session-1", turnId: "turn-1", sequence: 1 }, true), "accepted");
assert.equal(cursor.accept({ sessionId: "session-1", turnId: "turn-1", sequence: 2 }), "terminal");

assert.throws(
  () => new BoundedStreamingAudioQueue({ maxBufferedAudioMs: 0, highWatermarkMs: 1, lowWatermarkMs: 0 }),
  /positive/,
);
assert.throws(
  () => new BoundedStreamingAudioQueue({ maxBufferedAudioMs: 2_000, highWatermarkMs: 2_001, lowWatermarkMs: 0 }),
  /highWatermark/,
);
const queue = new BoundedStreamingAudioQueue({ maxBufferedAudioMs: 500, highWatermarkMs: 300, lowWatermarkMs: 100 });
assert.deepEqual(queue.enqueue(chunk(0)), { accepted: true, bufferedAudioMs: 100 });
assert.deepEqual(queue.enqueue(chunk(1)), { accepted: true, bufferedAudioMs: 200 });
assert.deepEqual(queue.enqueue(chunk(2)), { accepted: true, bufferedAudioMs: 300 });
assert.equal(queue.backpressured, true);
assert.deepEqual(queue.enqueue(chunk(2)), { accepted: false, bufferedAudioMs: 300, reason: "duplicate" });
assert.deepEqual(queue.enqueue(chunk(4)), { accepted: false, bufferedAudioMs: 300, reason: "out_of_order" });
assert.deepEqual(queue.enqueue(chunk(3, 250)), { accepted: false, bufferedAudioMs: 300, reason: "backpressure" });
assert.deepEqual(queue.enqueue(chunk(3)), { accepted: false, bufferedAudioMs: 300, reason: "backpressure" });
assert.deepEqual(queue.acknowledge(1), { acknowledged: 1, bufferedAudioMs: 100 });
assert.equal(queue.canResume, true);
assert.equal(queue.peek().sequence, 2);
assert.deepEqual(queue.acknowledge(1), { acknowledged: 1, bufferedAudioMs: 100 });
assert.deepEqual(queue.enqueue(chunk(3)), { accepted: true, bufferedAudioMs: 200 });
queue.close();
assert.deepEqual(queue.enqueue(chunk(4)), { accepted: false, bufferedAudioMs: 200, reason: "terminal" });
queue.clear();
assert.equal(queue.size, 0);
assert.equal(queue.bufferedAudioMs, 0);

const registry = new StreamingVoiceSessionRegistry(2);
const first = registry.register({ sessionId: "s1", turnId: "t1", ownerId: "window-1", value: { disposed: false } }, 10);
assert.equal(first.createdAt, 10);
assert.equal(first.terminal, null);
assert.throws(
  () => registry.register({ sessionId: "s2", turnId: "t2", ownerId: "window-1", value: {} }),
  /already has an active/,
);
registry.register({ sessionId: "s2", turnId: "t2", ownerId: "window-2", value: {} }, 20);
assert.deepEqual(registry.activeSessionIdsForOwner("window-2"), ["s2"]);
assert.throws(
  () => registry.register({ sessionId: "s3", turnId: "t3", ownerId: "window-3", value: {} }),
  /Too many active/,
);
assert.equal(registry.finish("s1", "completed"), true);
assert.equal(registry.finish("s1", "failed"), false);
registry.register({ sessionId: "s3", turnId: "t3", ownerId: "window-1", value: {} }, 30);
assert.deepEqual(registry.cancelOwner("window-1"), ["s3"]);
assert.deepEqual(registry.cancelOwner("window-1"), []);
assert.equal(registry.get("s3").terminal, "cancelled");
assert.equal(registry.delete("s1"), true);
registry.clear();
assert.equal(registry.size, 0);

const events = [];
const runtime = new FixtureStreamingTranscriptionRuntime({
  sessionId: "session-1",
  turnId: "turn-1",
  partials: ["你", "你好"],
  finalText: "你好，世界。",
  partialEveryChunks: 2,
  emit: (event) => events.push(event),
});
runtime.start();
for (let sequence = 0; sequence < 4; sequence += 1) assert.equal(runtime.pushAudio(chunk(sequence)), true);
assert.equal(runtime.pushAudio(chunk(3)), false, "duplicate audio must be rejected");
assert.equal(runtime.pushAudio(chunk(4, 100, { sessionId: "wrong" })), false, "cross-session audio must be rejected");
assert.equal(runtime.endInput("manual"), true);
assert.equal(runtime.endInput("manual"), false, "the fixture must have a single terminal state");
assert.equal(runtime.cancel(), false, "completed sessions cannot be cancelled again");
assert.deepEqual(events.map((event) => event.type), [
  "accepted",
  "audio_ack",
  "audio_ack",
  "partial",
  "audio_ack",
  "audio_ack",
  "partial",
  "endpoint",
  "final",
  "completed",
]);
assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index));
assert.deepEqual(events.filter((event) => event.type === "partial").map((event) => event.segment.text), ["你", "你好"]);
assert.equal(events.find((event) => event.type === "final").segment.text, "你好，世界。");
assert.equal(events.find((event) => event.type === "endpoint").reason, "manual");
for (const event of events) {
  assert.equal(event.sessionId, "session-1");
  assert.equal(event.turnId, "turn-1");
}

const cancelledEvents = [];
const cancelledRuntime = new FixtureStreamingTranscriptionRuntime({
  sessionId: "cancel-session",
  turnId: "cancel-turn",
  partials: [],
  finalText: "unused",
  emit: (event) => cancelledEvents.push(event),
});
cancelledRuntime.start();
assert.equal(cancelledRuntime.cancel(), true);
assert.equal(cancelledRuntime.cancel(), false);
assert.deepEqual(cancelledEvents.map((event) => event.type), ["accepted", "cancelled"]);

console.log("Streaming voice contract tests passed (bounded queue, session ownership, fixture partial/final, cancellation, and single terminal state)." );
