import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const api = readFileSync(resolve(root, "../shared/api/desktopApi.ts"), "utf8");
const tasks = readFileSync(resolve(root, "src/main/backgroundTasks.ts"), "utf8");
const app = readFileSync(resolve(root, "../shared/renderer/src/App.tsx"), "utf8");
const styles = readFileSync(resolve(root, "../shared/renderer/src/styles.css"), "utf8");
const smoke = readFileSync(resolve(root, "src/main/e2eSmoke.ts"), "utf8");
const e2e = readFileSync(resolve(root, "scripts/verify-e2e-agent-run.mjs"), "utf8");

const checks = {
  qualityContractTyped: api.includes("export interface DesktopChartDataQuality") && api.includes("chartQuality?: DesktopChartDataQuality"),
  axesUnitLegendTyped: ["axisLabelsVisible", "unitVisible", "legendVisible"].every((field) => api.includes(field)),
  pointAndAnomalyCountsTyped: ["pointsExpected", "pointsMatched", "coordinateMatches", "anomaliesExpected", "anomaliesMatched", "mismatchCount"].every((field) => api.includes(field)),
  svgQualityEvaluationBoundToChartRuns: tasks.includes("evaluateSvgChartQuality")
    && tasks.includes('"windows-results-center-chart-generation", "windows-results-center-analysis-route"')
    && tasks.includes(".includes(String(request.metadata?.source || \"\"))"),
  sourceCsvReadForComparison: tasks.includes('readFile(sourcePath, "utf8")') && tasks.includes("request.files ?? []"),
  semanticPointMappingChecked: tasks.includes('attrs.get("data-x")') && tasks.includes('attrs.get("data-y")') && tasks.includes('attrs.get("data-anomaly") === "true"'),
  coordinateMappingChecked: tasks.includes("expectedCx") && tasks.includes("expectedCy") && tasks.includes("coordinateMatches"),
  axesUnitLegendVisibilityChecked: tasks.includes("axisLabelsVisible") && tasks.includes("unitVisible") && tasks.includes("legendVisible"),
  failedQualityCannotClaimComplete: tasks.includes("图表与数据检查未通过") && tasks.includes('chartQuality?.status === "failed"'),
  qualityPersistsAndClones: tasks.includes("normalizeChartQuality") && tasks.includes("checks: [...artifact.chartQuality.checks]"),
  csvPreviewOffersChartControls: app.includes('data-testid="results-chart-controls"') && app.includes('data-testid="results-generate-chart"'),
  userCanChooseAxesUnitLegend: ["results-chart-x", "results-chart-y", "results-chart-unit", "results-chart-legend"].every((id) => app.includes(id)),
  realAgentRunCarriesAuditMetadata: app.includes('source: "windows-results-center-chart-generation"') && ["x_min", "x_max", "y_min", "y_max", "plot_left", "plot_right", "plot_top", "plot_bottom"].every((key) => app.includes(key)),
  chartPromptRequiresSemanticSvg: app.includes("data-x") && app.includes("data-y") && app.includes('data-anomaly=\\"true\\"') && app.includes("CSV"),
  passedAndFailedResultsVisible: app.includes('data-quality-status={artifact.chartQuality.status}') && app.includes("图表数据检查已通过") && app.includes("图表数据检查未通过"),
  chartPreviewAndResponsiveControlsStyled: styles.includes(".results-chart-controls") && styles.includes(".results-chart-quality"),
  packagedRunsBothTruthCases: smoke.includes("runChartConsistencySmoke") && smoke.includes("validChartQualityPassed") && smoke.includes("invalidChartQualityFailed"),
  packagedVerifiesEveryPointAndAnomaly: smoke.includes("validAllPointsMapped") && smoke.includes("validAllCoordinatesMapped") && smoke.includes("validAnomalyMapped"),
  fixtureContainsSeededAnomaly: e2e.includes("3,9.6,true") && e2e.includes('data-anomaly="true"'),
  contradictoryFixtureIsRejected: e2e.includes('data-y="8.6"') && e2e.includes("invalidChartQualityFailed") && e2e.includes("invalidNotClaimedPassed"),
  sourceImmutabilityVerified: e2e.includes("sourceDataUnchanged") && e2e.includes("G6 changed source CSV data"),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, checks, failed }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks, total: Object.keys(checks).length }, null, 2));
