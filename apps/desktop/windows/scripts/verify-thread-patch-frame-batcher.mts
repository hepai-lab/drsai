import assert from "node:assert/strict";
import { ThreadPatchFrameBatcher } from "../../shared/renderer/src/threadPatchFrameBatcher.ts";

let scheduled: (() => void) | undefined;
let scheduleCount = 0;
let cancelCount = 0;
const applied: any[] = [];
const batcher = new ThreadPatchFrameBatcher(
  (events) => applied.push(...events),
  (callback) => { scheduled = callback; scheduleCount += 1; return scheduleCount; },
  () => { cancelCount += 1; },
);
const delta = (sequence: number, itemId = "item-1", runId = "run-1") => ({
  version: 2, threadId: "thread-1", runtimeSessionId: "session-1",
  baseSequence: sequence - 1, sessionSequence: sequence, generation: 1,
  patch: { kind: "item.delta", runId, itemId, messageId: `message-${runId}`,
    delta: { kind: "message.text.append", text: `${sequence}` }, updatedAt: sequence, messageCount: 1 },
}) as any;
const terminal = (sequence: number) => ({ ...delta(sequence), patch: { kind: "run.state", runId: "run-1",
  message: { id: "message-run-1", role: "assistant", content: "done",
    structuredTurn: { version: 2, turnId: "run-1", status: "completed", parts: [], activities: [],
      lastSequence: sequence, seenDedupeKeys: [], protocolIssues: [], meta: {} } },
  insertAt: 0, updatedAt: sequence, messageCount: 1 } }) as any;

for (let sequence = 1; sequence <= 100; sequence += 1) batcher.enqueue(delta(sequence));
assert.equal(scheduleCount, 1, "100 deltas in one frame must schedule one render");
scheduled?.();
assert.equal(applied.length, 1);
assert.equal(applied[0].baseSequence, 0);
assert.equal(applied[0].sessionSequence, 100);
assert.equal(applied[0].patch.delta.text, Array.from({ length: 100 }, (_, index) => `${index + 1}`).join(""));

batcher.enqueue(delta(101, "item-1")); batcher.enqueue(delta(102, "item-2"));
scheduled?.();
assert.deepEqual(applied.slice(-2).map((value) => value.patch.itemId), ["item-1", "item-2"]);

const beforeTerminal = applied.length;
batcher.enqueue(terminal(103));
assert.equal(applied.length, beforeTerminal + 1, "terminal Run state must bypass the frame delay");
batcher.enqueue(delta(104, "item-3", "run-3")); batcher.clearThread("thread-1"); scheduled?.();
assert.equal(applied.some((value) => value.sessionSequence === 104), false);
batcher.dispose();
assert.ok(cancelCount >= 1);

let stressSchedule: (() => void) | undefined;
const stressApplied: any[] = [];
const stress = new ThreadPatchFrameBatcher(
  (events) => stressApplied.push(...events),
  (callback) => { stressSchedule = callback; return 1; },
  () => undefined,
);
for (let sequence = 1; sequence <= 10_000; sequence += 1) {
  const event = delta(sequence);
  event.patch.delta.text = "x";
  stress.enqueue(event);
}
stressSchedule?.();
assert.equal(stressApplied.length, 1, "10k deltas must produce one frame patch");
assert.equal(stressApplied[0].patch.delta.text.length, 10_000, "frame coalescing must remain lossless");
assert.equal(stressApplied[0].sessionSequence, 10_000);
stress.dispose();

console.log("P9 Item delta frame coalescing passed, including 10k lossless stress and urgent terminal barrier.");
