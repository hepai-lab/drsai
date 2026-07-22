import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, powerMonitor, screen, session as electronSession, shell, type IpcMainEvent, type WebContents } from "electron";
import { join } from "node:path";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { createSecureIpcHandle, isTrustedDesktopIpcSender } from "../../../shared/main/secureIpc";
import { createDesktopIpcAuditWriter } from "../../../shared/main/ipcAuditLog";
import { PersistentApprovalStore } from "../../../shared/main/approvalStore";
import type { DesktopForkLifecycleApprovalRequest, DesktopForkQueueStartApprovalResult, DesktopMcpLiveEnumerationRequest, DesktopMcpToolExecutionApprovalRequest, DesktopShellCommandApprovalRequest } from "../../../shared/api";
import { assertAllowedDesktopPath, assertAllowedExternalUrl } from "../../../shared/main/desktopPathPolicy";
import {
  DesktopOpenRequestQueue,
  parseMacosOpenFile,
  parseMacosOpenUrl,
  parseMacosSecondInstanceArgv,
} from "./lifecycleRouting";
import { MacosLifecycleRecoveryCoordinator, type InterruptionReason } from "./lifecycleRecovery";
import { MacosAppShutdownCoordinator } from "./appShutdown";
import { getMacosSystemPermissions, openMacosSystemPermissionSettings, requestMacosSystemPermission } from "./systemPermissions";
import { MACOS_PLATFORM_DESCRIPTOR } from "./platform";
import { MACOS_PLATFORM_SERVICES, MACOS_USER_DATA } from "./platformServices";
import {
  configureCompletionNotifications,
  notifyBackgroundTaskCompleted,
  restoreCompletionNotificationPreference,
  setCompletionNotificationPreference,
} from "../../../shared/main/completionNotifications";
import { getGatewayStatus, startGateway, stopGateway } from "./gateway";
import {
  createThread,
  deleteThread,
  getThreadSnapshot,
  listThreads,
  searchThreadMessages,
  updateThread,
  updateThreadSnapshot,
} from "../../../shared/main/threads";
import { configureRuntimeWorkspaceRouting, LocalRuntimeClient } from "../../../shared/main/runtimeClient";
import { MobilePairingController } from "../../../shared/main/mobilePairingController";
import { presentCodexBackendStatus } from "../../../shared/main/codexBackendStatus";
import {
  createWorkspace,
  deleteWorkspace,
  findWorkspaceById,
  listWorkspaces,
  updateWorkspace,
} from "../../../shared/main/workspaces";
import { abortAgentRun, hasActiveAgentRuns, recoverAgentRun, startAgentRun } from "../../../shared/main/agentRuns";
import { shutdownAgentRunJournal } from "../../../shared/main/agentRunJournal";
import { shutdownChatRunJournal } from "../../../shared/main/chatRunJournal";
import { executeLocalGitCommit, gitCommitApprovalIdempotencyKey, normalizeGitCommitApprovalRequest } from "../../../shared/main/gitCommit";
import { executeForkLifecycleAction } from "../../../shared/main/forkLifecycle";
import { importMcpContext } from "../../../shared/main/mcpContext";
import {
  cancelMcpActiveSession,
  closeMcpReusableSession,
  createMcpEnumerationBlockedResult,
  createMcpEnumerationQueuedResult,
  createMcpToolExecutionApprovalResult,
  enumerateMcpLiveServer,
  executeMcpToolAfterApproval,
  inspectMcpLiveServers,
  listMcpActiveSessions,
  listMcpReusableSessions,
  listMcpSessionAudits,
  listMcpToolExecutionAudits,
  shutdownMcpSessions,
} from "../../../shared/main/mcpLiveBridge";
import { acceptWorkspaceCheckpoint, createWorkspaceCheckpoint, listWorkspaceCheckpoints, previewWorkspaceCheckpoint, restoreWorkspaceCheckpoint } from "../../../shared/main/workspaceCheckpoints";
import { getWorktreeMigrationDiagnostics, listRuntimeWorktreeEvents, listRuntimeWorktrees, prepareForkWorktree } from "../../../shared/main/worktrees";
import { dispatchForkQueue, executeForkConflictDraftWrite, normalizeForkQueueStartRequest, updateForkQueueThreads, validateForkConflictDraft } from "../../../shared/main/forkQueue";
import { getIdeContext } from "../../../shared/main/ideContext";
import { normalizeDesktopEditCommand, openPdfSourcePage } from "../../../shared/main/desktopHandoff";
import { desktopDiagnostics } from "../../../shared/main/diagnostics";
import { replaceFileSafely } from "../../../shared/main/atomicFileReplace";
import { DiagnosticSourceNavigator } from "../../../shared/main/sourceNavigation";
import { productionDiagnostics } from "../../../shared/main/productionDiagnostics";
import { InteractiveDebuggerService } from "../../../shared/main/interactiveDebugger";
import { InteractiveDebugPolicyStore } from "../../../shared/main/interactiveDebugPolicy";
import { DRSAI_PYTHON } from "../../../shared/main/paths";
import { sshHostService } from "../../../shared/main/sshHosts";
import { remoteGatewayInstaller, validateRemoteGatewayInstallRequest } from "../../../shared/main/remoteGatewayInstaller";
import { remoteWorkspaceController } from "../../../shared/main/remoteWorkspaceController";
import { portForwardRegistry } from "../../../shared/main/portForwards";
import { getMyDrSaiConfig, updateMyDrSaiConfig } from "../../../shared/main/myDrSaiConfig";
import { deleteUserPreference, listUserPreferences, upsertUserPreference } from "../../../shared/main/userPreferences";
import { deleteCustomCommand, listCustomCommands, upsertCustomCommand } from "../../../shared/main/customCommands";
import { addProjectMemory, clearProjectMemory, listProjectMemory, updateProjectMemory } from "../../../shared/main/projectMemory";
import { addTeamMemory, deleteTeamMemory, listTeamMemory } from "../../../shared/main/teamMemory";
import { createProjectSkillDraft, installProjectSkillDraft, listProjectSkillDrafts, publishProjectSkillDraft } from "../../../shared/main/projectSkills";
import { createWorkflowRunRecipe, getWorkflowTemplate, listWorkflowMarketplace, syncWorkflowMarketplace } from "../../../shared/main/workflowMarketplace";
import { completeWorkflowRunStep, dispatchWorkflowRunStep, listWorkflowRuns, recoverWorkflowRunsAfterRestart, startWorkflowRun } from "../../../shared/main/workflowRuns";
import { scheduledTaskStore, startScheduledTaskWorker, type ScheduledTaskRuntime, type ScheduledTaskWorker } from "../../../shared/main/scheduledTasks";
import { backgroundTaskStore } from "../../../shared/main/backgroundTasks";
import { listProviderErrorAnalytics } from "../../../shared/main/providerErrorAnalytics";
import { listProviderUsageAnalytics } from "../../../shared/main/providerUsageAnalytics";
import { saveApiKeyAndDefaultModel } from "../../../shared/main/settings";
import { applyAnomalyDecision } from "../../../shared/main/anomalyDecision";
import { listReusableTasks, prepareReusableTaskRun, saveReusableTask } from "../../../shared/main/reusableTasks";
import type {
  ManagerPresentationCancelRequest,
  ManagerPresentationGenerateRequest,
  ManagerPresentationPauseRequest,
  ManagerPresentationProgressEvent,
  ManagerPresentationRecoveryDecisionRequest,
  ManagerPresentationRecoveryRequest,
  ManagerPresentationRequirementUpdateRequest,
} from "../../../shared/api";
import { generateManagerPresentation, ManagerPresentationCancelledError } from "../../../shared/main/managerPresentation";
import { getManagerPresentationRecovery, recordManagerPresentationProgress, recordManagerPresentationStart, resolveManagerPresentationRecovery } from "../../../shared/main/managerPresentationTasks";
import { addShareComment, completeShareCommentTask, continueSharedTask, createShare, createShareCommentTask, downloadSharedArtifact, inspectShare, inspectShareVersion, listIncomingShares, listOutgoingShares, listShareAudit, listShareComments, listShareCommentTasks, openSharedObject, previewShareCommentTask, publishShareVersion, revokeShare, updateShareCommentTask, updateSharePermission } from "../../../shared/main/shares";
import { abortChat, configureChatRemoteRouting, hasActiveChats, recoverChatRun, respondChatInput, startChat } from "../../../shared/main/chat";
import { clearLocalData, previewLocalDataCleanup } from "../../../shared/main/dataCleanup";
import { BrowserTaskService } from "../../../shared/main/browser/browserTaskService";
import { BrowserUseWorkerClient } from "../../../shared/main/browser/workerClient";
import { getA5ServiceGuidanceScenario } from "../../../shared/main/a5ServiceGuidanceScenario";
import { bootstrapDesktop, getHealth, getInstallStatus, installBundledRuntime } from "./desktopLifecycle";
import { cancelBundledRuntimeInstall } from "./runtimeInstaller";
import { cancelUpdate, checkForUpdates, downloadUpdate, installUpdate, scheduleUpdateHealthConfirmation } from "./updater";
import {
  analyzeMaterialConsistency, analyzeMaterialRoles, getWorkspaceContextOverview,
  getWorkspaceGitDiff, getWorkspaceGitFileAtRef, listWorkspaceFiles, previewWorkspaceFile,
  queryMaterials, revertWorkspaceFile, revertWorkspaceHunk, stageWorkspaceFile,
  stageWorkspaceHunk, summarizeWorkspaceFolder,
} from "../../../shared/main/workspaceContext";
import { configureWorkspaceFileDialogs, saveWorkspaceFileAs, writeWorkspaceFile } from "../../../shared/main/workspaceFileMutations";
import { cancelVoiceTranscription, cleanupAllVoiceTempFiles, getVoiceRuntimeStatus, startVoiceTranscription, writeVoiceTranscriptHandoff } from "../../../shared/main/voice";
import { cancelVoiceSynthesis, getVoiceSynthesisRuntimeStatus, startVoiceSynthesis } from "../../../shared/main/voiceTts";
import {
  attachStreamingVoiceAudioPort,
  cancelStreamingVoiceSessionsForSender,
  cancelStreamingVoiceTranscription,
  getStreamingVoiceCapabilities,
  startStreamingVoiceTranscription,
  stopStreamingVoiceTranscription,
} from "../../../shared/main/voiceStreaming";
import type { DesktopStreamingVoiceStartRequest } from "../../../shared/api";
import { runPackagedSmokeIfRequested } from "./packagedSmoke";
import {
  createTerminalSession, getTerminalBuffer, killAllTerminalSessions, killTerminalSession,
  configureMacosRemoteTerminalResolver,
  detachTerminalSessionsForOwner, listTerminalSessions, renameTerminalSession,
  resizeTerminalSession, writeTerminalSession,
} from "./terminal";

configureMacosRemoteTerminalResolver((options) => sshHostService.remoteTerminalCommand(options.remoteHostAlias, options.cwd));
import {
  getPlatformAgentStatus,
  listAgents,
  recordAgentUsage,
  setDefaultAgent,
} from "../../../shared/main/agents";
import {
  cancelDesktopSsoLogin,
  cancelOidcLogin,
  configureAuthPlatform,
  getAuthSession,
  login,
  logout,
  pollDesktopSsoLogin,
  refreshAuthSession,
  startDesktopSsoLogin,
  startOidcLogin,
  startWechatDesktopLogin,
} from "../../../shared/main/auth";

configureAuthPlatform({
  credentials: MACOS_PLATFORM_SERVICES.credentials,
  openExternal: (url) => shell.openExternal(url),
});
configureRuntimeWorkspaceRouting({
  getRemoteGatewayAccess: (workspacePath, workspaceId) => remoteWorkspaceController.getAccess(workspacePath, workspaceId) ?? undefined,
  findWorkspaceById,
});
const { configureChannelProviderAuth } = await import("../../../shared/main/channelAdapters");
configureChannelProviderAuth({ credentials: MACOS_PLATFORM_SERVICES.credentials });
const browserWorker = new BrowserUseWorkerClient();
const browserTaskService = new BrowserTaskService({
  worker: browserWorker,
  workerOptions: async () => {
    const install = await getInstallStatus();
    const runtimeRoot = dirname(dirname(install.pythonPath));
    const browserPython = join(runtimeRoot, "browser-venv", "bin", "python");
    const browserPath = join(runtimeRoot, "browser-browsers");
    if (!process.env.OPENDRSAI_BROWSER_USE_PYTHON && !existsSync(browserPython)) {
      throw new Error("Browser Runtime is not installed. Repair the bundled Runtime before starting a Browser task.");
    }
    return {
      pythonCommand: process.env.OPENDRSAI_BROWSER_USE_PYTHON || browserPython,
      workerPath: app.isPackaged
        ? join(process.resourcesPath, "browser-use-worker", "worker.py")
        : join(app.getAppPath(), "..", "shared", "browser-use-worker", "worker.py"),
      dataRoot: join(MACOS_USER_DATA, "browser-use"),
      environment: { PLAYWRIGHT_BROWSERS_PATH: browserPath },
    };
  },
  traceRoot: join(MACOS_USER_DATA, "browser-use", "traces"),
  publish: (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send("desktop:browser-task-event", event);
    }
  },
  recordError: (message) => console.warn("[browser-use]", message),
});
configureChatRemoteRouting({
  resolveTarget: (workspacePath, workspaceId) => remoteWorkspaceController.resolveTarget(workspacePath, workspaceId),
  getGatewayAccess: (workspacePath, workspaceId) => remoteWorkspaceController.getAccess(workspacePath, workspaceId),
  bindThread: (threadId, workspaceId) => remoteWorkspaceController.bindThread(threadId, workspaceId),
});
configureWorkspaceFileDialogs({
  selectSavePath: async ({ title, suggestedName, extension }) => {
    const result = await dialog.showSaveDialog({
      title,
      defaultPath: join(app.getPath("downloads"), suggestedName),
      ...(extension ? { filters: [{ name: `${extension.slice(1).toUpperCase()} file`, extensions: [extension.slice(1)] }] } : {}),
    });
    return result.canceled ? null : result.filePath || null;
  },
});

let mainWindow: BrowserWindow | null = null;
const interactiveDebugPolicy = new InteractiveDebugPolicyStore(join(MACOS_USER_DATA, "state", "interactive-debug-policy.json"));
const interactiveDebugger = new InteractiveDebuggerService(
  () => mainWindow?.webContents,
  DRSAI_PYTHON,
  async (path) => { try { assertAllowedDesktopPath(path, await allowedDesktopRoots()); return true; } catch { return false; } },
  () => interactiveDebugPolicy.isEnabled(),
);
const openRequests = new DesktopOpenRequestQueue();
const recoveryCoordinator = new MacosLifecycleRecoveryCoordinator();
const shutdownCoordinator = new MacosAppShutdownCoordinator();
const ipcAuditWriter = createDesktopIpcAuditWriter(join(MACOS_USER_DATA, "logs", "desktop-ipc-audit.jsonl"));
const approvalStore = new PersistentApprovalStore(join(MACOS_USER_DATA, "state", "approvals.json"));
remoteGatewayInstaller.setPublisher((event) => {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send("desktop:remote-gateway-operation-event", event);
});
remoteWorkspaceController.setPublisher((status) => {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send("desktop:remote-workspace-status-event", status);
});
const publishPortForwardEvent = (event: unknown) => {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send("desktop:port-forward-event", event);
};
portForwardRegistry.setPublisher(publishPortForwardEvent);
const singleInstanceLock = app.requestSingleInstanceLock();
let relaunchScheduled = false;
let networkMonitor: ReturnType<typeof setInterval> | null = null;
let portForwardNetworkOnline = true;
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

interface ManagerPresentationRun {
  controller: AbortController;
  ownerId: number;
  request: ManagerPresentationGenerateRequest;
  paused: boolean;
  activeOperationController: AbortController | null;
  resumeWaiters: Set<() => void>;
  lastProgress: ManagerPresentationProgressEvent | null;
  requirements: string[];
}

const managerPresentationRuns = new Map<string, ManagerPresentationRun>();

function sanitizeManagerPresentationRequirements(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 240) : "")
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index).slice(0, 5);
}

function publishManagerPresentationProgress(progress: ManagerPresentationProgressEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send("desktop:manager-presentation-progress", progress);
  }
}

function resumeManagerPresentation(run: ManagerPresentationRun): void {
  run.paused = false;
  for (const resume of run.resumeWaiters) resume();
  run.resumeWaiters.clear();
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
  const proposal = await approvalStore.propose({ source: "workflow", actionKind: "workflow.run", title: `Run workflow: ${template.name}`, detail: `${template.summary}\nTrigger: ${template.trigger}\nVerification: ${template.verification}`, target: request.workspacePath, risk: template.risk, idempotencyKey: `workflow:${stable}` }, async () => true);
  return createWorkflowRunRecipe(request, proposal);
}

async function proposeChannelOutboundDraft(request: any) {
  try {
    const { createChannelOutboundDraftApproval, executeChannelOutboundDeliveryAsync } = await import("../../../shared/main/channelAdapters");
    if (!request || typeof request !== "object") throw new Error("Channel outbound draft request must be an object.");
    if (request.workspacePath !== undefined) await assertRegisteredWorkspacePath(request.workspacePath);
    let delivery: Awaited<ReturnType<typeof executeChannelOutboundDeliveryAsync>> | undefined;
    const approvalRequest = createChannelOutboundDraftApproval(request);
    const proposal = await approvalStore.propose(approvalRequest, async (approval) => { delivery = await executeChannelOutboundDeliveryAsync(request, approval.id, true); return delivery.status === "sent" || delivery.status === "blocked"; });
    if (!proposal.queued && !proposal.alreadyExecuted && proposal.allowed && !proposal.blocked && !delivery) delivery = await executeChannelOutboundDeliveryAsync(request, `connector:approved:${randomUUID()}`, true);
    return { queued: proposal.queued, ...(proposal.approval ? { approval: proposal.approval } : {}), ...(delivery ? { delivery } : {}), allowed: proposal.allowed, blocked: proposal.blocked, reason: proposal.reason, verification: "Outbound channel drafts remain approval-gated; delivery is written only to an explicitly configured Workspace-local outbox." };
  } catch (error) { return { queued: false, allowed: false, blocked: true, reason: error instanceof Error ? error.message : String(error), verification: "No connector proposal was queued or delivered." }; }
}

function sendLifecycleEvent(event: Awaited<ReturnType<MacosLifecycleRecoveryCoordinator["recover"]>>): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("desktop:lifecycle-event", event);
  }
}

async function recoverAfterInterruption(reason: InterruptionReason): Promise<void> {
  try {
    const event = await recoveryCoordinator.recover(reason, async () => { await startGateway(); });
    sendLifecycleEvent(event);
    await ipcAuditWriter({ channel: `desktop:lifecycle-${reason}`, outcome: "succeeded", durationMs: 0, argumentCount: 0 });
  } catch {
    await ipcAuditWriter({ channel: `desktop:lifecycle-${reason}`, outcome: "failed", durationMs: 0, argumentCount: 0, errorCode: "LIFECYCLE_RECOVERY_FAILED" });
  }
}

async function orderlyRelaunch(errorCode: string): Promise<void> {
  if (relaunchScheduled || recoveryCoordinator.shuttingDown) return;
  relaunchScheduled = true;
  recoveryCoordinator.beginShutdown();
  await ipcAuditWriter({ channel: "desktop:lifecycle-relaunch", outcome: "failed", durationMs: 0, argumentCount: 0, errorCode }).catch(() => undefined);
  killAllTerminalSessions();
  cleanupAllVoiceTempFiles();
  await Promise.race([stopGateway().catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, 3_000))]);
  app.relaunch();
  app.exit(1);
}

function ensureMainWindowOnScreen(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
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
  const configured = process.env.ELECTRON_RENDERER_URL;
  if (!configured) return false;
  try {
    return new URL(url).origin === new URL(configured).origin;
  } catch {
    return false;
  }
};
const protectedIpcMain = {
  handle: createSecureIpcHandle({
    registrar: ipcMain,
    getTrustedWebContents: () => mainWindow?.webContents,
    allowDevelopmentUrl: allowDevelopmentRendererUrl,
    audit: ipcAuditWriter,
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

async function isRemoteWorkspaceTarget(workspacePath?: string, workspaceId?: string): Promise<boolean> {
  const target = await remoteWorkspaceController.resolveTarget(workspacePath, workspaceId);
  if (target === "remote_offline") throw new Error("Remote workspace is offline.");
  return target === "remote_online";
}

function isRemoteFolderTarget(path: unknown): boolean {
  if (typeof path !== "string") return false;
  const target = remoteWorkspaceController.resolvePathTarget(path);
  if (target === "remote_offline") throw new Error("Remote workspace is offline.");
  return target === "remote_online";
}

function normalizeMcpEnumerationRequest(value: unknown): DesktopMcpLiveEnumerationRequest | null {
  if (!value || typeof value !== "object") return null;
  const request = value as Record<string, unknown>;
  if (typeof request.workspacePath !== "string" || !request.workspacePath.trim()) return null;
  return {
    workspacePath: request.workspacePath.trim(),
    ...(typeof request.server === "string" && request.server.trim() ? { server: request.server.trim().slice(0, 160) } : {}),
    ...(request.reuseSession === true ? { reuseSession: true } : {}),
  };
}

function normalizeMcpExecutionRequest(value: unknown): DesktopMcpToolExecutionApprovalRequest | null {
  if (!value || typeof value !== "object") return null;
  const request = value as Record<string, unknown>;
  if (typeof request.workspacePath !== "string" || !request.workspacePath.trim() || typeof request.server !== "string" || !request.server.trim() || typeof request.tool !== "string" || !request.tool.trim()) return null;
  if (request.input !== undefined && typeof request.input !== "string") return null;
  return {
    workspacePath: request.workspacePath.trim(),
    server: request.server.trim().slice(0, 160),
    tool: request.tool.trim().slice(0, 240),
    ...(typeof request.input === "string" ? { input: request.input.slice(0, 48 * 1024) } : {}),
    ...(request.reuseSession === true ? { reuseSession: true } : {}),
  };
}

async function requestMcpEnumeration(raw: unknown) {
  const request = normalizeMcpEnumerationRequest(raw);
  if (!request) return createMcpEnumerationBlockedResult({ workspacePath: "" }, "MCP live enumeration request is incomplete.");
  try {
    assertAllowedDesktopPath(request.workspacePath, await allowedDesktopRoots(), { directory: true });
    const inspection = inspectMcpLiveServers(request.workspacePath);
    const selected = request.server ? inspection.servers.filter((server) => server.name.toLowerCase().includes(request.server!.toLowerCase())) : inspection.servers;
    if (!selected.length) return createMcpEnumerationBlockedResult(request, "No configured MCP server matched the requested selector.");
    const stableKey = createHash("sha256").update(`${request.workspacePath}\0${request.server ?? "all"}\0${request.reuseSession === true}`).digest("hex");
    const proposal = await approvalStore.propose({
      source: "network", actionKind: "network.request", title: "Enumerate live MCP server context",
      detail: `Run bounded MCP resources/list and tools/list for: ${selected.map((server) => server.name).join(", ")}.`,
      target: request.workspacePath, risk: "medium", idempotencyKey: `mcp-enumerate:${stableKey}`,
    }, async () => { await enumerateMcpLiveServer(request); return true; });
    if (proposal.blocked || !proposal.allowed) return createMcpEnumerationBlockedResult(request, proposal.reason);
    if (proposal.queued && proposal.approval) return createMcpEnumerationQueuedResult(request, proposal.approval.id, proposal.reason);
    return enumerateMcpLiveServer(request);
  } catch (error) {
    return createMcpEnumerationBlockedResult(request, error instanceof Error ? error.message : "MCP live enumeration preflight failed.");
  }
}

async function requestMcpExecution(raw: unknown) {
  const request = normalizeMcpExecutionRequest(raw);
  if (!request) return createMcpToolExecutionApprovalResult({ workspacePath: "", server: "", tool: "" }, undefined, "MCP tool execution approval request is incomplete.", false, true);
  try {
    assertAllowedDesktopPath(request.workspacePath, await allowedDesktopRoots(), { directory: true });
    const inspection = inspectMcpLiveServers(request.workspacePath);
    if (!inspection.servers.some((server) => server.name.toLowerCase().includes(request.server.toLowerCase()))) return createMcpToolExecutionApprovalResult(request, undefined, "No configured MCP server matched the tool execution request.", false, true);
    if (request.input) {
      const parsed = JSON.parse(request.input);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MCP tool input must be a JSON object.");
    }
    const stableKey = createHash("sha256").update(`${request.workspacePath}\0${request.server}\0${request.tool}\0${request.input ?? ""}\0${request.reuseSession === true}`).digest("hex");
    let approvalId: string | undefined;
    const proposal = await approvalStore.propose({
      source: "connector", actionKind: "external.service", title: `Execute MCP tool: ${request.tool}`,
      detail: `Run one bounded stdio MCP tools/call.\nServer: ${request.server}\nTool: ${request.tool}\nInput: ${request.input?.slice(0, 1_200) ?? "{}"}`,
      target: request.workspacePath, risk: "high", idempotencyKey: `mcp-tool:${stableKey}`,
    }, async () => { await executeMcpToolAfterApproval(request, approvalId); return true; });
    approvalId = proposal.approval?.id;
    if (proposal.alreadyExecuted) return {
      ...createMcpToolExecutionApprovalResult(request, approvalId, proposal.reason, false, false),
      status: "already_executed" as const,
      message: "This idempotent MCP tool request was already executed and was not replayed.",
    };
    if (!proposal.queued && proposal.allowed && !proposal.blocked) return executeMcpToolAfterApproval(request, approvalId);
    return createMcpToolExecutionApprovalResult(request, approvalId, proposal.reason, proposal.queued, proposal.blocked || !proposal.allowed);
  } catch (error) {
    return createMcpToolExecutionApprovalResult(request, undefined, error instanceof Error ? error.message : "MCP tool execution preflight failed.", false, true);
  }
}

function createWindow(): BrowserWindow {
  let cancelUpdateHealthConfirmation: () => void = () => undefined;
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.once("did-finish-load", () => {
    openRequests.attach((request) => window.webContents.send("desktop:open-request", request));
    cancelUpdateHealthConfirmation();
    cancelUpdateHealthConfirmation = scheduleUpdateHealthConfirmation();
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    cancelUpdateHealthConfirmation();
    if (details.reason === "clean-exit" || recoveryCoordinator.shuttingDown) return;
    const action = recoveryCoordinator.recordRendererFailure();
    void ipcAuditWriter({ channel: "desktop:lifecycle-renderer-gone", outcome: "failed", durationMs: 0, argumentCount: 0, errorCode: `RENDERER_${details.reason.toUpperCase().replaceAll("-", "_")}` });
    if (action === "reload" && !window.webContents.isDestroyed()) {
      window.webContents.reload();
      void recoverAfterInterruption("renderer-recovered");
    } else if (action === "recreate") {
      window.destroy();
      focusOrCreateMainWindow();
      void recoverAfterInterruption("renderer-recovered");
    } else {
      void orderlyRelaunch("RENDERER_CRASH_LOOP");
    }
  });
  let unresponsiveTimer: ReturnType<typeof setTimeout> | null = null;
  window.on("unresponsive", () => {
    cancelUpdateHealthConfirmation();
    if (unresponsiveTimer) return;
    unresponsiveTimer = setTimeout(() => {
      unresponsiveTimer = null;
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.reload();
    }, 15_000);
  });
  window.on("responsive", () => {
    if (unresponsiveTimer) clearTimeout(unresponsiveTimer);
    unresponsiveTimer = null;
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try { void shell.openExternal(assertAllowedExternalUrl(url)); } catch { /* deny invalid popup URLs */ }
    return { action: "deny" };
  });
  const terminalOwnerId = window.webContents.id;
  window.webContents.once("destroyed", () => {
    cancelStreamingVoiceSessionsForSender(window.webContents);
    detachTerminalSessionsForOwner(terminalOwnerId);
    if (mainWindow === window) openRequests.detach();
  });
  window.once("closed", () => { if (mainWindow === window) mainWindow = null; });
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(join(__dirname, "../renderer/index.html"));
  mainWindow = window;
  return window;
}

app.whenReady().then(async () => {
  if (!singleInstanceLock) return;
  configureCompletionNotifications({
    notifications: MACOS_PLATFORM_SERVICES.notifications,
    focusApp: focusOrCreateMainWindow,
    publishClick: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send("desktop:completion-notification-click", event);
        }
      }
    },
    getWindowVisibility: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return "hidden";
      if (mainWindow.isMinimized()) return "minimized";
      return mainWindow.isVisible() ? "foreground" : "hidden";
    },
  });
  await restoreCompletionNotificationPreference();
  await Promise.all([desktopDiagnostics.initialize(), productionDiagnostics.initialize(), portForwardRegistry.restore(), interactiveDebugPolicy.initialize()]);
  await recoverWorkflowRunsAfterRestart();
  await backgroundTaskStore.recover();
  if (process.env.DRSAI_DISABLE_SCHEDULED_TASK_WORKER !== "1") scheduledTaskWorker = startScheduledTaskWorker(scheduledTaskStore, scheduledTaskRuntime);
  desktopDiagnostics.setPublisher((diagnosticEvent) => {
    productionDiagnostics.observeEvent(Buffer.byteLength(JSON.stringify(diagnosticEvent), "utf8"), diagnosticEvent.workspaceId);
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send("desktop:diagnostics-event", diagnosticEvent);
  });
  interactiveDebugger.setPublisher((session) => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send("desktop:interactive-debug-event", session);
  });
  const diagnosticSourceNavigator = new DiagnosticSourceNavigator({
    appRoot: app.getAppPath(), listWorkspaces,
    previewLocal: (request) => previewWorkspaceFile(request),
    previewRemote: async () => { throw new Error("Remote source navigation is unavailable until a remote workspace is connected."); },
  });
  app.setName("OpenDrSai");
  app.setAsDefaultProtocolClient("opendrsai");
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu", submenu: [
      { role: "about" },
      { type: "separator" },
      { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => { openRequests.enqueue({ kind: "settings", source: "menu" }); focusOrCreateMainWindow(); } },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ] },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    { role: "help", submenu: [
      { label: "OpenDrSai Documentation", click: () => { void shell.openExternal("https://github.com/hepai-lab/drsai"); } },
    ] },
  ]));
  app.dock?.setMenu(Menu.buildFromTemplate([
    { label: "Show OpenDrSai", click: () => focusOrCreateMainWindow() },
    { label: "Settings…", click: () => { openRequests.enqueue({ kind: "settings", source: "menu" }); focusOrCreateMainWindow(); } },
  ]));
  powerMonitor.on("suspend", () => {
    void getGatewayStatus().then((status) => recoveryCoordinator.suspend(status.ready)).catch(() => undefined);
  });
  powerMonitor.on("resume", () => { void recoverAfterInterruption("resume"); void scheduledTaskWorker?.runOnce(); });
  powerMonitor.on("shutdown", () => {
    recoveryCoordinator.beginShutdown();
    killAllTerminalSessions();
    cleanupAllVoiceTempFiles();
    void stopGateway().catch(() => undefined);
  });
  const handleDisplayChange = (): void => {
    ensureMainWindowOnScreen();
    void recoverAfterInterruption("display-change");
  };
  screen.on("display-added", handleDisplayChange);
  screen.on("display-removed", handleDisplayChange);
  screen.on("display-metrics-changed", handleDisplayChange);
  portForwardNetworkOnline = net.isOnline();
  recoveryCoordinator.setNetworkOnline(portForwardNetworkOnline);
  networkMonitor = setInterval(() => {
    const online = net.isOnline();
    if (!online) {
      recoveryCoordinator.setNetworkOnline(false);
      if (portForwardNetworkOnline) void portForwardRegistry.suspendAll();
      portForwardNetworkOnline = false;
      void getGatewayStatus().then((status) => recoveryCoordinator.suspend(status.ready)).catch(() => undefined);
      return;
    }
    const recovered = recoveryCoordinator.setNetworkOnline(true);
    if (!portForwardNetworkOnline) void portForwardRegistry.resumeAll();
    portForwardNetworkOnline = true;
    if (recovered) void recoverAfterInterruption("network-online");
  }, 5_000);
  networkMonitor.unref?.();
  app.on("child-process-gone", (_event, details) => {
    if (details.type !== "GPU" || recoveryCoordinator.shuttingDown) return;
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.reload();
    void recoverAfterInterruption("gpu-recovered");
  });
  const ipcMain = protectedIpcMain;
  ipcMain.handle("desktop:platform-descriptor", () => MACOS_PLATFORM_DESCRIPTOR);
  ipcMain.handle("desktop:system-permissions-get", () => getMacosSystemPermissions());
  ipcMain.handle("desktop:system-permission-request", (_event, kind) => requestMacosSystemPermission(kind));
  ipcMain.handle("desktop:system-permission-settings", (_event, kind) => openMacosSystemPermissionSettings(kind));
  ipcMain.handle("desktop:bootstrap", () => bootstrapDesktop());
  ipcMain.handle("desktop:get-health", () => getHealth());
  ipcMain.handle("desktop:get-install-status", () => getInstallStatus());
  ipcMain.handle("desktop:start-install", (event) => installBundledRuntime((progress) => {
    if (!event.sender.isDestroyed()) event.sender.send("desktop:install-progress", progress);
  }));
  ipcMain.handle("desktop:cancel-install", () => cancelBundledRuntimeInstall());
  ipcMain.handle("desktop:check-for-updates", () => checkForUpdates());
  ipcMain.handle("desktop:download-update", () => downloadUpdate());
  ipcMain.handle("desktop:cancel-update", () => cancelUpdate());
  ipcMain.handle("desktop:install-update", () => installUpdate());
  ipcMain.handle("desktop:clipboard-copy-text", (_event, text) => {
    if (typeof text !== "string" || text.length > 50_000) return false;
    clipboard.writeText(text);
    return true;
  });
  ipcMain.handle("desktop:open-external", async (_event, url) => {
    await shell.openExternal(assertAllowedExternalUrl(url));
    return true;
  });
  ipcMain.handle("desktop:open-path", async (_event, path) =>
    shell.openPath(assertAllowedDesktopPath(path, await allowedDesktopRoots())));
  ipcMain.handle("desktop:open-log-folder", async () => {
    const path = join(MACOS_USER_DATA, "logs");
    await mkdir(path, { recursive: true, mode: 0o700 });
    return shell.openPath(path);
  });
  ipcMain.handle("desktop:diagnostics-record", (_event, input) => desktopDiagnostics.record(input));
  ipcMain.handle("desktop:diagnostics-snapshot", (_event, query) => desktopDiagnostics.snapshot(query ?? {}));
  ipcMain.handle("desktop:diagnostics-clear", async () => ({ cleared: true, removedEvents: await desktopDiagnostics.clear() }));
  ipcMain.handle("desktop:diagnostics-export", async () => {
    const snapshot = await desktopDiagnostics.snapshot({ limit: 5_000 });
    const selected = await dialog.showSaveDialog({
      title: "Export OpenDrSai diagnostics",
      defaultPath: join(app.getPath("downloads"), `opendrsai-diagnostics-${Date.now()}.json`),
      buttonLabel: "Export", filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (selected.canceled || !selected.filePath) return { exported: false, eventCount: snapshot.events.length, message: "Diagnostic export cancelled." };
    const temporary = `${selected.filePath}.${process.pid}.${randomUUID()}.diagnostic-tmp`;
    try {
      await writeFile(temporary, await desktopDiagnostics.serializeExport(), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await replaceFileSafely(temporary, selected.filePath);
      await chmod(selected.filePath, 0o600).catch(() => undefined);
    } finally { await rm(temporary, { force: true }); }
    return { exported: true, path: selected.filePath, eventCount: snapshot.events.length, message: "Diagnostic package exported." };
  });
  ipcMain.handle("desktop:diagnostics-issue-update", (_event, request) => desktopDiagnostics.updateIssue(request));
  ipcMain.handle("desktop:diagnostics-source-context", (_event, request) => diagnosticSourceNavigator.context(request));
  ipcMain.handle("desktop:diagnostics-source-open", async (_event, request) => {
    const resolved = await diagnosticSourceNavigator.resolveOpenPath(request);
    if (!resolved.path) return { opened: false, ...resolved };
    if (request?.target === "reveal") {
      shell.showItemInFolder(resolved.path);
      return { opened: true, ...resolved, message: "Source file revealed in Finder." };
    }
    if (request?.target === "editor") {
      const editor = process.env.OPENDRSAI_SOURCE_EDITOR?.trim();
      if (!editor) return { opened: false, ...resolved, message: "No external source editor is configured. Set OPENDRSAI_SOURCE_EDITOR to enable this action." };
      let templates: string[] = ["-g", "{file}:{line}:{column}"];
      try {
        const configured = JSON.parse(process.env.OPENDRSAI_SOURCE_EDITOR_ARGS || "null");
        if (configured !== null && (!Array.isArray(configured) || !configured.every((item) => typeof item === "string"))) throw new Error("invalid");
        if (Array.isArray(configured)) templates = configured.slice(0, 20);
      } catch { return { opened: false, ...resolved, message: "OPENDRSAI_SOURCE_EDITOR_ARGS must be a JSON string array." }; }
      const values = { "{file}": resolved.path, "{line}": String(resolved.line ?? 1), "{column}": String(resolved.column ?? 1) };
      const args = templates.map((template) => Object.entries(values).reduce((value, [token, replacement]) => value.replaceAll(token, replacement), template).slice(0, 4_096));
      try {
        await new Promise<void>((resolveLaunch, rejectLaunch) => execFile(editor, args, { timeout: 10_000, windowsHide: true }, (error) => error ? rejectLaunch(error) : resolveLaunch()));
        return { opened: true, ...resolved, message: "Source opened in the configured external editor." };
      } catch { return { opened: false, ...resolved, message: "Configured source editor failed to open the source." }; }
    }
    const error = await shell.openPath(resolved.path);
    return { opened: !error, ...resolved, message: error || "Source file opened with the system application." };
  });
  ipcMain.handle("desktop:production-diagnostics-status", () => productionDiagnostics.status());
  ipcMain.handle("desktop:production-diagnostics-settings", (_event, patch) => productionDiagnostics.update(patch));
  ipcMain.handle("desktop:production-diagnostics-preview", async () => productionDiagnostics.preview(await desktopDiagnostics.serializeExport()));
  ipcMain.handle("desktop:production-diagnostics-export", async () => {
    const preview = await productionDiagnostics.preview(await desktopDiagnostics.serializeExport());
    const selected = await dialog.showSaveDialog({ title: "Export protected OpenDrSai diagnostic package", defaultPath: join(app.getPath("downloads"), `opendrsai-diagnostics-${Date.now()}.oddiag`), buttonLabel: "Export", filters: [{ name: "OpenDrSai diagnostics", extensions: ["oddiag"] }] });
    if (selected.canceled || !selected.filePath) return { ok: false, preview, message: "Diagnostic package export cancelled." };
    return productionDiagnostics.exportPackage(await desktopDiagnostics.serializeExport(), selected.filePath);
  });
  ipcMain.handle("desktop:production-diagnostics-import", async () => {
    const selected = await dialog.showOpenDialog({ title: "Open OpenDrSai diagnostic package", properties: ["openFile"], filters: [{ name: "OpenDrSai diagnostics", extensions: ["oddiag"] }] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return productionDiagnostics.importPackage(selected.filePaths[0]);
  });
  ipcMain.handle("desktop:interactive-debug-targets", () => interactiveDebugger.listTargets());
  ipcMain.handle("desktop:interactive-debug-policy", () => interactiveDebugPolicy.get());
  ipcMain.handle("desktop:interactive-debug-policy-update", async (_event, request) => {
    const policy = await interactiveDebugPolicy.update(request);
    if (!policy.enabled) await interactiveDebugger.shutdown();
    return policy;
  });
  ipcMain.handle("desktop:interactive-debug-sessions", () => interactiveDebugger.listSessions());
  ipcMain.handle("desktop:interactive-debug-start", (_event, request) => interactiveDebugger.start(request));
  ipcMain.handle("desktop:interactive-debug-breakpoint", async (_event, request) => {
    const file = request && typeof request === "object" ? (request as { source?: { file?: unknown } }).source?.file : undefined;
    if (typeof file !== "string") throw new Error("Breakpoint source file is required.");
    assertAllowedDesktopPath(file, await allowedDesktopRoots());
    return interactiveDebugger.setBreakpoint(request);
  });
  ipcMain.handle("desktop:interactive-debug-control", (_event, request) => interactiveDebugger.control(request));
  ipcMain.handle("desktop:interactive-debug-scopes", (_event, sessionId, frameId) => interactiveDebugger.scopes(sessionId, frameId));
  ipcMain.handle("desktop:interactive-debug-variables", (_event, sessionId, reference) => interactiveDebugger.variables(sessionId, reference));
  ipcMain.handle("desktop:interactive-debug-evaluate", (_event, request) => interactiveDebugger.evaluate(request));
  ipcMain.handle("desktop:edit-command", (event, rawCommand) => {
    const command = normalizeDesktopEditCommand(rawCommand);
    if (!command) return false;
    event.sender[command]();
    return true;
  });
  ipcMain.handle("desktop:open-pdf-page", (_event, request) => openPdfSourcePage(request, {
    assertAllowedPath: async (path) => { assertAllowedDesktopPath(path, await allowedDesktopRoots()); },
    openExternal: (url) => shell.openExternal(url),
  }));
  ipcMain.handle("desktop:ide-context", async (_event, workspacePath) => {
    const root = assertAllowedDesktopPath(workspacePath, await allowedDesktopRoots(), { directory: true });
    return getIdeContext(root);
  });
  ipcMain.handle("desktop:get-file-icon", async (_event, rawPath) => {
    if (typeof rawPath !== "string") return { path: "", dataUrl: null };
    try {
      const path = assertAllowedDesktopPath(rawPath, await allowedDesktopRoots());
      const icon = await app.getFileIcon(path, { size: "normal" });
      const dataUrl = icon.isEmpty() ? null : icon.toDataURL();
      return { path, dataUrl: dataUrl && dataUrl.length <= 1_000_000 ? dataUrl : null };
    } catch { return { path: rawPath.slice(0, 2_048), dataUrl: null }; }
  });
  ipcMain.handle("desktop:pick-files", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("desktop:pick-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  ipcMain.handle("desktop:terminal-create", async (event, options = {}) => {
    const rawCwd = options && typeof options === "object" ? (options as { cwd?: unknown }).cwd : undefined;
    const remote = options && typeof options === "object" && typeof (options as { remoteHostAlias?: unknown }).remoteHostAlias === "string";
    const cwd = remote
      ? (typeof rawCwd === "string" ? rawCwd : "~")
      : rawCwd === undefined
      ? homedir()
      : assertAllowedDesktopPath(rawCwd, await allowedDesktopRoots(), { directory: true });
    return createTerminalSession(event, { ...(options as object), cwd });
  });
  ipcMain.handle("desktop:terminal-list", (event, workspaceKey, workspaceId) => listTerminalSessions(event, workspaceKey, workspaceId));
  ipcMain.handle("desktop:terminal-buffer", (event, id) => getTerminalBuffer(event, id));
  ipcMain.handle("desktop:terminal-rename", (event, id, title) => renameTerminalSession(event, id, title));
  ipcMain.handle("desktop:terminal-write", (event, id, data) => writeTerminalSession(event, id, data));
  ipcMain.handle("desktop:terminal-resize", (event, id, cols, rows) => resizeTerminalSession(event, id, cols, rows));
  ipcMain.handle("desktop:terminal-kill", (event, id) => killTerminalSession(event, id));
  ipcMain.handle("desktop:propose-approval", (_event, request) => approvalStore.propose(request));
  ipcMain.handle("desktop:pending-approvals", () => approvalStore.list());
  ipcMain.handle("desktop:decide-approval", (_event, request) => approvalStore.decide(request));
  ipcMain.handle("desktop:shell-command-approval", (event, rawRequest) => {
    if (!rawRequest || typeof rawRequest !== "object") throw new Error("Shell command approval request must be an object.");
    const request = rawRequest as DesktopShellCommandApprovalRequest;
    if (
      typeof request.terminalSessionId !== "string" || !request.terminalSessionId.trim() || request.terminalSessionId.length > 200 ||
      typeof request.commandId !== "string" || !request.commandId.trim() || request.commandId.length > 200 ||
      typeof request.command !== "string" || !request.command.trim() || request.command.length > 4_000 ||
      typeof request.invocation !== "string" || !request.invocation.trim() || request.invocation.length > 16_000
    ) throw new Error("Shell command approval request is incomplete or exceeds its limit.");
    return approvalStore.propose({
      source: "shell", actionKind: "shell.command", title: "Run shell command",
      detail: request.command.trim(), target: request.terminalSessionId.trim(), risk: request.risk,
      idempotencyKey: `terminal:${request.terminalSessionId.trim()}:${request.commandId.trim()}`,
    }, async () => writeTerminalSession(event, request.terminalSessionId.trim(), request.invocation));
  });
  ipcMain.handle("desktop:git-commit-approval", async (_event, rawRequest) => {
    const request = normalizeGitCommitApprovalRequest(rawRequest);
    const roots = await allowedDesktopRoots();
    assertAllowedDesktopPath(request.workspacePath, roots, { directory: true });
    return approvalStore.propose({
      source: "git", actionKind: "git.commit", title: "Create git commit",
      detail: request.body ? `git commit -m ${request.message}\n\n${request.body}` : `git commit -m ${request.message}`,
      target: request.workspacePath, risk: "high", checklist: request.checklist,
      idempotencyKey: gitCommitApprovalIdempotencyKey(request),
    }, () => executeLocalGitCommit(request, roots));
  });
  ipcMain.handle("desktop:fork-lifecycle-approval", async (_event, rawRequest) => {
    if (!rawRequest || typeof rawRequest !== "object") throw new Error("Fork lifecycle approval request must be an object.");
    const request = rawRequest as Partial<DesktopForkLifecycleApprovalRequest>;
    if (typeof request.threadId !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(request.threadId) || (request.action !== "merge_back" && request.action !== "discard")) throw new Error("Fork lifecycle approval request is incomplete.");
    const thread = (await listThreads()).find((item) => item.id === request.threadId);
    if (!thread?.fork || thread.fork.lifecycleStatus === "closed") throw new Error("Fork lifecycle approval requires an open fork thread.");
    assertAllowedDesktopPath(thread.fork.sourceWorkspacePath, await allowedDesktopRoots(), { directory: true });
    const action = request.action;
    return approvalStore.propose({
      source: "fork", actionKind: "fork.lifecycle",
      title: `Review fork ${action === "merge_back" ? "merge back" : "discard"}`,
      detail: `${action === "merge_back" ? "Merge the fork branch into its source workspace." : "Remove the managed worktree while retaining unmerged work."}\nBranch: ${thread.fork.branch}\nSource: ${thread.fork.sourceWorkspacePath}\nWorktree: ${thread.fork.worktreePath}`,
      target: thread.fork.worktreePath, risk: "high",
      idempotencyKey: `fork-lifecycle:${thread.id}:${action}:${thread.fork.lifecycleStatus}`,
    }, async () => {
      const current = (await listThreads()).find((item) => item.id === thread.id);
      if (!current?.fork || current.fork.lifecycleStatus === "closed") return false;
      const pending = await updateThread({ id: current.id, fork: { ...current.fork, lifecycleStatus: action === "merge_back" ? "merge_pending" : "cleanup_pending", lifecycleUpdatedAt: new Date().toISOString(), lifecycleMessage: "Approved lifecycle action is running." } });
      const result = await executeForkLifecycleAction(pending.fork!, action);
      await updateThread({ id: current.id, fork: { ...pending.fork!, ...result } });
      return true;
    });
  });
  ipcMain.handle("desktop:fork-queue-start-approval", async (_event, rawRequest): Promise<DesktopForkQueueStartApprovalResult> => {
    const request = normalizeForkQueueStartRequest(rawRequest);
    if (!request) return { queued: false, threads: [], allowed: false, blocked: true, reason: "Fork queue start approval request is incomplete." };
    const all = await listThreads();
    const threads = request.threadIds.map((id) => all.find((thread) => thread.id === id)).filter((thread): thread is NonNullable<typeof thread> => Boolean(thread?.fork));
    if (threads.length !== request.threadIds.length) return { queued: false, threads, allowed: false, blocked: true, reason: "Fork queue start approval requires existing fork threads." };
    if (threads.some((thread) => thread.fork?.lifecycleStatus === "closed")) return { queued: false, threads, allowed: false, blocked: true, reason: "Closed fork threads cannot be queued for agent dispatch." };
    const source = threads[0]!.fork!.sourceWorkspacePath;
    const roots = await allowedDesktopRoots();
    assertAllowedDesktopPath(source, roots, { directory: true });
    if (threads.some((thread) => thread.fork!.sourceWorkspacePath !== source)) return { queued: false, threads, allowed: false, blocked: true, reason: "A fork queue must use one source workspace." };
    for (const thread of threads) assertAllowedDesktopPath(thread.fork!.worktreePath, roots, { directory: true });
    const proposal = await approvalStore.propose({
      source: "fork", actionKind: "fork.queue_start", title: `Start fork queue (${threads.length})`,
      detail: ["Approve marking these isolated fork subtasks ready for explicit Agent dispatch.", ...threads.map((thread, index) => `${index + 1}. ${thread.title}\nBranch: ${thread.fork!.branch}\nWorktree: ${thread.fork!.worktreePath}`)].join("\n\n"),
      target: source, risk: "high", idempotencyKey: `fork-queue-start:${request.threadIds.join(":")}`,
    }, async () => {
      await updateForkQueueThreads(request.threadIds, "ready", "Fork queue start approved; subtasks are ready for explicit Agent dispatch.");
      return true;
    }, async (approved) => {
      if (!approved) await updateForkQueueThreads(request.threadIds, "blocked", "Fork queue start was rejected in Approval Center.");
    });
    if (proposal.blocked || !proposal.allowed) return { queued: false, threads, allowed: proposal.allowed, blocked: proposal.blocked, reason: proposal.reason };
    if (proposal.queued && proposal.approval) {
      const waiting = await updateForkQueueThreads(request.threadIds, "waiting_approval", `Queue start is waiting in Approval Center: ${proposal.approval.title}.`, { approvalId: proposal.approval.id });
      return { queued: true, approval: proposal.approval, threads: waiting, allowed: true, blocked: false, reason: proposal.reason };
    }
    const ready = await updateForkQueueThreads(request.threadIds, "ready", "Fork queue start was already approved; subtasks are ready for explicit Agent dispatch.");
    return { queued: false, threads: ready, allowed: true, blocked: false, reason: "Fork queue is ready for explicit Agent dispatch." };
  });
  ipcMain.handle("desktop:fork-queue-dispatch", (event, request) => dispatchForkQueue(request, {
    assertWorkspaceAllowed: async (path) => { assertAllowedDesktopPath(path, await allowedDesktopRoots(), { directory: true }); },
    startRun: (request) => startAgentRun(event.sender, request),
  }));
  ipcMain.handle("desktop:fork-conflict-draft-write", async (_event, rawRequest) => {
    const request = await validateForkConflictDraft(rawRequest, async (path) => { assertAllowedDesktopPath(path, await allowedDesktopRoots(), { directory: true }); });
    const stableKey = createHash("sha256").update(`${request.threadId}\0${request.workspacePath}\0${request.path}\0${request.expectedDiffHash}\0${request.draft}`).digest("hex");
    let approvalId: string | undefined;
    const proposal = await approvalStore.propose({
      source: "workspace", actionKind: "workspace.revert", title: "Write resolved conflict draft",
      detail: `Write the reviewed resolved draft atomically into the source workspace without staging it.\nThread: ${request.threadId}\nFile: ${request.path}\nReviewed diff hash: ${request.expectedDiffHash}`,
      target: request.path, risk: "medium", idempotencyKey: `fork-conflict-draft:${stableKey}`,
    }, async () => { await executeForkConflictDraftWrite(request); return true; });
    approvalId = proposal.approval?.id;
    if (proposal.blocked || !proposal.allowed) throw new Error(proposal.reason);
    if (proposal.queued) return { threadId: request.threadId, workspacePath: request.workspacePath, path: request.path, written: false, approvalId, approvalQueued: true, message: "Resolved draft write-back is waiting in Approval Center." };
    return { threadId: request.threadId, workspacePath: request.workspacePath, path: request.path, written: true, approvalQueued: false, message: "This idempotent conflict draft was already written." };
  });
  ipcMain.handle("desktop:mcp-context-import", async (_event, request) => {
    assertAllowedDesktopPath(request?.workspacePath, await allowedDesktopRoots(), { directory: true });
    return importMcpContext(request);
  });
  ipcMain.handle("desktop:mcp-live-enumerate", (_event, request) => requestMcpEnumeration(request));
  ipcMain.handle("desktop:mcp-tool-execution-approval", (_event, request) => requestMcpExecution(request));
  ipcMain.handle("desktop:mcp-execution-audits", async (_event, request) => {
    assertAllowedDesktopPath(request?.workspacePath, await allowedDesktopRoots(), { directory: true });
    return listMcpToolExecutionAudits(request);
  });
  ipcMain.handle("desktop:mcp-session-audits", async (_event, request) => {
    assertAllowedDesktopPath(request?.workspacePath, await allowedDesktopRoots(), { directory: true });
    return listMcpSessionAudits(request);
  });
  ipcMain.handle("desktop:mcp-active-sessions", async (_event, request) => {
    assertAllowedDesktopPath(request?.workspacePath, await allowedDesktopRoots(), { directory: true });
    return listMcpActiveSessions(request);
  });
  ipcMain.handle("desktop:mcp-reusable-sessions", async (_event, request) => {
    assertAllowedDesktopPath(request?.workspacePath, await allowedDesktopRoots(), { directory: true });
    return listMcpReusableSessions(request);
  });
  ipcMain.handle("desktop:mcp-reusable-session-close", async (_event, request) => {
    assertAllowedDesktopPath(request?.workspacePath, await allowedDesktopRoots(), { directory: true });
    return closeMcpReusableSession(request);
  });
  ipcMain.handle("desktop:mcp-session-cancel", async (_event, request) => {
    assertAllowedDesktopPath(request?.workspacePath, await allowedDesktopRoots(), { directory: true });
    return cancelMcpActiveSession(request);
  });
  ipcMain.handle("desktop:ssh-hosts", () => sshHostService.listHosts());
  ipcMain.handle("desktop:ssh-diagnose", (_event, hostAlias) => sshHostService.diagnose(hostAlias));
  ipcMain.handle("desktop:ssh-host-keys", (_event, hostAlias) => sshHostService.inspectHostKeys(hostAlias));
  ipcMain.handle("desktop:ssh-test", (_event, hostAlias) => sshHostService.test(hostAlias));
  ipcMain.handle("desktop:ssh-approve-host-key", (_event, hostAlias) => sshHostService.approveHostKey(hostAlias));
  ipcMain.handle("desktop:ssh-host-connect", async (_event, hostAlias) => ({ hostAlias, action: "connect", changed: await sshHostService.connect(hostAlias) }));
  ipcMain.handle("desktop:ssh-host-disconnect", async (_event, hostAlias) => {
    await portForwardRegistry.suspendHost(hostAlias);
    return { hostAlias, action: "disconnect", changed: sshHostService.disconnect(hostAlias) };
  });
  ipcMain.handle("desktop:ssh-host-reconnect", async (_event, hostAlias) => {
    const changed = await sshHostService.reconnect(hostAlias);
    await portForwardRegistry.resumeHost(hostAlias);
    return { hostAlias, action: "reconnect", changed };
  });
  ipcMain.handle("desktop:ssh-host-remove", async (_event, hostAlias) => {
    if ((await portForwardRegistry.list({ hostAlias })).length) throw new Error("Remove or pause this host's Port Forwards before deleting the SSH profile.");
    return { hostAlias, action: "remove", changed: await sshHostService.remove(hostAlias) };
  });
  ipcMain.handle("desktop:remote-gateway-preflight", (_event, hostAlias) => remoteGatewayInstaller.preflight(hostAlias));
  ipcMain.handle("desktop:remote-gateway-install", () => { throw new Error("Remote Gateway installation requires Approval Center authorization."); });
  ipcMain.handle("desktop:remote-gateway-install-approval", async (_event, request) => {
    const normalized = validateRemoteGatewayInstallRequest(request);
    const stable = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    return approvalStore.propose({
      source: "network", actionKind: "external.service", title: `Remote Gateway ${normalized.action}`,
      detail: `Approve a verified, cancellable Remote Gateway transaction.\nHost: ${normalized.hostAlias}\nVersion: ${normalized.version ?? "rollback"}`,
      target: normalized.hostAlias, risk: "high", idempotencyKey: `remote-gateway:${stable}`,
    }, async () => { await remoteGatewayInstaller.install(normalized); return true; });
  });
  ipcMain.handle("desktop:remote-gateway-cancel", (_event, hostAlias) => remoteGatewayInstaller.cancel(hostAlias));
  ipcMain.handle("desktop:remote-workspace-connect", (_event, request) => remoteWorkspaceController.connect(request));
  ipcMain.handle("desktop:remote-workspace-disconnect", (_event, workspaceId) => remoteWorkspaceController.disconnect(workspaceId));
  ipcMain.handle("desktop:remote-workspace-status", (_event, workspaceId) => remoteWorkspaceController.status(workspaceId));
  ipcMain.handle("desktop:remote-workspace-threads", (_event, workspaceId) => remoteWorkspaceController.listThreads(workspaceId));
  ipcMain.handle("desktop:remote-hepai-workers", (_event, workspaceId) => remoteWorkspaceController.listWorkers(workspaceId));
  ipcMain.handle("desktop:remote-hepai-worker-state", (_event, workspaceId, workerId, enabled) => remoteWorkspaceController.setWorkerState(workspaceId, workerId, enabled));
  ipcMain.handle("desktop:ssh-directories", (_event, hostAlias, path) => remoteWorkspaceController.listDirectories(hostAlias, path));
  ipcMain.handle("desktop:port-forward-list", (_event, filter) => portForwardRegistry.list(filter));
  ipcMain.handle("desktop:port-forward-create", async (_event, request) => {
    const workspaceId = request && typeof request === "object" ? (request as { workspaceId?: unknown }).workspaceId : undefined;
    if (typeof workspaceId !== "string") throw new Error("Port Forward owner Workspace is invalid.");
    const workspace = await findWorkspaceById(workspaceId);
    const hostAlias = request && typeof request === "object" ? (request as { hostAlias?: unknown }).hostAlias : undefined;
    if (!workspace?.remote || workspace.remote.hostAlias !== hostAlias) throw new Error("Port Forward must belong to a matching remote Workspace.");
    return portForwardRegistry.create(request);
  });
  ipcMain.handle("desktop:port-forward-pause", (_event, id) => portForwardRegistry.pause(id));
  ipcMain.handle("desktop:port-forward-resume", (_event, id) => portForwardRegistry.resume(id));
  ipcMain.handle("desktop:port-forward-remove", (_event, id) => portForwardRegistry.remove(id));
  ipcMain.handle("desktop:get-auth-session", () => getAuthSession());
  ipcMain.handle("desktop:e2e-a5-service-guidance-scenario", () => getA5ServiceGuidanceScenario());
  ipcMain.handle("desktop:login", (_event, request) => login(request));
  ipcMain.handle("desktop:start-oidc-login", (event, request) =>
    startOidcLogin(request, (debugEvent) => event.sender.send("desktop:oidc-login-debug", debugEvent)),
  );
  ipcMain.handle("desktop:cancel-oidc-login", () => cancelOidcLogin());
  ipcMain.handle("desktop:start-desktop-sso-login", () => startDesktopSsoLogin());
  ipcMain.handle("desktop:start-wechat-desktop-login", () => startWechatDesktopLogin());
  ipcMain.handle("desktop:poll-desktop-sso-login", (_event, deviceCode) => pollDesktopSsoLogin(deviceCode));
  ipcMain.handle("desktop:cancel-desktop-sso-login", (_event, deviceCode) => cancelDesktopSsoLogin(deviceCode));
  ipcMain.handle("desktop:refresh-auth-session", () => refreshAuthSession());
  ipcMain.handle("desktop:logout", (_event, options) => logout(options));
  ipcMain.handle("desktop:local-data-cleanup-preview", (_event, scope) => previewLocalDataCleanup(scope));
  ipcMain.handle("desktop:local-data-cleanup", async (_event, request) => {
    if (hasActiveChats() || hasActiveAgentRuns()) throw new Error("Stop active tasks before clearing local data.");
    await stopGateway();
    const result = await clearLocalData(request);
    if (result.scope === "all_local_data") {
      await desktopDiagnostics.clear();
      await logout({ clearLocalData: true });
      await electronSession.defaultSession.clearCache();
      await electronSession.defaultSession.clearStorageData();
    }
    return result;
  });
  ipcMain.handle("desktop:browser-check-url", (_event, url) => browserTaskService.checkUrl(url));
  ipcMain.handle("desktop:browser-action-request", (_event, request) => browserTaskService.requestAction(request));
  ipcMain.handle("desktop:browser-task-start", async (_event, request) => {
    if (request?.workspacePath) await assertRegisteredWorkspacePath(request.workspacePath);
    return browserTaskService.start(request);
  });
  ipcMain.handle("desktop:browser-task-stop", (_event, request) => browserTaskService.stop(request));
  ipcMain.handle("desktop:browser-task-pending-approvals", () => browserTaskService.pendingApprovals());
  ipcMain.handle("desktop:browser-task-approve", (_event, request) => browserTaskService.approve(request));
  ipcMain.handle("desktop:get-codex-backend-status", async (_event, refresh) => {
    const client = await LocalRuntimeClient.connect();
    const capability = (await client.getCapabilities()).agent_backends?.codex;
    return !capability?.available
      ? presentCodexBackendStatus(capability)
      : presentCodexBackendStatus(capability, await client.getBackendAccount("codex", refresh === true));
  });
  ipcMain.handle("desktop:start-codex-backend-login", async (_event, rawType) => {
    const type = rawType === "chatgptDeviceCode" ? "chatgptDeviceCode" : "chatgpt";
    const result = await (await LocalRuntimeClient.connect()).startBackendLogin("codex", type);
    const externalUrl = result.authUrl ?? result.verificationUrl;
    if (externalUrl) await shell.openExternal(assertAllowedExternalUrl(externalUrl));
    return { type: result.type, loginId: result.loginId, verificationUrl: result.verificationUrl, userCode: result.userCode };
  });
  ipcMain.handle("desktop:cancel-codex-backend-login", async (_event, loginId) => {
    if (typeof loginId !== "string" || !loginId.trim()) return false;
    await (await LocalRuntimeClient.connect()).cancelBackendLogin("codex", loginId.trim());
    return true;
  });
  ipcMain.handle("desktop:logout-codex-backend", async () => {
    await (await LocalRuntimeClient.connect()).logoutBackend("codex");
    return true;
  });
  ipcMain.handle("desktop:get-gateway-status", () => getGatewayStatus());
  ipcMain.handle("desktop:start-gateway", () => startGateway());
  ipcMain.handle("desktop:stop-gateway", () => stopGateway());
  ipcMain.handle("desktop:provider-usage-analytics-list", () => listProviderUsageAnalytics());
  ipcMain.handle("desktop:provider-error-analytics-list", () => listProviderErrorAnalytics());
  ipcMain.handle("desktop:remote-ssh-diagnostics", () => remoteWorkspaceController.diagnostics());
  ipcMain.handle("desktop:save-api-key", (_event, apiKey: string, defaultModel?: string) => {
    if (app.isPackaged) return { ok: false, message: "This build receives service authorization through HepAI OIDC." };
    return saveApiKeyAndDefaultModel(apiKey, defaultModel);
  });
  ipcMain.handle("desktop:mobile-pairing-readiness", (event) => mobilePairingControllerFor(event.sender).readiness());
  ipcMain.handle("desktop:mobile-pairing-create", (event) => mobilePairingControllerFor(event.sender).create());
  ipcMain.handle("desktop:mobile-pairing-read", (event, grantId: string) => mobilePairingControllerFor(event.sender).read(grantId));
  ipcMain.handle("desktop:mobile-pairing-revoke", (event, grantId: string) => mobilePairingControllerFor(event.sender).revoke(grantId));
  ipcMain.handle("desktop:list-threads", () => listThreads());
  ipcMain.handle("desktop:list-agents", (_event, options) => listAgents(
    options && typeof options === "object" && (options as { refresh?: unknown }).refresh === true
      ? { refresh: true }
      : {},
  ));
  ipcMain.handle("desktop:get-platform-agent-status", () => getPlatformAgentStatus());
  ipcMain.handle("desktop:set-default-agent", (_event, agentId) =>
    setDefaultAgent(typeof agentId === "string" ? agentId : ""));
  ipcMain.handle("desktop:record-agent-usage", (_event, agentId) =>
    recordAgentUsage(typeof agentId === "string" ? agentId : ""));
  ipcMain.handle("desktop:create-thread", (_event, request) => createThread(request));
  ipcMain.handle("desktop:update-thread", (_event, request) => updateThread(request));
  ipcMain.handle("desktop:delete-thread", (_event, threadId) => deleteThread(threadId));
  ipcMain.handle("desktop:set-thread-archived", (_event, request: { threadId: string; archived: boolean }) =>
    updateThread({ id: request.threadId, archived: request.archived }),
  );
  ipcMain.handle("desktop:get-thread-snapshot", (_event, threadId) => getThreadSnapshot(threadId));
  ipcMain.handle("desktop:search-thread-messages", (_event, request) => searchThreadMessages(request));
  ipcMain.handle("desktop:update-thread-snapshot", (_event, request) => updateThreadSnapshot(request));
  ipcMain.handle("desktop:list-workspaces", () => listWorkspaces());
  ipcMain.handle("desktop:create-workspace", (_event, request) => createWorkspace(request));
  ipcMain.handle("desktop:update-workspace", (_event, request) => updateWorkspace(request));
  ipcMain.handle("desktop:delete-workspace", (_event, id) => deleteWorkspace(id));
  ipcMain.handle("desktop:get-my-drsai-config", async (_event, workspacePath) => {
    if (workspacePath === undefined) return getMyDrSaiConfig();
    const path = await assertRegisteredWorkspacePath(workspacePath);
    const workspace = (await listWorkspaces()).find((item) => item.path === path);
    return getMyDrSaiConfig(workspace?.location === "remote" ? undefined : path);
  });
  ipcMain.handle("desktop:update-my-drsai-config", (_event, request) => updateMyDrSaiConfig(request));
  ipcMain.handle("desktop:user-preferences-list", () => listUserPreferences());
  ipcMain.handle("desktop:user-preference-upsert", (_event, request) => upsertUserPreference(request));
  ipcMain.handle("desktop:user-preference-delete", (_event, request) => deleteUserPreference(request));
  ipcMain.handle("desktop:custom-commands-list", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return listCustomCommands(request); });
  ipcMain.handle("desktop:custom-command-upsert", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return upsertCustomCommand(request); });
  ipcMain.handle("desktop:custom-command-delete", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return deleteCustomCommand(request); });
  ipcMain.handle("desktop:project-memory-list", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return listProjectMemory(request); });
  ipcMain.handle("desktop:project-memory-add", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return addProjectMemory(request); });
  ipcMain.handle("desktop:project-memory-update", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return updateProjectMemory(request); });
  ipcMain.handle("desktop:project-memory-clear", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return clearProjectMemory(request); });
  ipcMain.handle("desktop:team-memory-list", (_event, request) => listTeamMemory(request));
  ipcMain.handle("desktop:team-memory-add", (_event, request) => addTeamMemory(request));
  ipcMain.handle("desktop:team-memory-delete", (_event, request) => deleteTeamMemory(request));
  ipcMain.handle("desktop:project-skill-drafts-list", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return listProjectSkillDrafts(request); });
  ipcMain.handle("desktop:project-skill-draft-create", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return createProjectSkillDraft(request); });
  ipcMain.handle("desktop:project-skill-draft-install", async (_event, request) => {
    const workspacePath = await assertRegisteredWorkspacePath(request?.workspacePath); const stable = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const proposal = await approvalStore.propose({ source: "workflow", actionKind: "workflow.run", title: "Install project skill", detail: `Install reviewed project skill draft ${request?.draftId}.`, target: workspacePath, risk: "high", idempotencyKey: `skill-install:${stable}` }, async () => { await installProjectSkillDraft(request); return true; });
    if (proposal.blocked || !proposal.allowed) throw new Error(proposal.reason);
    if (proposal.queued && proposal.approval) return { workspacePath, draftId: request?.draftId, title: "Pending approval", slug: "pending", target: "desktop_local", installedAt: "", installPath: "", alreadyInstalled: false, approvalId: proposal.approval.id, approvalQueued: true };
    return installProjectSkillDraft(request);
  });
  ipcMain.handle("desktop:project-skill-draft-publish", async (_event, request) => {
    const workspacePath = await assertRegisteredWorkspacePath(request?.workspacePath); const stable = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const proposal = await approvalStore.propose({ source: "workflow", actionKind: "workflow.run", title: "Prepare project skill publication", detail: `Create a reviewed marketplace submission for skill draft ${request?.draftId}. No network upload is performed.`, target: workspacePath, risk: "high", idempotencyKey: `skill-publish:${stable}` }, async () => { await publishProjectSkillDraft(request); return true; });
    if (proposal.blocked || !proposal.allowed) throw new Error(proposal.reason);
    if (proposal.queued && proposal.approval) return { workspacePath, draftId: request?.draftId, title: "Pending approval", slug: "pending", target: "marketplace_submission", publishedAt: "", submissionPath: "", alreadyPublished: false, verification: "Waiting for Approval Center review.", approvalId: proposal.approval.id, approvalQueued: true };
    return publishProjectSkillDraft(request);
  });
  ipcMain.handle("desktop:workflow-marketplace-list", async (_event, workspacePath) => { if (workspacePath !== undefined) await assertRegisteredWorkspacePath(workspacePath); return listWorkflowMarketplace(workspacePath); });
  ipcMain.handle("desktop:workflow-marketplace-sync", async (_event, request) => {
    const path = await assertRegisteredWorkspacePath(request?.workspacePath); const workspace = (await listWorkspaces()).find((item) => item.path === path); if (workspace?.location === "remote") throw new Error("Workflow marketplace sync requires a local Workspace source file."); return syncWorkflowMarketplace(request);
  });
  ipcMain.handle("desktop:workflow-run-prepare", (_event, request) => prepareWorkflowRun(request));
  ipcMain.handle("desktop:workflow-run-start", async (_event, request) => { if (request?.recipe?.workspacePath !== undefined) await assertRegisteredWorkspacePath(request.recipe.workspacePath); const result = await startWorkflowRun(request); await backgroundTaskStore.upsertWorkflow(result.run); return result; });
  ipcMain.handle("desktop:workflow-runs-list", async (_event, workspacePath) => { if (workspacePath !== undefined) await assertRegisteredWorkspacePath(workspacePath); return listWorkflowRuns(workspacePath); });
  ipcMain.handle("desktop:workflow-run-step-dispatch", async (_event, request) => { const result = await dispatchWorkflowRunStep(request); await backgroundTaskStore.upsertWorkflow(result.run); return result; });
  ipcMain.handle("desktop:workflow-run-step-complete", async (_event, request) => { const result = await completeWorkflowRunStep(request); await backgroundTaskStore.upsertWorkflow(result.run); return result; });
  ipcMain.handle("desktop:manager-presentation-generate", async (event, request: ManagerPresentationGenerateRequest) => {
    await assertRegisteredWorkspacePath(request?.workspacePath);
    assertAllowedDesktopPath(request?.sourcePath, [request.workspacePath]);
    const requestId = typeof request?.requestId === "string" ? request.requestId.trim() : "";
    if (!requestId || requestId.length > 128) throw new Error("A valid presentation request id is required.");
    if (managerPresentationRuns.has(requestId)) throw new Error("This presentation task is already running.");
    request.requirements = sanitizeManagerPresentationRequirements(request.requirements);
    const run: ManagerPresentationRun = { controller: new AbortController(), ownerId: event.sender.id, request, paused: false, activeOperationController: null, resumeWaiters: new Set(), lastProgress: null, requirements: [...request.requirements] };
    const recovery = getManagerPresentationRecovery({ workspacePath: request.workspacePath, sourcePath: request.sourcePath });
    recordManagerPresentationStart(request);
    managerPresentationRuns.set(requestId, run);
    try {
      return await generateManagerPresentation(request, (progress) => {
        run.lastProgress = progress;
        recordManagerPresentationProgress(request, progress);
        publishManagerPresentationProgress(progress);
      }, {
        templatePath: join(app.getAppPath(), "resources", "presentation", "manager-deck-template.pptx"),
        signal: run.controller.signal,
        isPaused: () => run.paused,
        waitUntilResumed: () => run.paused ? new Promise<void>((resolveWait) => run.resumeWaiters.add(resolveWait)) : Promise.resolve(),
        setActiveOperationController: (controller) => { run.activeOperationController = controller; },
        getRequirements: () => [...run.requirements],
        initialStageArtifacts: recovery?.requestId === requestId ? recovery.stageArtifacts : [],
      });
    } catch (error) {
      if (!(error instanceof ManagerPresentationCancelledError)) {
        const failed: ManagerPresentationProgressEvent = { requestId, phase: "failed", activeStage: run.lastProgress?.activeStage, progress: 100, message: error instanceof Error ? error.message : String(error) };
        recordManagerPresentationProgress(request, failed);
        publishManagerPresentationProgress(failed);
      }
      throw error;
    } finally { managerPresentationRuns.delete(requestId); }
  });
  ipcMain.handle("desktop:manager-presentation-cancel", (event, request: ManagerPresentationCancelRequest) => {
    const requestId = request?.requestId?.trim() || ""; const run = managerPresentationRuns.get(requestId);
    if (!run || run.ownerId !== event.sender.id) return { requestId, accepted: false };
    run.controller.abort(); resumeManagerPresentation(run); return { requestId, accepted: true };
  });
  ipcMain.handle("desktop:manager-presentation-pause", (event, request: ManagerPresentationPauseRequest) => {
    const requestId = request?.requestId?.trim() || ""; const run = managerPresentationRuns.get(requestId);
    if (!run || run.ownerId !== event.sender.id || run.paused) return { requestId, accepted: false };
    run.paused = true; run.activeOperationController?.abort(); return { requestId, accepted: true };
  });
  ipcMain.handle("desktop:manager-presentation-resume", (event, request: ManagerPresentationPauseRequest) => {
    const requestId = request?.requestId?.trim() || ""; const run = managerPresentationRuns.get(requestId);
    if (!run || run.ownerId !== event.sender.id || !run.paused) return { requestId, accepted: false };
    resumeManagerPresentation(run); return { requestId, accepted: true };
  });
  ipcMain.handle("desktop:manager-presentation-requirement-update", (event, update: ManagerPresentationRequirementUpdateRequest) => {
    const requestId = update?.requestId?.trim() || ""; const run = managerPresentationRuns.get(requestId); const activeStage = run?.lastProgress?.activeStage;
    const text = typeof update?.text === "string" ? update.text.trim().replace(/\s+/g, " ").slice(0, 240) : "";
    if (!run || run.ownerId !== event.sender.id || !text || !activeStage || !["analyzing", "planning", "generating"].includes(activeStage)) return { requestId, accepted: false, activeStage, scope: "regenerate_required", requirements: run ? [...run.requirements] : [], message: "The requirement cannot be applied to the active generation stage." };
    if (!run.requirements.includes(text)) run.requirements = [...run.requirements, text].slice(-5);
    run.request.requirements = [...run.requirements];
    if (run.lastProgress) recordManagerPresentationProgress(run.request, run.lastProgress);
    return { requestId, accepted: true, activeStage, scope: "current_unfinished_stages", requirements: [...run.requirements], message: "The requirement will be applied to unfinished stages." };
  });
  ipcMain.handle("desktop:manager-presentation-recovery", async (_event, request: ManagerPresentationRecoveryRequest) => {
    await assertRegisteredWorkspacePath(request?.workspacePath); assertAllowedDesktopPath(request?.sourcePath, [request.workspacePath]);
    const active = [...managerPresentationRuns.values()].find((run) => run.request.workspacePath === request.workspacePath && run.request.sourcePath === request.sourcePath);
    return active?.lastProgress ? { ...active.lastProgress, workspacePath: request.workspacePath, sourcePath: request.sourcePath, updatedAt: new Date().toISOString() } : getManagerPresentationRecovery(request);
  });
  ipcMain.handle("desktop:manager-presentation-recovery-resolve", async (_event, request: ManagerPresentationRecoveryDecisionRequest) => {
    await assertRegisteredWorkspacePath(request?.workspacePath); assertAllowedDesktopPath(request?.sourcePath, [request.workspacePath]);
    if (!request || !["restart", "abandon"].includes(request.decision)) throw new Error("Presentation recovery decision is invalid.");
    return resolveManagerPresentationRecovery(request);
  });
  ipcMain.handle("desktop:background-tasks-list", async (_event, request) => { if (request?.workspacePath !== undefined) await assertRegisteredWorkspacePath(request.workspacePath); return backgroundTaskStore.list(request); });
  ipcMain.handle("desktop:reusable-tasks-list", () => listReusableTasks());
  ipcMain.handle("desktop:reusable-task-save", (_event, request) => saveReusableTask(request));
  ipcMain.handle("desktop:reusable-task-run-prepare", async (_event, request) => {
    if (request?.workspacePath !== undefined) await assertRegisteredWorkspacePath(request.workspacePath);
    return prepareReusableTaskRun(request);
  });
  ipcMain.handle("desktop:background-task-enqueue", async (_event, request) => { if (request?.workspacePath !== undefined) await assertRegisteredWorkspacePath(request.workspacePath); return backgroundTaskStore.enqueue(request); });
  ipcMain.handle("desktop:background-task-update", async (_event, request) => {
    const task = await backgroundTaskStore.update(request);
    notifyBackgroundTaskCompleted(task, {
      kind: task.kind,
      targetId: task.targetId || task.id,
      ...(task.workspacePath ? { workspacePath: task.workspacePath } : {}),
    });
    return task;
  });
  ipcMain.handle("desktop:completion-notification-preference-set", (_event, preference) =>
    setCompletionNotificationPreference(preference),
  );
  ipcMain.handle("desktop:background-task-cancel", (_event, request) => backgroundTaskStore.cancel(request));
  ipcMain.handle("desktop:background-task-retry", (_event, request) => backgroundTaskStore.retry(request));
  ipcMain.handle("desktop:background-tasks-recover", () => backgroundTaskStore.recover());
  ipcMain.handle("desktop:share-create", (_event, request) => createShare(request));
  ipcMain.handle("desktop:share-inspect", (_event, request) => inspectShare(request));
  ipcMain.handle("desktop:share-permission-update", (_event, request) => updateSharePermission(request));
  ipcMain.handle("desktop:share-revoke", (_event, request) => revokeShare(request));
  ipcMain.handle("desktop:share-version-inspect", (_event, request) => inspectShareVersion(request));
  ipcMain.handle("desktop:share-version-publish", (_event, request) => publishShareVersion(request));
  ipcMain.handle("desktop:share-comments-list", (_event, request) => listShareComments(request));
  ipcMain.handle("desktop:share-comment-add", (_event, request) => addShareComment(request));
  ipcMain.handle("desktop:share-comment-task-preview", (_event, request) => previewShareCommentTask(request));
  ipcMain.handle("desktop:share-comment-task-create", (_event, request) => createShareCommentTask(request));
  ipcMain.handle("desktop:share-comment-task-update", (_event, request) => updateShareCommentTask(request));
  ipcMain.handle("desktop:share-comment-task-complete", (_event, request) => completeShareCommentTask(request));
  ipcMain.handle("desktop:share-comment-tasks-list", (_event, request) => listShareCommentTasks(request));
  ipcMain.handle("desktop:share-continue", (_event, request) => continueSharedTask(request));
  ipcMain.handle("desktop:share-audit-list", (_event, request) => listShareAudit(request));
  ipcMain.handle("desktop:shares-incoming-list", () => listIncomingShares());
  ipcMain.handle("desktop:shares-outgoing-list", () => listOutgoingShares());
  ipcMain.handle("desktop:shared-object-open", (_event, request) => openSharedObject(request));
  ipcMain.handle("desktop:shared-artifact-download", (_event, request) => downloadSharedArtifact(request));
  ipcMain.handle("desktop:channel-adapters-list", async (_event, workspacePath) => { if (workspacePath !== undefined) await assertRegisteredWorkspacePath(workspacePath); return (await import("../../../shared/main/channelAdapters")).listChannelAdapters(workspacePath); });
  ipcMain.handle("desktop:channel-adapter-configure", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return (await import("../../../shared/main/channelAdapters")).configureChannelAdapter(request); });
  ipcMain.handle("desktop:channel-adapter-auth-start", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return (await import("../../../shared/main/channelAdapters")).startChannelAdapterAuth(request); });
  ipcMain.handle("desktop:channel-adapter-auth-poll", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return (await import("../../../shared/main/channelAdapters")).pollChannelAdapterAuth(request); });
  ipcMain.handle("desktop:channel-adapter-auth-revoke", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return (await import("../../../shared/main/channelAdapters")).revokeChannelAdapterAuth(request); });
  ipcMain.handle("desktop:channel-provider-token-configure", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return (await import("../../../shared/main/channelAdapters")).configureChannelProviderToken(request); });
  ipcMain.handle("desktop:channel-context-import", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return (await import("../../../shared/main/channelAdapters")).importChannelContext(request); });
  ipcMain.handle("desktop:channel-live-sync", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return (await import("../../../shared/main/channelAdapters")).syncLiveChannelContext(request); });
  ipcMain.handle("desktop:channel-snapshot-sync", async (_event, request) => { await assertRegisteredWorkspacePath(request?.workspacePath); return (await import("../../../shared/main/channelAdapters")).syncChannelSnapshots(request); });
  ipcMain.handle("desktop:channel-inbound-events", async (_event, request) => { if (request?.workspacePath !== undefined) await assertRegisteredWorkspacePath(request.workspacePath); return (await import("../../../shared/main/channelAdapters")).listChannelInboundEvents(request); });
  ipcMain.handle("desktop:channel-inbound-route", async (_event, request) => { if (request?.workspacePath !== undefined) await assertRegisteredWorkspacePath(request.workspacePath); return (await import("../../../shared/main/channelAdapters")).routeChannelInboundEvent(request); });
  ipcMain.handle("desktop:channel-outbound-draft", (_event, request) => proposeChannelOutboundDraft(request));
  ipcMain.handle("desktop:channel-outbound-deliveries", async (_event, request) => { if (request?.workspacePath !== undefined) await assertRegisteredWorkspacePath(request.workspacePath); return (await import("../../../shared/main/channelAdapters")).listChannelOutboundDeliveries(request); });
  ipcMain.handle("desktop:external-connection-readiness", async (_event, workspacePath) => { if (workspacePath !== undefined) await assertRegisteredWorkspacePath(workspacePath); return (await import("../../../shared/main/externalConnectionReadiness")).listExternalConnectionReadiness(workspacePath); });
  ipcMain.handle("desktop:scheduled-tasks-list", async (_event, request) => { if (request?.workspacePath !== undefined) await assertRegisteredWorkspacePath(request.workspacePath); return scheduledTaskStore.list(request); });
  ipcMain.handle("desktop:scheduled-task-create", async (_event, request) => { if (request?.workspacePath !== undefined) await assertRegisteredWorkspacePath(request.workspacePath); return scheduledTaskStore.create(request); });
  ipcMain.handle("desktop:scheduled-task-update", (_event, request) => scheduledTaskStore.update(request));
  ipcMain.handle("desktop:scheduled-task-delete", (_event, request) => scheduledTaskStore.delete(request));
  ipcMain.handle("desktop:scheduled-tasks-run-due", async (_event, request) => { if (request?.workspacePath !== undefined) await assertRegisteredWorkspacePath(request.workspacePath); return scheduledTaskStore.runDue(request, scheduledTaskRuntime); });
  ipcMain.handle("desktop:scheduled-task-worker-status", () => scheduledTaskWorker?.getStatus() ?? { enabled: false, running: false, stopped: true, intervalMs: 0, initialDelayMs: 0, message: "Scheduled task worker is disabled." });
  ipcMain.handle("desktop:workspace-context-overview", async (_event, workspacePath) =>
    await isRemoteWorkspaceTarget(workspacePath)
      ? remoteWorkspaceController.contextOverview(workspacePath)
      : getWorkspaceContextOverview(workspacePath));
  ipcMain.handle("desktop:workspace-files", async (_event, request) =>
    await isRemoteWorkspaceTarget(request?.workspacePath, request?.workspaceId)
      ? remoteWorkspaceController.listFiles(request)
      : listWorkspaceFiles(request));
  ipcMain.handle("desktop:workspace-folder-summary", (_event, request) =>
    isRemoteFolderTarget(request?.path)
      ? remoteWorkspaceController.folderSummary(request)
      : summarizeWorkspaceFolder(request));
  ipcMain.handle("desktop:workspace-file-preview", async (_event, request) =>
    await isRemoteWorkspaceTarget(request?.workspacePath, request?.workspaceId)
      ? remoteWorkspaceController.previewFile(request)
      : previewWorkspaceFile(request));
  ipcMain.handle("desktop:workspace-file-save-as", async (_event, request) =>
    await isRemoteWorkspaceTarget(request?.workspacePath, request?.workspaceId)
      ? remoteWorkspaceController.writeFile(request)
      : saveWorkspaceFileAs(request));
  ipcMain.handle("desktop:workspace-file-write", async (_event, request) =>
    await isRemoteWorkspaceTarget(request?.workspacePath, request?.workspaceId)
      ? remoteWorkspaceController.writeFile(request)
      : writeWorkspaceFile(request));
  ipcMain.handle("desktop:workspace-git-diff", async (_event, request) =>
    await isRemoteWorkspaceTarget(request?.workspacePath, request?.workspaceId)
      ? remoteWorkspaceController.gitDiff(request)
      : getWorkspaceGitDiff(request));
  ipcMain.handle("desktop:workspace-git-file-at-ref", async (_event, request) =>
    await isRemoteWorkspaceTarget(request?.workspacePath, request?.workspaceId)
      ? remoteWorkspaceController.gitFileAtRef(request)
      : getWorkspaceGitFileAtRef(request));
  ipcMain.handle("desktop:workspace-stage-file", async (_event, request) =>
    await isRemoteWorkspaceTarget(request?.workspacePath, request?.workspaceId)
      ? remoteWorkspaceController.mutateGit("stage-file", request)
      : stageWorkspaceFile(request));
  ipcMain.handle("desktop:workspace-revert-file", async (_event, request) =>
    await isRemoteWorkspaceTarget(request?.workspacePath, request?.workspaceId)
      ? remoteWorkspaceController.mutateGit("revert-file", request)
      : revertWorkspaceFile(request));
  ipcMain.handle("desktop:workspace-stage-hunk", async (_event, request) =>
    await isRemoteWorkspaceTarget(request?.workspacePath, request?.workspaceId)
      ? remoteWorkspaceController.mutateGit("stage-hunk", request)
      : stageWorkspaceHunk(request));
  ipcMain.handle("desktop:workspace-revert-hunk", async (_event, request) =>
    await isRemoteWorkspaceTarget(request?.workspacePath, request?.workspaceId)
      ? remoteWorkspaceController.mutateGit("revert-hunk", request)
      : revertWorkspaceHunk(request));
  ipcMain.handle("desktop:workspace-checkpoints-list", async (_event, workspacePath) => {
    assertAllowedDesktopPath(workspacePath, await allowedDesktopRoots(), { directory: true });
    return listWorkspaceCheckpoints(workspacePath);
  });
  ipcMain.handle("desktop:workspace-checkpoint-create", async (_event, request) => {
    const workspacePath = request && typeof request === "object" ? (request as { workspacePath?: unknown }).workspacePath : undefined;
    assertAllowedDesktopPath(workspacePath, await allowedDesktopRoots(), { directory: true });
    return createWorkspaceCheckpoint(request);
  });
  ipcMain.handle("desktop:workspace-checkpoint-accept", async (_event, request) => {
    const workspacePath = request && typeof request === "object" ? (request as { workspacePath?: unknown }).workspacePath : undefined;
    assertAllowedDesktopPath(workspacePath, await allowedDesktopRoots(), { directory: true });
    return acceptWorkspaceCheckpoint(request);
  });
  ipcMain.handle("desktop:workspace-checkpoint-preview", async (_event, request) => {
    const workspacePath = request && typeof request === "object" ? (request as { workspacePath?: unknown }).workspacePath : undefined;
    assertAllowedDesktopPath(workspacePath, await allowedDesktopRoots(), { directory: true });
    return previewWorkspaceCheckpoint(request);
  });
  ipcMain.handle("desktop:workspace-checkpoint-restore", async (_event, rawRequest) => {
    if (!rawRequest || typeof rawRequest !== "object") throw new Error("Workspace checkpoint restore request is incomplete.");
    const value = rawRequest as { workspacePath?: unknown; checkpointId?: unknown; operationId?: unknown; includePaths?: unknown };
    const workspacePath = assertAllowedDesktopPath(value.workspacePath, await allowedDesktopRoots(), { directory: true });
    if (typeof value.checkpointId !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value.checkpointId)) throw new Error("Workspace checkpoint id is invalid.");
    const checkpoint = (await listWorkspaceCheckpoints(workspacePath)).find((item) => item.id === value.checkpointId);
    if (!checkpoint) throw new Error("Workspace checkpoint was not found for this workspace.");
    if (checkpoint.kind === "agent_run_baseline" && checkpoint.reviewStatus !== "pending") throw new Error("Agent run change set has already been reviewed.");
    const operationId = typeof value.operationId === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value.operationId) ? value.operationId : `restore-${Date.now().toString(36)}`;
    const includePaths = Array.isArray(value.includePaths) ? value.includePaths.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 200) : undefined;
    const stableKey = createHash("sha256").update(`${workspacePath}\0${value.checkpointId}\0${operationId}\0${includePaths?.join("\0") ?? ""}`).digest("hex");
    const request = { workspacePath, checkpointId: value.checkpointId, operationId, ...(includePaths ? { includePaths } : {}) };
    const proposal = await approvalStore.propose({ source: "workspace", actionKind: "workspace.revert", title: "Restore workspace checkpoint", detail: includePaths ? `Restore ${includePaths.join(", ")} from checkpoint ${value.checkpointId}.` : `Restore checkpoint ${value.checkpointId}; captured files may be overwritten or removed.`, target: workspacePath, risk: "high", idempotencyKey: `checkpoint-restore:${stableKey}` }, async () => { await restoreWorkspaceCheckpoint(request); return true; });
    if (proposal.blocked || !proposal.allowed) throw new Error(proposal.reason);
    if (proposal.queued && proposal.approval) return { workspacePath, checkpointId: value.checkpointId, restored: false, restoredFileCount: 0, removedFileCount: 0, skippedFileCount: 0, approvalId: proposal.approval.id, approvalQueued: true, message: "Workspace checkpoint restore is waiting in Approval Center." };
    return { workspacePath, checkpointId: value.checkpointId, restored: true, restoredFileCount: 0, removedFileCount: 0, skippedFileCount: 0, approvalQueued: false, message: "This idempotent checkpoint restore was already executed." };
  });
  ipcMain.handle("desktop:prepare-fork-worktree", async (_event, request) => {
    const workspacePath = request && typeof request === "object" ? (request as { workspacePath?: unknown }).workspacePath : undefined;
    assertAllowedDesktopPath(workspacePath, await allowedDesktopRoots(), { directory: true });
    return prepareForkWorktree(request);
  });
  ipcMain.handle("desktop:list-worktrees", async (_event, request) => {
    const workspacePath = request && typeof request === "object" ? (request as { workspacePath?: unknown }).workspacePath : undefined;
    assertAllowedDesktopPath(workspacePath, await allowedDesktopRoots(), { directory: true });
    return listRuntimeWorktrees(request);
  });
  ipcMain.handle("desktop:list-worktree-events", async (_event, request) => {
    const workspacePath = request && typeof request === "object" ? (request as { workspacePath?: unknown }).workspacePath : undefined;
    assertAllowedDesktopPath(workspacePath, await allowedDesktopRoots(), { directory: true });
    return listRuntimeWorktreeEvents(request);
  });
  ipcMain.handle("desktop:worktree-migration-diagnostics", async (_event, request) => {
    const workspacePath = request && typeof request === "object" ? (request as { workspacePath?: unknown }).workspacePath : undefined;
    assertAllowedDesktopPath(workspacePath, await allowedDesktopRoots(), { directory: true });
    return getWorktreeMigrationDiagnostics(request);
  });
  ipcMain.handle("desktop:material-role-analysis", (_event, request) => analyzeMaterialRoles(request));
  ipcMain.handle("desktop:material-consistency-analysis", (_event, request) => analyzeMaterialConsistency(request));
  ipcMain.handle("desktop:material-query", (_event, request) => queryMaterials(request));
  ipcMain.handle("desktop:apply-anomaly-decision", async (_event, request) => {
    await assertRegisteredWorkspacePath(request?.workspacePath);
    return applyAnomalyDecision(request);
  });
  ipcMain.handle("desktop:voice-transcription-start", (event, request) => startVoiceTranscription(event.sender, request));
  ipcMain.handle("desktop:voice-transcription-cancel", (_event, requestId) => cancelVoiceTranscription(requestId));
  ipcMain.handle("desktop:voice-runtime-status", () => getVoiceRuntimeStatus());
  ipcMain.handle("desktop:voice-streaming-capabilities", () => getStreamingVoiceCapabilities());
  ipcMain.handle("desktop:voice-streaming-start", (event, request: DesktopStreamingVoiceStartRequest) => startStreamingVoiceTranscription(event.sender, request));
  ipcMain.handle("desktop:voice-streaming-stop", (event, sessionId: string, reason?: "provider" | "local_vad" | "manual") => stopStreamingVoiceTranscription(event.sender, typeof sessionId === "string" ? sessionId : "", reason === "provider" || reason === "local_vad" ? reason : "manual"));
  ipcMain.handle("desktop:voice-streaming-cancel", (event, sessionId: string) => cancelStreamingVoiceTranscription(event.sender, typeof sessionId === "string" ? sessionId : ""));
  rawIpcMain.on("desktop:voice-streaming-audio-port", (event: IpcMainEvent, request: unknown) => {
    const trusted = isTrustedDesktopIpcSender(
      event as unknown as Parameters<typeof isTrustedDesktopIpcSender>[0],
      mainWindow?.webContents,
      allowDevelopmentRendererUrl,
    );
    const sessionId = request && typeof request === "object" && typeof (request as { sessionId?: unknown }).sessionId === "string"
      ? (request as { sessionId: string }).sessionId.trim()
      : "";
    const port = event.ports[0];
    if (!trusted || !sessionId || !port) { port?.close(); return; }
    attachStreamingVoiceAudioPort(event.sender, sessionId, port);
  });
  ipcMain.handle("desktop:voice-synthesis-start", (event, request) => startVoiceSynthesis(event.sender, request));
  ipcMain.handle("desktop:voice-synthesis-cancel", (_event, requestId) => cancelVoiceSynthesis(requestId));
  ipcMain.handle("desktop:voice-synthesis-runtime-status", () => getVoiceSynthesisRuntimeStatus());
  ipcMain.handle("desktop:voice-handoff-write", (_event, request) => writeVoiceTranscriptHandoff(request));
  ipcMain.handle("desktop:start-agent-run", (event, request) => {
    if (getA5ServiceGuidanceScenario()) throw new Error("A5 service guidance blocks Agent runs until the service is available.");
    return startAgentRun(event.sender, request);
  });
  ipcMain.handle("desktop:abort-agent-run", (_event, requestId) => abortAgentRun(requestId));
  ipcMain.handle("desktop:recover-agent-run", (event, threadId) => recoverAgentRun(threadId, event.sender));
  ipcMain.handle("desktop:start-chat", (event, request) => {
    if (getA5ServiceGuidanceScenario()) throw new Error("A5 service guidance blocks chat until the service is available.");
    return startChat(event.sender, request);
  });
  ipcMain.handle("desktop:abort-chat", (_event, requestId) => abortChat(requestId));
  ipcMain.handle("desktop:recover-chat-run", (event, request) => recoverChatRun(request, event.sender));
  ipcMain.handle("desktop:respond-chat-input", (_event, requestId, response) => respondChatInput(requestId, response));
  const window = createWindow();
  runPackagedSmokeIfRequested(window);
  app.on("activate", () => {
    focusOrCreateMainWindow();
  });
});

app.on("before-quit", (event) => {
  recoveryCoordinator.beginShutdown();
  if (shutdownCoordinator.running) return;
  event.preventDefault();
  void shutdownCoordinator.run([
    () => { scheduledTaskWorker?.stop(); scheduledTaskWorker = null; },
    () => killAllTerminalSessions(),
    () => { cleanupAllVoiceTempFiles(); },
    () => { cancelBundledRuntimeInstall(); },
    () => approvalStore.shutdown(),
    () => interactiveDebugger.shutdown(),
    () => { browserTaskService.shutdown(); },
    () => { shutdownMcpSessions(); },
    () => portForwardRegistry.shutdown(),
    () => { sshHostService.shutdown(); },
    () => { remoteGatewayInstaller.shutdown(); },
    () => remoteWorkspaceController.shutdown(),
    () => closeMobilePairingControllers(),
    () => shutdownAgentRunJournal(),
    () => shutdownChatRunJournal(),
    () => stopGateway(),
  ]).finally(() => app.exit(0));
});
app.on("will-quit", () => {
  if (networkMonitor) clearInterval(networkMonitor);
  networkMonitor = null;
});
app.on("window-all-closed", () => {
  // Remain active in the Dock until the user explicitly chooses Quit.
});

process.on("uncaughtException", () => { void orderlyRelaunch("MAIN_UNCAUGHT_EXCEPTION"); });
process.on("unhandledRejection", () => { void orderlyRelaunch("MAIN_UNHANDLED_REJECTION"); });
