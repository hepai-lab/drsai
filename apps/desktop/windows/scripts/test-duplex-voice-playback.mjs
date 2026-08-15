import assert from "node:assert/strict";
import { DuplexPlaybackController } from "../../shared/renderer/src/voice/duplex/playbackController.ts";
import { DuplexAdaptiveJitterBuffer } from "../../shared/renderer/src/voice/duplex/adaptiveJitterBuffer.ts";
import { BrowserPcmPlaybackSink } from "../../shared/renderer/src/voice/duplex/browserPcmPlaybackSink.ts";

class FakeSink {
  clockSeconds = 0;
  baseLatencySeconds = 0; outputLatencySeconds = 0;
  sinkId = ""; supportsSinkSelection = true; gainEvents = []; sinkChanges = [];
  state = "running";
  scheduled = [];
  stopped = 0;
  async resume() { if (this.resumeFailure) throw new Error("output occupied"); this.state = "running"; }
  async setSinkId(sinkId) { if (sinkId === "occupied") throw new Error("output occupied"); this.sinkId = sinkId; this.sinkChanges.push(sinkId); }
  setGain(value, rampMs) { this.gainEvents.push({ value, rampMs }); }
  schedule(delta, startAtSeconds, onEnded) { const durationSeconds = delta.audioData.byteLength / 2 / delta.sampleRateHz; const source = { sequence: delta.sequence, responseId: delta.responseId, startAtSeconds, endAtSeconds: startAtSeconds + durationSeconds, ended: false, onEnded: (event) => { if (source.ended) return; source.ended = true; onEnded(event); } }; this.scheduled.push(source); return { durationSeconds, scheduledAtSeconds: this.clockSeconds, startAtSeconds, endAtSeconds: startAtSeconds + durationSeconds }; }
  stop() { this.stopped += 1; for (const source of this.scheduled) source.onEnded({ endedAtSeconds: this.clockSeconds, cancelled: true }); this.scheduled = []; }
  async close() { this.state = "closed"; }
}

const pcm = (responseId, sequence, durationMs = 40) => ({ responseId, itemId: `item-${responseId}`, contentIndex: 0, sequence, providerReceivedAtMs: sequence * durationMs, encoding: "pcm_s16le", sampleRateHz: 24_000, channels: 1, audioData: new Uint8Array(24_000 * durationMs / 1_000 * 2) });
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
playback.finishResponse("r2", 1);
assert.deepEqual(sink.scheduled.map((entry) => entry.sequence), [1], "the final short tail is flushed");

sink.state = "suspended";
assert.equal(await playback.recover(), true);
playback.beginResponse("r3"); playback.enqueue(pcm("r3", 1)); playback.enqueue(pcm("r3", 2));
playback.stop();
assert.equal(playback.snapshot.bufferedAudioMs, 0);
assert.equal(playback.snapshot.started, false);
await playback.dispose();
assert.equal(sink.state, "closed");

const timers = []; const gaps = []; const gapSink = new FakeSink();
const gapPlayback = new DuplexPlaybackController(gapSink, { startWatermarkMs: 60, highWatermarkMs: 400, gapTimeoutMs: 120, schedule: (callback) => { const timer = { callback, cancelled: false }; timers.push(timer); return timer; }, cancelSchedule: (timer) => { timer.cancelled = true; }, onGap: (gap) => gaps.push(gap) });
gapPlayback.beginResponse("gap", 10); assert.equal(gapPlayback.enqueue(pcm("gap", 10)), true); assert.equal(gapPlayback.enqueue(pcm("gap", 12)), true);
assert.deepEqual(gapSink.scheduled.map((entry) => entry.sequence), [10]); assert.equal(gapPlayback.enqueue(pcm("gap", 12)), false, "duplicate out-of-order audio remains idempotent");
timers.find((timer) => !timer.cancelled).callback();
assert.deepEqual(gapSink.scheduled.map((entry) => entry.sequence), [10, 12], "gap timeout skips one missing frame and resumes subsequent audio");
assert.deepEqual(gaps[0], { responseId: "gap", fromSequence: 11, toSequence: 11 });
gapSink.clockSeconds = gapSink.scheduled.at(-1).startAtSeconds + 0.041;
const gapAck = gapPlayback.acknowledgement("session-gap");
assert.equal(gapAck.receivedSequence, 12); assert.equal(gapAck.scheduledSequence, 12); assert.equal(gapAck.playedSequence, 12); assert.equal(Math.round(gapAck.receivedAudioMs), 80); assert.equal(Math.round(gapAck.scheduledAudioMs), 80);

gapPlayback.beginResponse("tail", 20); gapPlayback.enqueue(pcm("tail", 20)); gapPlayback.finishResponse("tail", 22);
const tailTimer = timers.findLast((timer) => !timer.cancelled); tailTimer.callback();
assert.deepEqual(gaps.at(-1), { responseId: "tail", fromSequence: 21, toSequence: 22 }, "completion metadata makes a permanently missing tail observable");
gapPlayback.beginResponse("new", 30); gapPlayback.enqueue(pcm("new", 31)); const obsolete = timers.findLast((timer) => !timer.cancelled); gapPlayback.beginResponse("newer", 40); obsolete.callback();
assert.equal(gaps.some((gap) => gap.responseId === "new" && gap.fromSequence === 30), false, "a gap timer cannot cross response boundaries");
await gapPlayback.dispose();

const jitter = new DuplexAdaptiveJitterBuffer(); let arrival = 0;
for (let index = 0; index < 300; index += 1) { arrival += 40; jitter.observeArrival(arrival, 40); }
assert.ok(jitter.snapshot.targetMs <= 65, "stable cadence converges to the 60 ms low-latency floor");
for (let index = 0; index < 120; index += 1) { arrival += index % 2 ? 5 : 115; jitter.observeArrival(arrival, 40); }
assert.ok(jitter.snapshot.targetMs >= 150 && jitter.snapshot.targetMs <= 400, "variable arrivals increase the target without exceeding 400 ms");
const raisedTarget = jitter.snapshot.targetMs; jitter.observeUnderrun(); assert.ok(jitter.snapshot.targetMs >= raisedTarget);
for (let index = 0; index < 1_500; index += 1) { arrival += 40; jitter.observeArrival(arrival, 40); }
assert.ok(jitter.snapshot.targetMs < 90, "a recovered stable network gradually returns to low latency");

const timelineSink = new FakeSink(); timelineSink.baseLatencySeconds = 0.02; timelineSink.outputLatencySeconds = 0.01; let timelineNow = 0;
const timelinePlayback = new DuplexPlaybackController(timelineSink, { startWatermarkMs: 60, nowMs: () => (timelineNow += 40) });
timelinePlayback.beginResponse("timeline", 100); timelinePlayback.enqueue(pcm("timeline", 100)); timelinePlayback.enqueue(pcm("timeline", 101));
const firstTimelineSource = timelineSink.scheduled[0]; assert.equal(timelinePlayback.timeline[0].status, "scheduled");
timelineSink.clockSeconds = firstTimelineSource.startAtSeconds + 0.035; assert.equal(Math.round(timelinePlayback.playedAudioMs), 5, "heard cursor subtracts base and output latency"); assert.equal(timelinePlayback.timeline[0].status, "playing");
timelineSink.clockSeconds -= 0.02; assert.equal(Math.round(timelinePlayback.playedAudioMs), 5, "clock regressions cannot move the heard cursor backwards");
timelineSink.clockSeconds = firstTimelineSource.endAtSeconds + 0.031; firstTimelineSource.onEnded({ endedAtSeconds: firstTimelineSource.endAtSeconds, cancelled: false }); assert.equal(timelinePlayback.timeline[0].status, "ended"); assert.equal(timelinePlayback.timeline[0].endedAtSeconds, firstTimelineSource.endAtSeconds);
timelinePlayback.beginResponse("cancel-timeline", 200); timelinePlayback.enqueue(pcm("cancel-timeline", 200)); timelinePlayback.enqueue(pcm("cancel-timeline", 201)); timelinePlayback.cancelResponse("cancel-timeline");
assert.equal(timelinePlayback.timeline.filter((entry) => entry.responseId === "cancel-timeline").every((entry) => entry.status === "cancelled"), true, "stop records cancellation for every scheduled source");
timelineSink.state = "suspended"; timelinePlayback.beginResponse("suspend", 300); timelinePlayback.enqueue(pcm("suspend", 300)); timelinePlayback.enqueue(pcm("suspend", 301)); assert.equal(timelineSink.scheduled.length, 0); assert.equal(await timelinePlayback.recover(), true); assert.equal(timelineSink.scheduled.length, 2, "suspended audio schedules only after the real sink resumes");
await timelinePlayback.dispose();

const outputSink = new FakeSink(); const outputPlayback = new DuplexPlaybackController(outputSink);
assert.equal(await outputPlayback.switchOutputDevice("usb-speaker"), true); assert.equal(outputSink.sinkId, "usb-speaker");
assert.equal(await outputPlayback.switchOutputDevice("occupied"), false); assert.equal(outputSink.sinkId, "usb-speaker", "failed sink switch preserves the previous output");
outputPlayback.setVolume(0.8, 80); outputPlayback.duck(); outputPlayback.duck();
assert.deepEqual(outputSink.gainEvents.slice(-2), [{ value: 0.8, rampMs: 80 }, { value: 0.2, rampMs: 100 }], "repeated duck is idempotent and uses a 100 ms envelope");
assert.equal(outputPlayback.snapshot.ducked, true); outputPlayback.restoreVolume(); assert.deepEqual(outputSink.gainEvents.at(-1), { value: 0.8, rampMs: 100 });
outputPlayback.duck(); outputPlayback.stop(); assert.equal(outputPlayback.snapshot.ducked, false); assert.deepEqual(outputSink.gainEvents.at(-1), { value: 0.8, rampMs: 0 }, "cancel restores the independent voice volume immediately");
outputSink.state = "suspended"; outputSink.resumeFailure = true; assert.equal(await outputPlayback.recover(), false, "occupied/suspended output becomes an actionable recovery failure");
outputSink.resumeFailure = false; assert.equal(await outputPlayback.recover(), true); await outputPlayback.dispose();

const gainAutomation = []; const sinkChanges = [];
const gainParam = { value: 1, cancelScheduledValues: (at) => gainAutomation.push(["cancel", at]), setValueAtTime: (value, at) => { gainParam.value = value; gainAutomation.push(["set", value, at]); }, linearRampToValueAtTime: (value, at) => { gainParam.value = value; gainAutomation.push(["ramp", value, at]); } };
const browserContext = { currentTime: 2, baseLatency: 0.01, outputLatency: 0.02, state: "running", destination: {}, createGain: () => ({ gain: gainParam, connect: () => undefined, disconnect: () => undefined }), setSinkId: async (id) => { sinkChanges.push(id); }, close: async () => { browserContext.state = "closed"; }, resume: async () => { browserContext.state = "running"; } };
const browserSink = new BrowserPcmPlaybackSink(browserContext); browserSink.setGain(0.25, 100); assert.deepEqual(gainAutomation.slice(-3), [["cancel", 2], ["set", 1, 2], ["ramp", 0.25, 2.1]]);
assert.equal(browserSink.supportsSinkSelection, true); await browserSink.setSinkId("bluetooth"); assert.equal(browserSink.sinkId, "bluetooth"); assert.deepEqual(sinkChanges, ["bluetooth"]); await browserSink.close();

console.log("Duplex Voice M3/M5 playback verified (source timeline, latency-corrected cursor, adaptive jitter, gap recovery, ordering, stop, isolation, and recovery).")
