import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultPath = join(root, "release", "product-evidence", "j1-user-preferences", "packaged-j1-user-preferences-result.json");
assert(existsSync(resultPath), "Run verify:packaged-j1-user-preferences before the independent verifier");
const result = JSON.parse(readFileSync(resultPath, "utf8"));
assert(result.ok === true && Object.values(result.checks ?? {}).every(Boolean), "Packaged J1 scenario did not pass");
const evaluation = evaluate(result);
assert(evaluation.ok, `J1 independent evaluation failed: ${JSON.stringify(evaluation.metrics)}`);

const negative = {
  silentSaveRejected: !evaluate({ ...result, checks: { ...result.checks, explicitConfirmationVisible: false } }).ok,
  wrongLanguageRejected: !evaluate(mutatePreferences(result, "output_language", "en")).ok,
  visibleGridRejected: !evaluate(mutatePreferences(result, "chart_gridlines", "visible")).ok,
  missingNewThreadNoticeRejected: !evaluate({ ...result, details: { ...result.details, noticeText: "" } }).ok,
  sameThreadRejected: !evaluate({ ...result, checks: { ...result.checks, realNewConversationCreated: false } }).ok,
  ordinaryTaskMemoryRejected: !evaluate({ ...result, details: { ...result.details, preferences: [...result.details.preferences, { category: "report_format", value: "report", source: "explicit_user_request" }] } }).ok,
  repeatedInstructionRejected: !evaluate({ ...result, details: { ...result.details, taskText: `${result.details.taskText} 以后默认用中文。` } }).ok,
  changedCernPdfRejected: !evaluate({ ...result, details: { ...result.details, pdfHash: "sha256:changed" } }).ok,
};
assert(Object.values(negative).every(Boolean), `J1 negative mutations were not rejected: ${JSON.stringify(negative)}`);

const shared = read("src/shared/desktopApi.ts");
const service = read("src/main/userPreferences.ts");
const main = read("src/main/index.ts");
const preload = read("src/preload/index.ts");
const intent = read("src/renderer/src/userPreferenceIntent.ts");
const adapter = read("src/renderer/src/adapters/useDesktopChatAdapter.ts");
const chat = read("src/renderer/src/components/ChatWorkspace.tsx");
const app = read("src/renderer/src/App.tsx");
const styles = read("src/renderer/src/styles.css");
const smoke = read("src/main/e2eSmoke.ts");
const runner = read("scripts/verify-e2e-chat.mjs");
const packageJson = read("package.json");
const contracts = {
  fourTypedCategories: ["output_language", "chart_gridlines", "report_format", "audience"].every((marker) => shared.includes(`"${marker}"`)),
  valuesAreAllowlisted: service.includes("ALLOWED_VALUES") && service.includes("User preference value is not supported for this category"),
  explicitSourceRequired: service.includes('request.source !== "explicit_user_request"') && shared.includes('source: "explicit_user_request"'),
  atomicPersistence: service.includes("randomUUID()}.tmp") && service.includes("rename(temporaryPath, USER_PREFERENCES_FILE)"),
  oneValuePerCategory: service.includes("item.category !== request.category") && service.includes("byCategory.has(item.category)"),
  secureIpcBridge: main.includes('secureHandle("desktop:user-preferences-list"') && main.includes('secureHandle("desktop:user-preference-upsert"') && preload.includes('"desktop:user-preference-upsert"'),
  explicitLanguageParsing: intent.includes("以后") && intent.includes("请|帮我") && intent.includes('add(found, "output_language", "zh")'),
  explicitChartParsing: intent.includes('add(found, "chart_gridlines", "hidden")') && intent.includes("网格线"),
  ordinaryTaskSeparated: intent.includes("TASK_MARKER") && adapter.includes("isPreferenceOnlyRequest(text)"),
  localSaveWithoutGateway: chat.includes("canSaveLocalPreference") && chat.includes("!canChat && !canSaveLocalPreference"),
  confirmationListsValues: adapter.includes("formatPreferenceConfirmation(saved") && intent.includes("新建会话后会自动应用，不需要再次说明"),
  newThreadNoticeVisible: chat.includes('data-testid="remembered-preferences-notice"') && adapter.includes("formatAppliedPreferenceNotice"),
  requestContextApplied: adapter.includes("buildUserPreferenceSystemSection") && adapter.includes("user_preferences: userPreferencesRef.current.map"),
  externalGatewayUsable: app.includes("health?.installed || health?.gateway?.externalReady"),
  noticeStyled: styles.includes(".remembered-preferences-notice"),
  realCernPackagedCoverage: smoke.includes("runUserPreferenceMemorySmoke") && runner.includes("F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E"),
  providerCalledOnceAfterLocalSave: runner.includes("completionRequests.length !== 1") && runner.includes("automatic application without repetition"),
  commandsRegistered: packageJson.includes('"verify:packaged-j1-user-preferences"') && packageJson.includes('"verify:j1-user-preferences"'),
};
assert(Object.values(contracts).every(Boolean), `J1 contracts failed: ${JSON.stringify(contracts)}`);

console.log(JSON.stringify({ ok: true, golden: evaluation, negative, contracts, contractCount: Object.keys(contracts).length }, null, 2));

function evaluate(input) {
  const checks = input?.checks ?? {};
  const details = input?.details ?? {};
  const preferences = details.preferences ?? [];
  const metrics = {
    explicitSaveAccuracy: checks.explicitConfirmationVisible === true && /已记住 2 项偏好/.test(details.confirmationText ?? "") ? 1 : 0,
    typedPersistenceAccuracy: preferences.length === 2 && preferences.every((item) => item.source === "explicit_user_request") && preferences.some((item) => item.category === "output_language" && item.value === "zh") && preferences.some((item) => item.category === "chart_gridlines" && item.value === "hidden") ? 1 : 0,
    crossConversationApplication: checks.realNewConversationCreated === true && checks.newConversationAppliesVisiblePreferences === true && /中文/.test(details.noticeText ?? "") && /网格线：不显示/.test(details.noticeText ?? "") ? 1 : 0,
    noRepetitionAccuracy: checks.ordinaryTaskDidNotCreateMemory === true && !/(?:以后默认|请记住|remember)/i.test(details.taskText ?? "") ? 1 : 0,
    taskExecutionAccuracy: checks.newConversationTaskCompleted === true && checks.taskSubmitEnabled === true ? 1 : 0,
    cernSourceProtection: checks.cernPdfUnchanged === true && details.pdfHash === "sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e" ? 1 : 0,
  };
  return { ok: Object.values(metrics).every((value) => value === 1), metrics };
}

function mutatePreferences(result, category, value) {
  return { ...result, details: { ...result.details, preferences: result.details.preferences.map((item) => item.category === category ? { ...item, value } : item) } };
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
