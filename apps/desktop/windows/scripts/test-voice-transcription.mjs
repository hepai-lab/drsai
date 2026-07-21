import assert from "node:assert/strict";
import { VoiceTranscriptionController } from "../src/renderer/src/voice/voiceTranscriptionController.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, reject, resolve };
}

function result(transcript) {
  return {
    ok: true,
    transcript,
    durationSeconds: 2,
    runtimeId: "mock-local",
    sourceId: `source-${transcript}`,
    createdAt: new Date(0).toISOString(),
    truncated: false,
    providerDisclosure: "fixture",
    message: "done",
  };
}

function createBridge(startImplementation) {
  const listeners = new Set();
  const cancelled = [];
  let unsubscribeCount = 0;
  return {
    bridge: {
      cancel: async (requestId) => { cancelled.push(requestId); return true; },
      start: startImplementation ?? (async () => ({ requestId: "request-1", acceptedAt: new Date(0).toISOString() })),
      subscribe: (callback) => {
        listeners.add(callback);
        return () => { if (listeners.delete(callback)) unsubscribeCount += 1; };
      },
    },
    cancelled,
    emit(event) { for (const listener of [...listeners]) listener(event); },
    get listenerCount() { return listeners.size; },
    get unsubscribeCount() { return unsubscribeCount; },
  };
}

const request = { audioData: new Uint8Array([1]), mimeType: "audio/wav", durationSeconds: 2 };

{
  const fixture = createBridge(async () => {
    fixture.emit({ requestId: "request-1", type: "accepted", runtimeId: "mock-local" });
    return { requestId: "request-1", acceptedAt: new Date(0).toISOString() };
  });
  const progress = [];
  const controller = new VoiceTranscriptionController(fixture.bridge, (message) => progress.push(message));
  const pending = controller.transcribe(request);
  fixture.emit({ requestId: "request-1", type: "progress", stage: "transcribing", message: "working" });
  fixture.emit({ requestId: "request-1", type: "completed", result: result("hello") });
  assert.equal((await pending).transcript, "hello");
  assert.deepEqual(progress, ["working"]);
  assert.equal(fixture.listenerCount, 0);
  assert.equal(fixture.unsubscribeCount, 1);
  await Promise.resolve();
  assert.deepEqual(fixture.cancelled, [], "synchronous completion before start resolution must not be cancelled");
}

{
  let sequence = 0;
  const fixture = createBridge(async () => ({ requestId: `request-${++sequence}`, acceptedAt: new Date(0).toISOString() }));
  const progress = [];
  const controller = new VoiceTranscriptionController(fixture.bridge, (message) => progress.push(message));
  const first = controller.transcribe(request);
  await Promise.resolve();
  fixture.emit({ requestId: "request-1", type: "completed", result: result("first") });
  await first;
  const second = controller.transcribe(request);
  await Promise.resolve();
  fixture.emit({ requestId: "request-1", type: "progress", stage: "transcribing", message: "stale" });
  fixture.emit({ requestId: "request-2", type: "completed", result: result("second") });
  assert.equal((await second).transcript, "second");
  assert.deepEqual(progress, [], "events from an old request must not mutate the new request");
}

{
  const gate = deferred();
  const fixture = createBridge(() => gate.promise);
  const controller = new VoiceTranscriptionController(fixture.bridge, () => {});
  const first = controller.transcribe(request);
  await assert.rejects(controller.transcribe(request), /already active/);
  assert.equal(controller.cancel(), true);
  await assert.rejects(first, (error) => error.name === "AbortError");
  gate.resolve({ requestId: "late-request", acceptedAt: new Date(0).toISOString() });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(fixture.cancelled, ["late-request"], "late acceptance must be cancelled after local cancellation");
  assert.equal(controller.cancel(), false);
}

{
  const fixture = createBridge(async () => ({ requestId: "request-fail", acceptedAt: new Date(0).toISOString() }));
  const controller = new VoiceTranscriptionController(fixture.bridge, () => {});
  const pending = controller.transcribe(request);
  await Promise.resolve();
  fixture.emit({ requestId: "request-fail", type: "failed", error: { code: "provider_error", message: "provider failed", retryable: true } });
  await assert.rejects(pending, /provider failed/);
  assert.equal(fixture.listenerCount, 0);
}

{
  const fixture = createBridge(async () => { throw new Error("start failed"); });
  const controller = new VoiceTranscriptionController(fixture.bridge, () => {});
  await assert.rejects(controller.transcribe(request), /start failed/);
  assert.equal(fixture.listenerCount, 0);
}

{
  const fixture = createBridge(async () => ({ requestId: "dispose-request", acceptedAt: new Date(0).toISOString() }));
  const controller = new VoiceTranscriptionController(fixture.bridge, () => {});
  const pending = controller.transcribe(request);
  await Promise.resolve();
  controller.dispose();
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.deepEqual(fixture.cancelled, ["dispose-request"]);
  await assert.rejects(controller.transcribe(request), /disposed/);
}

console.log("Voice transcription behavior tests passed (6 scenarios).");
