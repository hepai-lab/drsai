import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const cernDir = join(root, "release", "product-evidence", "cern-manager-deck");
const goldenDir = join(root, "release", "product-evidence", "h5-consistency-check");
const resultPath = join(cernDir, "packaged-presentation-action-h5-consistency-check-result.json");
const manifestPath = join(cernDir, "packaged-generated-manager-zh-h5-consistency-check.provenance.json");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const staleReportPath = join(goldenDir, "stale-report.md");
const currentDataPath = join(goldenDir, "current-data.csv");
const python = resolve(process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
const parser = join(repo, "cores/python/packages/drsai/src/drsai/backend/presentation_pdf.py");
const fixture = JSON.parse(readFileSync(join(repo, "tests/fixtures/product/presentation-report-wlcg.json"), "utf8"));
for (const path of [resultPath, manifestPath, sourcePdf, staleReportPath, currentDataPath]) {
  assert(existsSync(path), `H5 evidence is missing: ${path}. Run npm run verify:packaged-h5-consistency-check first.`);
}

const sourceBytes = readFileSync(sourcePdf);
assert(createHash("sha256").update(sourceBytes).digest("hex").toUpperCase() === fixture.source.sha256, "CERN fixture SHA-256 changed");
const parsed = spawnSync(python, [parser, sourcePdf, "--format", "json"], {
  encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }, timeout: 30000, maxBuffer: 1_000_000, windowsHide: true,
});
assert(parsed.status === 0, `CERN parser failed: ${parsed.stderr || parsed.error || "unknown error"}`);
const pages = new Map(JSON.parse(parsed.stdout.replace(/^\uFEFF/, "")).pages.map((page) => [page.page, normalize(page.text)]));
const page42 = pages.get(42) || "";
const page43 = pages.get(43) || "";
const report = readFileSync(staleReportPath, "utf8");
const data = readFileSync(currentDataPath, "utf8");
assert(/4\.7\s*Tbps/.test(report) && /图表 Q2 数值为 20/.test(report) && /2029 年将确定完成 100%/.test(report), "H5 stale report no longer contains all three seeded errors");
assert(/minimal_bandwidth,4\.8,Tbps/.test(data) && /q2_output,18,items/.test(data), "H5 current data fixture changed");
assert(/4\.8\s*tbps expected hl-lhc bandwidth/i.test(page42), "H5 CERN p.42 no longer contains the 4.8 Tbps source value");
assert(/2029:\s*100%[\s\S]*date and % to be confirmed/i.test(page43), "H5 CERN p.43 no longer marks 2029 as provisional");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert(manifest.source.sha256 === fixture.source.sha256, "H5 manifest lost the CERN source hash");
const packaged = JSON.parse(readFileSync(resultPath, "utf8"));
assert(packaged.ok, "H5 packaged UI-E2E did not pass");
const ui = packaged.details?.h5ConsistencyCheck;
assert(ui?.cernPassed === true, "H5 correct CERN artifact did not pass consistency checking");

const expected = new Map([
  ["h5-outdated-bandwidth", { category: "outdated_number", observed: "4.7 Tbps", expected: "4.8 Tbps", file: fixture.source.filename, locator: "p.42", source: page42, evidence: "4.8Tbps expected HL-LHC bandwidth" }],
  ["h5-chart-q2", { category: "chart_mismatch", observed: "20", expected: "18", file: "current-data.csv", locator: "current-data.csv!A3:C3", source: normalize(data), evidence: "q2_output,18,items" }],
  ["h5-2029-certainty", { category: "source_mismatch", observed: "2029 年确定完成 100%", expected: "2029 年暂以 100% 为目标，日期和比例待确认", file: fixture.source.filename, locator: "p.43", source: page43, evidence: "2029: 100% of HL-LHC requirements (date and % to be confirmed)" }],
]);
const golden = evaluate(ui?.issues || []);
assert(golden.detectionRate === 1, `H5 detected ${golden.detected}/${golden.expected} seeded errors`);
assert(golden.sourceAccuracy === 1, "H5 issue evidence or expected correction does not match source data");
assert(golden.recommendationCoverage === 1, "H5 did not explain every correction recommendation");
assert(golden.actionCoverage === 1 && golden.accepted === 2 && golden.ignored === 1, "H5 accept/ignore actions were not both exercised");

const missingIssue = structuredClone(ui.issues).slice(0, 2);
assert(evaluate(missingIssue).detectionRate < 1, "H5 evaluator accepted a result that missed one seeded error");
const wrongCorrection = structuredClone(ui.issues);
wrongCorrection.find((item) => item.id === "h5-chart-q2").expectedValue = "19";
assert(evaluate(wrongCorrection).sourceAccuracy < 1, "H5 evaluator accepted a wrong correction value");
const noRecommendation = structuredClone(ui.issues);
noRecommendation[0].recommendation = "";
assert(evaluate(noRecommendation).recommendationCoverage < 1, "H5 evaluator accepted an issue without a recommendation");

const api = readFileSync(join(root, "src/shared/desktopApi.ts"), "utf8");
const background = readFileSync(join(root, "src/main/backgroundTasks.ts"), "utf8");
const generator = readFileSync(join(root, "src/main/managerPresentation.ts"), "utf8");
const app = readFileSync(join(root, "src/renderer/src/App.tsx"), "utf8");
const styles = readFileSync(join(root, "src/renderer/src/styles.css"), "utf8");
const smoke = readFileSync(join(root, "src/main/e2eSmoke.ts"), "utf8");
const contracts = {
  consistencyResultTyped: api.includes("export interface DesktopConsistencyCheckResult") && api.includes("expectedIssues: number") && api.includes("detectedIssues: number"),
  consistencyIssueTyped: api.includes("export interface DesktopConsistencyCheckItem") && ["observedValue", "expectedValue", "evidenceText", "recommendation"].every((field) => api.includes(`${field}: string`)),
  requiredIssueCategoriesTyped: api.includes('"outdated_number" | "chart_mismatch" | "source_mismatch"'),
  consistencyPersistsAndClones: background.includes("artifact.consistencyCheck") && background.includes("consistencyCheck.items.map"),
  correctCernArtifactGetsPassRecord: generator.includes('status: "passed"') && generator.includes("CERN 黄金数字") && generator.includes("detectedIssues: 0"),
  resultsCenterShowsIssueEvidence: app.includes('data-testid="results-consistency-issue"') && app.includes("item.evidenceText") && app.includes("item.recommendation"),
  resultsCenterOpensIssueSource: app.includes('data-testid="results-open-consistency-source"') && app.includes("openConclusionEvidence(item)"),
  acceptActionVisibleAndWorks: app.includes('data-testid="results-accept-consistency-issue"') && app.includes('"accepted"'),
  ignoreActionVisibleAndWorks: app.includes('data-testid="results-ignore-consistency-issue"') && app.includes('"ignored"'),
  issuesHaveNonColorCue: styles.includes("border-left: 4px solid #a52f3d") && styles.includes("results-consistency-check"),
  packagedCoversCernAndAllErrors: smoke.includes('scenario === "h5-consistency-check"') && smoke.includes("allSeededIssuesDetected") && smoke.includes("acceptAndIgnoreBothWork"),
};
const failedContracts = Object.entries(contracts).filter(([, passed]) => !passed).map(([name]) => name);
assert(failedContracts.length === 0, `H5 product contracts failed: ${failedContracts.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  fixture: { path: sourcePdf, bytes: sourceBytes.length, sha256: fixture.source.sha256 },
  cern: { correctArtifactPassed: ui.cernPassed, manifestSourceHashMatched: true },
  golden,
  negative: {
    missedIssue: { rejected: evaluate(missingIssue).detectionRate < 1 },
    wrongCorrection: { rejected: evaluate(wrongCorrection).sourceAccuracy < 1 },
    missingRecommendation: { rejected: evaluate(noRecommendation).recommendationCoverage < 1 },
  },
  contracts,
  contractCount: Object.keys(contracts).length,
}, null, 2));

function evaluate(issues) {
  const audited = issues.map((issue) => {
    const rule = expected.get(issue.id);
    const targetMatches = Boolean(rule && basename(issue.sourcePath || "") === rule.file && issue.locator === rule.locator);
    const evidenceMatches = Boolean(rule && normalize(rule.source).includes(normalize(issue.evidence)) && normalize(issue.evidence) === normalize(rule.evidence));
    const valuesMatch = Boolean(rule && issue.observedValue === rule.observed && issue.expectedValue === rule.expected);
    return { id: issue.id, detected: Boolean(rule && issue.category === rule.category), sourceCorrect: targetMatches && evidenceMatches && valuesMatch, hasRecommendation: Boolean(issue.recommendation?.trim()), action: issue.decision };
  });
  return {
    expected: expected.size,
    detected: audited.filter((item) => item.detected).length,
    detectionRate: audited.filter((item) => item.detected).length / expected.size,
    sourceAccuracy: audited.filter((item) => item.sourceCorrect).length / expected.size,
    recommendationCoverage: audited.filter((item) => item.hasRecommendation).length / expected.size,
    actionCoverage: audited.filter((item) => ["accepted", "ignored"].includes(item.action)).length / expected.size,
    accepted: audited.filter((item) => item.action === "accepted").length,
    ignored: audited.filter((item) => item.action === "ignored").length,
    audited,
  };
}

function normalize(value) {
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
