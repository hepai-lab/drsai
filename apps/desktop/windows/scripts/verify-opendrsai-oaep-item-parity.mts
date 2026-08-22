import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  applyStructuredConversationEvent,
  createStructuredTurnState,
  type StructuredConversationEvent,
  type StructuredTurnState,
} from "../../shared/api/structuredConversation";
import type { AgentRunEvent, ChatEvent, DesktopThread } from "../../shared/api/desktopApi";
import type { OaepEvent, OaepItem, OaepRun } from "../../shared/api/oaep.generated";
import { createOaepAgentRunBridge } from "../../shared/main/oaepAgentRunBridge";
import { createOaepPresentationProjection, projectOaepEventForPresentation } from "../../shared/main/oaepPresentationProjector";
import { reduceOaepEvent } from "../../shared/main/oaepSessionStream";
import { projectOaepThreadSnapshot } from "../../shared/main/threadRuntimeProjection";

const sessionId = "session-opendrsai-parity";
const runId = "run-opendrsai-parity";
const turnId = "turn-opendrsai-parity";
const now = "2026-08-05T08:00:00.000Z";
const source = { backend: "opendrsai", adapter: "full-agent-runtime", mapping_version: "oaep-opendrsai/1" };

const run = (status: OaepRun["status"]): OaepRun => ({
  id: runId, session_id: sessionId, sequence: 1, source, status,
  created_at: now, updated_at: now,
  ...(status === "completed" ? { completed_at: now } : {}),
});
const complete = <T extends OaepItem>(
  value: Omit<T, "session_id" | "run_id" | "source" | "sequence" | "status" | "created_at" | "updated_at">,
  sequence: number,
): T => ({ ...value, session_id: sessionId, run_id: runId, source, sequence, status: "completed", created_at: now, updated_at: now } as T);

const finalItems: OaepItem[] = [
  complete({ id: "plan-1", type: "plan", content: { text: "Inspect then deliver", steps: [{ id: "step-1", title: "Inspect", status: "completed" }] } }, 1),
  complete({ id: "progress-1", type: "message", content: { role: "assistant", phase: "commentary", text: "Reading materials", parts: [] } }, 2),
  complete({ id: "tool-1", type: "tool_call", content: { tool_kind: "workspace", tool_name: "read_file", call_id: "call-1", arguments: { path: "notes.md" }, result: "ok" } }, 3),
  complete({ id: "file-1", type: "file_change", content: { summary: "Updated report", changes: [{ path: "report.md", operation: "modify" }] } }, 4),
  complete({ id: "subtask-1", type: "subtask", content: { title: "Synthesize", summary: "complete" } }, 5),
  complete({ id: "artifact-1", type: "artifact", content: { artifact_id: "report-artifact", artifact_type: "report", name: "report.md", path: "report.md", summary: "Ready" } }, 6),
  complete({ id: "answer-1", type: "message", content: { role: "assistant", phase: "final", text: "Done.", parts: [{ type: "text", text: "Done." }] } }, 7),
];

let eventSequence = 0;
const event = (type: OaepEvent["type"], data: OaepEvent["data"], itemId?: string): OaepEvent => ({
  version: "1.0", event_id: `event-${++eventSequence}`, session_id: sessionId, run_id: runId,
  ...(itemId ? { item_id: itemId } : {}), sequence: eventSequence, type, timestamp: now,
  dedupe_key: `opendrsai-parity:${eventSequence}`, source, data,
});
const events: OaepEvent[] = [event("event.run.started", { run: run("running") })];
for (const item of finalItems) {
  const running = { ...item, status: "running" as const, content: emptyContent(item) } as OaepItem;
  events.push(event("event.item.started", { item: running }, item.id));
  const delta = deltaFor(item);
  if (delta) events.push(event("event.item.delta", { delta }, item.id));
  events.push(event("event.item.completed", { item }, item.id));
}
events.push(event("event.run.completed", { run: run("completed") }));

const liveResult = projectEvents(events);
const replayResult = projectEvents(JSON.parse(JSON.stringify(events)) as OaepEvent[]);
const thread = {
  id: sessionId, kind: "agent_run", title: "OAEP parity", workspacePath: "C:\\workspace",
  createdAt: now, updatedAt: now, status: "idle", messageCount: 0,
} as DesktopThread;
const snapshot = projectOaepThreadSnapshot(thread, finalItems, [run("completed")]);
const snapshotTurn = snapshot.messages.find((message) => message.role === "assistant")?.structuredTurn;
assert.ok(snapshotTurn, "Snapshot must hydrate one structured assistant turn.");

const bridge = createOaepAgentRunBridge({ requestId: turnId, sessionId, runId });
const agentEvents: AgentRunEvent[] = [];
for (const structuredEvent of liveResult.structuredEvents) {
  agentEvents.push(...bridge.map({ requestId: turnId, sessionId, runId, type: "structured", structuredEvent } as ChatEvent));
}

const liveDigest = structuredDigest(liveResult.state);
const replayDigest = structuredDigest(replayResult.state);
const snapshotDigest = structuredDigest(snapshotTurn);
const agentDigest = agentBridgeDigest(agentEvents);
assert.deepEqual(replayDigest, liveDigest, "Replay UI digest must equal Live.");
assert.deepEqual(snapshotDigest, liveDigest, "Snapshot UI digest must equal Live.");
assert.deepEqual(agentDigest, liveDigest, "Agent UI bridge digest must equal canonical OAEP UI digest.");
assert.deepEqual(liveDigest.map((entry) => entry.id), finalItems.map((item) => item.id), "Item order and identity must not drift.");
assert.equal(agentEvents.filter((item) => ["done", "error", "aborted"].includes(item.type)).length, 1, "Agent bridge must emit exactly one terminal.");
assert.equal(agentEvents.at(-1)?.type, "done", "Terminal must remain the final Agent event.");
const bridgeSequences = agentEvents.flatMap((item) => item.structuredSequence == null ? [] : [item.structuredSequence]);
assert.ok(bridgeSequences.every((value, index) => index === 0 || value >= bridgeSequences[index - 1]), "Agent bridge sequence must remain ordered.");
assert.ok(agentEvents.filter((item) => item.oaepItemId).every((item) => finalItems.some((candidate) => candidate.id === item.oaepItemId)), "Every bridged identity must reference a durable OAEP Item.");

const digest = createHash("sha256").update(JSON.stringify(liveDigest)).digest("hex");
console.log(JSON.stringify({
  passed: true,
  backend: "opendrsai",
  item_types: ["plan", "progress", "tool_call", "file_change", "subtask", "artifact", "message"],
  paths: ["snapshot", "replay", "live", "agent_ui_bridge"],
  item_count: liveDigest.length,
  terminal_count: 1,
  digest: `sha256:${digest}`,
}));

function projectEvents(input: OaepEvent[]): { state: StructuredTurnState; structuredEvents: StructuredConversationEvent[] } {
  const items = new Map<string, OaepItem>();
  const runs = new Map<string, OaepRun>();
  const projection = createOaepPresentationProjection(turnId, "workspace");
  let state = createStructuredTurnState(turnId);
  const structuredEvents: StructuredConversationEvent[] = [];
  for (const candidate of input) {
    reduceOaepEvent(items, runs, candidate);
    const projected = projectOaepEventForPresentation(candidate, projection, candidate.item_id ? items.get(candidate.item_id) : undefined);
    structuredEvents.push(...projected);
    for (const structured of projected) state = applyStructuredConversationEvent(state, structured);
  }
  assert.equal(state.status, "completed");
  assert.equal(state.protocolIssues.length, 0);
  return { state, structuredEvents };
}

function structuredDigest(state: StructuredTurnState): Array<{ id: string; kind: string; value: string }> {
  return finalItems.map((item) => {
    const part = state.parts.find((candidate) => candidate.id === item.id);
    const activity = state.activities.find((candidate) => candidate.oaepItemId === item.id);
    if (item.type === "plan" && part?.kind === "progress") return { id: item.id, kind: "plan", value: part.summary };
    if (item.type === "message" && item.content.phase === "commentary" && part?.kind === "progress") return { id: item.id, kind: "progress", value: part.summary };
    if (item.type === "tool_call" && activity?.kind === "tool") return { id: item.id, kind: "tool", value: `${activity.title} (${activity.status})` };
    if (item.type === "file_change" && activity?.kind === "file_change") return { id: item.id, kind: "file", value: `${activity.action}:${activity.path}` };
    if (item.type === "subtask" && part?.kind === "subtask") return { id: item.id, kind: "subtask", value: [part.title, part.summary].filter(Boolean).join(": ") };
    if (item.type === "artifact" && part?.kind === "artifact") return { id: item.id, kind: "artifact", value: part.path || part.name };
    if (item.type === "message" && part?.kind === "markdown") return { id: item.id, kind: "message", value: part.markdown };
    throw new Error(`structured_digest_item_missing:${item.id}`);
  });
}

function agentBridgeDigest(input: AgentRunEvent[]): Array<{ id: string; kind: string; value: string }> {
  return finalItems.map((item) => {
    const matching = input.filter((candidate) => candidate.oaepItemId === item.id);
    const last = matching.at(-1);
    if (!last) throw new Error(`agent_bridge_item_missing:${item.id}`);
    if (item.type === "message" && item.content.phase === "final") {
      return { id: item.id, kind: "message", value: matching.filter((candidate) => candidate.type === "chunk").map((candidate) => candidate.content || "").join("") };
    }
    if (item.type === "file_change") return { id: item.id, kind: "file", value: `${last.fileEvent?.action}:${last.fileEvent?.path}` };
    if (item.type === "artifact") return { id: item.id, kind: "artifact", value: last.fileEvent?.path || "" };
    const kind = item.type === "message" ? "progress" : item.type === "tool_call" ? "tool" : item.type;
    return { id: item.id, kind, value: last.content || "" };
  });
}

function emptyContent(item: OaepItem): OaepItem["content"] {
  if (item.type === "plan") return { ...item.content, text: "" };
  if (item.type === "message") return { ...item.content, text: "", parts: [] };
  if (item.type === "tool_call") return { ...item.content, result: "" };
  if (item.type === "subtask") return { ...item.content, summary: "" };
  return item.content;
}

function deltaFor(item: OaepItem): Record<string, unknown> | null {
  if (item.type === "plan") return { kind: "plan.text.append", text: item.content.text };
  if (item.type === "message") return { kind: "message.text.append", text: item.content.text };
  if (item.type === "tool_call") return { kind: "tool.output.append", text: String(item.content.result || "") };
  if (item.type === "subtask") return { kind: "subtask.summary.append", text: String(item.content.summary || "") };
  return null;
}
