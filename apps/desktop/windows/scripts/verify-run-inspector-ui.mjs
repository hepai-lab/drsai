import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const component = read("../shared/renderer/src/components/RunInspectorPanel.tsx");
const experiment = read("../shared/renderer/src/components/RunExperimentPanel.tsx");
const history = read("../shared/renderer/src/components/SessionRunHistory.tsx");
const experimentContract = read("../shared/api/runExperiment.ts");
const planReview = read("../shared/renderer/src/components/ReplayPlanReview.tsx");
const comparison = read("../shared/renderer/src/components/RunComparisonView.tsx");
const structured = read("../shared/renderer/src/components/StructuredMessageParts.tsx");
const chatWorkspace = read("../shared/renderer/src/components/ChatWorkspace.tsx");
const chatMain = read("../shared/main/chat.ts");
const app = read("../shared/renderer/src/App.tsx");
const navigation = read("../shared/renderer/src/navigation.ts");
const windowsMain = read("src/main/index.ts");
const styles = read("../shared/renderer/src/styles.css");
const safety = read("../shared/api/runInspectionSafety.ts");

for (const marker of [
  "run-inspector-overview",
  "run-inspector-timeline",
  "run-inspector-manifest",
  "reproducibility-badge",
  "safe_manifest_digest",
  "loadMore",
  "itemType",
  "itemStatus",
  "boundedJson",
  "Copy safe manifest",
  "Export privacy notice",
  "safe_manifest_digest",
  "locateRunItem",
  "slice(visibleStart, visibleStart + 200)",
  "event_refs",
  "Open technical diagnostics",
]) assert.ok(component.includes(marker), `Run Inspector is missing ${marker}`);

assert.match(component, /timelineCursor: inspection\.page\.next_cursor/);
assert.match(component, /timelineCursor = locator\.timeline_cursor/);
assert.doesNotMatch(component, /pages < 100/);
assert.match(component, /timeline: \[\.\.\.current\.timeline, \.\.\.next\.timeline\]/);
assert.match(component, /serialized\.length > 8_000/);
for (const secretPattern of ["const BEARER", "const COOKIE", "api[_-]?", "PRIVATE_REASONING_KEY", "WINDOWS_PRIVATE_PATH", "POSIX_PRIVATE_PATH", "[REDACTED]"]) {
  assert.ok(safety.includes(secretPattern), `Run Inspector safety contract is missing ${secretPattern}`);
}
for (const marker of ["sanitizeRunInspectionValue", "redactRunInspectionText"]) assert.ok(component.includes(marker));
for (const marker of ["sanitizeRunInspection(", "sanitizeRunReproductionManifest(", "sanitizeSessionRunList("]) assert.ok(windowsMain.includes(marker));
assert.ok(safety.includes('item.type === "reasoning"'));
assert.ok(safety.includes("segments: []"));
assert.ok(safety.includes('allowKeys(prompt, ["id", "version", "digest", "template_digest"])'));
assert.match(component, /aria-label=.*Run Inspector/);
assert.ok(!component.includes("new Blob"), "Run manifest export must use the native Save dialog");
assert.ok(windowsMain.includes('dialog.showSaveDialog'));
assert.ok(windowsMain.includes('desktop:run-manifest-export'));
assert.ok(component.includes("<RunExperimentPanel"));
for (const marker of ["onAgentRunEvent", "setInterval(refresh, 2000)", "Pause live updates", "Resume live updates", "Follow latest"]) {
  assert.ok(component.includes(marker), `Live Run Inspector is missing ${marker}`);
}
for (const marker of ["describeInspectionError", "Technical details", "Runtime safely blocked this operation", "This Run could not be found"]) {
  assert.ok(component.includes(marker), `Actionable Run error UI is missing ${marker}`);
}
for (const marker of ["listSessionRuns", "next_cursor", "dedupeRuns", "waiting_approval", "aria-current"]) {
  assert.ok(history.includes(marker), `Session Run History is missing ${marker}`);
}
for (const marker of ["run.relation_type", "Experiment replay", "Subagent", "Retry"]) {
  assert.ok(history.includes(marker), `Truthful Run relationship UI is missing ${marker}`);
}
assert.ok(!history.includes("typeof run.parent_run_id"), "Run History must not infer Replay from parent_run_id");
for (const marker of ["slice(visibleStart, visibleStart + 50)", "data-rendered-runs", "Previous window", "本会话运行历史", "加载更多"]) {
  assert.ok(history.includes(marker), `Bounded/localized Session Run History is missing ${marker}`);
}
assert.ok(
  component.includes("slice(visibleStart, visibleStart + 200)") && history.includes("slice(visibleStart, visibleStart + 50)"),
  "Inspector and History must retain at most 250 trace rows in the DOM",
);
assert.ok(component.includes("Create experiment"));
assert.ok(comparison.includes("Approve and continue"));
assert.ok(comparison.includes("comparison.candidate_snapshot"), "Comparison must expose its bound candidate snapshot");
for (const marker of ["Baseline result", "Candidate result", "Step differences", "Artifact changes", "readableResult"]) {
  assert.ok(comparison.includes(marker), `Readable Run Comparison is missing ${marker}`);
}
assert.ok(comparison.includes("decideRuntimeSecurityApproval"));

for (const marker of [
  "createRunExperiment",
  "updateRunExperiment",
  "createReplayPlan",
    "executeReplayPlan",
    "createRunComparison",
    "finalizeRunExperimentCandidate",
  "Restore originals",
  "Provider and model must be filled together",
  "Approve it in Approval Center",
]) assert.ok(experiment.includes(marker), `Run experiment UI is missing ${marker}`);
for (const marker of ["RuntimeApprovalRequired", "isApprovalRequired", "executionApprovalId", "executionApprovalKind", "decideRuntimeSecurityApproval", "decideRuntimeRunApproval", "runtimeApprovalId", "Approve and continue", "executeKey.current"]) {
  assert.ok(experiment.includes(marker), `Replay approval continuation is missing ${marker}`);
}
for (const marker of ["exportRunExperimentPackage", "Export redacted package", "integrity.digest", 'role="status"']) {
  assert.ok(experiment.includes(marker), `Redacted experiment export is missing ${marker}`);
}
assert.ok(experiment.includes('useState<ReplayMode>("rerun_from_start")'), "Safe default Replay mode is missing");
assert.ok(experimentContract.includes('default_replay_modes: ["rerun_from_start"]'));
assert.ok(experimentContract.includes('supported_override_fields: ["attachments", "input", "model"]'));
for (const unsupportedLabel of ["Temperature", "Prompt reference", "Agent reference", "Skill references", "Tool references", "Credential references"]) {
  assert.ok(!experiment.includes(unsupportedLabel), `Unsupported override must not be shown: ${unsupportedLabel}`);
}
assert.ok(experiment.includes("getRunExperimentCapabilities"), "Experiment UI must use the Runtime model catalog");
assert.ok(experiment.includes("const current = draft ?? await desktopApi.createRunExperiment"), "Experiment draft must be created lazily on save");
for (const marker of ["getRunRelations", "Restored the last saved experiment draft", "Restored the last executed experiment", "setDraft(recovered)", "deleteRunExperiment", "Discard draft", "You have unsaved edits", "View candidate Run"]) {
  assert.ok(experiment.includes(marker), `Saved experiment recovery is missing ${marker}`);
}
for (const legacyMode of ['value="fresh"', 'value="reuse_pure"', 'value="resume_checkpoint"', 'value="review_each_step"']) {
  assert.ok(!experiment.includes(legacyMode), `Legacy Replay mode must not be shown: ${legacyMode}`);
}
for (const marker of ["plan.executable", "plan.stale", "plan.blockers", "Unknown (not shown as zero)"]) {
  assert.ok(planReview.includes(marker), `Replay plan review is missing ${marker}`);
}
for (const marker of ["comparison.files", "comparison.attribution", "Automatic metrics", "missing steps are not force-aligned", "getRunAdoptionPreview", "applyRunAdoption", "discardRunAdoption", "run-adoption-dialog", "Approval Center"]) {
  assert.ok(comparison.includes(marker), `Run comparison UI is missing ${marker}`);
}
for (const marker of ["listRunComparisonEvaluations", "createRunComparisonEvaluation", "Human evaluation", "Save new evaluation revision", "Revision history", "View baseline evidence", "View candidate evidence", "metrics.delta"]) {
  assert.ok(comparison.includes(marker), `Run comparison Evaluation UI is missing ${marker}`);
}

assert.ok(structured.includes("onOpenRun?: (runId: string, itemId?: string) => void"));
assert.ok(structured.includes("onOpenRun(runId)"));
assert.ok(structured.includes("onOpenRun(runId, itemId)"));
assert.ok(structured.includes("activity.oaepItemId"));
assert.ok(!structured.includes("onOpenRun(activity.id)"));
assert.ok(structured.includes("onCreateRunExperiment(runId)"));
assert.ok(structured.includes("onCreateRunExperiment(runId, itemId)"));
assert.ok(app.includes("onCreateRunExperiment="));
assert.ok(app.includes("createExperiment: true"));
assert.ok(app.includes("detail.createExperiment === true"), "Run inspection deep links must preserve one-step experiment intent");
assert.ok(component.includes("data-run-id={inspection.run.run_id}"));
assert.ok(structured.includes("reproducibilityLevel"));
assert.ok(structured.includes("structured-reproducibility"));
assert.ok(
  chatWorkspace.includes('runId?.startsWith("run-")'),
  "Manifest hydration must reject request IDs and non-Runtime run IDs",
);
const createRuntimeRun = chatMain.indexOf("run = await client.createAgentRun(");
const bindAuthoritativeRun = chatMain.search(/runId: run\.run_id,\r?\n\s+type: "start",/);
assert.ok(createRuntimeRun >= 0, "Runtime chat must create an authoritative Run");
assert.ok(
  bindAuthoritativeRun > createRuntimeRun,
  "Renderer must only receive its Runtime Run ID after createAgentRun succeeds",
);
assert.ok(
  !/emit\(webContents, \{ requestId, sessionId, runId, type: "start" \}\);\r?\n\s+await upsertThreadFromRun/.test(chatMain),
  "Runtime chat must not publish the provisional request ID as a Runtime Run ID",
);
assert.ok(app.includes('setActiveRightTab("run")'));
assert.ok(app.includes("<RunInspectorPanel"));
assert.ok(navigation.includes('["run", "files", "browser", "terminal", "debug"]'));

for (const selector of [
  ".run-inspector-panel",
  ".run-inspector-timeline",
  ".run-inspector-item-detail pre",
  ".structured-run-inspect-link",
  ".run-experiment-overlay",
  ".replay-plan-review",
  ".run-comparison-view",
  ".comparison-metrics",
  ".comparison-evaluation",
  ".run-adoption-dialog",
]) assert.ok(styles.includes(selector), `Run Inspector stylesheet is missing ${selector}`);

console.log("Run Inspector UI contract verification passed.");
