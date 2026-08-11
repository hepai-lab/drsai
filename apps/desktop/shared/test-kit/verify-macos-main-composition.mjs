import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { macosIpcSource } from "./desktopIpcSource.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(desktopRoot, path), "utf8");
const index = read("macos/src/main/index.ts");
const windowModule = read("macos/src/main/bootstrap/createWindow.ts");
const appReadyPlan = read("macos/src/main/bootstrap/appReadyPlan.ts");
const platformBindings = read("macos/src/main/bootstrap/configurePlatformBindings.ts");
const appServiceFactory = read("macos/src/main/bootstrap/createAppServices.ts");
const mcpCoordinators = read("macos/src/main/bootstrap/createMcpCoordinators.ts");
const appIntegrations = read("macos/src/main/bootstrap/installAppIntegrations.ts");
const shutdownPlan = read("macos/src/main/bootstrap/shutdownPlan.ts");
const platformIpc = read("macos/src/main/ipc/registerPlatformIpc.ts");
const sharingIpc = read("macos/src/main/ipc/registerSharingIpc.ts");
const customizationIpc = read("macos/src/main/ipc/registerCustomizationIpc.ts");
const automationIpc = read("macos/src/main/ipc/registerAutomationIpc.ts");
const connectionsIpc = read("macos/src/main/ipc/registerConnectionsIpc.ts");
const workspaceIpc = read("macos/src/main/ipc/registerWorkspaceIpc.ts");
const workspaceHistoryIpc = read("macos/src/main/ipc/registerWorkspaceHistoryIpc.ts");
const remoteAccessIpc = read("macos/src/main/ipc/registerRemoteAccessIpc.ts");
const diagnosticsIpc = read("macos/src/main/ipc/registerDiagnosticsIpc.ts");
const trustIpc = read("macos/src/main/ipc/registerTrustIpc.ts");
const terminalIpc = read("macos/src/main/ipc/registerTerminalIpc.ts");
const voiceIpc = read("macos/src/main/ipc/registerVoiceIpc.ts");
const runtimeServicesIpc = read("macos/src/main/ipc/registerRuntimeServicesIpc.ts");
const catalogIpc = read("macos/src/main/ipc/registerCatalogIpc.ts");
const presentationIpc = read("macos/src/main/ipc/registerPresentationIpc.ts");
const executionIpc = read("macos/src/main/ipc/registerExecutionIpc.ts");
const allIpc = read("macos/src/main/ipc/registerAllIpc.ts");
const serviceContainer = read("macos/src/main/serviceContainer.ts");
const lineCount = (source) => source.split(/\r?\n/).length;

assert.ok(index.includes('from "./bootstrap/createWindow"'), "macOS composition root must import the window bootstrap module");
assert.equal(index.includes("new BrowserWindow("), false, "BrowserWindow construction must stay outside the composition root");
assert.ok(lineCount(index) <= 350, `P2-F02.5 composition root budget exceeded: ${lineCount(index)} > 350`);
assert.ok(lineCount(windowModule) <= 180, `window bootstrap budget exceeded: ${lineCount(windowModule)} > 180`);
assert.ok(lineCount(appReadyPlan) <= 100, `app-ready plan budget exceeded: ${lineCount(appReadyPlan)} > 100`);
assert.ok(lineCount(platformBindings) <= 120, `platform bindings budget exceeded: ${lineCount(platformBindings)} > 120`);
assert.ok(lineCount(appServiceFactory) <= 140, `app service factory budget exceeded: ${lineCount(appServiceFactory)} > 140`);
assert.ok(lineCount(mcpCoordinators) <= 140, `MCP coordinator budget exceeded: ${lineCount(mcpCoordinators)} > 140`);
assert.ok(lineCount(appIntegrations) <= 140, `app integrations budget exceeded: ${lineCount(appIntegrations)} > 140`);
assert.ok(lineCount(shutdownPlan) <= 100, `shutdown plan budget exceeded: ${lineCount(shutdownPlan)} > 100`);
assert.ok(lineCount(platformIpc) <= 300, `platform IPC registrar budget exceeded: ${lineCount(platformIpc)} > 300`);
assert.ok(lineCount(sharingIpc) <= 300, `sharing IPC registrar budget exceeded: ${lineCount(sharingIpc)} > 300`);
assert.ok(lineCount(customizationIpc) <= 300, `customization IPC registrar budget exceeded: ${lineCount(customizationIpc)} > 300`);
assert.ok(lineCount(automationIpc) <= 300, `automation IPC registrar budget exceeded: ${lineCount(automationIpc)} > 300`);
assert.ok(lineCount(connectionsIpc) <= 300, `connections IPC registrar budget exceeded: ${lineCount(connectionsIpc)} > 300`);
assert.ok(lineCount(workspaceIpc) <= 300, `workspace IPC registrar budget exceeded: ${lineCount(workspaceIpc)} > 300`);
assert.ok(lineCount(workspaceHistoryIpc) <= 300, `workspace history IPC registrar budget exceeded: ${lineCount(workspaceHistoryIpc)} > 300`);
assert.ok(lineCount(remoteAccessIpc) <= 300, `remote access IPC registrar budget exceeded: ${lineCount(remoteAccessIpc)} > 300`);
assert.ok(lineCount(diagnosticsIpc) <= 300, `diagnostics IPC registrar budget exceeded: ${lineCount(diagnosticsIpc)} > 300`);
assert.ok(lineCount(trustIpc) <= 300, `trust IPC registrar budget exceeded: ${lineCount(trustIpc)} > 300`);
assert.ok(lineCount(terminalIpc) <= 300, `terminal IPC registrar budget exceeded: ${lineCount(terminalIpc)} > 300`);
assert.ok(lineCount(voiceIpc) <= 300, `voice IPC registrar budget exceeded: ${lineCount(voiceIpc)} > 300`);
assert.ok(lineCount(runtimeServicesIpc) <= 300, `runtime services IPC registrar budget exceeded: ${lineCount(runtimeServicesIpc)} > 300`);
assert.ok(lineCount(catalogIpc) <= 300, `catalog IPC registrar budget exceeded: ${lineCount(catalogIpc)} > 300`);
assert.ok(lineCount(presentationIpc) <= 300, `presentation IPC registrar budget exceeded: ${lineCount(presentationIpc)} > 300`);
assert.ok(lineCount(executionIpc) <= 300, `execution IPC registrar budget exceeded: ${lineCount(executionIpc)} > 300`);
assert.ok(lineCount(allIpc) <= 120, `IPC assembly budget exceeded: ${lineCount(allIpc)} > 120`);
assert.ok(lineCount(serviceContainer) <= 160, `service container contract budget exceeded: ${lineCount(serviceContainer)} > 160`);
for (const registrar of ["registerMacosPlatformIpc", "registerMacosSharingIpc", "registerMacosCustomizationIpc", "registerMacosAutomationIpc", "registerMacosConnectionsIpc", "registerMacosWorkspaceIpc", "registerMacosWorkspaceHistoryIpc", "registerMacosRemoteAccessIpc", "registerMacosDiagnosticsIpc", "registerMacosTrustIpc", "registerMacosTerminalIpc", "registerMacosVoiceIpc", "registerMacosRuntimeServicesIpc", "registerMacosCatalogIpc", "registerMacosPresentationIpc", "registerMacosExecutionIpc"]) {
  assert.ok(allIpc.includes(`${registrar}(`), `IPC assembly omits ${registrar}`);
}
assert.ok(index.includes("registerMacosDesktopIpc({"), "composition root must invoke the complete IPC assembly explicitly");
assert.ok(index.includes("interactiveDebugger: appServices.interactiveDebugger, interactiveDebugPolicy: appServices.interactiveDebugPolicy"), "composition root must inject app-ready diagnostics services explicitly");
assert.ok(index.includes("trust: mcpCoordinators"), "composition root must inject MCP coordinators explicitly");
assert.ok(index.includes("voice: { getTrustedWebContents: () => mainWindow?.webContents, allowDevelopmentRendererUrl }"), "composition root must inject trusted voice port dependencies explicitly");
assert.ok(index.includes("runtimeServices: { browserTaskService: appServices.browserTaskService }"), "composition root must inject browser runtime service explicitly");
assert.ok(index.includes("catalog: { mobilePairingControllerFor }"), "composition root must inject sender-scoped pairing factory explicitly");
assert.equal(index.includes('ipcMain.handle("desktop:platform-descriptor"'), false, "platform IPC channels must not leak back into the composition root");
assert.equal(index.includes('ipcMain.handle("desktop:share-create"'), false, "sharing IPC channels must not leak back into the composition root");
assert.equal(index.includes('ipcMain.handle("desktop:user-preferences-list"'), false, "customization IPC channels must not leak back into the composition root");
assert.equal(index.includes('ipcMain.handle("desktop:workflow-marketplace-list"'), false, "automation IPC channels must not leak back into the composition root");
assert.equal(index.includes('ipcMain.handle("desktop:channel-adapters-list"'), false, "connections IPC channels must not leak back into the composition root");
assert.equal(index.includes('ipcMain.handle("desktop:workspace-files"'), false, "workspace IPC channels must not leak back into the composition root");
assert.equal(index.includes('ipcMain.handle("desktop:workspace-checkpoint-restore"'), false, "workspace history IPC channels must not leak back into the composition root");
assert.equal(index.includes('ipcMain.handle("desktop:remote-gateway-install-approval"'), false, "remote access IPC channels must not leak back into the composition root");
assert.equal(index.includes('ipcMain.handle("desktop:diagnostics-record"'), false, "diagnostics IPC channels must not leak back into the composition root");
assert.equal(index.includes('ipcMain.handle("desktop:git-commit-approval"'), false, "trust IPC channels must not leak back into the composition root");
assert.equal(index.includes('ipcMain.handle("desktop:terminal-create"'), false, "terminal IPC channels must not leak back into the composition root");
assert.equal(index.includes('rawIpcMain.on("desktop:voice-streaming-audio-port"'), false, "voice raw IPC channel must not leak back into the composition root");
assert.equal(index.includes('ipcMain.handle("desktop:get-auth-session"'), false, "runtime services IPC channels must not leak back into the composition root");
assert.equal(index.includes('ipcMain.handle("desktop:mobile-pairing-create"'), false, "catalog IPC channels must not leak back into the composition root");
assert.equal([...index.matchAll(/ipcMain\.handle\(\s*["']desktop:/g)].length, 0, "all desktop invoke channels must live outside the composition root");
assert.equal(index.includes("function isRemoteWorkspaceTarget"), false, "remote workspace routing helper must not leak back into the composition root");
assert.equal(index.includes("async function proposeChannelOutboundDraft"), false, "connections approval workflow must not leak back into the composition root");
for (const contract of ['Pick<MacosServiceContainer, "workspace" | "approvals">', "services.workspace.assertPath"]) {
  assert.ok(customizationIpc.includes(contract), `customization IPC service boundary omits ${contract}`);
}
for (const contract of ["interface MacosServiceContainer", "assertPath(raw: unknown)", 'Pick<PersistentApprovalStore, "propose" | "list" | "decide">', "getScheduledTaskWorkerStatus(): unknown"]) {
  assert.ok(serviceContainer.includes(contract), `service container contract omits ${contract}`);
}
for (const contract of ['Pick<MacosServiceContainer, "workspace" | "automation">', "services.automation.getScheduledTaskWorkerStatus()", "services.automation.scheduledTaskRuntime"]) {
  assert.ok(automationIpc.includes(contract), `automation IPC service boundary omits ${contract}`);
}
for (const contract of ['Pick<MacosServiceContainer, "workspace" | "approvals">', "createChannelOutboundDraftApproval", "executeChannelOutboundDeliveryAsync", "services.approvals.propose", 'verification: "No connector proposal was queued or delivered."']) {
  assert.ok(connectionsIpc.includes(contract), `connections IPC service boundary omits ${contract}`);
}
for (const contract of ['Pick<MacosServiceContainer, "workspace">', "services.workspace.isRemoteTarget", "services.workspace.isRemotePath", "remoteWorkspaceController.mutateGit"]) {
  assert.ok(workspaceIpc.includes(contract), `workspace IPC service boundary omits ${contract}`);
}
for (const contract of ["isRemoteTarget(workspacePath?: string, workspaceId?: string)", "isRemotePath(path: unknown): boolean"]) {
  assert.ok(serviceContainer.includes(contract), `workspace routing contract omits ${contract}`);
}
for (const contract of ['Pick<MacosServiceContainer, "workspace" | "approvals">', "services.workspace.allowedRoots()", "services.approvals.propose", 'idempotencyKey: `checkpoint-restore:', 'checkpoint.reviewStatus !== "pending"']) {
  assert.ok(workspaceHistoryIpc.includes(contract), `workspace history boundary omits ${contract}`);
}
assert.ok(serviceContainer.includes("allowedRoots(): Promise<string[]>"), "workspace path roots capability is missing from service container");
for (const contract of ['Pick<MacosServiceContainer, "approvals">', "validateRemoteGatewayInstallRequest", "services.approvals.propose", 'idempotencyKey: `remote-gateway:', "portForwardRegistry.suspendHost", "portForwardRegistry.resumeHost", "workspace.remote.hostAlias !== hostAlias"]) {
  assert.ok(remoteAccessIpc.includes(contract), `remote access boundary omits ${contract}`);
}
for (const contract of ["interface MacosDiagnosticsIpcDependencies", "sourceNavigator: DiagnosticSourceNavigator", "interactiveDebugger: InteractiveDebuggerService", "interactiveDebugPolicy: InteractiveDebugPolicyStore", "services.workspace.allowedRoots()", "replaceFileSafely", 'mode: 0o600', "assertAllowedDesktopPath"]) {
  assert.ok(diagnosticsIpc.includes(contract), `diagnostics boundary omits ${contract}`);
}
for (const contract of ["interface MacosTrustIpcDependencies", "requestMcpEnumeration(raw: unknown)", "requestMcpExecution(raw: unknown)", "services.approvals.propose", "services.approvals.decide", "gitCommitApprovalIdempotencyKey", "executeForkConflictDraftWrite", "cancelMcpActiveSession", "startAgentRun(event.sender"]) {
  assert.ok(trustIpc.includes(contract), `trust boundary omits ${contract}`);
}
for (const contract of ["services.workspace.allowedRoots()", "createTerminalSession(event", "listTerminalSessions(event", "writeTerminalSession(event"]) assert.ok(terminalIpc.includes(contract), `terminal boundary omits ${contract}`);
for (const contract of ['rawIpcMain: Pick<IpcMain, "on">', "isTrustedDesktopIpcSender", "dependencies.getTrustedWebContents()", "dependencies.allowDevelopmentRendererUrl", "port?.close()", "attachStreamingVoiceAudioPort(event.sender"]) assert.ok(voiceIpc.includes(contract), `voice boundary omits ${contract}`);
for (const contract of ["interface MacosRuntimeServicesIpcDependencies", "browserTaskService: BrowserTaskService", "hasActiveChats() || hasActiveAgentRuns()", "electronSession.defaultSession.clearStorageData()", "services.workspace.assertPath", "assertAllowedExternalUrl", "app.isPackaged"]) assert.ok(runtimeServicesIpc.includes(contract), `runtime services boundary omits ${contract}`);
for (const contract of ["interface MacosCatalogIpcDependencies", "mobilePairingControllerFor(sender: WebContents)", "dependencies.mobilePairingControllerFor(event.sender)", '(options as { refresh?: unknown }).refresh === true', "services.workspace.assertPath", 'workspace?.location === "remote"']) assert.ok(catalogIpc.includes(contract), `catalog boundary omits ${contract}`);
for (const contract of ["const runs = new Map", "ownerId: event.sender.id", "run.ownerId !== event.sender.id", "run.activeOperationController?.abort()", "run.resumeWaiters", "recordManagerPresentationProgress", "services.workspace.assertPath"]) assert.ok(presentationIpc.includes(contract), `presentation boundary omits ${contract}`);
for (const contract of ["services.workspace.assertPath", "getA5ServiceGuidanceScenario()", "startAgentRun(event.sender", "recoverAgentRun(threadId, event.sender)", "startChat(event.sender", "recoverChatRun(request, event.sender)"]) assert.ok(executionIpc.includes(contract), `execution boundary omits ${contract}`);
for (const contract of [
  "new BrowserWindow(", 'titleBarStyle: "hiddenInset"', "trafficLightPosition", "contextIsolation: true",
  "nodeIntegration: false", "sandbox: false", 'webContents.on("render-process-gone"',
  'window.on("unresponsive"', 'window.on("responsive"', "setWindowOpenHandler", "assertAllowedExternalUrl",
]) assert.ok(windowModule.includes(contract), `window bootstrap omits ${contract}`);
for (const contract of ["onDidFinishLoad", "onRendererGone", "onWebContentsDestroyed", "onClosed"]) {
  assert.ok(index.includes(`${contract}:`), `composition root omits ${contract} orchestration`);
}
for (const contract of ["createMacosShutdownPlan", 'name: "scheduled-task-worker"', 'name: "terminal-sessions"', 'name: "approval-store"', 'name: "remote-workspaces"', 'name: "agent-journal"', 'name: "chat-journal"', 'name: "gateway"']) {
  assert.ok(shutdownPlan.includes(contract), `shutdown plan omits ordered resource ${contract}`);
}
assert.ok(index.includes("createMacosShutdownPlan({"), "composition root must inject shutdown dependencies explicitly");
assert.ok(index.includes("shutdownCoordinator.run(plan.map((step) => step.run), 15_000)"), "composition root must execute the named shutdown plan through the bounded coordinator");
for (const contract of ["runMacosAppReadyPlan", "for (const step of steps)", "if (step.critical) throw error", "degraded.push(failure)"]) {
  assert.ok(appReadyPlan.includes(contract), `app-ready plan omits ${contract}`);
}
assert.ok(index.includes('name: "core-state", critical: true'), "core startup state must remain fail-closed");
assert.ok(index.includes('name: "workflow-run-recovery", critical: false'), "workflow recovery must degrade without aborting app startup");
for (const contract of ["configureMacosPlatformBindings", "configureMacosRemoteTerminalResolver", "configureAuthPlatform", "configureRuntimeWorkspaceRouting", "configureChannelProviderAuth", "configureChatRemoteRouting", "configureWorkspaceFileDialogs"]) {
  assert.ok(platformBindings.includes(contract), `app-ready platform bindings omit ${contract}`);
}
assert.ok(index.includes("await configureMacosPlatformBindings({"), "platform bindings must run explicitly after app readiness");
for (const sideEffect of ["configureMacosRemoteTerminalResolver(", "configureAuthPlatform(", "configureRuntimeWorkspaceRouting(", "configureChannelProviderAuth(", "configureChatRemoteRouting(", "configureWorkspaceFileDialogs("]) {
  assert.equal(index.includes(sideEffect), false, `composition root retains import-time platform binding ${sideEffect}`);
}
for (const contract of ["createMacosAppServices", "new InteractiveDebugPolicyStore", "new InteractiveDebuggerService", "new BrowserTaskService", "new BrowserUseWorkerClient", "createDesktopIpcAuditWriter", "new PersistentApprovalStore"]) {
  assert.ok(appServiceFactory.includes(contract), `app-ready service factory omits ${contract}`);
}
assert.ok(index.includes("appServices = createMacosAppServices({"), "heavy app services must be created explicitly after app readiness");
for (const construction of ["new InteractiveDebugPolicyStore", "new InteractiveDebuggerService", "new BrowserTaskService", "new BrowserUseWorkerClient", "createDesktopIpcAuditWriter(", "new PersistentApprovalStore"]) {
  assert.equal(index.includes(construction), false, `composition root retains import-time heavy service construction ${construction}`);
}
for (const contract of ["installMacosAppIntegrations", 'powerMonitor.on("suspend"', 'powerMonitor.on("resume"', 'powerMonitor.on("lock-screen"', 'powerMonitor.on("unlock-screen"', 'powerMonitor.on("shutdown"', 'screen.on("display-added"', 'app.on("child-process-gone"', "portForwardRegistry.suspendAll()", "portForwardRegistry.resumeAll()", "clearInterval(networkMonitor)", "packagedNetworkOnlineOverride = null"]) {
  assert.ok(appIntegrations.includes(contract), `app integrations omit ${contract}`);
}
assert.ok(index.includes("disposeAppIntegrations = installMacosAppIntegrations({"), "app-ready integrations must be installed explicitly");
assert.ok(index.includes("disposeAppIntegrations();"), "app-ready integration monitor must be disposed on quit");

const channels = (source) => new Set([...source.matchAll(/ipcMain\.handle\(\s*["'](desktop:[^"']+)["']/g)].map((match) => match[1]));
assert.equal(channels(macosIpcSource(desktopRoot)).size, 275, "composition refactoring must preserve all 275 macOS IPC channels");

console.log(`macOS main composition verified (index=${lineCount(index)} lines, window=${lineCount(windowModule)} lines, platformIpc=${lineCount(platformIpc)} lines, sharingIpc=${lineCount(sharingIpc)} lines, customizationIpc=${lineCount(customizationIpc)} lines, automationIpc=${lineCount(automationIpc)} lines, connectionsIpc=${lineCount(connectionsIpc)} lines, workspaceIpc=${lineCount(workspaceIpc)} lines, workspaceHistoryIpc=${lineCount(workspaceHistoryIpc)} lines, remoteAccessIpc=${lineCount(remoteAccessIpc)} lines, diagnosticsIpc=${lineCount(diagnosticsIpc)} lines, trustIpc=${lineCount(trustIpc)} lines, terminalIpc=${lineCount(terminalIpc)} lines, voiceIpc=${lineCount(voiceIpc)} lines, runtimeServicesIpc=${lineCount(runtimeServicesIpc)} lines, catalogIpc=${lineCount(catalogIpc)} lines, presentationIpc=${lineCount(presentationIpc)} lines, executionIpc=${lineCount(executionIpc)} lines, services=${lineCount(serviceContainer)} lines, IPC=275).`);
