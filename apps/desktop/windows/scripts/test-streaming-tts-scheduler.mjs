import assert from "node:assert/strict";
const { BoundedStreamingTtsScheduler } = await import("../src/renderer/src/voice/streaming/streamingTtsScheduler.ts");
const request = (index) => ({ sessionId: "s", turnId: "t", messageId: "m", segmentId: `seg-${index}`, segmentIndex: index, text: `text ${index}`, format: "wav" });
const audio = (item) => ({ sessionId: item.sessionId, turnId: item.turnId, messageId: item.messageId, segmentId: item.segmentId, segmentIndex: item.segmentIndex, mimeType: "audio/wav", audioData: new Uint8Array([1, 2]), final: true });

const resolvers = [];
const events = [];
const runtime = { id: "fixture", disposeCount: 0, synthesize: (item, signal) => new Promise((resolve, reject) => {
  signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
  resolvers.push(() => resolve(audio(item)));
}), dispose() { this.disposeCount += 1; } };
const scheduler = new BoundedStreamingTtsScheduler(runtime, { onEvent: (event) => events.push(event) });
assert.equal(scheduler.enqueue(request(0)), true);
assert.equal(scheduler.enqueue(request(1)), true);
assert.equal(scheduler.enqueue(request(2)), false, "one active plus one pending is the hard bound");
assert.equal(scheduler.capacity, 0);
resolvers.shift()();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(scheduler.active.segmentIndex, 1);
resolvers.shift()();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(events.filter((event) => event.type === "audio").map((event) => event.segment.segmentIndex), [0, 1]);
assert.equal(events.at(-1).type, "idle");
assert.equal(scheduler.enqueue(request(0)), false, "completed logical segments must not be duplicated");

let attempts = 0;
const retryEvents = [];
const retryRuntime = { id: "retry", async synthesize(item) { attempts += 1; if (attempts < 3) throw { code: "rate_limited", message: "slow", retryable: true }; return audio(item); }, dispose() {} };
const retryScheduler = new BoundedStreamingTtsScheduler(retryRuntime, { maxRetries: 2, onEvent: (event) => retryEvents.push(event) });
retryScheduler.enqueue(request(3));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(attempts, 3);
assert.deepEqual(retryEvents.map((event) => event.type), ["started", "retry", "started", "retry", "started", "audio", "idle"]);

const fatalEvents = [];
const fatalScheduler = new BoundedStreamingTtsScheduler({ id: "fatal", async synthesize() { throw { code: "auth_required", message: "auth", retryable: false }; }, dispose() {} }, { onEvent: (event) => fatalEvents.push(event) });
fatalScheduler.enqueue(request(4));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(fatalEvents.filter((event) => event.type === "started").length, 1);
assert.equal(fatalEvents.some((event) => event.type === "failed"), true);

const cancelRuntime = { id: "cancel", disposed: false, synthesize: (_item, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true })), dispose() { this.disposed = true; } };
const cancelEvents = [];
const cancelled = new BoundedStreamingTtsScheduler(cancelRuntime, { onEvent: (event) => cancelEvents.push(event) });
cancelled.enqueue(request(5)); cancelled.enqueue(request(6)); cancelled.cancel();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(cancelRuntime.disposed, true);
assert.equal(cancelEvents.at(-1).type, "cancelled");
assert.equal(cancelled.active, null); assert.equal(cancelled.pending, null);

console.log("Streaming TTS scheduler tests passed (one-active/one-pending bound, order, duplicate suppression, retry matrix, fatal error, and cancellation).");
