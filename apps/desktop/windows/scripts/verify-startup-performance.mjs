import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const repoRoot = resolve(root, "..", "..", "..");
const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");
const launcher = read("apps/desktop/windows/scripts/dev.ps1");
const launcherCommand = read("apps/desktop/windows-desktop-dev.cmd");
const outputRunner = read("apps/desktop/windows/scripts/run-dev-with-filter.mjs");
const brandedElectronRunner = read("apps/desktop/windows/scripts/run-branded-electron-vite.mjs");
const main = read("apps/desktop/windows/src/main/index.ts");
const gateway = read("apps/desktop/windows/../shared/main/gateway.ts");
const status = read("apps/desktop/windows/src/main/status.ts");
const health = read("apps/desktop/windows/../shared/renderer/src/adapters/useDesktopHealthAdapter.ts");
const chat = read("apps/desktop/windows/../shared/main/chat.ts");
const agentRuns = read("apps/desktop/windows/../shared/main/agentRuns.ts");
const plan = read("apps/desktop/windows/docs/startup-performance-plan.md");

const checks = [
  ["launcher separates Gateway startup from hot-load", launcher.includes("[switch]$HotLoad") && launcher.includes("$GatewayEnabled = -not $NoGateway") && launcher.includes("$GatewayHotReload = $GatewayEnabled -and $HotLoad")],
  ["developer command leaves Gateway hot-load opt-in", launcherCommand.includes("-LaunchMode Development") && !launcherCommand.includes("-HotLoad")],
  ["launcher starts Gateway eagerly by default", launcher.includes('if ($GatewayEnabled) { "eager" } else { "on-demand" }')],
  ["normal source Gateway stops with Desktop", launcher.includes('$env:OPENDRSAI_RUNTIME_PERSIST = "0"') && main.includes("shutdownGateway(true)")],
  ["hot-load Gateway watcher stops with Desktop", launcher.includes("Stop-ProcessTree -Process $GatewayProcess") && gateway.includes("DEV_MANAGED_EXTERNAL_GATEWAY && !isProcessRunning(proc)")],
  ["launcher caches backend validation", launcher.includes("BackendValidationStamp") && launcher.includes("backendFingerprint")],
  ["launcher caches frontend validation", launcher.includes("FrontendValidationStamp") && launcher.includes("frontendFingerprint")],
  ["launcher uses a byte-preserving dev output filter", launcher.includes("run-dev-with-filter.mjs") && outputRunner.includes("DevStderrFilter") && outputRunner.includes('stdio: ["inherit", "inherit", "pipe"]')],
  ["Windows npm.cmd launch bypasses shell through npm-cli.js", outputRunner.includes("spawnNpm") && outputRunner.includes('"npm-cli.js"') && outputRunner.includes('shell: false') && !outputRunner.includes('shell: process.platform === "win32"') && !outputRunner.includes("ComSpec")],
  ["branded Electron resolves workspace packages", brandedElectronRunner.includes("createRequire") && brandedElectronRunner.includes("resolvePackageRoot") && !brandedElectronRunner.includes('join(appDir, "node_modules"')],
  ["output filter preserves startup logs while filtering only known libpng warning", outputRunner.includes("KNOWN_LIBPNG_WARNING") && outputRunner.includes("this.push(line)") && outputRunner.includes("showLibPngWarnings")],
  ["Gateway hot reload reuses the existing console", launcher.includes("-NoNewWindow `") && !launcher.includes("-WindowStyle Hidden `\n        -RedirectStandardOutput $stdout")],
  ["main eager start is policy gated", main.includes('getGatewayStartupMode() !== "eager"')],
  ["background work waits for renderer load", main.includes('webContents.on("did-finish-load"') && main.includes("startDeferredStartupTasks")],
  ["startup milestones include launcher and renderer timing", launcher.includes("OPENDRSAI_DEV_START_EPOCH_MS") && main.includes('recordStartupMilestone("renderer-loaded")')],
  ["Gateway supports all startup modes", gateway.includes('"on-demand" | "eager" | "external"')],
  ["Gateway startup is coalesced", gateway.includes("gatewayStartPromise") && gateway.includes("startGatewayOnce")],
  ["Windows Gateway fallback disables uvicorn reload workers", gateway.includes('HOT_RELOAD_GATEWAY && process.platform !== "win32"')],
  ["development Gateway never falls back to a non-reloading internal process", gateway.includes("if (DEV_MANAGED_EXTERNAL_GATEWAY)") && gateway.includes("refusing to start a non-reloading fallback Runtime")],
  ["startup health avoids endpoint diagnostics", status.includes("getStartupInstallStatus") && status.includes("getGatewaySnapshot")],
  ["deep diagnostics are deferred in renderer", health.includes("window.setTimeout") && health.includes("750")],
  ["renderer does not auto-start runtime", !health.includes("autoGatewayStarted") && !health.includes("autoInstallStarted")],
  ["chat starts runtime on demand", chat.includes("await connectRuntimeClientForWorkspace(")],
  ["agent runs start runtime on demand", agentRuns.includes("await startGateway()")],
  ["plan contains acceptance criteria", plan.includes("## Acceptance criteria") && plan.includes("Concurrent first-use requests")],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("Startup performance verification failed:");
  for (const [name] of failed) console.error(`- ${name}`);
  process.exit(1);
}
console.log(`Startup performance verification passed (${checks.length} checks).`);
