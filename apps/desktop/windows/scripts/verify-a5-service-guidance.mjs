import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`A5 service guidance verification failed: ${message}`);
    process.exit(1);
  }
}

const loginScreen = read("../shared/renderer/src/auth/LoginScreen.tsx");
const authProvider = read("../shared/renderer/src/auth/AuthProvider.tsx");
const mainIndex = read("src/main/index.ts");
const preload = read("../shared/main/preload.ts");
const bootstrap = read("src/main/bootstrap.ts");
const desktopApi = read("../shared/api/desktopApi.ts");
const css = read("../shared/renderer/src/styles.css");
const packagedA5 = read("scripts/verify-packaged-a5-service-guidance.mjs");
const packagedA5Stability = read("scripts/verify-packaged-a5-service-guidance-stability.mjs");
const e2eSmoke = read("src/main/e2eSmoke.ts");
const packageJson = read("package.json");

const kinds = [
  "auth_required",
  "service_unavailable",
  "runtime_missing",
  "permission_denied",
];

for (const kind of kinds) {
  assert(desktopApi.includes(`| "${kind}"`) || desktopApi.includes(`${kind}"`), `shared API omits ${kind}`);
  assert(loginScreen.includes(`${kind}:`), `renderer guide omits ${kind}`);
  assert(packagedA5.includes(`"${kind}"`), `packaged A5 launcher omits ${kind}`);
}

assert(loginScreen.includes("需要先登录") && loginScreen.includes("Sign in required"), "auth-required user language is missing");
assert(loginScreen.includes("服务暂时不可用") && loginScreen.includes("Service unavailable"), "service-unavailable user language is missing");
assert(loginScreen.includes("需要修复本地运行时") && loginScreen.includes("Local runtime needs repair"), "runtime-missing user language is missing");
assert(loginScreen.includes("账号暂无可用服务") && loginScreen.includes("Account has no available service"), "permission-denied user language is missing");

assert(loginScreen.includes("data-testid=\"a5-login-action\""), "login CTA test hook is missing");
assert(loginScreen.includes("data-testid=\"a5-retry-action\""), "retry CTA test hook is missing");
assert(loginScreen.includes("data-testid=\"a5-repair-runtime-action\""), "runtime repair CTA test hook is missing");
assert(loginScreen.includes("data-testid=\"a5-copy-diagnostics\""), "copy diagnostics CTA test hook is missing");
assert(loginScreen.includes("任务不会被发送") && loginScreen.includes("不会执行任何任务"), "blocked-state language must say no task is sent");

assert(loginScreen.includes("sanitizeDiagnosticText"), "diagnostic sanitizer is missing");
assert(loginScreen.includes("copyTextToClipboard"), "diagnostic copy must fall back to trusted desktop clipboard IPC");
for (const marker of ["Bearer", "api[_-]?key", "[redacted-email]", "C:\\\\Users\\\\[user]", "private[_-]?key", "cookie"]) {
  assert(loginScreen.includes(marker), `diagnostic sanitizer omits ${marker}`);
}
assert(!loginScreen.includes("accessToken:") && !loginScreen.includes("refreshToken:"), "diagnostics must not copy token fields");

assert(authProvider.includes("getA5ServiceGuidanceScenario") && authProvider.includes("applyA5ServiceGuidanceScenario"), "AuthProvider is not wired to the A5 E2E injection scenario");
assert(mainIndex.includes('OPENDRSAI_E2E_A5_SERVICE_GUIDANCE === "1"'), "A5 injection is not gated by explicit E2E mode");
assert(mainIndex.includes("getA5ServiceGuidanceScenario") && mainIndex.includes("return null;"), "A5 injection must return null outside explicit E2E mode");
assert(preload.includes("desktop:e2e-a5-service-guidance-scenario"), "preload does not expose the gated A5 E2E scenario IPC");
assert(mainIndex.includes("desktop:clipboard-copy-text") && mainIndex.includes("text.length > 50_000"), "main clipboard fallback must be registered and length-limited");

assert(bootstrap.includes("getInstallStatus") && bootstrap.includes('kind: "runtime_missing"'), "bootstrap does not classify runtime-missing state");
assert(bootstrap.includes('kind: "service_unavailable"'), "bootstrap does not classify service-unavailable state");
assert(bootstrap.includes('kind: "permission_denied"'), "bootstrap does not classify permission-denied state");

assert(css.includes(".availability-guidance") && css.includes(".availability-actions"), "A5 guidance styling is missing");

assert(e2eSmoke.includes("runA5ServiceGuidanceSmoke"), "packaged E2E runner is missing");
assert(e2eSmoke.includes("capturePage()"), "packaged E2E runner does not capture screenshots");
assert(e2eSmoke.includes("diagnosticsRedacted"), "packaged E2E runner does not assert diagnostic redaction");
assert(e2eSmoke.includes("chatBlocked") && e2eSmoke.includes("agentBlocked"), "packaged E2E runner does not assert blocked chat and agent actions");
assert(e2eSmoke.includes("noInfiniteLoading") && e2eSmoke.includes("notErrorCodeOnly"), "packaged E2E runner does not assert loading/error-code behavior");

assert(packagedA5.includes("release") && packagedA5.includes("win-unpacked") && packagedA5.includes("OpenDrSai.exe"), "packaged A5 launcher does not use the real unpacked app");
assert(packagedA5.includes("summary.json") && packagedA5.includes("screenshots"), "packaged A5 launcher does not produce structured evidence");
assert(packagedA5Stability.includes('OPENDRSAI_A5_STABILITY_ROUNDS || "20"'), "A5 stability runner does not default to 20 rounds");
assert(packagedA5Stability.includes("requestedScenarioCount: rounds * 4") && packagedA5Stability.includes("configuredRetries: 0"), "A5 stability summary omits scenario count or zero-retry policy");
assert(packagedA5Stability.includes("if (!round.ok) break") && packagedA5Stability.includes("summary.json"), "A5 stability runner must stop on failure and retain a machine summary");
assert(packageJson.includes('"verify:a5-service-guidance": "node scripts/verify-a5-service-guidance.mjs"'), "A5 contract script is not registered");
assert(packageJson.includes('"verify:packaged-a5-service-guidance"'), "packaged A5 E2E script is not registered");
assert(packageJson.includes('"verify:packaged-a5-service-guidance-stability"'), "packaged A5 stability script is not registered");

console.log("A5 service guidance verification passed (renderer contract, gated injection, redaction, and packaged four-state E2E wiring).");
