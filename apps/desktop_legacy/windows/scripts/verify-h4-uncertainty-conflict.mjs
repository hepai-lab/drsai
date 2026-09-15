import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const cernDir = join(root, "release", "product-evidence", "cern-manager-deck");
const goldenDir = join(root, "release", "product-evidence", "h4-uncertainty-conflict");
const resultPath = join(cernDir, "packaged-presentation-action-h4-uncertainty-conflict-result.json");
const manifestPath = join(cernDir, "packaged-generated-manager-zh-h4-uncertainty-conflict.provenance.json");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const sourceMd = join(goldenDir, "uncertainty-sources.md");
const reportMd = join(goldenDir, "uncertainty-report.md");
const python = resolve(process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
const parser = join(repo, "cores/python/packages/drsai/src/drsai/content/pdf/presentation.py");
const fixture = JSON.parse(readFileSync(join(repo, "tests/fixtures/product/presentation-report-wlcg.json"), "utf8"));
for (const path of [resultPath, manifestPath, sourcePdf, sourceMd, reportMd]) {
  assert(existsSync(path), `H4 evidence is missing: ${path}. Run npm run verify:packaged-h4-uncertainty-conflict first.`);
}

const sourceBytes = readFileSync(sourcePdf);
assert(createHash("sha256").update(sourceBytes).digest("hex").toUpperCase() === fixture.source.sha256, "CERN fixture SHA-256 changed");
const parsed = spawnSync(python, [parser, sourcePdf, "--format", "json"], {
  encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }, timeout: 30000, maxBuffer: 1_000_000, windowsHide: true,
});
assert(parsed.status === 0, `CERN parser failed: ${parsed.stderr || parsed.error || "unknown error"}`);
const page43 = normalize(JSON.parse(parsed.stdout.replace(/^\uFEFF/, "")).pages.find((page) => page.page === 43)?.text || "");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert(manifest.source.sha256 === fixture.source.sha256, "H4 manifest lost the CERN source hash");
const cernConclusion = manifest.keyConclusions.find((item) => item.id === "data_challenge_2029_100_percent_uncertain");
const cernAssessment = cernConclusion?.uncertainty;
const cernAudit = {
  status: cernAssessment?.status === "insufficient_data",
  qualificationRequired: cernAssessment?.requiresQualification === true,
  qualifiedConclusion: /暂|待确认/.test(cernConclusion?.conclusion || ""),
  exactSource: cernAssessment?.claims?.length === 1 && page43.includes(normalize(cernAssessment.claims[0].excerpt)),
  sourceMarkedInsufficient: cernAssessment?.claims?.[0]?.stance === "insufficient",
  recommendedAction: Boolean(cernAssessment?.recommendedAction),
};
assert(Object.values(cernAudit).every(Boolean), `H4 CERN uncertainty audit failed: ${JSON.stringify(cernAudit)}`);

const packaged = JSON.parse(readFileSync(resultPath, "utf8"));
assert(packaged.ok, "H4 packaged UI-E2E did not pass");
const ui = packaged.details?.h4UncertaintyConflict;
assert(ui?.cern?.status === "insufficient_data" && ui.cern.opened, "H4 CERN uncertainty is not visible and openable");
const sourceText = readFileSync(sourceMd, "utf8");
const expected = new Map([
  ["source_conflict", {
    qualifier: /来源冲突|不一致/,
    claims: new Map([
      ["h4-claim-alpha", { stance: "supports", locator: "Source A paragraph 3", excerpt: "In dataset Alpha, Method X increased precision by 12 percentage points." }],
      ["h4-claim-beta", { stance: "contradicts", locator: "Source B paragraph 5", excerpt: "In dataset Beta, Method X produced no measurable precision improvement." }],
    ]),
  }],
  ["insufficient_data", {
    qualifier: /数据不足|无法判断/,
    claims: new Map([["h4-claim-followup", { stance: "insufficient", locator: "Source C paragraph 2", excerpt: "Follow-up lasted only two weeks, insufficient to assess long-term effects." }]]),
  }],
  ["inference", {
    qualifier: /可能|推测|尚未/,
    claims: new Map([["h4-claim-mechanism", { stance: "insufficient", locator: "Source D paragraph 4", excerpt: "Biomarker levels moved after treatment, but the causal mechanism was not directly measured." }]]),
  }],
]);
const golden = evaluate(ui?.assessments || []);
assert(golden.stateAccuracy === 1, "H4 uncertainty state accuracy is not 100%");
assert(golden.sourceAccuracy === 1, "H4 conflict/insufficient/inference source accuracy is not 100%");
assert(golden.qualifiedLanguageRate === 1, "H4 rewrote an uncertain conclusion as a certain fact");
assert(golden.conflictSidesVisible, "H4 does not show both sides of the source conflict");

const certainConflict = structuredClone(ui.assessments);
certainConflict.find((item) => item.status === "source_conflict").status = "confirmed";
assert(evaluate(certainConflict).stateAccuracy < 1, "H4 evaluator accepted a source conflict as confirmed");
const unqualifiedInference = structuredClone(ui.assessments);
unqualifiedInference.find((item) => item.status === "inference").conclusion = "Method X changes the causal mechanism.";
assert(evaluate(unqualifiedInference).qualifiedLanguageRate < 1, "H4 evaluator accepted an inference rewritten as a certain fact");
const hiddenSide = structuredClone(ui.assessments);
hiddenSide.find((item) => item.status === "source_conflict").claims = hiddenSide.find((item) => item.status === "source_conflict").claims.slice(0, 1);
assert(!evaluate(hiddenSide).conflictSidesVisible, "H4 evaluator accepted a conflict with one side hidden");

const api = readFileSync(join(root, "../shared/api/desktopApi.ts"), "utf8");
const background = readFileSync(join(root, "src/main/backgroundTasks.ts"), "utf8");
const generator = readFileSync(join(root, "../shared/main/managerPresentation.ts"), "utf8");
const app = readFileSync(join(root, "../shared/renderer/src/App.tsx"), "utf8");
const panel = readFileSync(join(root, "../shared/renderer/src/components/files/FilesContextPanel.tsx"), "utf8");
const styles = readFileSync(join(root, "../shared/renderer/src/styles.css"), "utf8");
const smoke = readFileSync(join(root, "src/main/e2eSmoke.ts"), "utf8");
const contracts = {
  uncertaintyAssessmentTyped: api.includes("export interface DesktopConclusionUncertainty") && api.includes('status: "source_conflict" | "insufficient_data" | "inference"'),
  opposingClaimsTyped: api.includes("export interface DesktopUncertaintyClaim") && api.includes('stance: "supports" | "contradicts" | "insufficient"'),
  qualificationIsMandatory: api.includes("requiresQualification: true") && api.includes("qualifyingLanguage: string[]"),
  uncertaintyPersistsAndClones: background.includes("item.uncertainty") && background.includes("uncertainty.claims.map") && background.includes("qualifyingLanguage"),
  cernProvisionalPlanIsInsufficient: generator.includes('status: "insufficient_data"') && generator.includes("日期与比例待确认") && generator.includes('stance: "insufficient"'),
  resultsCenterShowsThreeStates: app.includes('data-testid="results-uncertainty-assessment"') && ["来源冲突", "数据不足", "推测"].every((label) => app.includes(label)),
  resultsCenterShowsAndOpensClaims: app.includes('data-testid="results-uncertainty-claim"') && app.includes("openConclusionEvidence(claim)"),
  recommendedActionVisible: app.includes("uncertainty.recommendedAction") && app.includes("建议动作"),
  presentationShowsUncertainty: panel.includes('data-testid="presentation-uncertainty"') && panel.includes("requiresQualification"),
  statesHaveNonColorCues: styles.includes("border-left: 4px") && styles.includes(".source_conflict") && styles.includes(".inference"),
  packagedCoversCernAndD3: smoke.includes('scenario === "h4-uncertainty-conflict"') && smoke.includes("conflictShowsBothSides") && smoke.includes("uncertainConclusionsRemainQualified"),
};
const failedContracts = Object.entries(contracts).filter(([, passed]) => !passed).map(([name]) => name);
assert(failedContracts.length === 0, `H4 product contracts failed: ${failedContracts.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  fixture: { path: sourcePdf, bytes: sourceBytes.length, sha256: fixture.source.sha256 },
  cern: cernAudit,
  golden,
  negative: {
    conflictMarkedConfirmed: { rejected: evaluate(certainConflict).stateAccuracy < 1 },
    inferenceMadeCertain: { rejected: evaluate(unqualifiedInference).qualifiedLanguageRate < 1 },
    conflictSideHidden: { rejected: !evaluate(hiddenSide).conflictSidesVisible },
  },
  contracts,
  contractCount: Object.keys(contracts).length,
}, null, 2));

function evaluate(assessments) {
  const audited = assessments.map((assessment) => {
    const rule = expected.get(assessment.status);
    const claims = assessment.claims || [];
    const claimAudit = claims.map((claim) => {
      const expectedClaim = rule?.claims.get(claim.id);
      return Boolean(expectedClaim
        && claim.stance === expectedClaim.stance
        && claim.locator === expectedClaim.locator
        && claim.excerpt === expectedClaim.excerpt
        && sourceText.includes(claim.excerpt)
        && basename(claim.sourcePath || "") === "uncertainty-sources.md"
        && claim.opened);
    });
    return {
      status: assessment.status,
      knownState: Boolean(rule),
      qualified: Boolean(rule && assessment.requiresQualification && rule.qualifier.test(assessment.conclusion || "")),
      sourcesCorrect: Boolean(rule && claims.length === rule.claims.size && claimAudit.every(Boolean)),
      claims,
    };
  });
  const conflict = audited.find((item) => item.status === "source_conflict");
  return {
    total: expected.size,
    stateAccuracy: audited.filter((item) => item.knownState).length / expected.size,
    sourceAccuracy: audited.filter((item) => item.sourcesCorrect).length / expected.size,
    qualifiedLanguageRate: audited.filter((item) => item.qualified).length / expected.size,
    conflictSidesVisible: Boolean(conflict && conflict.claims.length === 2 && conflict.claims.some((item) => item.stance === "supports") && conflict.claims.some((item) => item.stance === "contradicts")),
    audited: audited.map(({ claims, ...item }) => ({ ...item, claimCount: claims.length })),
  };
}

function normalize(value) {
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
