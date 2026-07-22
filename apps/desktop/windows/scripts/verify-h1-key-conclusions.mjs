import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const evidenceDir = join(root, "release", "product-evidence", "cern-manager-deck");
const goldenEvidenceDir = join(root, "release", "product-evidence", "h1-key-conclusions");
const resultPath = join(evidenceDir, "packaged-presentation-action-h1-key-conclusions-result.json");
const pptxPath = join(evidenceDir, "packaged-generated-manager-zh-h1-key-conclusions.pptx");
const manifestPath = join(evidenceDir, "packaged-generated-manager-zh-h1-key-conclusions.provenance.json");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const python = resolve(process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
const parser = join(repo, "cores/python/packages/drsai/src/drsai/backend/presentation_pdf.py");
const fixture = JSON.parse(readFileSync(join(repo, "tests/fixtures/product/presentation-report-wlcg.json"), "utf8"));

for (const path of [resultPath, pptxPath, manifestPath, sourcePdf]) {
  assert(existsSync(path), `H1 evidence is missing: ${path}. Run npm run verify:packaged-h1-key-conclusions first.`);
}
const sourceBytes = readFileSync(sourcePdf);
assert(createHash("sha256").update(sourceBytes).digest("hex").toUpperCase() === fixture.source.sha256, "CERN source PDF SHA-256 changed");
const parsed = spawnSync(python, [parser, sourcePdf, "--format", "json"], {
  encoding: "utf8",
  env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  timeout: 30000,
  maxBuffer: 1_000_000,
  windowsHide: true,
});
assert(parsed.status === 0, `CERN parser failed: ${parsed.stderr || parsed.error || "unknown error"}`);
const source = JSON.parse(parsed.stdout.replace(/^\uFEFF/, ""));
const pages = new Map(source.pages.map((page) => [page.page, page.text]));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const packaged = JSON.parse(readFileSync(resultPath, "utf8"));

assert(manifest.source.sha256 === fixture.source.sha256, "H1 manifest lost the CERN source hash");
assert(Array.isArray(manifest.keyConclusions) && manifest.keyConclusions.length === 5, "H1 manifest does not persist five key conclusions");
assert(manifest.conclusionTraceabilityRate === 1, "H1 manifest traceability rate is not 100%");
const semantic = evaluate(manifest.keyConclusions, pages);
assert(semantic.traceabilityRate === 1, `H1 independent traceability is ${semantic.traceabilityRate * 100}%, expected 100%`);
assert(semantic.sourcePathCount === 1, "H1 conclusions do not point to one stable source file");
assert(semantic.sourcePaths[0] === manifest.source.path, "H1 conclusion source path differs from the provenance source");

const ui = packaged.details?.h1KeyConclusions;
assert(packaged.ok, "H1 packaged UI-E2E did not pass");
assert(ui?.conclusions?.length === 5, "H1 UI did not expose five key conclusions");
assert(ui?.opened?.length === 5 && ui.opened.every((item) => item.opened), "H1 UI did not open every conclusion source page");
assert(packaged.checks?.everyConclusionSourceClickable, "H1 packaged result did not verify all five source actions");
const goldenTasks = ui?.goldenTasks ?? [];
assert(goldenTasks.length === 6, "H1 G1/G3/G4 golden tasks did not expose six important conclusions");
assert(goldenTasks.every((item) => item.verified && item.opened), "H1 G1/G3/G4 contains an unverified or non-clickable conclusion");
const goldenRules = new Map([
  ["h1-g1-accuracy", { file: "paper-source.md", locator: "Paragraph 3", evidence: "The intervention improved accuracy from 82% to 91%.", type: "file_paragraph" }],
  ["h1-g1-limit", { file: "paper-source.md", locator: "Paragraph 7", evidence: "The study is limited to a single institution.", type: "file_paragraph" }],
  ["h1-g3-consensus", { file: "synthesis-sources.md", locator: "Source A paragraph 4 + Source B paragraph 6", evidence: "Method X improves recall.", type: "file_paragraph" }],
  ["h1-g3-conflict", { file: "synthesis-sources.md", locator: "Source C paragraph 2", evidence: "Precision results conflict across datasets.", type: "file_paragraph" }],
  ["h1-g4-sample", { file: "latest-data.csv", locator: "latest-data.csv!A2:C2", evidence: "sample_size,100,160", type: "data_range" }],
  ["h1-g4-mean", { file: "latest-data.csv", locator: "latest-data.csv!A3:C3", evidence: "mean_score,42,47", type: "data_range" }],
]);
const goldenAudit = goldenTasks.map((item) => {
  const rule = goldenRules.get(item.id);
  const path = rule ? join(goldenEvidenceDir, rule.file) : "";
  const content = path && existsSync(path) ? readFileSync(path, "utf8") : "";
  return {
    id: item.id,
    passed: Boolean(rule
      && item.locator === rule.locator
      && item.locatorType === rule.type
      && item.evidenceText === rule.evidence
      && content.includes(rule.evidence)),
  };
});
assert(goldenAudit.length === goldenRules.size && goldenAudit.every((item) => item.passed), "H1 G1/G3/G4 independent source audit failed");

const corrupted = structuredClone(manifest.keyConclusions);
corrupted.find((item) => item.id === "minimal_bandwidth_4_8_tbps").page = 41;
const negative = evaluate(corrupted, pages);
assert(negative.traceabilityRate < 1, "Independent H1 evaluator accepted a conclusion mapped to the wrong page");

const api = readFileSync(join(root, "../shared/api/desktopApi.ts"), "utf8");
const generator = readFileSync(join(root, "src/main/managerPresentation.ts"), "utf8");
const panel = readFileSync(join(root, "../shared/renderer/src/components/files/FilesContextPanel.tsx"), "utf8");
const styles = readFileSync(join(root, "../shared/renderer/src/styles.css"), "utf8");
const smoke = readFileSync(join(root, "src/main/e2eSmoke.ts"), "utf8");
const backgroundTasks = readFileSync(join(root, "src/main/backgroundTasks.ts"), "utf8");
const contracts = {
  conclusionEvidenceTyped: api.includes("ManagerPresentationKeyConclusionEvidence") && api.includes("conclusionTraceabilityRate"),
  exactPdfLocatorTyped: api.includes('sourceType: "pdf_page"') && api.includes("evidenceText: string") && api.includes("verified: boolean"),
  evidenceBuiltFromParsedPages: generator.includes("buildKeyConclusionEvidence") && generator.includes("result.pages.map") && generator.includes("numericHighlights"),
  evidencePersistedInManifest: generator.includes("keyConclusions,") && generator.includes("conclusionTraceabilityRate,"),
  conclusionLevelUiVisible: panel.includes('data-testid="presentation-key-conclusions"') && panel.includes('data-testid="presentation-key-conclusion"'),
  sourceExcerptAndVerificationVisible: panel.includes("item.evidenceText") && panel.includes("原文已核对"),
  everyConclusionHasClickablePage: panel.includes("data-conclusion-source-page") && panel.includes("openSourcePage(item.page)"),
  passedAndFailedStatesStyled: styles.includes('.presentation-key-conclusions[data-status="failed"]') && styles.includes(".presentation-key-conclusion-actions"),
  packagedClicksEveryConclusion: smoke.includes('scenario === "h1-key-conclusions"') && smoke.includes("everyConclusionSourceClickable"),
  genericArtifactEvidenceTyped: api.includes("DesktopArtifactConclusionEvidence") && api.includes('"file_paragraph"') && api.includes('"data_range"'),
  genericEvidencePersists: backgroundTasks.includes("artifact.keyConclusions") && backgroundTasks.includes("conclusionTraceabilityRate"),
  resultsCenterShowsAndOpensEvidence: panel.includes('data-testid="presentation-key-conclusions"')
    && readFileSync(join(root, "../shared/renderer/src/App.tsx"), "utf8").includes('data-testid="results-conclusion-evidence"'),
  g1G3G4PackagedCoverage: smoke.includes("g1G3G4ConclusionTraceability100") && smoke.includes("paragraphAndDataRangeLocatorsCovered"),
};
const failedContracts = Object.entries(contracts).filter(([, passed]) => !passed).map(([name]) => name);
assert(failedContracts.length === 0, `H1 product contracts failed: ${failedContracts.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  fixture: { path: sourcePdf, bytes: sourceBytes.length, sha256: fixture.source.sha256 },
  artifact: { path: pptxPath, bytes: readFileSync(pptxPath).length },
  semantic,
  ui: { conclusions: ui.conclusions.length, opened: ui.opened.length, goldenTaskConclusions: goldenTasks.length },
  goldenTasks: { traceabilityRate: goldenAudit.filter((item) => item.passed).length / goldenRules.size, audited: goldenAudit },
  negative: { mutation: "4.8 Tbps source page 42 -> 41", rejected: negative.traceabilityRate < 1, traceabilityRate: negative.traceabilityRate },
  contracts,
  contractCount: Object.keys(contracts).length,
}, null, 2));

function evaluate(entries, pageMap) {
  const rules = new Map([
    ["hl_lhc_data_growth_10x", { page: 8, claim: /10\s*倍/, evidence: /factor\s+of\s+10/i }],
    ["minimal_bandwidth_4_8_tbps", { page: 42, claim: /4\.8\s*Tbps/i, evidence: /4\.8\s*Tbps/i }],
    ["flexible_bandwidth_9_6_tbps", { page: 42, claim: /9\.6\s*Tbps/i, evidence: /9\.6\s*Tbps/i }],
    ["data_challenge_2027_50_percent", { page: 43, claim: /2027[\s\S]*50%/, evidence: /2027[\s\S]*50%/ }],
    ["data_challenge_2029_100_percent_uncertain", { page: 43, claim: /2029[\s\S]*100%[\s\S]*待确认/, evidence: /2029[\s\S]*100%[\s\S]*to be confirmed/i }],
  ]);
  const audited = entries.map((entry) => {
    const rule = rules.get(entry.id);
    const pageText = pageMap.get(entry.page) || "";
    const exactExcerpt = Boolean(entry.evidenceText) && normalize(pageText).includes(normalize(entry.evidenceText));
    const passed = Boolean(rule
      && entry.sourceType === "pdf_page"
      && entry.page === rule.page
      && rule.claim.test(entry.conclusion)
      && rule.evidence.test(entry.evidenceText)
      && exactExcerpt
      && entry.verified);
    return { id: entry.id, page: entry.page, exactExcerpt, passed };
  });
  const sourcePaths = [...new Set(entries.map((entry) => entry.sourcePath))];
  return {
    total: rules.size,
    passed: audited.filter((item) => item.passed).length,
    traceabilityRate: audited.filter((item) => item.passed).length / rules.size,
    sourcePathCount: sourcePaths.length,
    sourcePaths,
    audited,
  };
}

function normalize(value) {
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
