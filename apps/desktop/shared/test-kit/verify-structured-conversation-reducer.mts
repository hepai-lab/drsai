import assert from "node:assert/strict";
import {
  applyStructuredConversationEvent,
  createStructuredTurnState,
  type StructuredActivityEvent,
  type StructuredConversationEvent,
  type SubtaskPart,
} from "../api/structuredConversation.ts";

const turnId = "turn-test";
let sequence = 0;
const event = <T extends StructuredConversationEvent["type"]>(
  type: T,
  payload: Omit<Extract<StructuredConversationEvent, { type: T }>, "version" | "turnId" | "sequence" | "dedupeKey" | "timestamp" | "source" | "type">,
): Extract<StructuredConversationEvent, { type: T }> => ({
  version: 2,
  turnId,
  sequence: ++sequence,
  dedupeKey: `${turnId}:${sequence}:${type}`,
  timestamp: new Date(1_700_000_000_000 + sequence).toISOString(),
  source: "test",
  type,
  ...payload,
} as Extract<StructuredConversationEvent, { type: T }>);

let state = createStructuredTurnState(turnId);
const child: SubtaskPart = {
  id: "part-child",
  kind: "subtask",
  taskId: "child-1",
  title: "Child agent",
  status: "running",
};
state = applyStructuredConversationEvent(state, event("part.started", { part: child }));
state = applyStructuredConversationEvent(state, event("part.delta", {
  partId: child.id,
  delta: { kind: "subtask.reasoning.append", segmentId: "r1", text: "thinking" },
}));
state = applyStructuredConversationEvent(state, event("part.delta", {
  partId: child.id,
  delta: { kind: "subtask.markdown.append", text: "child result" },
}));

const activity: StructuredActivityEvent = {
  id: "activity-child",
  kind: "tool",
  subtaskId: "child-1",
  turnId,
  timestamp: new Date().toISOString(),
  source: "sub:child-1",
  status: "completed",
  title: "Read file",
  toolName: "read",
  callId: "call-1",
};
state = applyStructuredConversationEvent(state, event("activity.updated", { activity }));

const completed: SubtaskPart = {
  ...child,
  status: "completed",
  summary: "done",
};
state = applyStructuredConversationEvent(state, event("part.completed", { part: completed }));
const result = state.parts.find((part) => part.id === child.id);
assert.ok(result && result.kind === "subtask");
assert.equal(result.status, "completed");
assert.equal(result.reasoningSegments?.[0]?.text, "thinking");
assert.equal(result.markdownSummary, "child result");
assert.equal(result.activities?.[0]?.id, activity.id);
assert.equal(state.activities[0]?.subtaskId, "child-1");

// Activity-before-part is recovered when the child part starts later.
let late = createStructuredTurnState("late-turn");
const lateActivity: StructuredActivityEvent = { ...activity, id: "late-activity", turnId: "late-turn" };
const lateEvent = <T extends StructuredConversationEvent["type"]>(
  type: T,
  payload: Omit<Extract<StructuredConversationEvent, { type: T }>, "version" | "turnId" | "sequence" | "dedupeKey" | "timestamp" | "source" | "type">,
): Extract<StructuredConversationEvent, { type: T }> => ({
  version: 2, turnId: "late-turn", sequence: ++sequence, dedupeKey: `late:${sequence}:${type}`,
  timestamp: new Date().toISOString(), source: "test", type, ...payload,
} as Extract<StructuredConversationEvent, { type: T }>);
late = applyStructuredConversationEvent(late, lateEvent("activity.updated", { activity: lateActivity }));
late = applyStructuredConversationEvent(late, lateEvent("part.started", { part: { ...child, id: "late-part", taskId: "child-1" } }));
const lateResult = late.parts.find((part) => part.id === "late-part");
assert.ok(lateResult && lateResult.kind === "subtask");
assert.equal(lateResult.activities?.[0]?.id, "late-activity");

// Duplicate sequence/dedupe is ignored without mutating state.
const beforeDuplicate = state;
state = applyStructuredConversationEvent(state, event("turn.completed", {}));
state = applyStructuredConversationEvent(state, {
  ...event("turn.cancelled", {}),
  sequence: beforeDuplicate.lastSequence + 1,
  dedupeKey: beforeDuplicate.seenDedupeKeys.at(-1)!,
});
assert.equal(state.status, "completed");

console.log("structured conversation reducer tests passed");
