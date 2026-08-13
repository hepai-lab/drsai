import assert from "node:assert/strict";
import { initialDuplexTurnState, reduceDuplexTurn } from "../../shared/renderer/src/voice/duplex/duplexTurnReducer.ts";
import { classifyDuplexSpeechIntent, scoreDuplexSemanticGate, shouldCommitBargeIn } from "../../shared/renderer/src/voice/duplex/bargeInPolicy.ts";
import { DuplexBargeInCoordinator } from "../../shared/renderer/src/voice/duplex/bargeInCoordinator.ts";

let state = initialDuplexTurnState;
for (const event of [
  { type: "session_ready" }, { type: "speech_started" }, { type: "speech_stopped" },
  { type: "response_started", responseId: "r1" }, { type: "response_audio", responseId: "r1", itemId: "a1", contentIndex: 0 },
  { type: "speech_started" }, { type: "interrupt", reason: "user_speech" }, { type: "interrupted" },
]) state = reduceDuplexTurn(state, event);
assert.equal(state.phase, "user_speaking");
assert.equal(state.responseId, null);
assert.equal(reduceDuplexTurn(initialDuplexTurnState, { type: "interrupt", reason: "manual" }), initialDuplexTurnState, "illegal transitions are identity-preserving");
const terminal = reduceDuplexTurn(state, { type: "terminal", terminal: "cancelled" });
for (let index = 0; index < 10_000; index += 1) assert.equal(reduceDuplexTurn(terminal, index % 2 ? { type: "speech_started" } : { type: "terminal", terminal: "failed" }), terminal, "terminal state is immutable");

const corpus = [
  ["嗯", "acknowledgement"], ["嗯嗯", "acknowledgement"], ["对", "acknowledgement"], ["好的", "acknowledgement"], ["继续", "acknowledgement"],
  ["okay", "acknowledgement"], ["yes", "acknowledgement"], ["uh-huh", "acknowledgement"],
  ["停", "stop"], ["停止", "stop"], ["别说了", "stop"], ["stop", "stop"], ["quiet", "stop"], ["cancel", "stop"],
  ["不对，是上海", "correction"], ["我说的是后天", "correction"], ["actually, use blue", "correction"], ["no, i meant Friday", "correction"],
  ["我还想补充一点", "barge_in"], ["等一下，先解释这里", "barge_in"], ["what about latency", "barge_in"], ["不要停止解释", "barge_in"], ["stopwatch 是什么", "barge_in"],
  ["", "none"], ["   ", "none"],
].map(([transcript, expected]) => ({ transcript, expected }));
for (const example of corpus) assert.equal(classifyDuplexSpeechIntent(example.transcript), example.expected, example.transcript);
const score = scoreDuplexSemanticGate(corpus);
assert.equal(score.passed, true); assert.equal(score.accuracy, 1);
assert.equal(shouldCommitBargeIn({ intent: "acknowledgement", localSpeechMs: 800, providerSpeechStarted: true, playbackActive: true }), false);
assert.equal(shouldCommitBargeIn({ intent: "barge_in", localSpeechMs: 40, providerSpeechStarted: true, playbackActive: true }), false);
assert.equal(shouldCommitBargeIn({ intent: "correction", localSpeechMs: 200, providerSpeechStarted: true, playbackActive: true }), true);
assert.equal(shouldCommitBargeIn({ intent: "stop", localSpeechMs: 0, providerSpeechStarted: false, playbackActive: true }), true);

const order = []; let request;
const coordinator = new DuplexBargeInCoordinator({
  stopLocalPlayback: () => { order.push("stop-local"); return 347.9; },
  clearQueuedOutput: () => { order.push("clear-output"); },
  interruptProvider: async (value) => { order.push("provider-cancel-truncate"); request = value; return true; },
});
const active = { sessionId: "s1", responseId: "r1", itemId: "a1", contentIndex: 2 };
assert.equal(await coordinator.interrupt(active, "user_speech"), true);
assert.deepEqual(order, ["stop-local", "clear-output", "provider-cancel-truncate"]);
assert.deepEqual(request, { ...active, playedAudioMs: 347, reason: "user_speech" });
assert.equal(await coordinator.interrupt(active, "user_speech"), true, "duplicate commit is idempotent");
assert.equal(order.length, 3);

let resolveInterrupt; const racing = new DuplexBargeInCoordinator({ stopLocalPlayback: () => 10, clearQueuedOutput: () => {}, interruptProvider: () => new Promise((resolve) => { resolveInterrupt = resolve; }) });
const pending = racing.interrupt(active, "user_speech"); racing.manualOverride(); resolveInterrupt(true);
assert.equal(await pending, false, "manual controls supersede an older automatic decision");

console.log("Duplex Voice M6 turns verified (state machine x10000, barge-in/ack/stop semantics, atomic order, cursor identity, idempotency, and manual priority).")
