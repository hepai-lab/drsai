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
  url: "wss://speech.example.test/v1/stream", token: "main-only-secret", sessionId: "session-ws", turnId: request.turnId,
  request, emit: (event) => events.push(event), createSocket: () => socket,
});
runtime.start();
const chunk = (sequence) => ({ sessionId: "session-ws", turnId: "turn-ws", sequence, capturedAtMs: sequence * 100, durationMs: 100, encoding: "pcm_s16le", sampleRateHz: 16_000, channels: 1, audioData: new Uint8Array(3_200) });
assert.equal(runtime.pushAudio(chunk(0)), true, "audio must buffer while connecting");
socket.open();
assert.equal(JSON.parse(socket.sent[0]).type, "start");
assert.equal(JSON.parse(socket.sent[0]).token, "main-only-secret");
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

console.log("WebSocket streaming runtime tests passed (connect buffering, auth in Main, PCM frames, protocol mapping, errors, cancellation boundary, and URL security).");
rmSync(bundlePath, { force: true });
