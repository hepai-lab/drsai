import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { presentCodexBackendStatus } from "../main/codexBackendStatus.ts";

const facet = (state: "ready" | "missing" | "blocked" | "unknown") => ({ state });
assert.equal(presentCodexBackendStatus({ backend_id: "codex", available: false, reason: "opaque", readiness: { transport: facet("unknown"), installed: facet("missing"), contract: facet("unknown"), account: facet("unknown"), models: facet("unknown"), executable: facet("unknown") } }).state, "not_installed");
assert.equal(presentCodexBackendStatus({ backend_id: "codex", available: false, reason: "opaque", readiness: { transport: facet("ready"), installed: facet("ready"), contract: facet("blocked"), account: facet("unknown"), models: facet("ready"), executable: facet("unknown") } }).state, "version_incompatible");
assert.equal(presentCodexBackendStatus({ backend_id: "codex", available: true, version: "1" }, { state: "signed_out", logged_in: false, auth_mode: null, email: null, plan_type: null, credential_source: null, requires_openai_auth: true }).state, "not_logged_in");
assert.equal(presentCodexBackendStatus({ backend_id: "codex", available: true, version: "1" }, { state: "unavailable", logged_in: false, auth_mode: null, email: null, plan_type: null, credential_source: null, requires_openai_auth: true }).state, "account_unavailable");
const available = presentCodexBackendStatus({ backend_id: "codex", available: true, version: "1" }, { state: "signed_in", logged_in: true, auth_mode: "chatgpt", email: "user@example.test", plan_type: null, credential_source: null, requires_openai_auth: true });
assert.equal(available.state, "available"); assert.equal(available.accountLabel, "user@example.test");

const runtimeServices = await readFile(new URL("../../macos/src/main/ipc/registerRuntimeServicesIpc.ts", import.meta.url), "utf8");
for (const channel of ["desktop:get-codex-backend-status", "desktop:start-codex-backend-login", "desktop:cancel-codex-backend-login", "desktop:logout-codex-backend"]) assert.ok(runtimeServices.includes(channel));
assert.match(runtimeServices, /assertAllowedExternalUrl\(externalUrl\)/, "Codex login URL must use the external URL allowlist.");
console.log("macOS Codex backend lifecycle verification passed.");
