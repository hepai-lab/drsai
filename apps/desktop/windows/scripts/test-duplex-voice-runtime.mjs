import assert from "node:assert/strict";

const { ZhizengzengRealtimeAdapter } = await import("../../shared/main/voice/duplex/zhizengzengRealtimeAdapter.ts");
const { DuplexVoiceRuntime } = await import("../../shared/main/voice/duplex/runtime.ts");
const { DuplexSessionRegistry } = await import("../../shared/main/voice/duplex/sessionRegistry.ts");

class FakeSocket {
  readyState = 0; sent = []; closed = []; listeners = new Map();
  addEventListener(type, listener) { const values = this.listeners.get(type) ?? []; values.push(listener); this.listeners.set(type, values); }
  send(data) { if (this.readyState !== 1) throw new Error("socket closed"); this.sent.push(data); }
  close(code, reason) { if (this.readyState === 3) return; this.readyState = 3; this.closed.push({ code, reason }); this.dispatch("close", {}); }
  open() { this.readyState = 1; this.dispatch("open", {}); }
  message(value) { this.dispatch("message", { data: JSON.stringify(value) }); }
  fail() { this.dispatch("error", {}); }
  dispatch(type, event) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}

const adapter = new ZhizengzengRealtimeAdapter({ transcriptionModel: "gpt-4o-mini-transcribe" });
const request = {
  protocolVersion: 1, sessionId: "session-1", providerId: "zhizengzeng", modelId: "gpt-realtime-2",
  inputEncoding: "pcm_s16le", inputSampleRateHz: 24_000, outputEncoding: "pcm_s16le", outputSampleRateHz: 24_000,
  channels: 1, enableInputTranscription: true, enableOutputTranscription: true, enableServerVad: true, enableToolCalling: true,
};
const connection = adapter.resolveConnection("https://api.zhizengzeng.com/v1", "Bearer sk-test-runtime-secret");
const socket = new FakeSocket();
const events = [];
const runtime = new DuplexVoiceRuntime({ request, connection, adapter, createSocket: () => socket, emit: (event) => events.push(event), connectTimeoutMs: 60_000 });

assert.equal(runtime.start(), true); assert.equal(runtime.start(), false); assert.equal(runtime.state, "connecting");
const chunk = (sequence, durationMs = 20) => ({ protocolVersion: 1, sessionId: request.sessionId, sequence, capturedAtMs: sequence * 20, durationMs, encoding: "pcm_s16le", sampleRateHz: 24_000, channels: 1, audioData: new Uint8Array([sequence & 255, 1]) });
assert.equal(runtime.pushAudio(chunk(0)), true);
assert.equal(runtime.pushAudio(chunk(2)), false, "non-monotonic audio is rejected");
socket.open();
assert.equal(runtime.state, "connected");
assert.equal(socket.sent.some((raw) => JSON.parse(raw).type === "session.update"), true);
assert.equal(socket.sent.some((raw) => JSON.parse(raw).type === "input_audio_buffer.append"), true);
for (let sequence = 1; sequence < 100; sequence += 1) assert.equal(runtime.pushAudio(chunk(sequence)), true);
assert.equal(runtime.pushAudio(chunk(100)), false, "uplink is bounded at the negotiated high watermark");
assert.equal(runtime.snapshot().bufferedAudioMs, 2_000);
socket.message({ type: "input_audio_buffer.committed", sequence: 60 });
assert.equal(runtime.snapshot().bufferedAudioMs, 780);
assert.equal(events.some((event) => event.type === "flow_control" && event.paused === false), true);
socket.message({ type: "session.updated", session: { id: "provider-session" } });
socket.message({ type: "response.created", response: { id: "response-1" } });
socket.message({ type: "response.output_audio.delta", response_id: "response-1", item_id: "item-1", content_index: 0, delta: Buffer.from([1, 2, 3]).toString("base64") });
socket.message({ type: "response.function_call_arguments.done", call_id: "call-1", item_id: "tool-1", name: "search", arguments: "{}" });
assert.equal(events.some((event) => event.type === "session_started"), true);
assert.equal(events.some((event) => event.type === "response_audio_delta" && event.delta.audioData.byteLength === 3), true);
assert.equal(events.some((event) => event.type === "tool_call"), true);
assert.equal(runtime.interrupt("response-1", "item-1", 0, 320, "user_speech"), true);
assert.equal(runtime.submitToolResult("call-1", '{"ok":true}'), true);
assert.equal(runtime.cancel(), true); assert.equal(runtime.cancel(), false);
socket.fail(); socket.close(1006, "race");
assert.equal(events.filter((event) => ["completed", "cancelled", "failed"].includes(event.type)).length, 1);
runtime.dispose(); runtime.dispose();
assert.deepEqual(runtime.snapshot(), { state: "disposed", bufferedAudioMs: 0, pendingChunks: 0, terminalEmitted: true });

const batches = []; const sockets = [];
const registry = new DuplexSessionRegistry({
  maxGlobalSessions: 2,
  createRuntime: (_ownerId, nextRequest, emit) => { const nextSocket = new FakeSocket(); sockets.push(nextSocket); return new DuplexVoiceRuntime({ request: nextRequest, connection, adapter, createSocket: () => nextSocket, emit, connectTimeoutMs: 60_000 }); },
  emitBatch: (ownerId, batch) => batches.push({ ownerId, batch }), scheduleFlush: () => 1, cancelFlush: () => undefined,
});
const request2 = { ...request, sessionId: "session-2" };
assert.equal(registry.start("window-1", request).sessionId, "session-1");
assert.equal(registry.start("window-1", request).sessionId, "session-1");
assert.throws(() => registry.start("window-1", request2), /already owns/);
assert.equal(registry.start("window-2", request2).sessionId, "session-2");
assert.throws(() => registry.start("window-3", { ...request, sessionId: "session-3" }), /capacity/);
sockets[0].open(); sockets[1].open();
assert.equal(registry.get("session-1", "window-2"), undefined);
assert.equal(registry.disposeOwner("window-1"), true);
assert.deepEqual(registry.snapshot(), { sessions: 1, owners: 1 });
assert.equal(registry.disposeSession("session-2", "window-2"), true);
assert.deepEqual(registry.snapshot(), { sessions: 0, owners: 0 });

const boundedBatches = []; const flushCallbacks = []; const batchSocket = new FakeSocket();
const batchRegistry = new DuplexSessionRegistry({
  createRuntime: (_ownerId, nextRequest, emit) => new DuplexVoiceRuntime({ request: nextRequest, connection, adapter, createSocket: () => batchSocket, emit, connectTimeoutMs: 60_000 }),
  emitBatch: (_ownerId, batch) => boundedBatches.push(batch),
  scheduleFlush: (callback) => { flushCallbacks.push(callback); return flushCallbacks.length; }, cancelFlush: () => undefined,
});
batchRegistry.start("batch-window", { ...request, sessionId: "batch-session" }); batchSocket.open();
while (flushCallbacks.length) flushCallbacks.shift()();
batchSocket.message({ type: "response.output_audio.delta", response_id: "response-large", item_id: "item-large", content_index: 0, delta: Buffer.alloc(200_000, 7).toString("base64") });
while (flushCallbacks.length) flushCallbacks.shift()();
const audioEvents = boundedBatches.flat().filter((event) => event.type === "response_audio_delta");
assert.equal(audioEvents.length, 4, "large Provider audio is split before IPC");
assert.equal(audioEvents.reduce((total, event) => total + event.delta.audioData.byteLength, 0), 200_000);
for (const batch of boundedBatches) {
  assert.ok(batch.length <= 24);
  assert.ok(batch.reduce((total, event) => total + (event.type === "response_audio_delta" ? event.delta.audioData.byteLength : Buffer.byteLength(JSON.stringify(event))), 0) <= 256 * 1024);
}
batchRegistry.disposeAll();

for (let iteration = 0; iteration < 10_000; iteration += 1) {
  const raceSocket = new FakeSocket(); const raceEvents = [];
  const raceRuntime = new DuplexVoiceRuntime({ request: { ...request, sessionId: `race-${iteration}` }, connection, adapter, createSocket: () => raceSocket, emit: (event) => raceEvents.push(event), connectTimeoutMs: 60_000 });
  raceRuntime.start(); raceSocket.open();
  if (iteration % 3 === 0) raceRuntime.stop(); else if (iteration % 3 === 1) raceRuntime.cancel(); else raceSocket.fail();
  raceSocket.close(1006, "raced"); raceRuntime.dispose();
  assert.equal(raceEvents.filter((event) => ["completed", "cancelled", "failed"].includes(event.type)).length, 1);
}

assert.equal(JSON.stringify(events).includes("sk-test-runtime-secret"), false);
console.log("Duplex Voice M3 runtime verified (registry, lifecycle, bounds, isolation, unique terminal x10000, and cleanup).");
