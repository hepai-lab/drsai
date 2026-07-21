import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultPath = join(root, "release", "product-evidence", "j3-memory-management", "packaged-j3-memory-management-result.json");
assert(existsSync(resultPath), "Run verify:packaged-j3-memory-management before the independent verifier");
const result = JSON.parse(readFileSync(resultPath, "utf8"));
assert(result.ok === true && Object.values(result.checks ?? {}).every(Boolean), "Packaged J3 scenario did not pass");
const evaluation = evaluate(result);
assert(evaluation.ok, `J3 independent evaluation failed: ${JSON.stringify(evaluation.metrics)}`);

const negative = {
  inaccessibleNavigationRejected: !evaluate(mutateCheck(result, "mainNavigationKeyboardReachable", false)).ok,
  missingRowsRejected: !evaluate(mutateCheck(result, "allSeededRowsVisible", false)).ok,
  staleEditRejected: !evaluate(mutateCheck(result, "editPersistedImmediately", false)).ok,
  retainedDeleteRejected: !evaluate(mutateCheck(result, "deletePersistedImmediately", false)).ok,
  staleNewConversationRejected: !evaluate({ ...result, details: { ...result.details, noticeText: "默认输出语言：中文；图表网格线：不显示" } }).ok,
  nextTaskFailureRejected: !evaluate(mutateCheck(result, "nextTaskCompleted", false)).ok,
  taskMutationRejected: !evaluate(mutateCheck(result, "nextTaskPreservedManagedState", false)).ok,
  changedCernPdfRejected: !evaluate({ ...result, details: { ...result.details, pdfHash: "sha256:changed" } }).ok,
};
assert(Object.values(negative).every(Boolean), `J3 negative mutations were not rejected: ${JSON.stringify(negative)}`);

const shared = read("../shared/api/desktopApi.ts");
const service = read("src/main/userPreferences.ts");
const main = read("src/main/index.ts");
const preload = read("../shared/main/preload.ts");
const mock = read("../shared/renderer/src/mockDesktopApi.ts");
const view = read("../shared/renderer/src/components/AgentSquareView.tsx");
const styles = read("../shared/renderer/src/styles.css");
const smoke = read("src/main/e2eSmoke.ts");
const runner = read("scripts/verify-e2e-chat.mjs");
const packageJson = read("package.json");
const contracts = {
  typedDeleteContract: shared.includes("DesktopUserPreferenceDeleteRequest") && shared.includes("DesktopUserPreferenceDeleteResult"),
  atomicDeletePersistence: service.includes("deleteUserPreference") && service.includes("writeStore({ preferences: nextPreferences })"),
  invalidCategoryRejected: service.includes("User preference category is not supported"),
  secureDeleteIpc: main.includes('secureHandle("desktop:user-preference-delete"') && preload.includes('"desktop:user-preference-delete"'),
  mockParity: mock.includes("deleteUserPreference: async"),
  myAssistantEntry: view.includes('data-testid="my-drsai-configure"') && view.includes('data-testid="open-user-memory-manager"'),
  semanticKeyboardButtons: /<button[^>]*type="button"[^>]*data-testid="my-drsai-configure"/.test(view) && /<button[^>]*type="button"[^>]*data-testid="open-user-memory-manager"/.test(view),
  memoryManagerView: view.includes('data-testid="user-memory-manager"') && view.includes("只保存你明确要求记住的非敏感偏好"),
  typedRows: view.includes('data-testid={`memory-row-${preference.category}`}') && view.includes('data-testid={`memory-value-${preference.category}`}'),
  directEdit: view.includes("updatePreference") && view.includes("下一项任务立即生效"),
  directDelete: view.includes("removePreference") && view.includes("不会再用于后续任务"),
  sensitiveBoundaryExplained: view.includes("API Key、令牌和临时路径不会出现在这里"),
  emptyState: view.includes('data-testid="memory-manager-empty"'),
  responsiveStyling: styles.includes(".user-memory-row") && styles.includes("@media (max-width: 760px)"),
  realNavigationPackaged: smoke.includes("mainNavigationKeyboardReachable") && smoke.includes("memoryEntryKeyboardReachable"),
  providerDeletionVerification: runner.includes("structured metadata retained stale or deleted memory") && runner.includes("system context did not reflect the edit and deletion"),
  realCernCoverage: smoke.includes("runMemoryManagementSmoke") && runner.includes("F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E"),
  commandsRegistered: packageJson.includes('"verify:packaged-j3-memory-management"') && packageJson.includes('"verify:j3-memory-management"'),
};
assert(Object.values(contracts).every(Boolean), `J3 contracts failed: ${JSON.stringify(contracts)}`);

console.log(JSON.stringify({ ok: true, golden: evaluation, negative, contracts, contractCount: Object.keys(contracts).length }, null, 2));

function evaluate(input) {
  const checks = input?.checks ?? {};
  const details = input?.details ?? {};
  const preferences = details.preferences ?? [];
  const metrics = {
    entryAndKeyboardAccessibility: checks.mainNavigationEntryVisible === true && checks.mainNavigationKeyboardReachable === true && checks.myAssistantKeyboardReachable === true && checks.memoryEntryKeyboardReachable === true ? 1 : 0,
    rememberedItemVisibility: checks.memoryManagerVisible === true && checks.allSeededRowsVisible === true ? 1 : 0,
    editImmediateEffect: checks.editConfirmed === true && checks.editPersistedImmediately === true && preferences.some((item) => item.category === "output_language" && item.value === "en") ? 1 : 0,
    deletionCompleteness: checks.deleteConfirmed === true && checks.deletedRowRemoved === true && checks.deletePersistedImmediately === true && !preferences.some((item) => item.category === "chart_gridlines") ? 1 : 0,
    newConversationAccuracy: checks.newConversationReflectsEditAndDelete === true && /默认输出语言：英文/.test(details.noticeText ?? "") && !/图表网格线/.test(details.noticeText ?? "") ? 1 : 0,
    nextTaskAccuracy: checks.nextTaskCompleted === true && checks.nextTaskPreservedManagedState === true ? 1 : 0,
    cernSourceProtection: checks.cernPdfUnchanged === true && details.pdfHash === "sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e" ? 1 : 0,
  };
  return { ok: Object.values(metrics).every((value) => value === 1), metrics };
}

function mutateCheck(input, name, value) {
  return { ...input, checks: { ...input.checks, [name]: value } };
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
