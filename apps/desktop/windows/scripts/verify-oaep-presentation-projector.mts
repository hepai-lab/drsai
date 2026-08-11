import assert from "node:assert/strict";
import {
  applyStructuredConversationEvent,
  createStructuredTurnState,
  type StructuredTurnState,
} from "../../shared/api/structuredConversation";
import type { DesktopThread } from "../../shared/api/desktopApi";
import type { OaepEvent, OaepItem, OaepRun } from "../../shared/api/oaep.generated";
import { reduceOaepEvent } from "../../shared/main/oaepSessionStream";
import {
  createOaepPresentationProjection,
  projectOaepEventForPresentation,
} from "../../shared/main/oaepPresentationProjector";
import { projectOaepThreadSnapshot } from "../../shared/main/threadRuntimeProjection";
import { projectOaepAssistantItem } from "../../shared/main/threadRuntimeProjection";

const sessionId = "session-v6";
const runId = "run-v6";
const source = { backend: "codex", adapter: "codex-adapter", mapping_version: "oaep-codex/2" };
const startedAt = "2026-08-04T00:00:00.000Z";
const completedAt = "2026-08-04T00:00:28.000Z";

const run = (status: OaepRun["status"], updatedAt = startedAt): OaepRun => ({
  id: runId, session_id: sessionId, sequence: 1, source, status,
  created_at: startedAt, updated_at: updatedAt,
  ...(status === "completed" ? { completed_at: updatedAt } : {}),
});
const item = <T extends OaepItem>(value: Omit<T, "session_id" | "run_id" | "source" | "sequence" | "created_at" | "updated_at">, sequence: number): T => ({
  ...value, session_id: sessionId, run_id: runId, source, sequence,
  created_at: startedAt, updated_at: startedAt,
} as T);
const reasoning = item<Extract<OaepItem, { type: "reasoning" }>>({
  id: "reason-1", type: "reasoning", status: "running", content: { segments: [] },
}, 1);
const reasoningDone = { ...reasoning, status: "completed", updated_at: "2026-08-04T00:00:06.000Z",
  content: { segments: [{ id: "summary", text: "Inspecting the workspace." }] } } as const;
const command = item<Extract<OaepItem, { type: "command_execution" }>>({
  id: "command-1", type: "command_execution", status: "running",
  content: { command: ["rg", "README"], display_command: "rg README", cwd: ".", output: "", exit_code: null, duration_ms: null },
}, 2);
const commandDone = { ...command, status: "completed", updated_at: "2026-08-04T00:00:10.000Z",
  content: { ...command.content, output: "README.md", exit_code: 0, duration_ms: 1200 } } as const;
const fileDone = item<Extract<OaepItem, { type: "file_change" }>>({
  id: "file-1", type: "file_change", status: "completed",
  content: { summary: "Updated README", changes: [{ path: "README.md", operation: "modify" }] },
}, 3);
const answer = item<Extract<OaepItem, { type: "message" }>>({
  id: "answer-1", type: "message", status: "running",
  content: { role: "assistant", phase: "final", text: "", parts: [], citations: [] },
}, 4);
const answerDone = { ...answer, status: "completed", updated_at: completedAt,
  content: { ...answer.content, text: "Hello.", parts: [{ type: "text" as const, text: "Hello." }] } } as const;

let nextSequence = 0;
const event = (type: OaepEvent["type"], data: OaepEvent["data"], itemId?: string, timestamp = startedAt): OaepEvent => ({
  version: "1.0", event_id: `event-${++nextSequence}`, session_id: sessionId, run_id: runId,
  ...(itemId ? { item_id: itemId } : {}), sequence: nextSequence, type, timestamp,
  dedupe_key: `dedupe-${nextSequence}`, source, data,
});

const events: OaepEvent[] = [
  event("event.run.started", { run: run("running") }),
  event("event.item.started", { item: reasoning }, reasoning.id),
  event("event.item.delta", { delta: { kind: "reasoning.text.append", text: "Inspecting the workspace.", segment_id: "summary" } }, reasoning.id),
  event("event.item.completed", { item: reasoningDone }, reasoning.id, reasoningDone.updated_at),
  event("event.item.started", { item: command }, command.id),
  event("event.item.completed", { item: commandDone }, command.id, commandDone.updated_at),
  event("event.item.completed", { item: fileDone }, fileDone.id, fileDone.updated_at),
  event("event.item.started", { item: answer }, answer.id),
  event("event.item.delta", { delta: { kind: "message.text.append", text: "Hel" } }, answer.id),
  event("event.item.delta", { delta: { kind: "message.text.append", text: "lo." } }, answer.id),
  event("event.item.completed", { item: answerDone }, answer.id, answerDone.updated_at),
  event("event.run.completed", { run: run("completed", completedAt) }, undefined, completedAt),
];

const items = new Map<string, OaepItem>();
const runs = new Map<string, OaepRun>();
const projection = createOaepPresentationProjection("request-v6", "drsai");
let live: StructuredTurnState = createStructuredTurnState("request-v6");
for (const oaepEvent of events) {
  reduceOaepEvent(items, runs, oaepEvent);
  const projected = projectOaepEventForPresentation(
    oaepEvent,
    projection,
    oaepEvent.item_id ? items.get(oaepEvent.item_id) : undefined,
  );
  for (const structuredEvent of projected) live = applyStructuredConversationEvent(live, structuredEvent);
}

assert.equal(live.status, "completed");
assert.equal(live.meta?.backend, "codex");
assert.equal(live.meta?.workspaceLabel, "drsai");
assert.equal(live.meta?.durationMs, 28_000);
assert.equal(live.parts.find((part) => part.kind === "markdown")?.markdown, "Hello.");
assert.equal(live.parts.find((part) => part.kind === "reasoning")?.segments[0]?.text, "Inspecting the workspace.");
assert.deepEqual(live.activities.map((activity) => activity.id), ["command-1", "file-1:1"]);
assert.equal(live.activities[0]?.kind, "tool");
assert.equal(live.activities[1]?.kind, "file_change");
assert.equal(live.protocolIssues.length, 0);

const thread = {
  id: "thread-v6", kind: "chat", title: "V6", workspacePath: "C:\\repo\\drsai",
  createdAt: startedAt, updatedAt: completedAt, status: "idle", messageCount: 0,
} as DesktopThread;
const historical = projectOaepThreadSnapshot(thread, items.values(), runs.values());
const historicalTurn = historical.messages.find((message) => message.role === "assistant")?.structuredTurn;
assert.ok(historicalTurn);
assert.equal(historicalTurn.status, live.status);
assert.equal(historicalTurn.parts.find((part) => part.kind === "markdown")?.markdown,
  live.parts.find((part) => part.kind === "markdown")?.markdown);
assert.equal(historicalTurn.parts.find((part) => part.kind === "reasoning")?.segments[0]?.text,
  live.parts.find((part) => part.kind === "reasoning")?.segments[0]?.text);
assert.deepEqual(historicalTurn.activities.map((activity) => [activity.id, activity.kind]),
  live.activities.map((activity) => [activity.id, activity.kind]));
assert.equal(JSON.stringify(live).includes("[{'text'"), false);

const completedItem = (value: Pick<OaepItem, "id" | "type" | "content">, sequence: number): OaepItem => ({
  ...value,
  session_id: sessionId,
  run_id: runId,
  source,
  sequence,
  status: "completed",
  created_at: startedAt,
  updated_at: completedAt,
} as OaepItem);

const tenItemMatrix: OaepItem[] = [
  completedItem({ id: "m", type: "message", content: { role: "assistant", phase: "final", text: "answer", parts: [{ type: "text", text: "answer" }] } }, 1),
  completedItem({ id: "r", type: "reasoning", content: { segments: [{ id: "s", text: "reason" }] } }, 2),
  completedItem({ id: "p", type: "plan", content: { text: "plan", steps: [{ id: "step", title: "step", status: "completed" }] } }, 3),
  completedItem({ id: "c", type: "command_execution", content: { command: ["echo"], display_command: "echo", cwd: ".", output: "ok", exit_code: 0, duration_ms: 1 } }, 4),
  completedItem({ id: "f", type: "file_change", content: { summary: "changed", changes: [{ path: "a.txt", operation: "modify" }] } }, 5),
  completedItem({ id: "t", type: "tool_call", content: { tool_kind: "mcp", tool_name: "read", call_id: "call", arguments: {}, result: "ok" } }, 6),
  completedItem({ id: "a", type: "artifact", content: { artifact_id: "artifact", artifact_type: "report", name: "report", summary: "ready" } }, 7),
  completedItem({ id: "i", type: "interaction", content: { interaction_type: "approval", prompt: "approve?", options: [], approval_id: "approval" } }, 8),
  completedItem({ id: "s", type: "subtask", content: { title: "child", summary: "done" } }, 9),
  completedItem({ id: "n", type: "notice", content: { level: "warning", code: "notice", message: "safe" } }, 10),
];
const matrixProjection = tenItemMatrix.map((candidate) => ({
  type: candidate.type,
  ...projectOaepAssistantItem(candidate, runId, true),
}));
assert.deepEqual(matrixProjection.map((entry) => entry.type), [
  "message", "reasoning", "plan", "command_execution", "file_change",
  "tool_call", "artifact", "interaction", "subtask", "notice",
]);
assert.ok(matrixProjection.every((entry) => entry.parts.length + entry.activities.length > 0));
assert.deepEqual(
  new Set(matrixProjection.flatMap((entry) => entry.parts.map((part) => part.kind))),
  new Set(["markdown", "reasoning", "progress", "artifact", "interaction", "subtask", "notice"]),
);
assert.deepEqual(
  new Set(matrixProjection.flatMap((entry) => entry.activities.map((activity) => activity.kind))),
  new Set(["tool", "file_change"]),
);
const hiddenReasoning = completedItem({ id: "hidden-r", type: "reasoning", content: { segments: [
  { id: "analysis", text: "private-canary", kind: "analysis", visibility: "hidden", source: "backend" },
] } }, 11);
assert.deepEqual(projectOaepAssistantItem(hiddenReasoning, runId).parts, [],
  "historical projection must not render hidden reasoning");
const hiddenProjection = createOaepPresentationProjection("hidden-reasoning");
assert.deepEqual(projectOaepEventForPresentation(event("event.item.delta", { delta: {
  kind: "reasoning.text.append", text: "private-canary", segment_id: "analysis",
  reasoning_kind: "analysis", visibility: "hidden", reasoning_source: "backend",
} }, hiddenReasoning.id), hiddenProjection, hiddenReasoning), [],
"live projection must not render hidden reasoning");

const sevenDeltaMatrix = [
  ["message.text.append", tenItemMatrix[0]],
  ["reasoning.text.append", tenItemMatrix[1]],
  ["reasoning.segment.added", tenItemMatrix[1]],
  ["plan.text.append", tenItemMatrix[2]],
  ["command.output.append", tenItemMatrix[3]],
  ["tool.output.append", tenItemMatrix[5]],
  ["subtask.summary.append", tenItemMatrix[8]],
] as const;
for (const [kind, candidate] of sevenDeltaMatrix) {
  const deltaProjection = createOaepPresentationProjection(`delta-${kind}`);
  const deltaEvent = event("event.item.delta", { delta: { kind, text: "x" } }, candidate.id);
  const projectedEvents = projectOaepEventForPresentation(deltaEvent, deltaProjection, candidate);
  assert.ok(projectedEvents.some((value) => value.type === "part.delta" || value.type === "activity.updated"), kind);
  assert.equal(deltaProjection.protocolViolations, 0, kind);
}
const unknownProjection = createOaepPresentationProjection("delta-unknown");
assert.deepEqual(projectOaepEventForPresentation(
  event("event.item.delta", { delta: { kind: "future.delta", text: "secret payload" } }, tenItemMatrix[0].id),
  unknownProjection,
  tenItemMatrix[0],
), [{
  version: 2,
  turnId: "delta-unknown",
  sequence: 1,
  dedupeKey: `dedupe-${nextSequence}:turn-started`,
  timestamp: startedAt,
  source: "codex",
  type: "turn.started",
}]);
assert.equal(unknownProjection.protocolViolations, 1);
assert.equal(unknownProjection.unknownDeltaKinds.get("future.delta"), 1);
assert.equal(JSON.stringify([...unknownProjection.unknownDeltaKinds]).includes("secret payload"), false);

console.log("OAEP projector verification passed (10 Item types, 7 Delta kinds, live/history parity, safe unknown diagnostics).");
