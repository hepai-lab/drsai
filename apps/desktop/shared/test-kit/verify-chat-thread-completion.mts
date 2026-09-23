import assert from "node:assert/strict";
import {
  configureChatThreadCompletion,
  notifyChatThreadCompletion,
  resetChatThreadCompletionForTesting,
  type ChatThreadCompletion,
  type ChatThreadCompletionTarget,
} from "../main/chatThreadCompletion";

const seen: Array<{ completion: ChatThreadCompletion; targetId: string }> = [];
const target: ChatThreadCompletionTarget = { send: () => undefined, isDestroyed: () => false };

resetChatThreadCompletionForTesting();
// Without a configured sink the notify must be a silent no-op, never a throw.
notifyChatThreadCompletion(target, { threadId: "t", status: "idle", failed: false, cancelled: false });
assert.equal(seen.length, 0);

configureChatThreadCompletion({
  publish: (completion, deliveredTarget) => {
    seen.push({ completion, targetId: deliveredTarget === target ? "target" : "other" });
  },
});

notifyChatThreadCompletion(target, { threadId: "thread-a", status: "idle", failed: false, cancelled: false });
notifyChatThreadCompletion(target, { threadId: "thread-b", status: "error", failed: true, cancelled: false });
notifyChatThreadCompletion(target, { threadId: "thread-c", status: "idle", failed: false, cancelled: true });

assert.equal(seen.length, 3);
assert.deepEqual(seen[0].completion, { threadId: "thread-a", status: "idle", failed: false, cancelled: false });
assert.equal(seen[0].targetId, "target");
assert.deepEqual(seen[1].completion, { threadId: "thread-b", status: "error", failed: true, cancelled: false });
assert.equal(seen[2].completion.cancelled, true);

// A non-terminal status must never be delivered.
notifyChatThreadCompletion(target, { threadId: "thread-d", status: "running" as never, failed: false, cancelled: false });
assert.equal(seen.length, 3, "a non-terminal status must not reach the sink");

// A throwing sink must be swallowed: the run pipeline must not fail.
configureChatThreadCompletion({ publish: () => { throw new Error("boom"); } });
notifyChatThreadCompletion(target, { threadId: "thread-e", status: "idle", failed: false, cancelled: false });

console.log("Chat thread completion sink verification passed.");
