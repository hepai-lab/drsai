import assert from "node:assert/strict";

const {
  getStreamingTranscriptDisplayText,
  initialStreamingTranscriptState,
  reconcileStreamingTranscript,
} = await import("../src/renderer/src/voice/streaming/transcriptReconciler.ts");

const envelope = (sequence, event) => ({ sessionId: "s1", turnId: "t1", sequence, ...event });
let state = initialStreamingTranscriptState;
let result = reconcileStreamingTranscript(state, envelope(0, { type: "accepted", runtimeId: "mock-local" }));
assert.equal(result.accepted, true);
state = result.state;
result = reconcileStreamingTranscript(state, envelope(1, { type: "partial", segment: { text: "  你   ", revision: 1 } }));
state = result.state;
assert.equal(state.unstableText, "你");
assert.equal(getStreamingTranscriptDisplayText(state), "你");
result = reconcileStreamingTranscript(state, envelope(2, { type: "partial", segment: { text: "你好 世", revision: 2 } }));
state = result.state;
assert.equal(getStreamingTranscriptDisplayText(state), "你好 世");
result = reconcileStreamingTranscript(state, envelope(3, { type: "partial", segment: { text: "stale", revision: 1 } }));
assert.equal(result.accepted, false);
assert.equal(result.reason, "stale_revision");
state = result.state;
assert.equal(state.lastEventSequence, 3, "stale revisions must still consume their valid event sequence");
assert.equal(state.unstableText, "你好 世");
result = reconcileStreamingTranscript(state, envelope(4, { type: "final", segment: { text: "你好，世界", revision: 3 } }));
state = result.state;
assert.equal(state.committedText, "你好，世界");
assert.equal(state.unstableText, "");
result = reconcileStreamingTranscript(state, envelope(5, { type: "partial", segment: { text: "下一", revision: 4 } }));
state = result.state;
assert.equal(getStreamingTranscriptDisplayText(state), "你好，世界 下一");
result = reconcileStreamingTranscript(state, envelope(6, { type: "final", segment: { text: "。", revision: 5 } }));
state = result.state;
assert.equal(state.committedText, "你好，世界。");
result = reconcileStreamingTranscript(state, envelope(7, { type: "endpoint", reason: "manual" }));
state = result.state;
assert.equal(state.endpoint, "manual");
result = reconcileStreamingTranscript(state, envelope(8, { type: "completed" }));
state = result.state;
assert.equal(state.terminal, "completed");
assert.equal(state.unstableText, "");
assert.equal(reconcileStreamingTranscript(state, envelope(9, { type: "cancelled" })).reason, "terminal");

const duplicate = reconcileStreamingTranscript(initialStreamingTranscriptState, envelope(1, { type: "accepted", runtimeId: "mock-local" }));
assert.equal(duplicate.accepted, false);
assert.equal(duplicate.reason, "out_of_order");
const accepted = reconcileStreamingTranscript(initialStreamingTranscriptState, envelope(0, { type: "accepted", runtimeId: "mock-local" }));
assert.equal(reconcileStreamingTranscript(accepted.state, envelope(0, { type: "accepted", runtimeId: "mock-local" })).reason, "duplicate");

for (const terminalType of ["cancelled", "failed"]) {
  const terminalEvent = terminalType === "failed"
    ? envelope(0, { type: "failed", error: { code: "network_error", message: "offline", retryable: true } })
    : envelope(0, { type: "cancelled" });
  const terminal = reconcileStreamingTranscript(initialStreamingTranscriptState, terminalEvent);
  assert.equal(terminal.state.terminal, terminalType);
}

console.log("Streaming transcript reconciler tests passed (partial replacement, stale revision, final commit, punctuation, ordering, endpoint, and terminals)." );
