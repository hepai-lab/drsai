import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultPath = join(root, "release", "product-evidence", "i4-analysis-routes", "packaged-i4-analysis-routes-result.json");
assert(existsSync(resultPath), "Run verify:packaged-i4-analysis-routes before the independent verifier");
const result = JSON.parse(readFileSync(resultPath, "utf8"));
const evaluation = evaluate(result.details);
assert(result.ok === true, "Packaged I4 scenario did not pass");
assert(Object.values(result.checks ?? {}).every(Boolean), "One or more packaged I4 checks failed");
assert(evaluation.ok, `I4 independent evaluation failed: ${JSON.stringify(evaluation.metrics)}`);

const details = result.details;
const negative = {
  missingOriginalRejected: !evaluate({ ...details, routeArtifacts: details.routeArtifacts.filter((artifact) => artifact.analysisRoute.role !== "original") }).ok,
  overwrittenPathRejected: !evaluate({ ...details, routeArtifacts: details.routeArtifacts.map((artifact) => artifact.analysisRoute.role === "alternative" ? { ...artifact, path: details.routeArtifacts.find((item) => item.analysisRoute.role === "original").path } : artifact) }).ok,
  duplicateRouteIdRejected: !evaluate({ ...details, routeArtifacts: details.routeArtifacts.map((artifact) => artifact.analysisRoute.role === "alternative" ? { ...artifact, analysisRoute: { ...artifact.analysisRoute, routeId: details.routeArtifacts.find((item) => item.analysisRoute.role === "original").analysisRoute.routeId } } : artifact) }).ok,
  sameMethodRejected: !evaluate({ ...details, routeArtifacts: details.routeArtifacts.map((artifact) => artifact.analysisRoute.role === "alternative" ? { ...artifact, analysisRoute: { ...artifact.analysisRoute, method: details.routeArtifacts.find((item) => item.analysisRoute.role === "original").analysisRoute.method } } : artifact) }).ok,
  differentInputRejected: !evaluate({ ...details, routeArtifacts: details.routeArtifacts.map((artifact) => artifact.analysisRoute.role === "alternative" ? { ...artifact, analysisRoute: { ...artifact.analysisRoute, inputFingerprint: "fnv1a-wrong" } } : artifact) }).ok,
  sourceMutationRejected: !evaluate({ ...details, hashes: { ...details.hashes, afterPdf: "sha256:changed" } }).ok,
};
assert(Object.values(negative).every(Boolean), `I4 negative mutations were not rejected: ${JSON.stringify(negative)}`);

const shared = read("src/shared/desktopApi.ts");
const tasks = read("src/main/backgroundTasks.ts");
const app = read("src/renderer/src/App.tsx");
const styles = read("src/renderer/src/styles.css");
const smoke = read("src/main/e2eSmoke.ts");
const runner = read("scripts/verify-e2e-agent-run.mjs");
const packageJson = read("package.json");
const contracts = {
  routeContractTyped: ["DesktopArtifactAnalysisRoute", "routeGroupId", "routeId", 'role: "original" | "alternative"', "inputFingerprint"].every((marker) => shared.includes(marker)),
  routePersistsAndClones: tasks.includes("normalizeAnalysisRoute") && tasks.includes("analysisRoute: { ...artifact.analysisRoute }"),
  generatedRouteBoundToArtifact: tasks.includes("buildArtifactAnalysisRoute") && tasks.includes('windows-results-center-analysis-route'),
  alternativeGetsChartQuality: tasks.includes('["windows-results-center-chart-generation", "windows-results-center-analysis-route"]'),
  userActionVisible: app.includes('data-testid="results-create-analysis-route"') && app.includes("保留结果并尝试另一路线"),
  explicitPreserveInstruction: app.includes("禁止覆盖、改名或修改现有成果") && app.includes("preserve_original: true"),
  distinctAlternativeFilename: app.includes("-anomaly-first-route.svg"),
  independentMethodsDeclared: app.includes("时间顺序趋势分析") && app.includes("异常点优先分段分析"),
  routeCardsVisibleAndOpenable: app.includes('data-testid="analysis-route-card"') && app.includes('data-testid="analysis-route-open"'),
  independentStatusVisible: app.includes("两条路线均已保留，可分别打开") && app.includes('data-testid="results-analysis-route-status"'),
  routeUiStyled: styles.includes(".results-analysis-routes") && styles.includes(".results-analysis-route-badge"),
  cernPackagedCoverage: smoke.includes("runAnalysisRoutesSmoke") && runner.includes("writeI4AnalysisRouteFixtures") && runner.includes("CERN I4 fixture SHA-256 changed"),
  sourceAndOriginalHashesChecked: smoke.includes("originalArtifactNotOverwritten") && smoke.includes("cernPdfNotChanged") && smoke.includes("cernCsvNotChanged"),
  distinctOutputChecked: smoke.includes("alternativeOutputDistinct") && runner.includes("g6AlternativeRouteSvg"),
  commandsRegistered: packageJson.includes('"verify:packaged-i4-analysis-routes"') && packageJson.includes('"verify:i4-analysis-routes"'),
};
assert(Object.values(contracts).every(Boolean), `I4 contracts failed: ${JSON.stringify(contracts)}`);

console.log(JSON.stringify({ ok: true, golden: evaluation, negative, contracts, contractCount: Object.keys(contracts).length }, null, 2));

function evaluate(input) {
  const artifacts = input?.routeArtifacts ?? [];
  const tasks = input?.routeTasks ?? [];
  const original = artifacts.find((artifact) => artifact.analysisRoute?.role === "original");
  const alternative = artifacts.find((artifact) => artifact.analysisRoute?.role === "alternative");
  const hashes = input?.hashes ?? {};
  const metrics = {
    routePairCoverage: artifacts.length === 2 && Boolean(original && alternative) ? 1 : 0,
    taskIsolation: tasks.length === 2 && new Set(tasks.map((task) => task.id)).size === 2 && tasks.every((task) => task.status === "completed") ? 1 : 0,
    artifactIsolation: Boolean(original && alternative && original.id !== alternative.id && original.path !== alternative.path) ? 1 : 0,
    routeIdentityIsolation: Boolean(original && alternative && original.analysisRoute.routeGroupId === alternative.analysisRoute.routeGroupId && original.analysisRoute.routeId !== alternative.analysisRoute.routeId) ? 1 : 0,
    sameInputDifferentMethod: Boolean(original && alternative && original.analysisRoute.sourcePath === alternative.analysisRoute.sourcePath && original.analysisRoute.inputFingerprint === alternative.analysisRoute.inputFingerprint && original.analysisRoute.method !== alternative.analysisRoute.method) ? 1 : 0,
    routeStatusAndQuality: Boolean(original && alternative && original.analysisRoute.status === "completed" && alternative.analysisRoute.status === "completed" && alternative.chartQuality?.status === "passed" && alternative.chartQuality?.mismatchCount === 0) ? 1 : 0,
    sourceAndOriginalProtection: Boolean(hashes.beforeCsv && hashes.beforeCsv === hashes.afterCsv && hashes.beforePdf === hashes.afterPdf && hashes.beforeOriginal === hashes.afterOriginal) ? 1 : 0,
    alternativeOutputDistinct: Boolean(hashes.alternative && hashes.alternative !== hashes.afterOriginal) ? 1 : 0,
  };
  return { ok: Object.values(metrics).every((value) => value === 1), metrics };
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
