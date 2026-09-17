import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const component = read("../shared/renderer/src/components/MobilePairingDialog.tsx");
const preload = read("../shared/main/preload.ts");
const main = read("src/main/index.ts");
const controller = read("../shared/main/mobilePairingController.ts");
const python = read("../../../cores/python/packages/drsai/src/drsai/relay/mobile_pairing.py");
const gateway = read("../../../cores/python/packages/drsai/src/drsai/backend/gateway.py");
const runtimeClient = read("../shared/main/runtimeClient.ts");
const app = read("../shared/renderer/src/App.tsx");

assert.ok(!/localStorage|sessionStorage|indexedDB/.test(component), "pairing secret must remain memory-only");
assert.ok(!/console\.|recordDiagnostic|logger\./.test(component), "pairing payload must not enter renderer diagnostics");
assert.ok(!/console\.|logger\.|print\(/.test(python), "pairing transport must not log token or grant code");
assert.ok(python.includes("TRUSTED_RELAY_HOSTS") && (python.includes("allow_redirects=False") || python.includes('"allow_redirects": False')), "Relay transport must be HTTPS allowlisted and reject redirects");
assert.ok(python.includes('"X-Correlation-ID"') && python.includes("range(2)"), "Relay requests need correlation IDs and bounded retry");
assert.ok(component.includes("desktopApi.createMobilePairingGrant(")
  && component.includes("workspace_scope") && component.includes("workspace_ids")
  && !component.includes("workspacePath")
  && !component.includes("X-Runtime-Token"),
"pairing is Host-scoped, with an explicit bounded Workspace allowlist and no Runtime credentials");
assert.ok(!/mobile-pairing-create[^\n]+token/i.test(preload), "preload create channel must accept no token");
assert.ok(main.includes("mobilePairingControllerFor(event.sender)") && main.includes("secureHandle"), "pairing IPC must bind trusted renderer ownership");
assert.ok(controller.includes("private active") && !controller.includes("writeFile") && !controller.includes("localStorage"), "active grant must be ephemeral");
assert.ok(controller.includes("Promise.allSettled") === false, "controller must not leak shutdown results");
assert.ok(main.includes('reason.code === "http_404"') && main.includes("/^not found"), "automatic repair must run only for the exact missing-route response");
assert.ok(main.includes("mobilePairingRuntimeRepair") && main.includes("if (mobilePairingRuntimeRepair)"), "concurrent repair attempts must be coalesced");
assert.ok(main.includes("requireAuthContext()") && main.includes("/v1/registration-codes"), "registration code issuer must use the verified Desktop OIDC session");
const registrationStart = runtimeClient.indexOf("registerMobilePairingRuntime(input:");
const registrationMethod = runtimeClient.slice(registrationStart, runtimeClient.indexOf("createMobilePairingGrant(", registrationStart));
assert.ok(registrationMethod.includes("registration_code: input.registrationCode") && !registrationMethod.includes("accessToken"), "OIDC bearer token must never be sent to local Runtime");
assert.ok(gateway.includes("_trusted_mobile_pairing_relay") && gateway.includes("relay_url_not_trusted"), "Runtime enrollment must pin trusted HTTPS Relay hosts and paths");
assert.ok(gateway.includes("Runtime Relay enrollment failed") && !gateway.includes("logger.warning(exc)"), "Runtime enrollment errors must not log registration secrets");
assert.ok(app.includes("pauseMobileRemoteAccess()") && app.includes("resumeMobileRemoteAccess()"), "ordinary switch must use reversible pause and resume");
const switchStart = app.indexOf('data-testid="android-remote-toggle"');
const switchSource = app.slice(Math.max(0, switchStart - 500), switchStart + 800);
assert.ok(!switchSource.includes("revokeMobileRuntimeEnrollment"), "ordinary switch must never revoke enrollment");
assert.ok(app.includes('data-testid="android-revoke-all"') && app.includes('data-testid="android-revoke-enrollment"'), "bulk device revoke and Runtime unregister must be separate dangerous actions");
assert.ok(controller.includes("shrinkAssociation") && runtimeClient.includes("shrinkMobileAssociation")
  && gateway.includes("shrink_association") && app.includes('data-testid="android-device-read-only"'),
"device authorization must be explainable and reducible through the trusted Runtime path");
assert.ok(controller.includes("new Set(permissions)") && controller.includes("permissions are invalid"),
"Desktop must normalize and reject invalid permission reductions before IPC");

console.log("Mobile pairing security verification passed (21 checks).");
