import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const cernDir = join(root, "release", "product-evidence", "cern-manager-deck");
const goldenDir = join(root, "release", "product-evidence", "h3-numeric-traceability");
const resultPath = join(cernDir, "packaged-presentation-action-h3-numeric-traceability-result.json");
const manifestPath = join(cernDir, "packaged-generated-manager-zh-h3-numeric-traceability.provenance.json");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const python = resolve(process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
const parser = join(repo, "cores/python/packages/drsai/src/drsai/content/pdf/presentation.py");
const fixture = JSON.parse(readFileSync(join(repo, "tests/fixtures/product/presentation-report-wlcg.json"), "utf8"));
const numericSourcePath = join(goldenDir, "numeric-source.csv");
for (const path of [resultPath, manifestPath, sourcePdf, numericSourcePath, join(goldenDir, "numeric-report.md")]) {
  assert(existsSync(path), `H3 evidence is missing: ${path}. Run npm run verify:packaged-h3-numeric-traceability first.`);
}

const sourceBytes = readFileSync(sourcePdf);
assert(createHash("sha256").update(sourceBytes).digest("hex").toUpperCase() === fixture.source.sha256, "CERN fixture SHA-256 changed");
const parsed = spawnSync(python, [parser, sourcePdf, "--format", "json"], {
  encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }, timeout: 30000, maxBuffer: 1_000_000, windowsHide: true,
});
assert(parsed.status === 0, `CERN parser failed: ${parsed.stderr || parsed.error || "unknown error"}`);
const pages = new Map(JSON.parse(parsed.stdout.replace(/^\uFEFF/, "")).pages.map((page) => [page.page, normalize(page.text)]));
const page8 = pages.get(8) || "";
const page42 = pages.get(42) || "";
const page43 = pages.get(43) || "";
const cernExpected = new Map([
  ["h3-cern-data-growth-10x", { value: numberMatch(page8, /factor of\s+(10)/i), status: "verified", calculated: 10, page: 8 }],
  ["h3-cern-minimal-4-8", { value: calculateMinimal(page42), status: "verified", calculated: 4.8, page: 42 }],
  ["h3-cern-flexible-9-6", { value: /doubling the bandwidth/i.test(page42) ? calculateMinimal(page42) * 2 : NaN, status: "verified", calculated: 9.6, page: 42 }],
  ["h3-cern-2027-50", { value: numberMatch(page43, /2027:\s*(50)%/i), status: "verified", calculated: 50, page: 43 }],
  ["h3-cern-2029-100", { value: numberMatch(page43, /2029:\s*(100)%/i), status: "unverifiable", calculated: undefined, page: 43 }],
]);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert(manifest.source.sha256 === fixture.source.sha256, "H3 manifest lost the CERN source hash");
const cernNumeric = manifest.keyConclusions.flatMap((item) => item.numericEvidence || []);
const cernAudit = auditCern(cernNumeric);
assert(cernAudit.total === 5 && cernAudit.accuracy === 1, `H3 CERN golden numeric accuracy is ${cernAudit.accuracy * 100}%, expected 100%: ${JSON.stringify(cernAudit.audited)}`);
assert(cernAudit.unverifiableExplicit, "H3 did not explicitly mark the provisional 2029 percentage as unverifiable");

const packaged = JSON.parse(readFileSync(resultPath, "utf8"));
assert(packaged.ok, "H3 packaged UI-E2E did not pass");
const ui = packaged.details?.h3NumericTraceability;
assert(ui?.cernNumeric?.length === 5 && ui.cernNumericOpens.every((item) => item.opened), "H3 CERN numeric evidence is not fully visible/openable");
const rows = parseCsv(readFileSync(numericSourcePath, "utf8"));
const expectedGolden = new Map([
  ["h3-mean", rows.reduce((sum, row) => sum + Number(row.score), 0) / rows.length],
  ["h3-ratio", rows.filter((row) => row.passed === "true").length / rows.length * 100],
  ["h3-anomalies", rows.filter((row) => row.anomaly === "true").length],
  ["h3-chart-q2", Number(rows[0].q2_output)],
]);
const golden = auditGolden(ui?.goldenNumeric || []);
assert(golden.total === 4 && golden.accuracy === 1, `H3 mean/ratio/anomaly/chart accuracy is ${golden.accuracy * 100}%, expected 100%`);
assert(golden.traceability === 1, "H3 does not trace every golden number to readable data and a calculation");

const wrongNumber = structuredClone(ui.goldenNumeric);
wrongNumber.find((item) => item.id === "h3-mean").reportedValue = 61;
const wrongNumberAudit = auditGolden(wrongNumber);
assert(wrongNumberAudit.accuracy < 1, "H3 evaluator accepted an incorrect golden mean");
const falseConfidence = structuredClone(cernNumeric);
falseConfidence.find((item) => item.id === "h3-cern-2029-100").status = "verified";
const falseConfidenceAudit = auditCern(falseConfidence);
assert(!falseConfidenceAudit.unverifiableExplicit, "H3 evaluator accepted an unverified provisional number as verified");

const api = readFileSync(join(root, "../shared/api/desktopApi.ts"), "utf8");
const background = readFileSync(join(root, "src/main/backgroundTasks.ts"), "utf8");
const generator = readFileSync(join(root, "../shared/main/managerPresentation.ts"), "utf8");
const app = readFileSync(join(root, "../shared/renderer/src/App.tsx"), "utf8");
const panel = readFileSync(join(root, "../shared/renderer/src/components/files/FilesContextPanel.tsx"), "utf8");
const styles = readFileSync(join(root, "../shared/renderer/src/styles.css"), "utf8");
const smoke = readFileSync(join(root, "src/main/e2eSmoke.ts"), "utf8");
const contracts = {
  numericEvidenceTyped: api.includes("export interface DesktopNumericEvidence") && ["reportedValue", "sourceValues", "formula", "recalculatedValue", "status"].every((field) => api.includes(`${field}:`) || api.includes(`${field}?:`)),
  numericSourceValuesTyped: api.includes("export interface DesktopNumericSourceValue") && api.includes("rawText: string"),
  numericEvidenceAttachedToConclusions: api.includes("numericEvidence?: DesktopNumericEvidence[]") && api.includes("numericEvidence: DesktopNumericEvidence[]"),
  numericEvidencePersists: background.includes("item.numericEvidence") && background.includes("numeric.sourceValues") && background.includes("status: numeric.status"),
  cernCalculationsUseSourceInputs: generator.includes("(1 + 0.1 + 0.1) × 2 × 2") && generator.includes("4.8 × 2"),
  cernProvisionalNumberFlagged: generator.includes('status: "unverifiable"') && generator.includes("date and % to be confirmed"),
  resultsCenterShowsFormulaAndStatus: app.includes('data-testid="results-numeric-evidence"') && app.includes("numeric.formula") && app.includes("无法验证 · 已标记"),
  resultsCenterOpensNumericSource: app.includes('data-testid="results-open-numeric-source"') && app.includes("openConclusionEvidence(numeric)"),
  presentationShowsNumericEvidence: panel.includes('data-testid="presentation-numeric-evidence"') && panel.includes("复算一致"),
  unverifiableHasNonColorStyle: styles.includes('[data-numeric-status="unverifiable"]') && styles.includes(".presentation-numeric-evidence.unverifiable"),
  packagedCoversCernAndFourNumericKinds: smoke.includes('scenario === "h3-numeric-traceability"') && smoke.includes("meanRatioAnomalyChartCovered") && smoke.includes("cernUnverifiableExplicitlyFlagged"),
};
const failedContracts = Object.entries(contracts).filter(([, passed]) => !passed).map(([name]) => name);
assert(failedContracts.length === 0, `H3 product contracts failed: ${failedContracts.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  fixture: { path: sourcePdf, bytes: sourceBytes.length, sha256: fixture.source.sha256 },
  cern: cernAudit,
  golden,
  negative: {
    incorrectMean: { rejected: wrongNumberAudit.accuracy < 1, accuracy: wrongNumberAudit.accuracy },
    provisionalMarkedVerified: { rejected: !falseConfidenceAudit.unverifiableExplicit },
  },
  contracts,
  contractCount: Object.keys(contracts).length,
}, null, 2));

function auditCern(items) {
  const audited = items.map((item) => {
    const expected = cernExpected.get(item.id);
    const pageText = expected ? pages.get(expected.page) || "" : "";
    const sourceReadable = Boolean(expected && item.sourceValues?.length && item.sourceValues.every((source) => compact(pageText).includes(compact(source.rawText))));
    const valueCorrect = Boolean(expected && nearlyEqual(item.reportedValue, expected.value) && (!Number.isFinite(expected.calculated) || nearlyEqual(item.recalculatedValue, expected.calculated)));
    return { id: item.id, valueCorrect, sourceReadable, statusCorrect: item.status === expected?.status, formulaVisible: Boolean(item.formula) };
  });
  return {
    total: cernExpected.size,
    accuracy: audited.filter((item) => item.valueCorrect && item.sourceReadable && item.formulaVisible).length / cernExpected.size,
    unverifiableExplicit: audited.some((item) => item.id === "h3-cern-2029-100" && item.statusCorrect),
    audited,
  };
}

function auditGolden(items) {
  const audited = items.map((item) => {
    const expected = expectedGolden.get(item.id);
    const targetReadable = basename(item.sourcePath || "") === "numeric-source.csv" && existsSync(numericSourcePath);
    const accurate = expected !== undefined && nearlyEqual(item.reportedValue, expected) && nearlyEqual(item.recalculatedValue, expected);
    const traceable = targetReadable && item.opened && item.locator && item.formula && item.sourceValues?.length > 0;
    return { id: item.id, expected, accurate, traceable };
  });
  return {
    total: expectedGolden.size,
    accuracy: audited.filter((item) => item.accurate).length / expectedGolden.size,
    traceability: audited.filter((item) => item.traceable).length / expectedGolden.size,
    audited,
  };
}

function calculateMinimal(text) {
  const combined = numberMatch(text, /estimated\s+(1)\s*tbps for cms and atlas summed/i);
  const perExperimentGbps = numberMatch(text, /(100)\s*gbps per experiment/i);
  const perExperimentTbps = perExperimentGbps / 1000;
  return (combined + perExperimentTbps * 2) * 2 * 2;
}

function numberMatch(text, pattern) {
  const value = Number(text.match(pattern)?.[1]);
  return Number.isFinite(value) ? value : NaN;
}

function parseCsv(content) {
  const [header, ...lines] = content.trim().split(/\r?\n/);
  const columns = header.split(",");
  return lines.map((line) => Object.fromEntries(line.split(",").map((value, index) => [columns[index], value])));
}

function nearlyEqual(left, right) {
  return Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Math.abs(Number(left) - Number(right)) <= 0.000001;
}

function normalize(value) {
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function compact(value) {
  return normalize(value).replace(/\s+/g, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
