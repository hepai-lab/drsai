import assert from "node:assert/strict";

const { DuplexCaptureController, createDuplexAudioConstraints } = await import("../../shared/renderer/src/voice/duplex/captureController.ts");
const { DuplexLocalVad, pcm16Rms } = await import("../../shared/renderer/src/voice/duplex/localVad.ts");
const { DuplexSincResampler, DuplexPcmBatcher, floatToPcm16, mixToMono } = await import("../../shared/renderer/src/voice/duplex/pcm.ts");
const { DuplexCaptureQualityMonitor } = await import("../../shared/renderer/src/voice/duplex/captureQuality.ts");
const { runDuplexStartupTransaction } = await import("../../shared/renderer/src/voice/duplex/startupTransaction.ts");

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
  async getUserMedia(constraints) { this.calls += 1; this.constraints.push(constraints); if (this.failure) throw this.failure; if (this.resolver) return this.resolver(constraints); return this.stream; }
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
const resampler = new DuplexSincResampler(48_000, 24_000);
const sine48 = Float32Array.from({ length: 4_800 }, (_, index) => Math.sin(2 * Math.PI * 440 * index / 48_000) * 0.5);
const sine24 = resampler.push(sine48);
assert.ok(Math.abs(sine24.length - 2_400) <= resampler.halfWidth / 2 + 1, "fixed FIR startup latency is bounded");
const batcher = new DuplexPcmBatcher(24_000, 40);
assert.equal(batcher.push(floatToPcm16(sine24)).length, 2);
assert.equal(batcher.flush().length, 1);
assert.equal(pcm16Rms(new Int16Array(960)), 0);

for (const failedStage of ["prepare", "provider", "activate"]) {
  const calls = [];
  await assert.rejects(runDuplexStartupTransaction({
    prepareCapture: async () => { calls.push("prepare"); return failedStage !== "prepare"; },
    startProvider: async () => { calls.push("provider"); if (failedStage === "provider") throw new Error("provider failed"); return { sessionId: "started" }; },
    activateCapture: async () => { calls.push("activate"); return failedStage !== "activate"; },
    releaseCapture: async () => { calls.push("release_capture"); },
    cancelProvider: async () => { calls.push("cancel_provider"); },
  }));
  if (failedStage === "prepare") assert.deepEqual(calls, ["prepare", "release_capture"], "permission denial must not create a billable Provider Session");
  if (failedStage === "provider") assert.deepEqual(calls, ["prepare", "provider", "release_capture"]);
  if (failedStage === "activate") assert.deepEqual(calls, ["prepare", "provider", "activate", "cancel_provider", "release_capture"], "activation failure rolls back in reverse order");
}
const successCalls = []; const startupResult = await runDuplexStartupTransaction({ prepareCapture: async () => { successCalls.push("prepare"); return true; }, startProvider: async () => { successCalls.push("provider"); return "session"; }, activateCapture: async () => { successCalls.push("activate"); return true; }, releaseCapture: async () => { successCalls.push("release"); }, cancelProvider: async () => { successCalls.push("cancel"); } });
assert.equal(startupResult, "session"); assert.deepEqual(successCalls, ["prepare", "provider", "activate"]);

function rms(values) { return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length)); }
for (const inputRate of [44_100, 48_000, 96_000]) {
  const seconds = 10; const sampleCount = inputRate * seconds; const fragmented = new DuplexSincResampler(inputRate, 24_000); let outputCount = 0;
  for (let offset = 0; offset < sampleCount; offset += 127) outputCount += fragmented.push(Float32Array.from({ length: Math.min(127, sampleCount - offset) }, (_, index) => Math.sin(2 * Math.PI * 1_000 * (offset + index) / inputRate))).length;
  const expectedWithoutKernelDelay = sampleCount * 24_000 / inputRate - fragmented.halfWidth * 24_000 / inputRate;
  assert.ok(Math.abs(outputCount - expectedWithoutKernelDelay) <= 1, `${inputRate} Hz streaming resampling must not accumulate clock drift`);
}
const passband = new DuplexSincResampler(48_000, 24_000).push(Float32Array.from({ length: 48_000 }, (_, index) => Math.sin(2 * Math.PI * 4_000 * index / 48_000)));
const stopband = new DuplexSincResampler(48_000, 24_000).push(Float32Array.from({ length: 48_000 }, (_, index) => Math.sin(2 * Math.PI * 18_000 * index / 48_000)));
assert.ok(rms(passband.slice(100)) > 0.6, "voice-band energy remains intact");
assert.ok(rms(stopband.slice(100)) < 0.02, "above-Nyquist input is attenuated before decimation");
const whole = new DuplexSincResampler(44_100, 24_000).push(Float32Array.from({ length: 4_410 }, (_, index) => Math.sin(2 * Math.PI * 997 * index / 44_100)));
const splitResampler = new DuplexSincResampler(44_100, 24_000); const split = [splitResampler.push(Float32Array.from({ length: 1_333 }, (_, index) => Math.sin(2 * Math.PI * 997 * index / 44_100))), splitResampler.push(Float32Array.from({ length: 3_077 }, (_, index) => Math.sin(2 * Math.PI * 997 * (index + 1_333) / 44_100)))];
const joined = Float32Array.from([...split[0], ...split[1]]); assert.equal(joined.length, whole.length); assert.ok(joined.every((value, index) => Math.abs(value - whole[index]) < 1e-6), "worklet block boundaries preserve resampler phase");

const qualityMonitor = new DuplexCaptureQualityMonitor({ silenceWarningMs: 80, dcWarningMs: 80 });
qualityMonitor.configure({ sampleRate: 16_000, channelCount: 2, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, 24_000);
let quality = qualityMonitor.observe(new Int16Array(960), 40); quality = qualityMonitor.observe(new Int16Array(960), 40);
assert.ok(quality.issues.includes("input_too_quiet")); assert.ok(quality.issues.includes("sample_rate_degraded")); assert.ok(quality.issues.includes("aec_unavailable"));
quality = qualityMonitor.observe(Int16Array.from({ length: 960 }, () => 32_767), 40); assert.ok(quality.issues.includes("clipping"));
quality = qualityMonitor.observe(new Int16Array(960), 40); assert.ok(quality.issues.includes("clipping"), "transient warnings remain visible long enough for HUD and screen readers");
qualityMonitor.observe(Int16Array.from({ length: 960 }, () => 2_000), 40); quality = qualityMonitor.observe(Int16Array.from({ length: 960 }, () => 2_000), 40); assert.ok(quality.issues.includes("dc_offset"));

const track = new FakeTrack({ deviceId: "usb-mic", sampleRate: 48_000, channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true });
const stream = new FakeStream(track); const media = new FakeMediaDevices(stream);
media.devices = [{ kind: "audioinput", deviceId: "usb-mic", label: "USB microphone" }, { kind: "audioinput", deviceId: "bt-mic", label: "Bluetooth headset" }];
const context = new FakeContext(); const worklet = new FakeWorklet(); const chunks = []; const states = []; const reports = []; const deviceLists = []; const vadSignals = []; const qualitySignals = []; const errors = []; const recoveries = [];
const controller = new DuplexCaptureController({ mediaDevices: media, createAudioContext: () => context, createWorkletNode: () => worklet, now: () => 1_000, workletModuleUrl: "fixture-worklet.js" }, {
  sessionId: "session-1", deviceId: "usb-mic", initialUplinkCredit: { frames: 100, bytes: 96_000, audioMs: 2_000, acknowledgedSequence: -1 }, onChunk: (chunk) => chunks.push(chunk) > 0,
  onState: (state) => states.push(state), onError: (error) => errors.push(error), onConstraints: (report) => reports.push(report),
  onDevices: (devices) => deviceLists.push(devices), onVadSignal: (signal) => vadSignals.push(signal), onQuality: (signal) => qualitySignals.push(signal), onRecoveryRequired: (reason) => recoveries.push(reason),
});
assert.equal(media.calls, 0, "constructing the controller must not request microphone permission");
assert.equal(await controller.startFromUserGesture(), true);
assert.equal(media.calls, 1); assert.equal(context.loaded[0], "fixture-worklet.js"); assert.equal(states.at(-1), "active");
assert.equal(reports[0].echoCancellation, true); assert.equal(reports[0].noiseSuppression, false, "actual constraints are reported without pretending they succeeded");
assert.deepEqual(reports[0].degradations, ["noise_suppression_unavailable"]);
assert.equal(deviceLists[0].length, 2);
const loud = Float32Array.from({ length: 1_920 }, (_, index) => Math.sin(2 * Math.PI * 220 * index / 48_000) * 0.5);
for (let count = 0; count < 5; count += 1) worklet.push([loud, loud]);
assert.equal(chunks.length, 4); assert.equal(chunks[0].protocolVersion, 2); assert.equal(chunks[0].sampleRateHz, 24_000); assert.equal(chunks[0].durationMs, 40);
assert.equal(vadSignals.some((signal) => signal.speechCandidate), true);
assert.ok(qualitySignals.length >= 3); assert.equal(qualitySignals.at(-1).actualSampleRateHz, 48_000);
assert.equal(chunks.length, 4, "local VAD must not stop or commit the Duplex uplink");
const btTrack = new FakeTrack({ deviceId: "bt-mic", sampleRate: 48_000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }); const btStream = new FakeStream(btTrack);
media.resolver = (constraints) => constraints.audio.deviceId?.exact === "missing" ? Promise.reject(new Error("missing microphone")) : btStream;
assert.equal(await controller.switchDevice("bt-mic"), true); assert.equal(track.stopped, true); assert.equal(btTrack.stopped, false); assert.equal(controller.state, "active"); assert.equal(reports.at(-1).actualDeviceId, "bt-mic");
track.endExternally(); await new Promise((resolve) => setTimeout(resolve, 0)); assert.equal(controller.state, "active", "ended event from the replaced generation is ignored");
assert.equal(await controller.switchDevice("missing"), false); assert.equal(controller.state, "active"); assert.equal(btTrack.stopped, false, "a failed replacement preserves the current microphone");
media.resolver = () => Promise.reject(new Error("no replacement")); media.devices = []; media.change(); await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(recoveries.at(-1), "device_lost"); assert.equal(controller.state, "failed"); assert.equal(track.stopped, true); assert.match(errors.at(-1).message, /no longer available/);
await controller.dispose(); assert.equal(media.listeners.size, 0);

const rapidInitialTrack = new FakeTrack({ deviceId: "initial", sampleRate: 48_000 }); const rapidMedia = new FakeMediaDevices(new FakeStream(rapidInitialTrack)); rapidMedia.devices = [{ kind: "audioinput", deviceId: "initial", label: "Initial" }]; const rapidReports = [];
const rapid = new DuplexCaptureController({ mediaDevices: rapidMedia, createAudioContext: () => new FakeContext(), createWorkletNode: () => new FakeWorklet(), now: () => 2_000, workletModuleUrl: "fixture" }, { sessionId: "rapid", initialUplinkCredit: { frames: 10, bytes: 20_000, audioMs: 400, acknowledgedSequence: -1 }, onChunk: () => true, onState: () => undefined, onError: (error) => { throw error; }, onConstraints: (report) => rapidReports.push(report) });
await rapid.startFromUserGesture();
let resolveA; let resolveB; rapidMedia.resolver = (constraints) => new Promise((resolve) => { if (constraints.audio.deviceId?.exact === "a") resolveA = resolve; else resolveB = resolve; });
const switchA = rapid.switchDevice("a"); const switchB = rapid.switchDevice("b"); const trackA = new FakeTrack({ deviceId: "a", sampleRate: 48_000 }); const trackB = new FakeTrack({ deviceId: "b", sampleRate: 48_000 });
resolveB(new FakeStream(trackB)); assert.equal(await switchB, true); resolveA(new FakeStream(trackA)); assert.equal(await switchA, false);
assert.equal(trackA.stopped, true, "late stream from an obsolete switch is released"); assert.equal(trackB.stopped, false); assert.equal(rapidReports.at(-1).actualDeviceId, "b"); assert.equal(rapid.state, "active"); await rapid.dispose(); assert.equal(trackB.stopped, true);

const deniedMedia = new FakeMediaDevices(stream); deniedMedia.failure = Object.assign(new Error("denied"), { name: "NotAllowedError" }); const deniedStates = [];
const denied = new DuplexCaptureController({ mediaDevices: deniedMedia, createAudioContext: () => new FakeContext(), createWorkletNode: () => new FakeWorklet(), now: () => 0, workletModuleUrl: "fixture" }, { sessionId: "denied", initialUplinkCredit: { frames: 1, bytes: 1_920, audioMs: 40, acknowledgedSequence: -1 }, onChunk: () => true, onState: (state) => deniedStates.push(state), onError: () => undefined });
assert.equal(await denied.startFromUserGesture(), false); assert.deepEqual(deniedStates, ["requesting_permission", "failed"]); await denied.dispose();

const sleepTrack = new FakeTrack({ deviceId: "auto", sampleRate: 48_000 }); const sleepMedia = new FakeMediaDevices(new FakeStream(sleepTrack)); sleepMedia.devices = [{ kind: "audioinput", deviceId: "auto", label: "Built-in" }]; const sleepRecoveries = [];
const sleeping = new DuplexCaptureController({ mediaDevices: sleepMedia, createAudioContext: () => new FakeContext(), createWorkletNode: () => new FakeWorklet(), now: () => 0, workletModuleUrl: "fixture" }, { sessionId: "sleep", initialUplinkCredit: { frames: 1, bytes: 1_920, audioMs: 40, acknowledgedSequence: -1 }, onChunk: () => true, onState: () => undefined, onError: () => undefined, onRecoveryRequired: (reason) => sleepRecoveries.push(reason) });
await sleeping.startFromUserGesture(); await sleeping.handleLifecycle("sleep"); assert.equal(sleepRecoveries[0], "sleep"); assert.equal(sleeping.state, "recovering"); assert.equal(sleepTrack.stopped, true, "sleep releases the microphone without ending the Provider Session");
const resumedTrack = new FakeTrack({ deviceId: "auto", sampleRate: 48_000 }); sleepMedia.stream = new FakeStream(resumedTrack); await sleeping.handleLifecycle("resume"); assert.equal(sleeping.state, "active"); assert.equal(sleepMedia.calls, 2, "resume creates a fresh capture graph instead of reviving stale audio"); await sleeping.dispose(); assert.equal(resumedTrack.stopped, true);

const pauseTrack = new FakeTrack({ deviceId: "pause", sampleRate: 48_000 }); const pauseMedia = new FakeMediaDevices(new FakeStream(pauseTrack)); pauseMedia.devices = [{ kind: "audioinput", deviceId: "pause", label: "Pause mic" }]; const pausing = new DuplexCaptureController({ mediaDevices: pauseMedia, createAudioContext: () => new FakeContext(), createWorkletNode: () => new FakeWorklet(), now: () => 0, workletModuleUrl: "fixture" }, { sessionId: "pause", initialUplinkCredit: { frames: 1, bytes: 1_920, audioMs: 40, acknowledgedSequence: -1 }, onChunk: () => true, onState: () => undefined, onError: () => undefined });
await pausing.startFromUserGesture(); assert.equal(await pausing.pause(), true); assert.equal(pausing.state, "paused"); assert.equal(pauseTrack.stopped, true); assert.equal(await pausing.pause(), true, "pause is idempotent"); const pauseResumeTrack = new FakeTrack({ deviceId: "pause", sampleRate: 48_000 }); pauseMedia.stream = new FakeStream(pauseResumeTrack); assert.equal(await pausing.resumePaused(), true); assert.equal(pausing.state, "active"); assert.equal(pauseMedia.calls, 2); await pausing.dispose();

const vad = new DuplexLocalVad({ attackMs: 80, releaseMs: 120 }); const quiet = new Int16Array(960); const speech = Int16Array.from({ length: 960 }, (_, index) => index % 2 ? 12_000 : -12_000);
for (let count = 0; count < 5; count += 1) assert.equal(vad.observe(quiet, 40).speechCandidate, false);
assert.equal(vad.observe(speech, 40).speechCandidate, false); assert.equal(vad.observe(speech, 40).speechCandidate, true);
assert.equal(vad.observe(quiet, 40).speechCandidate, true); assert.equal(vad.observe(quiet, 80).speechCandidate, false);

const creditTrack = new FakeTrack({ deviceId: "credit", sampleRate: 48_000 }); const creditMedia = new FakeMediaDevices(new FakeStream(creditTrack)); creditMedia.devices = [{ kind: "audioinput", deviceId: "credit", label: "Credit mic" }];
const creditContext = new FakeContext(); const creditWorklet = new FakeWorklet(); const creditChunks = []; const creditVad = [];
const credited = new DuplexCaptureController({ mediaDevices: creditMedia, createAudioContext: () => creditContext, createWorkletNode: () => creditWorklet, now: () => 5_000, workletModuleUrl: "fixture" }, { sessionId: "credit", initialUplinkCredit: { frames: 0, bytes: 0, audioMs: 0, acknowledgedSequence: -1 }, onChunk: (chunk) => creditChunks.push(chunk) > 0, onState: () => undefined, onError: (error) => { throw error; }, onVadSignal: (signal) => creditVad.push(signal) });
await credited.startFromUserGesture();
creditWorklet.push([new Float32Array(1_920)]); for (let count = 0; count < 4; count += 1) creditWorklet.push([loud]);
assert.equal(creditChunks.length, 0, "credit=0 must stop IPC uplink");
assert.equal(creditVad.some((signal) => signal.speechCandidate), true, "local VAD remains active with zero credit");
credited.updateUplinkCredit({ frames: 2, bytes: 3_840, audioMs: 80, acknowledgedSequence: -1 });
creditWorklet.push([new Float32Array(1_920)]); creditWorklet.push([new Float32Array(1_920)]);
assert.deepEqual(creditChunks.map((chunk) => chunk.sequence), [0, 1], "wire sequence remains contiguous after dropped silence");
assert.ok(creditChunks[0].capturedAtMs < creditChunks[1].capturedAtMs, "queued speech preserves capture chronology without duplicate frames");
await credited.dispose();

console.log("Duplex Voice M2/M4 capture verified (band-limited resampling, quality monitoring, permission, constraints, lifecycle, VAD, and credit-aware uplink).");
