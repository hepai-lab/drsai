import { app, BrowserWindow, ipcMain, screen, type WebContents } from "electron";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { createSecureIpcHandle } from "../../../shared/main/secureIpc";
import { assertAllowedDesktopPath } from "../../../shared/main/desktopPathPolicy";
import { DesktopOpenRequestQueue, parseMacosOpenFile, parseMacosOpenUrl, parseMacosSecondInstanceArgv } from "./lifecycleRouting";
import { MacosLifecycleRecoveryCoordinator, type InterruptionReason } from "./lifecycleRecovery";
import { MacosAppShutdownCoordinator } from "./appShutdown";
import { MACOS_PLATFORM_SERVICES } from "./platformServices";
import { restoreCompletionNotificationPreference } from "../../../shared/main/completionNotifications";
import { startGateway, stopGateway } from "./gateway";
import { LocalRuntimeClient } from "../../../shared/main/runtimeClient";
import { MobilePairingController } from "../../../shared/main/mobilePairingController";
import { findWorkspaceById, listWorkspaces } from "../../../shared/main/workspaces";
import { shutdownAgentRunJournal } from "../../../shared/main/agentRunJournal";
import { shutdownChatRunJournal } from "../../../shared/main/chatRunJournal";
import { shutdownMcpSessions } from "../../../shared/main/mcpLiveBridge";
import { desktopDiagnostics } from "../../../shared/main/diagnostics";
import { DiagnosticSourceNavigator } from "../../../shared/main/sourceNavigation";
import { productionDiagnostics } from "../../../shared/main/productionDiagnostics";
import { sshHostService } from "../../../shared/main/sshHosts";
import { remoteGatewayInstaller } from "../../../shared/main/remoteGatewayInstaller";
import { remoteWorkspaceController } from "../../../shared/main/remoteWorkspaceController";
import { portForwardRegistry } from "../../../shared/main/portForwards";
import { createWorkflowRunRecipe, getWorkflowTemplate } from "../../../shared/main/workflowMarketplace";
import { listWorkflowRuns, recoverWorkflowRunsAfterRestart, startWorkflowRun } from "../../../shared/main/workflowRuns";
import { scheduledTaskStore, startScheduledTaskWorker, type ScheduledTaskRuntime, type ScheduledTaskWorker } from "../../../shared/main/scheduledTasks";
import { backgroundTaskStore } from "../../../shared/main/backgroundTasks";
import { cancelBundledRuntimeInstall } from "./runtimeInstaller";
import { scheduleUpdateHealthConfirmation } from "./updater";
import { previewWorkspaceFile } from "../../../shared/main/workspaceContext";
import { cleanupAllVoiceTempFiles } from "../../../shared/main/voice";
import { cancelStreamingVoiceSessionsForSender } from "../../../shared/main/voiceStreaming";
import { runPackagedSmokeIfRequested } from "./packagedSmoke";
import { isAllowedDevelopmentRendererUrl } from "./rendererNavigationPolicy";
import { createMacosMainWindow } from "./bootstrap/createWindow";
import { runMacosAppReadyPlan } from "./bootstrap/appReadyPlan";
import { configureMacosPlatformBindings } from "./bootstrap/configurePlatformBindings";
import { createMacosAppServices, type MacosAppServices } from "./bootstrap/createAppServices";
import { createMacosMcpCoordinators } from "./bootstrap/createMcpCoordinators";
import { installMacosAppIntegrations } from "./bootstrap/installAppIntegrations";
import { createMacosShutdownPlan } from "./bootstrap/shutdownPlan";
import { registerMacosDesktopIpc } from "./ipc/registerAllIpc";
import type { MacosServiceContainer } from "./serviceContainer";
import { killAllTerminalSessions, detachTerminalSessionsForOwner } from "./terminal";
import { managedProcessRegistry } from "../../../shared/main/managedProcessRegistry";
let mainWindow: BrowserWindow | null = null;
let appServices: MacosAppServices;
const openRequests = new DesktopOpenRequestQueue();
const recoveryCoordinator = new MacosLifecycleRecoveryCoordinator();
const shutdownCoordinator = new MacosAppShutdownCoordinator();
const singleInstanceLock = app.requestSingleInstanceLock();
let relaunchScheduled = false;
let disposeAppIntegrations: () => void = () => {};
let scheduledTaskWorker: ScheduledTaskWorker | null = null;
const mobilePairingControllers = new Map<number, MobilePairingController>();

function mobilePairingControllerFor(sender: WebContents): MobilePairingController {
  const existing = mobilePairingControllers.get(sender.id);
  if (existing) return existing;
  const controller = new MobilePairingController(() => LocalRuntimeClient.connect());
  mobilePairingControllers.set(sender.id, controller);
  sender.once("destroyed", () => {
    mobilePairingControllers.delete(sender.id);
    void controller.close();
  });
  return controller;
}

async function closeMobilePairingControllers(): Promise<void> {
  const controllers = [...mobilePairingControllers.values()];
  mobilePairingControllers.clear();
  await Promise.allSettled(controllers.map((controller) => controller.close()));
}

const scheduledTaskRuntime: ScheduledTaskRuntime = {
  prepare: (request) => prepareWorkflowRun(request, request.triggerKey),
  start: async (request) => { const result = await startWorkflowRun(request); await backgroundTaskStore.upsertWorkflow(result.run); return result; },
  listRuns: (workspacePath) => listWorkflowRuns(workspacePath),
};

async function prepareWorkflowRun(request: { templateId: string; workspacePath?: string }, scheduledTriggerKey?: string) {
  if (request.workspacePath !== undefined) await assertRegisteredWorkspacePath(request.workspacePath);
  const template = await getWorkflowTemplate(request.templateId, request.workspacePath);
  if (!template || template.status !== "available" || !template.approvalRequired) return createWorkflowRunRecipe(request);
  const stable = createHash("sha256").update(`${template.id}\0${request.workspacePath ?? "global"}\0${scheduledTriggerKey ?? "interactive"}`).digest("hex");
  const proposal = await appServices.approvalStore.propose({ source: "workflow", actionKind: "workflow.run", title: `Run workflow: ${template.name}`, detail: `${template.summary}\nTrigger: ${template.trigger}\nVerification: ${template.verification}`, target: request.workspacePath, risk: template.risk, idempotencyKey: `workflow:${stable}` }, async () => true);
  return createWorkflowRunRecipe(request, proposal);
}

function createMacosServiceContainer(): MacosServiceContainer { return {
  workspace: {
    assertPath: assertRegisteredWorkspacePath,
    findByPath: async (path) => (await listWorkspaces()).find((workspace) => workspace.path === path),
    allowedRoots: allowedDesktopRoots,
    isRemoteTarget: async (workspacePath, workspaceId) => {
      const target = await remoteWorkspaceController.resolveTarget(workspacePath, workspaceId);
      if (target === "remote_offline") throw new Error("Remote workspace is offline.");
      return target === "remote_online";
    },
    isRemotePath: (path) => {
      if (typeof path !== "string") return false;
      const target = remoteWorkspaceController.resolvePathTarget(path);
      if (target === "remote_offline") throw new Error("Remote workspace is offline.");
      return target === "remote_online";
    },
  },
  approvals: appServices.approvalStore,
  automation: {
    prepareWorkflowRun,
    scheduledTaskRuntime,
    getScheduledTaskWorkerStatus: () => scheduledTaskWorker?.getStatus() ?? { enabled: false, running: false, stopped: true, intervalMs: 0, initialDelayMs: 0, message: "Scheduled task worker is disabled." },
  },
}; }

function sendLifecycleEvent(event: Awaited<ReturnType<MacosLifecycleRecoveryCoordinator["recover"]>>): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("desktop:lifecycle-event", event);
  }
}

async function recoverAfterInterruption(reason: InterruptionReason): Promise<void> {
  try {
    const event = await recoveryCoordinator.recover(reason, async () => { await startGateway(); });
    sendLifecycleEvent(event);
    await appServices.ipcAuditWriter({ channel: `desktop:lifecycle-${reason}`, outcome: "succeeded", durationMs: 0, argumentCount: 0 });
  } catch {
    await appServices.ipcAuditWriter({ channel: `desktop:lifecycle-${reason}`, outcome: "failed", durationMs: 0, argumentCount: 0, errorCode: "LIFECYCLE_RECOVERY_FAILED" });
  }
}

async function orderlyRelaunch(errorCode: string): Promise<void> {
  if (relaunchScheduled || recoveryCoordinator.shuttingDown) return;
  relaunchScheduled = true;
  recoveryCoordinator.beginShutdown();
  await appServices?.ipcAuditWriter({ channel: "desktop:lifecycle-relaunch", outcome: "failed", durationMs: 0, argumentCount: 0, errorCode }).catch(() => undefined);
  killAllTerminalSessions();
  cleanupAllVoiceTempFiles();
  await Promise.race([stopGateway().catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, 3_000))]);
  app.relaunch();
  app.exit(1);
}

function ensureMainWindowOnScreen(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isFullScreen() || mainWindow.isSimpleFullScreen() || mainWindow.isMaximized()) return;
  const bounds = mainWindow.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const x = Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width));
  const y = Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height));
  if (x !== bounds.x || y !== bounds.y || width !== bounds.width || height !== bounds.height) {
    mainWindow.setBounds({ x, y, width, height });
  }
}

function focusOrCreateMainWindow(): void {
  if (!app.isReady()) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function routeOpenRequest(request: ReturnType<typeof parseMacosOpenUrl> | ReturnType<typeof parseMacosOpenFile>): void {
  if (!request) return;
  openRequests.enqueue(request);
  focusOrCreateMainWindow();
}

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    for (const request of parseMacosSecondInstanceArgv(argv, [process.execPath, app.getAppPath()])) openRequests.enqueue(request);
    focusOrCreateMainWindow();
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    routeOpenRequest(parseMacosOpenUrl(url));
  });
  app.on("open-file", (event, path) => {
    event.preventDefault();
    routeOpenRequest(parseMacosOpenFile(path));
  });
  for (const request of parseMacosSecondInstanceArgv(process.argv, [process.execPath, app.getAppPath(), process.argv[1] || ""])) openRequests.enqueue(request);
}
const allowDevelopmentRendererUrl = (url: string): boolean => {
  if (app.isPackaged) return false;
  const configured = process.env.ELECTRON_RENDERER_URL;
  return isAllowedDevelopmentRendererUrl(url, configured);
};
const protectedIpcMain = {
  handle: createSecureIpcHandle({
    registrar: ipcMain,
    getTrustedWebContents: () => mainWindow?.webContents,
    allowDevelopmentUrl: allowDevelopmentRendererUrl,
    audit: (entry) => appServices.ipcAuditWriter(entry),
    policyForChannel: (channel) => channel === "desktop:git-commit-approval" || channel === "desktop:propose-approval" ? { deduplicate: false } : undefined,
  }) as typeof ipcMain.handle,
};
const rawIpcMain = ipcMain;
async function allowedDesktopRoots(): Promise<string[]> {
  const workspaces = await listWorkspaces().catch(() => []);
  return [...new Set([
    homedir(),
    app.getPath("downloads"),
    app.getPath("documents"),
    ...workspaces.filter((workspace) => workspace.location !== "remote").map((workspace) => workspace.path),
  ])];
}
async function assertRegisteredWorkspacePath(raw: unknown): Promise<string> {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 4096 || /[\r\n\0]/.test(raw)) throw new Error("Workspace path is invalid.");
  const path = raw.trim();
  const workspaces = await listWorkspaces();
  if (!workspaces.some((workspace) => workspace.path === path)) throw new Error("Workspace is not registered.");
  return path;
}

function createWindow(): BrowserWindow {
  const window = createMacosMainWindow({
    preloadPath: join(app.getAppPath(), "out", "preload", "index.mjs"),
    rendererHtmlPath: join(app.getAppPath(), "out", "renderer", "index.html"),
    rendererUrl: app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL,
    onDidFinishLoad: (loadedWindow) => {
      openRequests.attach((request) => loadedWindow.webContents.send("desktop:open-request", request));
      return scheduleUpdateHealthConfirmation();
    },
    onRendererGone: (failedWindow, details) => {
    if (details.reason === "clean-exit" || recoveryCoordinator.shuttingDown) return;
    const action = recoveryCoordinator.recordRendererFailure();
    void appServices.ipcAuditWriter({ channel: "desktop:lifecycle-renderer-gone", outcome: "failed", durationMs: 0, argumentCount: 0, errorCode: `RENDERER_${details.reason.toUpperCase().replaceAll("-", "_")}` });
      if (action === "reload" && !failedWindow.webContents.isDestroyed()) {
        failedWindow.webContents.reload();
      void recoverAfterInterruption("renderer-recovered");
    } else if (action === "recreate") {
        failedWindow.destroy();
      focusOrCreateMainWindow();
      void recoverAfterInterruption("renderer-recovered");
    } else {
      void orderlyRelaunch("RENDERER_CRASH_LOOP");
    }
    },
    onWebContentsDestroyed: (destroyedWindow, destroyedWebContents, ownerId) => {
      cancelStreamingVoiceSessionsForSender(destroyedWebContents);
      detachTerminalSessionsForOwner(ownerId);
      if (mainWindow === destroyedWindow) openRequests.detach();
    },
    onClosed: (closedWindow) => { if (mainWindow === closedWindow) mainWindow = null; },
  });
  mainWindow = window;
  return window;
}

app.whenReady().then(async () => {
  if (!singleInstanceLock) return;
  appServices = createMacosAppServices({
    getMainWebContents: () => mainWindow?.webContents,
    isAllowedDesktopPath: async (path) => { try { assertAllowedDesktopPath(path, await allowedDesktopRoots()); return true; } catch { return false; } },
  });
  const macosServices = createMacosServiceContainer();
  const mcpCoordinators = createMacosMcpCoordinators({ approvalStore: appServices.approvalStore, allowedDesktopRoots });
  await configureMacosPlatformBindings({
    platformServices: MACOS_PLATFORM_SERVICES,
    remoteWorkspaces: remoteWorkspaceController,
    findWorkspaceById,
    remoteTerminalCommand: (options) => sshHostService.remoteTerminalCommand(options.remoteHostAlias, options.cwd),
  });
  await runMacosAppReadyPlan([
    { name: "completion-notification-preference", critical: false, run: async () => { await restoreCompletionNotificationPreference(); } },
    { name: "core-state", critical: true, run: async () => { await Promise.all([desktopDiagnostics.initialize(), productionDiagnostics.initialize(), portForwardRegistry.restore(), appServices.interactiveDebugPolicy.initialize()]); } },
    { name: "workflow-run-recovery", critical: false, run: async () => { await recoverWorkflowRunsAfterRestart(); } },
    { name: "background-task-recovery", critical: false, run: async () => { await backgroundTaskStore.recover(); } },
    { name: "native-helper-handshake", critical: false, run: async () => { const state = await appServices.nativeHelperSupervisor.start(); if (state.status !== "ready") throw new Error(state.reason || "Native Helper is unavailable."); } },
  ], async (failure) => {
    await appServices.ipcAuditWriter({ channel: `desktop:startup-${failure.name}`, outcome: "failed", durationMs: 0, argumentCount: 0, errorCode: failure.critical ? "STARTUP_CRITICAL_FAILED" : "STARTUP_DEGRADED" });
  });
  if (process.env.DRSAI_DISABLE_SCHEDULED_TASK_WORKER !== "1") scheduledTaskWorker = startScheduledTaskWorker(scheduledTaskStore, scheduledTaskRuntime);
  const diagnosticSourceNavigator = new DiagnosticSourceNavigator({
    appRoot: app.getAppPath(), listWorkspaces,
    previewLocal: (request) => previewWorkspaceFile(request),
    previewRemote: async () => { throw new Error("Remote source navigation is unavailable until a remote workspace is connected."); },
  });
  disposeAppIntegrations = installMacosAppIntegrations({
    recovery: recoveryCoordinator, interactiveDebugger: appServices.interactiveDebugger,
    focusApp: focusOrCreateMainWindow, openSettings: () => { openRequests.enqueue({ kind: "settings", source: "menu" }); focusOrCreateMainWindow(); },
    ensureWindowOnScreen: ensureMainWindowOnScreen, recover: (reason) => { void recoverAfterInterruption(reason); }, getScheduledTaskWorker: () => scheduledTaskWorker,
    getWindowVisibility: () => !mainWindow || mainWindow.isDestroyed() ? "hidden" : mainWindow.isMinimized() ? "minimized" : mainWindow.isVisible() ? "foreground" : "hidden",
    reloadMainWindow: () => { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.reload(); },
    publish: (channel, event) => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, event); },
  });
  registerMacosDesktopIpc({
    ipcMain: protectedIpcMain, rawIpcMain, services: macosServices, allowedDesktopRoots,
    diagnostics: { sourceNavigator: diagnosticSourceNavigator, interactiveDebugger: appServices.interactiveDebugger, interactiveDebugPolicy: appServices.interactiveDebugPolicy },
    trust: mcpCoordinators,
    voice: { getTrustedWebContents: () => mainWindow?.webContents, allowDevelopmentRendererUrl },
    runtimeServices: { browserTaskService: appServices.browserTaskService },
    catalog: { mobilePairingControllerFor },
  });
  const window = createWindow();
  runPackagedSmokeIfRequested(window, appServices.nativeHelperSupervisor);
  app.on("activate", () => {
    focusOrCreateMainWindow();
  });
});

app.on("before-quit", (event) => {
  recoveryCoordinator.beginShutdown();
  managedProcessRegistry.beginShutdown();
  if (shutdownCoordinator.running) return;
  event.preventDefault();
  const plan = createMacosShutdownPlan({
    stopScheduledTaskWorker: () => { scheduledTaskWorker?.stop(); scheduledTaskWorker = null; },
    killTerminalSessions: killAllTerminalSessions,
    cleanupVoiceFiles: cleanupAllVoiceTempFiles,
    cancelRuntimeInstall: cancelBundledRuntimeInstall,
    shutdownApprovalStore: () => appServices.approvalStore.shutdown(),
    shutdownInteractiveDebugger: () => appServices.interactiveDebugger.shutdown(),
    shutdownBrowserTasks: () => appServices.browserTaskService.shutdown(),
    shutdownNativeHelper: () => appServices.nativeHelperSupervisor.stop(),
    shutdownMcpSessions,
    shutdownPortForwards: () => portForwardRegistry.shutdown(),
    shutdownSshHosts: () => sshHostService.shutdown(),
    shutdownRemoteGatewayInstaller: () => remoteGatewayInstaller.shutdown(),
    shutdownRemoteWorkspaces: () => remoteWorkspaceController.shutdown(),
    closeMobilePairingControllers,
    shutdownAgentJournal: shutdownAgentRunJournal,
    shutdownChatJournal: shutdownChatRunJournal,
    stopGateway: async () => { await stopGateway(); },
    shutdownManagedProcesses: () => managedProcessRegistry.shutdownAll(),
  });
  void shutdownCoordinator.run(plan.map((step) => step.run)).finally(() => app.exit(0));
});
app.on("will-quit", () => {
  disposeAppIntegrations();
});
app.on("window-all-closed", () => {
  // Remain active in the Dock until the user explicitly chooses Quit.
});

process.on("uncaughtException", () => { void orderlyRelaunch("MAIN_UNCAUGHT_EXCEPTION"); });
process.on("unhandledRejection", () => { void orderlyRelaunch("MAIN_UNHANDLED_REJECTION"); });
