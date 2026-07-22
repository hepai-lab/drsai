import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Script } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(join(process.cwd(), "../shared/api/structuredConversation.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true },
}).outputText;
const module = { exports: {} };
new Script(compiled, { filename: "structuredConversation.ts" }).runInNewContext({
  exports: module.exports,
  module,
  require,
});

const {
  applyStructuredConversationEvent,
  createStructuredTurnState,
  isStructuredAssistantPart,
  migrateLegacyMessageToStructuredTurn,
  sanitizeStructuredTurnState,
  settleInterruptedStructuredTurn,
  validateStructuredConversationEvent,
} = module.exports;
const fixture = JSON.parse(readFileSync(join(process.cwd(), "scripts/fixtures/structured-conversation.json"), "utf8"));

let state = createStructuredTurnState(fixture.turnId);
for (const event of fixture.events) {
  assert.equal(validateStructuredConversationEvent(event), null);
  state = applyStructuredConversationEvent(state, event);
}

assert.equal(state.status, "completed");
assert.equal(state.parts.length, 8, "Fixture must exercise all eight assistant part types.");
assert.deepEqual(
  [...state.parts.map((part) => part.kind)].sort(),
  ["artifact", "citation", "interaction", "markdown", "notice", "progress", "reasoning", "subtask"],
);
const reasoning = state.parts.find((part) => part.kind === "reasoning");
assert.equal(reasoning.segments.length, 2, "Multiple thinking phases must share one reasoning part.");
assert.equal(state.parts.filter((part) => part.kind === "reasoning").length, 1);
assert.equal(state.parts.find((part) => part.kind === "markdown").markdown, "FCPPL2026 is a conference.");
assert.deepEqual(state.parts.find((part) => part.kind === "markdown").citationIds, ["source-1"]);
assert.equal(state.parts.find((part) => part.kind === "citation").markdownPartId, "answer");
assert.equal(state.parts.find((part) => part.kind === "citation").artifactId, "artifact-1");
assert.equal(state.activities.length, 1);
assert.equal(state.protocolIssues.length, 0);

const beforeDuplicate = state;
const afterDuplicate = applyStructuredConversationEvent(state, fixture.events[14]);
assert.equal(afterDuplicate, beforeDuplicate, "A duplicated completion event must be ignored by identity.");

const invalid = { ...fixture.events[0], version: 1 };
assert.equal(validateStructuredConversationEvent(invalid)?.code, "invalid_event");
assert.equal(isStructuredAssistantPart({ id: "bad", kind: "tool", status: "running" }), false);

let gapState = createStructuredTurnState("gap");
gapState = applyStructuredConversationEvent(gapState, {
  ...fixture.events[0], turnId: "gap", sequence: 2, dedupeKey: "gap:start",
});
assert.equal(gapState.protocolIssues[0]?.code, "sequence_gap");

let cancelled = createStructuredTurnState("cancelled");
cancelled = applyStructuredConversationEvent(cancelled, {
  ...fixture.events[0], turnId: "cancelled", dedupeKey: "cancelled:start",
});
cancelled = applyStructuredConversationEvent(cancelled, {
  ...fixture.events[4], turnId: "cancelled", sequence: 2, dedupeKey: "cancelled:part",
});
cancelled = applyStructuredConversationEvent(cancelled, {
  ...fixture.events[0], type: "turn.cancelled", turnId: "cancelled", sequence: 3, dedupeKey: "cancelled:end",
});
assert.equal(cancelled.status, "cancelled");
assert.equal(cancelled.parts[0].status, "cancelled");

let interrupted = createStructuredTurnState("interrupted");
interrupted = applyStructuredConversationEvent(interrupted, {
  ...fixture.events[0], turnId: "interrupted", dedupeKey: "interrupted:start",
});
interrupted = applyStructuredConversationEvent(interrupted, {
  ...fixture.events[4], turnId: "interrupted", sequence: 2, dedupeKey: "interrupted:part",
});
const settled = settleInterruptedStructuredTurn(interrupted, "Reconnect timed out.");
assert.equal(settled.status, "cancelled");
assert.equal(settled.parts[0].status, "cancelled");
assert.equal(settled.parts.find((part) => part.kind === "notice")?.message, "Reconnect timed out.");
assert.equal(settleInterruptedStructuredTurn(settled, "Again."), settled, "Recovery fallback must be idempotent.");
const corrected = applyStructuredConversationEvent(settled, {
  ...fixture.events[0], type: "turn.completed", turnId: "interrupted", sequence: 3, dedupeKey: "interrupted:complete",
});
assert.equal(corrected.status, "completed", "A late authoritative terminal event must correct the fallback state.");

const migrated = migrateLegacyMessageToStructuredTurn({
  id: "old-message",
  content: "<think>legacy thought</think>Legacy answer",
  statusContent: "retrying",
  parts: [
    { id: "old-file", type: "file", name: "result.csv", path: "result.csv", status: "completed" },
    { id: "old-approval", type: "approval", requestId: "approval-1", prompt: "Continue?", status: "pending" },
  ],
  toolTimeline: [{ id: "old-tool", title: "Run analysis", toolName: "python", status: "completed", content: "ok" }],
});
assert.equal(migrated.parts.find((part) => part.kind === "markdown").markdown, "Legacy answer");
assert.equal(migrated.parts.find((part) => part.kind === "reasoning").segments[0].text, "legacy thought");
assert.equal(migrated.parts.some((part) => part.kind === "artifact"), true);
assert.equal(migrated.parts.some((part) => part.kind === "interaction"), true);
assert.equal(migrated.activities.length, 2);

const oversized = {
  ...state,
  parts: [{ id: "large", kind: "markdown", status: "completed", markdown: "x".repeat(250_000) }],
  activities: [{
    id: "large-tool", turnId: state.turnId, timestamp: "2026-07-17T00:00:00Z", source: "test",
    status: "completed", title: "Large output", kind: "tool", toolName: "tool", callId: "call",
    output: "y".repeat(100_000),
  }],
};
const sanitized = sanitizeStructuredTurnState(oversized);
assert.equal(sanitized.parts[0].markdown.length, 200_000);
assert.equal(sanitized.activities[0].output.truncated, true);
assert.deepEqual(sanitized.parts[0].citationIds, undefined);

console.log("Structured conversation V2 verification passed.");
