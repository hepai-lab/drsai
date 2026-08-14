import assert from "node:assert/strict";
import { DuplexVoiceRuntime } from "../../shared/main/voice/duplex/runtime.ts";
import { ZhizengzengRealtimeAdapter } from "../../shared/main/voice/duplex/zhizengzengRealtimeAdapter.ts";
import { DuplexRuntimeMetrics, DuplexSessionBudget, reconnectDelayMs, redactDuplexDiagnostic, summarizeDuplexMetric } from "../../shared/main/voice/duplex/runtimePolicy.ts";

class Clock {
  now = 0; next = 1; timers = new Map();
  schedule = (callback, delay) => { const id = this.next++; this.timers.set(id, { at: this.now + delay, callback }); return id; };
  cancel = (id) => { this.timers.delete(id); };
  advance(ms) { const target = this.now + ms; while (true) { const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; this.timers.delete(due[0]); this.now = due[1].at; due[1].callback(); } this.now = target; }
}
class Socket { readyState = 0; sent = []; listeners = new Map(); addEventListener(type, callback) { this.listeners.set(type, [...this.listeners.get(type) ?? [], callback]); } send(value) { this.sent.push(JSON.parse(value)); } close() { if (this.readyState === 3) return; this.readyState = 3; this.fire("close", {}); } open() { this.readyState = 1; this.fire("open", {}); } message(value) { this.fire("message", { data: JSON.stringify(value) }); } fire(type, event) { for (const callback of this.listeners.get(type) ?? []) callback(event); } }
const adapter = new ZhizengzengRealtimeAdapter({ transcriptionModel: "gpt-4o-mini-transcribe" });
const request = { protocolVersion: 1, sessionId: "recovery", providerId: "zhizengzeng", modelId: "gpt-realtime-2", inputEncoding: "pcm_s16le", inputSampleRateHz: 24_000, outputEncoding: "pcm_s16le", outputSampleRateHz: 24_000, channels: 1, enableInputTranscription: true, enableOutputTranscription: true, enableServerVad: true, enableToolCalling: true };
const connection = adapter.resolveConnection("https://api.zhizengzeng.com/v1", "Bearer secret-canary");
const clock = new Clock(); const sockets = []; const events = [];
const runtime = new DuplexVoiceRuntime({ request, connection, adapter, createSocket: () => { const socket = new Socket(); sockets.push(socket); return socket; }, emit: (event) => events.push(event), now: () => clock.now, schedule: clock.schedule, cancelSchedule: clock.cancel, connectTimeoutMs: 1_000, idleTimeoutMs: 10_000, maxSessionMs: 60_000, maxReconnectAttempts: 3, reconnectBaseDelayMs: 100 });
runtime.start(); sockets[0].open();
const chunk = (sequence) => ({ protocolVersion: 1, sessionId: request.sessionId, sequence, capturedAtMs: clock.now, durationMs: 40, encoding: "pcm_s16le", sampleRateHz: 24_000, channels: 1, audioData: new Uint8Array(1_920) });
runtime.pushAudio(chunk(0)); sockets[0].close();
assert.equal(runtime.state, "reconnecting"); assert.equal(runtime.pushAudio(chunk(1)), true);
clock.advance(99); assert.equal(sockets.length, 1); clock.advance(1); assert.equal(sockets.length, 2); sockets[1].open();
assert.equal(runtime.state, "connected");
const appends = sockets[1].sent.filter((value) => value.type === "input_audio_buffer.append"); assert.equal(appends.length, 1, "only bounded audio captured after disconnect is sent; unacked history is not replayed");
assert.ok(events.some((event) => event.type === "connection_state" && event.state === "reconnecting" && event.attempt === 1)); assert.ok(events.some((event) => event.type === "connection_state" && event.state === "reconnected"));
for (let attempt = 2; attempt <= 3; attempt += 1) { sockets.at(-1).close(); clock.advance(reconnectDelayMs(attempt, 100)); sockets.at(-1).open(); }
sockets.at(-1).close(); assert.equal(runtime.state, "terminal"); assert.equal(events.filter((event) => event.type === "failed").length, 1);
assert.equal(JSON.stringify({ events, snapshot: runtime.snapshot() }).includes("secret-canary"), false);

const idleClock = new Clock(); const idleSocket = new Socket(); const idleEvents = [];
const idle = new DuplexVoiceRuntime({ request: { ...request, sessionId: "idle" }, connection, adapter, createSocket: () => idleSocket, emit: (event) => idleEvents.push(event), now: () => idleClock.now, schedule: idleClock.schedule, cancelSchedule: idleClock.cancel, idleTimeoutMs: 1_000, maxSessionMs: 10_000 }); idle.start(); idleSocket.open(); idleClock.advance(1_001);
assert.equal(idleEvents.at(-1).type, "completed", "idle watchdog ends a silent Session cleanly");
const maxClock = new Clock(); const maxSocket = new Socket(); const maxEvents = [];
const maximum = new DuplexVoiceRuntime({ request: { ...request, sessionId: "maximum" }, connection, adapter, createSocket: () => maxSocket, emit: (event) => maxEvents.push(event), now: () => maxClock.now, schedule: maxClock.schedule, cancelSchedule: maxClock.cancel, idleTimeoutMs: 20_000, maxSessionMs: 1_000 }); maximum.start(); maxSocket.open(); maxClock.advance(1_001); assert.equal(maxEvents.at(-1).type, "failed"); assert.equal(maxEvents.at(-1).error.code, "rate_limit");

const budget = new DuplexSessionBudget({ maxAudioMs: 1_000, maxEstimatedCostUsd: 1 }); assert.equal(budget.addInputAudio(800), true); assert.equal(budget.snapshot().warning, true); budget.observeProviderUsage({ inputTokens: 100, outputTokens: 20, estimatedCostUsd: 0.81 }); assert.equal(budget.snapshot().warning, true); assert.equal(budget.addInputAudio(201), false);
const metrics = new DuplexRuntimeMetrics(100); metrics.connected(150); metrics.inputEvent(180); metrics.inputAudio(40, 120); metrics.outputAudio(220, 80); metrics.reconnected(); metrics.interrupted(); assert.deepEqual(metrics.snapshot(), { connectMs: 50, firstInputEventMs: 80, ttfaMs: 120, reconnects: 1, interrupts: 1, maxBufferedAudioMs: 120, inputAudioMs: 40, outputAudioMs: 80 });
assert.deepEqual(summarizeDuplexMetric(Array.from({ length: 100 }, (_, index) => index + 1)), { count: 100, p50: 50, p95: 95, p99: 99 });
const redacted = JSON.stringify(redactDuplexDiagnostic({ token: "TOKEN-CANARY", transcript: "TRANSCRIPT-CANARY", audioData: new Uint8Array([1, 2]), nested: { authorization: "AUTH-CANARY" } })); assert.doesNotMatch(redacted, /CANARY|1,2/);

console.log("Duplex Voice M9 recovery verified (watchdogs, bounded exponential reconnect, no unacked replay, redaction, segment metrics, percentiles, and budgets).")
