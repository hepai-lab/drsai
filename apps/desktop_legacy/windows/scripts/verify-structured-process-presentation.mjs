import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = await build({
  entryPoints: [resolve(root, "../shared/renderer/src/structuredProcessPresentation.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`;
const { buildStructuredProcessPresentation } = await import(moduleUrl);
const projectionOutput = await build({
  entryPoints: [resolve(root, "../shared/main/threadRuntimeProjection.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  write: false,
});
const projectionModuleUrl = `data:text/javascript;base64,${Buffer.from(projectionOutput.outputFiles[0].text).toString("base64")}`;
const { projectOaepAssistantItem } = await import(projectionModuleUrl);

const common = { turnId: "turn-1", timestamp: "2026-08-15T00:00:00Z", source: "runtime" };
const turn = {
  version: 2,
  turnId: "turn-1",
  status: "completed",
  parts: [
    { id: "p1", kind: "progress", status: "completed", summary: "Reading inputs", completed: 1, total: 2 },
    { id: "p2", kind: "progress", status: "completed", summary: "Reading inputs", completed: 2, total: 2 },
    { id: "a1", kind: "artifact", status: "completed", artifactId: "report", artifactType: "file", name: "report.docx" },
    { id: "i1", kind: "interaction", status: "completed", requestId: "approval-1", interactionType: "approval", prompt: "Approve?" },
  ],
  activities: [
    { ...common, id: "t1", kind: "tool", status: "completed", title: "write", toolName: "run_write", callId: "c1", durationMs: 200 },
    { ...common, id: "t2", kind: "tool", status: "completed", title: "write", toolName: "run_write", callId: "c2", durationMs: 300 },
    { ...common, id: "t3", kind: "tool", status: "completed", title: "write", toolName: "run_write", callId: "c3", durationMs: 400 },
    { ...common, id: "f1", kind: "file_change", status: "completed", title: "file", path: "C:\\work\\one.docx", action: "create" },
    { ...common, id: "f2", kind: "file_change", status: "completed", title: "file", path: "C:\\work\\two.docx", action: "create" },
    { ...common, id: "s1", kind: "subtask", status: "completed", title: "Review", taskId: "sub-1", agentName: "Reviewer" },
  ],
  lastSequence: 1,
  seenDedupeKeys: [],
  protocolIssues: [],
};

const result = buildStructuredProcessPresentation(turn, "en");
assert.deepEqual(result.counts.map(({ key, count }) => [key, count]), [["operations", 3], ["files", 2], ["approvals", 1], ["subtasks", 1], ["artifacts", 1]]);
assert.equal(result.activityGroups.length, 3, "consecutive identical actions and file changes must aggregate");
assert.equal(result.activityGroups[0].count, 3);
assert.equal(result.activityGroups[0].durationMs, 900);
assert.deepEqual(result.activityGroups[1].fileNames, ["one.docx", "two.docx"]);
assert.equal(result.progressGroups.length, 1, "repeated progress commentary must aggregate");
assert.equal(result.progressGroups[0].count, 2);
assert.equal(result.progressGroups[0].completed, 2);
assert.match(result.completionSummary, /Completed 3 actions · 2 files · 1 subtask/);

const running = buildStructuredProcessPresentation({ ...turn, status: "running", activities: [...turn.activities, { ...common, id: "t4", kind: "tool", status: "running", title: "search", toolName: "web_search", callId: "c4" }] }, "en");
assert.equal(running.completionSummary, undefined, "running work must not be described as completed");
assert.ok(running.currentActivity, "running work must expose one current activity in the status row");

const failed = buildStructuredProcessPresentation({ ...turn, activities: [...turn.activities, { ...common, id: "t4", kind: "tool", status: "error", title: "write", toolName: "run_write", callId: "c4", durationMs: 50 }] }, "en");
assert.equal(failed.activityGroups.at(-1).status, "error", "failed evidence must not merge into successful evidence");

const projectedReasoning = projectOaepAssistantItem({
  id: "reasoning-1",
  type: "reasoning",
  status: "completed",
  content: { segments: [
    { id: "analysis-1", kind: "analysis", visibility: "user", text: "Long diagnostic reasoning." },
    { id: "summary-1", kind: "summary", visibility: "user", text: "Checked the inputs and generated the document." },
  ] },
}, "run-1");
assert.equal(projectedReasoning.parts[0].summary, "Checked the inputs and generated the document.");
assert.deepEqual(projectedReasoning.parts[0].segments.map((segment) => segment.text), ["Long diagnostic reasoning."], "summary text must not duplicate detailed reasoning evidence");

console.log("Structured process presentation verified (counts, aggregation, running status and failure preservation)." );
