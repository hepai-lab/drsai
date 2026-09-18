import assert from "node:assert/strict";
import { MAX_REQUEST_MESSAGES, assertRequestMessageCount, selectCurrentUserInput } from "../main/chatInput.ts";

// A 42-message thread used to fail every send with
// "Chat request cannot exceed 40 messages."
const longThread = Array.from({ length: 42 }, (_value, index) => ({
  role: index % 2 === 0 ? "user" : "assistant",
  content: `turn ${index}`,
}));
assert.doesNotThrow(() => assertRequestMessageCount(longThread.length), "a 42-message thread must be sendable");

// The Runtime still receives one user input, never the transcript.
assert.equal(selectCurrentUserInput(longThread), "turn 40");

// The bound is a sanity guard, so it must stay out of reach of real threads.
assert.doesNotThrow(() => assertRequestMessageCount(1_000));
assert.doesNotThrow(() => assertRequestMessageCount(MAX_REQUEST_MESSAGES));
assert.ok(
  MAX_REQUEST_MESSAGES >= 1_000,
  "the transcript bound must never come back down to conversation scale",
);

assert.throws(
  () => assertRequestMessageCount(MAX_REQUEST_MESSAGES + 1),
  new RegExp(`Chat request cannot exceed ${MAX_REQUEST_MESSAGES} messages.`),
);
assert.throws(() => assertRequestMessageCount(0), /must include messages/);

console.log("Chat request transcript bounds verified.");
