import assert from "node:assert/strict";

const { canSubmitStreamingVoiceTurn, initialStreamingVoiceTurnState, isValidStreamingVoiceTurnState, reduceStreamingVoiceTurn } = await import("../../shared/renderer/src/voice/streaming/streamingVoiceTurnReducer.ts");
const fullTurn = [
  { type: "begin", turnId: "turn-1" }, { type: "capture_started" }, { type: "stop_input" }, { type: "asr_completed" },
  { type: "review_accepted" }, { type: "llm_started" }, { type: "tts_started" }, { type: "playback_started" },
  { type: "llm_completed" }, { type: "tts_completed" }, { type: "playback_completed" },
];
let state = initialStreamingVoiceTurnState;
for (const event of fullTurn) {
  state = reduceStreamingVoiceTurn(state, event);
  assert.equal(isValidStreamingVoiceTurnState(state), true, event.type);
}
assert.equal(state.terminal, "completed");
assert.equal(reduceStreamingVoiceTurn(state, { type: "fail", error: "late" }), state);
state = reduceStreamingVoiceTurn(state, { type: "reset" });
assert.deepEqual(state, initialStreamingVoiceTurnState);

let cancellation = reduceStreamingVoiceTurn(initialStreamingVoiceTurnState, { type: "begin", turnId: "turn-cancel" });
cancellation = reduceStreamingVoiceTurn(cancellation, { type: "capture_started" });
cancellation = reduceStreamingVoiceTurn(cancellation, { type: "cancel" });
cancellation = reduceStreamingVoiceTurn(cancellation, { type: "cancelled" });
assert.equal(cancellation.terminal, "cancelled");
assert.equal(cancellation.capture, "cancelled");
assert.equal(cancellation.asr, "cancelled");
let failed = reduceStreamingVoiceTurn(initialStreamingVoiceTurnState, { type: "begin", turnId: "turn-fail" });
failed = reduceStreamingVoiceTurn(failed, { type: "fail", error: "network" });
assert.equal(failed.terminal, "failed");

let repair = reduceStreamingVoiceTurn(initialStreamingVoiceTurnState, { type: "begin", turnId: "turn-repair" });
repair = reduceStreamingVoiceTurn(repair, { type: "capture_started" });
repair = reduceStreamingVoiceTurn(repair, { type: "stop_input" });
repair = reduceStreamingVoiceTurn(repair, { type: "asr_completed" });
assert.equal(canSubmitStreamingVoiceTurn(repair), true);
repair = reduceStreamingVoiceTurn(repair, { type: "repair_started" });
assert.equal(repair.phase, "repairing");
assert.equal(canSubmitStreamingVoiceTurn(repair), false);
repair = reduceStreamingVoiceTurn(repair, { type: "repair_completed", requiresReview: true });
assert.equal(repair.phase, "repair_review");
assert.equal(canSubmitStreamingVoiceTurn(repair), true);
repair = reduceStreamingVoiceTurn(repair, { type: "review_accepted" });
assert.equal(repair.phase, "assistant");

const randomEvents = [...fullTurn, { type: "repair_started" }, { type: "repair_completed", requiresReview: true }, { type: "repair_skipped" }, { type: "cancel" }, { type: "cancelled" }, { type: "fail", error: "fixture" }, { type: "reset" }];
for (let run = 0; run < 1_000; run += 1) {
  let randomState = initialStreamingVoiceTurnState;
  for (let step = 0; step < 100; step += 1) {
    randomState = reduceStreamingVoiceTurn(randomState, randomEvents[Math.floor(Math.random() * randomEvents.length)]);
    assert.equal(isValidStreamingVoiceTurnState(randomState), true, `run ${run}, step ${step}`);
  }
}

console.log("Streaming voice turn state tests passed (full turn, mutual exclusion, cancellation, failure, terminal idempotence, and 1000 random runs).");
