import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { applyThreadSnapshotPatch } from "../../shared/renderer/src/threadSnapshotPatch.ts";
import type { DesktopThreadSnapshot, DesktopThreadSnapshotPatchEvent } from "../../shared/api/desktopApi.ts";

const initialText = "x".repeat(20 * 1024 * 1024);
let snapshot: DesktopThreadSnapshot = {
  threadId: "thread-p9-long", title: "Long active Run", updatedAt: 1, messageCount: 2,
  messages: [
    { id: "history-message", role: "user", content: "history" },
    { id: "oaep:run-long:assistant", role: "assistant", content: initialText,
      structuredTurn: { version: 2, turnId: "run-long", status: "running",
        parts: [{ id: "item-long", kind: "markdown", status: "running", markdown: initialText }],
        activities: [], lastSequence: 1, seenDedupeKeys: [], protocolIssues: [], meta: {} } },
  ],
};
const untouched = snapshot.messages[0];
const durations: number[] = [];
let maxBytes = 0;
for (let sequence = 2; sequence <= 1_001; sequence += 1) {
  const event: DesktopThreadSnapshotPatchEvent = {
    version: 2, threadId: snapshot.threadId, runtimeSessionId: "session-long", generation: 1,
    baseSequence: sequence - 1, sessionSequence: sequence,
    patch: { kind: "item.delta", runId: "run-long", itemId: "item-long",
      messageId: "oaep:run-long:assistant", delta: { kind: "message.text.append", text: "y" },
      updatedAt: sequence, messageCount: 2 },
  };
  maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(event)));
  const started = performance.now();
  snapshot = applyThreadSnapshotPatch(snapshot, event);
  durations.push(performance.now() - started);
}
durations.sort((left, right) => left - right);
const p95 = durations[Math.floor(durations.length * 0.95)];
assert.equal(snapshot.messages[0], untouched, "unaffected history must retain referential identity");
assert.equal(snapshot.messages[1].content.length, initialText.length + 1_000);
assert(maxBytes < 1_024, `delta Patch must remain bounded, got ${maxBytes} bytes`);
assert(p95 < 16, `delta reducer P95 must fit one frame, got ${p95.toFixed(3)}ms`);
console.log(JSON.stringify({ passed: true, activeAnswerBytes: initialText.length,
  deltas: 1_000, maxPatchBytes: maxBytes, applyP95Ms: p95 }));
