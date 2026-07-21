import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const manifest = JSON.parse(readFileSync(join(repo, "tests/fixtures/product/presentation-report-wlcg.json"), "utf8"));
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const python = resolve(process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
const parser = join(repo, "cores/python/packages/drsai/src/drsai/backend/presentation_pdf.py");
const api = readFileSync(join(root, "../shared/api/desktopApi.ts"), "utf8");
const workspace = readFileSync(join(root, "../shared/main/workspaceContext.ts"), "utf8");
const panel = readFileSync(join(root, "../shared/renderer/src/components/files/FilesContextPanel.tsx"), "utf8");
const styles = readFileSync(join(root, "../shared/renderer/src/styles.css"), "utf8");
const smoke = readFileSync(join(root, "src/main/e2eSmoke.ts"), "utf8");

assert(existsSync(sourcePdf), `CERN PDF fixture is missing: ${sourcePdf}`);
assert(existsSync(python), `Acceptance Python runtime is missing: ${python}`);
const bytes = readFileSync(sourcePdf);
assert(bytes.length === manifest.source.sizeBytes, "CERN fixture size changed");
assert(createHash("sha256").update(bytes).digest("hex").toUpperCase() === manifest.source.sha256, "CERN fixture hash changed");

const parsed = spawnSync(python, [parser, sourcePdf, "--format", "json"], { encoding: "utf8", timeout: 30000, maxBuffer: 512000, windowsHide: true });
assert(parsed.status === 0, `CERN parser failed: ${parsed.stderr || parsed.error || "unknown error"}`);
const result = JSON.parse(parsed.stdout.replace(/^\uFEFF/, ""));

const factRules = [
  { id: "hl_lhc_data_factor", page: 8, pattern: /volume of data[\s\S]{0,100}factor of 10/i },
  { id: "minimal_bandwidth_tbps", page: 42, pattern: /4\.8\s*Tbps expected HL-LHC bandwidth/i },
  { id: "flexible_bandwidth_tbps", page: 42, pattern: /9\.6\s*Tbps expected HL-LHC bandwidth/i },
  { id: "dc_2027_target", page: 43, pattern: /2027:\s*50% of HL-LHC requirements/i },
  { id: "dc_2029_target", page: 43, pattern: /2029:\s*100% of HL-LHC requirements/i, uncertainty: /to be confirmed/i },
];

function evaluate(analysis) {
  const sections = [...analysis.agenda.map((item) => item.text), ...analysis.storySections.map((item) => item.title)].join("\n");
  const facts = factRules.map((rule) => {
    const item = analysis.numericHighlights.find((candidate) => rule.pattern.test(candidate.text));
    return { id: rule.id, expectedPage: rule.page, actualPage: item?.page ?? null, matched: Boolean(item && item.page === rule.page && (!rule.uncertainty || rule.uncertainty.test(item.text))) };
  });
  const mapped = [...analysis.agenda, ...analysis.storySections, ...analysis.summaryPoints, ...analysis.numericHighlights]
    .every((item) => Number.isInteger(item.page) && item.page >= 1 && item.page <= result.pageCount);
  return {
    title: analysis.title === manifest.document.title,
    sections: manifest.requiredStorySections.every((section) => sections.toLowerCase().includes(section.toLowerCase())),
    summary: analysis.summaryPoints.length >= 4 && analysis.summaryPoints.every((item) => item.page === 47),
    facts,
    numericAccuracy: facts.filter((fact) => fact.matched).length / facts.length,
    mapped,
  };
}

const semantic = evaluate(result.analysis);
assert(semantic.title, "G8 title does not match the CERN cover");
assert(semantic.sections, "G8 storyline omits a required theme");
assert(semantic.summary, "G8 conclusion summary lost page 47 mapping");
assert(semantic.numericAccuracy === 1, `G8 golden numeric accuracy is ${semantic.numericAccuracy * 100}%, expected 100%`);
assert(semantic.mapped, "G8 contains an invalid source page mapping");

const corrupted = structuredClone(result.analysis);
const minimal = corrupted.numericHighlights.find((item) => /4\.8\s*Tbps/i.test(item.text));
assert(minimal, "Negative test could not locate the 4.8 Tbps fact");
minimal.text = minimal.text.replace("4.8", "4.7");
const negative = evaluate(corrupted);
assert(negative.numericAccuracy < 1, "Independent semantic evaluator accepted a corrupted golden number");

const contracts = {
  storyContractTyped: api.includes("export interface WorkspacePresentationStory") && api.includes("WorkspacePresentationStoryQuality"),
  structureAndMappingCountsTyped: ["agendaItems", "storySections", "summaryPoints", "numericHighlights", "sourceMappedItems", "numericSourceMatches"].every((field) => api.includes(field)),
  structuredParserResultUsed: workspace.includes("extractPresentationPdf(target)") && workspace.includes("buildPresentationStory(presentation)"),
  numericItemsRecheckedAgainstSourcePage: workspace.includes("numericSourceMatches") && workspace.includes("pageByNumber.get(item.page)"),
  storylineUserPanelVisible: panel.includes('data-testid="presentation-storyline"') && panel.includes('data-testid="presentation-story-quality"'),
  themesNumbersAndSummaryVisible: ["presentation-story-sections", "presentation-story-numbers", "presentation-story-summary"].every((id) => panel.includes(id)),
  preGenerationSourcePagesClickable: panel.includes("managerPresentationResult?.sourcePath ?? selectedNode?.path") && panel.includes("data-number-page"),
  passedAndFailedStatesStyled: styles.includes('.presentation-storyline[data-quality-status="failed"]') && styles.includes(".presentation-storyline-grid"),
  packagedGoldenSemanticAssertions: smoke.includes('scenario === "g8-storyline"') && smoke.includes("goldenNumberAccuracy100") && smoke.includes("requiredThemesComplete"),
};
const failedContracts = Object.entries(contracts).filter(([, passed]) => !passed).map(([name]) => name);
assert(failedContracts.length === 0, `G8 product contracts failed: ${failedContracts.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  fixture: { path: sourcePdf, bytes: bytes.length, sha256: manifest.source.sha256 },
  semantic: { ...semantic, numericAccuracyPercent: semantic.numericAccuracy * 100 },
  negative: { corruptedFact: "4.8 Tbps -> 4.7 Tbps", rejected: negative.numericAccuracy < 1, numericAccuracyPercent: negative.numericAccuracy * 100 },
  contracts,
  contractCount: Object.keys(contracts).length,
}, null, 2));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
