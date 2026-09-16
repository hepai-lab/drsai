import assert from "node:assert/strict";
import {
  applyStructuredConversationEvent,
  createStructuredTurnState,
  sanitizeStructuredTurnState,
  STRUCTURED_CONVERSATION_VERSION,
  type ReasoningSegment,
  type StructuredActivityEvent,
  type StructuredAssistantPart,
  type StructuredConversationEvent,
  type StructuredProcessTimelineEntry,
} from "../api/structuredConversation";
import {
  buildProcessTimeline,
  visibleReasoningText,
  type ProcessTimelineEntry,
  type StructuredReasoningPart,
} from "../renderer/src/processTimelineModel";
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

function verifyReasoningRangeRendering(): void {
  const entry = (
    id: string,
    sequence: number,
    partId: string,
    segmentId: string,
    text: string,
  ): StructuredProcessTimelineEntry => ({ id, kind: "reasoning", sequence, partId, segmentId, text, status: "running" });
  const reasoningPart = (
    id: string,
    segments: Array<{ id: string; text: string }>,
    summary?: string,
  ): StructuredReasoningPart => ({
    id,
    kind: "reasoning",
    status: "running",
    segments: segments.map((segment): ReasoningSegment => ({ ...segment, status: "running" })),
    ...(summary ? { summary } : {}),
  });
  const toolActivity: StructuredActivityEvent = {
    id: "a1",
    turnId: "verify-ranges",
    timestamp: new Date(0).toISOString(),
    source: "verify",
    status: "running",
    title: "Tool",
    kind: "tool",
    toolName: "read",
    callId: "a1",
  };
  const rendered = (entries: ProcessTimelineEntry[]): string[] => entries
    .filter((candidate): candidate is Extract<ProcessTimelineEntry, { type: "reasoning" }> => candidate.type === "reasoning")
    .map((candidate) => visibleReasoningText(candidate.part));

  // Interleaved reasoning: the timeline records one entry per delta boundary and
  // the part holds the accumulated text. Rendering the accumulation once per
  // entry is the duplication bug; each entry must render only its own range.
  const interleaved = buildProcessTimeline(
    [
      entry("t:r1", 1, "p:reason", "s1", "Alpha "),
      { id: "t:a1", kind: "activity", sequence: 2, activityId: "a1" },
      entry("t:r3", 3, "p:reason", "s1", "Beta"),
    ],
    [reasoningPart("p:reason", [{ id: "s1", text: "Alpha Beta" }], "Plan")],
    [],
    [],
    [toolActivity],
    [],
    true,
  );
  assert.deepEqual(interleaved.map((candidate) => candidate.type), ["reasoning", "activity", "reasoning"]);
  assert.deepEqual(rendered(interleaved), ["Alpha ", "Beta"]);
  assert.equal(rendered(interleaved).join(""), "Alpha Beta");
  // The part summary is part-level metadata; repeating it per range would be the
  // same duplication in another form.
  assert.deepEqual(
    interleaved.filter((candidate) => candidate.type === "reasoning").map((candidate) => candidate.part.summary),
    ["Plan", undefined],
  );

  // Patch after snapshot: the timeline entry only covers a prefix of the part.
  const patched = buildProcessTimeline(
    [entry("t:p1", 1, "p:patch", "s1", "H")],
    [reasoningPart("p:patch", [{ id: "s1", text: "HT" }])],
    [],
    [],
    [],
    [],
    true,
  );
  assert.deepEqual(rendered(patched), ["HT"]);

  // The same, with the missing tail belonging to the last of several entries.
  const patchedTail = buildProcessTimeline(
    [entry("t:m1", 1, "p:multi", "s1", "H"), entry("t:m2", 2, "p:multi", "s1", "i")],
    [reasoningPart("p:multi", [{ id: "s1", text: "Hi!" }])],
    [],
    [],
    [],
    [],
    true,
  );
  assert.deepEqual(rendered(patchedTail), ["H", "i!"]);
  assert.equal(rendered(patchedTail).join(""), "Hi!");

  // Divergence between timeline and aggregate degrades to rendering the
  // aggregate exactly once, never to rendering something twice.
  const divergent = buildProcessTimeline(
    [entry("t:d1", 1, "p:drift", "s1", "One"), entry("t:d2", 2, "p:drift", "s1", "Two")],
    [reasoningPart("p:drift", [{ id: "s1", text: "Completely different" }])],
    [],
    [],
    [],
    [],
    true,
  );
  assert.deepEqual(rendered(divergent), ["Completely different"]);

  // A part whose timeline entries were dropped (bounded timeline) still renders.
  const orphaned = buildProcessTimeline(
    [{ id: "t:a9", kind: "activity", sequence: 1, activityId: "a1" }],
    [reasoningPart("p:lost", [{ id: "s1", text: "Still shown" }])],
    [],
    [],
    [toolActivity],
    [],
    true,
  );
  assert.deepEqual(rendered(orphaned), ["Still shown"]);

  // Legacy snapshots without a timeline keep rendering the aggregate once.
  const legacy = buildProcessTimeline(
    undefined,
    [reasoningPart("p:legacy", [{ id: "s1", text: "Old" }])],
    [],
    [],
    [],
    [],
    false,
  );
  assert.deepEqual(rendered(legacy), ["Old"]);
}

function verifyTerminalPartMonotonicity(): void {
  let sequence = 0;
  const makeEvent = (turnId: string) => (
    type: StructuredConversationEvent["type"],
    data: Partial<StructuredConversationEvent> = {},
  ): StructuredConversationEvent => {
    const next = data.sequence ?? ++sequence;
    return { version: STRUCTURED_CONVERSATION_VERSION, turnId, sequence: next, dedupeKey: `${type}:${next}`, timestamp: new Date(next).toISOString(), source: "verify", type, ...data } as StructuredConversationEvent;
  };
  const reasoningStarted: StructuredAssistantPart = { id: "p:reason", kind: "reasoning", status: "running", segments: [] };
  const reasoningDone: StructuredAssistantPart = {
    id: "p:reason",
    kind: "reasoning",
    status: "completed",
    segments: [{ id: "s1", text: "Think", status: "completed" }],
  };

  // A late duplicate start (snapshot replay) must not reopen a finished part,
  // otherwise a collapsed reasoning block pops back open.
  const monotonic = makeEvent("verify-monotonic");
  let state = createStructuredTurnState("verify-monotonic");
  state = applyStructuredConversationEvent(state, monotonic("turn.started"));
  state = applyStructuredConversationEvent(state, monotonic("part.started", { part: reasoningStarted } as Partial<StructuredConversationEvent>));
  state = applyStructuredConversationEvent(state, monotonic("part.completed", { part: reasoningDone } as Partial<StructuredConversationEvent>));
  state = applyStructuredConversationEvent(state, monotonic("part.started", { part: reasoningStarted } as Partial<StructuredConversationEvent>));
  assert.equal(state.parts.find((part) => part.id === "p:reason")?.status, "completed");

  // A turn that ends without an explicit part.completed must still seal its open
  // parts: the reasoning disclosure stays expanded forever otherwise, and the
  // result pane renders nothing while the answer markdown is not final.
  const sealing = makeEvent("verify-seal");
  let openTurn = createStructuredTurnState("verify-seal");
  openTurn = applyStructuredConversationEvent(openTurn, sealing("turn.started"));
  openTurn = applyStructuredConversationEvent(openTurn, sealing("part.started", {
    part: { id: "p:open-reason", kind: "reasoning", status: "running", segments: [{ id: "s1", text: "Thinking", status: "running" }] } as StructuredAssistantPart,
  } as Partial<StructuredConversationEvent>));
  openTurn = applyStructuredConversationEvent(openTurn, sealing("part.started", {
    part: { id: "p:answer", kind: "markdown", status: "running", channel: "answer", markdown: "Done" } as StructuredAssistantPart,
  } as Partial<StructuredConversationEvent>));
  openTurn = applyStructuredConversationEvent(openTurn, sealing("turn.completed"));
  const sealedReasoning = openTurn.parts.find((part) => part.id === "p:open-reason");
  const sealedMarkdown = openTurn.parts.find((part) => part.id === "p:answer");
  assert.equal(sealedReasoning?.status, "completed");
  assert.equal(sealedMarkdown?.status, "completed");
  assert.equal(sealedMarkdown?.kind === "markdown" ? sealedMarkdown.final : undefined, true);
}

verifyReducerTimeline();
verifyOaepProjectionTimeline();
verifyReasoningRangeRendering();
verifyTerminalPartMonotonicity();
console.log("Structured process timeline verification passed.");
