import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const bundlePath = join(tmpdir(), `opendrsai-streaming-provider-${process.pid}-${Date.now()}.mjs`);
await build({ entryPoints: [new URL("../src/main/voiceStreaming/websocketStreamingRuntime.ts", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))], outfile: bundlePath, bundle: true, format: "esm", platform: "node" });
const { WebSocketStreamingTranscriptionRuntime, validateStreamingProviderUrl } = await import(pathToFileURL(bundlePath).href);
class FakeSocket extends EventEmitter {
  readyState = 0;
  sent = [];
  closed = null;
  addEventListener(type, listener) { this.on(type, listener); }
  send(data) { this.sent.push(data); }
  close(code, reason) { this.closed = { code, reason }; }
  open() { this.readyState = 1; this.emit("open", new Event("open")); }
  message(value) { this.emit("message", { data: typeof value === "string" ? value : JSON.stringify(value) }); }
}
const request = { turnId: "turn-ws", encoding: "pcm_s16le", sampleRateHz: 16_000, channels: 1, frameDurationMs: 20, providerEndpointing: true };
const events = [];
const socket = new FakeSocket();
const runtime = new WebSocketStreamingTranscriptionRuntime({
  url: "ws://127.0.0.1:28642/v1/audio/transcriptions/stream", token: "main-only-secret",
  authentication: { authorization: "Bearer oidc-test-token", principalId: "user-1" },
  sessionId: "session-ws", turnId: request.turnId,
  request, emit: (event) => events.push(event), createSocket: () => socket,
});
runtime.start();
const chunk = (sequence) => ({ sessionId: "session-ws", turnId: "turn-ws", sequence, capturedAtMs: sequence * 100, durationMs: 100, encoding: "pcm_s16le", sampleRateHz: 16_000, channels: 1, audioData: new Uint8Array(3_200) });
assert.equal(runtime.pushAudio(chunk(0)), true, "audio must buffer while connecting");
socket.open();
assert.equal(JSON.parse(socket.sent[0]).type, "start");
assert.equal(JSON.parse(socket.sent[0]).token, "main-only-secret");
assert.equal(JSON.parse(socket.sent[0]).authorization, "Bearer oidc-test-token");
assert.equal(JSON.parse(socket.sent[0]).principalId, "user-1");
assert.equal(JSON.parse(socket.sent[1]).type, "audio");
assert.ok(socket.sent[2] instanceof Uint8Array);
socket.message({ type: "accepted" });
socket.message({ type: "ack", sequence: 0, bufferedAudioMs: 25 });
socket.message({ type: "partial", text: "hello", revision: 1, confidence: 0.8 });
socket.message({ type: "endpoint", reason: "provider" });
socket.message({ type: "final", text: "hello world", revision: 2 });
socket.message({ type: "completed" });
assert.deepEqual(events.map((event) => event.type), ["accepted", "audio_ack", "partial", "endpoint", "final", "completed"]);
assert.deepEqual(events.map((event) => event.sequence), [0, 1, 2, 3, 4, 5]);
assert.equal(events[1].ack.acknowledgedSequence, 0);
assert.equal(events[2].segment.text, "hello");
assert.deepEqual(socket.closed, { code: 1000, reason: "completed" });
assert.equal(runtime.pushAudio(chunk(1)), false);

const resumeEvents = [];
const resumeSockets = [];
let reconnectCallback = null;
const resumeRuntime = new WebSocketStreamingTranscriptionRuntime({
  ...runtime.options,
  sessionId: "resume-session",
  supportsResume: true,
  reconnectDelayMs: 10,
  emit: (event) => resumeEvents.push(event),
  createSocket: () => { const next = new FakeSocket(); resumeSockets.push(next); return next; },
  scheduleReconnect: (callback) => { reconnectCallback = callback; return { fixture: true }; },
  cancelScheduledReconnect: () => {},
});
const resumeChunk = (sequence) => ({ ...chunk(sequence), sessionId: "resume-session" });
resumeRuntime.start();
const resumeSocket1 = resumeSockets[0];
resumeSocket1.open();
assert.equal(resumeRuntime.pushAudio(resumeChunk(0)), true);
assert.equal(resumeRuntime.pushAudio(resumeChunk(1)), true);
resumeSocket1.message({ type: "accepted", eventSequence: 0 });
resumeSocket1.message({ type: "ack", eventSequence: 1, sequence: 0, bufferedAudioMs: 100 });
resumeSocket1.emit("close", new Event("close"));
assert.equal(resumeEvents.at(-1).type, "connection_state");
assert.equal(resumeEvents.at(-1).state, "reconnecting");
assert.equal(typeof reconnectCallback, "function");
reconnectCallback();
const resumeSocket2 = resumeSockets[1];
resumeSocket2.open();
const resumeStart = JSON.parse(resumeSocket2.sent[0]);
assert.deepEqual(resumeStart.resume, { lastAcknowledgedAudioSequence: 0, lastProviderEventSequence: 1 });
assert.equal(JSON.parse(resumeSocket2.sent[1]).sequence, 1, "only unacknowledged audio may be resent");
assert.ok(resumeSocket2.sent[2] instanceof Uint8Array);
assert.equal(resumeEvents.at(-1).state, "reconnected");
const eventCountBeforeDuplicate = resumeEvents.length;
resumeSocket2.message({ type: "partial", eventSequence: 1, text: "duplicate", revision: 1 });
assert.equal(resumeEvents.length, eventCountBeforeDuplicate, "replayed provider events must be ignored");
resumeSocket2.message({ type: "partial", eventSequence: 2, text: "resumed", revision: 2 });
assert.equal(resumeEvents.at(-1).segment.text, "resumed");
assert.equal(resumeRuntime.endInput("manual"), true);
assert.equal(JSON.parse(resumeSocket2.sent.at(-1)).type, "end_input");

const staleEventCount = resumeEvents.length;
resumeSocket1.message({ type: "final", eventSequence: 3, text: "stale socket", revision: 3 });
assert.equal(resumeEvents.length, staleEventCount, "a replaced socket must not pollute the resumed turn");

const gapEvents = [];
const gapSocket = new FakeSocket();
const gapRuntime = new WebSocketStreamingTranscriptionRuntime({
  ...runtime.options, sessionId: "gap-session", supportsResume: true,
  emit: (event) => gapEvents.push(event), createSocket: () => gapSocket,
});
gapRuntime.start();
gapSocket.open();
gapSocket.message({ type: "accepted", eventSequence: 0 });
gapSocket.message({ type: "partial", eventSequence: 2, text: "gap", revision: 1 });
assert.equal(gapEvents.at(-1).type, "failed", "a provider event gap must fail instead of silently corrupting order");

const exhaustedEvents = [];
const exhaustedSockets = [];
const exhaustedCallbacks = [];
const exhaustedRuntime = new WebSocketStreamingTranscriptionRuntime({
  ...runtime.options, sessionId: "exhausted-session", supportsResume: true, maxReconnectAttempts: 2,
  emit: (event) => exhaustedEvents.push(event),
  createSocket: () => { const next = new FakeSocket(); exhaustedSockets.push(next); return next; },
  scheduleReconnect: (callback) => { exhaustedCallbacks.push(callback); return { fixture: exhaustedCallbacks.length }; },
  cancelScheduledReconnect: () => {},
});
exhaustedRuntime.start();
exhaustedSockets[0].open();
exhaustedSockets[0].emit("close", new Event("close"));
exhaustedCallbacks[0]();
exhaustedSockets[1].open();
exhaustedSockets[1].emit("close", new Event("close"));
exhaustedCallbacks[1]();
exhaustedSockets[2].open();
exhaustedSockets[2].emit("close", new Event("close"));
assert.equal(exhaustedEvents.at(-1).type, "failed", "reconnect exhaustion must become an explicit terminal failure");
assert.equal(exhaustedSockets.length, 3, "initial connection plus two bounded retries are allowed");

const boundedSocket = new FakeSocket();
const boundedRuntime = new WebSocketStreamingTranscriptionRuntime({ ...runtime.options, sessionId: "bounded-session", createSocket: () => boundedSocket });
boundedRuntime.start();
boundedSocket.open();
const boundedChunk = (sequence) => ({ ...chunk(sequence), sessionId: "bounded-session" });
for (let sequence = 0; sequence < 20; sequence += 1) assert.equal(boundedRuntime.pushAudio(boundedChunk(sequence)), true);
assert.equal(boundedRuntime.pushAudio(boundedChunk(20)), false, "unacknowledged resend window must remain bounded to two seconds");
boundedRuntime.dispose();

let cancelledTimers = 0;
for (let index = 0; index < 1_000; index += 1) {
  const stressSocket = new FakeSocket();
  const stressRuntime = new WebSocketStreamingTranscriptionRuntime({
    ...runtime.options, sessionId: `stress-${index}`, supportsResume: true,
    createSocket: () => stressSocket,
    scheduleReconnect: () => ({ fixture: index }),
    cancelScheduledReconnect: () => { cancelledTimers += 1; },
  });
  stressRuntime.start();
  stressSocket.open();
  stressSocket.emit("close", new Event("close"));
  stressRuntime.dispose();
}
assert.equal(cancelledTimers, 1_000, "dispose must release every scheduled reconnect timer");

const failureEvents = [];
const failureSocket = new FakeSocket();
const failureRuntime = new WebSocketStreamingTranscriptionRuntime({ ...runtime.options, sessionId: "failure-session", emit: (event) => failureEvents.push(event), createSocket: () => failureSocket });
failureRuntime.start();
failureSocket.open();
failureSocket.message({ type: "error", status: 429, message: "rate limited" });
assert.equal(failureEvents.at(-1).type, "failed");
assert.equal(failureEvents.at(-1).error.code, "rate_limited");
assert.equal(failureEvents.at(-1).error.retryable, true);

assert.equal(validateStreamingProviderUrl("ws://127.0.0.1:9999/voice").protocol, "ws:");
assert.equal(validateStreamingProviderUrl("wss://provider.example/voice").protocol, "wss:");
assert.throws(() => validateStreamingProviderUrl("ws://provider.example/voice"), /WSS/);
assert.throws(() => validateStreamingProviderUrl("https://provider.example/voice"), /WSS/);
assert.throws(() => validateStreamingProviderUrl("wss://user:pass@provider.example/voice"), /credentials/);

console.log("WebSocket streaming runtime tests passed (resume cursors, bounded resend, stale/gap rejection, retry exhaustion, 1000-cycle cleanup, protocol mapping, errors, cancellation, and URL security).");
rmSync(bundlePath, { force: true });
