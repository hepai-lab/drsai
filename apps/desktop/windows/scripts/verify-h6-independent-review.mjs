import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const cernDir = join(root, "release", "product-evidence", "cern-manager-deck");
const resultPath = join(cernDir, "packaged-presentation-action-h6-independent-review-result.json");
const manifestPath = join(cernDir, "packaged-generated-manager-zh-h6-independent-review.provenance.json");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const python = resolve(process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
const parser = join(repo, "cores/python/packages/drsai/src/drsai/content/pdf/presentation.py");
const fixture = JSON.parse(readFileSync(join(repo, "tests/fixtures/product/presentation-report-wlcg.json"), "utf8"));
for (const path of [resultPath, manifestPath, sourcePdf]) {
  assert(existsSync(path), `H6 evidence is missing: ${path}. Run npm run verify:packaged-h6-independent-review first.`);
}

const sourceBytes = readFileSync(sourcePdf);
assert(createHash("sha256").update(sourceBytes).digest("hex").toUpperCase() === fixture.source.sha256, "CERN fixture SHA-256 changed");
const parsed = spawnSync(python, [parser, sourcePdf, "--format", "json"], {
  encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }, timeout: 30000, maxBuffer: 1_000_000, windowsHide: true,
});
assert(parsed.status === 0, `CERN parser failed: ${parsed.stderr || parsed.error || "unknown error"}`);
const pages = new Map(JSON.parse(parsed.stdout.replace(/^\uFEFF/, "")).pages.map((page) => [page.page, normalize(page.text)]));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert(manifest.source.sha256 === fixture.source.sha256, "H6 manifest lost the CERN source hash");
const packaged = JSON.parse(readFileSync(resultPath, "utf8"));
assert(packaged.ok, "H6 packaged UI-E2E did not pass");
const ui = packaged.details?.h6IndependentReview;
assert(Array.isArray(ui?.reviews), "H6 packaged result has no independent review records");

const fixtureFacts = new Map(fixture.goldenFacts.map((fact) => [fact.id, fact]));
const expected = new Map([
  ["hl_lhc_data_growth_10x", fixtureFacts.get("hl_lhc_data_factor")],
  ["minimal_bandwidth_4_8_tbps", fixtureFacts.get("minimal_bandwidth_tbps")],
  ["flexible_bandwidth_9_6_tbps", fixtureFacts.get("flexible_bandwidth_tbps")],
  ["data_challenge_2027_50_percent", fixtureFacts.get("dc_2027_target")],
  ["data_challenge_2029_100_percent_uncertain", fixtureFacts.get("dc_2029_target")],
]);
const golden = evaluate(ui.reviews);
assert(golden.reviewCount === 2, "H6 did not create two review records for the same CERN artifact");
assert(golden.modeCoverage === 1 && golden.methodDiversity === 1, "H6 repeat and alternative methods are not distinct");
assert(golden.factCoverage === 1 && golden.sourceAccuracy === 1, "H6 did not independently recheck all CERN golden facts against their original pages");
assert(golden.scopeCoverage === 1 && golden.uncoveredCoverage === 1, "H6 did not explain review scope or uncovered areas");
assert(golden.independenceCoverage === 1 && golden.fingerprintDiversity === 1, "H6 review records do not prove an independent method");

const duplicateMethod = structuredClone(ui.reviews);
duplicateMethod[1].method = duplicateMethod[0].method;
duplicateMethod[1].fingerprint = duplicateMethod[0].fingerprint;
assert(evaluate(duplicateMethod).methodDiversity < 1 && evaluate(duplicateMethod).fingerprintDiversity < 1, "H6 evaluator accepted duplicated review methods");
const missingUncovered = structuredClone(ui.reviews);
missingUncovered[0].uncovered = [];
assert(evaluate(missingUncovered).uncoveredCoverage < 1, "H6 evaluator accepted a review that hid uncovered areas");
const wrongPage = structuredClone(ui.reviews);
wrongPage[0].findings[0].locator = "p.7";
assert(evaluate(wrongPage).sourceAccuracy < 1, "H6 evaluator accepted a golden fact linked to the wrong CERN page");
const copiedAnswer = structuredClone(ui.reviews);
copiedAnswer[0].usesOriginalAnswerText = "true";
copiedAnswer[0].text += " CERN 黄金数字、来源页码、图表引用和不确定性措辞一致";
assert(evaluate(copiedAnswer).independenceCoverage < 1, "H6 evaluator accepted a record that reused the first answer");

const api = readFileSync(join(root, "../shared/api/desktopApi.ts"), "utf8");
const background = readFileSync(join(root, "src/main/backgroundTasks.ts"), "utf8");
const app = readFileSync(join(root, "../shared/renderer/src/App.tsx"), "utf8");
const styles = readFileSync(join(root, "../shared/renderer/src/styles.css"), "utf8");
const smoke = readFileSync(join(root, "src/main/e2eSmoke.ts"), "utf8");
const contracts = {
  reviewRecordTyped: api.includes("export interface DesktopIndependentReviewRecord") && api.includes('mode: "repeat" | "alternative"') && api.includes("usesOriginalAnswerText: false"),
  reviewFindingTyped: api.includes("export interface DesktopIndependentReviewFinding") && api.includes('outcome: "confirmed" | "issue_found" | "not_reproduced"'),
  scopeAndUncoveredRequired: api.includes("scope: string[]") && api.includes("uncovered: string[]") && api.includes("methodDifference: string"),
  recordsPersistAndClone: background.includes("artifact.independentReviews") && background.includes("review.findings.map") && background.includes("uncovered: [...review.uncovered]"),
  repeatActionVisible: app.includes('data-testid="results-repeat-review"') && app.includes('runIndependentReview(artifact, "repeat")'),
  alternativeActionVisible: app.includes('data-testid="results-alternative-review"') && app.includes('runIndependentReview(artifact, "alternative")'),
  distinctAlgorithmsImplemented: app.includes('"constraint_recalculation"') && app.includes('"reverse_source_trace"') && app.includes("不读取首次检查摘要"),
  scopeFindingsUncoveredVisible: ["results-review-scope", "results-review-findings", "results-review-uncovered"].every((id) => app.includes(`data-testid=\"${id}\"`)),
  reviewSourcesClickable: app.includes('data-testid="results-open-review-source"') && app.includes("openConclusionEvidence(finding)"),
  nonColorReviewState: styles.includes("results-independent-review.issues_found") && styles.includes("results-independent-review.inconclusive"),
  packagedCoversBothMethods: smoke.includes('scenario === "h6-independent-review"') && smoke.includes("methodsAreActuallyDifferent") && smoke.includes("reviewRecordsPersist"),
};
const failedContracts = Object.entries(contracts).filter(([, passed]) => !passed).map(([name]) => name);
assert(failedContracts.length === 0, `H6 product contracts failed: ${failedContracts.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  fixture: { path: sourcePdf, bytes: sourceBytes.length, sha256: fixture.source.sha256 },
  golden,
  negative: {
    duplicateMethod: { rejected: evaluate(duplicateMethod).methodDiversity < 1 },
    missingUncovered: { rejected: evaluate(missingUncovered).uncoveredCoverage < 1 },
    wrongPage: { rejected: evaluate(wrongPage).sourceAccuracy < 1 },
    copiedAnswer: { rejected: evaluate(copiedAnswer).independenceCoverage < 1 },
  },
  contracts,
  contractCount: Object.keys(contracts).length,
}, null, 2));

function evaluate(reviews) {
  const expectedFindingCount = expected.size * 2;
  const auditedFindings = reviews.flatMap((review) => review.findings.map((finding) => {
    const fact = expected.get(finding.id);
    const page = Number(String(finding.locator || "").match(/\d+/)?.[0]);
    const sourceCorrect = Boolean(fact
      && basename(finding.sourcePath || "") === fixture.source.filename
      && page === fact.page
      && normalize(pages.get(page) || "").includes(normalize(finding.evidence || "")));
    return { id: finding.id, sourceCorrect };
  }));
  const uniqueFactsPerReview = reviews.every((review) => new Set(review.findings.map((finding) => finding.id)).size === expected.size
    && [...expected.keys()].every((id) => review.findings.some((finding) => finding.id === id)));
  return {
    reviewCount: reviews.length,
    modeCoverage: new Set(reviews.map((review) => review.mode)).size / 2,
    methodDiversity: new Set(reviews.map((review) => review.method)).size / 2,
    fingerprintDiversity: new Set(reviews.map((review) => review.fingerprint)).size / 2,
    factCoverage: uniqueFactsPerReview && auditedFindings.length === expectedFindingCount ? 1 : auditedFindings.length / expectedFindingCount,
    sourceAccuracy: auditedFindings.filter((finding) => finding.sourceCorrect).length / expectedFindingCount,
    scopeCoverage: reviews.filter((review) => review.scope.length >= 3 && review.checkedClaims === expected.size && review.checkedSources === 3).length / 2,
    uncoveredCoverage: reviews.filter((review) => review.uncovered.length >= 2).length / 2,
    independenceCoverage: reviews.filter((review) => review.usesOriginalAnswerText === "false"
      && !review.text.includes("CERN 黄金数字、来源页码、图表引用和不确定性措辞一致")
      && review.methodDifference.length >= 20).length / 2,
    auditedFindings,
  };
}

function normalize(value) {
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
