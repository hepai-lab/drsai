import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const cernDir = join(root, "release", "product-evidence", "cern-manager-deck");
const goldenDir = join(root, "release", "product-evidence", "h7-trust-labels");
const resultPath = join(cernDir, "packaged-presentation-action-h7-trust-labels-result.json");
const manifestPath = join(cernDir, "packaged-generated-manager-zh-h7-trust-labels.provenance.json");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const uncertaintySourcePath = join(goldenDir, "uncertainty-sources.md");
const python = resolve(process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
const parser = join(repo, "cores/python/packages/drsai/src/drsai/backend/presentation_pdf.py");
const fixture = JSON.parse(readFileSync(join(repo, "tests/fixtures/product/presentation-report-wlcg.json"), "utf8"));
for (const path of [resultPath, manifestPath, sourcePdf, uncertaintySourcePath]) {
  assert(existsSync(path), `H7 evidence is missing: ${path}. Run npm run verify:packaged-h7-trust-labels first.`);
}

const sourceBytes = readFileSync(sourcePdf);
assert(createHash("sha256").update(sourceBytes).digest("hex").toUpperCase() === fixture.source.sha256, "CERN fixture SHA-256 changed");
const parsed = spawnSync(python, [parser, sourcePdf, "--format", "json"], {
  encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }, timeout: 30000, maxBuffer: 1_000_000, windowsHide: true,
});
assert(parsed.status === 0, `CERN parser failed: ${parsed.stderr || parsed.error || "unknown error"}`);
const pages = new Map(JSON.parse(parsed.stdout.replace(/^\uFEFF/, "")).pages.map((page) => [page.page, normalize(page.text)]));
const uncertaintySource = normalize(readFileSync(uncertaintySourcePath, "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert(manifest.source.sha256 === fixture.source.sha256, "H7 manifest lost the CERN source hash");
const packaged = JSON.parse(readFileSync(resultPath, "utf8"));
assert(packaged.ok, "H7 packaged UI-E2E did not pass");
const ui = packaged.details?.h7TrustLabels;
assert(Array.isArray(ui?.cards) && Array.isArray(ui?.cern), "H7 packaged result has no trust cards");

const canonical = {
  evidence_sufficient: { label: "依据充分", icon: "check", rule: "verified_source" },
  needs_confirmation: { label: "需要确认", icon: "question", rule: "provisional_source" },
  insufficient_data: { label: "数据不足", icon: "warning", rule: "insufficient_observation" },
  source_conflict: { label: "来源冲突", icon: "compare", rule: "conflicting_sources" },
  inference: { label: "属于推测", icon: "hypothesis", rule: "inference_only" },
};
const expected = new Map([
  ["h7-sufficient", { status: "evidence_sufficient", file: fixture.source.filename, locator: "p.42", source: pages.get(42) }],
  ["h7-confirmation", { status: "needs_confirmation", file: fixture.source.filename, locator: "p.43", source: pages.get(43) }],
  ["h7-conflict", { status: "source_conflict", file: "uncertainty-sources.md", locator: "Source A paragraph 3 + Source B paragraph 5", source: uncertaintySource }],
  ["h7-insufficient", { status: "insufficient_data", file: "uncertainty-sources.md", locator: "Source C paragraph 2", source: uncertaintySource }],
  ["h7-inference", { status: "inference", file: "uncertainty-sources.md", locator: "Source D paragraph 4", source: uncertaintySource }],
]);
const golden = evaluate(ui.cards);
assert(golden.statusAccuracy === 1 && golden.canonicalAccuracy === 1, "H7 labels do not match the five bottom evidence rules");
assert(golden.sourceAccuracy === 1 && golden.ruleSatisfiedCoverage === 1, "H7 trust states are not backed by the expected source evidence");
assert(golden.definitionActionCoverage === 1 && golden.accessibleNameCoverage === 1, "H7 definitions, actions, or accessible names are incomplete");
assert(golden.labelDiversity === 1 && golden.iconDiversity === 1, "H7 states do not have unique text and non-color icons");
assert(ui.cern.length === 5 && ui.cern.filter((item) => item.status === "evidence_sufficient").length === 4 && ui.cern.filter((item) => item.status === "needs_confirmation").length === 1, "H7 CERN trust labels are incorrect");

const wrongRule = structuredClone(ui.cards);
wrongRule[0].rule = "provisional_source";
assert(evaluate(wrongRule).canonicalAccuracy < 1, "H7 evaluator accepted the wrong evidence rule");
const duplicateCue = structuredClone(ui.cards);
duplicateCue[1].label = duplicateCue[0].label;
duplicateCue[1].icon = duplicateCue[0].icon;
assert(evaluate(duplicateCue).labelDiversity < 1 && evaluate(duplicateCue).iconDiversity < 1, "H7 evaluator accepted duplicated labels and icons");
const missingAction = structuredClone(ui.cards);
missingAction[0].text = missingAction[0].text.replace(/建议动作：[\s\S]*/, "");
missingAction[0].accessibleName = missingAction[0].accessibleName.replace(/建议动作：[\s\S]*/, "");
assert(evaluate(missingAction).definitionActionCoverage < 1 && evaluate(missingAction).accessibleNameCoverage < 1, "H7 evaluator accepted a label without a next action");
const evidenceMismatch = structuredClone(ui.cards);
evidenceMismatch.find((item) => item.id === "h7-conflict").status = "evidence_sufficient";
assert(evaluate(evidenceMismatch).statusAccuracy < 1, "H7 evaluator accepted a conflict marked as sufficient evidence");

const api = readFileSync(join(root, "../shared/api/desktopApi.ts"), "utf8");
const background = readFileSync(join(root, "src/main/backgroundTasks.ts"), "utf8");
const generator = readFileSync(join(root, "src/main/managerPresentation.ts"), "utf8");
const app = readFileSync(join(root, "../shared/renderer/src/App.tsx"), "utf8");
const filesPanel = readFileSync(join(root, "../shared/renderer/src/components/files/FilesContextPanel.tsx"), "utf8");
const styles = readFileSync(join(root, "../shared/renderer/src/styles.css"), "utf8");
const smoke = readFileSync(join(root, "src/main/e2eSmoke.ts"), "utf8");
const contracts = {
  fiveTrustStatesTyped: api.includes('export type DesktopTrustStatus = "evidence_sufficient" | "needs_confirmation" | "insufficient_data" | "source_conflict" | "inference"'),
  completeTrustAssessmentTyped: api.includes("export interface DesktopTrustAssessment") && ["definition", "reason", "icon", "recommendedAction", "evidenceRule", "evidenceIds", "ruleSatisfied"].every((field) => api.includes(`${field}:`)),
  canonicalLabelsEnforced: ["依据充分", "需要确认", "数据不足", "来源冲突", "属于推测"].every((label) => background.includes(label)) && background.includes("normalizeTrustAssessment"),
  trustPersistsAndClones: background.includes("item.trust") && background.includes("evidenceIds: [...item.trust.evidenceIds]"),
  cernTrustDerivedFromEvidence: generator.includes("buildCernTrustAssessment") && generator.includes('evidenceRule: "verified_source"') && generator.includes('evidenceRule: "provisional_source"'),
  resultsCardShowsDefinitionAndAction: app.includes('data-testid="results-trust-card"') && app.includes("evidence.trust.definition") && app.includes("evidence.trust.recommendedAction"),
  resultsCardAccessibleNameComplete: app.includes('aria-label={`${evidence.trust.label}。${evidence.trust.definition}。建议动作：${evidence.trust.recommendedAction}`}'),
  trustEvidenceClickable: app.includes('data-testid="results-open-trust-evidence"') && app.includes("openConclusionEvidence(evidence)"),
  presentationShowsCernTrust: filesPanel.includes('data-testid="presentation-trust-card"') && filesPanel.includes("item.trust.recommendedAction"),
  fiveNonColorStyles: ["needs_confirmation", "insufficient_data", "source_conflict", "inference"].every((status) => styles.includes(`results-trust-card.${status}`)) && styles.includes("results-trust-icon"),
  packagedCoversSemanticAndA11y: smoke.includes('scenario === "h7-trust-labels"') && smoke.includes("accessibleNamesExplainMeaningAndAction") && smoke.includes("evidenceRulesMatchStatuses"),
};
const failedContracts = Object.entries(contracts).filter(([, passed]) => !passed).map(([name]) => name);
assert(failedContracts.length === 0, `H7 product contracts failed: ${failedContracts.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  fixture: { path: sourcePdf, bytes: sourceBytes.length, sha256: fixture.source.sha256 },
  cern: ui.cern,
  golden,
  negative: {
    wrongRule: { rejected: evaluate(wrongRule).canonicalAccuracy < 1 },
    duplicateCue: { rejected: evaluate(duplicateCue).labelDiversity < 1 },
    missingAction: { rejected: evaluate(missingAction).definitionActionCoverage < 1 },
    evidenceMismatch: { rejected: evaluate(evidenceMismatch).statusAccuracy < 1 },
  },
  contracts,
  contractCount: Object.keys(contracts).length,
}, null, 2));

function evaluate(cards) {
  const audited = cards.map((card) => {
    const rule = expected.get(card.id);
    const canonicalRule = canonical[card.status];
    return {
      id: card.id,
      statusCorrect: Boolean(rule && card.status === rule.status),
      canonicalCorrect: Boolean(canonicalRule && card.label === canonicalRule.label && card.icon === canonicalRule.icon && card.rule === canonicalRule.rule),
      sourceCorrect: Boolean(rule && basename(card.sourcePath || "") === rule.file && card.locator === rule.locator && normalize(rule.source).includes(normalize(card.evidence))),
      ruleSatisfied: card.ruleSatisfied === "true" && Boolean(card.evidenceIds),
      definitionAndAction: card.text.includes(card.label) && card.text.includes("为什么：") && card.text.includes("建议动作：") && card.text.length >= 70,
      accessible: card.accessibleName.includes(card.label) && card.accessibleName.includes("建议动作：") && card.accessibleName.length >= 45,
    };
  });
  return {
    total: cards.length,
    statusAccuracy: audited.filter((item) => item.statusCorrect).length / expected.size,
    canonicalAccuracy: audited.filter((item) => item.canonicalCorrect).length / expected.size,
    sourceAccuracy: audited.filter((item) => item.sourceCorrect).length / expected.size,
    ruleSatisfiedCoverage: audited.filter((item) => item.ruleSatisfied).length / expected.size,
    definitionActionCoverage: audited.filter((item) => item.definitionAndAction).length / expected.size,
    accessibleNameCoverage: audited.filter((item) => item.accessible).length / expected.size,
    labelDiversity: new Set(cards.map((card) => card.label)).size / expected.size,
    iconDiversity: new Set(cards.map((card) => card.icon)).size / expected.size,
    audited,
  };
}

function normalize(value) {
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
