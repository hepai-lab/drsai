import assert from "node:assert/strict";
import type { DesktopBackgroundTask, DesktopTaskDeliverySummary } from "../../shared/api/desktopApi.ts";
import { canonicalResultProvenance, verifyResultProvenance } from "../../shared/api/resultProvenance.ts";
import { buildResultProvenance, ensureTaskArtifactProvenance } from "../../shared/main/resultProvenance.ts";

const base = {
  sourceTaskId: "background-task:agent_run:provenance",
  sourceSessionId: "session-provenance",
  sourceRunId: "run-provenance",
  inputSummary: "Summarize the reviewed materials and create a cited report.",
  attachmentLabels: ["research-notes.pdf", "measurements.csv"],
  artifactId: "artifact-provenance",
  version: 1,
  capturedAt: "2026-08-05T21:30:00.000Z",
};

const provenance = buildResultProvenance(base);
assert.equal((await verifyResultProvenance(provenance)).valid, true);
assert.equal(provenance.input.attachments.length, 2);
assert.equal(provenance.target.version, 1);
assert.match(provenance.input.digest, /^sha256:[a-f0-9]{64}$/);
assert.match(provenance.sourceDigest, /^sha256:[a-f0-9]{64}$/);
assert.doesNotMatch(canonicalResultProvenance({ ...provenance, sourceDigest: undefined } as never), /workspace|Users\\|VSProjects/i, "public provenance must not contain an absolute path");

const tampered = [
  { ...provenance, sourceTaskId: "forged-task" },
  { ...provenance, sourceSessionId: "forged-session" },
  { ...provenance, sourceRunId: "forged-run" },
  { ...provenance, input: { ...provenance.input, summary: "forged input" } },
  { ...provenance, target: { ...provenance.target, version: 2 } },
];
for (const candidate of tampered) assert.equal((await verifyResultProvenance(candidate)).valid, false);

const version2 = buildResultProvenance({ ...base, version: 2 });
assert.equal(version2.target.version, 2);
assert.notEqual(version2.target.versionId, provenance.target.versionId);
assert.notEqual(version2.sourceDigest, provenance.sourceDigest);

const summary: DesktopTaskDeliverySummary = {
  findingSummary: "Legacy result ready.",
  importance: "medium",
  importanceReason: "Migration fixture.",
  artifacts: [{ id: "legacy-artifact", label: "legacy.md", path: "C:\\private\\legacy.md", kind: "report" }],
  suggestedAction: "Review it.",
  workSummary: "Generate the legacy report.",
  coreConclusion: "Legacy results remain traceable.",
  verification: "Migration verified.",
  remainingRisks: "None.",
};
const task: DesktopBackgroundTask = {
  id: "background-task:agent_run:legacy",
  kind: "agent_run",
  source: "agent",
  title: "Legacy task",
  status: "completed",
  createdAt: base.capturedAt,
  updatedAt: base.capturedAt,
  threadId: "legacy-session",
  targetId: "legacy-run",
  message: "Done.",
  verification: "Done.",
  deliverySummary: summary,
};
const migrated = ensureTaskArtifactProvenance(task, summary).artifacts[0].provenance;
assert(migrated);
assert.equal(migrated.sourceTaskId, task.id);
assert.equal(migrated.sourceSessionId, task.threadId);
assert.equal(migrated.sourceRunId, task.targetId);
assert.equal((await verifyResultProvenance(migrated)).valid, true);
assert.doesNotMatch(JSON.stringify(migrated), /C:\\private/i, "legacy public provenance must not expose artifact paths");

console.log(JSON.stringify({
  ok: true,
  schemaVersion: provenance.schemaVersion,
  verifiedFields: ["task", "session", "run", "input", "targetVersion"],
  tamperCases: tampered.length,
  legacyBackfill: true,
  publicAbsolutePaths: 0,
}, null, 2));
