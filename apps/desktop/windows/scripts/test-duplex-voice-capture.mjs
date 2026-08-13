import assert from "node:assert/strict";

const { DuplexCaptureController, createDuplexAudioConstraints } = await import("../../shared/renderer/src/voice/duplex/captureController.ts");
const { DuplexLocalVad, pcm16Rms } = await import("../../shared/renderer/src/voice/duplex/localVad.ts");
const { DuplexLinearResampler, DuplexPcmBatcher, floatToPcm16, mixToMono } = await import("../../shared/renderer/src/voice/duplex/pcm.ts");

class FakeTrack {
  readyState = "live"; stopped = false; listeners = new Map();
  constructor(settings) { this.settings = settings; }
  getSettings() { return { ...this.settings }; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  stop() { this.stopped = true; this.readyState = "ended"; }
  endExternally() { this.readyState = "ended"; this.listeners.get("ended")?.(); }
}
class FakeStream {
  constructor(track) { this.track = track; }
  getAudioTracks() { return [this.track]; } getTracks() { return [this.track]; }
}
class FakeNode { connect(next) { this.connected = next; return next; } disconnect() { this.disconnected = true; } }
class FakeWorklet extends FakeNode { port = { onmessage: null }; push(channels) { this.port.onmessage?.({ data: { type: "audio", channels } }); } }
class FakeContext {
  sampleRate = 48_000; state = "suspended"; destination = new FakeNode(); loaded = [];
  audioWorklet = { addModule: async (url) => { this.loaded.push(url); } };
  createMediaStreamSource() { return new FakeNode(); }
  createGain() { const node = new FakeNode(); node.gain = { value: 1 }; return node; }
  async resume() { if (this.resumeFailure) throw new Error("resume denied"); this.state = "running"; }
  async close() { this.state = "closed"; }
}
class FakeMediaDevices {
  calls = 0; constraints = []; listeners = new Map(); devices = [];
  constructor(stream) { this.stream = stream; }
  async getUserMedia(constraints) { this.calls += 1; this.constraints.push(constraints); if (this.failure) throw this.failure; return this.stream; }
  async enumerateDevices() { return this.devices; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type); }
  change() { this.listeners.get("devicechange")?.(); }
}

assert.deepEqual(createDuplexAudioConstraints("usb-mic", 24_000), { audio: { deviceId: { exact: "usb-mic" }, channelCount: { ideal: 1 }, sampleRate: { ideal: 24_000 }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
assert.deepEqual(createDuplexAudioConstraints("", 24_000).audio.deviceId, undefined);

const mono = mixToMono([new Float32Array([1, -1, 0.5]), new Float32Array([-1, 1, 0.5])]);
assert.deepEqual([...mono], [0, 0, 0.5]);
assert.deepEqual([...floatToPcm16(new Float32Array([-2, -1, 0, 1, 2, Number.NaN]))], [-32768, -32768, 0, 32767, 32767, 0]);
const resampler = new DuplexLinearResampler(48_000, 24_000);
const sine48 = Float32Array.from({ length: 4_800 }, (_, index) => Math.sin(2 * Math.PI * 440 * index / 48_000) * 0.5);
const sine24 = resampler.push(sine48);
assert.ok(Math.abs(sine24.length - 2_400) <= 1);
const batcher = new DuplexPcmBatcher(24_000, 40);
assert.equal(batcher.push(floatToPcm16(sine24)).length, 2);
assert.equal(batcher.flush().length, 1);
assert.equal(pcm16Rms(new Int16Array(960)), 0);

const track = new FakeTrack({ deviceId: "usb-mic", sampleRate: 48_000, channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true });
const stream = new FakeStream(track); const media = new FakeMediaDevices(stream);
media.devices = [{ kind: "audioinput", deviceId: "usb-mic", label: "USB microphone" }, { kind: "audioinput", deviceId: "bt-mic", label: "Bluetooth headset" }];
const context = new FakeContext(); const worklet = new FakeWorklet(); const chunks = []; const states = []; const reports = []; const deviceLists = []; const vadSignals = []; const errors = []; const recoveries = [];
const controller = new DuplexCaptureController({ mediaDevices: media, createAudioContext: () => context, createWorkletNode: () => worklet, now: () => 1_000, workletModuleUrl: "fixture-worklet.js" }, {
  sessionId: "session-1", deviceId: "usb-mic", onChunk: (chunk) => chunks.push(chunk) > 0,
  onState: (state) => states.push(state), onError: (error) => errors.push(error), onConstraints: (report) => reports.push(report),
  onDevices: (devices) => deviceLists.push(devices), onVadSignal: (signal) => vadSignals.push(signal), onRecoveryRequired: (reason) => recoveries.push(reason),
});
assert.equal(media.calls, 0, "constructing the controller must not request microphone permission");
assert.equal(await controller.startFromUserGesture(), true);
assert.equal(media.calls, 1); assert.equal(context.loaded[0], "fixture-worklet.js"); assert.equal(states.at(-1), "active");
assert.equal(reports[0].echoCancellation, true); assert.equal(reports[0].noiseSuppression, false, "actual constraints are reported without pretending they succeeded");
assert.equal(deviceLists[0].length, 2);
const loud = Float32Array.from({ length: 1_920 }, (_, index) => Math.sin(2 * Math.PI * 220 * index / 48_000) * 0.5);
for (let count = 0; count < 4; count += 1) worklet.push([loud, loud]);
assert.equal(chunks.length, 4); assert.equal(chunks[0].protocolVersion, 1); assert.equal(chunks[0].sampleRateHz, 24_000); assert.equal(chunks[0].durationMs, 40);
assert.equal(vadSignals.some((signal) => signal.speechCandidate), true);
assert.equal(chunks.length, 4, "local VAD must not stop or commit the Duplex uplink");
media.devices = [{ kind: "audioinput", deviceId: "bt-mic", label: "Bluetooth headset" }]; media.change(); await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(recoveries.at(-1), "device_lost"); assert.equal(controller.state, "failed"); assert.equal(track.stopped, true); assert.match(errors.at(-1).message, /no longer available/);
await controller.dispose(); assert.equal(media.listeners.size, 0);

const deniedMedia = new FakeMediaDevices(stream); deniedMedia.failure = Object.assign(new Error("denied"), { name: "NotAllowedError" }); const deniedStates = [];
const denied = new DuplexCaptureController({ mediaDevices: deniedMedia, createAudioContext: () => new FakeContext(), createWorkletNode: () => new FakeWorklet(), now: () => 0, workletModuleUrl: "fixture" }, { sessionId: "denied", onChunk: () => true, onState: (state) => deniedStates.push(state), onError: () => undefined });
assert.equal(await denied.startFromUserGesture(), false); assert.deepEqual(deniedStates, ["requesting_permission", "failed"]); await denied.dispose();

const sleepTrack = new FakeTrack({ deviceId: "auto", sampleRate: 48_000 }); const sleepMedia = new FakeMediaDevices(new FakeStream(sleepTrack)); sleepMedia.devices = [{ kind: "audioinput", deviceId: "auto", label: "Built-in" }]; const sleepRecoveries = [];
const sleeping = new DuplexCaptureController({ mediaDevices: sleepMedia, createAudioContext: () => new FakeContext(), createWorkletNode: () => new FakeWorklet(), now: () => 0, workletModuleUrl: "fixture" }, { sessionId: "sleep", onChunk: () => true, onState: () => undefined, onError: () => undefined, onRecoveryRequired: (reason) => sleepRecoveries.push(reason) });
await sleeping.startFromUserGesture(); await sleeping.handleLifecycle("sleep"); assert.equal(sleepRecoveries[0], "sleep"); assert.equal(sleeping.state, "failed"); await sleeping.dispose();

const vad = new DuplexLocalVad({ attackMs: 80, releaseMs: 120 }); const quiet = new Int16Array(960); const speech = Int16Array.from({ length: 960 }, (_, index) => index % 2 ? 12_000 : -12_000);
for (let count = 0; count < 5; count += 1) assert.equal(vad.observe(quiet, 40).speechCandidate, false);
assert.equal(vad.observe(speech, 40).speechCandidate, false); assert.equal(vad.observe(speech, 40).speechCandidate, true);
assert.equal(vad.observe(quiet, 40).speechCandidate, true); assert.equal(vad.observe(quiet, 80).speechCandidate, false);

console.log("Duplex Voice M4 capture verified (explicit permission, PCM, constraints, devices, lifecycle, and advisory-only VAD).");
