import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyThreadSnapshotPatch, applyThreadSnapshotPatchBatch, decodeThreadSnapshotPatchEvent } from "../../shared/renderer/src/threadSnapshotPatch.ts";

const base = { threadId: "thread-p8", title: "P8", messages: [], updatedAt: 0, messageCount: 0 };
const message = (sequence: number) => ({ id: `message-${sequence}`, role: "assistant" as const,
  content: `answer-${sequence}`, structuredTurn: { version: 2 as const, turnId: `run-${sequence}`,
    status: "running" as const, parts: [], activities: [], lastSequence: sequence,
    seenDedupeKeys: [], protocolIssues: [], meta: {} } });
const upsert = (sequence: number, messageCount = sequence) => ({
  version: 2 as const, threadId: "thread-p8", runtimeSessionId: "session-p8", generation: 3,
  baseSequence: sequence - 1, sessionSequence: sequence,
  patch: { kind: "item.upsert" as const, runId: `run-${sequence}`, itemId: `item-${sequence}`,
    message: message(sequence), insertAt: sequence - 1, updatedAt: sequence, messageCount },
});
const delta = { ...upsert(2, 1), baseSequence: 1, patch: { kind: "item.delta" as const,
  runId: "run-1", itemId: "item-1", messageId: "message-1",
  delta: { kind: "message.text.append", text: "+delta" }, updatedAt: 2, messageCount: 1 } };
const remove = { ...upsert(2, 0), patch: { kind: "item.remove" as const, runId: "run-1",
  itemId: "item-1", removeMessageIds: ["message-1"], updatedAt: 2, messageCount: 0 } };
const runState = { ...upsert(2, 1), patch: { kind: "run.state" as const, runId: "run-1",
  message: message(1), insertAt: 0, updatedAt: 2, messageCount: 1 } };
const replace = { ...upsert(1), patch: { kind: "run.replace" as const, runId: "run-1",
  removeMessageIds: [], insertAt: 0, messages: [message(1)], updatedAt: 1, messageCount: 1 } };

for (const event of [upsert(1), delta, remove, runState, replace]) assert.equal(decodeThreadSnapshotPatchEvent(event).patch.kind, event.patch.kind);
const connected = { ...upsert(1), patch: { kind: "connection.state" as const, state: "connected" as const, updatedAt: 1 } };
assert.equal(applyThreadSnapshotPatch(base, connected), base, "Transient connection state must not persist in conversation snapshots");

const committed = applyThreadSnapshotPatchBatch(base, [upsert(1), upsert(2)], 3);
assert.equal(committed.appliedSequence, 2);
assert.deepEqual(committed.snapshot.messages.map((item) => item.content), ["answer-1", "answer-2"]);
const streamingBase = applyThreadSnapshotPatch(base, { ...upsert(1), patch: { ...upsert(1).patch,
  message: { ...message(1), content: "Hello", structuredTurn: { ...message(1).structuredTurn,
    parts: [{ id: "item-1", kind: "markdown" as const, status: "running" as const, markdown: "Hello" }] } } } });
const streamed = applyThreadSnapshotPatch(streamingBase, delta);
assert.equal(streamed.messages[0].content, "Hello+delta");
assert.equal(streamed.messages[0].structuredTurn?.parts[0]?.kind, "markdown");
assert.equal((streamed.messages[0].structuredTurn?.parts[0] as { markdown?: string }).markdown, "Hello+delta");
assert.notEqual(streamed.messages[0], streamingBase.messages[0], "target message must use structural sharing replacement");
const before = JSON.stringify(base);
assert.throws(() => applyThreadSnapshotPatchBatch(base, [upsert(1), upsert(2, 99)], 3), /count_mismatch/);
assert.equal(JSON.stringify(base), before, "a failed second Patch must not partially mutate the input snapshot");
assert.throws(() => applyThreadSnapshotPatchBatch(base, [{ ...upsert(1), generation: 2 }], 3), /generation_mismatch/);
assert.throws(() => decodeThreadSnapshotPatchEvent({ ...upsert(1), patch: { ...upsert(1).patch,
  message: { id: "polluted", role: "assistant", content: "x", __proto__: { admin: true } } } }), /incompatible/);
let nested: any = "leaf";
for (let index = 0; index < 24; index += 1) nested = { nested };
assert.throws(() => decodeThreadSnapshotPatchEvent({ ...upsert(1), patch: { ...upsert(1).patch,
  message: { id: "deep", role: "assistant", content: "x", parts: nested } } }), /incompatible/);
assert.throws(() => decodeThreadSnapshotPatchEvent({ ...upsert(1), patch: { ...upsert(1).patch,
  message: { id: "large", role: "assistant", content: "x".repeat(8 * 1024 * 1024 + 1) } } }), /incompatible/);

const appSource = await readFile(resolve(process.cwd(), "../shared/renderer/src/App.tsx"), "utf8");
assert(appSource.includes("getThreadSnapshotEnvelope(threadId, requestId)"));
assert(appSource.includes("threadSnapshotCoordinatorRef.current.commitEnvelope(envelope"));
assert(appSource.includes("threadSnapshotCoordinatorRef.current.acceptPatch(event)"));
assert(appSource.includes("thread_snapshot_patch_batch_failed") && appSource.includes("applyThreadSnapshotPatchBatch"));
console.log("P8/P9 transactional Patch, envelope cursor and generation verification passed.");
