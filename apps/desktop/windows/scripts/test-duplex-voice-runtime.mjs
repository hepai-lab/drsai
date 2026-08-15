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

class WebApiValidatingSocket extends FakeSocket {
  close(code, reason) {
    if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999)) throw new DOMException("invalid code", "InvalidAccessError");
    super.close(code, reason);
  }
}

const adapter = new ZhizengzengRealtimeAdapter({ transcriptionModel: "gpt-4o-mini-transcribe" });
const request = {
  protocolVersion: 2, sessionId: "session-1", providerId: "zhizengzeng", modelId: "gpt-realtime-2",
  inputEncoding: "pcm_s16le", inputSampleRateHz: 24_000, outputEncoding: "pcm_s16le", outputSampleRateHz: 24_000,
  channels: 1, enableInputTranscription: true, enableOutputTranscription: true, enableServerVad: true, enableToolCalling: true,
};
const connection = adapter.resolveConnection("https://api.zhizengzeng.com/v1", "Bearer sk-test-runtime-secret");
const providerFailureSocket = new WebApiValidatingSocket(); const providerFailureEvents = [];
const providerFailureRuntime = new DuplexVoiceRuntime({ request: { ...request, sessionId: "provider-failure" }, connection, adapter, createSocket: () => providerFailureSocket, emit: (event) => providerFailureEvents.push(event), connectTimeoutMs: 60_000 });
providerFailureRuntime.start(); providerFailureSocket.open();
assert.doesNotThrow(() => providerFailureSocket.message({ type: "error", error: { code: "invalid_request_error", message: "provider rejected session" } }), "Provider errors must not escape into Electron's main process");
assert.equal(providerFailureRuntime.state, "terminal");
assert.deepEqual(providerFailureSocket.closed, [{ code: 4000, reason: "failed" }]);
assert.equal(providerFailureEvents.filter((event) => event.type === "failed").length, 1);

const socket = new FakeSocket();
const events = [];
const runtime = new DuplexVoiceRuntime({ request, connection, adapter, createSocket: () => socket, emit: (event) => events.push(event), connectTimeoutMs: 60_000 });

assert.equal(runtime.start(), true); assert.equal(runtime.start(), false); assert.equal(runtime.state, "connecting");
assert.deepEqual(runtime.uplinkCredit, { frames: 100, bytes: 96_000, audioMs: 2_000, acknowledgedSequence: -1 });
assert.equal(events.some((event) => event.type === "uplink_credit" && event.reason === "initial" && event.credit.frames === 100), true);
const chunk = (sequence, durationMs = 20) => ({ protocolVersion: 2, sessionId: request.sessionId, sequence, capturedAtMs: sequence * 20, durationMs, encoding: "pcm_s16le", sampleRateHz: 24_000, channels: 1, audioData: new Uint8Array([sequence & 255, 1]) });
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
assert.deepEqual(runtime.uplinkCredit, { frames: 61, bytes: 58_560, audioMs: 1_220, acknowledgedSequence: 60 });
const creditEventsAfterAck = events.filter((event) => event.type === "uplink_credit").length;
socket.message({ type: "input_audio_buffer.committed", sequence: 59 });
assert.equal(events.filter((event) => event.type === "uplink_credit").length, creditEventsAfterAck, "out-of-order ack cannot inflate credit");
assert.equal(events.some((event) => event.type === "flow_control" && event.paused === false), true);
socket.message({ type: "session.updated", session: { id: "provider-session" } });
socket.message({ type: "response.created", response: { id: "response-1" } });
socket.message({ type: "response.output_audio.delta", response_id: "response-1", item_id: "item-1", content_index: 0, delta: Buffer.from([1, 2, 3]).toString("base64") });
socket.message({ type: "response.function_call_arguments.done", call_id: "call-1", item_id: "tool-1", name: "search", arguments: "{}" });
assert.equal(events.some((event) => event.type === "session_started"), true);
assert.equal(events.some((event) => event.type === "response_audio_delta" && event.delta.audioData.byteLength === 3), true);
assert.equal(events.some((event) => event.type === "tool_call"), true);
const providerMessagesBeforeText = socket.sent.length; assert.equal(runtime.submitTextInput("text-1", "typed message"), true); const textMessages = socket.sent.slice(-2).map(JSON.parse); assert.deepEqual(textMessages.map((value) => value.type), ["conversation.item.create", "response.create"]); assert.equal(runtime.submitTextInput("text-1", "typed message"), true); assert.equal(socket.sent.length, providerMessagesBeforeText + 2, "duplicate text item ID is idempotent"); socket.message({ type: "conversation.item.created", item: { id: "text-1", role: "user", content: [{ type: "input_text", text: "typed message" }] } }); assert.equal(events.some((event) => event.type === "input_transcript_completed" && event.itemId === "text-1" && event.text === "typed message"), true);
assert.equal(runtime.submitTextInput("text-1", "different"), false, "duplicate item identity cannot mutate text"); assert.equal(runtime.submitTextInput("too-large", "x".repeat(20_001)), false);
assert.equal(runtime.update({ ...request, instructions: "Be concise", updateId: "update-hot-1" }), true); assert.equal(runtime.update({ ...request, instructions: "racing", updateId: "update-hot-2" }), false, "only one Provider update may be pending"); socket.message({ type: "session.updated", session: { id: "provider-session" } }); assert.equal(events.some((event) => event.type === "session_update_ack" && event.updateId === "update-hot-1" && event.status === "applied"), true);
assert.equal(runtime.update({ ...request, instructions: "Be concise", voice: "other", updateId: "update-restart-1" }), true); assert.equal(events.some((event) => event.type === "session_update_ack" && event.updateId === "update-restart-1" && event.status === "requires_restart" && event.changedFields.includes("voice")), true);
assert.equal(runtime.update({ ...request, instructions: "Rejected", updateId: "update-reject-1" }), true); socket.message({ type: "error", error: { code: "invalid_request_error", message: "instructions rejected" } }); assert.equal(events.some((event) => event.type === "session_update_ack" && event.updateId === "update-reject-1" && event.status === "rejected"), true); assert.equal(runtime.state, "connected", "a rejected hot update rolls back without killing the Session");
assert.equal(runtime.interrupt("interrupt-1", "response-1", "item-1", 0, 320, "user_speech"), true);
assert.equal(events.some((event) => event.type === "interrupted" && event.interruptId === "interrupt-1" && event.responseId === "response-1"), true);
const providerMessagesAfterInterrupt = socket.sent.length;
assert.equal(runtime.interrupt("interrupt-manual", "response-1", "item-1", 0, 321, "manual"), true);
assert.equal(socket.sent.length, providerMessagesAfterInterrupt, "automatic/manual races cannot send duplicate Provider cancel or truncate messages");
assert.equal(events.filter((event) => event.type === "interrupted" && event.responseId === "response-1").length, 1, "one response has one interrupt outcome");
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

const churnRuntimes = []; const churnRegistry = new DuplexSessionRegistry({ maxGlobalSessions: 1, createRuntime: (_ownerId, nextRequest, emit) => { const nextSocket = new FakeSocket(); const nextRuntime = new DuplexVoiceRuntime({ request: nextRequest, connection, adapter, createSocket: () => nextSocket, emit, connectTimeoutMs: 60_000 }); churnRuntimes.push(nextRuntime); return nextRuntime; }, emitBatch: () => {}, scheduleFlush: () => 1, cancelFlush: () => undefined });
for (let index = 0; index < 1_000; index += 1) { const id = `churn-${index}`; churnRegistry.start(`owner-${index}`, { ...request, sessionId: id }); assert.equal(churnRegistry.disposeSession(id, `owner-${index}`), true); }
assert.deepEqual(churnRegistry.snapshot(), { sessions: 0, owners: 0 }); assert.ok(churnRuntimes.every((candidate) => { const value = candidate.snapshot(); return value.state === "disposed" && value.pendingChunks === 0 && value.bufferedAudioMs === 0; }), "1,000 sessions release runtime queues and registry ownership");

const boundedBatches = []; const flushCallbacks = []; const batchSocket = new FakeSocket(); let batchRuntime;
const batchRegistry = new DuplexSessionRegistry({
  createRuntime: (_ownerId, nextRequest, emit) => (batchRuntime = new DuplexVoiceRuntime({ request: nextRequest, connection, adapter, createSocket: () => batchSocket, emit, connectTimeoutMs: 60_000 })),
  emitBatch: (_ownerId, batch) => boundedBatches.push(batch),
  scheduleFlush: (callback) => { flushCallbacks.push(callback); return flushCallbacks.length; }, cancelFlush: () => undefined,
});
batchRegistry.start("batch-window", { ...request, sessionId: "batch-session" }); batchSocket.open();
while (flushCallbacks.length) flushCallbacks.shift()();
batchSocket.message({ type: "response.output_audio.delta", response_id: "response-large", item_id: "item-large", content_index: 0, delta: Buffer.alloc(200_000, 7).toString("base64") });
batchSocket.message({ type: "response.output_audio.done", response_id: "response-large", item_id: "item-large", content_index: 0 });
while (flushCallbacks.length) flushCallbacks.shift()();
const audioEvents = boundedBatches.flat().filter((event) => event.type === "response_audio_delta");
assert.equal(audioEvents.length, 75, "Main sends only the negotiated playback watermark before consumption ack");
assert.equal(audioEvents.reduce((total, event) => total + event.delta.audioData.byteLength, 0), 144_000);
assert.equal(boundedBatches.flat().some((event) => event.type === "response_audio_completed"), false, "completion cannot overtake credit-held audio");
assert.equal(boundedBatches.flat().some((event) => event.type === "flow_control" && event.direction === "playback" && event.paused), true);
assert.equal(batchRuntime.acknowledgePlayback({ protocolVersion: 2, sessionId: "batch-session", receivedSequence: 74, scheduledSequence: 74, playedSequence: -1, receivedAudioMs: 3_000, scheduledAudioMs: 3_000, playedAudioMs: 0 }), true);
while (flushCallbacks.length) flushCallbacks.shift()(); assert.equal(boundedBatches.flat().filter((event) => event.type === "response_audio_delta").length, 75, "scheduled-but-unplayed audio does not replenish end-to-end credit");
assert.equal(batchRuntime.acknowledgePlayback({ protocolVersion: 2, sessionId: "batch-session", receivedSequence: 74, scheduledSequence: 74, playedSequence: 60, receivedAudioMs: 3_000, scheduledAudioMs: 3_000, playedAudioMs: 2_440 }), true);
while (flushCallbacks.length) flushCallbacks.shift()();
const allAudioEvents = boundedBatches.flat().filter((event) => event.type === "response_audio_delta");
assert.equal(allAudioEvents.reduce((total, event) => total + event.delta.audioData.byteLength, 0), 200_000, "scheduled ack replenishes credit without dropping the long response");
const downlinkCompletion = boundedBatches.flat().find((event) => event.type === "response_audio_completed"); assert.equal(downlinkCompletion.finalSequence, allAudioEvents.at(-1).delta.sequence);
assert.equal(boundedBatches.flat().some((event) => event.type === "flow_control" && event.direction === "playback" && !event.paused), true);
assert.equal(batchRuntime.acknowledgePlayback({ protocolVersion: 2, sessionId: "batch-session", receivedSequence: 74, scheduledSequence: 74, playedSequence: 60, receivedAudioMs: 3_000, scheduledAudioMs: 3_000, playedAudioMs: 2_440 }), true, "lost acknowledgements may be retried idempotently");
assert.equal(batchRuntime.acknowledgePlayback({ protocolVersion: 2, sessionId: "batch-session", receivedSequence: 73, scheduledSequence: 73, playedSequence: 60, receivedAudioMs: 2_960, scheduledAudioMs: 2_960, playedAudioMs: 2_440 }), false, "regressing acknowledgements cannot inflate downlink credit");
for (const batch of boundedBatches) {
  assert.ok(batch.length <= 24);
  assert.ok(batch.reduce((total, event) => total + (event.type === "response_audio_delta" ? event.delta.audioData.byteLength : Buffer.byteLength(JSON.stringify(event))), 0) <= 256 * 1024);
}
batchRegistry.disposeAll();

const updateTimers = []; const updateSocket = new FakeSocket(); const updateEvents = []; const updateRuntime = new DuplexVoiceRuntime({ request: { ...request, sessionId: "update-timeout" }, connection, adapter, createSocket: () => updateSocket, emit: (event) => updateEvents.push(event), schedule: (callback, delay) => { const timer = { callback, delay, cancelled: false }; updateTimers.push(timer); return timer; }, cancelSchedule: (timer) => { timer.cancelled = true; } });
updateRuntime.start(); updateSocket.open(); assert.equal(updateRuntime.update({ ...request, sessionId: "update-timeout", instructions: "timeout", updateId: "update-timeout-1" }), true); const timeoutTimer = updateTimers.find((timer) => timer.delay === 2_000 && !timer.cancelled); assert.ok(timeoutTimer); timeoutTimer.callback(); assert.equal(updateEvents.some((event) => event.type === "session_update_ack" && event.status === "rolled_back"), true); assert.equal(updateSocket.sent.filter((raw) => JSON.parse(raw).type === "session.update").length, 3, "timeout sends start, update, then rollback"); updateRuntime.dispose();

const takeoverSockets = [];
const takeoverRegistry = new DuplexSessionRegistry({
  maxGlobalSessions: 1,
  createRuntime: (_ownerId, nextRequest, emit) => { const nextSocket = new FakeSocket(); takeoverSockets.push(nextSocket); return new DuplexVoiceRuntime({ request: nextRequest, connection, adapter, createSocket: () => nextSocket, emit, connectTimeoutMs: 60_000 }); },
  emitBatch: () => undefined,
});
const occupiedResult = takeoverRegistry.start("41", { ...request, sessionId: "occupied-session" });
assert.deepEqual(takeoverRegistry.occupancy("42"), {
  occupied: true, sessionId: "occupied-session", ownerWindowId: 41, ownerLabel: "Window 41",
  startedAt: occupiedResult.acceptedAt, ownedByCaller: false,
});
assert.equal(takeoverRegistry.occupancy("41").ownedByCaller, true);
assert.throws(() => takeoverRegistry.start("42", { ...request, sessionId: "blocked-session" }), /capacity/);
assert.throws(() => takeoverRegistry.takeOver("42", "stale-session", { ...request, sessionId: "takeover-session" }), /occupancy changed/);
const takeoverResult = takeoverRegistry.takeOver("42", "occupied-session", { ...request, sessionId: "takeover-session" });
assert.equal(takeoverResult.sessionId, "takeover-session");
assert.equal(takeoverSockets[0].closed.length, 1, "takeover cancels the original Provider socket");
assert.equal(takeoverRegistry.occupancy("42").ownedByCaller, true);
assert.throws(() => takeoverRegistry.takeOver("43", "occupied-session", { ...request, sessionId: "raced-session" }), /occupancy changed/);
assert.equal(takeoverRegistry.disposeOwner("42"), true, "owner destruction releases the taken-over session");
assert.equal(takeoverRegistry.occupancy("43").occupied, false);

const soakSocket = new FakeSocket(); let soakRejected = 0; let soakMaxBufferedMs = 0; let soakCreditEvents = 0;
const soakRuntime = new DuplexVoiceRuntime({ request: { ...request, sessionId: "credit-soak" }, connection, adapter, createSocket: () => soakSocket, emit: (event) => { if (event.type === "uplink_credit") soakCreditEvents += 1; }, connectTimeoutMs: 60_000 });
soakRuntime.start(); soakSocket.open();
for (let sequence = 0; sequence < 15_000; sequence += 1) {
  if (!soakRuntime.pushAudio({ ...chunk(sequence, 40), sessionId: "credit-soak", audioData: new Uint8Array(1_920) })) soakRejected += 1;
  if (sequence % 17 === 0 && sequence > 0) soakSocket.message({ type: "opendrsai.input_audio_ack", sequence: sequence - 1, buffered_audio_ms: 0 });
  soakSocket.message({ type: "opendrsai.input_audio_ack", sequence, buffered_audio_ms: 0 });
  soakMaxBufferedMs = Math.max(soakMaxBufferedMs, soakRuntime.snapshot().bufferedAudioMs);
}
assert.equal(soakRejected, 0, "10-minute acknowledged uplink must not cancel under normal congestion");
assert.ok(soakMaxBufferedMs <= 40);
assert.ok(soakCreditEvents >= 15_001);
assert.deepEqual(soakRuntime.uplinkCredit, { frames: 100, bytes: 96_000, audioMs: 2_000, acknowledgedSequence: 14_999 });
soakRuntime.cancel(); soakRuntime.dispose();

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
