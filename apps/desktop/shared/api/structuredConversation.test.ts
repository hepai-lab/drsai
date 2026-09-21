import { describe, test, expect } from "vitest";
import {
  createStructuredTurnState,
  applyStructuredConversationEvent,
  sanitizeStructuredTurnState,
  migrateLegacyMessageToStructuredTurn,
  STRUCTURED_CONVERSATION_VERSION,
} from "./structuredConversation";
import type {
  StructuredConversationEvent,
  StructuredTurnState,
  StructuredAssistantPart,
  StructuredActivityEvent,
} from "./structuredConversation";

/* ── helpers ────────────────────────────────────────────────────────── */

let seqCounter = 0;
function resetSeq() { seqCounter = 0; }
function nextSeq() { return ++seqCounter; }

function makeEvent(
  turnId: string,
  type: StructuredConversationEvent["type"],
  data: Partial<StructuredConversationEvent> = {},
): StructuredConversationEvent {
  const sequence = data.sequence ?? nextSeq();
  return {
    version: STRUCTURED_CONVERSATION_VERSION,
    turnId,
    sequence,
    dedupeKey: `${turnId}:${type}:${sequence}`,
    timestamp: new Date(sequence).toISOString(),
    source: "test",
    type,
    ...data,
  } as StructuredConversationEvent;
}

function makeActivity(
  turnId: string,
  id: string,
  status: "running" | "completed" = "running",
): StructuredActivityEvent {
  return {
    id,
    turnId,
    timestamp: new Date().toISOString(),
    source: "test",
    status,
    title: `Activity ${id}`,
    kind: "tool",
    toolName: "test-tool",
    callId: id,
  };
}

function makeMarkdownPart(
  id: string,
  status: "running" | "completed" = "running",
  markdown = "",
  opts: { channel?: "process" | "answer"; final?: boolean } = {},
): StructuredAssistantPart {
  return {
    id,
    kind: "markdown",
    status,
    markdown,
    ...(opts.channel ? { channel: opts.channel } : {}),
    ...(opts.final ? { final: true } : {}),
  };
}

function makeReasoningPart(id: string): StructuredAssistantPart {
  return {
    id,
    kind: "reasoning",
    status: "running",
    segments: [],
  };
}

function makeProgressPart(id: string, summary = "Working"): StructuredAssistantPart {
  return {
    id,
    kind: "progress",
    status: "running",
    summary,
  };
}

/* ── Process timeline ordering tests ─────────────────────────────────── */

describe("Process timeline ordering", () => {
  test("reasoning, markdown, and activity entries are interleaved in sequence order", () => {
    resetSeq();
    const turnId = "turn-order-1";
    let state = createStructuredTurnState(turnId);
    state = applyStructuredConversationEvent(state, makeEvent(turnId, "turn.started"));

    // Start reasoning part
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.started", { part: makeReasoningPart("p:reason") } as any),
    );
    // Start answer markdown part
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.started", { part: makeMarkdownPart("p:md", "running", "", { channel: "answer" }) } as any),
    );

    // Reasoning delta (seq 4)
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.delta", { partId: "p:reason", delta: { kind: "reasoning.append", segmentId: "s1", text: "Thinking..." } } as any),
    );
    // Activity update (seq 5)
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "activity.updated", { activity: makeActivity(turnId, "act1") } as any),
    );
    // Markdown delta (seq 6)
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.delta", { partId: "p:md", delta: { kind: "markdown.append", text: "Answer..." } } as any),
    );

    const timeline = state.processTimeline ?? [];
    expect(timeline.length).toBe(3);

    // Sequence order: reasoning (4) → activity (5) → markdown (6)
    expect(timeline[0].sequence).toBe(4);
    expect(timeline[0].kind).toBe("reasoning");
    expect(timeline[1].sequence).toBe(5);
    expect(timeline[1].kind).toBe("activity");
    expect(timeline[2].sequence).toBe(6);
    expect(timeline[2].kind).toBe("markdown");
  });

  test("consecutive same-partId/segmentId reasoning deltas are merged", () => {
    resetSeq();
    const turnId = "turn-merge-1";
    let state = createStructuredTurnState(turnId);
    state = applyStructuredConversationEvent(state, makeEvent(turnId, "turn.started"));
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.started", { part: makeReasoningPart("p:r") } as any),
    );
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.delta", { partId: "p:r", delta: { kind: "reasoning.append", segmentId: "s1", text: "Hello " } } as any),
    );
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.delta", { partId: "p:r", delta: { kind: "reasoning.append", segmentId: "s1", text: "World" } } as any),
    );

    const timeline = state.processTimeline ?? [];
    expect(timeline.length).toBe(1);
    expect(timeline[0].kind).toBe("reasoning");
    const entry = timeline[0] as any;
    expect(entry.text).toBe("Hello World");
  });

  test("consecutive same-partId markdown deltas are merged", () => {
    resetSeq();
    const turnId = "turn-merge-2";
    let state = createStructuredTurnState(turnId);
    state = applyStructuredConversationEvent(state, makeEvent(turnId, "turn.started"));
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.started", { part: makeMarkdownPart("p:m", "running", "", { channel: "answer" }) } as any),
    );
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.delta", { partId: "p:m", delta: { kind: "markdown.append", text: "Part 1 " } } as any),
    );
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.delta", { partId: "p:m", delta: { kind: "markdown.append", text: "Part 2" } } as any),
    );

    const timeline = state.processTimeline ?? [];
    expect(timeline.length).toBe(1);
    expect(timeline[0].kind).toBe("markdown");
    const entry = timeline[0] as any;
    expect(entry.text).toBe("Part 1 Part 2");
  });

  test("deltas interrupted by another event create new timeline entries", () => {
    resetSeq();
    const turnId = "turn-split-1";
    let state = createStructuredTurnState(turnId);
    state = applyStructuredConversationEvent(state, makeEvent(turnId, "turn.started"));
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.started", { part: makeReasoningPart("p:r") } as any),
    );
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.started", { part: makeMarkdownPart("p:m", "running", "", { channel: "answer" }) } as any),
    );

    // Reasoning delta
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.delta", { partId: "p:r", delta: { kind: "reasoning.append", segmentId: "s1", text: "First" } } as any),
    );
    // Markdown delta (interrupts reasoning)
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.delta", { partId: "p:m", delta: { kind: "markdown.append", text: "Answer" } } as any),
    );
    // Reasoning delta again (new segment boundary)
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.delta", { partId: "p:r", delta: { kind: "reasoning.append", segmentId: "s1", text: " Second" } } as any),
    );

    const timeline = state.processTimeline ?? [];
    expect(timeline.length).toBe(3);
    // First reasoning, then markdown, then reasoning again
    expect(timeline[0].kind).toBe("reasoning");
    expect(timeline[1].kind).toBe("markdown");
    expect(timeline[2].kind).toBe("reasoning");
  });
});

/* ── Result layer isolation tests ────────────────────────────────────── */

describe("Result layer isolation", () => {
  test("turn.completed does NOT auto-finalize markdown parts", () => {
    resetSeq();
    const turnId = "turn-result-1";
    let state = createStructuredTurnState(turnId);
    state = applyStructuredConversationEvent(state, makeEvent(turnId, "turn.started"));
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.started", { part: makeMarkdownPart("p:md", "running", "", { channel: "answer" }) } as any),
    );
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.delta", { partId: "p:md", delta: { kind: "markdown.append", text: "Final answer" } } as any),
    );

    // The markdown part should have final=false during streaming
    const part = state.parts.find((p) => p.id === "p:md")!;
    expect(part.kind).toBe("markdown");
    expect((part as any).final).toBe(false);

    // Turn completed should NOT set final=true on the part
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "turn.completed", { meta: {} } as any),
    );
    const completedPart = state.parts.find((p) => p.id === "p:md")!;
    expect(completedPart.kind).toBe("markdown");
    expect((completedPart as any).final).toBe(false); // Still false! Only part.completed can set it.
    expect(state.status).toBe("completed");
    expect(state.sealed).toBe(true);
  });

  test("part.completed with channel=answer and final=true enables Result", () => {
    resetSeq();
    const turnId = "turn-result-2";
    let state = createStructuredTurnState(turnId);
    state = applyStructuredConversationEvent(state, makeEvent(turnId, "turn.started"));
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.started", { part: makeMarkdownPart("p:md", "running", "", { channel: "answer" }) } as any),
    );
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.delta", { partId: "p:md", delta: { kind: "markdown.append", text: "Final answer" } } as any),
    );

    // Part completed with explicit final=true and channel=answer
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.completed", {
        part: makeMarkdownPart("p:md", "completed", "Final answer", { channel: "answer", final: true }),
      } as any),
    );

    const part = state.parts.find((p) => p.id === "p:md")!;
    expect(part.kind).toBe("markdown");
    expect((part as any).final).toBe(true);
    expect((part as any).channel).toBe("answer");
    expect(part.status).toBe("completed");
  });

  test("process-channel markdown never enters Result", () => {
    resetSeq();
    const turnId = "turn-result-3";
    let state = createStructuredTurnState(turnId);
    state = applyStructuredConversationEvent(state, makeEvent(turnId, "turn.started"));

    // Start a markdown part WITHOUT channel — defaults to "process" on delta
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.started", { part: makeMarkdownPart("p:process", "running", "") } as any),
    );
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.delta", { partId: "p:process", delta: { kind: "markdown.append", text: "Process text" } } as any),
    );

    // Even after part.completed, process-channel text never gets final=true
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.completed", {
        part: makeMarkdownPart("p:process", "completed", "Process text"),
      } as any),
    );
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "turn.completed", { meta: {} } as any),
    );

    const part = state.parts.find((p) => p.id === "p:process")!;
    expect(part.kind).toBe("markdown");
    expect((part as any).channel).toBe("process");
    // final is false (set by delta), never true — process text can never enter Result
    expect((part as any).final).not.toBe(true);
  });
});

/* ── Transient answer markdown in Process ────────────────────────────── */

describe("Transient answer markdown", () => {
  test("answer-channel markdown is transient=true in processTimeline", () => {
    resetSeq();
    const turnId = "turn-transient-1";
    let state = createStructuredTurnState(turnId);
    state = applyStructuredConversationEvent(state, makeEvent(turnId, "turn.started"));
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.started", { part: makeMarkdownPart("p:md", "running", "", { channel: "answer" }) } as any),
    );
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.delta", { partId: "p:md", delta: { kind: "markdown.append", text: "Streaming answer" } } as any),
    );

    const timeline = state.processTimeline ?? [];
    expect(timeline.length).toBe(1);
    expect(timeline[0].kind).toBe("markdown");
    expect((timeline[0] as any).transient).toBe(true);
  });

  test("process-channel markdown is transient=false in processTimeline", () => {
    resetSeq();
    const turnId = "turn-transient-2";
    let state = createStructuredTurnState(turnId);
    state = applyStructuredConversationEvent(state, makeEvent(turnId, "turn.started"));
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.started", { part: makeMarkdownPart("p:md", "running", "") } as any),
    );
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.delta", { partId: "p:md", delta: { kind: "markdown.append", text: "Process text" } } as any),
    );

    const timeline = state.processTimeline ?? [];
    expect(timeline.length).toBe(1);
    expect(timeline[0].kind).toBe("markdown");
    expect((timeline[0] as any).transient).toBe(false);
  });
});

/* ── Sanitization and recovery tests ─────────────────────────────────── */

describe("Sanitization and recovery", () => {
  test("processTimeline is preserved through sanitizeStructuredTurnState", () => {
    resetSeq();
    const turnId = "turn-sanitize-1";
    let state = createStructuredTurnState(turnId);
    state = applyStructuredConversationEvent(state, makeEvent(turnId, "turn.started"));
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.started", { part: makeReasoningPart("p:r") } as any),
    );
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.delta", { partId: "p:r", delta: { kind: "reasoning.append", segmentId: "s1", text: "Reasoning" } } as any),
    );

    // Serialize and sanitize
    const serialized = JSON.parse(JSON.stringify(state));
    const sanitized = sanitizeStructuredTurnState(serialized);

    expect(sanitized).not.toBeNull();
    expect(sanitized!.processTimeline).toBeDefined();
    expect(sanitized!.processTimeline!.length).toBe(1);
    expect(sanitized!.processTimeline![0].kind).toBe("reasoning");
  });

  test("empty processTimeline is handled gracefully", () => {
    const turnId = "turn-sanitize-2";
    const state = createStructuredTurnState(turnId);
    expect(state.processTimeline).toEqual([]);

    const sanitized = sanitizeStructuredTurnState(JSON.parse(JSON.stringify(state)));
    expect(sanitized).not.toBeNull();
    expect(sanitized!.processTimeline).toEqual([]);
  });

  test("missing processTimeline on old snapshot defaults to empty array", () => {
    const turnId = "turn-sanitize-3";
    const oldState = {
      version: STRUCTURED_CONVERSATION_VERSION,
      turnId,
      status: "completed" as const,
      parts: [makeMarkdownPart("p:md", "completed", "Old answer", { channel: "answer", final: true })],
      activities: [],
      // Note: no processTimeline field
      lastSequence: 5,
      seenDedupeKeys: [],
      protocolIssues: [],
      sealed: true,
    };

    const sanitized = sanitizeStructuredTurnState(oldState);
    expect(sanitized).not.toBeNull();
    expect(sanitized!.processTimeline).toEqual([]);
  });

  test("legacy snapshot without channel defaults to answer for non-streaming", () => {
    // Verify migrateLegacyMessageToStructuredTurn sets channel=answer, final=true
    // for completed non-error messages
    const turn = migrateLegacyMessageToStructuredTurn({
      id: "msg-1",
      content: "Hello world",
      streaming: false,
    });
    const mdPart = turn.parts.find((p) => p.kind === "markdown");
    expect(mdPart).toBeDefined();
    expect((mdPart as any).channel).toBe("answer");
    expect((mdPart as any).final).toBe(true);
    expect(turn.processTimeline).toEqual([]);
  });
});

/* ── Activity timeline tests ─────────────────────────────────────────── */

describe("Activity timeline entries", () => {
  test("non-subtask activities appear in processTimeline", () => {
    resetSeq();
    const turnId = "turn-act-1";
    let state = createStructuredTurnState(turnId);
    state = applyStructuredConversationEvent(state, makeEvent(turnId, "turn.started"));
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "activity.updated", { activity: makeActivity(turnId, "act1", "running") } as any),
    );
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "activity.updated", { activity: { ...makeActivity(turnId, "act1"), status: "completed" } } as any),
    );

    const timeline = state.processTimeline ?? [];
    // The second activity.updated should update the existing timeline entry, not create a new one
    expect(timeline.length).toBe(1);
    expect(timeline[0].kind).toBe("activity");
    expect((timeline[0] as any).activityId).toBe("act1");
    // Sequence should be updated to the latest event's sequence
    expect(timeline[0].sequence).toBe(state.lastSequence);
  });

  test("subtask activities do NOT appear in parent processTimeline", () => {
    resetSeq();
    const turnId = "turn-act-2";
    let state = createStructuredTurnState(turnId);
    state = applyStructuredConversationEvent(state, makeEvent(turnId, "turn.started"));
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "activity.updated", {
        activity: { ...makeActivity(turnId, "act-sub"), subtaskId: "task1" },
      } as any),
    );

    const timeline = state.processTimeline ?? [];
    expect(timeline.length).toBe(0); // Subtask activities don't enter parent timeline
  });
});

/* ── Progress in processTimeline ─────────────────────────────────────── */

describe("Progress timeline entries", () => {
  test("progress deltas create timeline entries with phase and counts", () => {
    resetSeq();
    const turnId = "turn-prog-1";
    let state = createStructuredTurnState(turnId);
    state = applyStructuredConversationEvent(state, makeEvent(turnId, "turn.started"));
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.started", { part: makeProgressPart("p:prog", "Working") } as any),
    );
    state = applyStructuredConversationEvent(
      state,
      makeEvent(turnId, "part.delta", {
        partId: "p:prog",
        delta: { kind: "progress.update", summary: "Step 1 done", phase: "processing", completed: 5, total: 10 },
      } as any),
    );

    const timeline = state.processTimeline ?? [];
    expect(timeline.length).toBe(1);
    expect(timeline[0].kind).toBe("progress");
    const entry = timeline[0] as any;
    expect(entry.phase).toBe("processing");
    expect(entry.completed).toBe(5);
    expect(entry.total).toBe(10);
    expect(entry.summary).toBe("Step 1 done");
  });
});

/* ── Bounded timeline tests ──────────────────────────────────────────── */

describe("Bounded timeline", () => {
  test("processTimeline is capped at 500 entries", () => {
    resetSeq();
    const turnId = "turn-bound-1";
    let state = createStructuredTurnState(turnId);
    state = applyStructuredConversationEvent(state, makeEvent(turnId, "turn.started"));

    // Create 600 reasoning deltas with different segment IDs (so they don't merge)
    for (let i = 0; i < 600; i++) {
      state = applyStructuredConversationEvent(
        state,
        makeEvent(turnId, "part.started", { part: makeReasoningPart(`p:r${i}`) } as any),
      );
      state = applyStructuredConversationEvent(
        state,
        makeEvent(turnId, "part.delta", {
          partId: `p:r${i}`,
          delta: { kind: "reasoning.append", segmentId: `s${i}`, text: `R${i}` },
        } as any),
      );
    }

    const timeline = state.processTimeline ?? [];
    expect(timeline.length).toBeLessThanOrEqual(500);
    // The most recent 500 should be kept
    expect(timeline[timeline.length - 1].sequence).toBe(state.lastSequence);
  });
});
