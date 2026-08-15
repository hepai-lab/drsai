import assert from "node:assert/strict";
import { DuplexVoiceRuntime } from "../../shared/main/voice/duplex/runtime.ts";
import { ZhizengzengRealtimeAdapter } from "../../shared/main/voice/duplex/zhizengzengRealtimeAdapter.ts";
import { DuplexRuntimeMetrics, DuplexSessionBudget, reconnectDelayMs, redactDuplexDiagnostic, summarizeDuplexMetric } from "../../shared/main/voice/duplex/runtimePolicy.ts";
import { duplexLifecycleAction, duplexLifecyclePolicy } from "../../shared/renderer/src/voice/duplex/lifecyclePolicy.ts";

class Clock {
  now = 0; next = 1; timers = new Map();
  schedule = (callback, delay) => { const id = this.next++; this.timers.set(id, { at: this.now + delay, callback }); return id; };
  cancel = (id) => { this.timers.delete(id); };
  advance(ms) { const target = this.now + ms; while (true) { const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; this.timers.delete(due[0]); this.now = due[1].at; due[1].callback(); } this.now = target; }
}
class Socket { readyState = 0; sent = []; listeners = new Map(); addEventListener(type, callback) { this.listeners.set(type, [...this.listeners.get(type) ?? [], callback]); } send(value) { this.sent.push(JSON.parse(value)); } close() { if (this.readyState === 3) return; this.readyState = 3; this.fire("close", {}); } open() { this.readyState = 1; this.fire("open", {}); } message(value) { this.fire("message", { data: JSON.stringify(value) }); } fire(type, event) { for (const callback of this.listeners.get(type) ?? []) callback(event); } }
const adapter = new ZhizengzengRealtimeAdapter({ transcriptionModel: "gpt-4o-mini-transcribe" });
const request = { protocolVersion: 2, sessionId: "recovery", providerId: "zhizengzeng", modelId: "gpt-realtime-2", inputEncoding: "pcm_s16le", inputSampleRateHz: 24_000, outputEncoding: "pcm_s16le", outputSampleRateHz: 24_000, channels: 1, enableInputTranscription: true, enableOutputTranscription: true, enableServerVad: true, enableToolCalling: true };
const connection = adapter.resolveConnection("https://api.zhizengzeng.com/v1", "Bearer secret-canary");
const clock = new Clock(); const sockets = []; const events = [];
const runtime = new DuplexVoiceRuntime({ request, connection, adapter, createSocket: () => { const socket = new Socket(); sockets.push(socket); return socket; }, emit: (event) => events.push(event), now: () => clock.now, schedule: clock.schedule, cancelSchedule: clock.cancel, connectTimeoutMs: 1_000, idleTimeoutMs: 10_000, maxSessionMs: 60_000, maxReconnectAttempts: 3, reconnectBaseDelayMs: 100 });
runtime.start(); sockets[0].open();
const chunk = (sequence) => ({ protocolVersion: 2, sessionId: request.sessionId, sequence, capturedAtMs: clock.now, durationMs: 40, encoding: "pcm_s16le", sampleRateHz: 24_000, channels: 1, audioData: new Uint8Array(1_920) });
runtime.pushAudio(chunk(0)); sockets[0].close();
assert.equal(runtime.state, "reconnecting"); assert.deepEqual(runtime.uplinkCredit, { frames: 0, bytes: 0, audioMs: 0, acknowledgedSequence: 0 }); assert.equal(runtime.pushAudio(chunk(1)), false, "audio captured while disconnected is never replayed into a new Provider segment");
assert.equal(runtime.submitTextInput("offline-text", "do not queue"), false, "text is rejected while disconnected instead of being falsely queued");
clock.advance(99); assert.equal(sockets.length, 1); clock.advance(1); assert.equal(sockets.length, 2); sockets[1].open();
assert.equal(runtime.state, "connected");
const appends = sockets[1].sent.filter((value) => value.type === "input_audio_buffer.append"); assert.equal(appends.length, 0, "neither unacked history nor disconnected audio is replayed");
assert.ok(events.some((event) => event.type === "connection_state" && event.state === "reconnecting" && event.attempt === 1 && event.lostAudioMs === 40 && event.segmentId === 0)); assert.ok(events.some((event) => event.type === "connection_state" && event.state === "reconnected" && event.segmentId === 1 && event.lostAudioMs === 40));
assert.equal(runtime.pushAudio(chunk(1)), true, "fresh audio resumes with the next wire sequence after reconnection");
for (let attempt = 2; attempt <= 3; attempt += 1) { sockets.at(-1).close(); clock.advance(reconnectDelayMs(attempt, 100)); sockets.at(-1).open(); }
sockets.at(-1).close(); assert.equal(runtime.state, "terminal"); assert.equal(events.filter((event) => event.type === "failed").length, 1);
assert.equal(JSON.stringify({ events, snapshot: runtime.snapshot() }).includes("secret-canary"), false);
const boundedResources = runtime.snapshot().resources; assert.ok(boundedResources.timers <= 2); assert.ok(boundedResources.uplinkFrames <= 100); assert.ok(boundedResources.downlinkAudioMs <= 30_000);

const idleClock = new Clock(); const idleSocket = new Socket(); const idleEvents = [];
const idle = new DuplexVoiceRuntime({ request: { ...request, sessionId: "idle" }, connection, adapter, createSocket: () => idleSocket, emit: (event) => idleEvents.push(event), now: () => idleClock.now, schedule: idleClock.schedule, cancelSchedule: idleClock.cancel, idleTimeoutMs: 1_000, maxSessionMs: 10_000 }); idle.start(); idleSocket.open(); idleClock.advance(1_001);
assert.equal(idleEvents.at(-1).type, "completed", "idle watchdog ends a silent Session cleanly");
const maxClock = new Clock(); const maxSocket = new Socket(); const maxEvents = [];
const maximum = new DuplexVoiceRuntime({ request: { ...request, sessionId: "maximum" }, connection, adapter, createSocket: () => maxSocket, emit: (event) => maxEvents.push(event), now: () => maxClock.now, schedule: maxClock.schedule, cancelSchedule: maxClock.cancel, idleTimeoutMs: 20_000, maxSessionMs: 1_000 }); maximum.start(); maxSocket.open(); maxClock.advance(1_001); assert.equal(maxEvents.at(-1).type, "failed"); assert.equal(maxEvents.at(-1).error.code, "rate_limit");

const drainClock = new Clock(); const drainSocket = new Socket(); const drainEvents = [];
const draining = new DuplexVoiceRuntime({ request: { ...request, sessionId: "drain" }, connection, adapter, createSocket: () => drainSocket, emit: (event) => drainEvents.push(event), now: () => drainClock.now, schedule: drainClock.schedule, cancelSchedule: drainClock.cancel, idleTimeoutMs: 60_000, maxSessionMs: 120_000 }); draining.start(); drainSocket.open();
assert.equal(draining.pushAudio({ ...chunk(0), sessionId: "drain" }), true);
assert.equal(draining.finishTurn(), true); assert.equal(draining.state, "connected"); assert.equal(drainSocket.sent.filter((value) => value.type === "input_audio_buffer.commit").length, 1, "finish-turn commits input without ending the Session");
assert.equal(draining.finishTurn(), false, "finish-turn does not send a Provider-invalid empty commit");
assert.equal(draining.stop(), true); assert.equal(draining.state, "stopping"); assert.equal(drainEvents.some((event) => event.type === "completed"), false, "end-session waits for final Provider transcript or drain deadline");
drainSocket.message({ type: "response.output_audio_transcript.done", response_id: "drain-response", item_id: "drain-item", transcript: "final answer" });
assert.equal(drainEvents.at(-1).type, "completed"); assert.equal(drainEvents.some((event) => event.type === "response_transcript_completed" && event.text === "final answer"), true, "final transcript precedes clean completion");
const deadlineClock = new Clock(); const deadlineSocket = new Socket(); const deadlineEvents = []; const deadline = new DuplexVoiceRuntime({ request: { ...request, sessionId: "deadline" }, connection, adapter, createSocket: () => deadlineSocket, emit: (event) => deadlineEvents.push(event), now: () => deadlineClock.now, schedule: deadlineClock.schedule, cancelSchedule: deadlineClock.cancel, idleTimeoutMs: 60_000, maxSessionMs: 120_000 }); deadline.start(); deadlineSocket.open(); deadline.stop(); deadlineClock.advance(1_999); assert.equal(deadlineEvents.some((event) => event.type === "completed"), false); deadlineClock.advance(1); assert.equal(deadlineEvents.at(-1).type, "completed", "bounded drain completes when Provider sends no final transcript");
assert.equal(deadlineSocket.sent.filter((value) => value.type === "input_audio_buffer.commit").length, 0, "stopping an empty Session never sends a Provider-invalid commit");

const budget = new DuplexSessionBudget({ maxAudioMs: 1_000, maxEstimatedCostUsd: 1 }); assert.equal(budget.addInputAudio(800), true); assert.equal(budget.snapshot().warning, true); budget.observeProviderUsage({ inputTokens: 100, outputTokens: 20, estimatedCostUsd: 0.81 }); assert.equal(budget.snapshot().warning, true); assert.equal(budget.addInputAudio(201), false);
const metrics = new DuplexRuntimeMetrics(100); metrics.connected(150); metrics.inputEvent(180); metrics.inputAudio(40, 120); metrics.outputAudio(220, 80); metrics.reconnected(); metrics.interrupted(); assert.deepEqual(metrics.snapshot(), { connectMs: 50, firstInputEventMs: 80, ttfaMs: 120, reconnects: 1, interrupts: 1, maxBufferedAudioMs: 120, inputAudioMs: 40, outputAudioMs: 80 });
assert.deepEqual(summarizeDuplexMetric(Array.from({ length: 100 }, (_, index) => index + 1)), { count: 100, p50: 50, p95: 95, p99: 99 });
const redacted = JSON.stringify(redactDuplexDiagnostic({ token: "TOKEN-CANARY", transcript: "TRANSCRIPT-CANARY", audioData: new Uint8Array([1, 2]), nested: { authorization: "AUTH-CANARY" } })); assert.doesNotMatch(redacted, /CANARY|1,2/);
assert.deepEqual(duplexLifecyclePolicy(), { hidden: "keep_session", visible: "keep_session", pagehide: "dispose_session", offline: "mark_offline", online: "mark_online", suspend: "release_capture", resume: "recover_capture", lock: "release_capture", unlock: "recover_capture", window_close: "dispose_session" });
assert.equal(duplexLifecycleAction("hidden"), "keep_session"); assert.equal(duplexLifecycleAction("window_close"), "dispose_session");

console.log("Duplex Voice M9 recovery verified (watchdogs, bounded exponential reconnect, no unacked replay, redaction, segment metrics, percentiles, and budgets).")
