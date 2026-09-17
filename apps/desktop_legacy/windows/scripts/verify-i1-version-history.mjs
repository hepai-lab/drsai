import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = join(root, "release", "product-evidence", "cern-manager-deck");
const resultPath = join(evidenceDir, "packaged-presentation-action-i1-version-history-result.json");
const pptxPath = join(evidenceDir, "packaged-generated-manager-zh-i1-version-history.pptx");
const manifestPath = join(evidenceDir, "packaged-generated-manager-zh-i1-version-history.provenance.json");
const d4ResultPath = join(root, "release", "product-evidence", "d4-continuous-task", "packaged-d4-continuous-task-result.json");

assert(existsSync(resultPath), "Run verify:packaged-i1-version-history before the independent verifier");
assert(existsSync(pptxPath), "Packaged I1 PPTX evidence is missing");
assert(existsSync(manifestPath), "Packaged I1 provenance evidence is missing");
assert(existsSync(d4ResultPath), "Run verify:packaged-d4-continuous-task after adding I1 Agent coverage");

const result = JSON.parse(readFileSync(resultPath, "utf8"));
const d4Result = JSON.parse(readFileSync(d4ResultPath, "utf8"));
const versions = result.details?.i1VersionHistory?.persistedVersions ?? [];
const evaluation = evaluateVersions(versions);
assert(result.ok === true, "Packaged I1 scenario did not pass");
assert(Object.values(result.checks ?? {}).every(Boolean), "One or more packaged I1 checks failed");
for (const check of ["i1AgentBeforeAfterPair", "i1AgentVersionMetadata", "i1AgentNewReportInDiff", "i1AgentBeforeRestoreRemovesReport", "i1AgentAfterRestoreReturnsReport"]) {
  assert(d4Result.checks?.[check] === true, `Packaged D4 Agent I1 check failed: ${check}`);
}
assert(Object.values(evaluation.metrics).every((value) => value === 1), `I1 quality metrics failed: ${JSON.stringify(evaluation.metrics)}`);

const after = versions.find((item) => item.versionPhase === "after");
const afterPptx = after.entries.find((entry) => entry.relativePath.endsWith(".pptx"));
const afterManifest = after.entries.find((entry) => entry.relativePath.endsWith(".provenance.json"));
assert(afterPptx.fileHash === hashFile(pptxPath), "Saved after-version PPTX hash does not match packaged evidence");
assert(afterManifest.fileHash === hashFile(manifestPath), "Saved after-version provenance hash does not match packaged evidence");

const negative = {
  missingPair: !evaluateVersions(versions.filter((item) => item.versionPhase !== "before")).ok,
  duplicatePhase: !evaluateVersions(versions.map((item) => ({ ...item, versionPhase: "after" }))).ok,
  missingReason: !evaluateVersions(versions.map((item, index) => index === 0 ? { ...item, changeReason: "" } : item)).ok,
  missingStoredArtifact: !evaluateVersions(versions.map((item) => item.versionPhase === "after"
    ? { ...item, entries: item.entries.map((entry) => entry.relativePath.endsWith(".pptx") ? { ...entry, stored: false, fileHash: undefined } : entry) }
    : item)).ok,
};
assert(Object.values(negative).every(Boolean), `I1 negative mutations were not rejected: ${JSON.stringify(negative)}`);

const shared = read("../shared/api/desktopApi.ts");
const store = read("../shared/main/workspaceCheckpoints.ts");
const agent = read("../shared/main/agentRuns.ts");
const main = read("src/main/index.ts");
const ui = read("../shared/renderer/src/components/files/FilesContextPanel.tsx");
const e2e = read("src/main/e2eSmoke.ts");
const contracts = {
  typedVersionMetadata: ["automatic?: boolean", "versionGroupId?: string", "versionPhase?: \"before\" | \"after\"", "changeReason?: string", "objectLabel?: string"].every((marker) => shared.includes(marker)),
  versionCopyKeepsExtension: store.includes("versionFileName") && store.includes("versionPath"),
  explicitAbsentTargetsCaptured: store.includes("includePaths") && store.includes("mergeCheckpointCandidates"),
  agentCreatesBeforeAndAfter: agent.includes('versionPhase: "before"') && agent.includes('versionPhase: "after"') && agent.includes("recordAgentResultVersion"),
  cernCreatesBeforeAndAfter: main.includes("onOutputPlanned") && main.includes('versionGroupId = `presentation-${requestId}`') && main.includes('versionPhase: "after"'),
  automaticHistoryVisible: ui.includes('data-testid="workspace-version-history"') && ui.includes('data-testid="automatic-version-list"'),
  reasonAndObjectVisible: ui.includes("checkpoint.changeReason") && ui.includes("checkpoint.objectLabel"),
  comparisonVisible: ui.includes('data-testid="compare-version"') && ui.includes('data-testid="version-diff-preview"'),
  oldVersionOpenVisible: ui.includes('data-testid="open-version"') && ui.includes("entry.versionPath"),
  restoreVisible: ui.includes('data-testid="restore-version"') && ui.includes("restoreWorkspaceCheckpoint"),
  noManualSaveClaim: ui.includes("无需手动操作") && ui.includes("saved automatically"),
  packagedCernCoverage: e2e.includes('scenario === "i1-version-history"') && e2e.includes("beforeVersionRestores") && e2e.includes("afterVersionRestores"),
  packagedD4AgentCoverage: d4Result.ok === true && e2e.includes("i1AgentNewReportInDiff") && e2e.includes("i1AgentAfterRestoreReturnsReport"),
  negativeEvaluation: Object.values(negative).every(Boolean),
};
assert(Object.values(contracts).every(Boolean), `I1 contracts failed: ${JSON.stringify(contracts)}`);

console.log(JSON.stringify({
  ok: true,
  artifactHashes: { pptx: afterPptx.fileHash, manifest: afterManifest.fileHash },
  golden: evaluation,
  negative,
  contracts,
  contractCount: Object.keys(contracts).length,
}, null, 2));

function evaluateVersions(items) {
  const before = items.filter((item) => item.versionPhase === "before");
  const after = items.filter((item) => item.versionPhase === "after");
  const targetEntries = (item) => (item?.entries ?? []).filter((entry) => entry.relativePath.endsWith(".pptx") || entry.relativePath.endsWith(".provenance.json"));
  const metrics = {
    pairCoverage: before.length === 1 && after.length === 1 ? 1 : 0,
    groupConsistency: before[0]?.versionGroupId && before[0]?.versionGroupId === after[0]?.versionGroupId ? 1 : 0,
    sequenceAccuracy: before[0]?.versionNumber === 1 && after[0]?.versionNumber === 2 ? 1 : 0,
    metadataCoverage: items.length === 2 && items.every((item) => item.automatic && item.createdAt && item.objectLabel && item.changeReason) ? 1 : 0,
    beforeAbsenceAccuracy: targetEntries(before[0]).length === 2 && targetEntries(before[0]).every((entry) => entry.existed === false) ? 1 : 0,
    afterSnapshotCoverage: targetEntries(after[0]).length === 2 && targetEntries(after[0]).every((entry) => entry.existed && entry.stored && entry.fileHash && entry.versionPath) ? 1 : 0,
  };
  return { ok: Object.values(metrics).every((value) => value === 1), total: items.length, metrics };
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function hashFile(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
