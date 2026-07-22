import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const macosRoot = resolve(process.cwd());
const read = (path) => readFileSync(join(macosRoot, path), "utf8");
const main = read("src/main/index.ts");
const platform = read("src/main/platform.ts");
const services = read("src/main/platformServices.ts");
const terminal = read("src/main/platformTerminals.ts");
const credentials = read("src/main/platformCredentials.ts");
const processes = read("src/main/platformProcesses.ts");
const terminalSessions = read("src/main/terminal.ts");
const config = read("electron.vite.config.ts");
const rendererApp = read("../shared/renderer/src/App.tsx");

assert.ok(platform.includes('id: "macos"') && platform.includes('defaultTerminalShell: "zsh"'));
assert.ok(terminal.includes('"/bin/zsh"') && terminal.includes('"/bin/bash"'));
assert.ok(credentials.includes('"/usr/bin/security"') && credentials.includes("add-generic-password") && credentials.includes("find-generic-password"));
assert.ok(processes.includes("process.kill(-Math.abs(pid)") && processes.includes('"SIGTERM"'));
assert.ok(main.includes('titleBarStyle: "hiddenInset"') && main.includes("trafficLightPosition"));
assert.ok(main.includes("createSecureIpcHandle") && main.includes("getTrustedWebContents"), "macOS IPC handlers must use the shared trust boundary");
assert.ok(main.includes("createDesktopIpcAuditWriter") && main.includes('"desktop-ipc-audit.jsonl"'), "macOS IPC audit log is not configured");
assert.ok(main.includes("assertAllowedExternalUrl") && main.includes("assertAllowedDesktopPath"), "macOS URL/path handlers omit the shared security policy");
for (const lifecycleContract of [
  "requestSingleInstanceLock", 'app.on("second-instance"', 'app.on("open-url"', 'app.on("open-file"',
  'setAsDefaultProtocolClient("opendrsai")', "app.dock?.setMenu", 'role: "help"',
  'app.on("window-all-closed"', "focusOrCreateMainWindow", '"desktop:open-request"',
]) {
  assert.ok(main.includes(lifecycleContract), `macOS lifecycle omits ${lifecycleContract}`);
}
for (const recoveryContract of [
  'webContents.on("render-process-gone"', 'window.on("unresponsive"', 'window.on("responsive"',
  'app.on("child-process-gone"', 'process.on("uncaughtException"', 'process.on("unhandledRejection"',
  'powerMonitor.on("suspend"', 'powerMonitor.on("resume"', 'powerMonitor.on("shutdown"',
  'screen.on("display-added"', 'screen.on("display-removed"', 'screen.on("display-metrics-changed"',
  "net.isOnline()", "ensureMainWindowOnScreen", '"desktop:lifecycle-event"',
]) {
  assert.ok(main.includes(recoveryContract), `macOS recovery lifecycle omits ${recoveryContract}`);
}
assert.equal(main.includes('app.on("window-all-closed", () => app.quit())'), false, "macOS must stay active after the last window closes");
for (const capability of ["features.browser", "features.debugger", "features.terminal"]) {
  assert.ok(rendererApp.includes(capability), `renderer does not gate ${capability}`);
}
assert.ok(main.includes('"../preload/index.mjs"'));
for (const channel of [
  "desktop:get-auth-session",
  "desktop:bootstrap",
  "desktop:get-health",
  "desktop:get-install-status",
  "desktop:start-install",
  "desktop:check-for-updates",
  "desktop:login",
  "desktop:start-oidc-login",
  "desktop:cancel-oidc-login",
  "desktop:refresh-auth-session",
  "desktop:logout",
  "desktop:get-gateway-status",
  "desktop:start-gateway",
  "desktop:stop-gateway",
  "desktop:list-agents",
  "desktop:get-platform-agent-status",
  "desktop:set-default-agent",
  "desktop:record-agent-usage",
  "desktop:list-threads",
  "desktop:create-thread",
  "desktop:update-thread",
  "desktop:get-thread-snapshot",
  "desktop:update-thread-snapshot",
  "desktop:list-workspaces",
  "desktop:create-workspace",
  "desktop:update-workspace",
  "desktop:delete-workspace",
  "desktop:start-agent-run",
  "desktop:abort-agent-run",
  "desktop:start-chat",
  "desktop:abort-chat",
  "desktop:terminal-create",
  "desktop:terminal-list",
  "desktop:terminal-write",
  "desktop:terminal-resize",
  "desktop:terminal-kill",
  "desktop:pick-files",
  "desktop:pick-folder",
  "desktop:workspace-files",
  "desktop:workspace-file-preview",
  "desktop:workspace-file-save-as",
  "desktop:workspace-file-write",
  "desktop:workspace-git-diff",
  "desktop:material-role-analysis",
  "desktop:voice-transcription-start",
  "desktop:voice-runtime-status",
  "desktop:voice-synthesis-start",
  "desktop:voice-synthesis-runtime-status",
  "desktop:voice-handoff-write",
]) {
  assert.ok(main.includes(channel), `macOS shared feature IPC omits ${channel}`);
}
assert.ok(terminalSessions.includes('from "node-pty"') && terminalSessions.includes('"desktop:terminal-data"'));
assert.ok(main.includes("killAllTerminalSessions") && main.includes('app.on("before-quit"'));
assert.ok(config.includes('resolve("../shared/renderer")') && config.includes('resolve("../shared/renderer/index.html")'));
for (const service of ["paths", "terminal", "credentials", "notifications", "processes"]) {
  assert.ok(services.includes(`${service}:`), `macOS platform services omit ${service}`);
}
assert.equal(/(?:windows\/|\\windows\\)/i.test([main, platform, services, terminal, credentials, processes].join("\n")), false);
console.log("macOS shell contract passed (window, shared renderer/preload, zsh/bash, Keychain, notifications, process lifecycle).")
