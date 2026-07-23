import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

const files = {
  sharedTypes: read("src/shared/browser/types.ts"),
  actionPolicy: read("src/shared/browser/actionPolicy.ts"),
  snapshotSchema: read("src/shared/browser/snapshotSchema.ts"),
  desktopApi: read("../shared/api/desktopApi.ts"),
  urlPolicy: read("src/main/browser/urlPolicy.ts"),
  actionApproval: read("src/main/browser/actionApproval.ts"),
  controller: read("src/main/browser/browserController.ts"),
  registry: read("src/main/browser/browserControllerRegistry.ts"),
  electron: read("src/main/browser/adapters/electronWebviewController.ts"),
  main: read("src/main/index.ts"),
};

const checks = [
  ["shared BrowserController result types", files.sharedTypes.includes("BrowserPageState") && files.sharedTypes.includes("BrowserSnapshot") && files.sharedTypes.includes("BrowserScreenshot")],
  ["shared BrowserAction request/result types", files.sharedTypes.includes("BrowserActionRequest") && files.sharedTypes.includes("BrowserActionResult") && files.desktopApi.includes('from "./browser/types"')],
  ["shared action policy approval split", files.actionPolicy.includes("browserActionRequiresApproval") && files.actionPolicy.includes("isReadOnlyBrowserAction") && files.actionPolicy.includes("validateBrowserActionRequest")],
  ["shared sensitive action policy", files.actionPolicy.includes("browserActionRequiresSensitiveApproval") && files.actionPolicy.includes("Sensitive browser actions require explicit approval")],
  ["shared snapshot schema validator", files.snapshotSchema.includes("isBrowserSnapshot") && files.snapshotSchema.includes("visibleText")],
  ["main URL policy module", files.urlPolicy.includes("checkBrowserUrlSync") && files.urlPolicy.includes("Public browser preview requires HTTPS") && files.urlPolicy.includes("Browser preview does not allow credentials")],
  ["main action approval module", files.actionApproval.includes("approveBrowserActionRequest") && files.actionApproval.includes("validateBrowserActionRequest") && files.actionApproval.includes("checkBrowserUrlSync")],
  ["controller interface covers roadmap actions", files.controller.includes("interface BrowserController") && ["open", "back", "forward", "reload", "stop", "snapshot", "screenshot", "readText", "click", "type", "select", "keyPress", "waitFor", "assertText"].every((name) => files.controller.includes(`${name}(`))],
  ["controller registry exists", files.registry.includes("registerBrowserController") && files.registry.includes("getBrowserController") && files.registry.includes("listBrowserControllerEngines")],
  ["electron adapter is replaceable", files.electron.includes("implements BrowserController") && files.electron.includes('readonly engine = "electron-webview"')],
  ["main IPC uses shared approval policy", files.main.includes("approveBrowserActionRequest(request)") && !files.main.includes("const allowedActions = new Set")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

if (failed.length) {
  console.error(`\nBrowser controller verification failed: ${failed.length} check(s) failed.`);
  process.exit(1);
}

console.log("\nBrowser controller verification passed.");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}
