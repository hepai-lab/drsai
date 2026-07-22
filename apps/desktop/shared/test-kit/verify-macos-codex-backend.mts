import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { presentCodexBackendStatus } from "../main/codexBackendStatus.ts";

assert.equal(presentCodexBackendStatus({ backend_id: "codex", available: false, reason: "not_installed" }).state, "not_installed");
assert.equal(presentCodexBackendStatus({ backend_id: "codex", available: false, reason: "version_incompatible" }).state, "version_incompatible");
assert.equal(presentCodexBackendStatus({ backend_id: "codex", available: true, version: "1" }, { logged_in: false, auth_mode: null, email: null, plan_type: null, credential_source: null }).state, "not_logged_in");
const available = presentCodexBackendStatus({ backend_id: "codex", available: true, version: "1" }, { logged_in: true, auth_mode: "chatgpt", email: "user@example.test", plan_type: null, credential_source: null });
assert.equal(available.state, "available"); assert.equal(available.accountLabel, "user@example.test");

const main = await readFile(new URL("../../macos/src/main/index.ts", import.meta.url), "utf8");
for (const channel of ["desktop:get-codex-backend-status", "desktop:start-codex-backend-login", "desktop:cancel-codex-backend-login", "desktop:logout-codex-backend"]) assert.ok(main.includes(channel));
assert.match(main, /assertAllowedExternalUrl\(externalUrl\)/, "Codex login URL must use the external URL allowlist.");
console.log("macOS Codex backend lifecycle verification passed.");
