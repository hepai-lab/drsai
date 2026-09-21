import assert from "node:assert/strict";
import { BoundedEventDispatcher } from "../main/boundedEventDispatcher.ts";
import { appendResumedContent, createStreamAttemptCursor, networkRetryDelayMs } from "../main/networkRecovery.ts";

type Event = { type: "chunk" | "status" | "done"; content?: string; index?: number };
const delivered: Event[] = [];
const scheduled: Array<() => void> = [];
const dispatcher = new BoundedEventDispatcher<Event>({
  capacity: 8,
  deliver: (event) => delivered.push(event),
  schedule: (flush) => scheduled.push(flush),
  merge: (previous, next) => previous.type === "chunk" && next.type === "chunk"
    ? { type: "chunk", content: `${previous.content ?? ""}${next.content ?? ""}` }
    : null,
});

for (let index = 0; index < 10_000; index += 1) dispatcher.enqueue({ type: "chunk", content: "x" });
assert.equal(dispatcher.pendingCount, 1, "A burst of adjacent deltas must remain bounded by coalescing.");
dispatcher.enqueue({ type: "status", index: 1 });
dispatcher.enqueue({ type: "chunk", content: "tail" });
dispatcher.enqueue({ type: "done", index: 2 });
scheduled.shift()?.();
assert.deepEqual(delivered.map((event) => event.type), ["chunk", "status", "chunk", "done"]);
assert.equal(delivered[0]?.content?.length, 10_000);
assert.equal(delivered[2]?.content, "tail");

const controlEvents: Event[] = [];
const bounded = new BoundedEventDispatcher<Event>({ capacity: 8, deliver: (event) => controlEvents.push(event), schedule: () => undefined });
for (let index = 0; index < 25; index += 1) {
  bounded.enqueue({ type: "status", index });
  assert.ok(bounded.pendingCount <= 8, "The pending renderer queue must never exceed its configured high-water mark.");
}
bounded.flush();
assert.deepEqual(controlEvents.map((event) => event.index), Array.from({ length: 25 }, (_, index) => index), "Control events must retain FIFO order under pressure.");

const state = { content: "hello", fileEventKeys: new Set<string>() };
let cursor = createStreamAttemptCursor(state);
assert.equal(appendResumedContent(state, cursor, "hello"), "", "A replayed prefix must be suppressed.");
assert.equal(appendResumedContent(state, cursor, " world"), " world");
cursor = createStreamAttemptCursor(state);
assert.equal(appendResumedContent(state, cursor, "hello world"), "", "A complete reconnect replay must not duplicate output.");
assert.deepEqual([1, 2, 3, 4, 5, 8].map(networkRetryDelayMs), [1_000, 2_000, 4_000, 5_000, 5_000, 5_000]);
console.log("Stream backpressure, ordering, replay deduplication and retry schedule verification passed.");
