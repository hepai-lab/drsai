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

// One progress part === one timeline card: repeated progress.update deltas
// replace the same partId entry instead of appending duplicates.
{
  let progressTurn = createStructuredTurnState("progress-turn");
  const progressEvent = <T extends StructuredConversationEvent["type"]>(
    type: T,
    payload: Omit<Extract<StructuredConversationEvent, { type: T }>, "version" | "turnId" | "sequence" | "dedupeKey" | "timestamp" | "source" | "type">,
  ): Extract<StructuredConversationEvent, { type: T }> => ({
    version: 2, turnId: "progress-turn", sequence: ++sequence, dedupeKey: `progress:${sequence}:${type}`,
    timestamp: new Date().toISOString(), source: "test", type, ...payload,
  } as Extract<StructuredConversationEvent, { type: T }>);
  progressTurn = applyStructuredConversationEvent(progressTurn, progressEvent("part.started", {
    part: {
      id: "plan-1", kind: "progress", summary: "Step 1", status: "running",
      turnId: "progress-turn", timestamp: new Date().toISOString(), source: "test", sequence, title: "Plan",
    },
  }));
  progressTurn = applyStructuredConversationEvent(progressTurn, progressEvent("part.delta", {
    partId: "plan-1",
    delta: { kind: "progress.update", summary: "Step 1", completed: 0, total: 3 },
  }));
  progressTurn = applyStructuredConversationEvent(progressTurn, progressEvent("part.delta", {
    partId: "plan-1",
    delta: { kind: "progress.update", summary: "Step 2", completed: 1, total: 3 },
  }));
  progressTurn = applyStructuredConversationEvent(progressTurn, progressEvent("part.delta", {
    partId: "plan-1",
    delta: { kind: "progress.update", summary: "Step 3", completed: 2, total: 3 },
  }));
  const progressEntries = (progressTurn.processTimeline ?? []).filter((entry) => entry.kind === "progress");
  assert.equal(progressEntries.length, 1, "progress part must render as a single live card");
  assert.equal(progressEntries[0]?.kind === "progress" ? progressEntries[0].sequence : 0, progressEntries[0]?.sequence);
  const progressPart = progressTurn.parts.find((part) => part.id === "plan-1");
  assert.ok(progressPart && progressPart.kind === "progress");
  assert.equal(progressPart.summary, "Step 3");
}

// A turn that ends must not leave activities spinning, and must not forge
// success for a tool whose result never arrived.
{
  let runningTurn = createStructuredTurnState("running-turn");
  const runningEvent = <T extends StructuredConversationEvent["type"]>(
    type: T,
    payload: Omit<Extract<StructuredConversationEvent, { type: T }>, "version" | "turnId" | "sequence" | "dedupeKey" | "timestamp" | "source" | "type">,
  ): Extract<StructuredConversationEvent, { type: T }> => ({
    version: 2, turnId: "running-turn", sequence: ++sequence, dedupeKey: `running:${sequence}:${type}`,
    timestamp: new Date().toISOString(), source: "test", type, ...payload,
  } as Extract<StructuredConversationEvent, { type: T }>);
  const openTool: StructuredActivityEvent = {
    id: "open-tool", kind: "tool", turnId: "running-turn",
    timestamp: new Date().toISOString(), source: "test", status: "running",
    title: "Long tool", toolName: "long_tool", callId: "call-long",
  };
  const doneTool: StructuredActivityEvent = {
    ...openTool, id: "done-tool", callId: "call-done", status: "completed",
  };
  runningTurn = applyStructuredConversationEvent(runningTurn, runningEvent("activity.updated", { activity: openTool }));
  runningTurn = applyStructuredConversationEvent(runningTurn, runningEvent("activity.updated", { activity: doneTool }));
  runningTurn = applyStructuredConversationEvent(runningTurn, runningEvent("turn.completed", {}));
  const openResult = runningTurn.activities.find((candidate) => candidate.id === "open-tool");
  const doneResult = runningTurn.activities.find((candidate) => candidate.id === "done-tool");
  assert.equal(openResult?.status, "cancelled", "unconfirmed tool must not stay running nor be forged completed");
  assert.equal(doneResult?.status, "completed", "already-terminal tool must keep its authoritative state");

  let failedTurn = createStructuredTurnState("failed-turn");
  const failedEvent = <T extends StructuredConversationEvent["type"]>(
    type: T,
    payload: Omit<Extract<StructuredConversationEvent, { type: T }>, "version" | "turnId" | "sequence" | "dedupeKey" | "timestamp" | "source" | "type">,
  ): Extract<StructuredConversationEvent, { type: T }> => ({
    version: 2, turnId: "failed-turn", sequence: ++sequence, dedupeKey: `failed:${sequence}:${type}`,
    timestamp: new Date().toISOString(), source: "test", type, ...payload,
  } as Extract<StructuredConversationEvent, { type: T }>);
  failedTurn = applyStructuredConversationEvent(failedTurn, failedEvent("activity.updated", { activity: { ...openTool, turnId: "failed-turn" } }));
  failedTurn = applyStructuredConversationEvent(failedTurn, failedEvent("turn.error", { message: "boom" }));
  assert.equal(failedTurn.activities[0]?.status, "error", "open tool during a failed turn is an error");
}

console.log("structured conversation reducer tests passed");
