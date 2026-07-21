import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultPath = join(root, "release", "product-evidence", "j5-reusable-task", "packaged-j5-reusable-task-result.json");
assert(existsSync(resultPath), "Run verify:packaged-j5-reusable-task before the independent verifier");
const result = JSON.parse(readFileSync(resultPath, "utf8"));
const evaluation = evaluate(result);
assert(result.ok === true && evaluation.ok, `J5 independent evaluation failed: ${JSON.stringify(evaluation.metrics)}`);

const negative = {
  incompleteSourceRejected: !evaluate(mutate(result, "completedSourceTaskAvailable", false)).ok,
  hiddenSaveEntryRejected: !evaluate(mutate(result, "saveEntryVisible", false)).ok,
  missingInputExplanationRejected: !evaluate(mutate(result, "replacementInputsExplained", false)).ok,
  missingFixedRulesRejected: !evaluate(mutate(result, "fixedRulesExplained", false)).ok,
  missingCrossSessionDiscoveryRejected: !evaluate(mutate(result, "crossSessionDiscovery", false)).ok,
  rerunFailureRejected: !evaluate(mutate(result, "reusableRunCompleted", false)).ok,
  staleResultRejected: !evaluate(mutate(result, "newResultUsesCernMaterial", false)).ok,
  changedCernPdfRejected: !evaluate({ ...result, details: { ...result.details, pdfHash: "sha256:changed" } }).ok,
};
assert(Object.values(negative).every(Boolean), `J5 negative mutations were not rejected: ${JSON.stringify(negative)}`);

const shared = read("../shared/api/desktopApi.ts");
const service = read("src/main/reusableTasks.ts");
const main = read("src/main/index.ts");
const preload = read("../shared/main/preload.ts");
const mock = read("../shared/renderer/src/mockDesktopApi.ts");
const app = read("../shared/renderer/src/App.tsx");
const smoke = read("src/main/e2eSmoke.ts");
const runner = read("scripts/verify-e2e-chat.mjs");
const packageJson = read("package.json");
const contracts = {
  typedReusableTask: shared.includes("DesktopReusableTaskInput") && shared.includes("DesktopReusableTaskRunRecipe"),
  typedSaveAndRunApi: shared.includes("saveReusableTask") && shared.includes("prepareReusableTaskRun"),
  completedTaskOnly: service.includes("Only a completed task with a saved result"),
  perUserIsolation: service.includes("requireAuthContext") && service.includes("store.users[userId]"),
  atomicPersistence: service.includes("temporaryPath") && service.includes("rename(temporaryPath, REUSABLE_TASKS_FILE)"),
  boundedStorage: service.includes("MAX_TASKS_PER_USER") && service.includes("MAX_NAME_CHARS"),
  inferredInputs: service.includes("inferInputs") && service.includes("keyConclusions") && service.includes("readdir(task.workspacePath"),
  fixedRulesCaptured: service.includes("inferFixedRules") && service.includes("task.planSteps"),
  currentInputHashed: service.includes('createHash("sha256").update(await readFile(path))'),
  duplicateInputRejected: service.includes("Choose new input material instead of reusing"),
  freshCachePolicy: service.includes('cachePolicy: "force_fresh_input_read"') && service.includes("ignore all earlier outputs and caches"),
  oldInputSubstitution: service.includes("taskText.split(input.originalValue).join(replacement)"),
  secureIpc: main.includes('secureHandle("desktop:reusable-task-save"') && main.includes('secureHandle("desktop:reusable-task-run-prepare"'),
  preloadParity: preload.includes("saveReusableTask") && preload.includes("prepareReusableTaskRun"),
  mockParity: mock.includes("saveReusableTask: async") && mock.includes("prepareReusableTaskRun: async"),
  resultsCenterEntry: app.includes('data-testid="reusable-task-save"') && app.includes('data-testid="reusable-tasks"'),
  replacementInputUi: app.includes('data-testid={`reusable-task-input-${input.id}`}') && app.includes("下次替换"),
  fixedRulesUi: app.includes("保持不变的规则") && app.includes("task.fixedRules.map"),
  realAgentRerun: app.includes('source: "windows-reusable-task"') && app.includes("startAgentRun"),
  realCernPackagedCoverage: smoke.includes("runReusableTaskSmoke") && runner.includes("F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E"),
  commandsRegistered: packageJson.includes('"verify:packaged-j5-reusable-task"') && packageJson.includes('"verify:j5-reusable-task"'),
};
assert(Object.values(contracts).every(Boolean), `J5 contracts failed: ${JSON.stringify(contracts)}`);

console.log(JSON.stringify({ ok: true, golden: evaluation, negative, contracts, contractCount: Object.keys(contracts).length }, null, 2));

function evaluate(input) {
  const checks = input?.checks ?? {};
  const details = input?.details ?? {};
  const metrics = {
    successfulTaskSave: checks.completedSourceTaskAvailable && checks.saveEntryVisible && checks.savedTaskVisible && checks.typedTemplatePersisted ? 1 : 0,
    replacementInputClarity: checks.replacementInputsExplained ? 1 : 0,
    fixedRuleClarity: checks.fixedRulesExplained ? 1 : 0,
    crossSessionReuse: checks.crossSessionDiscovery && checks.runEntryVisible ? 1 : 0,
    freshExecution: checks.reusableRunCompleted && checks.runHistoryUpdated && checks.sameInputCacheReuseRejected ? 1 : 0,
    newMaterialAccuracy: checks.newResultRegistered && checks.newResultUsesCernMaterial && !String(details.newReportText || "").includes("throughput,100") ? 1 : 0,
    cernSourceProtection: checks.cernPdfAvailable && checks.cernPdfUnchanged && details.pdfHash === "sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e" ? 1 : 0,
  };
  return { ok: Object.values(metrics).every((value) => value === 1), metrics };
}

function mutate(input, name, value) { return { ...input, checks: { ...input.checks, [name]: value } }; }
function read(relativePath) { return readFileSync(join(root, relativePath), "utf8"); }
function assert(condition, message) { if (!condition) throw new Error(message); }
