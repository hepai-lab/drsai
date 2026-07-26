import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const evidenceDir = join(root, "release", "product-evidence", "cern-manager-deck");
const managerPptx = join(evidenceDir, "packaged-generated-manager-zh-g11-audience-versions.pptx");
const managerManifestPath = join(evidenceDir, "packaged-generated-manager-zh-g11-audience-versions.provenance.json");
const technicalPptx = join(evidenceDir, "packaged-generated-technical-zh-g11-audience-versions.pptx");
const technicalManifestPath = join(evidenceDir, "packaged-generated-technical-zh-g11-audience-versions.provenance.json");
const python = resolve(process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
const acceptance = join(repo, "scripts/acceptance/presentation/verify_pptx.py");
const fixture = JSON.parse(readFileSync(join(repo, "tests/fixtures/product/presentation-report-wlcg.json"), "utf8"));

for (const path of [managerPptx, managerManifestPath, technicalPptx, technicalManifestPath]) {
  assert(existsSync(path), `G11 packaged evidence is missing: ${path}. Run npm run verify:packaged-g11-audience-versions first.`);
}
assert(existsSync(python), `Acceptance Python runtime is missing: ${python}`);

const managerManifest = JSON.parse(readFileSync(managerManifestPath, "utf8"));
const technicalManifest = JSON.parse(readFileSync(technicalManifestPath, "utf8"));
assert(managerManifest.audience === "non_expert_managers", "Manager manifest has the wrong audience");
assert(technicalManifest.audience === "technical_experts", "Technical manifest has the wrong audience");
assert(managerManifest.source.sha256 === fixture.source.sha256, "Manager deck lost the CERN source hash");
assert(technicalManifest.source.sha256 === fixture.source.sha256, "Technical deck lost the CERN source hash");

const manager = inspect(managerPptx, managerManifestPath);
const technical = inspect(technicalPptx, technicalManifestPath);
assert(manager.ok, `Manager PPTX structural acceptance failed: ${JSON.stringify(manager.checks)}`);
assert(technical.ok, `Technical PPTX structural acceptance failed: ${JSON.stringify(technical.checks)}`);

const managerText = manager.slideTexts.join("\n");
const technicalText = technical.slideTexts.join("\n");
const managerSemantic = evaluate(managerText);
const technicalSemantic = evaluate(technicalText);
assert(managerSemantic.goldenFactIds.length === 5, `Manager deck has ${managerSemantic.goldenFactIds.length}/5 golden facts: ${managerSemantic.goldenFactIds.join(", ")}`);
assert(JSON.stringify(managerSemantic.goldenFactIds) === JSON.stringify(technicalSemantic.goldenFactIds), "The two decks do not contain the same five core facts");
assert(managerSemantic.impactDecisionSignals > technicalSemantic.impactDecisionSignals, "Manager deck does not emphasize impact and decisions more than the technical deck");
assert(technicalSemantic.technicalDetailSignals > managerSemantic.technicalDetailSignals, "Technical deck does not preserve more network/model detail");
assert(technicalSemantic.acronymOccurrences > managerSemantic.acronymOccurrences, "Manager deck does not reduce unexplained acronyms");
assert(technicalSemantic.requiredTechnicalDetails.every((item) => item.matched), `Technical deck lost required details: ${technicalSemantic.requiredTechnicalDetails.filter((item) => !item.matched).map((item) => item.id).join(", ")}`);

const managerSha = sha256(managerPptx);
const technicalSha = sha256(technicalPptx);
assert(managerSha !== technicalSha, "The two PPTX files are byte-identical");
assert(createHash("sha256").update(managerText).digest("hex") !== createHash("sha256").update(technicalText).digest("hex"), "The two decks only differ outside their visible content");

const corrupted = technicalText.replaceAll("9.6 Tbps", "9.5 Tbps");
const negative = evaluate(corrupted);
assert(negative.goldenFactIds.length < 5, "Independent semantic evaluator accepted a corrupted 9.6 Tbps fact");

const api = readFileSync(join(root, "../shared/api/desktopApi.ts"), "utf8");
const generator = readFileSync(join(root, "../shared/main/managerPresentation.ts"), "utf8");
const tasks = readFileSync(join(root, "../shared/main/managerPresentationTasks.ts"), "utf8");
const panel = readFileSync(join(root, "../shared/renderer/src/components/files/FilesContextPanel.tsx"), "utf8");
const smoke = readFileSync(join(root, "src/main/e2eSmoke.ts"), "utf8");
const contracts = {
  audienceTypedEndToEnd: api.includes('"non_expert_managers" | "technical_experts"') && api.includes("ManagerPresentationAudienceProfile"),
  requestAndResultCarryAudience: api.includes("audience?: ManagerPresentationAudience") && api.includes("audienceProfile: ManagerPresentationAudienceProfile"),
  taskRecoveryPersistsAudience: tasks.includes("audience: request.audience") && tasks.includes("audience: task.audience"),
  generatorHasDistinctSpecifications: generator.includes("buildManagerDeckSpec") && generator.includes("buildTechnicalDeckSpec"),
  outputNamesAreDistinct: generator.includes('audience === "technical_experts" ? "technical" : "manager"') && generator.includes("-zh.pptx"),
  twoUserActionsVisible: panel.includes('data-testid="generate-manager-presentation"') && panel.includes('data-testid="generate-technical-presentation"'),
  comparisonIsUserVisible: panel.includes('data-testid="presentation-audience-comparison"') && panel.includes("compareAudienceResults"),
  packagedE2eRunsBothVersions: smoke.includes('scenario === "g11-audience-versions"') && smoke.includes("coreFactsIdentical") && smoke.includes("notOnlyVisualDifference"),
};
const failedContracts = Object.entries(contracts).filter(([, passed]) => !passed).map(([name]) => name);
assert(failedContracts.length === 0, `G11 product contracts failed: ${failedContracts.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  artifacts: {
    manager: { path: managerPptx, sha256: managerSha, slides: manager.slideCount },
    technical: { path: technicalPptx, sha256: technicalSha, slides: technical.slideCount },
  },
  facts: managerSemantic.goldenFactIds,
  audiences: { manager: managerSemantic, technical: technicalSemantic },
  negative: { mutation: "9.6 Tbps -> 9.5 Tbps", rejected: negative.goldenFactIds.length < 5 },
  contracts,
  contractCount: Object.keys(contracts).length,
}, null, 2));

function inspect(pptx, manifest) {
  const result = spawnSync(python, [acceptance, pptx, manifest], {
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    timeout: 30000,
    maxBuffer: 2_000_000,
    windowsHide: true,
  });
  assert(result.status === 0, `PPTX acceptance process failed for ${pptx}: ${result.stderr || result.error || result.stdout}`);
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

function evaluate(text) {
  const facts = [
    ["data_growth_10x", /(?:10\s*倍|10\s*[×x]|factor\s+of\s+10)/i],
    ["minimal_4_8_tbps", /4\.8\s*Tbps/i],
    ["flexible_9_6_tbps", /9\.6\s*Tbps/i],
    ["dc_2027_50", /2027[\s\S]{0,100}50%/i],
    ["dc_2029_100", /2029[\s\S]{0,100}100%/i],
  ];
  const requiredTechnicalDetails = [
    ["tier_model", /Tier-0[\s\S]{0,80}Tier-1/i],
    ["research_network", /R&E/i],
    ["rtt", /RTT/i],
    ["annual_volume", /350\s*PB\s*\/\s*年/i],
    ["average_rate", /50\s*GB\/s/i],
    ["raw_rate", /400\s*Gbps/i],
    ["reconstruction_rate", /100\s*Gbps/i],
    ["derived_rate", /1\s*Tbps/i],
  ].map(([id, pattern]) => ({ id, matched: pattern.test(text) }));
  return {
    goldenFactIds: facts.filter(([, pattern]) => pattern.test(text)).map(([id]) => id),
    impactDecisionSignals: count(text, /影响|决策|成本|风险|准备|优先|管理层/gi),
    technicalDetailSignals: count(text, /Tier-[01]|R&E|RTT|Gbps|Tbps|PB|GB\/s|prompt reconstruction|数据层级|吞吐|路由|拥塞/gi),
    acronymOccurrences: count(text, /\b(?:HL-LHC|WLCG|R&E|RTT|CMS|ATLAS|ATCF)\b/gi),
    requiredTechnicalDetails,
  };
}

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
