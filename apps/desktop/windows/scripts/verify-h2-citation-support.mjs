import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const cernEvidenceDir = join(root, "release", "product-evidence", "cern-manager-deck");
const goldenEvidenceDir = join(root, "release", "product-evidence", "h2-citation-support");
const resultPath = join(cernEvidenceDir, "packaged-presentation-action-h2-citation-support-result.json");
const manifestPath = join(cernEvidenceDir, "packaged-generated-manager-zh-h2-citation-support.provenance.json");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const python = resolve(process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
const parser = join(repo, "cores/python/packages/drsai/src/drsai/backend/presentation_pdf.py");
const fixture = JSON.parse(readFileSync(join(repo, "tests/fixtures/product/presentation-report-wlcg.json"), "utf8"));
for (const path of [resultPath, manifestPath, sourcePdf, join(goldenEvidenceDir, "paper-source.md"), join(goldenEvidenceDir, "synthesis-sources.md")]) {
  assert(existsSync(path), `H2 evidence is missing: ${path}. Run npm run verify:packaged-h2-citation-support first.`);
}

const sourceBytes = readFileSync(sourcePdf);
assert(createHash("sha256").update(sourceBytes).digest("hex").toUpperCase() === fixture.source.sha256, "CERN fixture SHA-256 changed");
const parsed = spawnSync(python, [parser, sourcePdf, "--format", "json"], {
  encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }, timeout: 30000, maxBuffer: 1_000_000, windowsHide: true,
});
assert(parsed.status === 0, `CERN parser failed: ${parsed.stderr || parsed.error || "unknown error"}`);
const pages = new Map(JSON.parse(parsed.stdout.replace(/^\uFEFF/, "")).pages.map((page) => [page.page, page.text]));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const packaged = JSON.parse(readFileSync(resultPath, "utf8"));
assert(manifest.source.sha256 === fixture.source.sha256, "H2 manifest lost the CERN source hash");

const cernRules = new Map([
  ["hl_lhc_data_growth_10x", 8],
  ["minimal_bandwidth_4_8_tbps", 42],
  ["flexible_bandwidth_9_6_tbps", 42],
  ["data_challenge_2027_50_percent", 43],
  ["data_challenge_2029_100_percent_uncertain", 43],
]);
const cernAudit = manifest.keyConclusions.map((item) => {
  const citation = item.citations?.[0];
  const page = cernRules.get(item.id);
  const sourceText = pages.get(page) || "";
  return {
    id: item.id,
    passed: Boolean(citation
      && citation.title === "Distributed computing for High Energy Physics"
      && citation.authors.length === 1
      && citation.authors[0] === "Edoardo Martelli"
      && citation.locator === `p.${page}`
      && citation.relation === "supports"
      && citation.supportScore >= 0.95
      && normalize(sourceText).includes(normalize(citation.excerpt))),
  };
});
assert(cernAudit.length === 5 && cernAudit.every((item) => item.passed), "H2 CERN citation metadata or support audit failed");

const ui = packaged.details?.h2CitationSupport;
assert(packaged.ok, "H2 packaged UI-E2E did not pass");
assert(ui?.cernCitations?.length === 5 && ui.cernCitationOpens.every((item) => item.opened), "H2 CERN citations are not all visible and readable");
const goldenCitations = ui?.goldenCitations ?? [];
const goldenRules = new Map([
  ["h2-cite-d1-accuracy", { file: "paper-source.md", title: "Controlled Intervention Study", authors: "Alice Chen;Bob Singh", locator: "Paragraph 3", excerpt: "The intervention improved accuracy from 82% to 91%.", conclusion: /82%[\s\S]*91%/ }],
  ["h2-cite-d1-limit", { file: "paper-source.md", title: "Controlled Intervention Study", authors: "Alice Chen;Bob Singh", locator: "Paragraph 7", excerpt: "The study is limited to a single institution.", conclusion: /单一机构/ }],
  ["h2-cite-d3-a", { file: "synthesis-sources.md", title: "Recall Improvements A", authors: "Mei Lin", locator: "Source A paragraph 4", excerpt: "Method X improves recall.", conclusion: /Method X[\s\S]*召回率/ }],
  ["h2-cite-d3-b", { file: "synthesis-sources.md", title: "Recall Improvements B", authors: "Omar Diaz", locator: "Source B paragraph 6", excerpt: "Method X improves recall.", conclusion: /Method X[\s\S]*召回率/ }],
  ["h2-cite-d3-c", { file: "synthesis-sources.md", title: "Precision Conflict Study", authors: "Priya Rao", locator: "Source C paragraph 2", excerpt: "Precision results conflict across datasets.", conclusion: /精确率[\s\S]*冲突/ }],
]);
const golden = evaluateGolden(goldenCitations);
assert(golden.total === 5 && golden.supportAccuracy === 1, `H2 support accuracy is ${golden.supportAccuracy * 100}%, expected at least 95%`);
assert(golden.fabricatedCitations === 0, `H2 has ${golden.fabricatedCitations} fabricated citations, expected 0`);
assert(golden.metadataAccuracy === 1, "H2 title/author/locator metadata accuracy is not 100%");

const fakeSource = structuredClone(goldenCitations);
fakeSource[0].sourcePath = join(goldenEvidenceDir, "imaginary-paper.md");
const fabricatedNegative = evaluateGolden(fakeSource);
assert(fabricatedNegative.fabricatedCitations === 1, "H2 evaluator accepted an imaginary citation target");
const unsupported = structuredClone(goldenCitations);
unsupported[0].excerpt = "The intervention reduced accuracy to 10%.";
const supportNegative = evaluateGolden(unsupported);
assert(supportNegative.supportAccuracy < 0.95, "H2 evaluator accepted an excerpt that does not support its conclusion");

const api = readFileSync(join(root, "../shared/api/desktopApi.ts"), "utf8");
const background = readFileSync(join(root, "src/main/backgroundTasks.ts"), "utf8");
const generator = readFileSync(join(root, "src/main/managerPresentation.ts"), "utf8");
const app = readFileSync(join(root, "../shared/renderer/src/App.tsx"), "utf8");
const panel = readFileSync(join(root, "../shared/renderer/src/components/files/FilesContextPanel.tsx"), "utf8");
const styles = readFileSync(join(root, "../shared/renderer/src/styles.css"), "utf8");
const smoke = readFileSync(join(root, "src/main/e2eSmoke.ts"), "utf8");
const contracts = {
  citationRecordTyped: api.includes("export interface DesktopCitationRecord") && ["title", "authors", "sourcePath", "locator", "excerpt", "relation", "supportScore"].every((field) => api.includes(`${field}:`)),
  multiCitationEvidenceTyped: api.includes("citations?: DesktopCitationRecord[]") && api.includes("citations: DesktopCitationRecord[]"),
  citationsPersistAndClone: background.includes("item.citations") && background.includes("citation.supportScore") && background.includes("authors: [...citation.authors]"),
  cernMetadataDerivedFromSource: generator.includes("sourceTitle") && generator.includes("sourceAuthor") && generator.includes("contact.split"),
  cernCitationBoundToExactPage: generator.includes("locator: `p.${rule.page}`") && generator.includes('relation: "supports"'),
  resultsCenterShowsCitationMetadata: app.includes('data-testid="results-citation"') && app.includes("citation.authors.join"),
  resultsCenterOpensCitationTarget: app.includes('data-testid="results-open-citation"') && app.includes("openConclusionEvidence(citation)"),
  presentationShowsCitationMetadata: panel.includes('data-testid="presentation-citation"') && panel.includes("支持结论"),
  supportStatesStyled: styles.includes(".results-citation-list") && styles.includes("#237052"),
  packagedCoversD1D3AndCern: smoke.includes('scenario === "h2-citation-support"') && smoke.includes("supportRelationAccuracy100") && smoke.includes("fabricatedCitationsZero"),
};
const failedContracts = Object.entries(contracts).filter(([, passed]) => !passed).map(([name]) => name);
assert(failedContracts.length === 0, `H2 product contracts failed: ${failedContracts.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  fixture: { path: sourcePdf, bytes: sourceBytes.length, sha256: fixture.source.sha256 },
  cern: { citations: cernAudit.length, passed: cernAudit.filter((item) => item.passed).length, audited: cernAudit },
  golden,
  negative: {
    fabricatedTarget: { rejected: fabricatedNegative.fabricatedCitations === 1, fabricatedCitations: fabricatedNegative.fabricatedCitations },
    unsupportedExcerpt: { rejected: supportNegative.supportAccuracy < 0.95, supportAccuracy: supportNegative.supportAccuracy },
  },
  contracts,
  contractCount: Object.keys(contracts).length,
}, null, 2));

function evaluateGolden(citations) {
  const audited = citations.map((citation) => {
    const rule = goldenRules.get(citation.id);
    const expectedPath = rule ? join(goldenEvidenceDir, rule.file) : "";
    const targetExists = Boolean(rule && existsSync(expectedPath) && basename(citation.sourcePath || "") === rule.file);
    const sourceText = targetExists ? readFileSync(expectedPath, "utf8") : "";
    const metadata = Boolean(rule && citation.title === rule.title && citation.authors === rule.authors && citation.locator === rule.locator);
    const excerptReadable = Boolean(rule && sourceText.includes(citation.excerpt) && citation.excerpt === rule.excerpt);
    const supports = Boolean(rule && rule.conclusion.test(citation.conclusion || "") && excerptReadable && citation.relation === "supports" && citation.score >= 0.95);
    return { id: citation.id, targetExists, metadata, excerptReadable, supports };
  });
  return {
    total: goldenRules.size,
    targetReadable: audited.filter((item) => item.targetExists && item.excerptReadable).length,
    metadataAccuracy: audited.filter((item) => item.metadata).length / goldenRules.size,
    supportAccuracy: audited.filter((item) => item.supports).length / goldenRules.size,
    fabricatedCitations: audited.filter((item) => !item.targetExists).length,
    audited,
  };
}

function normalize(value) {
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
