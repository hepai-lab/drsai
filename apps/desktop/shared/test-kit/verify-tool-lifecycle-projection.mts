import assert from "node:assert/strict";
import { projectOaepAssistantItem } from "../main/threadRuntimeProjection";
import {
  applyStructuredConversationEvent,
  createStructuredTurnState,
  type StructuredConversationEvent,
  type StructuredPartStatus,
} from "../api/structuredConversation";
import type { OaepItem } from "../api/oaep.generated";

/**
 * The Desktop tool card is only useful if a tool visibly moves
 * running -> completed (or -> failed). This verifies the two hops that make
 * that true, using the real runtime projection and the real reducer:
 *
 *  1. OAEP item status -> projected tool activity status
 *     (`failed` must become `error`, not `completed`).
 *  2. reducer: a tool that never reports a terminal state is closed as
 *     `cancelled` when the turn ends (never forged into `completed`).
 */

const NOW = new Date("2026-09-21T00:00:00.000Z").toISOString();

function toolItem(status: OaepItem["status"], callId: string): OaepItem {
  return {
    id: `tool:run-1:${callId}`,
    session_id: "session-1",
    run_id: "run-1",
    type: "tool_call",
    status,
    sequence: 1,
    created_at: NOW,
    updated_at: NOW,
    source: { backend: "runtime" },
    content: {
      tool_kind: "tool",
      tool_name: "demo_tool",
      call_id: callId,
      arguments: { path: "a.txt" },
      result: status === "completed" ? "ok" : status === "failed" ? "boom" : undefined,
    },
  } as OaepItem;
}

function projectedToolStatus(item: OaepItem): StructuredPartStatus {
  const projected = projectOaepAssistantItem(item, "turn-1", true);
  const activity = projected.activities.find((candidate) => candidate.kind === "tool");
  assert.ok(activity && activity.kind === "tool", "tool item must project to a tool activity");
  return activity.status;
}

// 1. OAEP status -> activity status. "failed" must not read as success.
assert.equal(projectedToolStatus(toolItem("running", "c1")), "running", "running tool -> running activity");
assert.equal(projectedToolStatus(toolItem("completed", "c1")), "completed", "completed tool -> completed activity");
assert.equal(projectedToolStatus(toolItem("failed", "c1")), "error", "failed tool -> error activity");
assert.equal(projectedToolStatus(toolItem("cancelled", "c1")), "cancelled", "cancelled tool -> cancelled activity");

// 2. A tool that is still running when the turn completes must stop showing
//    activity without claiming success; an already-terminal tool is untouched.
let seq = 0;
const event = <T extends StructuredConversationEvent["type"]>(
  type: T,
  payload: Omit<Extract<StructuredConversationEvent, { type: T }>, "version" | "turnId" | "sequence" | "dedupeKey" | "timestamp" | "source" | "type">,
): Extract<StructuredConversationEvent, { type: T }> => ({
  version: 2, turnId: "turn-1", sequence: ++seq, dedupeKey: `tool-lifecycle:${seq}:${type}`,
  timestamp: NOW, source: "runtime", type, ...payload,
} as Extract<StructuredConversationEvent, { type: T }>);

const base = { turnId: "turn-1", timestamp: NOW, source: "runtime", title: "demo_tool", toolName: "demo_tool", kind: "tool" } as const;

let turn = createStructuredTurnState("turn-1");
turn = applyStructuredConversationEvent(turn, event("activity.updated", {
  activity: { ...base, id: "a-open", callId: "c-open", status: "running" },
}));
turn = applyStructuredConversationEvent(turn, event("activity.updated", {
  activity: { ...base, id: "a-done", callId: "c-done", status: "completed" },
}));
turn = applyStructuredConversationEvent(turn, event("turn.completed", {}));

const open = turn.activities.find((activity) => activity.id === "a-open");
const done = turn.activities.find((activity) => activity.id === "a-done");
assert.equal(open?.status, "cancelled", "open tool must close as cancelled, not completed");
assert.equal(done?.status, "completed", "already-terminal tool must keep its state");

console.log("TOOL_LIFECYCLE_PROJECTION_OK: running/completed/failed visible end to end");
