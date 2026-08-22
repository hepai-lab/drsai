import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { macosIpcSource } from "./desktopIpcSource.mjs";

const macosRoot = resolve(process.cwd());
const read = (path) => readFileSync(join(macosRoot, path), "utf8");
const main = read("src/main/index.ts");
const windowBootstrap = read("src/main/bootstrap/createWindow.ts");
const appServices = read("src/main/bootstrap/createAppServices.ts");
const appIntegrations = read("src/main/bootstrap/installAppIntegrations.ts");
const mainIpc = macosIpcSource(resolve(macosRoot, ".."));
const platform = read("src/main/platform.ts");
const services = read("src/main/platformServices.ts");
const terminal = read("src/main/platformTerminals.ts");
const credentials = read("src/main/platformCredentials.ts");
const legacyCredentials = read("src/main/native/legacyCredentialService.ts");
const nativeCredentials = read("src/main/native/nativeCredentialService.ts");
const processes = read("src/main/platformProcesses.ts");
const terminalSessions = read("src/main/terminal.ts");
const config = read("electron.vite.config.ts");
const rendererApp = read("../shared/renderer/src/App.tsx");
const portForwards = read("../shared/main/portForwards.ts");
const remoteWorkspace = read("../shared/main/remoteWorkspaceController.ts");
const remoteAccessIpc = read("src/main/ipc/registerRemoteAccessIpc.ts");

assert.ok(platform.includes('id: "macos"') && platform.includes('defaultTerminalShell: "zsh"'));
assert.ok(terminal.includes('"/bin/zsh"') && terminal.includes('"/bin/bash"'));
assert.ok(legacyCredentials.includes('"/usr/bin/security"') && legacyCredentials.includes("add-generic-password") && legacyCredentials.includes("find-generic-password"), "Legacy Keychain reference compatibility is missing");
assert.ok(credentials.includes("createNativeMacosCredentialService") && nativeCredentials.includes('invoke("keychain.put"') && nativeCredentials.includes("result.kind === \"unavailable\""), "Native Keychain adapter or fail-safe legacy fallback is missing");
assert.ok(processes.includes("const group = -Math.abs(pid)") && processes.includes("signalledGroup ? group : pid") && processes.includes('"SIGTERM"') && processes.includes('"SIGKILL"'), "macOS process cleanup must gracefully terminate a process group and safely fall back to the child PID");
assert.ok(windowBootstrap.includes('titleBarStyle: "hiddenInset"') && windowBootstrap.includes("trafficLightPosition"));
assert.ok(main.includes("createSecureIpcHandle") && main.includes("getTrustedWebContents"), "macOS IPC handlers must use the shared trust boundary");
assert.ok(appServices.includes("createDesktopIpcAuditWriter") && appServices.includes('"desktop-ipc-audit.jsonl"') && main.includes("appServices = createMacosAppServices"), "macOS IPC audit log is not configured after app readiness");
assert.ok(mainIpc.includes("assertAllowedExternalUrl") && mainIpc.includes("assertAllowedDesktopPath"), "macOS URL/path handlers omit the shared security policy");
for (const lifecycleContract of [
  "requestSingleInstanceLock", 'app.on("second-instance"', 'app.on("open-url"', 'app.on("open-file"',
  'setAsDefaultProtocolClient("opendrsai")', "app.dock?.setMenu", 'role: "help"',
  'app.on("window-all-closed"', "focusOrCreateMainWindow", '"desktop:open-request"',
]) {
  assert.ok(`${main}\n${appIntegrations}`.includes(lifecycleContract), `macOS lifecycle omits ${lifecycleContract}`);
}
for (const recoveryContract of [
  'app.on("child-process-gone"', 'process.on("uncaughtException"', 'process.on("unhandledRejection"',
  'powerMonitor.on("suspend"', 'powerMonitor.on("resume"', 'powerMonitor.on("shutdown"',
  'screen.on("display-added"', 'screen.on("display-removed"', 'screen.on("display-metrics-changed"',
  "net.isOnline()", "ensureMainWindowOnScreen", '"desktop:lifecycle-event"',
]) {
  assert.ok(`${main}\n${appIntegrations}`.includes(recoveryContract), `macOS recovery lifecycle omits ${recoveryContract}`);
}
for (const recoveryContract of ['webContents.on("render-process-gone"', 'window.on("unresponsive"', 'window.on("responsive"']) {
  assert.ok(windowBootstrap.includes(recoveryContract), `macOS window recovery lifecycle omits ${recoveryContract}`);
}
assert.equal(main.includes('app.on("window-all-closed", () => app.quit())'), false, "macOS must stay active after the last window closes");
for (const capability of ["features.browser", "features.debugger", "features.terminal"]) {
  assert.ok(rendererApp.includes(capability), `renderer does not gate ${capability}`);
}
assert.ok(main.includes('join(app.getAppPath(), "out", "preload", "index.mjs")') && main.includes('join(app.getAppPath(), "out", "renderer", "index.html")'), "main window assets must resolve from the packaged App root");
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
  "desktop:cancel-chat-turn",
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
  assert.ok(mainIpc.includes(channel), `macOS shared feature IPC omits ${channel}`);
}
assert.ok(terminalSessions.includes('from "node-pty"') && terminalSessions.includes('"desktop:terminal-data"'));
assert.ok(main.includes("killAllTerminalSessions") && main.includes('app.on("before-quit"'));
assert.ok(config.includes('resolve("../shared/renderer")') && config.includes('resolve("../shared/renderer/index.html")'));
for (const service of ["paths", "terminal", "credentials", "notifications", "processes"]) {
  assert.ok(services.includes(`${service}:`), `macOS platform services omit ${service}`);
}
assert.equal(/(?:windows\/|\\windows\\)/i.test([main, platform, services, terminal, credentials, processes].join("\n")), false);
for (const [name, source] of [["Port Forward", portForwards], ["Remote Workspace", remoteWorkspace]]) {
  assert.ok(source.includes('"-S", "none"'), `${name} long-lived tunnel must own an SSH process instead of exiting after registering with ControlMaster`);
  assert.ok(source.includes('"ExitOnForwardFailure=yes"'), `${name} tunnel must fail closed when forwarding cannot be established`);
}
assert.ok(remoteAccessIpc.includes('source: "connector", actionKind: "external.service"'), "Remote Gateway Approval must use a valid source/action policy pair");
console.log("macOS shell contract passed (window, shared renderer/preload, zsh/bash, Keychain, notifications, process lifecycle).")
