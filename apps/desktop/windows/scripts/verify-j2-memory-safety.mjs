import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultPath = join(root, "release", "product-evidence", "j2-memory-safety", "packaged-j2-memory-safety-result.json");
assert(existsSync(resultPath), "Run verify:packaged-j2-memory-safety before the independent verifier");
const result = JSON.parse(readFileSync(resultPath, "utf8"));
assert(result.ok === true && Object.values(result.checks ?? {}).every(Boolean), "Packaged J2 scenario did not pass");
const evaluation = evaluate(result);
assert(evaluation.ok, `J2 independent evaluation failed: ${JSON.stringify(evaluation.metrics)}`);

const negative = {
  secretAcceptedRejected: !evaluate(mutateCheck(result, "sensitiveMemoryExplicitlyRejected", false)).ok,
  visibleLeakRejected: !evaluate(mutateCheck(result, "visibleSecretRedacted", false)).ok,
  preferenceLeakRejected: !evaluate(mutateCheck(result, "secretNotInPreferenceStore", false)).ok,
  threadLeakRejected: !evaluate(mutateCheck(result, "secretNotInThreadPersistence", false)).ok,
  indexLeakRejected: !evaluate(mutateCheck(result, "secretNotInMemoryIndex", false)).ok,
  temporaryPersistenceRejected: !evaluate(mutateCheck(result, "temporaryRequirementNotPersisted", false)).ok,
  nextContextPollutionRejected: !evaluate({ ...result, details: { ...result.details, newConversationNotice: "默认输出语言：英文；图表网格线：显示" } }).ok,
  changedCernPdfRejected: !evaluate({ ...result, details: { ...result.details, pdfHash: "sha256:changed" } }).ok,
};
assert(Object.values(negative).every(Boolean), `J2 negative mutations were not rejected: ${JSON.stringify(negative)}`);

const service = read("src/main/userPreferences.ts");
const intent = read("src/renderer/src/userPreferenceIntent.ts");
const adapter = read("src/renderer/src/adapters/useDesktopChatAdapter.ts");
const chat = read("src/renderer/src/components/ChatWorkspace.tsx");
const smoke = read("src/main/e2eSmoke.ts");
const runner = read("scripts/verify-e2e-chat.mjs");
const packageJson = read("package.json");
const contracts = {
  apiKeyDetection: intent.includes("api_key") && intent.includes("sk-[A-Za-z0-9_-]"),
  tokenDetection: intent.includes("xox[baprs]") && intent.includes("access[ _-]?token"),
  temporaryPathDetection: intent.includes("AppData\\\\Local\\\\Temp") && intent.includes("temporary_path"),
  oneTimeMarkerDetection: intent.includes("TEMPORARY_MARKER") && intent.includes("这次") && intent.includes("only (?:for )?this"),
  temporaryNeverParsedAsPreference: intent.includes("TEMPORARY_MARKER.test(normalized)) return []"),
  secretRedaction: intent.includes("redactSensitiveMemoryText") && intent.includes("[API Key 已隐藏]") && intent.includes("[令牌已隐藏]") && intent.includes("[临时路径已隐藏]"),
  explicitSafetyNotice: intent.includes("没有保存你提供的 API Key、令牌或临时路径") && intent.includes("没有把它发送给模型"),
  localSafetyHandling: intent.includes("canHandleMemoryRequestLocally") && chat.includes("canHandleMemoryRequestLocally(input)"),
  redactedThreadPublication: adapter.includes("redactSensitiveMemoryText(text)") && adapter.includes("handleSensitiveLocally"),
  temporaryScopeHandling: adapter.includes("handleTemporaryLocally") && adapter.includes("memorySafety.temporary ? []"),
  typedStoreOnly: service.includes("ALLOWED_VALUES") && !service.includes("rawText") && !service.includes("conversationText"),
  preferenceSurfaceScanned: smoke.includes("secretNotInPreferenceStore"),
  threadSurfaceScanned: smoke.includes("secretNotInThreadPersistence"),
  memoryIndexScanned: smoke.includes("secretNotInMemoryIndex") && smoke.includes("listProjectMemory"),
  providerContextScanned: runner.includes("secret leaked to provider context") && runner.includes("one-time instruction leaked"),
  appStorageScanned: runner.includes("collectTextStorage(appHome)") && runner.includes("secret leaked to persistent App storage"),
  realCernCoverage: smoke.includes("runSensitiveMemorySmoke") && runner.includes("F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E"),
  commandsRegistered: packageJson.includes('"verify:packaged-j2-memory-safety"') && packageJson.includes('"verify:j2-memory-safety"'),
};
assert(Object.values(contracts).every(Boolean), `J2 contracts failed: ${JSON.stringify(contracts)}`);

console.log(JSON.stringify({ ok: true, golden: evaluation, negative, contracts, contractCount: Object.keys(contracts).length }, null, 2));

function evaluate(input) {
  const checks = input?.checks ?? {};
  const details = input?.details ?? {};
  const preferences = details.preferences ?? [];
  const metrics = {
    sensitiveRequestRejection: checks.sensitiveMemoryExplicitlyRejected === true && checks.visibleSecretRedacted === true ? 1 : 0,
    persistentStorageZeroLeak: checks.secretNotInPreferenceStore === true && checks.secretNotInThreadPersistence === true && checks.secretNotInMemoryIndex === true && checks.allRuntimeMemorySurfacesClean === true ? 1 : 0,
    temporaryRequirementIsolation: checks.temporaryRequirementExplicitlyScoped === true && checks.temporaryRequirementNotPersisted === true ? 1 : 0,
    safePreferencePreservation: preferences.length === 2 && preferences.some((item) => item.category === "output_language" && item.value === "zh") && preferences.some((item) => item.category === "chart_gridlines" && item.value === "hidden") ? 1 : 0,
    nextConversationContextSafety: checks.nextConversationUsesSafeBaseline === true && /中文/.test(details.newConversationNotice ?? "") && /不显示/.test(details.newConversationNotice ?? "") && !/英文|网格线：显示/.test(details.newConversationNotice ?? "") ? 1 : 0,
    nextTaskExecution: checks.nextTaskCompleted === true && checks.nextTaskDidNotMutateMemory === true ? 1 : 0,
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
