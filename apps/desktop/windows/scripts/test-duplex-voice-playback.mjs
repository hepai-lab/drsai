import assert from "node:assert/strict";
import { DuplexPlaybackController } from "../../shared/renderer/src/voice/duplex/playbackController.ts";

class FakeSink {
  clockSeconds = 0;
  state = "running";
  scheduled = [];
  stopped = 0;
  async resume() { this.state = "running"; }
  schedule(delta, startAtSeconds) { this.scheduled.push({ sequence: delta.sequence, responseId: delta.responseId, startAtSeconds }); return delta.audioData.byteLength / 2 / delta.sampleRateHz; }
  stop() { this.stopped += 1; this.scheduled = []; }
  async close() { this.state = "closed"; }
}

const pcm = (responseId, sequence, durationMs = 40) => ({ responseId, itemId: `item-${responseId}`, contentIndex: 0, sequence, encoding: "pcm_s16le", sampleRateHz: 24_000, channels: 1, audioData: new Uint8Array(24_000 * durationMs / 1_000 * 2) });
const sink = new FakeSink();
const playback = new DuplexPlaybackController(sink, { startWatermarkMs: 80, highWatermarkMs: 200 });
playback.beginResponse("r1");
assert.equal(playback.enqueue(pcm("r1", 2)), true);
assert.equal(sink.scheduled.length, 0, "playback waits for its start watermark");
assert.equal(playback.enqueue(pcm("r1", 1)), true);
assert.deepEqual(sink.scheduled.map((entry) => entry.sequence), [1, 2], "out-of-order deltas play monotonically");
assert.equal(playback.enqueue(pcm("r1", 1)), false, "duplicates are ignored");
sink.clockSeconds = sink.scheduled[0].startAtSeconds + 0.035;
assert.equal(Math.round(playback.playedAudioMs), 35, "cursor follows the audio clock, not bytes received");
assert.equal(playback.enqueue(pcm("r1", 3, 160)), false, "high watermark bounds queued and scheduled audio");
const cursor = playback.cancelResponse("r1");
assert.equal(Math.round(cursor), 35);
assert.equal(playback.enqueue(pcm("r1", 4)), false, "late cancelled-response data is isolated");
playback.beginResponse("r2");
assert.equal(playback.enqueue(pcm("r1", 5)), false, "cross-response audio cannot leak");
assert.throws(() => playback.enqueue({ ...pcm("r2", 1), audioData: new Uint8Array(3) }), /Invalid realtime PCM/);
assert.equal(playback.enqueue(pcm("r2", 1)), true);
assert.equal(sink.scheduled.length, 0);
playback.finishResponse("r2");
assert.deepEqual(sink.scheduled.map((entry) => entry.sequence), [1], "the final short tail is flushed");

sink.state = "suspended";
assert.equal(await playback.recover(), true);
playback.beginResponse("r3"); playback.enqueue(pcm("r3", 1)); playback.enqueue(pcm("r3", 2));
playback.stop();
assert.equal(playback.snapshot.bufferedAudioMs, 0);
assert.equal(playback.snapshot.started, false);
await playback.dispose();
assert.equal(sink.state, "closed");

console.log("Duplex Voice M5 playback verified (incremental PCM, jitter watermark, ordering, real clock cursor, immediate stop, late isolation, and recovery).")
