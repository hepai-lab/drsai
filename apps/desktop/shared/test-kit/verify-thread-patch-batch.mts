import assert from "node:assert/strict";
import { applyThreadSnapshotPatch, applyThreadSnapshotPatchBatch } from "../renderer/src/threadSnapshotPatch";
import type { DesktopThreadSnapshot, DesktopThreadSnapshotPatchEvent } from "../api/desktopApi";

const messages = Array.from({ length: 5000 }, (_, index) => ({
  id: `m${index}`, role: "assistant", content: "start",
  structuredTurn: { version: 2, turnId: `r${index}`, status: "running", parts: [
    { id: `p${index}`, kind: "markdown", status: "running", markdown: "start" },
  ], activities: [] },
}));
const snapshot = { threadId: "t", title: "test", updatedAt: 1, messageCount: messages.length, messages } as DesktopThreadSnapshot;
const events = Array.from({ length: 300 }, (_, index) => ({
  version: 2, threadId: "t", runtimeSessionId: "s", generation: 1,
  baseSequence: index, sessionSequence: index + 1,
  patch: { kind: "item.delta", runId: "r4999", itemId: "p4999", messageId: "m4999",
    delta: { kind: "message.text.append", text: `${index},` }, messageCount: 5000, updatedAt: index + 2 },
})) as DesktopThreadSnapshotPatchEvent[];
const original = JSON.stringify(snapshot);
const expected = events.reduce(applyThreadSnapshotPatch, snapshot);
const actual = applyThreadSnapshotPatchBatch(snapshot, events, 1);
assert.deepEqual(actual.snapshot, expected);
assert.equal(actual.appliedSequence, 300);
assert.equal(JSON.stringify(snapshot), original);
assert.equal(actual.snapshot.messages[0], snapshot.messages[0]);
assert.notEqual(actual.snapshot.messages[4999], snapshot.messages[4999]);
assert.throws(() => applyThreadSnapshotPatchBatch(snapshot, events, 2), /generation_mismatch/);
assert.deepEqual(applyThreadSnapshotPatchBatch(snapshot, [], 1).snapshot, snapshot);
console.log("THREAD_PATCH_BATCH_OK (5000 messages, 300 deltas, canonical equivalence and immutability)");
