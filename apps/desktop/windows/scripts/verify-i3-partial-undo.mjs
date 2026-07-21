import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultPath = join(root, "release", "product-evidence", "cern-manager-deck", "packaged-presentation-action-i3-partial-undo-result.json");
assert(existsSync(resultPath), "Run verify:packaged-i3-partial-undo before the independent verifier");

const result = JSON.parse(readFileSync(resultPath, "utf8"));
const evidence = result.details?.i3PartialUndo;
const evaluation = evaluate(evidence);
assert(result.ok === true, "Packaged I3 scenario did not pass");
assert(Object.values(result.checks ?? {}).every(Boolean), "One or more packaged I3 checks failed");
assert(evaluation.ok, `I3 independent evaluation failed: ${JSON.stringify(evaluation.metrics)}`);

const negative = {
  nineteenRoundsRejected: !evaluate({ ...evidence, rounds: evidence.rounds.slice(0, 19) }).ok,
  selectedTargetNotRestoredRejected: !evaluate({ ...evidence, rounds: evidence.rounds.map((round, index) => index === 4 ? { ...round, afterState: { ...round.afterState, selectedTargetCorrect: false } } : round) }).ok,
  unselectedTargetChangedRejected: !evaluate({ ...evidence, rounds: evidence.rounds.map((round, index) => index === 7 ? { ...round, beforeState: { ...round.beforeState, unselectedTargetUnchanged: false } } : round) }).ok,
  userContentChangedRejected: !evaluate({ ...evidence, rounds: evidence.rounds.map((round, index) => index === 11 ? { ...round, afterState: { ...round.afterState, userPreserved: false } } : round) }).ok,
  sourcePdfChangedRejected: !evaluate({ ...evidence, rounds: evidence.rounds.map((round, index) => index === 15 ? { ...round, beforeState: { ...round.beforeState, pdfPreserved: false } } : round) }).ok,
  wholeRestoreAuditRejected: !evaluate({ ...evidence, finalVersions: evidence.finalVersions.map((item) => item.versionPhase === "before" ? { ...item, lastRestoreMode: "whole" } : item) }).ok,
};
assert(Object.values(negative).every(Boolean), `I3 negative mutations were not rejected: ${JSON.stringify(negative)}`);

const shared = read("src/shared/desktopApi.ts");
const store = read("src/main/workspaceCheckpoints.ts");
const main = read("src/main/index.ts");
const ui = read("src/renderer/src/components/files/FilesContextPanel.tsx");
const e2e = read("src/main/e2eSmoke.ts");
const packageJson = read("package.json");
const contracts = {
  partialRestoreTyped: ["includePaths?: string[]", 'lastRestoreMode?: "whole" | "partial"', "lastRestoredPaths?: string[]"].every((marker) => shared.includes(marker)),
  onlySelectedEntriesMutate: store.includes("selectedPathSet") && store.includes("!selectedPathSet.has") && store.includes("!selectedPathSet &&"),
  unknownTargetsRejected: store.includes("A partial restore target is not part of this version"),
  partialAuditPersists: store.includes('lastRestoreMode: selectedPaths ? "partial" : "whole"') && store.includes("lastRestoredPaths"),
  scopedApprovalExplainsEffect: main.includes("Other version items will stay unchanged") && main.includes("includePaths?.join"),
  approvalStillRequired: main.includes('actionKind: "workspace.revert"') && main.includes("pendingWorkspaceCheckpointRestores"),
  userActionsPerEntry: ui.includes('data-testid="restore-version-entry"') && ui.includes("仅撤销") && ui.includes("Undo only"),
  uiForwardsSelectedPaths: ui.includes("restoreRollbackCheckpoint(checkpoint, includePaths)"),
  finalEffectiveVersionVisible: ui.includes('data-testid="partial-restore-status"') && ui.includes("其他修改保持不变"),
  twentyRoundCernCoverage: e2e.includes('scenario === "i3-partial-undo"') && e2e.includes("round <= 20") && e2e.includes("unselectedArtifactPreserved20Of20"),
  runtimeWrongTargetTest: e2e.includes("wrongTargetRejectedWithoutMutation") && e2e.includes("not-part-of-this-version.txt"),
  packagedCommandsRegistered: packageJson.includes('"verify:packaged-i3-partial-undo"') && packageJson.includes('"verify:i3-partial-undo"'),
};
assert(Object.values(contracts).every(Boolean), `I3 contracts failed: ${JSON.stringify(contracts)}`);

console.log(JSON.stringify({ ok: true, golden: evaluation, negative, contracts, contractCount: Object.keys(contracts).length }, null, 2));

function evaluate(input) {
  const rounds = input?.rounds ?? [];
  const before = (input?.finalVersions ?? []).find((item) => item.versionPhase === "before");
  const after = (input?.finalVersions ?? []).find((item) => item.versionPhase === "after");
  const selectedPath = input?.selectedPath;
  const metrics = {
    deterministicRoundCoverage: rounds.length === 20 && rounds.every((round, index) => round.round === index + 1 && round.beforeApproved && round.afterApproved) ? 1 : 0,
    selectedTargetAccuracy: rounds.length === 20 && rounds.every((round) => round.beforeState.selectedTargetCorrect && round.afterState.selectedTargetCorrect) ? 1 : 0,
    unselectedTargetProtection: rounds.length === 20 && rounds.every((round) => round.beforeState.unselectedTargetUnchanged && round.afterState.unselectedTargetUnchanged) ? 1 : 0,
    userContentProtection: rounds.length === 20 && rounds.every((round) => round.beforeState.userPreserved && round.afterState.userPreserved) ? 1 : 0,
    sourcePdfProtection: rounds.length === 20 && rounds.every((round) => round.beforeState.pdfPreserved && round.afterState.pdfPreserved) ? 1 : 0,
    partialAuditAccuracy: input?.finalVersions?.length === 2 && [before, after].every((item) => item?.restoreCount === 20 && item?.lastRestoreMode === "partial" && item?.lastRestoredPaths?.length === 1 && item.lastRestoredPaths[0] === selectedPath) ? 1 : 0,
    operationAuditAccuracy: before?.lastRestoreOperationId === "i3-before-20" && after?.lastRestoreOperationId === "i3-after-20" ? 1 : 0,
  };
  return { ok: Object.values(metrics).every((value) => value === 1), rounds: rounds.length, metrics };
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
