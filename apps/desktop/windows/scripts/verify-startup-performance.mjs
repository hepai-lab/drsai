import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const repoRoot = resolve(root, "..", "..", "..");
const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");
const launcher = read("apps/desktop/scripts/windows-desktop-dev.ps1");
const main = read("apps/desktop/windows/src/main/index.ts");
const gateway = read("apps/desktop/windows/src/main/gateway.ts");
const status = read("apps/desktop/windows/src/main/status.ts");
const health = read("apps/desktop/windows/src/renderer/src/adapters/useDesktopHealthAdapter.ts");
const chat = read("apps/desktop/windows/src/main/chat.ts");
const agentRuns = read("apps/desktop/windows/src/main/agentRuns.ts");
const plan = read("apps/desktop/windows/docs/startup-performance-plan.md");

const checks = [
  ["launcher makes Gateway opt-in", launcher.includes("[switch]$WithGateway") && launcher.includes("$StartGateway = $WithGateway")],
  ["launcher selects on-demand by default", launcher.includes('"on-demand"') && launcher.includes("OPENDRSAI_GATEWAY_STARTUP")],
  ["launcher caches backend validation", launcher.includes("BackendValidationStamp") && launcher.includes("backendFingerprint")],
  ["launcher caches frontend validation", launcher.includes("FrontendValidationStamp") && launcher.includes("frontendFingerprint")],
  ["main eager start is policy gated", main.includes('getGatewayStartupMode() !== "eager"')],
  ["background work waits for renderer load", main.includes('webContents.on("did-finish-load"') && main.includes("startDeferredStartupTasks")],
  ["startup milestones include launcher and renderer timing", launcher.includes("OPENDRSAI_DEV_START_EPOCH_MS") && main.includes('recordStartupMilestone("renderer-loaded")')],
  ["Gateway supports all startup modes", gateway.includes('"on-demand" | "eager" | "external"')],
  ["Gateway startup is coalesced", gateway.includes("gatewayStartPromise") && gateway.includes("startGatewayOnce")],
  ["startup health avoids endpoint diagnostics", status.includes("getStartupInstallStatus") && status.includes("getGatewaySnapshot")],
  ["deep diagnostics are deferred in renderer", health.includes("window.setTimeout") && health.includes("750")],
  ["renderer does not auto-start runtime", !health.includes("autoGatewayStarted") && !health.includes("autoInstallStarted")],
  ["chat starts runtime on demand", chat.includes("await startGateway()")],
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
