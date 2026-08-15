import assert from "node:assert/strict";
import { initialDuplexTurnState, reduceDuplexTurn } from "../../shared/renderer/src/voice/duplex/duplexTurnReducer.ts";
import { DuplexBargeInCandidate } from "../../shared/renderer/src/voice/duplex/bargeInCandidate.ts";
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
assert.equal(reduceDuplexTurn(initialDuplexTurnState, { type: "interrupt", reason: "manual" }), initialDuplexTurnState);
const terminal = reduceDuplexTurn(state, { type: "terminal", terminal: "cancelled" });
for (let index = 0; index < 10_000; index += 1) assert.equal(reduceDuplexTurn(terminal, index % 2 ? { type: "speech_started" } : { type: "terminal", terminal: "failed" }), terminal);

const corpus = [
  ["嗯", "acknowledgement"], ["对", "acknowledgement"], ["好的", "acknowledgement"], ["继续", "acknowledgement"], ["okay", "acknowledgement"], ["uh-huh", "acknowledgement"],
  ["停", "stop"], ["停止", "stop"], ["别说了", "stop"], ["stop", "stop"], ["quiet", "stop"], ["cancel", "stop"],
  ["不对，是上海", "correction"], ["我说的是后天", "correction"], ["更正，是蓝色", "correction"], ["actually, use blue", "correction"], ["no, i meant Friday", "correction"],
  ["我还想补充一点", "addendum"], ["另外说明成本", "addendum"], ["还有一个条件", "addendum"], ["also explain latency", "addendum"], ["one more thing, include logs", "addendum"],
  ["为什么延迟高？", "new_question"], ["怎么配置？", "new_question"], ["what about latency?", "new_question"], ["can you explain cost?", "new_question"], ["不要停止解释", "new_question"], ["stopwatch 是什么？", "new_question"],
  ["", "none"], ["   ", "none"], ["普通陈述", "new_question"], ["please explain caching", "new_question"],
].map(([transcript, expected]) => ({ transcript, expected }));
for (const example of corpus) assert.equal(classifyDuplexSpeechIntent(example.transcript), example.expected, example.transcript);
const score = scoreDuplexSemanticGate(corpus);
assert.equal(score.passed, true); assert.equal(score.accuracy, 1);
assert.equal(shouldCommitBargeIn({ intent: "acknowledgement", localSpeechMs: 800, providerSpeechStarted: true, playbackActive: true }), false);
assert.equal(shouldCommitBargeIn({ intent: "new_question", localSpeechMs: 40, providerSpeechStarted: true, candidateConfidence: 0.8, playbackActive: true }), false);
assert.equal(shouldCommitBargeIn({ intent: "correction", localSpeechMs: 200, providerSpeechStarted: true, candidateConfidence: 0.8, playbackActive: true }), true);
assert.equal(shouldCommitBargeIn({ intent: "addendum", localSpeechMs: 200, providerSpeechStarted: true, candidateConfidence: 0.8, playbackActive: true }), true);
assert.equal(shouldCommitBargeIn({ intent: "new_question", localSpeechMs: 240, providerSpeechStarted: true, candidateConfidence: 0.8, playbackActive: true }), true);
assert.equal(shouldCommitBargeIn({ intent: "stop", localSpeechMs: 0, providerSpeechStarted: false, playbackActive: true }), true);

const signal = (speechCandidate, level = speechCandidate ? 0.12 : 0.01) => ({ level, threshold: 0.04, noiseFloor: 0.01, speechCandidate, changed: false });
const echo = new DuplexBargeInCandidate(); echo.setPlayback(true, 0.5);
for (let index = 0; index < 8; index += 1) echo.observeLocal(signal(true, 0.18), 40);
assert.equal(echo.snapshot(0.18).action, "idle"); assert.ok(echo.snapshot(0.18).echoRisk >= 0.55);
const cough = new DuplexBargeInCandidate(); cough.setPlayback(true, 0.03); cough.observeLocal(signal(true), 40);
assert.equal(cough.observeLocal(signal(true), 40).action, "idle");
const speech = new DuplexBargeInCandidate(); speech.setPlayback(true, 0.2); speech.setProviderSpeech(true);
for (let index = 0; index < 3; index += 1) speech.observeLocal(signal(true), 40);
assert.equal(speech.observeLocal(signal(true), 40).action, "duck");
speech.setProviderSpeech(false); speech.observeLocal(signal(false), 40);
assert.equal(speech.snapshot().localSpeechMs, 160); assert.equal(speech.snapshot().providerSpeech, true, "utterance evidence survives end-of-speech until transcript completion");
assert.equal(speech.observeAsrPrefix("为什么").action, "await_transcript");
speech.completeUtterance(); assert.equal(speech.snapshot().localSpeechMs, 0);
let clock = 1_000; const stop = new DuplexBargeInCandidate(() => clock); stop.setPlayback(true, 0.2); stop.setProviderSpeech(true); stop.observeAsrPrefix("停止");
for (let index = 0; index < 2; index += 1) stop.observeLocal(signal(true), 40);
clock = 1_110; const fastStop = stop.observeLocal(signal(true), 40); assert.equal(fastStop.action, "commit_stop"); assert.equal(fastStop.stopDecisionLatencyMs, 110); assert.notEqual(stop.snapshot().action, "commit_stop", "fast stop commits only once");
const echoedStop = new DuplexBargeInCandidate(); echoedStop.setPlayback(true, 0.8); echoedStop.observeAsrPrefix("停止");
for (let index = 0; index < 4; index += 1) echoedStop.observeLocal(signal(true, 0.12), 40);
assert.notEqual(echoedStop.snapshot().action, "commit_stop", "playback-dominated stop repetition is protected until independent speech evidence arrives"); assert.ok(echoedStop.snapshot().echoRisk >= 0.55);

const order = []; const outcomes = []; let request;
const coordinator = new DuplexBargeInCoordinator({ duckLocalPlayback: () => order.push("duck"), restoreLocalPlayback: () => order.push("restore"), stopLocalPlayback: () => { order.push("stop-local"); return 347.9; }, clearQueuedOutput: () => { order.push("clear-output"); }, interruptProvider: async (value) => { order.push("provider-cancel-truncate"); request = value; return true; }, onTransaction: (transaction) => outcomes.push({ ...transaction }) });
const active = { sessionId: "s1", responseId: "r1", itemId: "a1", contentIndex: 2 };
const candidateTransaction = coordinator.candidate(active); assert.equal(candidateTransaction.outcome, "candidate"); assert.match(candidateTransaction.interruptId, /^r1:\d+$/);
assert.equal(await coordinator.interrupt(active, "user_speech"), true);
assert.deepEqual(order, ["duck", "stop-local", "clear-output", "provider-cancel-truncate"]);
assert.deepEqual(request, { ...active, interruptId: candidateTransaction.interruptId, playedAudioMs: 347, reason: "user_speech" });
assert.equal(coordinator.transaction.outcome, "committed"); assert.deepEqual(outcomes.map((value) => value.outcome), ["candidate", "committed"]);
assert.equal(await coordinator.interrupt(active, "user_speech"), true); assert.equal(order.length, 4);
const acknowledged = new DuplexBargeInCoordinator({ duckLocalPlayback: () => order.push("ack-duck"), restoreLocalPlayback: () => order.push("ack-restore"), stopLocalPlayback: () => 0, clearQueuedOutput: () => {}, interruptProvider: async () => true });
acknowledged.candidate({ ...active, responseId: "ack" }); assert.equal(acknowledged.revokeCandidate({ ...active, responseId: "ack" }), true); assert.equal(acknowledged.transaction.outcome, "reverted"); assert.deepEqual(order.slice(-2), ["ack-duck", "ack-restore"]);
let resolveInterrupt; const racing = new DuplexBargeInCoordinator({ stopLocalPlayback: () => 10, clearQueuedOutput: () => {}, interruptProvider: () => new Promise((resolve) => { resolveInterrupt = resolve; }) });
const pending = racing.interrupt(active, "user_speech"); racing.manualOverride(); resolveInterrupt(true);
assert.equal(await pending, false);
assert.equal(racing.transaction.outcome, "superseded");
const rejected = new DuplexBargeInCoordinator({ restoreLocalPlayback: () => order.push("reject-restore"), stopLocalPlayback: () => 0, clearQueuedOutput: () => {}, interruptProvider: async () => false });
assert.equal(await rejected.interrupt({ ...active, responseId: "reject" }, "user_speech"), false); assert.equal(rejected.transaction.outcome, "rejected"); assert.equal(order.at(-1), "reject-restore");
const timedOut = new DuplexBargeInCoordinator({ stopLocalPlayback: () => 0, clearQueuedOutput: () => {}, interruptProvider: () => new Promise(() => {}) }, 5);
assert.equal(await timedOut.interrupt({ ...active, responseId: "timeout" }, "user_speech"), false); assert.equal(timedOut.transaction.outcome, "timeout");
let concurrentProviderCalls = 0; let resolveConcurrent;
const concurrent = new DuplexBargeInCoordinator({ stopLocalPlayback: () => 0, clearQueuedOutput: () => {}, interruptProvider: () => { concurrentProviderCalls += 1; return new Promise((resolve) => { resolveConcurrent = resolve; }); } });
const concurrentActive = { ...active, responseId: "concurrent" }; const concurrentResults = Array.from({ length: 100 }, () => concurrent.interrupt(concurrentActive, "stop_intent")); resolveConcurrent(true);
assert.deepEqual(await Promise.all(concurrentResults), Array(100).fill(true)); assert.equal(concurrentProviderCalls, 1, "concurrent commits share one provider transaction");
for (let index = 0; index < 10_000; index += 1) { let settle; const race = new DuplexBargeInCoordinator({ stopLocalPlayback: () => index, clearQueuedOutput: () => {}, interruptProvider: () => new Promise((resolve) => { settle = resolve; }) }); const racePending = race.interrupt({ ...active, responseId: `race-${index}` }, "user_speech"); race.manualOverride(); settle(true); assert.equal(await racePending, false); assert.equal(race.transaction.outcome, "superseded"); }

console.log("Duplex Voice turns verified (state machine x10000, multi-signal candidate, intent corpus, atomic interruption and manual priority).");
