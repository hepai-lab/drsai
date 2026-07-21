import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultPath = join(root, "release", "product-evidence", "i5-route-comparison", "packaged-i5-route-comparison-result.json");
const i1ResultPath = join(root, "release", "product-evidence", "cern-manager-deck", "packaged-presentation-action-i1-version-history-result.json");
assert(existsSync(resultPath), "Run verify:packaged-i5-route-comparison before the independent verifier");
assert(existsSync(i1ResultPath), "Run the packaged I1 version-history scenario before I5 verification");
const result = JSON.parse(readFileSync(resultPath, "utf8"));
const i1Result = JSON.parse(readFileSync(i1ResultPath, "utf8"));
const evaluation = evaluate(result.details, i1Result);
assert(result.ok === true && Object.values(result.checks ?? {}).every(Boolean), "Packaged I5 scenario did not pass");
assert(evaluation.ok, `I5 independent evaluation failed: ${JSON.stringify(evaluation.metrics)}`);

const details = result.details;
const original = details.routeArtifacts.find((artifact) => artifact.analysisRoute.role === "original");
const alternative = details.routeArtifacts.find((artifact) => artifact.analysisRoute.role === "alternative");
const negative = {
  missingComparisonFieldRejected: !evaluate({ ...details, routeComparison: { ...details.routeComparison, fields: details.routeComparison.fields.filter((field) => field !== "risk") } }, i1Result).ok,
  unmappedRouteRejected: !evaluate({ ...details, routeComparison: { ...details.routeComparison, routeIds: [original.analysisRoute.routeId] } }, i1Result).ok,
  sameConclusionRejected: !evaluate({ ...details, routeArtifacts: details.routeArtifacts.map((artifact) => artifact.analysisRoute.role === "alternative" ? { ...artifact, analysisRoute: { ...artifact.analysisRoute, keyConclusion: original.analysisRoute.keyConclusion } } : artifact) }, i1Result).ok,
  missingRiskRejected: !evaluate({ ...details, routeArtifacts: details.routeArtifacts.map((artifact) => artifact.analysisRoute.role === "alternative" ? { ...artifact, analysisRoute: { ...artifact.analysisRoute, risk: "" } } : artifact) }, i1Result).ok,
  noSelectedVersionRejected: !evaluate({ ...details, routeComparison: { ...details.routeComparison, selectedRouteCount: 0, selectedRole: undefined } }, i1Result).ok,
  contextlessQuestionRejected: !evaluate({ ...details, routeComparison: { ...details.routeComparison, questionText: "请继续" } }, i1Result).ok,
  failedReportVersionComparisonRejected: !evaluate(details, { ...i1Result, checks: { ...i1Result.checks, currentVersionComparisonWorks: false } }).ok,
};
assert(Object.values(negative).every(Boolean), `I5 negative mutations were not rejected: ${JSON.stringify(negative)}`);

const shared = read("src/shared/desktopApi.ts");
const tasks = read("src/main/backgroundTasks.ts");
const app = read("src/renderer/src/App.tsx");
const files = read("src/renderer/src/components/files/FilesContextPanel.tsx");
const styles = read("src/renderer/src/styles.css");
const smoke = read("src/main/e2eSmoke.ts");
const runner = read("scripts/verify-e2e-agent-run.mjs");
const packageJson = read("package.json");
const contracts = {
  comparisonFieldsTyped: ["inputSummary: string", "keyConclusion: string", "risk: string", "recommendedUse: string", "selected: boolean", "selectedAt?: string"].every((marker) => shared.includes(marker)),
  generatedFieldsRequired: ["route_input_summary", "route_key_conclusion", "route_risk", "route_recommended_use"].every((marker) => tasks.includes(marker)),
  fieldsNormalizedAndPersisted: ["Analysis route input summary is required", "Analysis route key conclusion is required", "Analysis route risk is required", "Analysis route recommended use is required"].every((marker) => tasks.includes(marker)),
  dataDrivenInsights: app.includes("buildAnalysisRouteInsights") && app.includes("baselineAverage") && app.includes("sourcePreview?.content"),
  sixFieldComparisonVisible: app.includes('data-testid="analysis-route-comparison"') && ["method", "input", "conclusion", "artifact", "risk", "recommendedUse"].every((marker) => app.includes(`[\"${marker}\"`)),
  differencesMapToRoute: app.includes('data-testid="analysis-route-comparison-value"') && app.includes("data-route-id={route.routeId}") && app.includes("data-route-role={route.role}"),
  resultCanBeLocated: app.includes('field === "artifact"') && app.includes("定位成果") && app.includes("openArtifact(routeArtifact)"),
  routeSelectionPersists: app.includes("selectAnalysisRoute") && app.includes("selectedAt") && app.includes('data-testid="analysis-route-select"'),
  routeQuestionAction: app.includes('data-testid="analysis-route-continue"') && app.includes("onContinueQuestion"),
  reportVersionComparison: files.includes('data-testid="compare-version"') && files.includes('data-testid="version-diff-preview"') && files.includes("data-checkpoint-id={preview.checkpointId}"),
  reportVersionChoice: files.includes('data-testid="restore-version"') && files.includes('data-testid="open-version"'),
  reportVersionQuestionAction: files.includes('data-testid="continue-version-question"') && files.includes("onContinueQuestion(checkpoint)"),
  comparisonResponsive: styles.includes(".results-analysis-comparison") && styles.includes('data-testid="analysis-route-comparison-row"'),
  packagedRuntimeCoverage: smoke.includes("comparisonScenario") && smoke.includes("selectionPersistedExactlyOnce") && runner.includes("assertI5RouteComparisonDiagnostics"),
  commandsRegistered: packageJson.includes('"verify:packaged-i5-route-comparison"') && packageJson.includes('"verify:i5-route-comparison"'),
};
assert(Object.values(contracts).every(Boolean), `I5 contracts failed: ${JSON.stringify(contracts)}`);

console.log(JSON.stringify({ ok: true, golden: evaluation, negative, contracts, contractCount: Object.keys(contracts).length }, null, 2));

function evaluate(input, versionResult) {
  const artifacts = input?.routeArtifacts ?? [];
  const comparison = input?.routeComparison ?? {};
  const original = artifacts.find((artifact) => artifact.analysisRoute?.role === "original");
  const alternative = artifacts.find((artifact) => artifact.analysisRoute?.role === "alternative");
  const requiredFields = ["method", "input", "conclusion", "artifact", "risk", "recommendedUse"];
  const structured = original && alternative ? [original.analysisRoute, alternative.analysisRoute] : [];
  const metrics = {
    comparisonFieldCoverage: requiredFields.every((field) => comparison.fields?.includes(field)) && comparison.fields?.length === requiredFields.length ? 1 : 0,
    routeLocationCoverage: comparison.routeIds?.length === 2 && new Set(comparison.routeIds).size === 2 && structured.every((route) => comparison.routeIds.includes(route.routeId)) ? 1 : 0,
    structuredMetadataCoverage: structured.length === 2 && structured.every((route) => [route.method, route.inputSummary, route.keyConclusion, route.risk, route.recommendedUse].every((value) => typeof value === "string" && value.trim())) ? 1 : 0,
    sameInputAccuracy: structured.length === 2 && structured[0].inputSummary === structured[1].inputSummary && structured[0].inputFingerprint === structured[1].inputFingerprint ? 1 : 0,
    meaningfulDifferenceCoverage: structured.length === 2 && original.path !== alternative.path && structured[0].method !== structured[1].method && structured[0].keyConclusion !== structured[1].keyConclusion && structured[0].risk !== structured[1].risk && structured[0].recommendedUse !== structured[1].recommendedUse ? 1 : 0,
    singleSelectionAccuracy: comparison.selectedRouteCount === 1 && ["original", "alternative"].includes(comparison.selectedRole) ? 1 : 0,
    contextualQuestionAccuracy: typeof comparison.questionText === "string" && /异常点优先|Anomaly-first/.test(comparison.questionText) && comparison.questionText.includes("9.6") && /风险|risk/i.test(comparison.questionText) && comparison.questionText.includes(alternative?.path || "missing") ? 1 : 0,
    reportVersionComparisonCoverage: versionResult?.ok === true && versionResult.checks?.automaticBeforeAfterPairCreated === true && versionResult.checks?.currentVersionComparisonWorks === true && versionResult.checks?.oldVersionOpens === true && versionResult.checks?.beforeVersionRestores === true && versionResult.checks?.afterVersionRestores === true && versionResult.checks?.versionQuestionAvailableForBothVersions === true && versionResult.checks?.versionQuestionCarriesContext === true ? 1 : 0,
  };
  return { ok: Object.values(metrics).every((value) => value === 1), metrics };
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
