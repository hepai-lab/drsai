import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultPath = join(root, "release", "product-evidence", "cern-manager-deck", "packaged-presentation-action-i2-whole-undo-result.json");
assert(existsSync(resultPath), "Run verify:packaged-i2-whole-undo before the independent verifier");

const result = JSON.parse(readFileSync(resultPath, "utf8"));
const evidence = result.details?.i2WholeUndo;
const evaluation = evaluate(evidence);
assert(result.ok === true, "Packaged I2 scenario did not pass");
assert(Object.values(result.checks ?? {}).every(Boolean), "One or more packaged I2 checks failed");
assert(evaluation.ok, `I2 independent evaluation failed: ${JSON.stringify(evaluation.metrics)}`);

const negative = {
  nineteenRoundsRejected: !evaluate({ ...evidence, rounds: evidence.rounds.slice(0, 19) }).ok,
  targetNotRestoredRejected: !evaluate({ ...evidence, rounds: evidence.rounds.map((round, index) => index === 7 ? { ...round, afterState: { ...round.afterState, targetStateCorrect: false } } : round) }).ok,
  userContentChangedRejected: !evaluate({ ...evidence, rounds: evidence.rounds.map((round, index) => index === 11 ? { ...round, beforeState: { ...round.beforeState, userPreserved: false } } : round) }).ok,
  sourcePdfChangedRejected: !evaluate({ ...evidence, rounds: evidence.rounds.map((round, index) => index === 15 ? { ...round, afterState: { ...round.afterState, pdfPreserved: false } } : round) }).ok,
  auditCountMismatchRejected: !evaluate({ ...evidence, finalVersions: evidence.finalVersions.map((item) => item.versionPhase === "before" ? { ...item, restoreCount: 19 } : item) }).ok,
};
assert(Object.values(negative).every(Boolean), `I2 negative mutations were not rejected: ${JSON.stringify(negative)}`);

const shared = read("../shared/api/desktopApi.ts");
const store = read("../shared/main/workspaceCheckpoints.ts");
const main = read("src/main/index.ts");
const ui = read("../shared/renderer/src/components/files/FilesContextPanel.tsx");
const e2e = read("src/main/e2eSmoke.ts");
const packageJson = read("package.json");
const contracts = {
  restoreAuditTyped: ["restoreCount?: number", "lastRestoredAt?: string", "lastRestoreOperationId?: string", "operationId?: string"].every((marker) => shared.includes(marker)),
  restoreAuditPersisted: store.includes("restoreCount: (checkpoint.restoreCount ?? 0) + 1") && store.includes("lastRestoreOperationId"),
  repeatOperationsAreUnique: main.includes("stableApprovalHash(operationId)") && main.includes("operationId,") ,
  wholeUndoActionVisible: ui.includes('data-testid="restore-version-group"') && ui.includes("整体回到修改前") && ui.includes("Undo the whole change"),
  uiCreatesUniqueOperation: ui.includes("user-version-restore-${crypto.randomUUID()}"),
  approvalStillRequired: ui.includes("restoreWorkspaceCheckpoint") && main.includes('actionKind: "workspace.revert"'),
  explicitScopeProtectsOtherFiles: store.includes('versionScope === "workspace"') && e2e.includes("onlyTargetArtifactsParticipate"),
  twentyRoundCernCoverage: e2e.includes("round <= 20") && e2e.includes("userOriginalContentPreserved20Of20") && e2e.includes("cernSourcePreserved20Of20"),
  packagedCommandRegistered: packageJson.includes('"verify:packaged-i2-whole-undo"') && packageJson.includes('"verify:i2-whole-undo"'),
  negativeEvaluation: Object.values(negative).every(Boolean),
};
assert(Object.values(contracts).every(Boolean), `I2 contracts failed: ${JSON.stringify(contracts)}`);

console.log(JSON.stringify({ ok: true, golden: evaluation, negative, contracts, contractCount: Object.keys(contracts).length }, null, 2));

function evaluate(input) {
  const rounds = input?.rounds ?? [];
  const before = (input?.finalVersions ?? []).find((item) => item.versionPhase === "before");
  const after = (input?.finalVersions ?? []).find((item) => item.versionPhase === "after");
  const metrics = {
    deterministicRoundCoverage: rounds.length === 20 && rounds.every((round, index) => round.round === index + 1 && round.beforeApproved && round.afterApproved) ? 1 : 0,
    targetRestoreAccuracy: rounds.length === 20 && rounds.every((round) => round.beforeState.targetStateCorrect && round.afterState.targetStateCorrect && round.afterState.previewChangedCount === 0) ? 1 : 0,
    userContentProtection: rounds.length === 20 && rounds.every((round) => round.beforeState.userPreserved && round.afterState.userPreserved) ? 1 : 0,
    sourcePdfProtection: rounds.length === 20 && rounds.every((round) => round.beforeState.pdfPreserved && round.afterState.pdfPreserved) ? 1 : 0,
    versionHistoryPersistence: input?.finalVersions?.length === 2 && before?.restoreCount === 20 && after?.restoreCount === 20 ? 1 : 0,
    auditOperationAccuracy: before?.lastRestoreOperationId === "i2-before-20" && after?.lastRestoreOperationId === "i2-after-20" ? 1 : 0,
  };
  return { ok: Object.values(metrics).every((value) => value === 1), rounds: rounds.length, metrics };
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
