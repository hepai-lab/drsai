import assert from "node:assert/strict";
import { VoiceCaptureController } from "../src/renderer/src/voice/voiceCaptureController.ts";

class FakeTrack {
  listeners = new Map();
  stopCount = 0;
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  stop() { this.stopCount += 1; }
  end() { this.listeners.get("ended")?.(); }
}

class FakeStream {
  track = new FakeTrack();
  getAudioTracks() { return [this.track]; }
  getTracks() { return [this.track]; }
}

class FakeRecorder {
  mimeType = "audio/webm";
  ondataavailable = null;
  onerror = null;
  onstop = null;
  startCount = 0;
  state = "inactive";
  stopCount = 0;
  start() { this.startCount += 1; this.state = "recording"; }
  stop() {
    if (this.state === "inactive") return;
    this.stopCount += 1;
    this.state = "inactive";
    this.onstop?.();
  }
  emit(bytes = "voice") {
    this.ondataavailable?.({ data: new Blob([bytes], { type: this.mimeType }) });
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, reject, resolve };
}

function createHarness(overrides = {}) {
  let now = 0;
  let getUserMediaCalls = 0;
  let nextTimer = 1;
  const timers = new Map();
  const streams = [];
  const recorders = [];
  const states = [];
  const errors = [];
  const recorded = [];
  const elapsed = [];
  const environment = {
    clearInterval: (id) => timers.delete(id),
    createRecorder: (stream) => {
      const recorder = new FakeRecorder();
      recorder.stream = stream;
      recorders.push(recorder);
      return recorder;
    },
    getPreferredMimeType: () => "audio/webm;codecs=opus",
    mediaDevices: {
      enumerateDevices: async () => [{ kind: "audioinput", deviceId: "mic-1", label: "Test mic" }],
      getUserMedia: async () => {
        getUserMediaCalls += 1;
        const stream = new FakeStream();
        streams.push(stream);
        return stream;
      },
    },
    now: () => now,
    setInterval: (callback) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    ...overrides.environment,
  };
  const callbacks = {
    beforeStart: async () => {},
    onDevices: () => {},
    onElapsed: (value) => elapsed.push(value),
    onError: (value) => errors.push(value),
    onLevelsReset: () => {},
    onRecorded: (value) => recorded.push(value),
    onState: (value) => states.push(value),
    onStreamStarted: () => {},
    onStreamStopped: () => {},
    ...overrides.callbacks,
  };
  const controller = new VoiceCaptureController(environment, callbacks);
  return {
    advance(milliseconds) { now += milliseconds; for (const callback of [...timers.values()]) callback(); },
    callbacks,
    controller,
    elapsed,
    errors,
    get getUserMediaCalls() { return getUserMediaCalls; },
    recorded,
    recorders,
    states,
    streams,
    timers,
  };
}

{
  const harness = createHarness();
  assert.equal(harness.getUserMediaCalls, 0, "initialization must not request microphone permission");
  await harness.controller.start("mic-1");
  assert.equal(harness.getUserMediaCalls, 1);
  assert.deepEqual(harness.states.slice(-2), ["requesting_permission", "recording"]);
  assert.equal(harness.recorders[0].startCount, 1);
}

{
  const harness = createHarness();
  await harness.controller.start();
  harness.recorders[0].emit("short");
  harness.advance(375);
  harness.controller.stop("transcribe");
  assert.equal(harness.recorded[0].durationSeconds, 0.375, "sub-second duration must not be rounded to zero");
}

{
  const consentRequired = new Error("remote transcription consent required");
  const harness = createHarness({ callbacks: { beforeStart: async () => { throw consentRequired; } } });
  assert.equal(await harness.controller.start(), false);
  assert.equal(harness.getUserMediaCalls, 0, "failed preflight must not request microphone permission");
  assert.equal(harness.errors.at(-1), consentRequired);
}

{
  const gate = deferred();
  const stream = new FakeStream();
  let calls = 0;
  const harness = createHarness({ environment: { mediaDevices: {
    enumerateDevices: async () => [],
    getUserMedia: () => { calls += 1; return gate.promise; },
  } } });
  const starts = Array.from({ length: 50 }, () => harness.controller.start());
  gate.resolve(stream);
  const results = await Promise.all(starts);
  assert.equal(calls, 1, "rapid clicks must create one permission request");
  assert.equal(results.filter(Boolean).length, 1);
  harness.controller.dispose();
}

{
  const harness = createHarness();
  await harness.controller.start();
  harness.recorders[0].emit("12345");
  harness.advance(5_000);
  harness.controller.stop("transcribe");
  assert.equal(harness.recorded.length, 1);
  assert.equal(harness.recorded[0].durationSeconds, 5);
  assert.equal(harness.recorded[0].blob.size, 5);
  assert.equal(harness.streams[0].track.stopCount, 1);
  assert.equal(harness.timers.size, 0);
}

{
  const harness = createHarness();
  await harness.controller.start();
  harness.recorders[0].emit();
  harness.controller.stop("discard");
  assert.equal(harness.recorded.length, 0, "discard must not produce a transcription blob");
  assert.equal(harness.states.at(-1), "idle");
}

{
  const harness = createHarness();
  await harness.controller.start();
  harness.recorders[0].emit();
  harness.advance(120_000);
  harness.advance(1_000);
  assert.equal(harness.recorders[0].stopCount, 1, "automatic cutoff must stop once");
  assert.equal(harness.recorded.length, 1);
}

{
  const denied = new DOMException("denied", "NotAllowedError");
  const harness = createHarness({ environment: { mediaDevices: {
    enumerateDevices: async () => [],
    getUserMedia: async () => { throw denied; },
  } } });
  assert.equal(await harness.controller.start(), false);
  assert.equal(harness.states.at(-1), "failed");
  assert.equal(harness.errors.at(-1), denied);
}

{
  const harness = createHarness();
  await harness.controller.start();
  harness.streams[0].track.end();
  assert.equal(harness.states.at(-1), "failed");
  assert.match(harness.errors.at(-1).message, /disconnected/i);
  assert.equal(harness.recorders[0].stopCount, 1);
}

{
  const gate = deferred();
  const stream = new FakeStream();
  const harness = createHarness({ environment: { mediaDevices: {
    enumerateDevices: async () => [],
    getUserMedia: () => gate.promise,
  } } });
  const starting = harness.controller.start();
  await Promise.resolve();
  harness.controller.dispose();
  gate.resolve(stream);
  assert.equal(await starting, false);
  assert.equal(stream.track.stopCount, 1, "a stale stream must be stopped after disposal");
  assert.equal(harness.recorders.length, 0);
}

console.log("Voice capture behavior tests passed (10 scenarios, including sub-second duration, consent preflight, and 50-click concurrency).");
