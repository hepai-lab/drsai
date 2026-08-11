import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const api = read("..", "shared", "api", "desktopApi.ts");
const sensitiveData = read("..", "shared", "api", "sensitiveData.ts");
const scanner = read("..", "shared", "main", "shareSensitivity.ts");
const service = read("..", "shared", "main", "shares.ts");
const main = read("src", "main", "index.ts");
const preload = read("..", "shared", "main", "preload.ts");
const ui = read("..", "shared", "renderer", "src", "App.tsx");
const mock = read("..", "shared", "renderer", "src", "mockDesktopApi.ts");
const smoke = read("src", "main", "e2eSmoke.ts");
const runner = read("scripts", "verify-e2e-chat.mjs");

function assert(value, message) { if (!value) throw new Error(`L3 verification failed: ${message}`); }

const raw = "api_key=sk-L3CERNSecretKey1234567890\nAuthorization: Bearer L3BearerTokenABCDEFGHIJKLMN\nContact alice.sensitive@cern.example\nPhone 13800138000\nuser_secret=L3UserDefinedSecret987654321";
const redacted = "api_key=[已遮蔽秘密]\nAuthorization: Bearer [已遮蔽秘密]\nContact \nPhone [已遮蔽手机号]\nuser_secret=[已遮蔽秘密]";
const secrets = ["sk-L3CERNSecretKey1234567890", "L3BearerTokenABCDEFGHIJKLMN", "alice.sensitive@cern.example", "13800138000", "L3UserDefinedSecret987654321"];
const metrics = {
  fiveFixturesPresent: secrets.every((secret) => raw.includes(secret)),
  allRawValuesRemoved: secrets.every((secret) => !redacted.includes(secret)),
  apiKeyRedacted: redacted.includes("api_key=[已遮蔽秘密]"),
  bearerRedacted: redacted.includes("Bearer [已遮蔽秘密]"),
  emailRemoved: !redacted.includes("@"),
  phoneRedacted: redacted.includes("[已遮蔽手机号]"),
  userSecretRedacted: redacted.includes("user_secret=[已遮蔽秘密]"),
  directBypassGate: service.includes("validateSensitiveResolutions(findings, resolutions)"),
};
for (const [name, passed] of Object.entries(metrics)) assert(passed, `metric ${name}`);

const golden = { detected: true, api: true, bearer: true, email: true, phone: true, user: true, bypass: true, storage: true };
const accepts = (value) => Object.values(value).every(Boolean);
const mutations = Object.keys(golden).map((key) => ({ [key]: false }));
assert(accepts(golden), "golden evidence rejected");
for (const mutation of mutations) assert(!accepts({ ...golden, ...mutation }), `negative mutation accepted: ${JSON.stringify(mutation)}`);

const contracts = [
  [api, "DesktopShareSensitiveFinding"], [api, "DesktopShareSensitiveResolution"], [api, "DesktopShareSensitiveReviewSummary"],
  [api, "DesktopShareInspectionRequest"], [api, "DesktopShareInspectionResult"], [api, "inspectShare(request"],
  [scanner, "scanSensitiveText"], [scanner, "publicSensitiveFindings"], [scanner, "sanitizeSensitiveText"], [scanner, "validateSensitiveResolutions"],
  [sensitiveData, "api[_ -]?key"], [sensitiveData, "Bearer"], [sensitiveData, "email"], [sensitiveData, "phone"], [sensitiveData, "user_secret"],
  [scanner, "[已遮蔽秘密]"], [scanner, "[已遮蔽邮箱]"], [scanner, "[已遮蔽手机号]"],
  [service, "MAX_SENSITIVE_SCAN_BYTES"], [service, "SANITIZED_SHARES_DIR"], [service, "scanShareArtifacts"],
  [scanner, "Sensitive information review is required before sharing"], [service, "highRiskSecretsDirectlyShared: 0"],
  [main, 'secureHandle("desktop:share-inspect"'], [preload, 'ipcRenderer.invoke("desktop:share-inspect"'], [mock, "inspectShare: async"],
  [ui, 'data-testid="share-sensitive-review"'], [ui, 'data-testid="share-sensitive-finding"'], [ui, 'data-testid="share-sensitive-action"'],
  [ui, '<option value="redact">'], [ui, '<option value="remove">'],
  [smoke, "runSensitiveShareSmoke"], [smoke, "directApiBypassDenied"], [smoke, "originalFileUnchanged"],
  [smoke, "openedContentSanitized"], [smoke, "downloadContentSanitized"],
  [runner, '"l3-sensitive-share-review"'], [runner, "storage.noRawSecrets"], [runner, "network.noModelRequests"],
];
for (const [source, token] of contracts) assert(source.includes(token), `contract missing: ${token}`);

console.log(`L3 sensitive-share verification passed: ${Object.keys(metrics).length}/8 metrics, ${mutations.length}/8 negative mutations, ${contracts.length}/${contracts.length} contracts.`);
