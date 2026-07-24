import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreeFingerprint } from "./acceptanceEvidence.mjs";
import { coreStateMachineSources, coverageThresholds, integrationAdapterSources, sharedBusinessSources } from "./macosCoveragePolicy.mjs";
import { macosFeatureModules } from "./macosFeatureCatalog.mjs";
import { macosVerificationSuiteDefinition, macosVerificationSuites, macosVerificationSuiteIds } from "./macosVerificationSuites.mjs";
import { assertEvidenceFeatureCoverage } from "./platformFeatureEvidence.mjs";
import { macosIpcSource } from "./desktopIpcSource.mjs";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptRoot, "../..");
const repoRoot = resolve(desktopRoot, "../..");
const outputRoot = resolve(desktopRoot, "macos/build/acceptance");
const planPath = resolve(desktopRoot, "macos/docs/macos-full-function-development-plan.zh-CN.md");
const channelSet = (path, patterns) => {
  const source = readFileSync(resolve(desktopRoot, path), "utf8");
  const result = new Set();
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) result.add(match[1]);
  return result;
};

const modules = macosFeatureModules;

const plan = readFileSync(planPath, "utf8");
const knownLevels = new Set(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]);
const localPassedLevels = new Set(
  (process.env.OPENDRSAI_ACCEPTANCE_PASSED_LEVELS ?? "L0,L1,L2")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
for (const level of localPassedLevels) assert.ok(knownLevels.has(level), `unknown passed acceptance level: ${level}`);
const platformFeatureCoverage = new Map();
const validEvidenceFeatureCoverage = (value) => {
  try { assertEvidenceFeatureCoverage(value); return true; } catch { return false; }
};

const commit = (() => {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(); }
  catch { return "unknown"; }
})();
const dirty = (() => {
  try { return execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim().length > 0; }
  catch { return true; }
})();
const fingerprint = worktreeFingerprint(repoRoot);
const featureTestReport = (() => {
  try {
    const value = JSON.parse(readFileSync(resolve(outputRoot, "feature-test-results.json"), "utf8"));
    if (value.schemaVersion !== 1 || value.commit !== commit || value.worktreeFingerprint !== fingerprint || value.passed !== true || !Array.isArray(value.tests)) return null;
    const ids = value.tests.map((test) => test.testId);
    if (new Set(ids).size !== macosVerificationSuiteIds.size || ids.some((id) => !macosVerificationSuiteIds.has(id))) return null;
    if (value.tests.some((test) => {
      const suite = macosVerificationSuites.find((candidate) => candidate.id === test.testId);
      if (!suite || test.passed !== true || test.skipped !== false || test.exitCode !== 0 || !/^[a-f0-9]{64}$/.test(test.outputSha256)) return true;
      if (test.entryFile !== suite.entryFile || JSON.stringify(test.aspects) !== JSON.stringify(suite.aspects)) return true;
      const definitionSha256 = createHash("sha256").update(JSON.stringify(macosVerificationSuiteDefinition(suite))).digest("hex");
      const entrySourceSha256 = createHash("sha256").update(readFileSync(resolve(desktopRoot, "macos", suite.entryFile))).digest("hex");
      return test.definitionSha256 !== definitionSha256 || test.entrySourceSha256 !== entrySourceSha256;
    })) return null;
    return value;
  } catch { return null; }
})();
const featureTestResults = new Map((featureTestReport?.tests ?? []).map((test) => [test.testId, test]));
const suiteById = new Map(macosVerificationSuites.map((suite) => [suite.id, suite]));
const coverageEvidence = (() => {
  try {
    const value = JSON.parse(readFileSync(resolve(outputRoot, "coverage/shared-business-summary.json"), "utf8"));
    if (value.schemaVersion !== 1 || value.commit !== commit || value.worktreeFingerprint !== fingerprint || value.passed !== true) return null;
    if (value.thresholds?.sharedBusinessLines !== coverageThresholds.sharedBusinessLines || value.thresholds?.coreStateMachineBranches !== coverageThresholds.coreStateMachineBranches || value.thresholds?.integrationAdapterLines !== coverageThresholds.integrationAdapterLines) return null;
    if (value.scopes?.sharedBusiness?.files !== sharedBusinessSources.length || value.scopes?.coreStateMachines?.files !== coreStateMachineSources.length || value.scopes?.integrationAdapters?.files !== integrationAdapterSources.length) return null;
    if (JSON.stringify(value.scopes.sharedBusiness.sources) !== JSON.stringify(sharedBusinessSources) || JSON.stringify(value.scopes.coreStateMachines.sources) !== JSON.stringify(coreStateMachineSources) || JSON.stringify(value.scopes.integrationAdapters.sources) !== JSON.stringify(integrationAdapterSources)) return null;
    if (value.scopes.sharedBusiness.summary?.lines?.pct < coverageThresholds.sharedBusinessLines || value.scopes.coreStateMachines.summary?.branches?.pct < coverageThresholds.coreStateMachineBranches || value.scopes.integrationAdapters.summary?.lines?.pct < coverageThresholds.integrationAdapterLines) return null;
    const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
    if (value.integrity?.scopeSha256 !== sha256(JSON.stringify({ sharedBusinessSources, coreStateMachineSources, integrationAdapterSources }))) return null;
    if (value.integrity?.rawCoverageSha256 !== sha256(readFileSync(resolve(outputRoot, "coverage/raw/coverage-final.json")))) return null;
    if (value.integrity?.featureTestReceiptSha256 !== sha256(readFileSync(resolve(outputRoot, "feature-test-results.json")))) return null;
    const allPolicySources = [...new Set([...sharedBusinessSources, ...integrationAdapterSources])];
    if (!value.integrity.sourceSha256 || Object.keys(value.integrity.sourceSha256).length !== allPolicySources.length) return null;
    for (const source of allPolicySources) if (value.integrity.sourceSha256[source] !== sha256(readFileSync(resolve(desktopRoot, "shared/main", source)))) return null;
    return value;
  } catch { return null; }
})();
const sourceSnapshot = (() => {
  try {
    const value = JSON.parse(readFileSync(resolve(desktopRoot, "macos/build/acceptance/source-snapshot.json"), "utf8"));
    if (value.schemaVersion !== 2 || value.commit !== commit || value.clean !== true || !Array.isArray(value.files) || !Array.isArray(value.deletedTracked) || value.deletedTracked.length !== 0) return null;
    const aggregate = createHash("sha256");
    for (const file of value.files) {
      const path = resolve(repoRoot, file.path);
      const stat = lstatSync(path);
      const kind = stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : null;
      if (!kind || kind !== file.kind || file.sourceState !== "tracked") return null;
      const bytes = kind === "symlink" ? Buffer.from(readlinkSync(path), "utf8") : readFileSync(path);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (bytes.length !== file.size || sha256 !== file.sha256) return null;
      aggregate.update(file.path).update("\0").update(kind).update("\0").update(sha256).update("\0");
    }
    return aggregate.digest("hex") === value.aggregateSha256 ? value : null;
  } catch { return null; }
})();
const macosL4Evidence = (() => {
  if (!sourceSnapshot) return null;
  try {
    const value = JSON.parse(readFileSync(resolve(desktopRoot, "macos/build/acceptance/macos-l4-evidence.json"), "utf8"));
    if (value.schemaVersion !== 2 || value.level !== "L4" || value.passed !== true || value.platform !== "darwin-arm64" || value.commit !== commit || value.sourceAggregateSha256 !== sourceSnapshot.aggregateSha256 || !validEvidenceFeatureCoverage(value)) return null;
    if (!Array.isArray(value.tests) || !["packaged-smoke", "runtime-reproducibility"].every((id) => value.tests.some((test) => test.testId === id && test.passed === true))) return null;
    for (const artifact of value.artifacts ?? []) {
      const bytes = readFileSync(resolve(desktopRoot, artifact.path));
      if (bytes.length !== artifact.size || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) return null;
    }
    localPassedLevels.add("L4");
    platformFeatureCoverage.set("L4", new Set(value.featureIds));
    return value;
  } catch { return null; }
})();
let previousPlatformEvidence = macosL4Evidence;
for (const [level, requiredTests] of [
  ["L5", ["packaged-core-journeys", "packaged-product-journeys", "restart-stability", "fault-injection"]],
  ["L6", ["codesign-strict", "gatekeeper", "notarization-staple", "clean-install", "signed-update-rollback", "tcc-real-device"]],
]) {
  if (!previousPlatformEvidence) break;
  try {
    const value = JSON.parse(readFileSync(resolve(desktopRoot, `macos/build/acceptance/macos-${level.toLowerCase()}-evidence.json`), "utf8"));
    const previousHash = createHash("sha256").update(JSON.stringify(previousPlatformEvidence)).digest("hex");
    if (value.schemaVersion !== 2 || value.level !== level || value.passed !== true || value.platform !== "darwin-arm64" || value.commit !== commit || value.sourceAggregateSha256 !== sourceSnapshot.aggregateSha256 || value.previousLevelEvidenceSha256 !== previousHash || !validEvidenceFeatureCoverage(value)) break;
    if (!requiredTests.every((id) => value.tests?.some((test) => test.testId === id && test.passed === true))) break;
    localPassedLevels.add(level);
    platformFeatureCoverage.set(level, new Set(value.featureIds));
    previousPlatformEvidence = value;
  } catch { break; }
}
const defectEvidence = (() => {
  try {
    const value = JSON.parse(readFileSync(resolve(desktopRoot, "macos/build/acceptance/p0-p1-defects.json"), "utf8"));
    if (value.schemaVersion === 1 && value.passed === true && value.openP0P1 === 0 && value.commit === commit && value.worktreeFingerprint === fingerprint) return value;
  } catch { /* Missing, stale or malformed evidence must not satisfy the defect gate. */ }
  return null;
})();
const rendererL3Evidence = (() => {
  try {
    const value = JSON.parse(readFileSync(resolve(desktopRoot, "macos/build/acceptance/l3-renderer.json"), "utf8"));
    if (value.schemaVersion === 1 && value.level === "L3" && value.passed === true && value.commit === commit && value.testId === "verify:renderer-l3") {
      localPassedLevels.add("L3");
      return value;
    }
  } catch { /* A missing or stale L3 report stays a missing gate. */ }
  return null;
})();
const preloadChannels = channelSet("shared/main/preload.ts", [/ipcRenderer\.invoke\(\s*["'](desktop:[^"']+)["']/g]);
const windowsChannels = channelSet("windows/src/main/index.ts", [/secureHandle\(\s*["'](desktop:[^"']+)["']/g, /ipcMain\.handle\(\s*["'](desktop:[^"']+)["']/g]);
const macosChannels = (() => {
  const source = macosIpcSource(desktopRoot); const result = new Set();
  for (const pattern of [/secureHandle\(\s*["'](desktop:[^"']+)["']/g, /ipcMain\.handle\(\s*["'](desktop:[^"']+)["']/g]) for (const match of source.matchAll(pattern)) result.add(match[1]);
  return result;
})();
const missingOnMacos = [...preloadChannels].filter((channel) => !macosChannels.has(channel)).sort();
const missingOnWindows = [...preloadChannels].filter((channel) => !windowsChannels.has(channel)).sort();
assert.deepEqual(missingOnMacos, [], "acceptance report found preload IPC missing on macOS");
assert.deepEqual(missingOnWindows, [], "acceptance report found preload IPC missing on Windows");

const features = [];
for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex += 1) {
  const module = modules[moduleIndex];
  const { title, requiredLevels } = module;
  const moduleId = `MOD-${String(moduleIndex + 1).padStart(2, "0")}`;
  assert.equal(module.features.length, 6, `${moduleId} must contain exactly six requirements`);
  for (let featureIndex = 0; featureIndex < module.features.length; featureIndex += 1) {
    const definition = module.features[featureIndex];
    const featureId = `F${String(moduleIndex + 1).padStart(2, "0")}.${featureIndex + 1}`;
    const missingLevelEvidence = requiredLevels.flatMap((level) => !localPassedLevels.has(level)
      ? [`${level.toLowerCase()}_evidence`]
      : (["L4", "L5", "L6"].includes(level) && !platformFeatureCoverage.get(level)?.has(featureId))
        ? [`${level.toLowerCase()}_feature_evidence:${featureId}`]
        : []);
    const missingTests = definition.testIds.filter((testId) => featureTestResults.get(testId)?.passed !== true);
    const implementationStatus = definition.implementationStatus ?? "implemented";
    const missingEvidence = [
      ...(implementationStatus === "implemented" ? [] : ["implementation_ready"]),
      ...(sourceSnapshot ? [] : ["clean_source_snapshot"]),
      ...(defectEvidence ? [] : ["p0_p1_defect_report"]),
      ...(coverageEvidence ? [] : ["shared_business_coverage"]),
      ...missingTests.map((testId) => `test_result:${testId}`),
      ...missingLevelEvidence,
    ];
    features.push({
      featureId,
      moduleId,
      requirement: definition.requirement,
      owner: module.owner,
      capability: module.capability,
      implementationStatus,
      acceptanceStatus: missingEvidence.length === 0 ? "accepted" : "partial",
      testIds: definition.testIds,
      testEvidence: definition.testIds.map((testId) => {
        const result = featureTestResults.get(testId);
        return result ? {
          testId,
          aspects: result.aspects,
          entryFile: result.entryFile,
          entrySourceSha256: result.entrySourceSha256,
          definitionSha256: result.definitionSha256,
          outputSha256: result.outputSha256,
        } : { testId, missing: true };
      }),
      requiredAspects: definition.requiredAspects,
      requiredLevels,
      applicablePlatforms: requiredLevels.some((level) => ["L4", "L5", "L6"].includes(level)) ? ["macos-arm64"] : ["all"],
      evidence: [{ kind: "local-verification", commit, platform: `${process.platform}-${process.arch}`, levels: [...localPassedLevels].sort() }],
      missingEvidence,
      unresolvedP0P1: defectEvidence ? 0 : null,
    });
  }
}

assert.equal(features.length, 72, "acceptance catalog must contain exactly 72 features");
assert.equal(new Set(features.map((feature) => feature.featureId)).size, 72, "feature IDs must be unique");
for (const feature of features) {
  assert.match(feature.featureId, /^F(?:0[1-9]|1[0-2])\.[1-6]$/);
  assert.match(feature.moduleId, /^MOD-(?:0[1-9]|1[0-2])$/);
  assert.ok(plan.includes(`**${feature.featureId}**`), `${feature.featureId} is absent from the development plan`);
  assert.ok(feature.owner && feature.capability && feature.requirement);
  assert.ok(feature.testIds.length > 0, `${feature.featureId} has no test IDs`);
  const coveredAspects = new Set();
  for (const testId of feature.testIds) {
    assert.ok(macosVerificationSuiteIds.has(testId), `${feature.featureId} references unknown suite ${testId}`);
    for (const aspect of suiteById.get(testId).aspects) coveredAspects.add(aspect);
  }
  assert.ok(feature.requiredAspects.includes("positive"), `${feature.featureId} must declare a positive acceptance case`);
  for (const aspect of feature.requiredAspects) assert.ok(coveredAspects.has(aspect), `${feature.featureId} lacks ${aspect} coverage`);
  assert.ok(feature.requiredLevels.length > 0);
  assert.ok(["implemented", "in_progress", "capability_gated", "not_started"].includes(feature.implementationStatus));
  assert.ok(["accepted", "partial", "not_tested"].includes(feature.acceptanceStatus));
  if (feature.acceptanceStatus === "accepted") {
    assert.equal(feature.missingEvidence.length, 0);
    assert.equal(feature.unresolvedP0P1, 0);
    assert.ok(sourceSnapshot, "accepted evidence must bind to a clean source snapshot");
  }
}

const moduleSummaries = modules.map((module, index) => {
  const moduleId = `MOD-${String(index + 1).padStart(2, "0")}`;
  const rows = features.filter((feature) => feature.moduleId === moduleId);
  const accepted = rows.filter((feature) => feature.acceptanceStatus === "accepted").length;
  return { moduleId, title: module.title, accepted, partial: rows.filter((feature) => feature.acceptanceStatus === "partial").length, notTested: rows.filter((feature) => feature.acceptanceStatus === "not_tested").length, status: accepted === 6 ? "accepted" : "partial" };
});
const summary = {
  implemented: features.filter((feature) => feature.implementationStatus === "implemented").length,
  capabilityGated: features.filter((feature) => feature.implementationStatus === "capability_gated").length,
  accepted: features.filter((feature) => feature.acceptanceStatus === "accepted").length,
  partial: features.filter((feature) => feature.acceptanceStatus === "partial").length,
  notTested: features.filter((feature) => feature.acceptanceStatus === "not_tested").length,
};
const buildMetadata = (() => {
  try {
    const value = JSON.parse(readFileSync(resolve(desktopRoot, "macos/out/build-metadata.json"), "utf8"));
    return value.commit === commit && Array.isArray(value.artifacts) ? value.artifacts : [];
  } catch { return []; }
})();
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit,
  dirty,
  sourceScopeClean: Boolean(sourceSnapshot),
  platform: `${process.platform}-${process.arch}`,
  passedLevels: [...localPassedLevels].sort(),
  featureTestReceipt: featureTestReport ? { path: "build/acceptance/feature-test-results.json", testCount: featureTestReport.tests.length, worktreeFingerprint: featureTestReport.worktreeFingerprint } : null,
  coverageReceipt: coverageEvidence ? { path: "build/acceptance/coverage/shared-business-summary.json", sharedBusinessLines: coverageEvidence.scopes.sharedBusiness.summary.lines.pct, coreStateMachineBranches: coverageEvidence.scopes.coreStateMachines.summary.branches.pct, integrationAdapterLines: coverageEvidence.scopes.integrationAdapters.summary.lines.pct } : null,
  summary,
  unresolvedP0P1: defectEvidence ? 0 : null,
  inventory: { preload: preloadChannels.size, windows: windowsChannels.size, macos: macosChannels.size, missingOnMacos, missingOnWindows },
  artifacts: [...buildMetadata, ...(rendererL3Evidence ? [{ path: rendererL3Evidence.artifact, kind: "renderer-l3", testId: rendererL3Evidence.testId }] : []), ...(coverageEvidence ? [{ path: "build/acceptance/coverage/shared-business-summary.json", kind: "shared-coverage", sharedBusinessLines: coverageEvidence.scopes.sharedBusiness.summary.lines.pct, coreStateMachineBranches: coverageEvidence.scopes.coreStateMachines.summary.branches.pct, integrationAdapterLines: coverageEvidence.scopes.integrationAdapters.summary.lines.pct }] : []), ...(defectEvidence ? [{ path: "build/acceptance/p0-p1-defects.json", kind: "defect-register", openP0P1: 0 }] : []), ...(sourceSnapshot ? [{ path: "build/acceptance/source-snapshot.json", kind: "source-snapshot", sha256: sourceSnapshot.aggregateSha256 }] : []), ...(macosL4Evidence ? [{ path: "build/acceptance/macos-l4-evidence.json", kind: "macos-l4", platform: macosL4Evidence.platform }] : [])],
  modules: moduleSummaries,
  features,
};

mkdirSync(outputRoot, { recursive: true });
writeFileSync(resolve(outputRoot, "macos-feature-acceptance.json"), `${JSON.stringify(report, null, 2)}\n`);
const markdown = [
  "# macOS 功能验收报告",
  "",
  `- Commit: \`${commit}\`${dirty ? "（工作区存在未提交变更）" : ""}`,
  `- macOS 源码范围快照: ${sourceSnapshot ? `clean · \`${sourceSnapshot.aggregateSha256}\`` : "未形成 clean source snapshot，不能形成 accepted 证据"}`,
  `- 平台: \`${report.platform}\``,
  `- 已证明层级: ${report.passedLevels.join("、") || "无"}`,
  `- 汇总: accepted ${summary.accepted}/72，partial ${summary.partial}/72，not_tested ${summary.notTested}/72`,
  `- P0/P1: ${report.unresolvedP0P1 === 0 ? "0" : "缺少权威缺陷报告"}`,
  `- 覆盖率: ${coverageEvidence ? `共享业务行 ${coverageEvidence.scopes.sharedBusiness.summary.lines.pct}%，核心状态机分支 ${coverageEvidence.scopes.coreStateMachines.summary.branches.pct}%，集成 adapter 行 ${coverageEvidence.scopes.integrationAdapters.summary.lines.pct}%` : "缺少当前源码指纹的覆盖率收据"}`,
  "",
  "| 模块 | accepted | partial | not tested | 状态 |",
  "|---|---:|---:|---:|---|",
  ...moduleSummaries.map((row) => `| ${row.moduleId} ${row.title} | ${row.accepted}/6 | ${row.partial}/6 | ${row.notTested}/6 | ${row.status} |`),
  "",
  "## 缺失证据",
  "",
  ...features.map((feature) => `- ${feature.featureId}: ${feature.missingEvidence.join("、") || "无"}`),
  "",
].join("\n");
writeFileSync(resolve(outputRoot, "macos-feature-acceptance.md"), markdown);

console.log(`macOS feature acceptance catalog passed: modules=${moduleSummaries.length}, features=${features.length}.`);
console.log(`Acceptance summary: accepted=${summary.accepted}, partial=${summary.partial}, not_tested=${summary.notTested}.`);
console.log(`Reports: ${resolve(outputRoot, "macos-feature-acceptance.json")} and macos-feature-acceptance.md`);
