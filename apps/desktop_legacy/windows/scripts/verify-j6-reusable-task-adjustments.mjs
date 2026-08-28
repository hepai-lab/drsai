import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultPath = join(root, "release", "product-evidence", "j6-reusable-task-adjustments", "packaged-j6-reusable-task-adjustments-result.json");
assert(existsSync(resultPath), "Run verify:packaged-j6-reusable-task-adjustments before the independent verifier");
const result = JSON.parse(readFileSync(resultPath, "utf8"));
const evaluation = evaluate(result);
assert(result.ok === true && evaluation.ok, `J6 independent evaluation failed: ${JSON.stringify(evaluation.metrics)}`);

const negative = {
  hiddenAdjustmentEntryRejected: !evaluate(mutate(result, "adjustmentEntryVisible", false)).ok,
  missingAdjustmentTypeRejected: !evaluate(mutate(result, "threeAdjustmentTypesVisible", false)).ok,
  unclearScopeRejected: !evaluate(mutate(result, "twoScopesExplained", false)).ok,
  thisRunPersistenceLeakRejected: !evaluate(mutate(result, "thisRunDidNotChangeTemplate", false)).ok,
  templateUpdateFailureRejected: !evaluate(mutate(result, "templateUpdatedPersistently", false)).ok,
  rediscoveryFailureRejected: !evaluate(mutate(result, "updatedTemplateRediscovered", false)).ok,
  futureInheritanceFailureRejected: !evaluate(mutate(result, "futureRunKeptTemplate", false)).ok,
  changedCernPdfRejected: !evaluate({ ...result, details: { ...result.details, pdfHash: "sha256:changed" } }).ok,
};
assert(Object.values(negative).every(Boolean), `J6 negative mutations were not rejected: ${JSON.stringify(negative)}`);

const shared = read("../shared/api/desktopApi.ts");
const service = read("../shared/main/reusableTasks.ts");
const app = read("../shared/renderer/src/App.tsx");
const mock = read("../shared/renderer/src/mockDesktopApi.ts");
const smoke = read("src/main/e2eSmoke.ts");
const runner = read("scripts/verify-e2e-chat.mjs");
const packageJson = read("package.json");
const contracts = {
  typedAdjustments: shared.includes("DesktopReusableTaskAdjustments") && shared.includes("outputLanguage?: \"zh\" | \"en\"") && shared.includes("checkItems: string[]"),
  typedScope: shared.includes('"this_run" | "update_template"') && shared.includes("adjustmentScope: DesktopReusableTaskAdjustmentScope"),
  templateDefaultsPersisted: shared.includes("savedAdjustments: DesktopReusableTaskAdjustments") && service.includes("savedAdjustments: existing?.savedAdjustments"),
  legacyDefaultsHandled: service.includes("withAdjustmentDefaults") && service.includes("{ checkItems: [] }"),
  languageValidated: service.includes("Reusable task output language is invalid"),
  deadlineBounded: service.includes("deadline.length > 160"),
  checksBounded: service.includes("checkItems.length > 20") && service.includes("item.length > 240"),
  scopeValidated: service.includes("Reusable task adjustment scope is invalid"),
  thisRunIsNonPersistent: service.includes('request.adjustmentScope === "update_template" ? { savedAdjustments: adjustments } : {}'),
  templateUpdateIsAtomic: service.includes("await writeStore(store)") && service.includes("rename(temporaryPath, REUSABLE_TASKS_FILE)"),
  languageAppliedToPrompt: service.includes("- Output language:") && service.includes('"Chinese" : "English"'),
  deadlineAppliedToPrompt: service.includes("- Deadline:"),
  checksAppliedToPrompt: service.includes("- Check item:"),
  scopeAppliedToPrompt: service.includes("this run only; do not change the saved template") && service.includes("update the saved template and apply from this run onward"),
  adjustmentUiVisible: app.includes('data-testid="reusable-task-adjustments"') && app.includes("运行前调整"),
  threeControlsVisible: app.includes('data-testid="reusable-task-adjustment-language"') && app.includes('data-testid="reusable-task-adjustment-deadline"') && app.includes('data-testid="reusable-task-adjustment-checks"'),
  twoScopeChoicesVisible: app.includes("仅本次") && app.includes("以后都这样") && app.includes('value="update_template"'),
  structuredMetadata: app.includes("adjustment_scope: recipe.adjustmentScope") && app.includes("reusable_adjustments: recipe.adjustments"),
  mockParity: mock.includes('request.adjustmentScope === "update_template"') && mock.includes("adjustments: request.adjustments"),
  threeRunPackagedCoverage: smoke.includes("runReusableTaskAdjustmentSmoke") && smoke.includes("threeUniqueRunsRegistered") && runner.includes("completionRequests.length !== 3"),
  realCernCoverage: runner.includes("WLCG-20260715-WLCG-talk-IHEP-visit.pdf") && runner.includes("cernPdfUnchanged"),
  commandsRegistered: packageJson.includes('"verify:packaged-j6-reusable-task-adjustments"') && packageJson.includes('"verify:j6-reusable-task-adjustments"'),
};
assert(Object.values(contracts).every(Boolean), `J6 contracts failed: ${JSON.stringify(contracts)}`);

console.log(JSON.stringify({ ok: true, golden: evaluation, negative, contracts, contractCount: Object.keys(contracts).length }, null, 2));

function evaluate(input) {
  const checks = input?.checks ?? {};
  const details = input?.details ?? {};
  const metrics = {
    adjustmentDiscovery: checks.adjustmentEntryVisible && checks.threeAdjustmentTypesVisible ? 1 : 0,
    scopeClarity: checks.twoScopesExplained ? 1 : 0,
    thisRunExecution: checks.thisRunCompleted ? 1 : 0,
    thisRunIsolation: checks.initialTemplateHasNoAdjustments && checks.thisRunDidNotChangeTemplate ? 1 : 0,
    permanentUpdate: checks.templateUpdateRunCompleted && checks.templateUpdatedPersistently ? 1 : 0,
    crossPagePersistence: checks.updatedTemplateRediscovered ? 1 : 0,
    futureReuse: checks.futureRunCompletedWithoutRedescription && checks.futureRunKeptTemplate && checks.threeUniqueRunsRegistered && checks.threeOutputsRegistered ? 1 : 0,
    cernSourceProtection: checks.cernPdfAvailable && checks.cernPdfUnchanged && details.pdfHash === "sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e" ? 1 : 0,
  };
  return { ok: Object.values(metrics).every((value) => value === 1), metrics };
}

function mutate(input, name, value) { return { ...input, checks: { ...input.checks, [name]: value } }; }
function read(relativePath) { return readFileSync(join(root, relativePath), "utf8"); }
function assert(condition, message) { if (!condition) throw new Error(message); }
