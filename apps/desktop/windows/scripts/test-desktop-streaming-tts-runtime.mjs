import assert from "node:assert/strict";
const { DesktopStreamingTtsRuntime } = await import("../src/renderer/src/voice/streaming/desktopStreamingTtsRuntime.ts");
const listeners = new Set();
let nextId = 0;
const cancelled = [];
const provider = {
  async start() { return { requestId: `request-${nextId++}`, acceptedAt: new Date(0).toISOString() }; },
  async cancel(id) { cancelled.push(id); return true; },
  subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
  emit(event) { for (const listener of listeners) listener(event); },
};
const request = (index) => ({ sessionId: "session", turnId: "turn", messageId: "message", segmentId: `segment-${index}`, segmentIndex: index, text: `text ${index}`, speed: 1, format: "wav" });
const runtime = new DesktopStreamingTtsRuntime(provider);
const first = runtime.synthesize(request(0), new AbortController().signal);
await Promise.resolve();
provider.emit({ requestId: "request-0", type: "completed", result: { audioData: new Uint8Array([1, 2, 3]), mimeType: "audio/wav", runtimeId: "mock-local", createdAt: new Date(0).toISOString(), providerDisclosure: "fixture" } });
const firstResult = await first;
assert.equal(firstResult.segmentIndex, 0); assert.equal(firstResult.segmentId, "segment-0"); assert.equal(firstResult.final, true);

const failure = runtime.synthesize(request(1), new AbortController().signal);
await Promise.resolve();
provider.emit({ requestId: "request-1", type: "failed", error: { code: "rate_limited", message: "slow", retryable: true } });
await assert.rejects(failure, (error) => error.code === "rate_limited");

const controller = new AbortController();
const aborted = runtime.synthesize(request(2), controller.signal);
await Promise.resolve(); controller.abort();
await assert.rejects(aborted, /Cancelled/);
assert.deepEqual(cancelled, ["request-2"]);
runtime.dispose();
assert.equal(listeners.size, 0);

console.log("Desktop streaming TTS runtime tests passed (task mapping, audio identity, provider error, abort propagation, cancellation, and dispose).");
