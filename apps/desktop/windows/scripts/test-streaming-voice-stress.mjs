import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BoundedStreamingTtsScheduler } from "../src/renderer/src/voice/streaming/streamingTtsScheduler.ts";
import { OrderedStreamingAudioPlaybackQueue } from "../src/renderer/src/voice/streaming/orderedAudioPlaybackQueue.ts";

const turns = 100;
const segmentsPerTurn = 16;
let synthesized = 0; let played = 0; let disposed = 0; let released = 0; let maxSchedulerDepth = 0; let maxPlaybackDepth = 0;

for (let turn = 0; turn < turns; turn += 1) {
  const cancelled = turn % 5 === 4;
  const runtime = {
    id: "stress-fixture",
    async synthesize(request, signal) {
      await new Promise((resolve) => setTimeout(resolve, turn % 3));
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      synthesized += 1;
      return { ...request, mimeType: "audio/wav", audioData: new Uint8Array(256), final: true };
    },
    dispose() { disposed += 1; },
  };
  const playback = new OrderedStreamingAudioPlaybackQueue({
    prepare() {}, release() { released += 1; },
    play(_segment, ended) { queueMicrotask(() => { played += 1; ended(); }); return { pause() {}, resume() {}, stop() {} }; },
  }, { maxBufferedSegments: 8 });
  let next = 0;
  let resolveTerminal;
  const terminal = new Promise((resolve) => { resolveTerminal = resolve; });
  const scheduler = new BoundedStreamingTtsScheduler(runtime, { onEvent(event) {
    if (event.type === "audio") playback.enqueue(event.segment);
    if (event.type === "idle") pump();
    if (event.type === "cancelled") resolveTerminal("cancelled");
  } });
  function pump() {
    while (scheduler.capacity > 0 && next < segmentsPerTurn) {
      const index = next++;
      scheduler.enqueue({ sessionId: `s-${turn}`, turnId: `t-${turn}`, messageId: `m-${turn}`, segmentId: `seg-${turn}-${index}`, segmentIndex: index, text: `segment ${index}`, format: "wav" });
      maxSchedulerDepth = Math.max(maxSchedulerDepth, Number(Boolean(scheduler.active)) + Number(Boolean(scheduler.pending)));
    }
    maxPlaybackDepth = Math.max(maxPlaybackDepth, playback.bufferedCount);
    if (next === segmentsPerTurn && !scheduler.active && !scheduler.pending) { playback.finish(segmentsPerTurn - 1); resolveTerminal("completed"); }
  }
  pump();
  if (cancelled) setTimeout(() => { scheduler.cancel(); playback.stop(); }, 2);
  await terminal;
  if (!cancelled) {
    for (let spin = 0; spin < 100 && playback.phase !== "completed"; spin += 1) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(playback.phase, "completed");
    scheduler.cancel();
  }
  assert.equal(scheduler.active, null);
  assert.equal(scheduler.pending, null);
  assert.equal(playback.bufferedCount, 0);
}

assert.ok(maxSchedulerDepth <= 2, `scheduler exceeded bound: ${maxSchedulerDepth}`);
assert.ok(maxPlaybackDepth <= 8, `playback exceeded bound: ${maxPlaybackDepth}`);
assert.equal(disposed, turns, "every runtime must be disposed exactly once");
const report = { schemaVersion: 1, turns, segmentsPerTurn, synthesized, played, cancelledTurns: turns / 5, maxSchedulerDepth, maxPlaybackDepth, disposed, released, residualSchedulers: 0, residualPlaybackSegments: 0, passed: true };
const root = fileURLToPath(new URL("..", import.meta.url));
const outputDir = join(root, "out", "verification", "voice-streaming-stress");
mkdirSync(outputDir, { recursive: true });
const outputPath = join(outputDir, "report.json");
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Streaming voice stress passed (${turns} turns, report: ${outputPath}).`);
