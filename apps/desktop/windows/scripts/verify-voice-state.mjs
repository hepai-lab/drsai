import assert from "node:assert/strict";
import {
  canTransitionVoiceTurn,
  createVoiceTurnId,
  initialVoiceTurnState,
  isVoiceCaptureActive,
  isVoicePlaybackActive,
  reduceVoiceTurn,
} from "../../shared/renderer/src/voice/voiceTurnReducer.ts";
import {
  calculateVoiceLevel,
  createSilentVoiceLevels,
  formatVoiceDuration,
  getPreferredVoiceMimeType,
} from "../../shared/renderer/src/voice/voiceAudio.ts";

let state = initialVoiceTurnState;
state = reduceVoiceTurn(state, { type: "begin_capture", turnId: "turn-1" });
assert.equal(state.phase, "requesting_permission");
assert.equal(isVoiceCaptureActive(state.phase), true);
state = reduceVoiceTurn(state, { type: "permission_granted" });
assert.equal(state.phase, "recording");
state = reduceVoiceTurn(state, { type: "recording_stopped" });
state = reduceVoiceTurn(state, { type: "stt_started", requestId: "stt-1" });
const beforeStaleStt = state;
state = reduceVoiceTurn(state, { type: "stt_completed", requestId: "old-stt" });
assert.equal(state, beforeStaleStt);
state = reduceVoiceTurn(state, { type: "stt_completed", requestId: "stt-1" });
assert.equal(state.phase, "ready_to_send");
state = reduceVoiceTurn(state, { type: "submit_started", messageId: "user-1" });
state = reduceVoiceTurn(state, { type: "submission_linked", requestId: "chat-1", sourceMessageId: "user-real-1", responseMessageId: "assistant-1" });
assert.equal(state.chatRequestId, "chat-1");
assert.equal(state.sourceMessageId, "user-real-1");
assert.equal(state.expectedResponseMessageId, "assistant-1");
state = reduceVoiceTurn(state, { type: "response_started" });
const beforeWrongResponse = state;
state = reduceVoiceTurn(state, { type: "response_completed", messageId: "assistant-other" });
assert.equal(state, beforeWrongResponse);
state = reduceVoiceTurn(state, { type: "response_completed", messageId: "assistant-1" });
state = reduceVoiceTurn(state, { type: "tts_started", requestId: "tts-1" });
const beforeStaleTts = state;
state = reduceVoiceTurn(state, { type: "tts_completed", requestId: "old-tts" });
assert.equal(state, beforeStaleTts);
state = reduceVoiceTurn(state, { type: "tts_completed", requestId: "tts-1" });
state = reduceVoiceTurn(state, { type: "play" });
assert.equal(state.phase, "playing");
assert.equal(isVoicePlaybackActive(state.phase), true);
assert.equal(isVoiceCaptureActive(state.phase), false);
state = reduceVoiceTurn(state, { type: "pause" });
assert.equal(state.phase, "paused");
state = reduceVoiceTurn(state, { type: "resume" });
state = reduceVoiceTurn(state, { type: "finish" });
assert.equal(state.phase, "completed");
state = reduceVoiceTurn(state, { type: "reset" });
assert.deepEqual(state, initialVoiceTurnState);

const illegal = reduceVoiceTurn(initialVoiceTurnState, { type: "play" });
assert.equal(illegal, initialVoiceTurnState);
assert.equal(canTransitionVoiceTurn("recording", "playing"), false);
assert.equal(canTransitionVoiceTurn("playing", "recording"), false);

const expectedTransitions = {
  idle: ["requesting_permission"],
  requesting_permission: ["recording", "cancelling", "failed"],
  recording: ["preparing_audio", "cancelling", "failed"],
  preparing_audio: ["transcribing", "cancelling", "failed"],
  transcribing: ["reviewing", "ready_to_send", "cancelling", "failed"],
  reviewing: ["ready_to_send", "transcribing", "cancelling", "failed"],
  ready_to_send: ["submitting", "cancelling", "failed"],
  submitting: ["awaiting_response", "cancelling", "failed"],
  awaiting_response: ["response_ready", "cancelling", "failed"],
  response_ready: ["synthesizing", "completed", "cancelling", "failed"],
  synthesizing: ["ready_to_play", "cancelling", "failed"],
  ready_to_play: ["playing", "completed", "cancelling", "failed"],
  playing: ["paused", "completed", "cancelling", "failed"],
  paused: ["playing", "completed", "cancelling", "failed"],
  completed: ["idle", "requesting_permission"],
  cancelling: ["idle", "failed"],
  failed: ["requesting_permission", "transcribing", "ready_to_send", "synthesizing", "idle"],
};
for (const from of Object.keys(expectedTransitions)) {
  for (const to of Object.keys(expectedTransitions)) {
    assert.equal(
      canTransitionVoiceTurn(from, to),
      expectedTransitions[from].includes(to),
      `${from} -> ${to}`,
    );
  }
}

let failed = reduceVoiceTurn(initialVoiceTurnState, { type: "begin_capture", turnId: "turn-2" });
failed = reduceVoiceTurn(failed, {
  type: "fail",
  error: { stage: "requesting_permission", code: "permission_denied", message: "Denied", retryable: true },
});
assert.equal(failed.phase, "failed");
assert.equal(reduceVoiceTurn(failed, { type: "retry" }).phase, "requesting_permission");

let submitFailed = reduceVoiceTurn(initialVoiceTurnState, { type: "begin_capture", turnId: "turn-submit-retry" });
submitFailed = reduceVoiceTurn(submitFailed, { type: "permission_granted" });
submitFailed = reduceVoiceTurn(submitFailed, { type: "recording_stopped" });
submitFailed = reduceVoiceTurn(submitFailed, { type: "stt_started", requestId: "stt-submit-retry" });
submitFailed = reduceVoiceTurn(submitFailed, { type: "stt_completed", requestId: "stt-submit-retry" });
submitFailed = reduceVoiceTurn(submitFailed, { type: "submit_started", messageId: "user-submit-retry" });
submitFailed = reduceVoiceTurn(submitFailed, {
  type: "fail",
  error: { stage: "submitting", code: "chat_error", message: "failed", retryable: true },
});
assert.equal(reduceVoiceTurn(submitFailed, { type: "retry" }).phase, "ready_to_send");

let review = reduceVoiceTurn(initialVoiceTurnState, { type: "begin_capture", turnId: "turn-review" });
review = reduceVoiceTurn(review, { type: "permission_granted" });
review = reduceVoiceTurn(review, { type: "recording_stopped" });
review = reduceVoiceTurn(review, { type: "stt_started", requestId: "stt-review" });
review = reduceVoiceTurn(review, { type: "stt_completed", requestId: "stt-review", requiresReview: true });
assert.equal(review.phase, "reviewing");
assert.equal(reduceVoiceTurn(review, { type: "transcript_inserted", requestId: "stale-review" }), review);
review = reduceVoiceTurn(review, { type: "transcript_inserted", requestId: "stt-review" });
assert.deepEqual(review, initialVoiceTurnState);

assert.deepEqual(createSilentVoiceLevels(3), [0, 0, 0]);
assert.equal(calculateVoiceLevel(new Float32Array(32), 0), 0);
assert.ok(calculateVoiceLevel(new Float32Array([0.2, -0.2, 0.3, -0.3]), 0) > 0);
assert.equal(formatVoiceDuration(65), "1:05");
assert.equal(getPreferredVoiceMimeType({ isTypeSupported: (value) => value === "audio/webm" }), "audio/webm");
assert.equal(getPreferredVoiceMimeType({ isTypeSupported: (value) => value === "audio/ogg;codecs=opus" }), "audio/ogg;codecs=opus");
assert.equal(getPreferredVoiceMimeType({ isTypeSupported: () => false }), undefined);

let nextId = 0;
const turnIds = new Set(Array.from({ length: 100 }, () => createVoiceTurnId(() => String(++nextId))));
assert.equal(turnIds.size, 100);
assert.ok([...turnIds].every((id) => id.startsWith("voice-turn-")));

console.log("Voice state verification passed.");
