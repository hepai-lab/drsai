import assert from "node:assert/strict";
import { applyChatTransportFailure, terminalEventShowsSystemError, type ChatErrorPresentation } from "../renderer/src/chatErrorPresentation.ts";

const presentation: ChatErrorPresentation = {
  severity: "error",
  title: "Connection interrupted",
  summary: "Reconnect and retry.",
  code: "transport_error",
  traceId: "request-123",
  retryable: true,
  partialContentPreserved: false,
  actions: [{ id: "retry", label: "Retry" }],
};

const empty = applyChatTransportFailure({ content: "", streaming: true }, presentation);
assert.equal(empty.content, "", "error copy must not become assistant content");
assert.equal(empty.error, true);
assert.equal(empty.errorPresentation?.title, presentation.title);
assert.equal(empty.errorPresentation?.partialContentPreserved, false);

const partial = applyChatTransportFailure({ content: "Useful partial answer", streaming: true }, presentation);
assert.equal(partial.content, "Useful partial answer");
assert.equal(partial.error, false, "partial answer remains a normal actionable assistant message");
assert.equal(partial.errorPresentation?.partialContentPreserved, true);

assert.equal(terminalEventShowsSystemError("done"), false);
assert.equal(terminalEventShowsSystemError("aborted"), false);
assert.equal(terminalEventShowsSystemError("error"), true);
console.log("Chat error presentation verification passed.");
