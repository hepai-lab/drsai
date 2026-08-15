import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const componentPath = join(root, "../shared/renderer/src/components/CodexIntegrationSettings.tsx");
const appPath = join(root, "../shared/renderer/src/App.tsx");
const stylesPath = join(root, "../shared/renderer/src/styles.css");
const [component, app, styles] = await Promise.all([
  readFile(componentPath, "utf8"),
  readFile(appPath, "utf8"),
  readFile(stylesPath, "utf8"),
]);

assert(component.includes("通过自研 Codex Adapter 接入并符合 OpenDrSai Agent 协议（OAEP）"));
assert(component.includes("数据与技能沉淀为可复用资产"));
assert(component.includes("view.showSetup") && component.includes("codex-advanced-diagnostics"));
assert(component.includes("codex-use-action") && component.includes("onUseCodex"));
assert(!component.includes("Codex Agent Runtime"));
assert(!app.includes("function CodexRuntimeSettings"));
assert(app.includes("<CodexIntegrationSettings"));
for (const selector of [
  ".codex-integration-hero",
  ".codex-connection-list",
  ".codex-device-login",
  ".codex-advanced",
  "@media (max-width: 760px)",
]) assert(styles.includes(selector), `Missing Codex integration style: ${selector}`);

const temp = await mkdtemp(join(tmpdir(), "opendrsai-codex-settings-"));
try {
  const outfile = join(temp, "codex-settings.mjs");
  await build({
    entryPoints: [componentPath],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    loader: { ".svg": "dataurl", ".png": "dataurl" },
  });
  const { deriveCodexIntegrationViewModel } = await import(pathToFileURL(outfile).href);
  const health = (state = "ready") => ({ gateway: { liveness: { state } } });
  const status = (state, action = "none", extra = {}) => ({
    backendId: "codex", state, action, available: state === "available", version: "1.2.3",
    loggedIn: state === "available", authMode: null, accountLabel: null, reason: null, retryable: true,
    ...extra,
  });
  const cases = [
    [null, health(), null, true],
    [status("available"), health(), "use", false],
    [status("not_installed", "install"), health(), "install", true],
    [status("version_incompatible", "upgrade"), health(), "upgrade", true],
    [status("not_logged_in", "login"), health(), "login", true],
    [status("account_unavailable"), health(), "refresh", true],
    [status("fault", "restart"), health(), "restart", true],
    [status("available"), health("reconnecting"), null, false],
  ];
  for (const [backend, runtimeHealth, action, showSetup] of cases) {
    const view = deriveCodexIntegrationViewModel(backend, runtimeHealth, false);
    assert.equal(view.primaryAction, action, `Unexpected primary action for ${backend?.state ?? "loading"}`);
    assert.equal(view.showSetup, showSetup, `Unexpected setup visibility for ${backend?.state ?? "loading"}`);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("Codex integration settings UI verification passed (product definition, state matrix, progressive disclosure and responsive layout).");
