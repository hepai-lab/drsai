import assert from "node:assert/strict";
import {
  applyStructuredConversationEvent,
  createStructuredTurnState,
  sanitizeStructuredTurnState,
  STRUCTURED_CONVERSATION_VERSION,
  type StructuredActivityEvent,
  type StructuredAssistantPart,
  type StructuredConversationEvent,
} from "../api/structuredConversation";
import type { DesktopThread } from "../api/desktopApi";
import type { OaepItem, OaepRun } from "../api/oaep.generated";
import { projectOaepAssistantItem, projectOaepThreadSnapshot } from "../main/threadRuntimeProjection";

function verifyReducerTimeline(): void {
  let sequence = 0;
  const turnId = "verify-subtask-timeline";
  const event = (type: StructuredConversationEvent["type"], data: Partial<StructuredConversationEvent> = {}): StructuredConversationEvent => {
    const next = data.sequence ?? ++sequence;
    return { version: STRUCTURED_CONVERSATION_VERSION, turnId, sequence: next, dedupeKey: `${type}:${next}`, timestamp: new Date(next).toISOString(), source: "verify", type, ...data } as StructuredConversationEvent;
  };
  const subtask = (status: "running" | "completed" = "running"): StructuredAssistantPart => ({ id: "p:sub", kind: "subtask", taskId: "task1", title: "Child", status });
  const activity = (status: "running" | "completed" = "running"): StructuredActivityEvent => ({ id: "a1", turnId, timestamp: new Date().toISOString(), source: "verify", status, title: "Tool", kind: "tool", toolName: "read", callId: "a1", subtaskId: "task1" });
  let state = createStructuredTurnState(turnId);
  state = applyStructuredConversationEvent(state, event("turn.started"));
  state = applyStructuredConversationEvent(state, event("part.started", { part: subtask() } as Partial<StructuredConversationEvent>));
  state = applyStructuredConversationEvent(state, event("part.delta", { partId: "p:sub", delta: { kind: "subtask.reasoning.append", segmentId: "s1", text: "Inspect " } } as Partial<StructuredConversationEvent>));
  state = applyStructuredConversationEvent(state, event("activity.updated", { activity: activity() } as Partial<StructuredConversationEvent>));
  state = applyStructuredConversationEvent(state, event("part.delta", { partId: "p:sub", delta: { kind: "subtask.markdown.append", text: "Found" } } as Partial<StructuredConversationEvent>));
  state = applyStructuredConversationEvent(state, event("part.delta", { partId: "p:sub", delta: { kind: "subtask.reasoning.append", segmentId: "s1", text: "again" } } as Partial<StructuredConversationEvent>));
  state = applyStructuredConversationEvent(state, event("activity.updated", { activity: activity("completed") } as Partial<StructuredConversationEvent>));
  state = applyStructuredConversationEvent(state, event("part.completed", { part: subtask("completed") } as Partial<StructuredConversationEvent>));

  assert.deepEqual(state.processTimeline, [{ id: "subtask:p:sub", kind: "subtask", sequence: 2, partId: "p:sub", taskId: "task1" }]);
  const part = state.parts.find((candidate) => candidate.id === "p:sub");
  assert.equal(part?.kind, "subtask");
  if (part?.kind !== "subtask") throw new Error("missing subtask");
  assert.deepEqual(part.timeline?.map((entry) => entry.kind), ["reasoning", "activity", "markdown", "reasoning"]);
  assert.deepEqual(part.timeline?.map((entry) => entry.sequence), [3, 4, 5, 6]);
  assert.equal(part.activities?.[0].sequence, 4);
  assert.equal(part.activities?.[0].completedSequence, 7);
  const restored = sanitizeStructuredTurnState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored?.processTimeline, state.processTimeline);
  assert.deepEqual((restored?.parts[0] as typeof part).timeline, part.timeline);
}

function verifyOaepProjectionTimeline(): void {
  const base = { session_id: "thread1", run_id: "run1", status: "completed" as const, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:01Z", source: { backend: "test" } };
  const items: OaepItem[] = [
    { ...base, id: "reason", sequence: 3, type: "reasoning", content: { segments: [{ id: "s1", text: "Think" }] } },
    { ...base, id: "tool", sequence: 4, type: "tool_call", content: { tool_kind: "function", tool_name: "read", call_id: "call1", arguments: {}, result: "ok" } },
    { ...base, id: "answer", sequence: 5, type: "message", content: { role: "assistant", text: "Done", phase: "final" } },
  ];
  const reasoning = projectOaepAssistantItem(items[0], "run1");
  assert.equal(reasoning.parts[0].sequence, 3);
  assert.equal(reasoning.parts[0].kind === "reasoning" ? reasoning.parts[0].segments[0].sequence : undefined, 3);
  const tool = projectOaepAssistantItem(items[1], "run1");
  assert.equal(tool.activities[0].sequence, 4);
  assert.equal(tool.activities[0].updatedSequence, 4);
  assert.equal(tool.activities[0].completedSequence, 4);

  const run: OaepRun = { id: "run1", session_id: "thread1", sequence: 1, status: "completed", created_at: base.created_at, updated_at: base.updated_at, completed_at: base.updated_at, source: base.source };
  const thread = { id: "thread1", title: "test", workspacePath: "D:/tmp", createdAt: 0, updatedAt: 0 } as unknown as DesktopThread;
  const snapshot = projectOaepThreadSnapshot(thread, [items[2], items[0], items[1]], [run]);
  const turn = snapshot.messages.find((message) => message.role === "assistant")?.structuredTurn;
  assert.deepEqual(turn?.processTimeline?.map((entry) => [entry.kind, entry.sequence]), [["reasoning", 3], ["activity", 4], ["markdown", 5]]);
}

verifyReducerTimeline();
verifyOaepProjectionTimeline();
console.log("Structured process timeline verification passed.");
