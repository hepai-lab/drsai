import "./developmentLaunchEnvironment";
import { execFile, spawn, type ChildProcess } from "child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "fs";
import { copyFile, mkdir, open as openFile, rename, stat as statFile, unlink, writeFile } from "fs/promises";
import { createHash } from "crypto";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  protocol,
  session as electronSession,
  shell,
  type IpcMainInvokeEvent,
  type IpcMainEvent,
  type Session,
  type SaveDialogOptions,
  type SaveDialogReturnValue,
  type WebContents,
} from "electron";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "path";
import { hostname } from "os";
import { isIP } from "net";
import { pathToFileURL } from "url";
import { is } from "@electron-toolkit/utils";
import { cancelInstall, startInstall } from "./install";
import {
  getGatewayStatus,
  getGatewayStartupMode,
  shutdownGateway,
  startGateway,
  stopGateway,
} from "./gateway";
import { getDesktopHealth, getInstallStatus } from "./status";
import { bootstrapDesktop } from "./bootstrap";
import { connectRuntimeClientForWorkspace, isLocalRuntimeUnavailableError, LocalRuntimeClient } from "./runtimeClient";
import { migrateLegacyAgentRunsToRuntime } from "../../../shared/main/legacyAgentRunMigration";
import type {
  RunInspectionOpenRequest,
  RunItemLocatorRequest,
  RunManifestReadRequest,
  RunManifestExportResult,
  SessionRunsReadRequest,
} from "../../../shared/api/runInspection";
import {
  sanitizeRunInspection,
  sanitizeRunReproductionManifest,
  sanitizeSessionRunList,
} from "../../../shared/api/runInspectionSafety";
import type {
  CreateReplayPlanRequest,
  CreateRunExperimentRequest,
  CreateRunComparisonRequest,
  DeleteRunExperimentRequest,
  ExecuteReplayPlanRequest,
  GetReplayBoundariesRequest,
  GetReplayPlanRequest,
  GetRunExperimentCapabilitiesRequest,
  FinalizeRunExperimentCandidateRequest,
  GetRunExperimentRequest,
  GetRunComparisonRequest,
  GetRunRelationsRequest,
  GetWorktreeAdoptionPreviewRequest,
  ApplyWorktreeAdoptionRequest,
  GetRunAdoptionPreviewRequest,
  ApplyRunAdoptionRequest,
  DiscardRunAdoptionRequest,
  RuntimeSecurityApprovalDecisionRequest,
  RuntimeRunApprovalDecisionRequest,
  RunExperimentPackageExportResult,
  UpdateRunExperimentRequest,
} from "../../../shared/api/runExperiment";
import { MobilePairingController } from "../../../shared/main/mobilePairingController";
import { assertExperimentReleaseEnabled, readExperimentReleaseGate } from "../../../shared/main/experimentReleaseGate";
import { classifyMobileRemoteDiagnostics } from "../../../shared/main/mobileRemoteDiagnostics";
import { RemoteProtocolError } from "../../../shared/api/remoteSshProtocol";
import { desktopDiagnostics } from "./diagnostics";
import { productionDiagnostics } from "../../../shared/main/productionDiagnostics";
import { DiagnosticSourceNavigator } from "../../../shared/main/sourceNavigation";
import { extractDiagnosticContext, runWithDiagnosticContext } from "../../../shared/main/diagnosticContext";
import { isTrustedDesktopIpcSender } from "../../../shared/main/secureIpc";
import { InteractiveDebuggerService } from "./interactiveDebugger";
import { InteractiveDebugPolicyStore } from "../../../shared/main/interactiveDebugPolicy";
import type { DiagnosticEventInput, DiagnosticIssueUpdateRequest, DiagnosticQuery, DiagnosticSourceOpenRequest, DiagnosticSourceContextRequest, ProductionDiagnosticSettings } from "../../../shared/api/diagnostics";

process.setSourceMapsEnabled?.(true);
let experimentReleaseGatePromise: ReturnType<typeof readExperimentReleaseGate> | null = null;
function getExperimentReleaseGate() {
  experimentReleaseGatePromise ??= readExperimentReleaseGate([
    join(app.getAppPath(), "resources", "release", "experiment-release-gate.json"),
    join(process.resourcesPath, "app.asar.unpacked", "resources", "release", "experiment-release-gate.json"),
  ]);
  return experimentReleaseGatePromise;
}
async function requireExperimentReleaseGate(): Promise<void> {
  assertExperimentReleaseEnabled(await getExperimentReleaseGate());
}
const configuredElectronUserData = process.env.OPENDRSAI_ELECTRON_USER_DATA?.trim();
if (configuredElectronUserData) {
  if (!isAbsolute(configuredElectronUserData)) {
    throw new Error("OPENDRSAI_ELECTRON_USER_DATA must be an absolute path.");
  }
  app.setPath("userData", resolve(configuredElectronUserData));
}
const configuredE2eDocumentsPath = process.env.OPENDRSAI_E2E_DOCUMENTS_PATH?.trim();
if (configuredE2eDocumentsPath) {
  if (!isAbsolute(configuredE2eDocumentsPath)) {
    throw new Error("OPENDRSAI_E2E_DOCUMENTS_PATH must be an absolute path.");
  }
  app.setPath("documents", resolve(configuredE2eDocumentsPath));
}
if (process.env.OPENDRSAI_DESKTOP_DEV === "1") app.setName("OpenDrSai Dev");
if (process.platform === "win32") {
  app.setAppUserModelId(is.dev ? "com.hepai.opendrsai.windows.dev" : "com.hepai.opendrsai.windows");
}
import { presentCodexBackendStatus } from "./codexBackendStatus";
import { DRSAI_HOME, DRSAI_REPO } from "./paths";
import { WINDOWS_PLATFORM_DESCRIPTOR } from "./platform";
import { clearLocalData, previewLocalDataCleanup } from "./dataCleanup";
import { scanSensitiveText } from "../../../shared/main/shareSensitivity";
import {
  cancelUpdate,
  checkForUpdates,
  confirmPendingUpdateLaunch,
  getUpdateStatus,
  restorePreparedUpdate,
  downloadUpdate,
  installUpdate,
  startUpdateScheduler,
  subscribeUpdateStatus,
} from "./updates";
import { abortChat, hasActiveChats, recoverChatRun, respondChatInput, startChat } from "./chat";
import { listProviderErrorAnalytics } from "./providerErrorAnalytics";
import { listProviderUsageAnalytics } from "./providerUsageAnalytics";
import {
  abortAgentRun,
  hasActiveAgentRuns,
  recoverAgentRun,
  startAgentRun,
  subscribeAgentRunLifecycle,
} from "./agentRuns";
import {
  getAgentCatalogSnapshot,
  getPlatformAgentStatus,
  listAgents,
  recordAgentUsage,
  setDefaultAgent,
} from "./agents";
import {
  executeForkLifecycleAction,
  listRuntimeWorktrees,
  listRuntimeWorktreeEvents,
  getWorktreeMigrationDiagnostics,
  prepareForkWorktree,
} from "./forkWorktrees";
import { deleteMyDrSaiModelProvider, diagnoseMyDrSaiModelConnection, discoverMyDrSaiProviderModels, getMyDrSaiAgentModelCapabilityStatus, getMyDrSaiAgentModelPolicy, getMyDrSaiConfig, getMyDrSaiRuntimeModelCatalog, listMyDrSaiModelProviderPresets, migrateMyDrSaiAgentModelPolicy, preflightMyDrSaiModelProviderDeletion, previewMyDrSaiModelConnection, restoreMyDrSaiModelConnection, saveMyDrSaiModelProvider, testMyDrSaiModelDraft, testMyDrSaiModelProvider, updateMyDrSaiAgentModelPolicy, updateMyDrSaiConfig, updateMyDrSaiModelConnection } from "../../../shared/main/myDrSaiConfig";
import {
  assertExecutionAllowed,
  getDesktopExecutionPolicy,
} from "./executionPolicyGate";
import {
  createThread,
  deleteThread,
  getThreadSnapshot,
  listThreads,
  searchThreadMessages,
  updateThread,
  updateThreadSnapshot,
  upsertThreadFromRun,
} from "./threads";
import {
  createThreadShare,
  openThreadShare,
  revealThreadShare,
} from "./threadShare";
import {
  listInstalledSkills,
  listAvailableSkills,
  getSkillContent,
  installSkill,
  uninstallSkill,
  updateSkill,
  reloadSkills,
} from "./skills";
import {
  gfsList,
  gfsStat,
  gfsRead,
  gfsWrite,
  gfsUploadFile,
  gfsDownloadFile,
  gfsDelete,
  gfsShareUrl,
  gfsHealthcheck,
} from "./gfs";
import {
  getRuntimeThreadSnapshot,
  getRuntimeThreadSnapshotEnvelope,
  subscribeRuntimeThreadSnapshot,
} from "../../../shared/main/threadRuntimeSubscription";
import { setThreadArchived } from "./threadArchive";
import {
  addProjectMemory,
  clearProjectMemory,
  listProjectMemory,
  updateProjectMemory,
} from "../../../shared/main/projectMemory";
import { deleteUserPreference, listUserPreferences, upsertUserPreference } from "../../../shared/main/userPreferences";
import { addTeamMemory, deleteTeamMemory, listTeamMemory } from "../../../shared/main/teamMemory";
import { listReusableTasks, prepareReusableTaskRun, saveReusableTask } from "./reusableTasks";
import {
  deleteCustomCommand,
  listCustomCommands,
  upsertCustomCommand,
} from "../../../shared/main/customCommands";
import {
  createProjectSkillDraft,
  installProjectSkillDraft,
  listProjectSkillDrafts,
  publishProjectSkillDraft,
} from "../../../shared/main/projectSkills";
import {
  createWorkflowRunRecipe,
  getWorkflowTemplate,
  listWorkflowMarketplace,
  syncWorkflowMarketplace,
} from "./workflowMarketplace";
import {
  completeWorkflowRunStep,
  dispatchWorkflowRunStep,
  listWorkflowRuns,
  markWorkflowRunTerminalStepRunning,
  recoverWorkflowRunsAfterRestart,
  startWorkflowRun,
} from "./workflowRuns";
import {
  enqueueBackgroundTask,
  cancelBackgroundTask,
  listOwnedBackgroundTasks,
  recoverBackgroundTasksAfterRestart,
  retryBackgroundTask,
  updateBackgroundTask,
  upsertBackgroundTaskForAgentRun,
  upsertBackgroundTaskForManagerPresentation,
  upsertBackgroundTaskForWorkflowRun,
} from "./backgroundTasks";
import { DesktopApprovalStateStore, type DesktopApprovalPayload, type DesktopApprovalPayloadKind } from "./desktopApprovalState";
import { protectDesktopApprovalPayload, unprotectDesktopApprovalPayload } from "./desktopApprovalPayloadProtection";
import {
  createScheduledTask,
  deleteScheduledTask,
  listScheduledTasks,
  runDueScheduledTasks,
  startScheduledTaskWorker,
  type ScheduledTaskWorkerHandle,
  updateScheduledTask,
} from "./scheduledTasks";
import { addShareComment, completeShareCommentTask, continueSharedTask, createShare, createShareCommentTask, downloadSharedArtifact, inspectShare, inspectShareVersion, listIncomingShares, listOutgoingShares, listShareAudit, listShareComments, listShareCommentTasks, openSharedObject, previewShareCommentTask, publishShareVersion, revokeShare, updateShareCommentTask, updateSharePermission } from "./shares";
import {
  configureChannelProviderAuth,
  configureChannelAdapter,
  createChannelOutboundDraftApproval,
  executeChannelOutboundDeliveryAsync,
  importChannelContext,
  listChannelAdapters,
  listChannelInboundEvents,
  listChannelOutboundDeliveries,
  routeChannelInboundEvent,
  pollChannelAdapterAuth,
  revokeChannelAdapterAuth,
  startChannelAdapterAuth,
  configureChannelProviderToken,
  syncChannelSnapshots,
  syncLiveChannelContext,
} from "./channelAdapters";
import { WINDOWS_CREDENTIAL_SERVICE } from "./platformCredentials";
import { importMcpContext } from "./mcpContext";
import { decideMcpAtMostOnce, recoverAmbiguousMcpApproval } from "./mcpApprovalRecovery";
import { listExternalConnectionReadiness } from "./externalConnectionReadiness";
import {
  createMcpEnumerationBlockedResult,
  createMcpEnumerationQueuedResult,
  createMcpToolExecutionApprovalResult,
  cancelMcpActiveSession,
  closeMcpReusableSession,
  enumerateMcpLiveServer,
  executeMcpToolAfterApproval,
  inspectMcpLiveServers,
  listMcpActiveSessions,
  listMcpReusableSessions,
  listMcpSessionAudits,
  listMcpToolExecutionAudits,
  recordCancelledMcpLiveEnumerationAudit,
  recordCancelledMcpToolExecutionAudit,
  recordAmbiguousMcpToolExecutionAudit,
  recordRejectedMcpToolExecutionAudit,
} from "./mcpLiveBridge";
import {
  createDefaultWorkspace,
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  updateWorkspace,
} from "./workspaces";
import {
  connectRemoteWorkspace,
  disconnectRemoteWorkspace,
  getRemoteWorkspaceStatus,
  getRemoteGatewayAccess,
  resolveRemoteWorkspaceTarget,
  prepareRemoteForkWorktree,
  getRemoteWorkspaceGitDiff,
  executeRemoteWorkspaceMutation,
  listRemoteWorkspaceCheckpoints,
  createRemoteWorkspaceCheckpoint,
  previewRemoteWorkspaceCheckpoint,
  restoreRemoteWorkspaceCheckpoint,
  acceptRemoteWorkspaceCheckpoint,
  summarizeRemoteWorkspaceFolder,
  getRemoteWorkspaceGitFileAtRef,
  getRemoteWorkspaceRootForPath,
  getRemoteThreadSnapshot,
  searchRemoteThreadMessages,
  commitRemoteWorkspace,
  getRemoteWorkspaceContextOverview,
  getRemoteSshDiagnosticReport,
  listRemoteWorkspaceFiles,
  previewRemoteWorkspaceFile,
  writeRemoteWorkspaceFile,
  listRemoteDirectories,
  listRemoteThreads,
  listRemoteHepaiWorkers,
  setRemoteHepaiWorkerEnabled,
  listSshHosts,
  preflightRemoteGateway,
  installRemoteGateway,
  cancelRemoteGatewayOperation,
  restorePersistedRemoteWorkspaces,
  setRemoteWorkspaceStatusPublisher,
  setRemoteGatewayOperationPublisher,
  setRemoteFileChangePublisher,
  stopAllRemoteWorkspaces,
  diagnoseSshHost,
  inspectSshHostKeys,
  testSshHost,
  approveSshHostKey,
  connectSshHost,
  disconnectSshHost,
  reconnectSshHost,
  removeSshHostProfile,
  listPortForwards,
  createPortForward,
  pausePortForward,
  resumePortForward,
  removePortForward,
} from "./remoteWorkspace";
import { getIdeContext } from "../../../shared/main/ideContext";
import {
  getWorkspaceContextOverview,
  getWorkspaceGitFileAtRef,
  getWorkspaceGitDiff,
  listWorkspaceFiles,
  analyzeMaterialConsistency,
  analyzeMaterialRoles,
  queryMaterials,
  previewWorkspaceFile,
  revertWorkspaceHunk,
  revertWorkspaceFile,
  stageWorkspaceFile,
  stageWorkspaceHunk,
  summarizeWorkspaceFolder,
} from "./workspaceContext";
import {
  acceptWorkspaceCheckpoint,
  createWorkspaceCheckpoint,
  listWorkspaceCheckpoints,
  previewWorkspaceCheckpoint,
  restoreWorkspaceCheckpoint,
} from "./workspaceCheckpoints";
import {
  writeVoiceTranscriptHandoff,
  startVoiceTranscription,
  cancelVoiceTranscription,
  cancelVoiceTranscriptionsForSender,
  getVoiceRuntimeStatus,
  cleanupExpiredVoiceTempFiles,
} from "./voice";
import {
  attachStreamingVoiceAudioPort,
  cancelStreamingVoiceSessionsForSender,
  cancelStreamingVoiceTranscription,
  getStreamingVoiceCapabilities,
  startStreamingVoiceTranscription,
  stopStreamingVoiceTranscription,
} from "./voiceStreaming";
import {
  cancelVoiceSynthesis,
  cancelVoiceSynthesisForSender,
  getVoiceSynthesisRuntimeStatus,
  startVoiceSynthesis,
} from "./voiceTts";
import { saveApiKeyAndSync } from "./settings";
import {
  cancelOidcLogin,
  cancelDesktopSsoLogin,
  getAuthSession,
  login,
  logout,
  pollDesktopSsoLogin,
  refreshAuthSession,
  refreshAuthContextAfterUnauthorized,
  requireAuthContext,
  startDesktopSsoLogin,
  startOidcLogin,
  startWechatDesktopLogin,
} from "./auth";
import { maybeRunE2eSmoke } from "./e2eSmoke";
import {
  createTerminalSession,
  getTerminalBuffer,
  killAllTerminalSessions,
  killTerminalSession,
  listTerminalSessions,
  renameTerminalSession,
  resizeTerminalSession,
  writeTerminalSession,
} from "./terminal";
import type { TerminalCreateOptions } from "./terminal";
import { registerBrowserController } from "./browser/browserControllerRegistry";
import { ElectronWebviewController } from "./browser/adapters/electronWebviewController";
import { BrowserUseController } from "./browser/adapters/browserUseController";
import { BrowserTaskService } from "../../../shared/main/browser/browserTaskService";
import { BrowserUseWorkerClient } from "../../../shared/main/browser/workerClient";
import { checkBrowserUrlSync } from "../../../shared/main/browser/urlPolicy";
import type {
  BrowserTaskEvent,
} from "../shared/browser/types";
import type {
  CompletionNotificationPreference,
  DesktopApprovalProposalRequest,
  DesktopApprovalProposalResult,
  DesktopA5ServiceGuidanceScenario,
  DesktopChannelAdapterConfigureRequest,
  DesktopChannelAdapterAuthStartRequest,
  DesktopChannelAdapterAuthPollRequest,
  DesktopChannelAdapterAuthRevokeRequest,
  DesktopChannelContextImportRequest,
  DesktopChannelLiveSyncRequest,
  DesktopChannelProviderTokenConfigureRequest,
  DesktopChannelInboundEventListRequest,
  DesktopChannelInboundEventRouteRequest,
  DesktopChannelOutboundDelivery,
  DesktopChannelOutboundDeliveryListRequest,
  DesktopChannelOutboundDraftRequest,
  DesktopChannelOutboundDraftResult,
  DesktopChannelSnapshotSyncRequest,
  DesktopForkLifecycleAction,
  DesktopForkLifecycleApprovalRequest,
  DesktopForkLifecycleApprovalResult,
  DesktopForkConflictDraftWriteRequest,
  DesktopForkConflictDraftWriteResult,
  DesktopForkQueueDispatchRequest,
  DesktopForkQueueDispatchResult,
  DesktopForkQueueStartApprovalRequest,
  DesktopForkQueueStartApprovalResult,
  DesktopGitCommitApprovalRequest,
  DesktopAnomalyDecisionApplyRequest,
  DesktopAnomalyDecisionApplyResult,
  ManagerPresentationCancelRequest,
  ManagerPresentationPauseRequest,
  ManagerPresentationProgressEvent,
  ManagerPresentationRecoveryRequest,
  ManagerPresentationRecoveryDecisionRequest,
  ManagerPresentationGenerateRequest,
  ManagerPresentationRequirementUpdateRequest,
  ManagerPresentationRequirementUpdateResult,
  PdfPageOpenRequest,
  PdfPageOpenResult,
  PickedFileDescriptor,
  RemoteGatewayInstallRequest,
  DesktopMcpContextRequest,
  DesktopMcpActiveSessionListRequest,
  DesktopMcpReusableSessionCloseRequest,
  DesktopMcpReusableSessionListRequest,
  DesktopMcpSessionCancelRequest,
  DesktopMcpLiveEnumerationRequest,
  DesktopMcpSessionAuditListRequest,
  DesktopMcpToolExecutionAuditListRequest,
  DesktopMcpToolExecutionApprovalRequest,
  DesktopPendingApproval,
  DesktopScheduledTaskWorkerStatus,
  DesktopShellCommandApprovalRequest,
  DesktopThread,
  DesktopThreadContentSearchRequest,
  DesktopThreadForkMetadata,
  DesktopWorktreeListRequest,
  DesktopWorktreeEventRequest,
  DesktopVoiceTranscriptHandoffRequest,
  DesktopVoiceTranscriptionRequest,
  DesktopStreamingVoiceStartRequest,
  DesktopVoiceSynthesisRequest,
  DesktopBootstrapBlockerKind,
  WorkspaceCheckpointRestoreRequest,
  WorkspaceCheckpointRestoreResult,
  WorkspaceCheckpointCreateRequest,
  WorkspaceCheckpointAcceptRequest,
  WorkspaceCheckpointPreviewRequest,
  WorkspaceFilePreviewRequest,
  WorkspaceFileSaveAsRequest,
  WorkspaceFileSaveAsResult,
  WorkspaceFileWriteRequest,
  WorkspaceFileWriteResult,
  WorkspaceFileTreeRequest,
  WorkspaceGitDiffRequest,
  WorkspaceFolderSummaryRequest,
  WorkspaceGitFileAtRefRequest,
  DesktopWorkflowRunPrepareRequest,
  InteractiveDebugBreakpointRequest,
  InteractiveDebugControlRequest,
  InteractiveDebugEvaluateRequest,
  InteractiveDebugStartRequest,
  UpdateMyDrSaiConfigRequest,
  UpdateMyDrSaiModelConnectionRequest,
  SaveMyDrSaiModelProviderRequest,
} from "../shared/desktopApi";
import {
  evaluateExecutionPermission,
  getExecutionActionRisk,
  type ExecutionActionKind,
} from "../shared/executionPolicy";
import {
  generateManagerPresentation,
  ManagerPresentationCancelledError,
} from "./managerPresentation";
import { buildFailureRecovery } from "../../../shared/main/failureRecovery";
import { applyAnomalyDecision as applySharedAnomalyDecision } from "../../../shared/main/anomalyDecision";
import {
  configureCompletionNotifications,
  notifyBackgroundTaskCompleted,
  restoreCompletionNotificationPreference,
  setCompletionNotificationPreference,
} from "./completionNotifications";
import { WINDOWS_NOTIFICATION_SERVICE } from "./platformNotifications";
import {
  getManagerPresentationRecovery,
  resolveManagerPresentationRecovery,
  recordManagerPresentationProgress,
  recordManagerPresentationStart,
} from "./managerPresentationTasks";

let mainWindow: BrowserWindow | null = null;
let phase3LiveAcceptanceProcess: ChildProcess | null = null;
const runtimeThreadSubscriptions = new Map<string, { stop(): void }>();
const threadSnapshotHydrations = new Map<string, AbortController>();
const runtimeThreadCatalogTimers = new Map<number, NodeJS.Timeout>();
const runtimeThreadCatalogBusy = new Set<number>();
const runtimeThreadCleanupRegistered = new Set<number>();

function runtimeThreadSubscriptionKey(webContents: WebContents, threadId: string): string {
  return `${webContents.id}:${threadId}`;
}

function stopRuntimeThreadSubscriptions(webContentsId?: number): void {
  for (const [key, subscription] of runtimeThreadSubscriptions) {
    if (webContentsId === undefined || key.startsWith(`${webContentsId}:`)) {
      try {
        subscription.stop();
      } catch {
        // The owning WebContents may already be destroyed during app quit.
      }
      runtimeThreadSubscriptions.delete(key);
    }
  }
  if (webContentsId !== undefined) {
    const timer = runtimeThreadCatalogTimers.get(webContentsId);
    if (timer) clearInterval(timer);
    runtimeThreadCatalogTimers.delete(webContentsId);
    runtimeThreadCatalogBusy.delete(webContentsId);
  }
}

function ensureRuntimeThreadCleanup(webContents: WebContents): void {
  if (runtimeThreadCleanupRegistered.has(webContents.id)) return;
  runtimeThreadCleanupRegistered.add(webContents.id);
  webContents.once("destroyed", () => {
    runtimeThreadCleanupRegistered.delete(webContents.id);
    stopRuntimeThreadSubscriptions(webContents.id);
  });
}

async function syncRuntimeThreadCatalog(
  webContents: WebContents,
  activeThreadId: string,
): Promise<void> {
  if (webContents.isDestroyed() || runtimeThreadCatalogBusy.has(webContents.id)) return;
  runtimeThreadCatalogBusy.add(webContents.id);
  try {
    // The active thread already owns a live OAEP subscription. Historical idle
    // threads must not trigger full history sync + capability probes every poll;
    // only a genuinely running background task needs catalog reconciliation.
    for (const thread of (await listThreads()).filter((item) =>
      item.runtimeSessionId
      && !item.archived
      && item.status === "running"
      && item.id !== activeThreadId
    )) {
      const snapshot = await getRuntimeThreadSnapshot(thread).catch(() => null);
      if (!snapshot || snapshot.updatedAt <= Date.parse(thread.updatedAt)) continue;
      const updated = await updateThread({
        id: thread.id,
        messageCount: snapshot.messageCount,
        unread: thread.id !== activeThreadId,
      });
      if (!webContents.isDestroyed()) {
        webContents.send("desktop:thread-catalog", {
          thread: updated,
          source: "runtime-session",
        });
      }
    }
  } finally {
    runtimeThreadCatalogBusy.delete(webContents.id);
  }
}

function startRuntimeThreadCatalogSync(webContents: WebContents, activeThreadId: string): void {
  const current = runtimeThreadCatalogTimers.get(webContents.id);
  if (current) clearInterval(current);
  void syncRuntimeThreadCatalog(webContents, activeThreadId);
  const timer = setInterval(
    () => void syncRuntimeThreadCatalog(webContents, activeThreadId),
    15_000,
  );
  timer.unref();
  runtimeThreadCatalogTimers.set(webContents.id, timer);
}
configureChannelProviderAuth({ credentials: WINDOWS_CREDENTIAL_SERVICE });

const interactiveDebugPolicy = new InteractiveDebugPolicyStore(join(DRSAI_HOME, "desktop", "interactive-debug-policy.json"));
const interactiveDebugger = new InteractiveDebuggerService(
  () => mainWindow?.webContents,
  process.env.OPENDRSAI_PYTHON_PATH || join(DRSAI_HOME, "drsai-agent", "venv", "Scripts", "python.exe"),
  async () => true,
  () => interactiveDebugPolicy.isEnabled(),
);
let scheduledTaskWorker: ScheduledTaskWorkerHandle | null = null;
let browserWebContentsPolicyRegistered = false;
const configuredBrowserSessions = new WeakSet<Session>();
const browserTaskSubscribers = new Set<WebContents>();
interface ManagerPresentationRun {
  controller: AbortController;
  webContentsId: number;
  request: ManagerPresentationGenerateRequest;
  paused: boolean;
  activeOperationController: AbortController | null;
  resumeWaiters: Set<() => void>;
  lastProgress: ManagerPresentationProgressEvent | null;
  backgroundSync: Promise<unknown>;
  requirements: string[];
}

const managerPresentationRuns = new Map<string, ManagerPresentationRun>();
let managerPresentationAttempt = 0;
let appQuitRequested = false;

function sanitizeManagerPresentationRequirements(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 240) : "")
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
    .slice(0, 5);
}

function hasActiveForegroundIndependentWork(): boolean {
  return managerPresentationRuns.size > 0 || hasActiveChats() || hasActiveAgentRuns();
}

function sendManagerPresentationProgress(progress: ManagerPresentationProgressEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send("desktop:manager-presentation-progress", progress);
    }
  }
}

function canControlManagerPresentation(event: IpcMainInvokeEvent, run: ManagerPresentationRun): boolean {
  if (event.sender.isDestroyed()) return false;
  return event.sender.id === run.webContentsId
    || Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender.id === mainWindow.webContents.id);
}

function waitUntilManagerPresentationResumed(run: ManagerPresentationRun): Promise<void> {
  if (!run.paused) return Promise.resolve();
  return new Promise((resolveWait) => run.resumeWaiters.add(resolveWait));
}

function resumeManagerPresentationRun(run: ManagerPresentationRun): void {
  run.paused = false;
  for (const resolveWait of run.resumeWaiters) resolveWait();
  run.resumeWaiters.clear();
}

function getRendererHtmlPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "renderer", "index.html")
    : join(__dirname, "../renderer/index.html");
}

function getRendererUrl(): string {
  const baseUrl = app.isPackaged
    ? `${RENDERER_PROTOCOL}://renderer/index.html`
    : pathToFileURL(getRendererHtmlPath()).toString();
  return process.env.OPENDRSAI_E2E_AGENT_RUN === "1"
    ? `${baseUrl}?developerBypassFixture=1`
    : baseUrl;
}
const TRUSTED_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DEEP_LINK_PROTOCOL = process.env.OPENDRSAI_DEEP_LINK_PROTOCOL === "opendrsai-dev"
  ? "opendrsai-dev"
  : "opendrsai";
const RENDERER_PROTOCOL = "opendrsai-app";
protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);
const browserUseWorkerClient = new BrowserUseWorkerClient();
const browserTaskService = new BrowserTaskService({
  worker: browserUseWorkerClient,
  workerOptions: async () => {
    const install = await getInstallStatus();
    return {
      pythonCommand: resolveBrowserUsePythonCommand(install.pythonPath || install.prerequisites.pythonCommand),
      workerPath: app.isPackaged
        ? join(process.resourcesPath, "browser-use-worker", "worker.py")
        : join(app.getAppPath(), "..", "shared", "browser-use-worker", "worker.py"),
      dataRoot: join(app.getPath("userData"), "browser-use"),
    };
  },
  traceRoot: join(app.getPath("userData"), "browser-use", "traces"),
  publish: (event) => {
    updatePendingBrowserTaskApprovals(event);
    void recordBrowserTaskDiagnostic(event);
    for (const subscriber of [...browserTaskSubscribers]) {
      if (subscriber.isDestroyed()) browserTaskSubscribers.delete(subscriber);
      else subscriber.send("desktop:browser-task-event", event);
    }
  },
  recordError: (line) => console.warn("[browser-use worker]", line),
});
const pendingDesktopApprovals = new Map<string, DesktopPendingApproval>();
const executedDesktopApprovalIds = new Set<string>();
const pendingDesktopApprovalPayloads = new Map<string, DesktopApprovalPayload>();
function desktopApprovalPayloadKey(approvalId: string, kind: DesktopApprovalPayloadKind): string { return `${approvalId}\u0000${kind}`; }
const desktopApprovalStateStore = new DesktopApprovalStateStore();
async function restoreDesktopApprovalState(): Promise<void> {
  const state = await desktopApprovalStateStore.load();
  let migratedLegacyPayload = false;
  for (const approval of state.pending) pendingDesktopApprovals.set(approval.id, approval);
  for (const decision of state.executed) executedDesktopApprovalIds.add(decision.id);
  for (const payload of state.payloads) {
    if (!pendingDesktopApprovals.has(payload.approvalId)) continue;
    pendingDesktopApprovalPayloads.set(desktopApprovalPayloadKey(payload.approvalId, payload.kind), payload);
    restoreDesktopApprovalPayloadOwner(payload);
    if (!isProtectedDesktopApprovalEnvelope(payload.value)) {
      setProtectedDesktopApprovalPayload(payload.approvalId, payload.kind, payload.value);
      migratedLegacyPayload = true;
    }
  }
  let recoveredAmbiguousMcp = false;
  for (const approvalId of executedDesktopApprovalIds) {
    const request = pendingMcpToolExecutions.get(approvalId);
    const approval = pendingDesktopApprovals.get(approvalId);
    if (!request || !approval) continue;
    pendingDesktopApprovals.set(approvalId, recoverAmbiguousMcpApproval(approval, request));
    try { recordAmbiguousMcpToolExecutionAudit(request, approvalId); } catch { /* Workspace may be unavailable; the durable card remains authoritative. */ }
    recoveredAmbiguousMcp = true;
  }
  if (migratedLegacyPayload || recoveredAmbiguousMcp) await persistDesktopApprovalState();
}
function persistDesktopApprovalState(): Promise<void> { return desktopApprovalStateStore.save(pendingDesktopApprovals.values(), executedDesktopApprovalIds.values(), pendingDesktopApprovalPayloads.values()); }
async function registerDesktopApprovalPayload(approvalId: string, kind: DesktopApprovalPayloadKind, value: unknown): Promise<void> {
  setProtectedDesktopApprovalPayload(approvalId, kind, value);
  await persistDesktopApprovalState();
}
function isProtectedDesktopApprovalEnvelope(value: unknown): boolean { return Boolean(value && typeof value === "object" && typeof (value as { protectedPayload?: unknown }).protectedPayload === "string"); }
function setProtectedDesktopApprovalPayload(approvalId: string, kind: DesktopApprovalPayloadKind, value: unknown): void {
  const envelope = protectDesktopApprovalPayload(WINDOWS_CREDENTIAL_SERVICE, value);
  pendingDesktopApprovalPayloads.set(desktopApprovalPayloadKey(approvalId, kind), { approvalId, kind, value: envelope ?? { protectedPayload: "unavailable" } });
}
async function registerProtectedDesktopApprovalPayload(approvalId: string, kind: "channel_outbound" | "mcp_enumeration" | "mcp_tool_execution", value: unknown): Promise<void> {
  setProtectedDesktopApprovalPayload(approvalId, kind, value);
  await persistDesktopApprovalState();
}
function deleteDesktopApprovalPayloads(approvalId: string): void { for (const [key, payload] of pendingDesktopApprovalPayloads) if (payload.approvalId === approvalId) pendingDesktopApprovalPayloads.delete(key); }
const pendingF2ApprovalEffects = new Map<string, { key: string; phase: "reject" | "control" }>();
const pendingF3ApprovalEffects = new Map<string, { key: string; phase: "reject" | "control" }>();
const pendingShellCommandApprovals = new Map<
  string,
  {
    terminalSessionId: string;
    commandId: string;
    command: string;
    invocation: string;
    workflowRunId?: string;
    workflowStepId?: string;
  }
>();

const isE2eSmokeProcess =
  Boolean(process.env.OPENDRSAI_E2E_FIRST_RUN_DRAFT_STAGE) ||
  process.env.OPENDRSAI_E2E_MODEL_PREVIEW === "1" ||
  process.env.OPENDRSAI_E2E_RUNTIME_UNIFIED === "1" ||
  process.env.OPENDRSAI_E2E_P8_IPC === "1" ||
  process.env.OPENDRSAI_E2E_SMOKE === "1" ||
  process.env.OPENDRSAI_E2E_CHAT === "1" ||
  process.env.OPENDRSAI_E2E_RUN_TRACEABILITY_PHASE1 === "1" ||
  process.env.OPENDRSAI_E2E_RUN_EDITABLE_PHASE2 === "1" ||
  process.env.OPENDRSAI_E2E_RUN_TRACEABILITY_PHASE3 === "1" ||
  process.env.OPENDRSAI_E2E_CHAT_FAILURES === "1" ||
  process.env.OPENDRSAI_E2E_AGENT_RUN === "1" ||
  process.env.OPENDRSAI_E2E_AGENT_RUN_FAILURES === "1" ||
  process.env.OPENDRSAI_E2E_THREADS === "1" ||
  process.env.OPENDRSAI_E2E_FORK_MERGE === "1" ||
  process.env.OPENDRSAI_E2E_OIDC === "1" ||
  process.env.OPENDRSAI_E2E_A5_SERVICE_GUIDANCE === "1" ||
  process.env.OPENDRSAI_E2E_F2_APPROVALS === "1" ||
  process.env.OPENDRSAI_E2E_F3_APPROVALS === "1" ||
  process.env.OPENDRSAI_E2E_C1_MATERIAL_IMPORT === "1" ||
  process.env.OPENDRSAI_E2E_C2_FOLDER_IMPORT === "1" ||
  process.env.OPENDRSAI_E2E_C3_MATERIAL_ROLES === "1" ||
  process.env.OPENDRSAI_E2E_C4_MATERIAL_SUGGESTIONS === "1" ||
  process.env.OPENDRSAI_E2E_C5_MATERIAL_CONSISTENCY === "1" ||
  process.env.OPENDRSAI_E2E_C6_MATERIAL_QUERY === "1" ||
  process.env.OPENDRSAI_E2E_C7_ABNORMAL_FILES === "1" ||
  process.env.OPENDRSAI_E2E_C8_CHINESE_PRIVACY === "1" ||
  process.env.OPENDRSAI_E2E_F1_LOW_RISK_APPROVALS === "1" ||
  process.env.OPENDRSAI_E2E_F6_WORKSPACE_GUARD === "1" ||
  process.env.OPENDRSAI_E2E_M3_WINDOW === "1" ||
  process.env.OPENDRSAI_E2E_M4_KEYBOARD === "1" ||
  process.env.OPENDRSAI_E2E_M5_ACCESSIBILITY === "1" ||
  process.env.OPENDRSAI_E2E_M6_PERFORMANCE === "1" ||
  process.env.OPENDRSAI_E2E_M7_STABILITY === "1" ||
  process.env.OPENDRSAI_E2E_M8_RECOVERY === "1" ||
  process.env.OPENDRSAI_E2E_M10_DATA_CLEANUP === "1" ||
  process.env.OPENDRSAI_E2E_APP_DIALOG === "1" ||
  process.env.OPENDRSAI_E2E_OPERATIONAL_STATE === "1" ||
  process.env.OPENDRSAI_E2E_VOICE === "1" ||
  process.env.OPENDRSAI_E2E_PRESENTATION_PDF_ACTION === "1" ||
  process.env.OPENDRSAI_E2E_OIDC_HEADLESS === "1";
if (isE2eSmokeProcess) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
}
async function phaseAcceptanceExportTarget(
  suggestedName: string, options: SaveDialogOptions,
): Promise<SaveDialogReturnValue> {
  const automatedDirectory = isE2eSmokeProcess ? process.env.OPENDRSAI_E2E_EXPORT_DIR : undefined;
  if (automatedDirectory) {
    if (!isAbsolute(automatedDirectory)) throw new Error("The acceptance export directory must be absolute.");
    const directory = resolve(automatedDirectory);
    await mkdir(directory, { recursive: true });
    return { canceled: false, filePath: join(directory, basename(suggestedName)) };
  }
  return mainWindow ? dialog.showSaveDialog(mainWindow, options) : dialog.showSaveDialog(options);
}
const shouldExerciseSingleInstanceLifecycle =
  process.env.OPENDRSAI_E2E_PRESENTATION_SCENARIO === "background-close" ||
  process.env.OPENDRSAI_E2E_AGENT_RUN_SCENARIO === "background-close";
const singleInstanceLock = isE2eSmokeProcess && !shouldExerciseSingleInstanceLifecycle
  ? true
  : app.requestSingleInstanceLock();
const desktopProcessStartedAt = Date.now();
let agentBackgroundTaskSync = Promise.resolve();
subscribeAgentRunLifecycle((event, request) => {
  agentBackgroundTaskSync = agentBackgroundTaskSync
    .then(() => upsertBackgroundTaskForAgentRun(request, event))
    .then((task) => {
      if (event.type === "done") {
        notifyBackgroundTaskCompleted(task, {
          kind: "agent_run",
          targetId: event.requestId,
          ...(request.workspacePath ? { workspacePath: request.workspacePath } : {}),
          ...(request.threadId ? { threadId: request.threadId } : {}),
        });
      }
    })
    .then(() => undefined)
    .catch((error) => console.warn(
      "[desktop] Agent background task sync failed:",
      error instanceof Error ? error.message : String(error),
    ));
});
function recordStartupMilestone(event: string): void {
  const launcherStartedAt = Number(process.env.OPENDRSAI_DEV_START_EPOCH_MS);
  const launcherElapsed = Number.isFinite(launcherStartedAt) ? Date.now() - launcherStartedAt : null;
  console.info(
    `[startup] ${event}: process=${Date.now() - desktopProcessStartedAt}ms${launcherElapsed === null ? "" : ` launcher=${launcherElapsed}ms`}`,
  );
}
function recordE2eStartupTrace(event: string, details: Record<string, unknown> = {}): void {
  if (!isE2eSmokeProcess) return;
  const target = globalThis as { __OPENDRSAI_E2E_TRACE?: Array<Record<string, unknown>> };
  target.__OPENDRSAI_E2E_TRACE ??= [];
  target.__OPENDRSAI_E2E_TRACE.push({ event, at: new Date().toISOString(), ...details });
}
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    handleDeepLinkArgv(argv);
    focusMainWindow();
  });
}
type WorkspaceMutationAction =
  | "stage-file"
  | "revert-file"
  | "stage-hunk"
  | "revert-hunk";
const pendingWorkspaceMutationApprovals = new Map<
  string,
  {
    action: WorkspaceMutationAction;
    request: unknown;
  }
>();
const pendingWorkspaceCheckpointRestores = new Map<
  string,
  WorkspaceCheckpointRestoreRequest
>();
const pendingGitCommitApprovals = new Map<
  string,
  DesktopGitCommitApprovalRequest
>();
const pendingRemoteGatewayInstallApprovals = new Map<
  string,
  RemoteGatewayInstallRequest
>();
const pendingForkLifecycleApprovals = new Map<
  string,
  DesktopForkLifecycleApprovalRequest
>();
const pendingForkQueueStartApprovals = new Map<
  string,
  DesktopForkQueueStartApprovalRequest
>();
const pendingForkConflictDraftWrites = new Map<
  string,
  DesktopForkConflictDraftWriteRequest
>();
const pendingChannelOutboundDrafts = new Map<
  string,
  DesktopChannelOutboundDraftRequest
>();
const pendingMcpLiveEnumerations = new Map<
  string,
  DesktopMcpLiveEnumerationRequest
>();
const pendingMcpToolExecutions = new Map<
  string,
  DesktopMcpToolExecutionApprovalRequest
>();
function restoreDesktopApprovalPayloadOwner(payload: DesktopApprovalPayload): void {
  const { approvalId } = payload;
  let value = payload.value;
  if (isProtectedDesktopApprovalEnvelope(value)) {
    value = unprotectDesktopApprovalPayload(WINDOWS_CREDENTIAL_SERVICE, value);
    if (value === null) return;
  }
  if (payload.kind === "approval_review" || payload.kind === "channel_outbound" || payload.kind === "mcp_enumeration" || payload.kind === "mcp_tool_execution") {
    if (payload.kind === "approval_review") {
      const review = value as Partial<DesktopPendingApproval>;
      if (review.id === approvalId && typeof review.title === "string" && typeof review.detail === "string" && typeof review.createdAt === "string") {
        pendingDesktopApprovals.set(approvalId, review as DesktopPendingApproval);
      }
      return;
    }
    restoreProtectedDesktopApprovalReview(approvalId, payload.kind, value);
  }
  switch (payload.kind) {
    case "workspace_mutation": {
      const row = value as { action?: unknown; request?: unknown };
      if (["stage-file", "revert-file", "stage-hunk", "revert-hunk"].includes(String(row?.action))) {
        pendingWorkspaceMutationApprovals.set(approvalId, { action: row.action as WorkspaceMutationAction, request: row.request });
      }
      return;
    }
    case "workspace_checkpoint_restore": pendingWorkspaceCheckpointRestores.set(approvalId, value as WorkspaceCheckpointRestoreRequest); return;
    case "git_commit": pendingGitCommitApprovals.set(approvalId, value as DesktopGitCommitApprovalRequest); return;
    case "remote_gateway_install": pendingRemoteGatewayInstallApprovals.set(approvalId, value as RemoteGatewayInstallRequest); return;
    case "fork_lifecycle": pendingForkLifecycleApprovals.set(approvalId, value as DesktopForkLifecycleApprovalRequest); return;
    case "fork_queue_start": pendingForkQueueStartApprovals.set(approvalId, value as DesktopForkQueueStartApprovalRequest); return;
    case "fork_conflict_draft": pendingForkConflictDraftWrites.set(approvalId, value as DesktopForkConflictDraftWriteRequest); return;
    case "channel_outbound": pendingChannelOutboundDrafts.set(approvalId, value as DesktopChannelOutboundDraftRequest); return;
    case "mcp_enumeration": pendingMcpLiveEnumerations.set(approvalId, value as DesktopMcpLiveEnumerationRequest); return;
    case "mcp_tool_execution": pendingMcpToolExecutions.set(approvalId, value as DesktopMcpToolExecutionApprovalRequest); return;
  }
}
function restoreProtectedDesktopApprovalReview(
  approvalId: string,
  kind: "channel_outbound" | "mcp_enumeration" | "mcp_tool_execution",
  value: unknown,
): void {
  const current = pendingDesktopApprovals.get(approvalId);
  if (!current || !value || typeof value !== "object") return;
  try {
    if (kind === "channel_outbound") {
      const proposal = createChannelOutboundDraftApproval(value as DesktopChannelOutboundDraftRequest);
      pendingDesktopApprovals.set(approvalId, { ...current, title: proposal.title, detail: proposal.detail, target: proposal.target });
      return;
    }
    if (kind === "mcp_enumeration") {
      const request = value as DesktopMcpLiveEnumerationRequest;
      pendingDesktopApprovals.set(approvalId, {
        ...current, title: "Enumerate live MCP server context",
        detail: ["Approve a bounded stdio MCP resources/list and tools/list enumeration.", `Server selector: ${request.server || "all configured servers"}`, "Results are written to .drsai/mcp-context.json for explicit reviewed import."].join("\n"),
        target: request.workspacePath,
      });
      return;
    }
    const request = value as DesktopMcpToolExecutionApprovalRequest;
    pendingDesktopApprovals.set(approvalId, {
      ...current, title: `Execute MCP tool: ${request.tool}`,
      detail: ["Approve a bounded stdio MCP tools/call execution for the selected server/tool.", `Server: ${request.server}`, `Tool: ${request.tool}`, request.input ? `Input preview: ${request.input.slice(0, 1200)}` : "Input preview: none", "Approved results are written to .drsai/mcp-context.json for reviewed import."].join("\n"),
      target: request.workspacePath,
    });
  } catch { /* Corrupt or stale protected payload remains fail-closed. */ }
}
// Indexes Browser Task approvals exposed through the generic approval inbox.
// BrowserTaskService remains the source of truth for whether an action can run.
const pendingBrowserDesktopApprovalIds = new Map<string, string>();

function updatePendingBrowserTaskApprovals(event: BrowserTaskEvent): void {
  if (event.type === "action.proposed" && event.requiresApproval) {
    const approvalId = createBrowserTaskApprovalId(event.taskId, event.actionId);
    pendingDesktopApprovals.set(approvalId, toDesktopBrowserTaskApproval(event));
    pendingBrowserDesktopApprovalIds.set(approvalId, event.taskId);
    void persistDesktopApprovalState().catch(() => undefined);
    return;
  }
  if (event.type === "action.completed") {
    const approvalId = createBrowserTaskApprovalId(event.taskId, event.actionId);
    pendingDesktopApprovals.delete(approvalId);
    pendingBrowserDesktopApprovalIds.delete(approvalId);
    void persistDesktopApprovalState().catch(() => undefined);
    return;
  }
  if (
    event.type === "task.completed" ||
    event.type === "task.failed" ||
    event.type === "task.cancelled"
  ) {
    for (const [approvalId, taskId] of pendingBrowserDesktopApprovalIds) {
      if (taskId === event.taskId) {
        pendingDesktopApprovals.delete(approvalId);
        pendingBrowserDesktopApprovalIds.delete(approvalId);
      }
    }
    void persistDesktopApprovalState().catch(() => undefined);
  }
}

function createBrowserTaskApprovalId(taskId: string, actionId: string): string {
  return `browser_task:${taskId}:${actionId}`;
}

function toDesktopBrowserTaskApproval(
  approval: Extract<BrowserTaskEvent, { type: "action.proposed" }>,
): DesktopPendingApproval {
  const sensitive =
    approval.action === "type" ||
    approval.action === "click" ||
    approval.action === "select" ||
    approval.action === "key_press";
  return {
    id: createBrowserTaskApprovalId(approval.taskId, approval.actionId),
    source: "browser_task",
    actionKind: sensitive ? "browser.sensitive_interact" : "browser.interact",
    title: `Browser ${approval.action}`,
    detail: approval.target || approval.actionId,
    target: approval.target,
    createdAt: approval.timestamp,
    risk: sensitive ? "high" : "medium",
    taskId: approval.taskId,
    actionId: approval.actionId,
  };
}

const APPROVAL_SOURCE_ACTIONS: Record<
  DesktopApprovalProposalRequest["source"],
  Set<ExecutionActionKind>
> = {
  shell: new Set(["terminal.create", "terminal.write", "shell.command"]),
  workspace: new Set(["workspace.stage", "workspace.revert", "workspace.checkpoint"]),
  git: new Set(["git.commit"]),
  fork: new Set(["fork.lifecycle", "fork.queue_start"]),
  workflow: new Set(["workflow.run"]),
  network: new Set(["network.request"]),
  connector: new Set(["external.service"]),
};

function createRuntimeApprovalId(
  request: DesktopApprovalProposalRequest,
): string {
  const stableKey = request.idempotencyKey?.trim();
  if (stableKey) return `${request.source}:${request.actionKind}:${stableKey}`;
  return `${request.source}:${request.actionKind}:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2)}`;
}

function isValidApprovalProposalSourceAction(
  request: DesktopApprovalProposalRequest,
): boolean {
  return APPROVAL_SOURCE_ACTIONS[request.source]?.has(request.actionKind) === true;
}

function normalizeApprovalRisk(
  request: DesktopApprovalProposalRequest,
): DesktopPendingApproval["risk"] {
  if (request.risk) return request.risk;
  return getExecutionActionRisk(request.actionKind);
}

const F2_SAFETY_KEYS = new Set([
  "new_directory",
  "external_data",
  "large_compute",
  "overwrite_file",
  "delete_file",
  "public_share",
]);

function registerF2ApprovalEffect(request: DesktopApprovalProposalRequest, approvalId: string): void {
  const effectDir = process.env.OPENDRSAI_E2E_F2_EFFECT_DIR;
  const stableKey = request.idempotencyKey?.trim();
  if (process.env.OPENDRSAI_E2E_F2_APPROVALS !== "1" || !effectDir || !stableKey) return;
  const match = /^f2-(control-)?([a-z_]+)-/.exec(stableKey);
  const key = match?.[2];
  if (!key || !F2_SAFETY_KEYS.has(key)) return;
  pendingF2ApprovalEffects.set(approvalId, { key, phase: match?.[1] ? "control" : "reject" });
}

function executeF2ApprovalEffect(approvalId: string, effect: { key: string; phase: "reject" | "control" }): void {
  const effectDir = process.env.OPENDRSAI_E2E_F2_EFFECT_DIR;
  if (!effectDir) return;
  mkdirSync(effectDir, { recursive: true });
  const effectPath = join(effectDir, `${effect.key}.json`);
  const previous = existsSync(effectPath)
    ? JSON.parse(readFileSync(effectPath, "utf8")) as { events?: Array<Record<string, unknown>> }
    : { events: [] };
  const events = Array.isArray(previous.events) ? previous.events : [];
  events.push({ approvalId, phase: effect.phase, executedAt: new Date().toISOString() });
  writeFileSync(effectPath, `${JSON.stringify({ key: effect.key, events }, null, 2)}\n`, "utf8");
}

const F3_BUSINESS_KEYS = new Set([
  "file_access",
  "file_modify",
  "external_send",
  "large_compute",
  "file_delete",
]);

function registerF3ApprovalEffect(request: DesktopApprovalProposalRequest, approvalId: string): void {
  const effectDir = process.env.OPENDRSAI_E2E_F3_EFFECT_DIR;
  const stableKey = request.idempotencyKey?.trim();
  if (process.env.OPENDRSAI_E2E_F3_APPROVALS !== "1" || !effectDir || !stableKey) return;
  const match = /^f3-(control-)?([a-z_]+)-/.exec(stableKey);
  const key = match?.[2];
  if (!key || !F3_BUSINESS_KEYS.has(key)) return;
  pendingF3ApprovalEffects.set(approvalId, { key, phase: match?.[1] ? "control" : "reject" });
}

function executeF3ApprovalEffect(approvalId: string, effect: { key: string; phase: "reject" | "control" }): void {
  const effectDir = process.env.OPENDRSAI_E2E_F3_EFFECT_DIR;
  if (!effectDir) return;
  mkdirSync(effectDir, { recursive: true });
  const effectPath = join(effectDir, `${effect.key}.json`);
  const previous = existsSync(effectPath)
    ? JSON.parse(readFileSync(effectPath, "utf8")) as { events?: Array<Record<string, unknown>> }
    : { events: [] };
  const events = Array.isArray(previous.events) ? previous.events : [];
  events.push({ approvalId, phase: effect.phase, executedAt: new Date().toISOString() });
  writeFileSync(effectPath, `${JSON.stringify({ key: effect.key, events }, null, 2)}\n`, "utf8");
}

async function prepareWorkflowRun(
  request: unknown,
  scheduledTriggerKey?: string,
): Promise<Awaited<ReturnType<typeof createWorkflowRunRecipe>>> {
  const typed = normalizeWorkflowRunPrepareRequest(request);
  if (!typed) {
    return createWorkflowRunRecipe({
      templateId: "invalid",
    });
  }
  const template = await getWorkflowTemplate(typed.templateId, typed.workspacePath);
  if (!template || template.status !== "available" || !template.approvalRequired) {
    return createWorkflowRunRecipe(typed);
  }

  const proposal = await proposeDesktopApproval({
    source: "workflow",
    actionKind: "workflow.run",
    title: `Run workflow: ${template.name}`,
    detail: [
      template.summary,
      `Trigger: ${template.trigger}`,
      `Verification: ${template.verification}`,
    ].join("\n"),
    target: typed.workspacePath,
    risk: template.risk,
    idempotencyKey: [
      "workflow",
      template.id,
      typed.workspacePath ? stableApprovalHash(typed.workspacePath) : "global",
      scheduledTriggerKey ?? "interactive",
    ].join(":"),
  });
  return createWorkflowRunRecipe(typed, proposal);
}

async function requestMcpLiveEnumeration(
  request: unknown,
): Promise<Awaited<ReturnType<typeof enumerateMcpLiveServer>>> {
  const typed = normalizeMcpLiveEnumerationRequest(request);
  if (!typed) {
    return createMcpEnumerationBlockedResult(
      { workspacePath: "", server: undefined },
      "MCP live enumeration request is incomplete.",
    );
  }
  let inspection: ReturnType<typeof inspectMcpLiveServers>;
  try {
    inspection = inspectMcpLiveServers(typed.workspacePath);
  } catch (error) {
    return createMcpEnumerationBlockedResult(
      typed,
      error instanceof Error ? error.message : "MCP live server config is invalid.",
    );
  }
  const matchedServers = typed.server
    ? inspection.servers.filter((server) =>
        server.name.toLowerCase().includes(typed.server?.toLowerCase() ?? ""),
      )
    : inspection.servers;
  if (!matchedServers.length) {
    return createMcpEnumerationBlockedResult(
      typed,
      "No configured MCP server matched the requested selector.",
    );
  }
  const proposal = await proposeDesktopApproval({
    source: "network",
    actionKind: "network.request",
    title: "Enumerate live MCP server context",
    detail: [
      "Approve a bounded stdio MCP resources/list and tools/list enumeration.",
      `Config: ${inspection.configPath}`,
      `Servers: ${matchedServers.map((server) => server.name).join(", ")}`,
      "Results are written to .drsai/mcp-context.json for later reviewed /mcp resource or /mcp tool import.",
      "MCP tool execution is not performed by this approval.",
    ].join("\n"),
    target: typed.workspacePath,
    risk: "medium",
    idempotencyKey: [
      "mcp-live-enumerate",
      stableApprovalHash(typed.workspacePath),
      stableApprovalHash(typed.server ?? "all"),
    ].join(":"),
  }, { deferPersistence: true });
  if (proposal.blocked || !proposal.allowed) {
    return createMcpEnumerationBlockedResult(typed, proposal.reason);
  }
  if (proposal.queued && proposal.approval) {
    pendingMcpLiveEnumerations.set(proposal.approval.id, typed);
    await registerProtectedDesktopApprovalPayload(proposal.approval.id, "mcp_enumeration", typed);
    return createMcpEnumerationQueuedResult(
      typed,
      proposal.approval.id,
      proposal.reason,
    );
  }
  return enumerateMcpLiveServer(typed);
}

async function requestMcpToolExecutionApproval(
  request: unknown,
) {
  const typed = normalizeMcpToolExecutionApprovalRequest(request);
  if (!typed) {
    return createMcpToolExecutionApprovalResult(
      { workspacePath: "", server: "", tool: "", input: undefined },
      undefined,
      "MCP tool execution approval request is incomplete.",
      false,
      true,
    );
  }
  try {
    const inspection = inspectMcpLiveServers(typed.workspacePath);
    const matchedServer = inspection.servers.find((server) =>
      server.name.toLowerCase().includes(typed.server.toLowerCase()),
    );
    if (!matchedServer) {
      return createMcpToolExecutionApprovalResult(
        typed,
        undefined,
        "No configured MCP server matched the tool execution request.",
        false,
        true,
      );
    }
    if (typed.input) {
      const parsed = JSON.parse(typed.input);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return createMcpToolExecutionApprovalResult(
          typed,
          undefined,
          "MCP tool input must be a JSON object.",
          false,
          true,
        );
      }
    }
  } catch (error) {
    return createMcpToolExecutionApprovalResult(
      typed,
      undefined,
      error instanceof Error ? error.message : "MCP tool execution preflight failed.",
      false,
      true,
    );
  }
  const proposal = await proposeDesktopApproval({
    source: "connector",
    actionKind: "external.service",
    title: `Execute MCP tool: ${typed.tool}`,
    detail: [
      "Approve a bounded stdio MCP tools/call execution for the selected server/tool.",
      `Server: ${typed.server}`,
      `Tool: ${typed.tool}`,
      typed.input ? `Input preview: ${typed.input.slice(0, 1200)}` : "Input preview: none",
      "Approved results are written to .drsai/mcp-context.json for reviewed /mcp tool import.",
      "This approval path is intentionally separate from live MCP enumeration and from /mcp context import.",
    ].join("\n"),
    target: typed.workspacePath,
    risk: "high",
    idempotencyKey: [
      "mcp-tool-exec",
      stableApprovalHash(typed.workspacePath),
      stableApprovalHash(typed.server),
      stableApprovalHash(typed.tool),
      stableApprovalHash(typed.input ?? ""),
    ].join(":"),
  }, { deferPersistence: true });
  if (proposal.queued && proposal.approval) {
    pendingMcpToolExecutions.set(proposal.approval.id, typed);
    await registerProtectedDesktopApprovalPayload(proposal.approval.id, "mcp_tool_execution", typed);
  }
  if (!proposal.queued && proposal.allowed && !proposal.blocked) {
    return executeMcpToolAfterApproval(typed);
  }
  return createMcpToolExecutionApprovalResult(
    typed,
    proposal.approval?.id,
    proposal.reason,
    Boolean(proposal.queued && proposal.approval),
    proposal.blocked || !proposal.allowed,
  );
}

async function runDueScheduledTasksAndMirror(
  request: unknown,
): Promise<Awaited<ReturnType<typeof runDueScheduledTasks>>> {
  const result = await runDueScheduledTasks(request, {
    prepareWorkflowRun: (scheduledRequest) => prepareWorkflowRun(scheduledRequest, scheduledRequest.triggerKey),
    startWorkflowRun,
    listWorkflowRuns,
  });
  for (const run of result.runs) {
    await upsertBackgroundTaskForWorkflowRun(run);
  }
  return result;
}

function startScheduledTaskWorkerIfEnabled(): void {
  if (scheduledTaskWorker || process.env.OPENDRSAI_DISABLE_SCHEDULED_TASK_WORKER === "1") {
    return;
  }
  scheduledTaskWorker = startScheduledTaskWorker(
    {
      prepareWorkflowRun,
      startWorkflowRun,
      listWorkflowRuns,
      onWorkflowRun: async (run) => {
        await upsertBackgroundTaskForWorkflowRun(run);
      },
    },
    {
      intervalMs: Number(process.env.OPENDRSAI_SCHEDULED_TASK_WORKER_INTERVAL_MS),
      initialDelayMs: Number(process.env.OPENDRSAI_SCHEDULED_TASK_WORKER_INITIAL_DELAY_MS),
    },
  );
}

async function recoverWorkflowRunStateAfterRestart(): Promise<void> {
  try {
    const result = await recoverWorkflowRunsAfterRestart();
      if (result.recovered === 0) return;
      await Promise.all(
        result.runs.map((run) => upsertBackgroundTaskForWorkflowRun(run)),
      );
      console.info(
        `[desktop] Recovered ${result.recovered} workflow run(s) after restart.`,
      );
  } catch (error) {
    console.warn(
      "[desktop] Workflow run restart recovery failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function getScheduledTaskWorkerStatus(): DesktopScheduledTaskWorkerStatus {
  if (scheduledTaskWorker) {
    return scheduledTaskWorker.getStatus();
  }
  const disabled = process.env.OPENDRSAI_DISABLE_SCHEDULED_TASK_WORKER === "1";
  return {
    enabled: !disabled,
    running: false,
    stopped: true,
    intervalMs: Number(process.env.OPENDRSAI_SCHEDULED_TASK_WORKER_INTERVAL_MS) || 5 * 60 * 1000,
    initialDelayMs:
      Number(process.env.OPENDRSAI_SCHEDULED_TASK_WORKER_INITIAL_DELAY_MS) || 15 * 1000,
    message: disabled
      ? "Scheduled task worker is disabled by OPENDRSAI_DISABLE_SCHEDULED_TASK_WORKER."
      : "Scheduled task worker has not started yet.",
  };
}

function stopScheduledTaskWorker(): void {
  scheduledTaskWorker?.stop();
  scheduledTaskWorker = null;
}

function normalizeWorkflowRunPrepareRequest(
  request: unknown,
): DesktopWorkflowRunPrepareRequest | null {
  if (!request || typeof request !== "object") return null;
  const templateId = getStringProperty(request, "templateId");
  if (!templateId || templateId.length > 80) return null;
  const workspacePath = getStringProperty(request, "workspacePath");
  return {
    templateId,
    ...(workspacePath ? { workspacePath } : {}),
  };
}

function normalizeMcpLiveEnumerationRequest(
  request: unknown,
): DesktopMcpLiveEnumerationRequest | null {
  if (!request || typeof request !== "object") return null;
  const workspacePath = getStringProperty(request, "workspacePath");
  if (!workspacePath || workspacePath.length > 2048) return null;
  const server = sanitizeOptionalDispatchText(getStringProperty(request, "server"), 120);
  return {
    workspacePath,
    ...(server ? { server } : {}),
  };
}

function normalizeMcpToolExecutionApprovalRequest(
  request: unknown,
): DesktopMcpToolExecutionApprovalRequest | null {
  if (!request || typeof request !== "object") return null;
  const workspacePath = getStringProperty(request, "workspacePath");
  const server = sanitizeOptionalDispatchText(getStringProperty(request, "server"), 120);
  const tool = sanitizeOptionalDispatchText(getStringProperty(request, "tool"), 160);
  if (!workspacePath || !server || !tool || workspacePath.length > 2048) {
    return null;
  }
  const input = getStringProperty(request, "input");
  return {
    workspacePath,
    server,
    tool,
    ...(input ? { input: input.slice(0, 12000) } : {}),
  };
}

async function proposeDesktopApproval(
  request: unknown,
  options: { deferPersistence?: boolean } = {},
): Promise<DesktopApprovalProposalResult> {
  if (!request || typeof request !== "object") {
    return blockedApprovalProposal("Approval proposal must be an object.");
  }
  const typed = request as DesktopApprovalProposalRequest;
  if (
    !typed.source ||
    !typed.actionKind ||
    typeof typed.title !== "string" ||
    typeof typed.detail !== "string" ||
    !typed.title.trim() ||
    !typed.detail.trim() ||
    !isValidApprovalProposalSourceAction(typed)
  ) {
    return blockedApprovalProposal("Approval proposal has an invalid source/action pair.");
  }

  const policy = await getDesktopExecutionPolicy();
  const decision = evaluateExecutionPermission(typed.actionKind, policy);
  if (!decision.allowed) {
    return {
      queued: false,
      allowed: false,
      requiresApproval: false,
      blocked: true,
      reason: decision.reason,
    };
  }
  if (!decision.requiresApproval) {
    return {
      queued: false,
      allowed: true,
      requiresApproval: false,
      blocked: false,
      reason: decision.reason,
    };
  }

  const approval: DesktopPendingApproval = {
    id: createRuntimeApprovalId(typed),
    source: typed.source,
    actionKind: typed.actionKind,
    title: typed.title.trim(),
    detail: typed.detail.trim(),
    businessAction: sanitizeOptionalDispatchText(getStringProperty(typed, "businessAction"), 160),
    businessObject: sanitizeOptionalDispatchText(getStringProperty(typed, "businessObject"), 240),
    target: typeof typed.target === "string" ? typed.target : undefined,
    scope: sanitizeOptionalDispatchText(getStringProperty(typed, "scope"), 240),
    impact: sanitizeOptionalDispatchText(getStringProperty(typed, "impact"), 320),
    createdAt: new Date().toISOString(),
    risk: normalizeApprovalRisk(typed),
    ...(typed.checklist ? { checklist: typed.checklist } : {}),
  };
  if (executedDesktopApprovalIds.has(approval.id)) {
    return {
      queued: false,
      approval,
      allowed: true,
      requiresApproval: false,
      blocked: false,
      reason: "Approval idempotency key already executed once.",
    };
  }
  pendingDesktopApprovals.set(approval.id, approval);
  setProtectedDesktopApprovalPayload(approval.id, "approval_review", approval);
  if (!options.deferPersistence) await persistDesktopApprovalState();
  registerF2ApprovalEffect(typed, approval.id);
  registerF3ApprovalEffect(typed, approval.id);
  return {
    queued: true,
    approval,
    allowed: true,
    requiresApproval: true,
    blocked: false,
    reason: decision.reason,
  };
}

function blockedApprovalProposal(reason: string): DesktopApprovalProposalResult {
  return {
    queued: false,
    allowed: false,
    requiresApproval: false,
    blocked: true,
    reason,
  };
}

async function requestTerminalShellCommandApproval(
  event: IpcMainInvokeEvent,
  request: unknown,
): Promise<DesktopApprovalProposalResult> {
  if (!request || typeof request !== "object") {
    return blockedApprovalProposal("Shell command approval request must be an object.");
  }
  const typed = request as DesktopShellCommandApprovalRequest;
  if (
    typeof typed.terminalSessionId !== "string" ||
    !typed.terminalSessionId.trim() ||
    typeof typed.commandId !== "string" ||
    !typed.commandId.trim() ||
    typeof typed.command !== "string" ||
    !typed.command.trim() ||
    typeof typed.invocation !== "string" ||
    !typed.invocation.trim()
  ) {
    return blockedApprovalProposal("Shell command approval request is incomplete.");
  }

  const proposal = await proposeDesktopApproval({
    source: "shell",
    actionKind: "shell.command",
    title: "Run shell command",
    detail: typed.command.trim(),
    target: typed.terminalSessionId.trim(),
    risk: typed.risk,
    idempotencyKey: `terminal:${typed.terminalSessionId}:${typed.commandId}`,
  });

  if (proposal.blocked || !proposal.allowed) return proposal;

  if (proposal.queued && proposal.approval) {
    pendingShellCommandApprovals.set(proposal.approval.id, {
      terminalSessionId: typed.terminalSessionId,
      commandId: typed.commandId,
      command: typed.command,
      invocation: typed.invocation,
      ...(typed.workflowRunId ? { workflowRunId: typed.workflowRunId } : {}),
      ...(typed.workflowStepId ? { workflowStepId: typed.workflowStepId } : {}),
    });
    return proposal;
  }

  await assertExecutionAllowed("shell.command", { approved: true });
  const wrote = writeTerminalSession(event, typed.terminalSessionId, typed.invocation);
  if (!wrote) {
    return blockedApprovalProposal("The target terminal session is no longer available.");
  }
  await markShellWorkflowStepRunning(typed);
  return proposal;
}

async function requestGitCommitApproval(
  request: unknown,
): Promise<DesktopApprovalProposalResult> {
  const typed = normalizeGitCommitApprovalRequest(request);
  if (!typed) {
    return blockedApprovalProposal("Git commit approval request is incomplete.");
  }
  if ((await resolveRemoteWorkspaceTarget(typed.workspacePath)) === "local_or_unknown" && !(await isAllowedOpenPath(typed.workspacePath))) {
    return blockedApprovalProposal("Git commit workspace is not registered or allowed.");
  }

  const proposal = await proposeDesktopApproval({
    source: "git",
    actionKind: "git.commit",
    title: "Create git commit",
    detail: formatGitCommitApprovalDetail(typed),
    target: typed.workspacePath,
    risk: "high",
    ...(typed.checklist ? { checklist: typed.checklist } : {}),
    idempotencyKey: getGitCommitIdempotencyKey(typed),
  });

  if (proposal.blocked || !proposal.allowed) return proposal;

  if (proposal.queued && proposal.approval) {
    pendingGitCommitApprovals.set(proposal.approval.id, typed);
    await registerDesktopApprovalPayload(proposal.approval.id, "git_commit", typed);
    return proposal;
  }

  await assertExecutionAllowed("git.commit", { approved: true });
  await executeGitCommit(typed);
  return proposal;
}

async function requestForkLifecycleApproval(
  request: unknown,
): Promise<DesktopForkLifecycleApprovalResult> {
  const typed = normalizeForkLifecycleApprovalRequest(request);
  if (!typed) {
    return blockedForkLifecycleProposal("Fork lifecycle approval request is incomplete.");
  }
  const thread = (await listThreads()).find((item) => item.id === typed.threadId);
  if (!thread?.fork) {
    return blockedForkLifecycleProposal("Fork lifecycle approval requires a fork thread.");
  }
  if (thread.fork.lifecycleStatus === "closed") {
    return blockedForkLifecycleProposal("Closed fork threads cannot request lifecycle changes.");
  }
  if (!(await isAllowedOpenPath(thread.fork.sourceWorkspacePath))) {
    return blockedForkLifecycleProposal("Fork source workspace is not registered or allowed.");
  }

  const actionLabel = typed.action === "merge_back" ? "merge back" : "discard";
  const proposal = await proposeDesktopApproval({
    source: "fork",
    actionKind: "fork.lifecycle",
    title: `Review fork ${actionLabel}`,
    detail: formatForkLifecycleApprovalDetail(thread.fork, typed.action),
    target: thread.fork.worktreePath,
    risk: "high",
    idempotencyKey: `fork-lifecycle:${typed.threadId}:${typed.action}:${thread.fork.lifecycleStatus}`,
  });

  if (proposal.blocked || !proposal.allowed) {
    return {
      queued: false,
      allowed: proposal.allowed,
      blocked: proposal.blocked,
      reason: proposal.reason,
    };
  }

  if (proposal.queued && proposal.approval) {
    pendingForkLifecycleApprovals.set(proposal.approval.id, typed);
    await registerDesktopApprovalPayload(proposal.approval.id, "fork_lifecycle", typed);
    return {
      queued: true,
      approval: proposal.approval,
      allowed: true,
      blocked: false,
      reason: proposal.reason,
    };
  }

  const updatedThread = await executeForkLifecycleApproval(typed);
  return {
    queued: false,
    thread: updatedThread,
    allowed: true,
    blocked: false,
    reason: "Fork lifecycle state was updated.",
  };
}

async function requestForkQueueStartApproval(
  request: unknown,
): Promise<DesktopForkQueueStartApprovalResult> {
  const typed = normalizeForkQueueStartApprovalRequest(request);
  if (!typed) {
    return blockedForkQueueStartProposal("Fork queue start approval request is incomplete.");
  }
  const allThreads = await listThreads();
  const requestedThreads = typed.threadIds
    .map((threadId) => allThreads.find((thread) => thread.id === threadId))
    .filter((thread): thread is NonNullable<typeof thread> => Boolean(thread));
  if (requestedThreads.length !== typed.threadIds.length || requestedThreads.some((thread) => !thread.fork)) {
    return blockedForkQueueStartProposal("Fork queue start approval requires existing fork threads.");
  }
  if (requestedThreads.some((thread) => thread.fork?.lifecycleStatus === "closed")) {
    return blockedForkQueueStartProposal("Closed fork threads cannot be queued for agent dispatch.");
  }
  const sourceWorkspacePath = requestedThreads[0]?.fork?.sourceWorkspacePath;
  if (!sourceWorkspacePath || !(await isAllowedOpenPath(sourceWorkspacePath))) {
    return blockedForkQueueStartProposal("Fork queue source workspace is not registered or allowed.");
  }

  const proposal = await proposeDesktopApproval({
    source: "fork",
    actionKind: "fork.queue_start",
    title: `Start fork queue (${requestedThreads.length})`,
    detail: formatForkQueueStartApprovalDetail(requestedThreads),
    target: sourceWorkspacePath,
    risk: "high",
    idempotencyKey: `fork-queue-start:${typed.threadIds.join(":")}`,
  });

  if (proposal.blocked || !proposal.allowed) {
    return {
      queued: false,
      threads: requestedThreads,
      allowed: proposal.allowed,
      blocked: proposal.blocked,
      reason: proposal.reason,
    };
  }

  if (proposal.queued && proposal.approval) {
    pendingForkQueueStartApprovals.set(proposal.approval.id, typed);
    await registerDesktopApprovalPayload(proposal.approval.id, "fork_queue_start", typed);
    const threads = await updateForkQueueThreads(
      typed.threadIds,
      "waiting_approval",
      `Queue start is waiting in Approval Center: ${proposal.approval.title}.`,
      proposal.approval.id,
    );
    return {
      queued: true,
      approval: proposal.approval,
      threads,
      allowed: true,
      blocked: false,
      reason: proposal.reason,
    };
  }

  const threads = await updateForkQueueThreads(
    typed.threadIds,
    "ready",
    "Fork queue start was allowed by policy; queued subtasks are ready for explicit agent dispatch.",
  );
  return {
    queued: false,
    threads,
    allowed: true,
    blocked: false,
    reason: "Fork queue is ready for explicit agent dispatch.",
  };
}

function normalizeForkLifecycleApprovalRequest(
  request: unknown,
): DesktopForkLifecycleApprovalRequest | null {
  if (!request || typeof request !== "object") return null;
  const threadId = getStringProperty(request, "threadId");
  const action = (request as { action?: unknown }).action;
  if (!threadId || (action !== "merge_back" && action !== "discard")) return null;
  return {
    threadId,
    action,
  };
}

function normalizeForkQueueStartApprovalRequest(
  request: unknown,
): DesktopForkQueueStartApprovalRequest | null {
  if (!request || typeof request !== "object") return null;
  const threadIds = (request as { threadIds?: unknown }).threadIds;
  if (!Array.isArray(threadIds)) return null;
  const normalized = [...new Set(threadIds)]
    .filter((threadId): threadId is string => typeof threadId === "string")
    .map((threadId) => threadId.trim())
    .filter((threadId) => threadId.length > 0 && threadId.length <= 160)
    .slice(0, 12);
  if (!normalized.length || normalized.length !== threadIds.length) return null;
  return { threadIds: normalized };
}

function formatForkLifecycleApprovalDetail(
  fork: DesktopThreadForkMetadata,
  action: DesktopForkLifecycleAction,
): string {
  const nextState = action === "merge_back" ? "merge_pending" : "cleanup_pending";
  const actionText =
    action === "merge_back"
      ? "Approve merging this fork branch back into the source workspace. If conflicts or dirty worktrees are detected, the fork remains merge_pending with a status message."
      : "Approve removing this controlled fork worktree from the Git worktree registry and deleting its desktop-managed directory. If the fork branch is already merged, cleanup deletes it with git branch -d; otherwise the branch is renamed under drsai/archive so unmerged work is retained.";
  return [
    actionText,
    `Next lifecycle state: ${nextState}`,
    `Branch: ${fork.branch}`,
    fork.branchCleanupStatus ? `Current branch cleanup: ${fork.branchCleanupStatus}` : "",
    fork.archivedBranch ? `Archived branch: ${fork.archivedBranch}` : "",
    `Base: ${fork.baseRef}`,
    `Source workspace: ${fork.sourceWorkspacePath}`,
    `Fork worktree: ${fork.worktreePath}`,
  ].filter(Boolean).join("\n");
}

function formatForkQueueStartApprovalDetail(
  threads: Array<{ title: string; fork?: DesktopThreadForkMetadata }>,
): string {
  return [
    "Approve starting this fork-backed subtask queue. Approval only marks the isolated fork threads ready for explicit agent dispatch; it does not bypass chat, terminal, or file mutation approvals.",
    ...threads.map((thread, index) =>
      [
        `${index + 1}. ${thread.title}`,
        thread.fork?.branch ? `Branch: ${thread.fork.branch}` : "",
        thread.fork?.worktreePath ? `Worktree: ${thread.fork.worktreePath}` : "",
      ].filter(Boolean).join("\n"),
    ),
  ].join("\n\n");
}

async function executeForkLifecycleApproval(
  request: DesktopForkLifecycleApprovalRequest,
) {
  await assertExecutionAllowed("fork.lifecycle", { approved: true });
  const thread = (await listThreads()).find((item) => item.id === request.threadId);
  if (!thread?.fork) {
    throw new Error("Fork lifecycle approval target no longer exists.");
  }
  if (!(await isAllowedOpenPath(thread.fork.sourceWorkspacePath))) {
    throw new Error("Fork source workspace is not registered or allowed.");
  }
  const lifecycleStatus =
    request.action === "merge_back" ? "merge_pending" : "cleanup_pending";
  const pendingThread = await updateThread({
    id: thread.id,
    fork: {
      ...thread.fork,
      lifecycleStatus,
      lifecycleUpdatedAt: new Date().toISOString(),
      lifecycleMessage:
        request.action === "merge_back"
          ? "Merge-back approved; checking source and fork worktrees."
          : "Discard approved; removing the controlled fork worktree.",
    },
  });
  const result = await executeForkLifecycleAction(pendingThread.fork ?? thread.fork, request.action);
  return updateThread({
    id: thread.id,
    fork: {
      ...(pendingThread.fork ?? thread.fork),
      ...result,
    },
  });
}

async function executeForkQueueStartApproval(
  request: DesktopForkQueueStartApprovalRequest,
  approved: boolean,
) {
  if (approved) {
    await assertExecutionAllowed("fork.queue_start", { approved: true });
  }
  return updateForkQueueThreads(
    request.threadIds,
    approved ? "ready" : "blocked",
    approved
      ? "Fork queue start approved; subtasks are ready for explicit agent dispatch."
      : "Fork queue start was rejected in Approval Center.",
  );
}

async function dispatchForkQueue(
  webContents: WebContents,
  request: unknown,
): Promise<DesktopForkQueueDispatchResult> {
  const typed = normalizeForkQueueDispatchRequest(request);
  if (!typed) {
    return {
      startedRuns: [],
      threads: [],
      blockedThreadIds: [],
      reason: "Fork queue dispatch request is incomplete.",
    };
  }
  const allThreads = await listThreads();
  const requestedThreads = typed.threadIds
    .map((threadId) => allThreads.find((thread) => thread.id === threadId))
    .filter((thread): thread is DesktopThread => Boolean(thread?.fork));
  if (requestedThreads.length !== typed.threadIds.length) {
    return {
      startedRuns: [],
      threads: requestedThreads,
      blockedThreadIds: typed.threadIds,
      reason: "Fork queue dispatch requires existing fork threads.",
    };
  }
  const notReadyThreads = requestedThreads.filter((thread) => thread.fork?.queueStatus !== "ready");
  if (notReadyThreads.length) {
    const blocked = await updateForkQueueThreads(
      notReadyThreads.map((thread) => thread.id),
      "blocked",
      "Fork queue dispatch was blocked because the queue is not approved and ready.",
    );
    return {
      startedRuns: [],
      threads: blocked,
      blockedThreadIds: notReadyThreads.map((thread) => thread.id),
      reason: "Only approved ready fork queue threads can be dispatched.",
    };
  }

  const startedRuns: DesktopForkQueueDispatchResult["startedRuns"] = [];
  const blockedThreadIds: string[] = [];
  const updatedThreads: DesktopThread[] = [];
  for (const thread of requestedThreads) {
    const fork = thread.fork;
    if (!fork) continue;
    if (!(await isAllowedOpenPath(fork.sourceWorkspacePath))) {
      blockedThreadIds.push(thread.id);
      updatedThreads.push(
        ...(await updateForkQueueThreads(
          [thread.id],
          "blocked",
          "Fork queue dispatch was blocked because the source workspace is not registered or allowed.",
        )),
      );
      continue;
    }
    try {
      const now = new Date().toISOString();
      const runningThread = await updateThread({
        id: thread.id,
        status: "running",
        fork: {
          ...fork,
          queueStatus: "running",
          queueMessage: buildForkQueueRunningMessage(thread, typed),
          queueUpdatedAt: now,
        },
      });
      updatedThreads.push(runningThread);
      const started = await startAgentRun(webContents, {
        threadId: thread.id,
        sessionId: thread.id,
        runId: `fork-queue-${Date.now()}-${thread.id}`,
        task: buildForkQueueDispatchTask(thread, typed),
        workspacePath: fork.worktreePath,
        model: typed.model,
        metadata: {
          runtime_mode: {
            name: "fork",
            intent: thread.title,
            activated_by: "fork_queue_dispatch",
          },
          fork_queue_dispatch: true,
          fork_queue_group_id: fork.queueGroupId,
          fork_queue_index: fork.queueIndex,
          fork_queue_size: fork.queueSize,
          selected_agent_id: resolveForkQueueAssignment(thread, typed).agentId,
          selected_agent_name: resolveForkQueueAssignment(thread, typed).agentName,
          source_workspace_path: fork.sourceWorkspacePath,
          isolated_worktree_path: fork.worktreePath,
        },
      });
      startedRuns.push({
        threadId: thread.id,
        requestId: started.requestId,
        runId: started.runId,
      });
    } catch (error) {
      blockedThreadIds.push(thread.id);
      updatedThreads.push(
        ...(await updateForkQueueThreads(
          [thread.id],
          "blocked",
          `Fork queue dispatch failed to start: ${formatForkQueueDispatchError(error)}`,
        )),
      );
    }
  }
  return {
    startedRuns,
    threads: updatedThreads,
    blockedThreadIds,
    reason: startedRuns.length
      ? `Dispatched ${startedRuns.length} fork queue subtask${startedRuns.length === 1 ? "" : "s"}.`
      : "No fork queue subtasks were dispatched.",
  };
}

async function updateForkQueueThreads(
  threadIds: string[],
  queueStatus: NonNullable<DesktopThreadForkMetadata["queueStatus"]>,
  queueMessage: string,
  queueApprovalId?: string,
) {
  const now = new Date().toISOString();
  const allThreads = await listThreads();
  const updated: Array<Awaited<ReturnType<typeof updateThread>>> = [];
  for (const threadId of threadIds) {
    const thread = allThreads.find((item) => item.id === threadId);
    if (!thread?.fork) continue;
    updated.push(
      await updateThread({
        id: thread.id,
        fork: {
          ...thread.fork,
          queueStatus,
          queueMessage,
          ...(queueApprovalId ? { queueApprovalId } : {}),
          queueUpdatedAt: now,
        },
      }),
    );
  }
  return updated;
}

function normalizeForkQueueDispatchRequest(
  request: unknown,
): DesktopForkQueueDispatchRequest | null {
  if (!request || typeof request !== "object") return null;
  const startRequest = normalizeForkQueueStartApprovalRequest(request);
  if (!startRequest) return null;
  return {
    threadIds: startRequest.threadIds,
    selectedAgentId: sanitizeOptionalDispatchText(getStringProperty(request, "selectedAgentId"), 120),
    selectedAgentName: sanitizeOptionalDispatchText(getStringProperty(request, "selectedAgentName"), 160),
    threadAgentAssignments: normalizeForkQueueAgentAssignments(request as Record<string, unknown>, startRequest.threadIds),
    model: sanitizeOptionalDispatchText(getStringProperty(request, "model"), 160),
  };
}

function normalizeForkQueueAgentAssignments(
  request: Record<string, unknown>,
  threadIds: string[],
): DesktopForkQueueDispatchRequest["threadAgentAssignments"] | undefined {
  const raw = request.threadAgentAssignments;
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const allowed = new Set(threadIds);
  const entries: Array<[string, { agentId?: string; agentName?: string }]> = [];
  for (const [threadId, value] of Object.entries(source)) {
    if (!allowed.has(threadId) || !value || typeof value !== "object") continue;
    const assignment = value as Record<string, unknown>;
    const agentId = sanitizeOptionalDispatchText(getStringProperty(assignment, "agentId"), 120);
    const agentName = sanitizeOptionalDispatchText(getStringProperty(assignment, "agentName"), 160);
    if (!agentId && !agentName) continue;
    entries.push([threadId, { agentId, agentName }]);
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function sanitizeOptionalDispatchText(value: string, maxChars: number): string | undefined {
  if (!value) return undefined;
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, maxChars) || undefined;
}

function buildForkQueueDispatchTask(
  thread: DesktopThread,
  request: DesktopForkQueueDispatchRequest,
): string {
  const fork = thread.fork;
  const assignment = resolveForkQueueAssignment(thread, request);
  return [
    `Subtask: ${thread.title}`,
    "Execute this approved fork queue subtask inside its isolated worktree.",
    fork?.queueIndex && fork.queueSize ? `Queue position: ${fork.queueIndex}/${fork.queueSize}` : "",
    assignment.agentName ? `Assigned agent: ${assignment.agentName}` : "",
    fork?.queueAgentHint && !assignment.agentName ? `Requested agent hint: ${fork.queueAgentHint}` : "",
    fork?.sourceWorkspacePath ? `Source workspace for review only: ${fork.sourceWorkspacePath}` : "",
    fork?.worktreePath ? `Writable isolated worktree: ${fork.worktreePath}` : "",
    "Before coding, write a concise design plan in the agent run. Then implement, add or update tests, run the relevant verification, and report completion or blockers.",
  ].filter(Boolean).join("\n");
}

function buildForkQueueRunningMessage(
  thread: DesktopThread,
  request: DesktopForkQueueDispatchRequest,
): string {
  const assignment = resolveForkQueueAssignment(thread, request);
  return [
    "Fork queue subtask is running in its isolated worktree.",
    assignment.agentName ? `Assigned agent: ${assignment.agentName}.` : "",
  ].filter(Boolean).join(" ");
}

function resolveForkQueueAssignment(
  thread: DesktopThread,
  request: DesktopForkQueueDispatchRequest,
): { agentId?: string; agentName?: string } {
  const explicit = request.threadAgentAssignments?.[thread.id];
  return {
    agentId: explicit?.agentId ?? thread.fork?.queueAgentId ?? request.selectedAgentId,
    agentName: explicit?.agentName ?? thread.fork?.queueAgentName ?? request.selectedAgentName,
  };
}

function formatForkQueueDispatchError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function blockedForkLifecycleProposal(
  reason: string,
): DesktopForkLifecycleApprovalResult {
  return {
    queued: false,
    allowed: false,
    blocked: true,
    reason,
  };
}

function blockedForkQueueStartProposal(
  reason: string,
): DesktopForkQueueStartApprovalResult {
  return {
    queued: false,
    threads: [],
    allowed: false,
    blocked: true,
    reason,
  };
}

function normalizeGitCommitApprovalRequest(
  request: unknown,
): DesktopGitCommitApprovalRequest | null {
  if (!request || typeof request !== "object") return null;
  const workspacePath = getStringProperty(request, "workspacePath");
  const message = getStringProperty(request, "message");
  if (!workspacePath || !message || message.length > 240) return null;
  const body = getStringProperty(request, "body");
  const requestId = getStringProperty(request, "requestId");
  return {
    workspacePath,
    message,
    ...(body ? { body } : {}),
    ...(isDesktopCommitApprovalChecklist((request as Record<string, unknown>).checklist)
      ? { checklist: (request as { checklist: DesktopGitCommitApprovalRequest["checklist"] }).checklist }
      : {}),
    ...(requestId ? { requestId } : {}),
  };
}

function isDesktopCommitApprovalChecklist(
  value: unknown,
): value is NonNullable<DesktopGitCommitApprovalRequest["checklist"]> {
  if (!value || typeof value !== "object") return false;
  const typed = value as DesktopGitCommitApprovalRequest["checklist"];
  return (
    typed?.type === "git_commit" &&
    Array.isArray(typed.stagedFiles) &&
    typeof typed.workspaceChangedFileCount === "number" &&
    typeof typed.unstagedFileCount === "number" &&
    typeof typed.diffLineCount === "number" &&
    typeof typed.diffTruncated === "boolean" &&
    typeof typed.riskSummary === "string" &&
    typeof typed.testCommitment === "string"
  );
}

function formatGitCommitApprovalDetail(
  request: DesktopGitCommitApprovalRequest,
): string {
  const command = `git commit -m "${request.message}"`;
  if (!request.body?.trim()) return command;
  return `${command}\n\n${request.body.trim()}`;
}

function getGitCommitIdempotencyKey(
  request: DesktopGitCommitApprovalRequest,
): string {
  return [
    "git-commit",
    request.workspacePath,
    stableApprovalHash(request.message),
    request.body ? stableApprovalHash(request.body) : "",
    request.requestId ?? "",
  ]
    .filter(Boolean)
    .join(":");
}

async function executeGitCommit(
  request: DesktopGitCommitApprovalRequest,
  approvalId?: string,
): Promise<void> {
  if ((await resolveRemoteWorkspaceTarget(request.workspacePath)) !== "local_or_unknown") {
    await commitRemoteWorkspace(request.workspacePath, request.message, request.body, approvalId);
    return;
  }
  if (!(await isAllowedOpenPath(request.workspacePath))) {
    throw new Error("Git commit workspace is not registered or allowed.");
  }
  const marker = approvalId ? gitCommitApprovalTrailer(approvalId) : undefined;
  if (marker) {
    const history = await execGit(["-C", request.workspacePath, "log", "--all", "-n", "200", "--format=%B%x00"], request.workspacePath, 30000);
    if (history.split("\0").some((message) => message.split(/\r?\n/).some((line) => line.trim() === marker))) return;
  }
  const args = ["-C", request.workspacePath, "commit", "-m", request.message];
  if (request.body?.trim()) args.push("-m", request.body.trim());
  if (marker) args.push("-m", marker);
  await execGit(args, request.workspacePath, 60000);
}

function gitCommitApprovalTrailer(approvalId: string): string {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(approvalId)) throw new Error("Git commit approval id is invalid.");
  return `OpenDrSai-Approval: ${approvalId}`;
}

async function execGit(
  args: string[],
  cwd: string,
  timeout: number,
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      "git",
      args,
      { cwd, timeout, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          rejectPromise(
            new Error(stderr?.trim() || stdout?.trim() || error.message),
          );
          return;
        }
        resolvePromise(stdout);
      },
    );
  });
}

async function requestWorkspaceMutationApproval(
  action: WorkspaceMutationAction,
  request: unknown,
): Promise<unknown> {
  const actionKind = getWorkspaceMutationActionKind(action);
  const proposal = await proposeDesktopApproval({
    source: "workspace",
    actionKind,
    title: getWorkspaceMutationTitle(action),
    detail: getWorkspaceMutationDetail(action, request),
    target: getStringProperty(request, "path") || getStringProperty(request, "workspacePath"),
    risk: actionKind === "workspace.revert" ? "medium" : "low",
    idempotencyKey: getWorkspaceMutationIdempotencyKey(action, request),
  });

  if (proposal.blocked || !proposal.allowed) {
    throw new Error(proposal.reason);
  }
  if (proposal.queued && proposal.approval) {
    pendingWorkspaceMutationApprovals.set(proposal.approval.id, {
      action,
      request,
    });
    await registerDesktopApprovalPayload(proposal.approval.id, "workspace_mutation", { action, request });
    return createQueuedWorkspaceMutationResult(action, request, proposal.approval.id);
  }

  await assertExecutionAllowed(actionKind, { approved: true });
  return executeWorkspaceMutation(action, request);
}

async function requestWorkspaceCheckpointRestore(
  request: unknown,
): Promise<WorkspaceCheckpointRestoreResult> {
  const workspacePath = getStringProperty(request, "workspacePath");
  const workspaceId = getStringProperty(request, "workspaceId") || undefined;
  const checkpointId = getStringProperty(request, "checkpointId");
  const operationId = getStringProperty(request, "operationId") || `restore-${Date.now().toString(36)}`;
  const includePaths = getStringArrayProperty(request, "includePaths");
  if (!workspacePath || !checkpointId) {
    throw new Error("Workspace checkpoint restore request is incomplete.");
  }
  if ((await resolveRemoteWorkspaceTarget(workspacePath, workspaceId)) === "local_or_unknown" && !(await isAllowedOpenPath(workspacePath))) {
    throw new Error("Checkpoint workspace is not registered or allowed.");
  }

  const proposal = await proposeDesktopApproval({
    source: "workspace",
    actionKind: "workspace.revert",
    title: "Restore workspace checkpoint",
    detail: includePaths
      ? `Restore only ${includePaths.join(", ")} from checkpoint ${checkpointId}. Other version items will stay unchanged.`
      : `Restore checkpoint ${checkpointId} in ${workspacePath}. This may overwrite or remove workspace files captured by the checkpoint manifest.`,
    target: includePaths?.join(", ") || workspacePath,
    risk: "medium",
    idempotencyKey: `workspace:checkpoint-restore:${stableApprovalHash(workspacePath)}:${checkpointId}:${stableApprovalHash(operationId)}:${stableApprovalHash((includePaths || []).join("\n"))}`,
  });

  if (proposal.blocked || !proposal.allowed) {
    throw new Error(proposal.reason);
  }
  if (proposal.queued && proposal.approval) {
    const restoreRequest: WorkspaceCheckpointRestoreRequest = {
      workspacePath,
      ...(workspaceId ? { workspaceId } : {}),
      checkpointId,
      operationId,
      ...(includePaths ? { includePaths } : {}),
    };
    pendingWorkspaceCheckpointRestores.set(proposal.approval.id, restoreRequest);
    await registerDesktopApprovalPayload(proposal.approval.id, "workspace_checkpoint_restore", restoreRequest);
    return {
      workspacePath,
      checkpointId,
      restored: false,
      restoredFileCount: 0,
      removedFileCount: 0,
      skippedFileCount: 0,
      approvalId: proposal.approval.id,
      approvalQueued: true,
      message: "Workspace checkpoint restore is waiting in Approval Center.",
    };
  }

  await assertExecutionAllowed("workspace.revert", { approved: true });
  return (await resolveRemoteWorkspaceTarget(workspacePath, workspaceId)) !== "local_or_unknown"
    ? restoreRemoteWorkspaceCheckpoint({ workspacePath, ...(workspaceId ? { workspaceId } : {}), checkpointId, operationId, ...(includePaths ? { includePaths } : {}) })
    : restoreWorkspaceCheckpoint({ workspacePath, checkpointId, operationId, ...(includePaths ? { includePaths } : {}) });
}

async function requestForkConflictDraftWrite(
  request: unknown,
): Promise<DesktopForkConflictDraftWriteResult> {
  const typed = normalizeForkConflictDraftWriteRequest(request);
  const thread = (await listThreads()).find((item) => item.id === typed.threadId);
  if (!thread?.fork) {
    throw new Error("Fork conflict draft target thread no longer exists.");
  }
  if (thread.fork.lifecycleStatus !== "merge_pending") {
    throw new Error("Fork conflict draft write-back is only available during merge recovery.");
  }
  if (
    !isSameFilesystemPath(
      thread.fork.sourceWorkspacePath,
      typed.workspacePath,
    )
  ) {
    throw new Error("Fork conflict draft workspace does not match the source workspace.");
  }
  if (!(await isAllowedOpenPath(typed.workspacePath))) {
    throw new Error("Fork conflict source workspace is not registered or allowed.");
  }
  const safeRelativePath = resolveForkConflictDraftPath(typed.workspacePath, typed.path);
  const diff = await getWorkspaceGitDiff({
    workspacePath: typed.workspacePath,
    path: safeRelativePath,
    maxChars: 300_000,
  });
  if (diff.diffHash !== typed.expectedDiffHash) {
    throw new Error("File diff changed since review; reload before writing the resolved draft.");
  }

  const proposal = await proposeDesktopApproval({
    source: "workspace",
    actionKind: "workspace.revert",
    title: "Write resolved conflict draft",
    detail: [
      "Approve writing the manually reviewed resolved draft into the source workspace file.",
      "This overwrites the current worktree file content but does not stage it; use Stage resolved file after reviewing the resulting diff.",
      `Thread: ${thread.title}`,
      `File: ${safeRelativePath}`,
      `Workspace: ${typed.workspacePath}`,
      `Reviewed diff hash: ${typed.expectedDiffHash}`,
    ].join("\n"),
    target: safeRelativePath,
    risk: "medium",
    idempotencyKey: [
      "fork-conflict-draft",
      typed.threadId,
      stableApprovalHash(typed.workspacePath),
      safeRelativePath,
      typed.expectedDiffHash,
      stableApprovalHash(typed.draft),
    ].join(":"),
  });

  if (proposal.blocked || !proposal.allowed) {
    throw new Error(proposal.reason);
  }
  const normalizedRequest: DesktopForkConflictDraftWriteRequest = {
    ...typed,
    path: safeRelativePath,
  };
  if (proposal.queued && proposal.approval) {
    pendingForkConflictDraftWrites.set(proposal.approval.id, normalizedRequest);
    await registerDesktopApprovalPayload(proposal.approval.id, "fork_conflict_draft", normalizedRequest);
    return {
      threadId: typed.threadId,
      workspacePath: typed.workspacePath,
      path: safeRelativePath,
      written: false,
      approvalId: proposal.approval.id,
      approvalQueued: true,
      message: "Resolved draft write-back is waiting in Approval Center.",
    };
  }

  await assertExecutionAllowed("workspace.revert", { approved: true });
  return executeForkConflictDraftWrite(normalizedRequest);
}

async function executeForkConflictDraftWrite(
  request: DesktopForkConflictDraftWriteRequest,
): Promise<DesktopForkConflictDraftWriteResult> {
  const safeRelativePath = resolveForkConflictDraftPath(request.workspacePath, request.path);
  const diff = await getWorkspaceGitDiff({
    workspacePath: request.workspacePath,
    path: safeRelativePath,
    maxChars: 300_000,
  });
  if (diff.diffHash !== request.expectedDiffHash) {
    throw new Error("File diff changed since approval; reload before writing the resolved draft.");
  }
  const targetPath = resolve(request.workspacePath, safeRelativePath);
  writeFileSync(targetPath, request.draft, "utf8");
  return {
    threadId: request.threadId,
    workspacePath: request.workspacePath,
    path: safeRelativePath,
    written: true,
    message: "Resolved draft was written to the source workspace. Review the new diff before staging.",
  };
}

function normalizeForkConflictDraftWriteRequest(
  request: unknown,
): DesktopForkConflictDraftWriteRequest {
  if (!request || typeof request !== "object") {
    throw new Error("Fork conflict draft write request is invalid.");
  }
  const threadId = getStringProperty(request, "threadId");
  const workspacePath = getStringProperty(request, "workspacePath");
  const path = getStringProperty(request, "path");
  const expectedDiffHash = getStringProperty(request, "expectedDiffHash");
  const rawDraft = (request as Record<string, unknown>).draft;
  if (!threadId || !workspacePath || !path || !expectedDiffHash) {
    throw new Error("Fork conflict draft write request is incomplete.");
  }
  if (typeof rawDraft !== "string") {
    throw new Error("Resolved draft content is required.");
  }
  if (rawDraft.length > 500_000) {
    throw new Error("Resolved draft is too large for inline write-back.");
  }
  if (rawDraft.includes("\u0000")) {
    throw new Error("Resolved draft contains invalid null bytes.");
  }
  return {
    threadId,
    workspacePath,
    path,
    draft: rawDraft,
    expectedDiffHash,
  };
}

function resolveForkConflictDraftPath(workspacePath: string, rawPath: string): string {
  const workspaceRoot = realpathSync(resolve(workspacePath));
  const candidate = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspaceRoot, rawPath);
  if (!existsSync(candidate)) {
    throw new Error("Fork conflict draft write-back requires an existing source file.");
  }
  const target = realpathSync(candidate);
  const relativePath = relative(workspaceRoot, target);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Fork conflict draft path escapes the source workspace.");
  }
  return relativePath.replace(/\\/g, "/");
}

function isSameFilesystemPath(left: string, right: string): boolean {
  const normalizedLeft = realpathSync(resolve(left));
  const normalizedRight = realpathSync(resolve(right));
  if (process.platform === "win32") {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

async function proposeChannelOutboundDraft(
  request: unknown,
): Promise<DesktopChannelOutboundDraftResult> {
  if (!request || typeof request !== "object") {
    return {
      queued: false,
      allowed: false,
      blocked: true,
      reason: "Channel outbound draft request must be an object.",
      verification: "No connector proposal was queued.",
    };
  }
  const typed = request as DesktopChannelOutboundDraftRequest;
  if (typed.workspacePath && !(await isAllowedOpenPath(typed.workspacePath))) {
    return {
      queued: false,
      allowed: false,
      blocked: true,
      reason: "Channel outbound workspace is not registered or allowed.",
      verification: "No connector proposal was queued.",
    };
  }
  try {
    const proposal = await proposeDesktopApproval(
      createChannelOutboundDraftApproval(typed),
      { deferPersistence: true },
    );
    let delivery: DesktopChannelOutboundDelivery | undefined;
    if (proposal.approval) {
      pendingChannelOutboundDrafts.set(proposal.approval.id, typed);
      await registerProtectedDesktopApprovalPayload(proposal.approval.id, "channel_outbound", typed);
    } else if (proposal.allowed && !proposal.blocked) {
      delivery = await executeChannelOutboundDeliveryAsync(
        typed,
        `connector:auto:${Date.now()}`,
        true,
      );
    }
    return {
      queued: proposal.queued,
      ...(proposal.approval ? { approval: proposal.approval } : {}),
      ...(delivery ? { delivery } : {}),
      allowed: proposal.allowed,
      blocked: proposal.blocked,
      reason: proposal.reason,
      verification:
        "Outbound channel drafts are approval-gated and do not send until a live connector runtime is configured.",
    };
  } catch (error) {
    return {
      queued: false,
      allowed: false,
      blocked: true,
      reason: error instanceof Error ? error.message : String(error),
      verification: "No connector proposal was queued.",
    };
  }
}

function getWorkspaceMutationActionKind(
  action: WorkspaceMutationAction,
): "workspace.stage" | "workspace.revert" {
  return action === "stage-file" || action === "stage-hunk"
    ? "workspace.stage"
    : "workspace.revert";
}

function getWorkspaceMutationTitle(action: WorkspaceMutationAction): string {
  return {
    "stage-file": "Stage workspace file",
    "revert-file": "Revert workspace file",
    "stage-hunk": "Stage workspace hunk",
    "revert-hunk": "Revert workspace hunk",
  }[action];
}

function getWorkspaceMutationDetail(
  action: WorkspaceMutationAction,
  request: unknown,
): string {
  const path = getStringProperty(request, "path") || "workspace change";
  const workspacePath = getStringProperty(request, "workspacePath");
  const suffix = workspacePath ? ` in ${workspacePath}` : "";
  return `${getWorkspaceMutationTitle(action)}: ${path}${suffix}`;
}

function getWorkspaceMutationIdempotencyKey(
  action: WorkspaceMutationAction,
  request: unknown,
): string {
  const workspacePath = getStringProperty(request, "workspacePath");
  const path = getStringProperty(request, "path");
  const expectedDiffHash = getStringProperty(request, "expectedDiffHash");
  const patch = getStringProperty(request, "patch");
  return [
    "workspace",
    action,
    workspacePath,
    path,
    expectedDiffHash,
    patch ? stableApprovalHash(patch) : "",
  ]
    .filter(Boolean)
    .join(":");
}

function stableApprovalHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getStringProperty(request: unknown, key: string): string {
  if (!request || typeof request !== "object") return "";
  const value = (request as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function createQueuedWorkspaceMutationResult(
  action: WorkspaceMutationAction,
  request: unknown,
  approvalId: string,
): unknown {
  const workspacePath = getStringProperty(request, "workspacePath");
  const path = getStringProperty(request, "path");
  const queued = {
    workspacePath,
    path,
    approvalId,
    approvalQueued: true,
    message: "Workspace change is waiting in Approval Center.",
  };
  if (action === "stage-file") return { ...queued, staged: false };
  if (action === "revert-file") return { ...queued, reverted: false };
  return { ...queued, applied: false };
}

async function executeWorkspaceMutation(
  action: WorkspaceMutationAction,
  request: unknown,
): Promise<unknown> {
  const workspacePath = getStringProperty(request, "workspacePath");
  const workspaceId = getStringProperty(request, "workspaceId");
  if ((await resolveRemoteWorkspaceTarget(workspacePath, workspaceId)) !== "local_or_unknown") return executeRemoteWorkspaceMutation(action, request);
  if (action === "stage-file") return stageWorkspaceFile(request);
  if (action === "revert-file") return revertWorkspaceFile(request);
  if (action === "stage-hunk") return stageWorkspaceHunk(request);
  return revertWorkspaceHunk(request);
}

function recordBrowserTaskDiagnostic(event: BrowserTaskEvent): Promise<unknown> {
  const rootSpanId = `browser-task:${event.taskId}`;
  const actionId = "actionId" in event ? event.actionId : undefined;
  const spanId = actionId ? `browser-action:${actionId}` : rootSpanId;
  const terminal = event.type === "task.completed" || event.type === "task.failed" || event.type === "task.cancelled";
  const status = event.type === "task.failed" ? "failed"
    : event.type === "task.cancelled" ? "cancelled"
    : event.type === "task.completed" || (event.type === "action.completed" && event.ok) ? "completed"
    : event.type === "action.completed" ? "failed"
    : event.type === "action.proposed" && event.requiresApproval ? "waiting"
    : event.type === "task.started" ? "started"
    : "running";
  return desktopDiagnostics.record({
    traceId: event.taskId,
    spanId,
    ...(spanId !== rootSpanId ? { parentSpanId: rootSpanId } : {}),
    timestamp: event.timestamp,
    endedAt: terminal || event.type === "action.completed" ? event.timestamp : undefined,
    module: "tool",
    component: "browser",
    operation: `browser.${event.type}`,
    message: event.type === "action.proposed" ? `Browser action proposed: ${event.action}`
      : event.type === "action.completed" ? `Browser action ${event.ok ? "completed" : "failed"}`
      : event.type === "task.failed" ? "Browser task failed"
      : event.type === "task.completed" ? "Browser task completed"
      : event.type === "task.cancelled" ? "Browser task cancelled"
      : event.type === "page.observed" ? "Browser page observed"
      : event.type === "screenshot" ? "Browser screenshot captured"
      : "Browser task started",
    kind: status === "failed" ? "error" : "operation",
    level: status === "failed" ? "error" : status === "waiting" ? "warn" : "info",
    status,
    attributes: {
      ...(event.type === "action.proposed" ? { action: event.action, requiresApproval: event.requiresApproval } : {}),
      ...(event.type === "action.completed" ? { ok: event.ok } : {}),
    },
  });
}

process.on("uncaughtExceptionMonitor", (error, origin) => {
  void desktopDiagnostics.record({
    module: "desktop",
    component: "electron-main",
    operation: "process.uncaught-exception",
    kind: "error",
    level: "error",
    status: "failed",
    message: error.message,
    errorCode: origin,
    stack: error.stack ? error.stack.split(/\r?\n/).map((raw) => ({ raw, language: "javascript" as const })) : undefined,
  });
});

process.on("unhandledRejection", (reason) => {
  void desktopDiagnostics.record({
    module: "desktop",
    component: "electron-main",
    operation: "process.unhandled-rejection",
    kind: "error",
    level: "error",
    status: "failed",
    message: reason instanceof Error ? (reason.stack || reason.message) : String(reason),
  });
});

app.on("child-process-gone", (_event, details) => {
  void desktopDiagnostics.record({
    module: "desktop",
    component: details.type || "child-process",
    operation: "process.child-gone",
    kind: "error",
    level: details.reason === "clean-exit" ? "info" : "error",
    status: details.reason === "clean-exit" ? "completed" : "failed",
    message: `${details.type} process exited: ${details.reason}`,
    errorCode: String(details.exitCode),
    attributes: { reason: details.reason, exitCode: details.exitCode, serviceName: details.serviceName || "" },
  });
});

if (process.env.OPENDRSAI_E2E_DISABLE_GPU === "1") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("disable-features", "VizDisplayCompositor");
}

function createWindow(): void {
  recordE2eStartupTrace("createWindow:start", { appPath: app.getAppPath() });
  const windowIcon = getWindowIconPath();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    title: "OpenDrSai",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#fafafe",
      symbolColor: "#5f5870",
      height: 40,
    },
    backgroundColor: "#fafafe",
    show: false,
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true,
    },
  });

  mainWindow.on("close", (event) => {
    console.info(
      `[desktop] Window close requested (quit=${appQuitRequested}, presentations=${managerPresentationRuns.size}, chats=${hasActiveChats()}, agents=${hasActiveAgentRuns()}).`,
    );
    if (appQuitRequested || !hasActiveForegroundIndependentWork()) return;
    event.preventDefault();
    mainWindow?.hide();
    console.info("[desktop] Window hidden while active work continues in the background.");
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    recordE2eStartupTrace("createWindow:did-fail-load", {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
  });
  mainWindow.webContents.on("did-finish-load", () => {
    recordStartupMilestone("renderer-loaded");
    recordE2eStartupTrace("createWindow:did-finish-load", {
      url: mainWindow?.webContents.getURL(),
    });
    void startDeferredStartupTasks();
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    recordE2eStartupTrace("createWindow:render-process-gone", { ...details });
    void desktopDiagnostics.record({
      module: "desktop",
      component: "renderer",
      operation: "renderer.process-gone",
      kind: "error",
      level: "error",
      status: "failed",
      message: `Renderer process exited: ${details.reason}`,
      errorCode: String(details.exitCode),
      attributes: { reason: details.reason, exitCode: details.exitCode },
    });
  });
  mainWindow.on("unresponsive", () => {
    void desktopDiagnostics.record({
      module: "desktop",
      component: "renderer",
      operation: "renderer.unresponsive",
      kind: "snapshot",
      level: "error",
      status: "waiting",
      message: "Renderer is not responding",
    });
  });
  mainWindow.on("responsive", () => {
    void desktopDiagnostics.record({
      module: "desktop",
      component: "renderer",
      operation: "renderer.responsive",
      kind: "health",
      level: "info",
      status: "completed",
      message: "Renderer responsiveness restored",
    });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowedRendererNavigation = isAllowedRendererNavigationUrl(url);
    recordE2eStartupTrace("createWindow:will-navigate", {
      url,
      currentUrl: mainWindow?.webContents.getURL(),
      allowedRendererNavigation,
    });
    if (allowedRendererNavigation) return;
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      const check = checkBrowserUrlSync(params.src);
      if (!check.allowed) {
        event.preventDefault();
        return;
      }
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      webPreferences.allowRunningInsecureContent = false;
    },
  );
  configureMainWindowPermissionPolicy(mainWindow);
  registerBrowserWebContentsPolicy();

  maybeRunE2eSmoke(mainWindow);
  recordE2eStartupTrace("createWindow:e2e-hook-registered");

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    if (!isAllowedDevRendererUrl(process.env.ELECTRON_RENDERER_URL)) {
      throw new Error(
        "ELECTRON_RENDERER_URL must point at localhost in development.",
      );
    }
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    recordE2eStartupTrace("createWindow:load-dev-url", { url: process.env.ELECTRON_RENDERER_URL });
  } else {
    const rendererHtmlPath = getRendererHtmlPath();
    const rendererUrl = getRendererUrl();
    recordE2eStartupTrace("createWindow:load-renderer", {
      rendererHtmlPath,
      rendererUrl,
      exists: existsSync(rendererHtmlPath),
    });
    void mainWindow.loadURL(rendererUrl).then(() => {
      recordE2eStartupTrace("createWindow:load-renderer-resolved");
    }).catch((error) => {
      recordE2eStartupTrace("createWindow:load-renderer-rejected", {
        error: error instanceof Error ? error.message : String(error),
      });
      writeE2eStartupFailure("Renderer loadFile failed.", error);
    });
  }
}

async function requestRemoteGatewayInstallApproval(
  request: RemoteGatewayInstallRequest,
): Promise<DesktopApprovalProposalResult> {
  if (!request?.hostAlias || !["install", "upgrade", "rollback"].includes(request.action)) {
    return blockedApprovalProposal("Remote Gateway operation is incomplete.");
  }
  const proposal = await proposeDesktopApproval({
    source: "workspace",
    actionKind: "external.service",
    title: `${request.action[0].toUpperCase()}${request.action.slice(1)} remote Gateway`,
    detail: request.action === "rollback"
      ? `Swap the managed current and previous Gateway releases on ${request.hostAlias}.`
      : `Upload and verify ${request.artifactPath || "the selected artifact"}, create an isolated release, run health checks, then atomically switch current on ${request.hostAlias}.`,
    target: request.hostAlias,
    risk: "high",
    idempotencyKey: ["remote-gateway", request.hostAlias, request.action, request.version || "", request.artifactSha256 || request.artifactPath || ""].join(":"),
  });
  if (proposal.blocked || !proposal.allowed) return proposal;
  if (proposal.queued && proposal.approval) {
    pendingRemoteGatewayInstallApprovals.set(proposal.approval.id, request);
    await registerDesktopApprovalPayload(proposal.approval.id, "remote_gateway_install", request);
    return proposal;
  }
  await assertExecutionAllowed("external.service", { approved: true });
  await installRemoteGateway(request);
  return proposal;
}

function writeE2eStartupFailure(message: string, error: unknown): void {
  if (!isE2eSmokeProcess || !process.env.OPENDRSAI_E2E_RESULT) return;
  const resultPath = process.env.OPENDRSAI_E2E_RESULT;
  try {
    mkdirSync(dirname(resultPath), { recursive: true });
    writeFileSync(
      resultPath,
      `${JSON.stringify(
        {
          ok: false,
          checks: {},
          details: { rendererHtmlPath: getRendererHtmlPath(), appPath: app.getAppPath() },
          error: `${message} ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch {
    // The smoke watchdog will still report a timeout if diagnostics cannot be written.
  }
}

function registerDeepLinkProtocol(): void {
  try {
    const developmentRuntime = Boolean(process.env.ELECTRON_RENDERER_URL) || is.dev || !app.isPackaged;
    if (developmentRuntime) {
      app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [
        app.getAppPath(),
      ]);
      registerDevelopmentDeepLinkCommand();
      registerDeepLinkDisplayName();
      return;
    }
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [
        resolve(process.argv[1]),
      ]);
      registerDeepLinkDisplayName();
      return;
    }
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
    registerDeepLinkDisplayName();
  } catch (error) {
    console.warn(
      "[desktop] Failed to register deep link protocol:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function registerDevelopmentDeepLinkCommand(): void {
  if (process.platform !== "win32") return;
  const command = `"${process.execPath}" "${app.getAppPath()}" "%1"`;
  execFile("reg.exe", [
    "add",
    `HKCU\\Software\\Classes\\${DEEP_LINK_PROTOCOL}\\shell\\open\\command`,
    "/ve",
    "/t",
    "REG_SZ",
    "/d",
    command,
    "/f",
  ], (error) => {
    if (error) {
      console.warn("[desktop] Failed to register development deep link command:", error.message);
    }
  });
}

function registerDeepLinkDisplayName(): void {
  if (process.platform !== "win32") return;
  const protocolKey = `HKCU\\Software\\Classes\\${DEEP_LINK_PROTOCOL}`;
  const displayName = DEEP_LINK_PROTOCOL === "opendrsai-dev" ? "OpenDrSai Dev" : "OpenDrSai";
  execFile("reg.exe", [
    "add",
    `${protocolKey}\\Application`,
    "/v",
    "ApplicationName",
    "/t",
    "REG_SZ",
    "/d",
    displayName,
    "/f",
  ], (error) => {
    if (error) {
      console.warn("[desktop] Failed to register deep link display name:", error.message);
    }
  });
}

function registerRendererProtocol(): void {
  protocol.registerFileProtocol(RENDERER_PROTOCOL, (request, callback) => {
    try {
      recordE2eStartupTrace("renderer-protocol:request", { url: request.url });
      const rendererRoot = resolve(process.resourcesPath, "renderer");
      const url = new URL(request.url);
      const requestedPath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const relativePath = requestedPath || "index.html";
      const targetPath = resolve(rendererRoot, relativePath);
      const localRelative = relative(rendererRoot, targetPath);
      if (
        localRelative.startsWith("..") ||
        isAbsolute(localRelative)
      ) {
        recordE2eStartupTrace("renderer-protocol:forbidden", { targetPath });
        callback({ error: -10 });
        return;
      }
      if (!existsSync(targetPath)) {
        recordE2eStartupTrace("renderer-protocol:not-found", { targetPath });
        callback({ error: -6 });
        return;
      }
      recordE2eStartupTrace("renderer-protocol:served", { targetPath });
      callback({ path: targetPath });
    } catch (error) {
      recordE2eStartupTrace("renderer-protocol:error", {
        error: error instanceof Error ? error.message : String(error),
      });
      callback({ error: -2 });
    }
  });
}

function findDeepLinkArg(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${DEEP_LINK_PROTOCOL}://`)) || null;
}

function handleDeepLinkArgv(argv: string[]): void {
  const deepLink = findDeepLinkArg(argv);
  if (!deepLink) return;
  try {
    const url = new URL(deepLink);
    if (url.protocol !== `${DEEP_LINK_PROTOCOL}:`) return;
    if (url.hostname === "phase3-live-acceptance") {
      const nonce = url.searchParams.get("nonce") || "";
      if (!/^[0-9a-f-]{36}$/i.test(nonce)) {
        console.warn("[desktop] Ignored Phase 3 acceptance request with an invalid nonce.");
        return;
      }
      void runPhase3LiveAcceptance(nonce);
      return;
    }
    if (url.hostname !== "auth-complete") return;
    focusMainWindow();
  } catch (error) {
    console.warn(
      "[desktop] Ignored invalid deep link:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function focusMainWindow(): void {
  if (!app.isReady()) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function registerBrowserWebContentsPolicy(): void {
  if (browserWebContentsPolicyRegistered) return;
  browserWebContentsPolicyRegistered = true;
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "webview") return;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, url) => {
      if (!checkBrowserUrlSync(url).allowed) event.preventDefault();
    });
    contents.on("will-redirect", (event, url) => {
      if (!checkBrowserUrlSync(url).allowed) event.preventDefault();
    });
    configureBrowserSessionPolicy(contents.session);
  });
}

function configureBrowserSessionPolicy(session: Session): void {
  if (configuredBrowserSessions.has(session)) return;
  configuredBrowserSessions.add(session);
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.on("will-download", (event) => {
    event.preventDefault();
  });
}

function configureMainWindowPermissionPolicy(window: BrowserWindow): void {
  const allowedWebContentsId = window.webContents.id;
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes =
      "mediaTypes" in details && Array.isArray(details.mediaTypes)
        ? details.mediaTypes
        : [];
    callback(
      permission === "media" &&
        contents.id === allowedWebContentsId &&
        mediaTypes.includes("audio") &&
        !mediaTypes.includes("video"),
    );
  });
}

function getWindowIconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "icon.png")]
    : [
        join(__dirname, "../../build/icon.png"),
        join(process.cwd(), "build", "icon.png"),
      ];

  return candidates.find((candidate) => existsSync(candidate));
}

function isAllowedExternalUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== "string") return false;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isAllowedDevRendererUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "http:" &&
      TRUSTED_DEV_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function isAllowedRendererNavigationUrl(rawUrl: string): boolean {
  if (is.dev && isAllowedDevRendererUrl(rawUrl)) return true;
  if (app.isPackaged && rawUrl === getRendererUrl()) return true;
  return false;
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  return isTrustedDesktopIpcSender(
    event,
    mainWindow?.webContents,
    is.dev ? isAllowedDevRendererUrl : undefined,
  );
}

function getStringArrayProperty(request: unknown, key: string): string[] | undefined {
  if (!request || typeof request !== "object") return undefined;
  const value = (request as Record<string, unknown>)[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${key} must be a non-empty list of paths.`);
  }
  return [...new Set(value.map((item) => (item as string).trim()))];
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedSender(event)) {
    throw new Error("Blocked untrusted desktop IPC caller.");
  }
}

const codexWorkspaceSyncControllers = new Map<string, AbortController>();

function secureHandle<T extends unknown[]>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: T) => unknown,
): void {
  ipcMain.handle(channel, async (event, ...args: T) => {
    assertTrustedSender(event);
    if (channel.startsWith("desktop:diagnostics-")) return handler(event, ...args);
    const target = classifyDiagnosticChannel(channel);
    const propagated = extractDiagnosticContext(args[0]);
    const operation = await desktopDiagnostics.start({
      traceId: propagated.traceId,
      parentSpanId: propagated.spanId ?? propagated.parentSpanId,
      module: target.module,
      component: target.component,
      operation: channel,
      message: `${channel} started`,
      attributes: { argumentCount: args.length },
    });
    const waitTimer = setTimeout(() => {
      void operation.wait(`${channel} is still running`, { waitMs: 10_000 });
    }, 10_000);
    try {
      const result = await runWithDiagnosticContext({
        traceId: operation.traceId,
        spanId: operation.spanId,
        ...(propagated.spanId ?? propagated.parentSpanId ? { parentSpanId: propagated.spanId ?? propagated.parentSpanId } : {}),
        ...(propagated.sessionId ? { sessionId: propagated.sessionId } : {}),
        ...(propagated.runId ? { runId: propagated.runId } : {}),
        ...(propagated.workspaceId ? { workspaceId: propagated.workspaceId } : {}),
      }, () => Promise.resolve(handler(event, ...args)));
      await operation.complete(`${channel} completed`);
      return result;
    } catch (error) {
      await operation.fail(error);
      throw error;
    } finally {
      clearTimeout(waitTimer);
    }
  });
}

const mobilePairingControllers = new Map<number, MobilePairingController>();
let mobilePairingRuntimeRepair: Promise<LocalRuntimeClient> | null = null;

function isMobilePairingRegistrationRequired(reason: unknown): reason is { state: string } {
  return Boolean(reason && typeof reason === "object"
    && "state" in reason
    && (reason.state === "not_registered" || reason.state === "credential_invalid"));
}

function mobilePairingRelayBaseUrl(issuer?: string): string {
  const configured = process.env.OPENDRSAI_RUNTIME_RELAY_BASE_URL?.trim().replace(/\/+$/, "");
  let issuerOrigin: string | undefined;
  if (!configured && issuer) {
    const parsedIssuer = new URL(issuer);
    if (parsedIssuer.protocol !== "https:"
      || parsedIssuer.port
      || !["ai.ihep.ac.cn", "ai-dev.ihep.ac.cn"].includes(parsedIssuer.hostname)
      || parsedIssuer.username || parsedIssuer.password) {
      throw new Error("mobile_pairing_oidc_issuer_not_trusted");
    }
    issuerOrigin = parsedIssuer.origin;
  }
  const value = configured || `${issuerOrigin || (is.dev ? "https://ai-dev.ihep.ac.cn" : "https://ai.ihep.ac.cn")}/api/runtime-relay`;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:"
    || parsed.port
    || !["ai.ihep.ac.cn", "ai-dev.ihep.ac.cn"].includes(parsed.hostname)
    || parsed.pathname.replace(/\/+$/, "") !== "/api/runtime-relay"
    || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("mobile_pairing_relay_url_not_trusted");
  }
  return `${parsed.origin}/api/runtime-relay`;
}

async function issueMobilePairingRegistrationCode(): Promise<{ code: string; relayBaseUrl: string }> {
  let auth = await requireAuthContext();
  if (auth.authMode !== "oidc" || !auth.accessToken) {
    throw new Error("mobile_pairing_oidc_login_required");
  }
  const relayBaseUrl = mobilePairingRelayBaseUrl(auth.issuer);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15_000);
  try {
    const request = (accessToken: string): Promise<Response> => fetch(`${relayBaseUrl}/v1/registration-codes`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        redirect: "error",
        signal: abort.signal,
      });
    let response = await request(auth.accessToken);
    let errorCode = response.ok ? null : await mobilePairingRelayErrorCode(response);
    if (response.status === 401 && errorCode !== "device_proof_required") {
      auth = await refreshAuthContextAfterUnauthorized();
      if (auth.authMode !== "oidc" || !auth.accessToken) {
        throw new Error("mobile_pairing_oidc_login_required");
      }
      response = await request(auth.accessToken);
      errorCode = response.ok ? null : await mobilePairingRelayErrorCode(response);
    }
    if (!response.ok) {
      if (errorCode === "device_proof_required") {
        throw new Error("mobile_pairing_registration_device_proof_misconfigured");
      }
      throw new Error(response.status === 401
        ? "mobile_pairing_oidc_session_rejected"
        : `mobile_pairing_registration_code_failed:${response.status}`);
    }
    const body = await response.json() as Record<string, unknown>;
    const code = typeof body.registration_code === "string" ? body.registration_code.trim() : "";
    if (code.length < 16 || code.length > 2_048 || /[\r\n\0]/.test(code)) {
      throw new Error("mobile_pairing_registration_code_invalid");
    }
    return { code, relayBaseUrl };
  } finally {
    clearTimeout(timer);
  }
}

async function mobilePairingRelayErrorCode(response: Response): Promise<string | null> {
  try {
    const body = await response.clone().json() as Record<string, unknown>;
    const detail = body.detail && typeof body.detail === "object"
      ? body.detail as Record<string, unknown>
      : body;
    return typeof detail.code === "string" && /^[a-z][a-z0-9_]{1,63}$/.test(detail.code)
      ? detail.code
      : null;
  } catch {
    return null;
  }
}

function isMissingMobilePairingRuntimeRoute(reason: unknown): boolean {
  return reason instanceof RemoteProtocolError
    && reason.status === 404
    && reason.code === "http_404"
    && /^not found\.?$/i.test(reason.message.trim());
}

async function repairMobilePairingRuntime(
  sender: WebContents,
  reason: unknown,
): Promise<LocalRuntimeClient | null> {
  if (!isMissingMobilePairingRuntimeRoute(reason) && !isMobilePairingRegistrationRequired(reason)) return null;
  if (getGatewayStartupMode() === "external") {
    throw new Error("mobile_pairing_runtime_external_update_required");
  }
  if (mobilePairingRuntimeRepair) return mobilePairingRuntimeRepair;

  mobilePairingRuntimeRepair = (async () => {
    let client: LocalRuntimeClient;
    if (isMissingMobilePairingRuntimeRoute(reason)) {
      // A healthy persistent Runtime can belong to the previous Desktop release.
      // Stop it before reinstalling the signed/bundled backend so Windows does not
      // keep serving an old FastAPI route table from memory.
      await stopGateway();
      await startInstall(sender, { installPrerequisites: false });
      if (!(await startGateway())) throw new Error("mobile_pairing_runtime_repair_failed");
      client = await LocalRuntimeClient.connect();
    } else {
      client = await LocalRuntimeClient.connect();
    }

    let readiness;
    try {
      readiness = await client.getMobilePairingReadiness();
    } catch (verificationError) {
      if (isMissingMobilePairingRuntimeRoute(verificationError)) {
        throw new Error("mobile_pairing_runtime_repair_failed");
      }
      throw verificationError;
    }
    if (!isMobilePairingRegistrationRequired(readiness)) return client;

    const { code: registrationCode, relayBaseUrl } = await issueMobilePairingRegistrationCode();
    await client.registerMobilePairingRuntime({
      registrationCode,
      relayHttpsUrl: relayBaseUrl,
      displayName: hostname()
        .trim()
        .replace(/[^A-Za-z0-9._-]/g, "-")
        .slice(0, 64) || "Windows",
    });

    // Registration is persisted by Runtime. Restart once so its outbound WSS
    // connector starts with the new DPAPI-protected credential.
    await stopGateway();
    if (!(await startGateway())) throw new Error("mobile_pairing_runtime_restart_failed");
    const registered = await LocalRuntimeClient.connect();
    const verified = await registered.getMobilePairingReadiness();
    if (verified.state !== "ready") throw new Error("mobile_pairing_runtime_registration_failed");
    return registered;
  })().finally(() => {
    mobilePairingRuntimeRepair = null;
  });
  return mobilePairingRuntimeRepair;
}

function mobilePairingControllerFor(sender: WebContents): MobilePairingController {
  const existing = mobilePairingControllers.get(sender.id);
  if (existing) return existing;
  const controller = new MobilePairingController(
    () => LocalRuntimeClient.connect(),
    (reason) => repairMobilePairingRuntime(sender, reason),
  );
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

function classifyDiagnosticChannel(channel: string): { module: string; component: string } {
  if (channel.includes("codex")) return { module: "backend", component: "codex-adapter" };
  if (channel.includes("gateway")) return { module: "runtime", component: "gateway" };
  if (channel.includes("ssh") || channel.includes("remote")) return { module: "workspace", component: "ssh-transport" };
  if (channel.includes("terminal")) return { module: "workspace", component: "terminal" };
  if (channel.includes("workspace") || channel.includes("worktree")) return { module: "workspace", component: "workspace-operation" };
  if (channel.includes("chat") || channel.includes("agent-run")) return { module: "runtime", component: "runtime-engine" };
  if (channel.includes("browser")) return { module: "tool", component: "browser" };
  if (channel.includes("voice")) return { module: "tool", component: "voice" };
  if (channel.includes("mcp")) return { module: "tool", component: "mcp" };
  return { module: "desktop", component: "electron-main" };
}

const a5ScenarioKinds: DesktopBootstrapBlockerKind[] = [
  "auth_required",
  "service_unavailable",
  "runtime_missing",
  "permission_denied",
];

function getA5ServiceGuidanceScenario(): DesktopA5ServiceGuidanceScenario | null {
  if (process.env.OPENDRSAI_E2E_A5_SERVICE_GUIDANCE !== "1") return null;
  const kind = process.env.OPENDRSAI_A5_SERVICE_GUIDANCE_SCENARIO as DesktopBootstrapBlockerKind | undefined;
  if (!kind || !a5ScenarioKinds.includes(kind)) return null;

  const authenticated = kind !== "auth_required";
  const titleByKind: Record<DesktopBootstrapBlockerKind, string> = {
    auth_required: "Sign in required",
    service_unavailable: "Service unavailable",
    runtime_missing: "Local runtime needs repair",
    permission_denied: "Account has no available service",
  };
  const diagnosticFixture = [
    `A5 E2E ${kind}`,
    "Bearer secret-a5-bearer-token",
    "api_key=secret-a5-api-key",
    "Cookie: session=secret-a5-cookie",
    "operator@example.test",
    "C:\\Users\\win11\\OpenDrSai\\private",
  ].join(" | ");

  return {
    kind,
    message: diagnosticFixture,
    session: authenticated
      ? {
          authenticated: true,
          user: {
            id: "a5-e2e-user",
            email: "a5-e2e-user@example.test",
            name: "A5 E2E User",
            role: "user",
          },
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          authMode: "oidc",
          authProvider: "ihep",
          accessTokenExpiresAt: new Date(Date.now() + 1_800_000).toISOString(),
          refreshable: false,
        }
      : {
          authenticated: false,
          user: null,
          expiresAt: null,
          authMode: null,
          authProvider: null,
          accessTokenExpiresAt: null,
          refreshable: false,
        },
    blocker: {
      kind,
      title: titleByKind[kind],
      message: diagnosticFixture,
      retryable: kind !== "auth_required",
      canRepairRuntime: kind === "runtime_missing",
      canSignInAgain: kind === "auth_required" || kind === "permission_denied",
      diagnosticCode: `a5-e2e-${kind}`,
    },
  };
}

function isAllowedLocalPath(rawPath: unknown): boolean {
  if (typeof rawPath !== "string" || !rawPath) return false;
  if (!existsSync(rawPath)) return false;
  const target = realpathSync.native(resolve(rawPath));
  return [DRSAI_HOME, DRSAI_REPO].some((allowedRoot) => {
    if (!existsSync(allowedRoot)) return false;
    const root = realpathSync.native(resolve(allowedRoot));
    const localRelative = relative(root, target);
    return localRelative === ""
      || (!localRelative.startsWith("..") && !isAbsolute(localRelative));
  });
}

async function runPhase3LiveAcceptance(nonce: string): Promise<void> {
  if (phase3LiveAcceptanceProcess && phase3LiveAcceptanceProcess.exitCode === null) {
    console.warn("[desktop] Ignored overlapping Phase 3 live acceptance request.");
    return;
  }
  try {
    const auth = await requireAuthContext();
    if (auth.authMode !== "oidc" || !auth.accessToken) {
      throw new Error("A current OIDC Desktop session is required.");
    }
    const verifier = resolve(
      DRSAI_REPO,
      "apps/desktop/windows/scripts/verify-run-traceability-phase3-live-model.mjs",
    );
    if (!existsSync(verifier)) throw new Error("The trusted Phase 3 verifier is unavailable.");
    const child = spawn(
      process.execPath,
      [verifier, "--delegated-oidc", `--invocation-nonce=${nonce}`],
      {
        cwd: DRSAI_REPO,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["pipe", "ignore", "ignore"],
        windowsHide: true,
      },
    );
    phase3LiveAcceptanceProcess = child;
    child.once("error", () => {
      if (phase3LiveAcceptanceProcess === child) phase3LiveAcceptanceProcess = null;
      console.warn("[desktop] Phase 3 live acceptance process could not start.");
    });
    child.once("exit", (code) => {
      if (phase3LiveAcceptanceProcess === child) phase3LiveAcceptanceProcess = null;
      if (code !== 0) console.warn(`[desktop] Phase 3 live acceptance exited with code ${code ?? "unknown"}.`);
    });
    // The access token is transferred once over an anonymous pipe. It never
    // appears in argv, the environment, a file, or Desktop diagnostics.
    child.stdin.end(auth.accessToken, "utf8");
  } catch (error) {
    console.warn(
      "[desktop] Phase 3 live acceptance could not use the current session:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function validateMobileRuntimeDisplayName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 64 || /[\\/\0]/.test(normalized)
    || normalized.includes("://") || isAbsolute(normalized) || isIP(normalized.replace(/^\[|\]$/g, "")) !== 0) {
    throw new Error("runtime_display_name_invalid");
  }
  return normalized;
}

async function renameMobileRuntime(displayName: string): Promise<{ runtime_id: string; display_name: string }> {
  const safeName = validateMobileRuntimeDisplayName(displayName);
  const runtime = await LocalRuntimeClient.connect();
  const readiness = await runtime.getMobilePairingReadiness();
  if (!readiness.runtime_id) throw new Error("mobile_pairing_runtime_not_registered");
  let auth = await requireAuthContext();
  if (auth.authMode !== "oidc" || !auth.accessToken) throw new Error("mobile_pairing_oidc_login_required");
  const relayBaseUrl = mobilePairingRelayBaseUrl(auth.issuer);
  const request = (accessToken: string): Promise<Response> => fetch(
    `${relayBaseUrl}/v1/runtimes/${encodeURIComponent(readiness.runtime_id!)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ display_name: safeName }),
      redirect: "error",
    },
  );
  let response = await request(auth.accessToken);
  if (response.status === 401) {
    auth = await refreshAuthContextAfterUnauthorized();
    if (auth.authMode !== "oidc" || !auth.accessToken) throw new Error("mobile_pairing_oidc_login_required");
    response = await request(auth.accessToken);
  }
  if (!response.ok) throw new Error(`mobile_runtime_rename_failed:${response.status}`);
  const body = await response.json() as Record<string, unknown>;
  if (body.runtime_id !== readiness.runtime_id || body.display_name !== safeName) {
    throw new Error("mobile_runtime_rename_response_invalid");
  }
  return { runtime_id: readiness.runtime_id, display_name: safeName };
}

async function diagnoseMobileRemoteAccess() {
  let runtimeResult: Awaited<ReturnType<LocalRuntimeClient["getMobileRemoteDiagnostics"]>> | null = null;
  try {
    runtimeResult = await (await LocalRuntimeClient.connect()).getMobileRemoteDiagnostics();
  } catch {
    return classifyMobileRemoteDiagnostics({
      runtime: "failed", relay: "unknown", oidc: "unknown", wss: "unknown", heartbeat: "unknown", protocol: "unknown",
    });
  }
  let oidc: "ok" | "failed" = "failed";
  try {
    const auth = await requireAuthContext();
    oidc = auth.authMode === "oidc" && Boolean(auth.accessToken) ? "ok" : "failed";
  } catch {
    oidc = "failed";
  }
  return classifyMobileRemoteDiagnostics({ ...runtimeResult.checks, oidc });
}

async function isAllowedOpenPath(rawPath: unknown): Promise<boolean> {
  if (isAllowedLocalPath(rawPath)) return true;
  if (typeof rawPath !== "string" || !rawPath || !existsSync(rawPath))
    return false;
  const target = realpathSync.native(resolve(rawPath));
  const workspaces = await listWorkspaces();
  return workspaces.some((workspace) => {
    if (!existsSync(workspace.path)) return false;
    const root = realpathSync.native(resolve(workspace.path));
    const relativePath = relative(root, target);
    return (
      relativePath === "" ||
      (!relativePath.startsWith("..") && !isAbsolute(relativePath))
    );
  });
}

async function openPdfSourcePage(request: PdfPageOpenRequest): Promise<PdfPageOpenResult> {
  const rawPath = typeof request?.path === "string" ? request.path : "";
  const page = Number(request?.page);
  if (!(await isAllowedOpenPath(rawPath))) {
    throw new Error("PDF source path is not registered as an OpenDrSai or workspace path.");
  }
  if (extname(rawPath).toLowerCase() !== ".pdf") {
    throw new Error("Source page review requires a PDF file.");
  }
  if (!Number.isInteger(page) || page < 1 || page > 10000) {
    throw new Error("Source page must be a positive PDF page number.");
  }

  const resolvedPath = realpathSync.native(resolve(rawPath));
  const viewerUrl = pathToFileURL(resolvedPath);
  viewerUrl.hash = `page=${page}&zoom=page-width`;

  if (!isE2eSmokeProcess) {
    setImmediate(() => {
      void shell.openExternal(viewerUrl.href).catch((error) => {
        console.error(`Unable to open PDF source page ${page}:`, error);
      });
    });
  }
  return {
    ok: true,
    path: resolvedPath,
    page,
    viewerUrl: viewerUrl.href,
  };
}

async function hashSavedFile(path: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectHash);
    stream.on("end", () => resolveHash(`sha256:${hash.digest("hex")}`));
  });
}

let e2eArtifactSaveCount = 0;

function ensureOriginalExtension(path: string, sourceExtension: string): string {
  if (!sourceExtension) return path;
  const currentExtension = extname(path);
  if (currentExtension.toLowerCase() === sourceExtension.toLowerCase()) return path;
  return currentExtension
    ? `${path.slice(0, -currentExtension.length)}${sourceExtension}`
    : `${path}${sourceExtension}`;
}

async function saveWorkspaceFileAs(request: WorkspaceFileSaveAsRequest): Promise<WorkspaceFileSaveAsResult> {
  if (!request || typeof request !== "object") throw new Error("A save request is required.");
  if (typeof request.workspacePath !== "string" || !request.workspacePath.trim()) throw new Error("A workspace is required.");
  if (typeof request.path !== "string" || !request.path.trim()) throw new Error("A source file is required.");
  const preview = await previewWorkspaceFile({ workspacePath: request.workspacePath, path: request.path, maxBytes: 8_000 });
  const sourceExtension = extname(preview.name).toLowerCase();
  const requestedName = typeof request.suggestedName === "string" && request.suggestedName.trim()
    ? basename(request.suggestedName.trim())
    : preview.name;
  const suggestedName = ensureOriginalExtension(requestedName, sourceExtension);
  let destinationPath: string | undefined;

  const automatedSaveDirectory = isE2eSmokeProcess && process.env.OPENDRSAI_E2E_AGENT_RUN_SCENARIO === "g4-preview-download"
    ? process.env.OPENDRSAI_E2E_G4_SAVE_DIR
    : undefined;
  if (automatedSaveDirectory) {
    e2eArtifactSaveCount += 1;
    destinationPath = join(resolve(automatedSaveDirectory), `${String(e2eArtifactSaveCount).padStart(2, "0")}-${suggestedName}`);
    await mkdir(dirname(destinationPath), { recursive: true });
  } else if (request.destinationPath !== undefined) {
    if (!isE2eSmokeProcess) throw new Error("A direct save destination is only available to packaged acceptance tests.");
    if (typeof request.destinationPath !== "string" || !isAbsolute(request.destinationPath)) {
      throw new Error("The acceptance-test save destination must be an absolute path.");
    }
    destinationPath = ensureOriginalExtension(resolve(request.destinationPath), sourceExtension);
    await mkdir(dirname(destinationPath), { recursive: true });
  } else {
    const options = {
      title: "Save result as",
      defaultPath: join(app.getPath("downloads"), suggestedName),
      buttonLabel: "Save",
      ...(sourceExtension ? { filters: [{ name: `${sourceExtension.slice(1).toUpperCase()} file`, extensions: [sourceExtension.slice(1)] }] } : {}),
    };
    const selected = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    if (selected.canceled || !selected.filePath) {
      return {
        canceled: true,
        sourcePath: preview.path,
        name: suggestedName,
        extension: sourceExtension,
        size: preview.size,
        sourceHash: preview.fileHash || await hashSavedFile(preview.path),
        integrityVerified: false,
        message: "Save canceled; the source result was not changed.",
      };
    }
    destinationPath = ensureOriginalExtension(resolve(selected.filePath), sourceExtension);
  }

  await copyFile(preview.path, destinationPath);
  const [savedStat, sourceHash, destinationHash] = await Promise.all([
    statFile(destinationPath),
    preview.fileHash ? Promise.resolve(preview.fileHash) : hashSavedFile(preview.path),
    hashSavedFile(destinationPath),
  ]);
  const integrityVerified = savedStat.isFile() && savedStat.size === preview.size && destinationHash === sourceHash;
  if (!integrityVerified) throw new Error("The saved copy failed the automatic size or SHA-256 integrity check.");
  return {
    canceled: false,
    sourcePath: preview.path,
    destinationPath,
    name: basename(destinationPath),
    extension: extname(destinationPath).toLowerCase(),
    size: savedStat.size,
    sourceHash,
    destinationHash,
    integrityVerified: true,
    message: "Saved copy verified by file size and SHA-256.",
  };
}

async function writeWorkspaceFile(request: WorkspaceFileWriteRequest): Promise<WorkspaceFileWriteResult> {
  if (!request || typeof request !== "object") throw new Error("A protected write request is required.");
  if (typeof request.workspacePath !== "string" || !request.workspacePath.trim()) throw new Error("A workspace is required.");
  if (typeof request.path !== "string" || !request.path.trim()) throw new Error("A target file is required.");
  if (typeof request.content !== "string" || Buffer.byteLength(request.content, "utf8") > 1_000_000) throw new Error("Protected text writes are limited to 1 MB.");
  if (typeof request.expectedHash !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(request.expectedHash)) throw new Error("The hash from the last read is required.");
  if (!(await isAllowedOpenPath(request.workspacePath))) throw new Error("The workspace is not registered or allowed.");
  const preview = await previewWorkspaceFile({ workspacePath: request.workspacePath, path: request.path, maxBytes: 8_000 });
  const currentHash = preview.fileHash || await hashSavedFile(preview.path);
  const mode = request.mode === "save_as" || request.mode === "overwrite" ? request.mode : "save";

  if (mode !== "save_as" && currentHash !== request.expectedHash) {
    return {
      status: "conflict",
      path: preview.path,
      expectedHash: request.expectedHash,
      currentHash,
      savedAs: false,
      overwroteExternal: false,
      externalModifiedAt: preview.modifiedAt,
      externalSize: preview.size,
      message: "The file changed after it was read. Nothing was overwritten.",
    };
  }

  let destinationPath = preview.path;
  if (mode === "save_as") {
    const sourceExtension = extname(preview.name).toLowerCase();
    const requestedName = typeof request.suggestedName === "string" && request.suggestedName.trim()
      ? basename(request.suggestedName.trim())
      : `${basename(preview.name, sourceExtension)}-my-version${sourceExtension}`;
    const suggestedName = ensureOriginalExtension(requestedName, sourceExtension);
    const automatedSaveDirectory = isE2eSmokeProcess && process.env.OPENDRSAI_E2E_AGENT_RUN_SCENARIO === "i6-external-conflict"
      ? process.env.OPENDRSAI_E2E_I6_SAVE_DIR
      : undefined;
    if (automatedSaveDirectory) {
      destinationPath = join(resolve(automatedSaveDirectory), suggestedName);
      await mkdir(dirname(destinationPath), { recursive: true });
    } else if (request.destinationPath !== undefined) {
      if (!isE2eSmokeProcess || typeof request.destinationPath !== "string" || !isAbsolute(request.destinationPath)) throw new Error("A direct destination is only available to packaged acceptance tests.");
      destinationPath = ensureOriginalExtension(resolve(request.destinationPath), sourceExtension);
      await mkdir(dirname(destinationPath), { recursive: true });
    } else {
      const selected = mainWindow
        ? await dialog.showSaveDialog(mainWindow, { title: "Save my version as", defaultPath: join(app.getPath("downloads"), suggestedName), buttonLabel: "Save my version" })
        : await dialog.showSaveDialog({ title: "Save my version as", defaultPath: join(app.getPath("downloads"), suggestedName), buttonLabel: "Save my version" });
      if (selected.canceled || !selected.filePath) {
        return { status: "canceled", path: preview.path, expectedHash: request.expectedHash, currentHash, savedAs: false, overwroteExternal: false, message: "Save as canceled; the external file was not changed." };
      }
      destinationPath = ensureOriginalExtension(resolve(selected.filePath), sourceExtension);
    }
    if (resolve(destinationPath).toLowerCase() === resolve(preview.path).toLowerCase()) throw new Error("Save as must use a different path so the external version remains intact.");
  }

  await writeFile(destinationPath, request.content, "utf8");
  const savedHash = await hashSavedFile(destinationPath);
  return {
    status: "saved",
    path: preview.path,
    expectedHash: request.expectedHash,
    currentHash,
    savedHash,
    destinationPath,
    savedAs: mode === "save_as",
    overwroteExternal: mode === "overwrite",
    message: mode === "save_as"
      ? "Saved the draft to a new file; the external version remains unchanged."
      : mode === "overwrite"
        ? "Explicit choice applied; the external version was overwritten after a fresh hash check."
        : "Saved after confirming the file still matched the last read.",
  };
}

function parseDecisionCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"') {
      if (quoted && content[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell); cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((candidate) => candidate.some((value) => value.length > 0));
}

function serializeDecisionCsv(rows: string[][]): string {
  return `${rows.map((row) => row.map((cell) => /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell).join(",")).join("\r\n")}\r\n`;
}

function isDecisionAnomaly(value: string): boolean {
  return /^(?:true|1|yes|y|anomaly|异常)$/i.test(value.trim());
}

async function applyAnomalyDecision(request: DesktopAnomalyDecisionApplyRequest): Promise<DesktopAnomalyDecisionApplyResult> {
  if (!request || typeof request !== "object") throw new Error("An anomaly-data decision request is required.");
  if (typeof request.workspacePath !== "string" || !request.workspacePath.trim()) throw new Error("A workspace is required.");
  if (typeof request.sourcePath !== "string" || !request.sourcePath.trim()) throw new Error("A source CSV is required.");
  if (typeof request.anomalyColumn !== "string" || !request.anomalyColumn.trim()) throw new Error("An anomaly column is required.");
  if (!(["keep", "exclude", "both"] as const).includes(request.decision)) throw new Error("Choose keep, exclude, or both.");
  if (!(await isAllowedOpenPath(request.workspacePath))) throw new Error("The workspace is not registered or allowed.");

  const preview = await previewWorkspaceFile({ workspacePath: request.workspacePath, path: request.sourcePath, maxBytes: 1_000_000 });
  if (extname(preview.path).toLowerCase() !== ".csv") throw new Error("Anomaly-data decisions currently require a CSV source.");
  const sourceContent = await import("fs/promises").then(({ readFile }) => readFile(preview.path, "utf8"));
  const rows = parseDecisionCsv(sourceContent);
  if (rows.length < 2) throw new Error("The source CSV does not contain any data rows.");
  const headers = rows[0].map((value) => value.trim());
  const anomalyIndex = headers.findIndex((value) => value.toLowerCase() === request.anomalyColumn.trim().toLowerCase());
  if (anomalyIndex < 0) throw new Error(`The anomaly column “${request.anomalyColumn}” was not found.`);
  const dataRows = rows.slice(1);
  const anomalyRows = dataRows.filter((row) => isDecisionAnomaly(row[anomalyIndex] || ""));
  const normalRows = dataRows.filter((row) => !isDecisionAnomaly(row[anomalyIndex] || ""));
  const sourceSha256 = `sha256:${createHash("sha256").update(sourceContent).digest("hex")}`;
  const base = basename(preview.path, extname(preview.path));
  const outputDirectory = dirname(preview.path);
  const outputSpecs = request.decision === "keep"
    ? [{ role: "kept_all" as const, path: join(outputDirectory, `${base}-保留全部.csv`), rows: dataRows }]
    : request.decision === "exclude"
      ? [{ role: "excluded_anomalies" as const, path: join(outputDirectory, `${base}-排除异常.csv`), rows: normalRows }]
      : [
          { role: "kept_all" as const, path: join(outputDirectory, `${base}-保留全部.csv`), rows: dataRows },
          { role: "excluded_anomalies" as const, path: join(outputDirectory, `${base}-排除异常.csv`), rows: normalRows },
        ];
  const outputs: DesktopAnomalyDecisionApplyResult["outputs"] = [];
  for (const output of outputSpecs) {
    const content = serializeDecisionCsv([rows[0], ...output.rows]);
    await writeFile(output.path, content, "utf8");
    outputs.push({
      role: output.role,
      path: output.path,
      rowCount: output.rows.length,
      anomalyCount: output.rows.filter((row) => isDecisionAnomaly(row[anomalyIndex] || "")).length,
      sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    });
  }
  const decidedAt = new Date().toISOString();
  const resultSummary = request.decision === "keep"
    ? `已采用“保留异常”：输出 ${dataRows.length} 行，其中异常 ${anomalyRows.length} 行。`
    : request.decision === "exclude"
      ? `已采用“排除异常”：输出 ${normalRows.length} 行，异常 0 行；原始数据未改动。`
      : `已采用“两种都做”：分别输出保留版 ${dataRows.length} 行和排除版 ${normalRows.length} 行；原始数据未改动。`;
  const receiptPath = join(outputDirectory, `${base}-异常处理决定.json`);
  const result: DesktopAnomalyDecisionApplyResult = {
    sourcePath: preview.path,
    anomalyColumn: request.anomalyColumn.trim(),
    totalRows: dataRows.length,
    anomalyRows: anomalyRows.length,
    normalRows: normalRows.length,
    decision: request.decision,
    decidedAt,
    resultSummary,
    sourceSha256,
    receiptPath,
    outputs,
  };
  await writeFile(receiptPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

// Kept temporarily for legacy source-verification scripts; runtime IPC uses the shared implementation above.
void applyAnomalyDecision;

const PICKED_FILE_CATEGORIES: Array<{ extensions: ReadonlySet<string>; category: PickedFileDescriptor["category"] }> = [
  { extensions: new Set([".pdf"]), category: "pdf" },
  { extensions: new Set([".doc", ".docx"]), category: "word" },
  { extensions: new Set([".xls", ".xlsx"]), category: "spreadsheet" },
  { extensions: new Set([".csv", ".tsv"]), category: "table" },
  { extensions: new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"]), category: "image" },
  { extensions: new Set([".ppt", ".pptx"]), category: "presentation" },
  { extensions: new Set([".txt", ".md", ".json", ".yaml", ".yml", ".html", ".htm"]), category: "text" },
];

const LARGE_PICKED_FILE_BYTES = 32 * 1024 * 1024;
const PICKED_FILE_INSPECTION_TIMEOUT_MS = 15_000;

type PickedFileInspection = Pick<PickedFileDescriptor, "status" | "message" | "diagnosticCode" | "processingMode" | "recoveryAction" | "sensitiveDataDetected" | "sensitiveKinds" | "sensitiveValueCount" | "privacyNotice">;

async function inspectPickedFile(path: string, category: PickedFileDescriptor["category"], extension: string): Promise<PickedFileInspection> {
  if (category === "other") return {
    status: "unsupported", diagnosticCode: "unsupported_format", processingMode: "blocked",
    message: "暂不支持这种文件格式；其他已选文件仍可使用。",
    recoveryAction: "请转换为 PDF、Word、Excel、CSV、图片或文本后重新导入。",
  };
  const handle = await openFile(path, "r");
  try {
    const info = await handle.stat();
    const head = Buffer.alloc(Math.min(16, info.size));
    if (head.length) await handle.read(head, 0, head.length, 0);
    const signatureValid = extension === ".pdf"
      ? head.toString("ascii").startsWith("%PDF-")
      : [".docx", ".xlsx", ".pptx"].includes(extension)
        ? head[0] === 0x50 && head[1] === 0x4b
        : [".doc", ".xls", ".ppt"].includes(extension)
          ? head.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))
          : extension === ".png"
            ? head.subarray(1, 4).toString("ascii") === "PNG"
            : true;
    if ([".docx", ".xlsx", ".pptx"].includes(extension) && head.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) return {
      status: "unreadable", diagnosticCode: "password_protected", processingMode: "blocked",
      message: "这个 Office 文件可能受密码保护，当前无法读取内容。",
      recoveryAction: "请在 Office 中解除密码保护并另存一份副本，再重新导入。",
    };
    if (!signatureValid) return {
      status: "unreadable", diagnosticCode: "corrupt_file", processingMode: "blocked",
      message: "文件内容与扩展名不一致，可能已损坏或下载不完整。",
      recoveryAction: "请重新下载或用原应用打开并另存一份副本，然后重新导入。",
    };
    if (extension === ".pdf" && info.size > 0) {
      const tailBytes = Math.min(info.size, 128 * 1024);
      const tail = Buffer.alloc(tailBytes);
      await handle.read(tail, 0, tailBytes, Math.max(0, info.size - tailBytes));
      if (/\/Encrypt\b/.test(tail.toString("latin1"))) return {
        status: "unreadable", diagnosticCode: "password_protected", processingMode: "blocked",
        message: "这个 PDF 受密码保护，当前无法安全读取内容。",
        recoveryAction: "请在 PDF 阅读器中输入密码后另存为不加密副本，再重新导入。",
      };
    }
    let privacy: Partial<PickedFileInspection> = {};
    if ((category === "text" || category === "table") && info.size > 0) {
      const scanBytes = Math.min(info.size, 256 * 1024);
      const scanBuffer = Buffer.alloc(scanBytes);
      await handle.read(scanBuffer, 0, scanBytes, 0);
      const matches = scanSensitiveText(scanBuffer.toString("utf8"), "local-import", basename(path));
      if (matches.length) {
        privacy = {
          sensitiveDataDetected: true,
          sensitiveKinds: [...new Set(matches.map((match) => match.kind))],
          sensitiveValueCount: matches.length,
          privacyNotice: `已在本地检测到 ${matches.length} 处敏感信息；原值不会显示在附件摘要中，分享前会要求确认并遮蔽。`,
        };
      }
    }
    if (info.size >= LARGE_PICKED_FILE_BYTES) return {
      status: "ready", diagnosticCode: "large_file", processingMode: "bounded",
      message: "大文件已就绪；为保持应用流畅，将先读取有代表性的内容，而不是一次加载全部数据。",
      recoveryAction: "可直接继续；如需逐页或全量分析，建议拆分文件后重新导入。",
      ...privacy,
    };
    return { status: "ready", processingMode: "full", message: "文件已读取并可加入任务。", ...privacy };
  } finally {
    await handle.close();
  }
}

async function inspectPickedFileWithTimeout(path: string, category: PickedFileDescriptor["category"], extension: string) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      inspectPickedFile(path, category, extension),
      new Promise<PickedFileInspection>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout({
          status: "unreadable", diagnosticCode: "inspection_timeout", processingMode: "blocked",
          message: "文件检查超过 15 秒，已停止等待，应用可以继续使用。",
          recoveryAction: "请确认磁盘或网络位置可访问，将文件复制到本地后重试。",
        }), PICKED_FILE_INSPECTION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function describePickedFiles(paths: string[], canceled: boolean): Promise<{ canceled: boolean; paths: string[]; files: PickedFileDescriptor[] }> {
  const files = await Promise.all(paths.map(async (path): Promise<PickedFileDescriptor> => {
    const extension = extname(path).toLowerCase();
    const category = PICKED_FILE_CATEGORIES.find((item) => item.extensions.has(extension))?.category ?? "other";
    const base = { path, name: basename(path), extension, category };
    try {
      const info = await statFile(path);
      if (!info.isFile()) return { ...base, status: "unreadable", diagnosticCode: "unreadable", processingMode: "blocked", message: "所选项目不是文件。", recoveryAction: "请选择一个可读取的本地文件。" };
      return { ...base, sizeBytes: info.size, ...(await inspectPickedFileWithTimeout(path, category, extension)) };
    } catch {
      return { ...base, status: "unreadable", diagnosticCode: "unreadable", processingMode: "blocked", message: "文件无法读取或已经被移动；其他已选文件仍可使用。", recoveryAction: "请检查文件权限和位置，或复制到本地后重新导入。" };
    }
  }));
  return { canceled, paths, files };
}

function registerIpc(): void {
  secureHandle("desktop:platform-descriptor", () => WINDOWS_PLATFORM_DESCRIPTOR);
  secureHandle("desktop:system-permissions-get", () => [
    { kind: "microphone", state: "unknown", canRequest: false, canOpenSettings: true, message: "Microphone access is controlled by Windows Settings." },
    { kind: "notifications", state: "unknown", canRequest: false, canOpenSettings: true, message: "Notification access is controlled by Windows Settings." },
    { kind: "files", state: "unknown", canRequest: false, canOpenSettings: true, message: "File access is controlled by Windows Settings." },
    { kind: "automation", state: "unknown", canRequest: false, canOpenSettings: false, message: "Automation access is managed per application." },
  ]);
  secureHandle("desktop:system-permission-request", async (_event, kind) => {
    const normalized = kind === "microphone" || kind === "notifications" || kind === "files" || kind === "automation" ? kind : "files";
    if (normalized !== "automation") await shell.openExternal(normalized === "microphone" ? "ms-settings:privacy-microphone" : normalized === "notifications" ? "ms-settings:notifications" : "ms-settings:privacy-broadfilesystemaccess");
    return { kind: normalized, state: "unknown", canRequest: false, canOpenSettings: normalized !== "automation", message: `${normalized} access is controlled by Windows Settings.` };
  });
  secureHandle("desktop:system-permission-settings", async (_event, kind) => {
    if (kind === "automation") return false;
    await shell.openExternal(kind === "microphone" ? "ms-settings:privacy-microphone" : kind === "notifications" ? "ms-settings:notifications" : "ms-settings:privacy-broadfilesystemaccess");
    return true;
  });
  registerBrowserController(new ElectronWebviewController());
  registerBrowserController(new BrowserUseController(browserUseWorkerClient));
  const diagnosticSourceNavigator = new DiagnosticSourceNavigator({
    appRoot: app.getAppPath(),
    listWorkspaces,
    previewLocal: previewWorkspaceFile,
    previewRemote: previewRemoteWorkspaceFile,
  });
  secureHandle("desktop:diagnostics-record", (_event, input: DiagnosticEventInput) =>
    desktopDiagnostics.record(input),
  );
  secureHandle("desktop:diagnostics-snapshot", (_event, query?: DiagnosticQuery) =>
    desktopDiagnostics.snapshot(query ?? {}),
  );
  secureHandle("desktop:diagnostics-clear", async () => {
    const removedEvents = await desktopDiagnostics.clear();
    return { cleared: true, removedEvents };
  });
  secureHandle("desktop:diagnostics-export", async () => {
    const snapshot = await desktopDiagnostics.snapshot({ limit: 5_000 });
    const options = {
      title: "Export OpenDrSai diagnostics",
      defaultPath: join(app.getPath("downloads"), `opendrsai-diagnostics-${Date.now()}.json`),
      buttonLabel: "Export",
      filters: [{ name: "JSON", extensions: ["json"] }],
    };
    const selected = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    if (selected.canceled || !selected.filePath) {
      return { exported: false, eventCount: snapshot.events.length, message: "Diagnostic export cancelled." };
    }
    await writeFile(selected.filePath, await desktopDiagnostics.serializeExport(), "utf8");
    return { exported: true, path: selected.filePath, eventCount: snapshot.events.length, message: "Diagnostic package exported." };
  });
  secureHandle("desktop:diagnostics-source-context", (_event, request: DiagnosticSourceContextRequest) =>
    diagnosticSourceNavigator.context(request),
  );
  secureHandle("desktop:diagnostics-source-open", async (_event, request: DiagnosticSourceOpenRequest) => {
    const resolved = await diagnosticSourceNavigator.resolveOpenPath(request);
    if (!resolved.path) return { opened: false, ...resolved };
    if (process.env.OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN === "1") {
      return { opened: true, ...resolved, message: "Source open suppressed by the E2E environment." };
    }
    if (request.target === "reveal") {
      shell.showItemInFolder(resolved.path);
      return { opened: true, ...resolved, message: "Source file revealed in the system file manager." };
    }
    if (request.target === "editor") {
      const editor = process.env.OPENDRSAI_SOURCE_EDITOR?.trim();
      if (!editor) return { opened: false, ...resolved, message: "No external source editor is configured. Set OPENDRSAI_SOURCE_EDITOR to enable this action." };
      let templates = ["-g", "{file}:{line}:{column}"];
      try {
        const configured = JSON.parse(process.env.OPENDRSAI_SOURCE_EDITOR_ARGS || "null");
        if (Array.isArray(configured) && configured.every((item) => typeof item === "string")) templates = configured.slice(0, 20);
      } catch {
        return { opened: false, ...resolved, message: "OPENDRSAI_SOURCE_EDITOR_ARGS must be a JSON string array." };
      }
      const substitutions: Record<string, string> = {
        "{file}": resolved.path,
        "{line}": String(resolved.line ?? 1),
        "{column}": String(resolved.column ?? 1),
      };
      const args = templates.map((template) => Object.entries(substitutions).reduce((value, [token, replacement]) => value.replaceAll(token, replacement), template));
      try {
        await new Promise<void>((resolveLaunch, rejectLaunch) => execFile(editor, args, { windowsHide: true, timeout: 10_000 }, (error) => error ? rejectLaunch(error) : resolveLaunch()));
        return { opened: true, ...resolved, message: "Source opened in the configured external editor." };
      } catch (error) {
        return { opened: false, ...resolved, message: `Configured source editor failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
    const error = await shell.openPath(resolved.path);
    return { opened: !error, ...resolved, message: error || "Source file opened with the system application." };
  });
  secureHandle("desktop:diagnostics-issue-update", (_event, request: DiagnosticIssueUpdateRequest) =>
    desktopDiagnostics.updateIssue(request),
  );
  secureHandle("desktop:interactive-debug-targets", () => interactiveDebugger.listTargets());
  secureHandle("desktop:interactive-debug-policy", () => interactiveDebugPolicy.get());
  secureHandle("desktop:interactive-debug-policy-update", async (_event, request) => {
    const policy = await interactiveDebugPolicy.update(request);
    if (!policy.enabled) await interactiveDebugger.shutdown();
    return policy;
  });
  secureHandle("desktop:interactive-debug-sessions", () => interactiveDebugger.listSessions());
  secureHandle("desktop:interactive-debug-start", (_event, request: InteractiveDebugStartRequest) => interactiveDebugger.start(request));
  secureHandle("desktop:interactive-debug-breakpoint", (_event, request: InteractiveDebugBreakpointRequest) => interactiveDebugger.setBreakpoint(request));
  secureHandle("desktop:interactive-debug-control", (_event, request: InteractiveDebugControlRequest) => interactiveDebugger.control(request));
  secureHandle("desktop:interactive-debug-scopes", (_event, sessionId: string, frameId: string) => interactiveDebugger.scopes(sessionId, frameId));
  secureHandle("desktop:interactive-debug-variables", (_event, sessionId: string, reference: string) => interactiveDebugger.variables(sessionId, reference));
  secureHandle("desktop:interactive-debug-evaluate", (_event, request: InteractiveDebugEvaluateRequest) => interactiveDebugger.evaluate(request));
  secureHandle("desktop:production-diagnostics-status", () => productionDiagnostics.status());
  secureHandle("desktop:production-diagnostics-settings", (_event, patch: Partial<ProductionDiagnosticSettings>) => productionDiagnostics.update(patch));
  secureHandle("desktop:production-diagnostics-preview", async () => productionDiagnostics.preview(await desktopDiagnostics.serializeExport()));
  secureHandle("desktop:production-diagnostics-export", async () => {
    const preview = await productionDiagnostics.preview(await desktopDiagnostics.serializeExport());
    const options = { title: "Export protected OpenDrSai diagnostic package", defaultPath: join(app.getPath("downloads"), `opendrsai-diagnostics-${Date.now()}.oddiag`), buttonLabel: "Export", filters: [{ name: "OpenDrSai diagnostics", extensions: ["oddiag"] }] };
    const selected = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (selected.canceled || !selected.filePath) return { ok: false, preview, message: "Diagnostic package export cancelled." };
    return productionDiagnostics.exportPackage(await desktopDiagnostics.serializeExport(), selected.filePath);
  });
  secureHandle("desktop:production-diagnostics-import", async () => {
    const options = { title: "Open OpenDrSai diagnostic package", properties: ["openFile"] as Array<"openFile">, filters: [{ name: "OpenDrSai diagnostics", extensions: ["oddiag"] }] };
    const selected = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (selected.canceled || !selected.filePaths[0]) return null;
    return productionDiagnostics.importPackage(selected.filePaths[0]);
  });
  secureHandle("desktop:get-auth-session", () => getAuthSession());
  secureHandle("desktop:e2e-a5-service-guidance-scenario", () =>
    getA5ServiceGuidanceScenario(),
  );
  secureHandle("desktop:login", (_event, request) => login(request));
  secureHandle("desktop:start-oidc-login", async (event, request) => {
    const result = await startOidcLogin(request, (debugEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("desktop:oidc-login-debug", debugEvent);
      }
    });
    if (result.ok) focusMainWindow();
    return result;
  });
  secureHandle("desktop:cancel-oidc-login", () => cancelOidcLogin());
  secureHandle("desktop:start-desktop-sso-login", () => startDesktopSsoLogin());
  secureHandle("desktop:start-wechat-desktop-login", () =>
    startWechatDesktopLogin(),
  );
  secureHandle("desktop:poll-desktop-sso-login", (_event, deviceCode: string) =>
    pollDesktopSsoLogin(deviceCode),
  );
  secureHandle(
    "desktop:cancel-desktop-sso-login",
    (_event, deviceCode: string) => cancelDesktopSsoLogin(deviceCode),
  );
  secureHandle("desktop:logout", (_event, options) => {
    stopGateway();
    return logout(options);
  });
  secureHandle("desktop:refresh-auth-session", () => refreshAuthSession());
  secureHandle("desktop:bootstrap", () => bootstrapDesktop());
  secureHandle("desktop:get-health", async () => {
    const health = await getDesktopHealth();
    desktopDiagnostics.registerHealth({
      id: "runtime:gateway",
      module: "runtime",
      component: "gateway",
      state: health.gatewayReady ? "running" : "disconnected",
      message: health.gatewayReady ? "Gateway is ready" : "Gateway is not ready",
      pid: health.gateway.pid ?? undefined,
      version: health.version ?? undefined,
      restartCount: 0,
      retryCount: 0,
    });
    return health;
  });
  secureHandle("desktop:get-install-status", () => getInstallStatus());
  secureHandle("desktop:get-gateway-status", async () => {
    const status = await getGatewayStatus();
    desktopDiagnostics.registerHealth({
      id: "runtime:gateway",
      module: "runtime",
      component: "gateway",
      state: status.ready ? "running" : "disconnected",
      message: status.ready ? "Gateway is ready" : (status.lastLog || "Gateway is not ready"),
      pid: status.pid ?? undefined,
      restartCount: 0,
      retryCount: 0,
    });
    return status;
  });
  secureHandle("desktop:get-codex-backend-status", async (_event, rawRefresh) => {
    const refresh = rawRefresh === true;
    let status;
    try {
      const client = await LocalRuntimeClient.connect();
      let capability = (await client.getCapabilities()).agent_backends?.codex;
      if (capability?.available) {
        await client.getBackendModels("codex", refresh);
        capability = (await client.getCapabilities()).agent_backends?.codex;
      }
      status = !capability?.available
        ? presentCodexBackendStatus(capability)
        : presentCodexBackendStatus(capability, await client.getBackendAccount("codex", refresh));
    } catch (error) {
      if (!isLocalRuntimeUnavailableError(error)) throw error;
      status = presentCodexBackendStatus({
        backend_id: "codex",
        available: false,
        reason: error.gatewayStatus.diagnosticCode || "runtime_unavailable",
      });
    }
    desktopDiagnostics.registerHealth({
      id: "backend:codex-adapter",
      module: "backend",
      component: "codex-adapter",
      state: status.available ? "running" : status.retryable ? "degraded" : "stopped",
      message: status.reason || (status.available ? "Codex backend is available" : "Codex backend is unavailable"),
      version: status.version ?? undefined,
      restartCount: 0,
      retryCount: 0,
      lastErrorCode: status.state === "fault" ? status.state : undefined,
    });
    return status;
  });
  secureHandle("desktop:start-codex-backend-login", async (_event, rawType) => {
    const type = rawType === "chatgptDeviceCode" ? "chatgptDeviceCode" : "chatgpt";
    const client = await LocalRuntimeClient.connect();
    const result = await client.startBackendLogin("codex", type);
    const externalUrl = result.authUrl ?? result.verificationUrl;
    if (externalUrl && isAllowedExternalUrl(externalUrl)) await shell.openExternal(externalUrl);
    return { type: result.type, loginId: result.loginId, verificationUrl: result.verificationUrl, userCode: result.userCode };
  });
  secureHandle("desktop:restart-codex-backend", async () => {
    const client = await LocalRuntimeClient.connect();
    await client.restartBackend("codex");
    const capability = (await client.getCapabilities()).agent_backends?.codex;
    return presentCodexBackendStatus(capability, await client.getBackendAccount("codex", true));
  });
  secureHandle("desktop:sync-codex-workspace-sessions", async (event, workspaceId: string, workspacePath: string, requestId: string) => {
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(workspaceId) || !/^[A-Za-z0-9_.:-]{1,200}$/.test(requestId)
      || typeof workspacePath !== "string" || workspacePath.length > 2048 || /[\r\n\0]/.test(workspacePath)) {
      throw new Error("Workspace identity for Codex Session sync is invalid.");
    }
    if (codexWorkspaceSyncControllers.has(requestId)) throw new Error("Codex workspace sync request is already active.");
    const controller = new AbortController();
    codexWorkspaceSyncControllers.set(requestId, controller);
    const emit = (phase: "discovered" | "read" | "projected" | "persisted" | "cancelled", completed: number, total: number) => {
      if (!event.sender.isDestroyed()) event.sender.send("desktop:codex-workspace-session-sync-progress", { requestId, phase, completed, total });
    };
    try {
      emit("discovered", 0, 0);
      const result = await (await LocalRuntimeClient.connect()).syncBackendSessions(workspaceId, "codex", controller.signal);
      controller.signal.throwIfAborted();
      emit("read", result.sessions.length, result.sessions.length);
      const threads: Awaited<ReturnType<typeof updateThread>>[] = [];
      for (const [index, session] of result.sessions.entries()) {
        controller.signal.throwIfAborted();
        emit("projected", index, result.sessions.length);
        const thread = await upsertThreadFromRun({
          id: session.session_id,
          kind: "chat",
          title: session.title,
          workspacePath,
          boundAgentId: "my-codex",
          boundAgentName: "Codex",
          runtimeSessionId: session.session_id,
          status: "idle",
          messageCount: typeof session.message_count === "number" ? session.message_count : 0,
        });
        controller.signal.throwIfAborted();
        threads.push(await updateThread({
          id: thread.id,
          archived: session.archived === true,
          archiveSource: session.archived === true ? "codex" : undefined,
        }));
        emit("persisted", index + 1, result.sessions.length);
      }
      if (!result.sessions.length) { emit("projected", 0, 0); emit("persisted", 0, 0); }
      return { workspaceId, discovered: result.discovered, active: result.active, archived: result.archived,
        created: result.created, updated: result.updated, skipped: result.skipped, conflicts: result.conflicts, threads };
    } catch (error) {
      if (controller.signal.aborted) emit("cancelled", 0, 0);
      throw error;
    } finally {
      codexWorkspaceSyncControllers.delete(requestId);
    }
  });
  secureHandle("desktop:cancel-codex-workspace-session-sync", async (_event, requestId: string) => {
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(requestId)) return false;
    const controller = codexWorkspaceSyncControllers.get(requestId);
    if (!controller) return false;
    controller.abort(new DOMException("Codex workspace sync cancelled.", "AbortError"));
    return true;
  });
  secureHandle("desktop:cancel-codex-backend-login", async (_event, loginId: string) => {
    await (await LocalRuntimeClient.connect()).cancelBackendLogin("codex", loginId);
    return true;
  });
  secureHandle("desktop:logout-codex-backend", async () => {
    await (await LocalRuntimeClient.connect()).logoutBackend("codex");
    return true;
  });
  secureHandle("desktop:provider-usage-analytics-list", () =>
    listProviderUsageAnalytics(),
  );
  secureHandle("desktop:provider-error-analytics-list", () =>
    listProviderErrorAnalytics(),
  );
  secureHandle("desktop:check-for-updates", (event) => {
    subscribeUpdateStatus(event.sender);
    return checkForUpdates();
  });
  secureHandle("desktop:download-update", (event) => {
    subscribeUpdateStatus(event.sender);
    return downloadUpdate();
  });
  secureHandle("desktop:cancel-update", () => cancelUpdate());
  secureHandle("desktop:install-update", async () => {
    if (hasActiveChats() || hasActiveAgentRuns()) {
      throw new Error("Finish or stop active chat and agent tasks before installing an update.");
    }
    if (pendingWorkspaceMutationApprovals.size > 0 || pendingWorkspaceCheckpointRestores.size > 0) {
      throw new Error("Resolve pending workspace change reviews before installing an update.");
    }
    await shutdownGateway();
    return installUpdate();
  });

  secureHandle("desktop:open-external", async (_event, rawUrl: string) => {
    if (!isAllowedExternalUrl(rawUrl)) return;
    await shell.openExternal(rawUrl);
  });

  secureHandle("desktop:open-path", async (_event, rawPath: string) => {
    if (process.env.OPENDRSAI_E2E_M4_KEYBOARD === "1" && rawPath === process.env.OPENDRSAI_E2E_M4_CERN_PDF && existsSync(rawPath)) return "";
    if (!(await isAllowedOpenPath(rawPath))) {
      return "Path is not registered as an OpenDrSai or workspace path.";
    }
    if (process.env.OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN === "1") return "";
    return shell.openPath(rawPath);
  });
  secureHandle("desktop:edit-command", (event, rawCommand: string) => {
    const command = rawCommand === "undo" || rawCommand === "redo" || rawCommand === "cut" ||
      rawCommand === "copy" || rawCommand === "paste" || rawCommand === "delete" || rawCommand === "selectAll"
      ? rawCommand
      : null;
    if (!command) return false;
    const webContents = event.sender;
    if (command === "undo") webContents.undo();
    else if (command === "redo") webContents.redo();
    else if (command === "cut") webContents.cut();
    else if (command === "copy") webContents.copy();
    else if (command === "paste") webContents.paste();
    else if (command === "delete") webContents.delete();
    else webContents.selectAll();
    return true;
  });
  secureHandle("desktop:open-log-folder", async () => {
    const logDir = join(DRSAI_HOME, "desktop", "diagnostics");
    mkdirSync(logDir, { recursive: true });
    return shell.openPath(logDir);
  });
  secureHandle("desktop:local-data-cleanup-preview", (_event, scope) =>
    previewLocalDataCleanup(scope),
  );
  secureHandle("desktop:local-data-cleanup", async (_event, request) => {
    if (hasActiveChats() || hasActiveAgentRuns()) throw new Error("Stop active tasks before clearing local data.");
    stopGateway();
    const result = await clearLocalData(request);
    if (result.scope === "all_local_data") {
      await desktopDiagnostics.clear();
      await logout({ clearLocalData: true });
      await electronSession.defaultSession.clearCache();
      await electronSession.defaultSession.clearStorageData();
    }
    return result;
  });
  secureHandle("desktop:open-pdf-page", (_event, request: PdfPageOpenRequest) =>
    openPdfSourcePage(request),
  );

  secureHandle("desktop:ide-context", (_event, workspacePath: string) =>
    getIdeContext(workspacePath),
  );

  secureHandle("desktop:get-file-icon", async (_event, rawPath: string) => {
    if (!(await isAllowedOpenPath(rawPath))) {
      return { path: rawPath, dataUrl: null };
    }
    try {
      const icon = await app.getFileIcon(rawPath, { size: "normal" });
      return {
        path: rawPath,
        dataUrl: icon.isEmpty() ? null : icon.toDataURL(),
      };
    } catch {
      return { path: rawPath, dataUrl: null };
    }
  });

  secureHandle("desktop:start-install", async (event, options) => {
    await startInstall(event.sender, options ?? {});
  });
  secureHandle("desktop:cancel-install", () => cancelInstall());
  secureHandle("desktop:clipboard-copy-text", (_event, text: string) => {
    if (typeof text !== "string" || text.length > 50_000) return false;
    clipboard.writeText(text);
    return true;
  });

  secureHandle("desktop:start-gateway", () => startGateway());
  secureHandle("desktop:stop-gateway", () => stopGateway());
  secureHandle("desktop:mobile-pairing-readiness", (event) =>
    mobilePairingControllerFor(event.sender).readiness(),
  );
  secureHandle("desktop:mobile-remote-enable", (event) =>
    mobilePairingControllerFor(event.sender).enable(),
  );
  secureHandle("desktop:mobile-remote-pause", (event) =>
    mobilePairingControllerFor(event.sender).pauseAccess(),
  );
  secureHandle("desktop:mobile-remote-resume", (event) =>
    mobilePairingControllerFor(event.sender).resumeAccess(),
  );
  secureHandle("desktop:mobile-runtime-rename", (_event, displayName: string) =>
    renameMobileRuntime(displayName),
  );
  secureHandle("desktop:mobile-remote-diagnose", () => diagnoseMobileRemoteAccess());
    secureHandle("desktop:mobile-pairing-create", (event, scope) =>
      mobilePairingControllerFor(event.sender).create(scope),
  );
  secureHandle("desktop:mobile-pairing-read", (event, grantId: string) =>
    mobilePairingControllerFor(event.sender).read(grantId),
  );
  secureHandle("desktop:mobile-pairing-revoke", (event, grantId: string) =>
    mobilePairingControllerFor(event.sender).revoke(grantId),
  );
  secureHandle("desktop:mobile-associations-list", (event) =>
    mobilePairingControllerFor(event.sender).associations(),
  );
    secureHandle("desktop:mobile-association-revoke", (event, associationId: string) =>
      mobilePairingControllerFor(event.sender).revokeAssociation(associationId),
    );
    secureHandle("desktop:mobile-association-shrink", (
      event,
      associationId: string,
      permissions: Array<"read" | "send" | "approve" | "files">,
    ) =>
      mobilePairingControllerFor(event.sender).shrinkAssociation(associationId, permissions),
    );
  secureHandle("desktop:mobile-enrollment-revoke", (event) =>
    mobilePairingControllerFor(event.sender).revokeEnrollment(),
  );
  secureHandle(
    "desktop:terminal-create",
    async (event, options: TerminalCreateOptions | undefined) => {
      await assertExecutionAllowed("terminal.create", { approved: true });
      return createTerminalSession(event, options);
    },
  );
  secureHandle("desktop:terminal-list", (event, workspaceKey?: string, workspaceId?: string) =>
    listTerminalSessions(event, workspaceKey, workspaceId),
  );
  secureHandle("desktop:terminal-buffer", (event, id: string) =>
    getTerminalBuffer(event, id),
  );
  secureHandle("desktop:terminal-rename", (event, id: string, title: string) =>
    renameTerminalSession(event, id, title),
  );
  secureHandle("desktop:terminal-write", async (event, id: string, data: string) => {
    await assertExecutionAllowed("terminal.write", { approved: true });
    return writeTerminalSession(event, id, data);
  });
  secureHandle(
    "desktop:terminal-resize",
    (event, id: string, cols: number, rows: number) =>
      resizeTerminalSession(event, id, cols, rows),
  );
  secureHandle("desktop:terminal-kill", (event, id: string) =>
    killTerminalSession(event, id),
  );
  secureHandle("desktop:list-workspaces", () => listWorkspaces());
  secureHandle("desktop:ssh-hosts", () => listSshHosts());
  secureHandle("desktop:ssh-diagnose", (_event, hostAlias: string) => diagnoseSshHost(hostAlias));
  secureHandle("desktop:ssh-host-keys", (_event, hostAlias: string) => inspectSshHostKeys(hostAlias));
  secureHandle("desktop:ssh-test", (_event, hostAlias: string) => testSshHost(hostAlias));
  secureHandle("desktop:ssh-approve-host-key", (_event, hostAlias: string) => approveSshHostKey(hostAlias));
  secureHandle("desktop:ssh-host-connect", async (_event, hostAlias: string) => ({ hostAlias, action: "connect", changed: await connectSshHost(hostAlias) }));
  secureHandle("desktop:ssh-host-disconnect", (_event, hostAlias: string) => ({ hostAlias, action: "disconnect", changed: disconnectSshHost(hostAlias) }));
  secureHandle("desktop:ssh-host-reconnect", async (_event, hostAlias: string) => ({ hostAlias, action: "reconnect", changed: await reconnectSshHost(hostAlias) }));
  secureHandle("desktop:ssh-host-remove", async (_event, hostAlias: string) => ({ hostAlias, action: "remove", changed: await removeSshHostProfile(hostAlias) }));
  secureHandle("desktop:port-forward-list", (_event, filter) => listPortForwards((filter && typeof filter === "object" ? filter : {}) as { hostAlias?: string; workspaceId?: string }));
  secureHandle("desktop:port-forward-create", (_event, request) => createPortForward(request as Parameters<typeof createPortForward>[0]));
  secureHandle("desktop:port-forward-pause", (_event, id: string) => pausePortForward(id));
  secureHandle("desktop:port-forward-resume", (_event, id: string) => resumePortForward(id));
  secureHandle("desktop:port-forward-remove", (_event, id: string) => removePortForward(id));
  secureHandle("desktop:ssh-directories", (_event, hostAlias: string, path?: string) =>
    listRemoteDirectories(hostAlias, path),
  );
  secureHandle("desktop:remote-workspace-connect", (_event, request: Parameters<typeof connectRemoteWorkspace>[0]) =>
    connectRemoteWorkspace(request),
  );
  secureHandle("desktop:remote-workspace-disconnect", (_event, workspaceId: string) =>
    disconnectRemoteWorkspace(workspaceId),
  );
  secureHandle("desktop:remote-workspace-status", (_event, workspaceId: string) =>
    getRemoteWorkspaceStatus(workspaceId),
  );
  secureHandle("desktop:remote-workspace-threads", (_event, workspaceId: string) =>
    listRemoteThreads(workspaceId),
  );
  secureHandle("desktop:remote-hepai-workers", (_event, workspaceId: string) =>
    listRemoteHepaiWorkers(workspaceId),
  );
  secureHandle("desktop:remote-hepai-worker-state", (_event, workspaceId: string, workerId: string, enabled: boolean) =>
    setRemoteHepaiWorkerEnabled(workspaceId, workerId, enabled),
  );
  secureHandle("desktop:remote-gateway-preflight", (_event, hostAlias: string) =>
    preflightRemoteGateway(hostAlias),
  );
  secureHandle("desktop:remote-ssh-diagnostics", () => getRemoteSshDiagnosticReport());
  secureHandle("desktop:remote-gateway-install", (_event, request: Parameters<typeof installRemoteGateway>[0]) =>
    installRemoteGateway(request),
  );
  secureHandle("desktop:remote-gateway-install-approval", (_event, request: RemoteGatewayInstallRequest) =>
    requestRemoteGatewayInstallApproval(request),
  );
  secureHandle("desktop:remote-gateway-cancel", (_event, hostAlias: string) => cancelRemoteGatewayOperation(hostAlias));
  secureHandle("desktop:create-workspace", (_event, request) =>
    createWorkspace(request),
  );
  secureHandle("desktop:create-default-workspace", () =>
    createDefaultWorkspace(app.getPath("documents")),
  );
  secureHandle("desktop:update-workspace", (_event, request) =>
    updateWorkspace(request),
  );
  secureHandle("desktop:delete-workspace", (_event, id: string) =>
    deleteWorkspace(id),
  );
  secureHandle("desktop:workspace-context-overview", async (_event, workspacePath: string, workspaceId?: string) =>
    (await resolveRemoteWorkspaceTarget(workspacePath, workspaceId)) !== "local_or_unknown" ? getRemoteWorkspaceContextOverview(workspacePath, workspaceId) : getWorkspaceContextOverview(workspacePath),
  );
  secureHandle("desktop:workspace-files", async (_event, request: WorkspaceFileTreeRequest) =>
    (await resolveRemoteWorkspaceTarget(request?.workspacePath, request?.workspaceId)) !== "local_or_unknown" ? listRemoteWorkspaceFiles(request) : listWorkspaceFiles(request),
  );
  secureHandle("desktop:workspace-folder-summary", async (_event, request) => {
    if (process.env.OPENDRSAI_E2E_C2_FOLDER_IMPORT === "1") await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
    const requestPath = getStringProperty(request, "path");
    const remoteRoot = getRemoteWorkspaceRootForPath(requestPath) || ((await resolveRemoteWorkspaceTarget(requestPath)) !== "local_or_unknown" ? requestPath : null);
    return remoteRoot ? summarizeRemoteWorkspaceFolder(request as WorkspaceFolderSummaryRequest, remoteRoot) : summarizeWorkspaceFolder(request);
  });
  secureHandle("desktop:workspace-file-preview", async (_event, request: WorkspaceFilePreviewRequest) =>
    (await resolveRemoteWorkspaceTarget(request?.workspacePath, request?.workspaceId)) !== "local_or_unknown" ? previewRemoteWorkspaceFile(request) : previewWorkspaceFile(request),
  );
  secureHandle("desktop:workspace-file-save-as", (_event, request: WorkspaceFileSaveAsRequest) =>
    saveWorkspaceFileAs(request),
  );
  secureHandle("desktop:workspace-file-write", async (_event, request: WorkspaceFileWriteRequest) =>
    (await resolveRemoteWorkspaceTarget(request?.workspacePath, request?.workspaceId)) !== "local_or_unknown" ? writeRemoteWorkspaceFile(request) : writeWorkspaceFile(request),
  );
  secureHandle("desktop:apply-anomaly-decision", (_event, request: DesktopAnomalyDecisionApplyRequest) =>
    applySharedAnomalyDecision(request),
  );
  secureHandle("desktop:manager-presentation-generate", async (event, request: ManagerPresentationGenerateRequest) => {
    if (!(await isAllowedOpenPath(request?.workspacePath))) {
      throw new Error("Presentation workspace is not registered or allowed.");
    }
    if (getRemoteGatewayAccess(request?.workspacePath)) {
      throw new Error("Manager presentation generation is currently available for local workspaces only.");
    }
    const requestId = typeof request?.requestId === "string" ? request.requestId.trim() : "";
    if (!requestId || requestId.length > 128) throw new Error("A valid presentation request id is required.");
    if (managerPresentationRuns.has(requestId)) throw new Error("This presentation task is already running.");
    const controller = new AbortController();
    request.requirements = sanitizeManagerPresentationRequirements(request.requirements);
    const run: ManagerPresentationRun = {
      controller,
      webContentsId: event.sender.id,
      request,
      paused: false,
      activeOperationController: null,
      resumeWaiters: new Set(),
      lastProgress: null,
      backgroundSync: Promise.resolve(),
      requirements: [...request.requirements],
    };
    const previousRecovery = getManagerPresentationRecovery({
      workspacePath: request.workspacePath,
      sourcePath: request.sourcePath,
    });
    const initialStageArtifacts = previousRecovery?.requestId === requestId
      ? previousRecovery.stageArtifacts ?? []
      : [];
    recordManagerPresentationStart(request);
    const startedProgress: ManagerPresentationProgressEvent = {
      requestId,
      phase: "analyzing",
      activeStage: "analyzing",
      progress: 1,
      message: "正在启动管理者版 PPT 生成任务。",
    };
    run.lastProgress = startedProgress;
    run.backgroundSync = upsertBackgroundTaskForManagerPresentation(request, startedProgress);
    managerPresentationRuns.set(requestId, run);
    const attempt = ++managerPresentationAttempt;
    const phaseDelayMs = isE2eSmokeProcess
      ? Math.max(0, Number(process.env.OPENDRSAI_E2E_PRESENTATION_PHASE_DELAY_MS || 0))
      : 0;
    const failAtPhase = isE2eSmokeProcess
      && attempt === Number(process.env.OPENDRSAI_E2E_PRESENTATION_FAIL_ATTEMPT || 0)
      ? process.env.OPENDRSAI_E2E_PRESENTATION_FAIL_PHASE as "analyzing" | "planning" | "generating" | "validating"
      : undefined;
    const m8FailureKind = process.env.OPENDRSAI_E2E_M8_FAILURE_KIND || "";
    const m8FailureMessage: Record<string, string> = {
      service_unavailable: "HTTP 503 model service temporarily unavailable",
      disk_full: "ENOSPC: no space left on device",
      permission_denied: "EACCES: permission denied writing report",
      file_busy: "EBUSY: output file is being used by another process",
      model_timeout: "MODEL_TIMEOUT: model request timed out",
    };
    const fileWriteRetryLimit = Math.max(1, Number(process.env.OPENDRSAI_PRESENTATION_FILE_WRITE_RETRY_LIMIT || 3));
    const simulateFileBusyAttempts = isE2eSmokeProcess
      && attempt === Number(process.env.OPENDRSAI_E2E_PRESENTATION_FILE_BUSY_ATTEMPT || 0)
      ? Math.max(0, Number(process.env.OPENDRSAI_E2E_PRESENTATION_FILE_BUSY_ATTEMPTS || 0))
      : 0;
    const simulatedElapsedMs = isE2eSmokeProcess
      ? Math.max(0, Number(process.env.OPENDRSAI_E2E_PRESENTATION_ELAPSED_MS || 0))
      : 0;
    const stageArtifactThresholdMs = Math.max(0, Number(
      process.env.OPENDRSAI_PRESENTATION_STAGE_ARTIFACT_THRESHOLD_MS || 10 * 60 * 1000,
    ));
    try {
      const versionGroupId = `presentation-${requestId}`;
      const changeReason = request.audience === "technical_experts"
        ? "根据演示型 PDF 生成技术专家版 PPT"
        : "根据演示型 PDF 生成管理者版 PPT";
      const presentationResult = await generateManagerPresentation(request, (progress) => {
        run.lastProgress = progress;
        recordManagerPresentationProgress(request, progress);
        run.backgroundSync = run.backgroundSync
          .then(() => upsertBackgroundTaskForManagerPresentation(request, progress))
          .then((task) => {
            if (progress.phase === "completed") {
              notifyBackgroundTaskCompleted(task, {
                kind: "presentation_generation",
                targetId: request.requestId,
                workspacePath: request.workspacePath,
              });
            }
          })
          .catch((error) => console.warn(
            "[desktop] Presentation background task sync failed:",
            error instanceof Error ? error.message : String(error),
          ));
        sendManagerPresentationProgress(progress);
      }, {
        templatePath: join(app.getAppPath(), "resources", "presentation", "manager-deck-template.pptx"),
        signal: controller.signal,
        phaseDelayMs,
        failAtPhase,
        failureMessage: m8FailureMessage[m8FailureKind],
        fileWriteRetryLimit,
        simulateFileBusyAttempts,
        stageArtifactThresholdMs,
        startedAtMs: Date.now() - simulatedElapsedMs,
        initialStageArtifacts,
        isPaused: () => run.paused,
        waitUntilResumed: () => waitUntilManagerPresentationResumed(run),
        setActiveOperationController: (operationController) => {
          run.activeOperationController = operationController;
        },
        getRequirements: () => [...run.requirements],
        onOutputPlanned: async (outputPath, manifestPath) => {
          await createWorkspaceCheckpoint({
            workspacePath: request.workspacePath,
            label: `生成前 · ${basename(outputPath)}`,
            kind: "artifact_version",
            runId: requestId,
            automatic: true,
            versionGroupId,
            versionPhase: "before",
            versionNumber: 1,
            versionScope: "explicit_paths",
            changeReason,
            objectLabel: basename(outputPath),
            includePaths: [
              relative(request.workspacePath, outputPath),
              relative(request.workspacePath, manifestPath),
            ],
            maxFiles: 20,
            maxBytesPerFile: 2_000_000,
          });
        },
      });
      await createWorkspaceCheckpoint({
        workspacePath: request.workspacePath,
        label: `生成后 · ${basename(presentationResult.outputPath)}`,
        kind: "artifact_version",
        runId: requestId,
        automatic: true,
        versionGroupId,
        versionPhase: "after",
        versionNumber: 2,
        versionScope: "explicit_paths",
        changeReason,
        objectLabel: basename(presentationResult.outputPath),
        includePaths: [
          relative(request.workspacePath, presentationResult.outputPath),
          relative(request.workspacePath, presentationResult.manifestPath),
        ],
        maxFiles: 20,
        maxBytesPerFile: 2_000_000,
      });
      return presentationResult;
    } catch (error) {
      if (!(error instanceof ManagerPresentationCancelledError)) {
        const failureAttempts = error && typeof error === "object" && "attempts" in error
          ? Math.max(1, Number(error.attempts) || 1)
          : 1;
        const failureRecovery = buildFailureRecovery(error, failureAttempts, fileWriteRetryLimit, basename(request.sourcePath));
        const failedProgress: ManagerPresentationProgressEvent = {
          requestId,
          phase: "failed",
          activeStage: run.lastProgress?.activeStage,
          progress: 100,
          message: failureRecovery.message,
          failureRecovery,
        };
        recordManagerPresentationProgress(request, failedProgress);
        run.backgroundSync = run.backgroundSync
          .then(() => upsertBackgroundTaskForManagerPresentation(request, failedProgress));
        sendManagerPresentationProgress(failedProgress);
      }
      throw error;
    } finally {
      await run.backgroundSync.catch((error) => console.warn(
        "[desktop] Final presentation background task sync failed:",
        error instanceof Error ? error.message : String(error),
      ));
      managerPresentationRuns.delete(requestId);
    }
  });
  secureHandle("desktop:material-role-analysis", (_event, request) =>
    analyzeMaterialRoles(request),
  );
  secureHandle("desktop:material-consistency-analysis", (_event, request) =>
    analyzeMaterialConsistency(request),
  );
  secureHandle("desktop:material-query", (_event, request) => queryMaterials(request));
  secureHandle("desktop:manager-presentation-cancel", (event, request: ManagerPresentationCancelRequest) => {
    const requestId = typeof request?.requestId === "string" ? request.requestId.trim() : "";
    const run = managerPresentationRuns.get(requestId);
    if (!run || !canControlManagerPresentation(event, run)) return { requestId, accepted: false };
    run.controller.abort();
    resumeManagerPresentationRun(run);
    return { requestId, accepted: true };
  });
  secureHandle("desktop:manager-presentation-pause", (event, request: ManagerPresentationPauseRequest) => {
    const requestId = typeof request?.requestId === "string" ? request.requestId.trim() : "";
    const run = managerPresentationRuns.get(requestId);
    if (!run || !canControlManagerPresentation(event, run) || run.paused) return { requestId, accepted: false };
    run.paused = true;
    const progress = run.lastProgress;
    sendManagerPresentationProgress({
      requestId,
      phase: "pausing",
      activeStage: progress?.activeStage,
      progress: progress?.progress ?? 0,
      message: "正在到达安全暂停点…",
      outputPath: progress?.outputPath,
    } satisfies ManagerPresentationProgressEvent);
    run.activeOperationController?.abort();
    return { requestId, accepted: true };
  });
  secureHandle("desktop:manager-presentation-resume", (event, request: ManagerPresentationPauseRequest) => {
    const requestId = typeof request?.requestId === "string" ? request.requestId.trim() : "";
    const run = managerPresentationRuns.get(requestId);
    if (!run || !canControlManagerPresentation(event, run) || !run.paused) return { requestId, accepted: false };
    resumeManagerPresentationRun(run);
    return { requestId, accepted: true };
  });
  secureHandle("desktop:manager-presentation-requirement-update", (
    event,
    update: ManagerPresentationRequirementUpdateRequest,
  ): ManagerPresentationRequirementUpdateResult => {
    const requestId = typeof update?.requestId === "string" ? update.requestId.trim() : "";
    const run = managerPresentationRuns.get(requestId);
    const activeStage = run?.lastProgress?.activeStage;
    if (!run || !canControlManagerPresentation(event, run)) {
      return {
        requestId,
        accepted: false,
        activeStage,
        scope: "regenerate_required",
        requirements: run ? [...run.requirements] : [],
        message: "任务已经结束；要应用这项要求，需要重新生成 PPT。",
      };
    }
    const text = typeof update?.text === "string"
      ? update.text.trim().replace(/\s+/g, " ").slice(0, 240)
      : "";
    const canApply = Boolean(text)
      && Boolean(activeStage)
      && ["analyzing", "planning", "generating"].includes(activeStage!)
      && !["cancelling", "cancelled", "completed", "failed", "validating"].includes(run.lastProgress?.phase || "");
    if (!canApply) {
      return {
        requestId,
        accepted: false,
        activeStage,
        scope: "regenerate_required",
        requirements: [...run.requirements],
        message: text
          ? "当前成果已进入验收或已经结束；要应用这项要求，需要重新执行规划和生成阶段。"
          : "请输入要补充的要求。",
      };
    }
    if (!run.requirements.includes(text)) run.requirements = [...run.requirements, text].slice(-5);
    run.request.requirements = [...run.requirements];
    if (run.lastProgress) recordManagerPresentationProgress(run.request, run.lastProgress);
    return {
      requestId,
      accepted: true,
      activeStage,
      scope: "current_unfinished_stages",
      requirements: [...run.requirements],
      message: "已应用到当前任务尚未完成的规划、生成和验收阶段。",
    };
  });
  secureHandle("desktop:manager-presentation-recovery", async (_event, request: ManagerPresentationRecoveryRequest) => {
    if (!(await isAllowedOpenPath(request?.workspacePath)) || !(await isAllowedOpenPath(request?.sourcePath))) {
      throw new Error("Presentation recovery paths are not registered or allowed.");
    }
    const workspacePath = resolve(request.workspacePath).toLowerCase();
    const sourcePath = resolve(request.sourcePath).toLowerCase();
    const active = [...managerPresentationRuns.values()].find((run) =>
      resolve(run.request.workspacePath).toLowerCase() === workspacePath
      && resolve(run.request.sourcePath).toLowerCase() === sourcePath);
    if (active?.lastProgress) {
      return {
        ...active.lastProgress,
        workspacePath: request.workspacePath,
        sourcePath: request.sourcePath,
        updatedAt: new Date().toISOString(),
      };
    }
    return getManagerPresentationRecovery(request);
  });
  secureHandle("desktop:manager-presentation-recovery-resolve", async (_event, request: ManagerPresentationRecoveryDecisionRequest) => {
    if (!(await isAllowedOpenPath(request?.workspacePath)) || !(await isAllowedOpenPath(request?.sourcePath))) {
      throw new Error("Presentation recovery paths are not registered or allowed.");
    }
    if (!request || !["restart", "abandon"].includes(request.decision)) {
      throw new Error("Presentation recovery decision is invalid.");
    }
    return resolveManagerPresentationRecovery(request);
  });
  secureHandle("desktop:workspace-git-diff", async (_event, request: WorkspaceGitDiffRequest) =>
    (await resolveRemoteWorkspaceTarget(request?.workspacePath, request?.workspaceId)) !== "local_or_unknown" ? getRemoteWorkspaceGitDiff(request) : getWorkspaceGitDiff(request),
  );
  secureHandle("desktop:workspace-git-file-at-ref", async (_event, request) =>
    (await resolveRemoteWorkspaceTarget(getStringProperty(request, "workspacePath"), getStringProperty(request, "workspaceId"))) !== "local_or_unknown" ? getRemoteWorkspaceGitFileAtRef(request as WorkspaceGitFileAtRefRequest) : getWorkspaceGitFileAtRef(request),
  );
  secureHandle("desktop:workspace-revert-file", async (_event, request) =>
    requestWorkspaceMutationApproval("revert-file", request),
  );
  secureHandle("desktop:workspace-stage-file", async (_event, request) =>
    requestWorkspaceMutationApproval("stage-file", request),
  );
  secureHandle("desktop:workspace-stage-hunk", async (_event, request) =>
    requestWorkspaceMutationApproval("stage-hunk", request),
  );
  secureHandle("desktop:workspace-revert-hunk", async (_event, request) =>
    requestWorkspaceMutationApproval("revert-hunk", request),
  );
  secureHandle("desktop:workspace-checkpoints-list", async (_event, workspacePath: string, workspaceId?: string) => {
    if ((await resolveRemoteWorkspaceTarget(workspacePath, workspaceId)) !== "local_or_unknown") return listRemoteWorkspaceCheckpoints(workspacePath, workspaceId);
    if (!(await isAllowedOpenPath(workspacePath))) {
      throw new Error("Checkpoint workspace is not registered or allowed.");
    }
    return listWorkspaceCheckpoints(workspacePath);
  });
  secureHandle("desktop:workspace-checkpoint-create", async (_event, request) => {
    const workspacePath = getStringProperty(request, "workspacePath");
    if ((await resolveRemoteWorkspaceTarget(workspacePath, getStringProperty(request, "workspaceId"))) !== "local_or_unknown") {
      await assertExecutionAllowed("workspace.checkpoint");
      return createRemoteWorkspaceCheckpoint(request as WorkspaceCheckpointCreateRequest);
    }
    if (!(await isAllowedOpenPath(workspacePath))) {
      throw new Error("Checkpoint workspace is not registered or allowed.");
    }
    await assertExecutionAllowed("workspace.checkpoint");
    return createWorkspaceCheckpoint(request);
  });
  secureHandle("desktop:workspace-checkpoint-accept", async (_event, request) => {
    const workspacePath = getStringProperty(request, "workspacePath");
    if ((await resolveRemoteWorkspaceTarget(workspacePath, getStringProperty(request, "workspaceId"))) !== "local_or_unknown") return acceptRemoteWorkspaceCheckpoint(request as WorkspaceCheckpointAcceptRequest);
    if (!(await isAllowedOpenPath(workspacePath))) {
      throw new Error("Checkpoint workspace is not registered or allowed.");
    }
    return acceptWorkspaceCheckpoint(request);
  });
  secureHandle("desktop:workspace-checkpoint-preview", async (_event, request) => {
    const workspacePath = getStringProperty(request, "workspacePath");
    if ((await resolveRemoteWorkspaceTarget(workspacePath, getStringProperty(request, "workspaceId"))) !== "local_or_unknown") return previewRemoteWorkspaceCheckpoint(request as WorkspaceCheckpointPreviewRequest);
    if (!(await isAllowedOpenPath(workspacePath))) {
      throw new Error("Checkpoint workspace is not registered or allowed.");
    }
    return previewWorkspaceCheckpoint(request);
  });
  secureHandle("desktop:workspace-checkpoint-restore", async (_event, request) =>
    requestWorkspaceCheckpointRestore(request),
  );
  secureHandle("desktop:fork-conflict-draft-write", async (_event, request) =>
    requestForkConflictDraftWrite(request),
  );
  secureHandle("desktop:list-threads", () => listThreads());
  secureHandle("desktop:list-agents", (_event, options) => listAgents(
    options && typeof options === "object"
      ? {
          ...((options as { refresh?: unknown }).refresh === true ? { refresh: true } : {}),
          ...((options as { preferCache?: unknown }).preferCache === true ? { preferCache: true } : {}),
        }
      : {},
  ));
  secureHandle("desktop:get-agent-catalog-snapshot", (_event, options) =>
    getAgentCatalogSnapshot(options && typeof options === "object" ? {
      ...((options as { refresh?: unknown }).refresh === true ? { refresh: true } : {}),
      ...((options as { preferCache?: unknown }).preferCache === true ? { preferCache: true } : {}),
    } : {}));
  secureHandle("desktop:get-platform-agent-status", () => getPlatformAgentStatus());
  secureHandle("desktop:set-default-agent", (_event, agentId) =>
    setDefaultAgent(typeof agentId === "string" ? agentId : ""));
  secureHandle("desktop:record-agent-usage", (_event, agentId) =>
    recordAgentUsage(typeof agentId === "string" ? agentId : ""));
  secureHandle("desktop:get-my-drsai-config", async (_event, workspacePath?: string) => {
    if (workspacePath && !(await isAllowedOpenPath(workspacePath))) {
      return getMyDrSaiConfig();
    }
    return getMyDrSaiConfig(workspacePath);
  });
  secureHandle("desktop:update-my-drsai-config", (_event, request: UpdateMyDrSaiConfigRequest) =>
    updateMyDrSaiConfig(request),
  );
  secureHandle("desktop:update-my-drsai-model-connection", (_event, request: UpdateMyDrSaiModelConnectionRequest) =>
    updateMyDrSaiModelConnection(request),
  );
  secureHandle("desktop:preview-my-drsai-model-connection", (_event, request: UpdateMyDrSaiModelConnectionRequest) =>
    previewMyDrSaiModelConnection(request),
  );
  secureHandle("desktop:diagnose-my-drsai-model-connection", (_event, online?: boolean) =>
    diagnoseMyDrSaiModelConnection(online),
  );
  secureHandle("desktop:restore-my-drsai-model-connection", (_event, expectedRevision?: string) =>
    restoreMyDrSaiModelConnection(expectedRevision),
  );
  secureHandle("desktop:save-my-drsai-model-provider", (_event, provider: string, request: SaveMyDrSaiModelProviderRequest) =>
    saveMyDrSaiModelProvider(provider, request),
  );
  secureHandle("desktop:test-my-drsai-model-provider", (_event, provider: string, model?: string) =>
    testMyDrSaiModelProvider(provider, model),
  );
  secureHandle("desktop:test-my-drsai-model-draft", (_event, request: UpdateMyDrSaiModelConnectionRequest, mode?: "basic" | "model") => testMyDrSaiModelDraft(request, mode));
  secureHandle("desktop:list-my-drsai-model-provider-presets", () => listMyDrSaiModelProviderPresets());
  secureHandle("desktop:discover-my-drsai-provider-models", (_event, provider: string, refresh?: boolean, draft?: unknown) => discoverMyDrSaiProviderModels(provider, refresh, draft));
  secureHandle("desktop:preflight-my-drsai-model-provider-deletion", (_event, provider: string) => preflightMyDrSaiModelProviderDeletion(provider));
  secureHandle("desktop:delete-my-drsai-model-provider", (_event, provider: string, deleteCredential?: boolean) =>
    deleteMyDrSaiModelProvider(provider, deleteCredential),
  );
  secureHandle("desktop:create-thread", (_event, request) =>
    createThread(request),
  );
  secureHandle("desktop:update-thread", (_event, request) =>
    updateThread(request),
  );
  secureHandle("desktop:delete-thread", (_event, threadId) => deleteThread(threadId));
  secureHandle("desktop:set-thread-archived", (_event, request) => {
    const value = request as { threadId?: unknown; archived?: unknown };
    if (typeof value?.threadId !== "string" || typeof value.archived !== "boolean") throw new Error("Archive request is invalid.");
    return setThreadArchived(value.threadId, value.archived);
  });
  secureHandle("desktop:get-thread-snapshot", async (_event, threadId: string) => {
    const remote = await getRemoteThreadSnapshot(threadId);
    if (remote) return remote;
    const thread = (await listThreads()).find((item) => item.id === threadId);
    if (thread?.runtimeSessionId) {
      const runtime = await getRuntimeThreadSnapshot(thread);
      if (runtime) return runtime;
    }
    return getThreadSnapshot(threadId);
  });
  secureHandle("desktop:get-my-drsai-runtime-model-catalog", () => getMyDrSaiRuntimeModelCatalog());
  secureHandle("desktop:get-my-drsai-agent-model-policy", (_event, agentId?: string) => getMyDrSaiAgentModelPolicy(agentId));
  secureHandle("desktop:get-my-drsai-agent-model-capability-status", (_event, agentId?: string) => getMyDrSaiAgentModelCapabilityStatus(agentId));
  secureHandle("desktop:update-my-drsai-agent-model-policy", (_event, agentId: string, policy: unknown) => updateMyDrSaiAgentModelPolicy(agentId, policy));
  secureHandle("desktop:migrate-my-drsai-agent-model-policy", (_event, agentId: string, legacyModel: string, expectedRevision?: string) => migrateMyDrSaiAgentModelPolicy(agentId, legacyModel, expectedRevision));
  secureHandle("desktop:get-thread-snapshot-envelope", async (_event, threadId: string, requestId?: string, options?: { forceFresh?: boolean; minimumSequence?: number; expectedGeneration?: number; historyCursor?: string }) => {
    if (typeof threadId !== "string" || (requestId !== undefined && (typeof requestId !== "string" || requestId.length > 160))) {
      throw new Error("Thread hydration request is invalid.");
    }
    if (options && (typeof options !== "object"
      || (options.forceFresh !== undefined && typeof options.forceFresh !== "boolean")
      || (options.historyCursor !== undefined && (typeof options.historyCursor !== "string" || options.historyCursor.length > 4096))
      || [options.minimumSequence, options.expectedGeneration].some((value) => value !== undefined && (!Number.isSafeInteger(value) || Number(value) < 0)))) {
      throw new Error("Thread hydration waterline is invalid.");
    }
    const controller = new AbortController();
    if (requestId) {
      threadSnapshotHydrations.get(requestId)?.abort(new DOMException("Superseded hydration.", "AbortError"));
      threadSnapshotHydrations.set(requestId, controller);
    }
    try {
    const thread = (await listThreads()).find((item) => item.id === threadId);
    if (thread?.runtimeSessionId) {
      const envelope = await getRuntimeThreadSnapshotEnvelope(thread, controller.signal, options);
      if (envelope) return envelope;
    }
    controller.signal.throwIfAborted();
    const remote = await getRemoteThreadSnapshot(threadId);
    const snapshot = remote ?? await getThreadSnapshot(threadId);
    if (!snapshot) return null;
    return { version: 1, projection: "conversation/1", threadId,
      runtimeSessionId: thread?.runtimeSessionId ?? `persisted:${threadId}`,
      sessionSequence: 0, generation: 0, source: "persisted", snapshot };
    } finally {
      if (requestId && threadSnapshotHydrations.get(requestId) === controller) threadSnapshotHydrations.delete(requestId);
    }
  });
  secureHandle("desktop:cancel-thread-snapshot-hydration", (_event, requestId: string) => {
    if (typeof requestId !== "string" || requestId.length > 160) return false;
    const controller = threadSnapshotHydrations.get(requestId);
    if (!controller) return false;
    threadSnapshotHydrations.delete(requestId);
    controller.abort(new DOMException("Hydration cancelled.", "AbortError"));
    return true;
  });
  secureHandle("desktop:subscribe-thread-snapshot", async (event, threadId: string) => {
    if (typeof threadId !== "string") return false;
    const thread = (await listThreads()).find((item) => item.id === threadId);
    if (!thread) return false;
    startRuntimeThreadCatalogSync(event.sender, threadId);
    const key = runtimeThreadSubscriptionKey(event.sender, threadId);
    runtimeThreadSubscriptions.get(key)?.stop();
    runtimeThreadSubscriptions.delete(key);
    const subscription = await subscribeRuntimeThreadSnapshot(thread, event.sender).catch(() => null);
    if (!subscription) return false;
    runtimeThreadSubscriptions.set(key, subscription);
    ensureRuntimeThreadCleanup(event.sender);
    void subscription.done.finally(() => {
      if (runtimeThreadSubscriptions.get(key) === subscription) {
        runtimeThreadSubscriptions.delete(key);
      }
    });
    return true;
  });
  secureHandle("desktop:unsubscribe-thread-snapshot", (event, threadId: string) => {
    if (typeof threadId !== "string") return false;
    const key = runtimeThreadSubscriptionKey(event.sender, threadId);
    const subscription = runtimeThreadSubscriptions.get(key);
    subscription?.stop();
    return runtimeThreadSubscriptions.delete(key);
  });
  secureHandle("desktop:search-thread-messages", async (_event, request: DesktopThreadContentSearchRequest) =>
    (await searchRemoteThreadMessages(request)) || searchThreadMessages(request),
  );
  secureHandle("desktop:update-thread-snapshot", (_event, snapshot) =>
    updateThreadSnapshot(snapshot),
  );
  secureHandle("desktop:create-thread-share", (_event, request) =>
    createThreadShare(request),
  );
  secureHandle("desktop:open-thread-share", (_event, filePath) =>
    openThreadShare(filePath),
  );
  secureHandle("desktop:reveal-thread-share", (_event, filePath) =>
    revealThreadShare(filePath),
  );

  // Skills (gateway-managed)
  secureHandle("desktop:list-installed-skills", (_event, request) =>
    listInstalledSkills((request as { userId?: string } | undefined)?.userId),
  );
  secureHandle("desktop:list-available-skills", (_event, request) =>
    listAvailableSkills((request as { userId?: string } | undefined)?.userId),
  );
  secureHandle("desktop:get-skill-content", (_event, request) =>
    getSkillContent((request as { skillPath: string }).skillPath),
  );
  secureHandle("desktop:install-skill", (_event, request) =>
    installSkill(request as Parameters<typeof installSkill>[0]),
  );
  secureHandle("desktop:uninstall-skill", (_event, request) => {
    const r = request as { name: string; userId?: string };
    return uninstallSkill(r.name, r.userId);
  });
  secureHandle("desktop:update-skill", (_event, request) => {
    const r = request as { name: string; content: string; userId?: string };
    return updateSkill(r.name, r.content, r.userId);
  });
  secureHandle("desktop:reload-skills", (_event, request) => {
    const r = (request ?? {}) as { threadId?: string; userId?: string };
    return reloadSkills(r.threadId, r.userId);
  });

  // GFS cloud storage
  secureHandle("desktop:gfs-list", (_event, request) =>
    gfsList(request as Parameters<typeof gfsList>[0]),
  );
  secureHandle("desktop:gfs-stat", (_event, request) =>
    gfsStat((request as { path: string }).path),
  );
  secureHandle("desktop:gfs-read", (_event, request) =>
    gfsRead((request as { path: string }).path),
  );
  secureHandle("desktop:gfs-write", (_event, request) => {
    const r = request as { path: string; content: string; contentType?: string };
    return gfsWrite(r.path, r.content, r.contentType);
  });
  secureHandle("desktop:gfs-upload-file", (_event, request) =>
    gfsUploadFile(request as Parameters<typeof gfsUploadFile>[0]),
  );
  secureHandle("desktop:gfs-download-file", (_event, request) =>
    gfsDownloadFile(request as Parameters<typeof gfsDownloadFile>[0]),
  );
  secureHandle("desktop:gfs-delete", (_event, request) =>
    gfsDelete((request as { path: string }).path),
  );
  secureHandle("desktop:gfs-share-url", (_event, request) => {
    const r = request as {
      path: string;
      ttlMinutes?: number;
      responseContentType?: string;
    };
    return gfsShareUrl(r.path, r.ttlMinutes, r.responseContentType);
  });
  secureHandle("desktop:gfs-healthcheck", () => gfsHealthcheck());

  secureHandle("desktop:prepare-fork-worktree", async (_event, request) => {
    const workspacePath = getStringProperty(request, "workspacePath");
    if ((await resolveRemoteWorkspaceTarget(workspacePath, getStringProperty(request, "workspaceId"))) !== "local_or_unknown") return prepareRemoteForkWorktree(workspacePath, getStringProperty(request, "intent"));
    return prepareForkWorktree(request);
  });
  secureHandle("desktop:list-worktrees", (_event, request: DesktopWorktreeListRequest) => listRuntimeWorktrees(request));
  secureHandle("desktop:list-worktree-events", (_event, request: DesktopWorktreeEventRequest) => listRuntimeWorktreeEvents(request));
  secureHandle("desktop:worktree-migration-diagnostics", (_event, request: DesktopWorktreeListRequest) => getWorktreeMigrationDiagnostics(request));
  secureHandle("desktop:project-memory-list", (_event, request) =>
    listProjectMemory(request),
  );
  secureHandle("desktop:project-memory-add", (_event, request) =>
    addProjectMemory(request),
  );
  secureHandle("desktop:project-memory-update", (_event, request) =>
    updateProjectMemory(request),
  );
  secureHandle("desktop:project-memory-clear", (_event, request) =>
    clearProjectMemory(request),
  );
  secureHandle("desktop:user-preferences-list", () => listUserPreferences());
  secureHandle("desktop:user-preference-upsert", (_event, request) =>
    upsertUserPreference(request),
  );
  secureHandle("desktop:user-preference-delete", (_event, request) =>
    deleteUserPreference(request),
  );
  secureHandle("desktop:team-memory-list", (_event, request) => listTeamMemory(request));
  secureHandle("desktop:team-memory-add", (_event, request) => addTeamMemory(request));
  secureHandle("desktop:team-memory-delete", (_event, request) => deleteTeamMemory(request));
  secureHandle("desktop:custom-commands-list", (_event, request) =>
    listCustomCommands(request),
  );
  secureHandle("desktop:custom-command-upsert", (_event, request) =>
    upsertCustomCommand(request),
  );
  secureHandle("desktop:custom-command-delete", (_event, request) =>
    deleteCustomCommand(request),
  );
  secureHandle("desktop:project-skill-drafts-list", (_event, request) =>
    listProjectSkillDrafts(request),
  );
  secureHandle("desktop:project-skill-draft-create", (_event, request) =>
    createProjectSkillDraft(request),
  );
  secureHandle("desktop:project-skill-draft-install", (_event, request) =>
    installProjectSkillDraft(request),
  );
  secureHandle("desktop:project-skill-draft-publish", (_event, request) =>
    publishProjectSkillDraft(request),
  );
  secureHandle("desktop:workflow-marketplace-list", (_event, workspacePath) =>
    listWorkflowMarketplace(workspacePath),
  );
  secureHandle("desktop:workflow-marketplace-sync", (_event, request) =>
    syncWorkflowMarketplace(request),
  );
  secureHandle("desktop:workflow-run-prepare", (_event, request) =>
    prepareWorkflowRun(request),
  );
  secureHandle("desktop:workflow-run-start", async (_event, request) => {
    const result = await startWorkflowRun(request);
    await upsertBackgroundTaskForWorkflowRun(result.run);
    return result;
  });
  secureHandle("desktop:workflow-runs-list", (_event, workspacePath?: string) =>
    listWorkflowRuns(workspacePath),
  );
  secureHandle("desktop:workflow-run-step-dispatch", async (_event, request) => {
    const result = await dispatchWorkflowRunStep(request);
    await upsertBackgroundTaskForWorkflowRun(result.run);
    return result;
  });
  secureHandle("desktop:workflow-run-step-complete", async (_event, request) => {
    const result = await completeWorkflowRunStep(request);
    await upsertBackgroundTaskForWorkflowRun(result.run);
    return result;
  });
  secureHandle("desktop:background-tasks-list", (_event, request) =>
    listOwnedBackgroundTasks(request),
  );
  secureHandle("desktop:background-task-enqueue", (_event, request) =>
    enqueueBackgroundTask(request),
  );
  secureHandle("desktop:background-task-update", (_event, request) =>
    updateBackgroundTask(request),
  );
  secureHandle("desktop:background-task-cancel", (_event, request) => cancelBackgroundTask(request));
  secureHandle("desktop:background-task-retry", (_event, request) => retryBackgroundTask(request));
  secureHandle("desktop:background-tasks-recover", () => recoverBackgroundTasksAfterRestart());
  secureHandle("desktop:reusable-tasks-list", () => listReusableTasks());
  secureHandle("desktop:reusable-task-save", (_event, request) => saveReusableTask(request));
  secureHandle("desktop:reusable-task-run-prepare", (_event, request) => prepareReusableTaskRun(request));
  secureHandle("desktop:completion-notification-preference-set", (_event, preference: CompletionNotificationPreference) =>
    setCompletionNotificationPreference(preference),
  );
  secureHandle("desktop:scheduled-tasks-list", (_event, request) =>
    listScheduledTasks(request),
  );
  secureHandle("desktop:scheduled-task-create", (_event, request) =>
    createScheduledTask(request),
  );
  secureHandle("desktop:scheduled-task-update", (_event, request) =>
    updateScheduledTask(request),
  );
  secureHandle("desktop:scheduled-task-delete", (_event, request) =>
    deleteScheduledTask(request),
  );
  secureHandle("desktop:scheduled-tasks-run-due", (_event, request) =>
    runDueScheduledTasksAndMirror(request),
  );
  secureHandle("desktop:scheduled-task-worker-status", () =>
    getScheduledTaskWorkerStatus(),
  );
  secureHandle("desktop:share-create", (_event, request) => createShare(request));
  secureHandle("desktop:share-inspect", (_event, request) => inspectShare(request));
  secureHandle("desktop:share-permission-update", (_event, request) => updateSharePermission(request));
  secureHandle("desktop:share-revoke", (_event, request) => revokeShare(request));
  secureHandle("desktop:share-version-inspect", (_event, request) => inspectShareVersion(request));
  secureHandle("desktop:share-version-publish", (_event, request) => publishShareVersion(request));
  secureHandle("desktop:share-comments-list", (_event, request) => listShareComments(request));
  secureHandle("desktop:share-comment-add", (_event, request) => addShareComment(request));
  secureHandle("desktop:share-comment-task-preview", (_event, request) => previewShareCommentTask(request));
  secureHandle("desktop:share-comment-task-create", (_event, request) => createShareCommentTask(request));
  secureHandle("desktop:share-comment-task-update", (_event, request) => updateShareCommentTask(request));
  secureHandle("desktop:share-comment-task-complete", (_event, request) => completeShareCommentTask(request));
  secureHandle("desktop:share-comment-tasks-list", (_event, request) => listShareCommentTasks(request));
  secureHandle("desktop:share-continue", (_event, request) => continueSharedTask(request));
  secureHandle("desktop:share-audit-list", (_event, request) => listShareAudit(request));
  secureHandle("desktop:shares-incoming-list", () => listIncomingShares());
  secureHandle("desktop:shares-outgoing-list", () => listOutgoingShares());
  secureHandle("desktop:shared-object-open", (_event, request) => openSharedObject(request));
  secureHandle("desktop:shared-artifact-download", (_event, request) => downloadSharedArtifact(request));
  secureHandle("desktop:channel-adapters-list", (_event, workspacePath?: string) =>
    listChannelAdapters(workspacePath),
  );
  secureHandle(
    "desktop:channel-adapter-configure",
    (_event, request: DesktopChannelAdapterConfigureRequest) =>
      configureChannelAdapter(request),
  );
  secureHandle(
    "desktop:channel-adapter-auth-start",
    (_event, request: DesktopChannelAdapterAuthStartRequest) =>
      startChannelAdapterAuth(request),
  );
  secureHandle(
    "desktop:channel-context-import",
    (_event, request: DesktopChannelContextImportRequest) =>
      importChannelContext(request),
  );
  secureHandle(
    "desktop:channel-snapshot-sync",
    (_event, request: DesktopChannelSnapshotSyncRequest) =>
      syncChannelSnapshots(request),
  );
  secureHandle(
    "desktop:channel-inbound-events",
    (_event, request?: DesktopChannelInboundEventListRequest) =>
      listChannelInboundEvents(request),
  );
  secureHandle(
    "desktop:channel-inbound-route",
    (_event, request: DesktopChannelInboundEventRouteRequest) =>
      routeChannelInboundEvent(request),
  );
  secureHandle(
    "desktop:channel-outbound-draft",
    (_event, request: DesktopChannelOutboundDraftRequest) =>
      proposeChannelOutboundDraft(request),
  );
  secureHandle("desktop:channel-outbound-deliveries", (_event, request?: DesktopChannelOutboundDeliveryListRequest) =>
    listChannelOutboundDeliveries(request),
  );
  secureHandle("desktop:external-connection-readiness", (_event, workspacePath?: string) =>
    listExternalConnectionReadiness(workspacePath),
  );
  secureHandle(
    "desktop:mcp-context-import",
    (_event, request: DesktopMcpContextRequest) => importMcpContext(request),
  );
  secureHandle("desktop:mcp-live-enumerate", (_event, request) =>
    requestMcpLiveEnumeration(request),
  );
  secureHandle("desktop:mcp-tool-execution-approval", (_event, request) =>
    requestMcpToolExecutionApproval(request),
  );
  secureHandle(
    "desktop:mcp-execution-audits",
    (_event, request: DesktopMcpToolExecutionAuditListRequest) =>
      listMcpToolExecutionAudits(request),
  );
  secureHandle(
    "desktop:mcp-session-audits",
    (_event, request: DesktopMcpSessionAuditListRequest) =>
      listMcpSessionAudits(request),
  );
  secureHandle(
    "desktop:mcp-active-sessions",
    (_event, request: DesktopMcpActiveSessionListRequest) =>
      listMcpActiveSessions(request),
  );
  secureHandle(
    "desktop:mcp-reusable-sessions",
    (_event, request: DesktopMcpReusableSessionListRequest) =>
      listMcpReusableSessions(request),
  );
  secureHandle(
    "desktop:mcp-reusable-session-close",
    (_event, request: DesktopMcpReusableSessionCloseRequest) =>
      closeMcpReusableSession(request),
  );
  secureHandle(
    "desktop:mcp-session-cancel",
    (_event, request: DesktopMcpSessionCancelRequest) =>
      cancelMcpActiveSession(request),
  );
  secureHandle("desktop:start-chat", (event, request) => {
    if (getA5ServiceGuidanceScenario()) {
      throw new Error("A5 service guidance blocks chat until the service is available.");
    }
    return startChat(event.sender, request);
  });
  secureHandle("desktop:recover-chat-run", (event, request) => recoverChatRun(request, event.sender));
  secureHandle("desktop:abort-chat", (_event, requestId: string) =>
    abortChat(requestId),
  );
  secureHandle("desktop:run-list", async (_event, request: SessionRunsReadRequest) => {
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    const auth = await requireAuthContext();
    return sanitizeSessionRunList(await resolved.client.listSessionRuns(
      request.sessionId, request.cursor, request.limit, request.status, auth,
    ));
  });
  secureHandle("desktop:run-inspection", async (_event, request: RunInspectionOpenRequest) => {
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    const auth = await requireAuthContext();
    return sanitizeRunInspection(await resolved.client.getRunInspection(
      request.runId, request.timelineCursor, request.limit, request.itemType, request.status, auth,
    ));
  });
  secureHandle("desktop:run-item-locator", async (_event, request: RunItemLocatorRequest) => {
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    const auth = await requireAuthContext();
    return resolved.client.locateRunItem(
      request.runId, request.itemId, request.itemType, request.status, auth,
    );
  });
  secureHandle("desktop:run-manifest", async (_event, request: RunManifestReadRequest) => {
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return sanitizeRunReproductionManifest(
      await resolved.client.getRunReproductionManifest(request.runId, await requireAuthContext()),
    );
  });
  secureHandle("desktop:run-manifest-export", async (_event, request: RunManifestReadRequest): Promise<RunManifestExportResult> => {
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    const manifest = sanitizeRunReproductionManifest(
      await resolved.client.exportRunReproductionManifest(request.runId, await requireAuthContext()),
    );
    const suggestedName = `opendrsai-run-${request.runId}-manifest.json`.replace(/[^a-zA-Z0-9._-]/g, "-");
    const options = {
      title: "Export redacted Run manifest",
      defaultPath: join(app.getPath("downloads"), suggestedName),
      buttonLabel: "Export",
      filters: [{ name: "JSON", extensions: ["json"] }],
    };
    const selected = await phaseAcceptanceExportTarget(suggestedName, options);
    if (selected.canceled || !selected.filePath) return { manifest, savedPath: null, cancelled: true };
    await writeFile(selected.filePath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "w" });
    return { manifest, savedPath: selected.filePath, cancelled: false };
  });
  secureHandle("desktop:experiment-release-gate", () => getExperimentReleaseGate());
  secureHandle("desktop:run-experiment-create", async (_event, request: CreateRunExperimentRequest) => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    const auth = await requireAuthContext();
    return resolved.client.createRunExperiment(request.runId, {
      idempotencyKey: request.idempotencyKey, title: request.title,
      forkedFromItemId: request.forkedFromItemId, replayMode: request.replayMode,
    }, auth);
  });
  secureHandle("desktop:run-experiment-capabilities", async (_event, request: GetRunExperimentCapabilitiesRequest) => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.getRunExperimentCapabilities(request.runId, await requireAuthContext());
  });
  secureHandle("desktop:run-experiment-candidate-snapshot", async (_event, request: FinalizeRunExperimentCandidateRequest) => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    try {
      return await resolved.client.finalizeRunExperimentCandidate(
        request.experimentId, request.approvalId, await requireAuthContext(),
      );
    } catch (error) {
      if (error instanceof RemoteProtocolError && error.code === "approval_required" && error.detail.approvalId) {
        return { approval_required: true, approval_id: error.detail.approvalId, code: "approval_required", message: error.message };
      }
      throw error;
    }
  });
  secureHandle("desktop:run-experiment-get", async (_event, request: GetRunExperimentRequest) => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.getRunExperiment(request.experimentId, await requireAuthContext());
  });
  secureHandle("desktop:run-experiment-export", async (_event, request: GetRunExperimentRequest): Promise<RunExperimentPackageExportResult> => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    const packageValue = await resolved.client.exportRunExperimentPackage(request.experimentId, await requireAuthContext());
    const suggestedName = `opendrsai-experiment-${request.experimentId}-package.json`.replace(/[^a-zA-Z0-9._-]/g, "-");
    const options = {
      title: "Export redacted experiment package",
      defaultPath: join(app.getPath("downloads"), suggestedName),
      buttonLabel: "Export",
      filters: [{ name: "JSON", extensions: ["json"] }],
    };
    const selected = await phaseAcceptanceExportTarget(suggestedName, options);
    if (selected.canceled || !selected.filePath) return { package: packageValue, savedPath: null, cancelled: true };
    const temporaryPath = `${selected.filePath}.opendrsai-${process.pid}-${Date.now()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(packageValue, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, selected.filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    return { package: packageValue, savedPath: selected.filePath, cancelled: false };
  });
  secureHandle("desktop:run-experiment-update", async (_event, request: UpdateRunExperimentRequest) => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.updateRunExperiment(request.experimentId, {
      expectedVersion: request.expectedVersion, idempotencyKey: request.idempotencyKey, patch: request.patch,
    }, await requireAuthContext());
  });
  secureHandle("desktop:run-experiment-delete", async (_event, request: DeleteRunExperimentRequest) => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    await resolved.client.deleteRunExperiment(request.experimentId, await requireAuthContext());
    return true;
  });
  secureHandle("desktop:replay-plan-create", async (_event, request: CreateReplayPlanRequest) => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    const capabilities = await resolved.client.getCapabilities();
    return resolved.client.createReplayPlan(request.experimentId, {
      expectedDraftVersion: request.expectedDraftVersion,
      expiresInSeconds: request.expiresInSeconds,
      availability: {
        ...(request.availability ?? {}),
        worktree: capabilities.capabilities.includes("worktree"),
        runtime_location: resolved.client.location,
      },
    }, await requireAuthContext());
  });
  secureHandle("desktop:replay-plan-get", async (_event, request: GetReplayPlanRequest) => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.getReplayPlan(request.replayPlanId, await requireAuthContext());
  });
  secureHandle("desktop:replay-boundaries-get", async (_event, request: GetReplayBoundariesRequest) => {
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.getReplayBoundaries(request.runId, await requireAuthContext());
  });
  secureHandle("desktop:run-relations-get", async (_event, request: GetRunRelationsRequest) => {
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.getRunRelations(request.runId, await requireAuthContext());
  });
  secureHandle("desktop:replay-plan-execute", async (_event, request: ExecuteReplayPlanRequest) => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    try {
      return await resolved.client.executeReplayPlan(request.replayPlanId, {
        draftVersion: request.draftVersion, planDigest: request.planDigest,
        baseManifestDigest: request.baseManifestDigest, idempotencyKey: request.idempotencyKey,
        approvalId: request.approvalId, isolatedWorktreeId: request.isolatedWorktreeId,
        runtimeApprovalId: request.runtimeApprovalId,
      }, await requireAuthContext());
    } catch (error) {
      if (error instanceof RemoteProtocolError && error.code === "approval_required" && error.detail.approvalId) {
        return { approval_required: true, approval_id: error.detail.approvalId, code: "approval_required", message: error.message };
      }
      throw error;
    }
  });
  secureHandle("desktop:run-comparison-create", async (_event, request: CreateRunComparisonRequest) => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.createRunComparison(request.baselineRunId, request.candidateRunId, await requireAuthContext());
  });
  secureHandle("desktop:run-comparison-get", async (_event, request: GetRunComparisonRequest) => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.getRunComparison(request.comparisonId, await requireAuthContext());
  });
  secureHandle("desktop:worktree-adoption-preview", async (_event, request: GetWorktreeAdoptionPreviewRequest) => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.getWorktreeAdoptionPreview(request.sourceWorkspaceId, request.worktreeId, await requireAuthContext());
  });
  secureHandle("desktop:worktree-adoption-apply", async (_event, request: ApplyWorktreeAdoptionRequest) => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.applyWorktreeAdoption(request.sourceWorkspaceId, request.worktreeId, {
      previewDigest: request.previewDigest, selectedPaths: request.selectedPaths, approvalId: request.approvalId,
    }, await requireAuthContext());
  });
  secureHandle("desktop:run-adoption-preview", async (_event, request: GetRunAdoptionPreviewRequest) => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.getRunAdoptionPreview(request.comparisonId, await requireAuthContext());
  });
  secureHandle("desktop:run-adoption-apply", async (_event, request: ApplyRunAdoptionRequest) => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    try {
      return await resolved.client.applyRunAdoption(request.adoptionId, request.selectedPaths, request.approvalId, await requireAuthContext());
    } catch (error) {
      if (error instanceof RemoteProtocolError && error.code === "approval_required" && error.detail.approvalId) {
        return { approval_required: true, approval_id: error.detail.approvalId, code: "approval_required", message: error.message };
      }
      throw error;
    }
  });
  secureHandle("desktop:run-adoption-discard", async (_event, request: DiscardRunAdoptionRequest) => {
    await requireExperimentReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    try {
      return await resolved.client.discardRunAdoption(request.adoptionId, request.cleanup !== false, request.approvalId, await requireAuthContext());
    } catch (error) {
      if (error instanceof RemoteProtocolError && error.code === "approval_required" && error.detail.approvalId) {
        return { approval_required: true, approval_id: error.detail.approvalId, code: "approval_required", message: error.message };
      }
      throw error;
    }
  });
  secureHandle("desktop:runtime-security-approval-decision", async (_event, request: RuntimeSecurityApprovalDecisionRequest) => {
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.decideSecurityApproval(request.approvalId, request.decision, await requireAuthContext());
  });
  secureHandle("desktop:runtime-run-approval-decision", async (_event, request: RuntimeRunApprovalDecisionRequest) => {
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.decideRunApproval(request.approvalId, request.decision, await requireAuthContext());
  });
  secureHandle("desktop:respond-chat-input", (_event, requestId, response) =>
    respondChatInput(
      typeof requestId === "string" ? requestId : "",
      typeof response === "string" || (response && typeof response === "object" && !Array.isArray(response))
        ? response as string | Record<string, unknown>
        : "",
    ),
  );
  secureHandle(
    "desktop:voice-transcription-start",
    (event, request: DesktopVoiceTranscriptionRequest) =>
      startVoiceTranscription(event.sender, request),
  );
  secureHandle(
    "desktop:voice-transcription-cancel",
    (_event, requestId: string) => cancelVoiceTranscription(requestId),
  );
  secureHandle(
    "desktop:voice-runtime-status",
    () => getVoiceRuntimeStatus(),
  );
  secureHandle(
    "desktop:voice-streaming-capabilities",
    () => getStreamingVoiceCapabilities(),
  );
  secureHandle(
    "desktop:voice-streaming-start",
    (event, request: DesktopStreamingVoiceStartRequest) => startStreamingVoiceTranscription(event.sender, request),
  );
  secureHandle(
    "desktop:voice-streaming-stop",
    (event, sessionId: string, reason?: "provider" | "local_vad" | "manual") => stopStreamingVoiceTranscription(
      event.sender,
      typeof sessionId === "string" ? sessionId : "",
      reason === "provider" || reason === "local_vad" ? reason : "manual",
    ),
  );
  secureHandle(
    "desktop:voice-streaming-cancel",
    (event, sessionId: string) => cancelStreamingVoiceTranscription(event.sender, typeof sessionId === "string" ? sessionId : ""),
  );
  ipcMain.on("desktop:voice-streaming-audio-port", (event: IpcMainEvent, request: unknown) => {
    if (!isTrustedSender(event as unknown as IpcMainInvokeEvent)) {
      event.ports[0]?.close();
      return;
    }
    const sessionId = getStringProperty(request, "sessionId");
    const port = event.ports[0];
    if (!sessionId || !port) {
      port?.close();
      return;
    }
    attachStreamingVoiceAudioPort(event.sender, sessionId, port);
  });
  secureHandle(
    "desktop:voice-synthesis-start",
    (event, request: DesktopVoiceSynthesisRequest) => startVoiceSynthesis(event.sender, request),
  );
  secureHandle(
    "desktop:voice-synthesis-cancel",
    (_event, requestId: string) => cancelVoiceSynthesis(requestId),
  );
  secureHandle(
    "desktop:voice-synthesis-runtime-status",
    () => getVoiceSynthesisRuntimeStatus(),
  );
  secureHandle(
    "desktop:voice-handoff-write",
    async (_event, request: DesktopVoiceTranscriptHandoffRequest) => {
      const workspacePath = getStringProperty(request, "workspacePath");
      if (!(await isAllowedOpenPath(workspacePath))) {
        throw new Error("Voice handoff workspace is not registered or allowed.");
      }
      return writeVoiceTranscriptHandoff(request);
    },
  );
  secureHandle("desktop:start-agent-run", (event, request) => {
    if (getA5ServiceGuidanceScenario()) {
      throw new Error("A5 service guidance blocks Agent runs until the service is available.");
    }
    return startAgentRun(event.sender, request);
  });
  secureHandle("desktop:abort-agent-run", (_event, requestId: string) =>
    abortAgentRun(requestId),
  );
  secureHandle("desktop:channel-live-sync", (_event, request: DesktopChannelLiveSyncRequest) => syncLiveChannelContext(request));
  secureHandle("desktop:channel-adapter-auth-poll", (_event, request: DesktopChannelAdapterAuthPollRequest) => pollChannelAdapterAuth(request));
  secureHandle("desktop:channel-adapter-auth-revoke", (_event, request: DesktopChannelAdapterAuthRevokeRequest) => revokeChannelAdapterAuth(request));
  secureHandle("desktop:channel-provider-token-configure", (_event, request: DesktopChannelProviderTokenConfigureRequest) => configureChannelProviderToken(request));
  secureHandle("desktop:recover-agent-run", (event, threadId: string) => recoverAgentRun(threadId, event.sender));
  secureHandle("desktop:save-api-key", (_event, apiKey: string) => {
    if (!is.dev) {
      return { ok: false, message: "This build receives service authorization through HepAI OIDC." };
    }
    return saveApiKeyAndSync(apiKey);
  });
  secureHandle("desktop:pick-files", async () => {
    if (process.env.OPENDRSAI_E2E_C1_MATERIAL_IMPORT === "1") {
      const fixturePaths = (process.env.OPENDRSAI_E2E_C1_IMPORT_PATHS || "").split("|").filter(Boolean);
      if (fixturePaths.length !== 7) throw new Error("C1 requires six supported fixtures and one failed fixture.");
      return describePickedFiles(fixturePaths, false);
    }
    if (process.env.OPENDRSAI_E2E_C3_MATERIAL_ROLES === "1") {
      const fixturePaths = (process.env.OPENDRSAI_E2E_C3_IMPORT_PATHS || "").split("|").filter(Boolean);
      if (fixturePaths.length !== 12 || fixturePaths.some((path) => !existsSync(path))) throw new Error("C3 requires exactly twelve readable golden fixtures.");
      return describePickedFiles(fixturePaths, false);
    }
    if (process.env.OPENDRSAI_E2E_C4_MATERIAL_SUGGESTIONS === "1") {
      const fixturePaths = (process.env.OPENDRSAI_E2E_C4_IMPORT_PATHS || "").split("|").filter(Boolean);
      if (fixturePaths.length < 1 || fixturePaths.length > 6 || fixturePaths.some((path) => !existsSync(path))) throw new Error("C4 requires one to six readable material fixtures.");
      return describePickedFiles(fixturePaths, false);
    }
    if (process.env.OPENDRSAI_E2E_C5_MATERIAL_CONSISTENCY === "1") {
      const fixturePaths = (process.env.OPENDRSAI_E2E_C5_IMPORT_PATHS || "").split("|").filter(Boolean);
      if (fixturePaths.length < 3 || fixturePaths.length > 6 || fixturePaths.some((path) => !existsSync(path))) throw new Error("C5 requires three to six readable material fixtures.");
      return describePickedFiles(fixturePaths, false);
    }
    if (process.env.OPENDRSAI_E2E_C6_MATERIAL_QUERY === "1") {
      const fixturePaths = (process.env.OPENDRSAI_E2E_C6_IMPORT_PATHS || "").split("|").filter(Boolean);
      if (fixturePaths.length !== 4 || fixturePaths.some((path) => !existsSync(path))) throw new Error("C6 requires exactly four readable material fixtures.");
      return describePickedFiles(fixturePaths, false);
    }
    if (process.env.OPENDRSAI_E2E_C7_ABNORMAL_FILES === "1") {
      const fixturePaths = (process.env.OPENDRSAI_E2E_C7_IMPORT_PATHS || "").split("|").filter(Boolean);
      if (fixturePaths.length !== 5 || fixturePaths.some((path) => !existsSync(path))) throw new Error("C7 requires exactly five abnormal-file fixtures.");
      return describePickedFiles(fixturePaths, false);
    }
    if (process.env.OPENDRSAI_E2E_C8_CHINESE_PRIVACY === "1") {
      const fixturePaths = (process.env.OPENDRSAI_E2E_C8_IMPORT_PATHS || "").split("|").filter(Boolean);
      if (fixturePaths.length !== 3 || fixturePaths.some((path) => !existsSync(path))) throw new Error("C8 requires exactly three D5/D7 fixtures.");
      return describePickedFiles(fixturePaths, false);
    }
    if (process.env.OPENDRSAI_E2E_FIRST_RUN_DRAFT_STAGE) {
      const fixturePath = process.env.OPENDRSAI_E2E_FIRST_RUN_DRAFT_FILE;
      if (!fixturePath || !existsSync(fixturePath)) throw new Error("First-run draft smoke requires a readable attachment fixture.");
      return describePickedFiles([fixturePath], false);
    }
    if (process.env.OPENDRSAI_E2E_M4_KEYBOARD === "1") {
      const fixturePath = process.env.OPENDRSAI_E2E_M4_CERN_PDF;
      if (!fixturePath || !existsSync(fixturePath)) throw new Error("M4 requires the fixed CERN PDF fixture.");
      return describePickedFiles([fixturePath], false);
    }
    if (process.env.OPENDRSAI_E2E_M6_PERFORMANCE === "1") {
      const fixturePaths = (process.env.OPENDRSAI_E2E_M6_IMPORT_PATHS || "")
        .split("|")
        .filter((path) => path && existsSync(path));
      if (fixturePaths.length !== 30) throw new Error("M6 requires exactly 30 import fixtures.");
      return describePickedFiles(fixturePaths, false);
    }
    if (!mainWindow) return { canceled: true, paths: [] };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Add files",
      properties: ["openFile", "multiSelections"],
    });
    return describePickedFiles(result.filePaths, result.canceled);
  });
  secureHandle("desktop:pick-folder", async () => {
    if (process.env.OPENDRSAI_E2E_C2_FOLDER_IMPORT === "1") {
      const fixturePath = process.env.OPENDRSAI_E2E_C2_FOLDER_PATH;
      if (!fixturePath || !existsSync(fixturePath)) throw new Error("C2 requires a folder fixture.");
      return { canceled: false, paths: [fixturePath] };
    }
    if (!mainWindow) return { canceled: true, paths: [] };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Add folder",
      properties: ["openDirectory"],
    });
    return { canceled: result.canceled, paths: result.filePaths };
  });
  secureHandle("desktop:browser-check-url", (_event, rawUrl: string) => browserTaskService.checkUrl(rawUrl));
  secureHandle("desktop:browser-action-request", (_event, request) => browserTaskService.requestAction(request));
  secureHandle("desktop:browser-task-start", async (event, request) => {
    browserTaskSubscribers.add(event.sender);
    return browserTaskService.start(request);
  });
  secureHandle("desktop:browser-task-stop", (_event, request) => browserTaskService.stop(request));
  secureHandle("desktop:browser-task-pending-approvals", () => browserTaskService.pendingApprovals());
  secureHandle("desktop:propose-approval", (_event, request) =>
    proposeDesktopApproval(request),
  );
  secureHandle("desktop:shell-command-approval", (event, request) =>
    requestTerminalShellCommandApproval(event, request),
  );
  secureHandle("desktop:git-commit-approval", (_event, request) =>
    requestGitCommitApproval(request),
  );
  secureHandle("desktop:fork-lifecycle-approval", (_event, request) =>
    requestForkLifecycleApproval(request),
  );
  secureHandle("desktop:fork-queue-start-approval", (_event, request) =>
    requestForkQueueStartApproval(request),
  );
  secureHandle("desktop:fork-queue-dispatch", (event, request) =>
    dispatchForkQueue(event.sender, request),
  );
  secureHandle("desktop:pending-approvals", () =>
    [...pendingDesktopApprovals.values()].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    ),
  );
  secureHandle("desktop:decide-approval", (event, request) =>
    decidePendingDesktopApproval(event, request),
  );
  secureHandle("desktop:browser-task-approve", async (_event, request) => {
    const approved = browserTaskService.approve(request);
    if (approved && request && typeof request === "object") {
      const row = request as { taskId?: string; actionId?: string };
      if (row.taskId && row.actionId) {
        pendingDesktopApprovals.delete(createBrowserTaskApprovalId(row.taskId, row.actionId));
        await persistDesktopApprovalState();
      }
    }
    return approved;
  });
}

let desktopApprovalDecisionQueue = Promise.resolve();
async function decidePendingDesktopApproval(event: IpcMainInvokeEvent, request: unknown): Promise<boolean> {
  const previous = desktopApprovalDecisionQueue;
  let release!: () => void;
  desktopApprovalDecisionQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await decidePendingDesktopApprovalUnlocked(event, request); }
  finally { release(); }
}

async function decidePendingDesktopApprovalUnlocked(
  event: IpcMainInvokeEvent,
  request: unknown,
): Promise<boolean> {
  if (!request || typeof request !== "object") return false;
  const candidate = request as { id?: unknown; approved?: unknown };
  if (typeof candidate.id !== "string" || typeof candidate.approved !== "boolean") {
    return false;
  }
  const typed = { id: candidate.id, approved: candidate.approved };
  const decisionReason =
    (request as { reason?: unknown }).reason === "cancel" ? "cancel" : "reject";
  const approval = pendingDesktopApprovals.get(typed.id);
  if (!approval) return false;
  if (typed.approved && executedDesktopApprovalIds.has(typed.id) && !pendingGitCommitApprovals.has(typed.id) && !pendingMcpToolExecutions.has(typed.id)) {
    pendingDesktopApprovals.delete(typed.id);
    deleteDesktopApprovalPayloads(typed.id);
    await persistDesktopApprovalState();
    return true;
  }
  for (const persistedPayload of pendingDesktopApprovalPayloads.values()) {
    if (persistedPayload.approvalId === typed.id) restoreDesktopApprovalPayloadOwner(persistedPayload);
  }
  const pendingShellCommand = pendingShellCommandApprovals.get(typed.id);
  const pendingWorkspaceMutation = pendingWorkspaceMutationApprovals.get(typed.id);
  const pendingWorkspaceCheckpointRestore = pendingWorkspaceCheckpointRestores.get(typed.id);
  const pendingGitCommit = pendingGitCommitApprovals.get(typed.id);
  const pendingRemoteGatewayInstall = pendingRemoteGatewayInstallApprovals.get(typed.id);
  const pendingForkLifecycle = pendingForkLifecycleApprovals.get(typed.id);
  const pendingForkQueueStart = pendingForkQueueStartApprovals.get(typed.id);
  const pendingForkConflictDraftWrite = pendingForkConflictDraftWrites.get(typed.id);
  const pendingChannelOutboundDraft = pendingChannelOutboundDrafts.get(typed.id);
  const pendingMcpLiveEnumeration = pendingMcpLiveEnumerations.get(typed.id);
  const pendingMcpToolExecution = pendingMcpToolExecutions.get(typed.id);
  const pendingF2ApprovalEffect = pendingF2ApprovalEffects.get(typed.id);
  const pendingF3ApprovalEffect = pendingF3ApprovalEffects.get(typed.id);
  let decided: boolean;
  try {
    decided = await (async () => {
  if (
    approval.source === "browser_task" &&
    approval.taskId &&
    approval.actionId
  ) {
    return browserTaskService.approve({ taskId: approval.taskId, actionId: approval.actionId, approved: typed.approved });
  }
  if (pendingShellCommand) {
    if (!typed.approved) return true;
    executedDesktopApprovalIds.add(typed.id);
    await assertExecutionAllowed("shell.command", { approved: true });
    const wrote = await writeTerminalSession(
      event,
      pendingShellCommand.terminalSessionId,
      pendingShellCommand.invocation,
    );
    if (wrote) {
      await markShellWorkflowStepRunning(pendingShellCommand);
    }
    return wrote;
  }
  if (pendingWorkspaceMutation) {
    if (!typed.approved) return true;
    executedDesktopApprovalIds.add(typed.id);
    await assertExecutionAllowed(
      getWorkspaceMutationActionKind(pendingWorkspaceMutation.action),
      { approved: true },
    );
    await executeWorkspaceMutation(
      pendingWorkspaceMutation.action,
      pendingWorkspaceMutation.request,
    );
    return true;
  }
  if (pendingWorkspaceCheckpointRestore) {
    if (!typed.approved) return true;
    executedDesktopApprovalIds.add(typed.id);
    await assertExecutionAllowed("workspace.revert", { approved: true });
    await restoreWorkspaceCheckpoint(pendingWorkspaceCheckpointRestore);
    return true;
  }
  if (pendingGitCommit) {
    if (!typed.approved) return true;
    executedDesktopApprovalIds.add(typed.id);
    await persistDesktopApprovalState();
    await assertExecutionAllowed("git.commit", { approved: true });
    await executeGitCommit(pendingGitCommit, typed.id);
    return true;
  }
  if (pendingRemoteGatewayInstall) {
    if (!typed.approved) return true;
    executedDesktopApprovalIds.add(typed.id);
    await assertExecutionAllowed("external.service", { approved: true });
    await installRemoteGateway(pendingRemoteGatewayInstall);
    return true;
  }
  if (pendingForkLifecycle) {
    if (!typed.approved) return true;
    executedDesktopApprovalIds.add(typed.id);
    await executeForkLifecycleApproval(pendingForkLifecycle);
    return true;
  }
  if (pendingForkQueueStart) {
    if (typed.approved) executedDesktopApprovalIds.add(typed.id);
    await executeForkQueueStartApproval(pendingForkQueueStart, typed.approved);
    return true;
  }
  if (pendingForkConflictDraftWrite) {
    if (!typed.approved) return true;
    executedDesktopApprovalIds.add(typed.id);
    await assertExecutionAllowed("workspace.revert", { approved: true });
    await executeForkConflictDraftWrite(pendingForkConflictDraftWrite);
    return true;
  }
  if (pendingChannelOutboundDraft) {
    if (typed.approved) {
      executedDesktopApprovalIds.add(typed.id);
      await assertExecutionAllowed("external.service", { approved: true });
    }
    const delivery = await executeChannelOutboundDeliveryAsync(
      pendingChannelOutboundDraft,
      typed.id,
      typed.approved,
    );
    return !typed.approved || delivery.status !== "failed";
  }
  if (pendingMcpLiveEnumeration) {
    if (!typed.approved) {
      if (decisionReason === "cancel") {
        recordCancelledMcpLiveEnumerationAudit(pendingMcpLiveEnumeration, typed.id);
      }
      return true;
    }
    if (typed.approved) executedDesktopApprovalIds.add(typed.id);
    await assertExecutionAllowed("network.request", { approved: true });
    await enumerateMcpLiveServer(pendingMcpLiveEnumeration);
    return true;
  }
  if (pendingMcpToolExecution) {
    const atMostOnceDecision = decideMcpAtMostOnce(executedDesktopApprovalIds.has(typed.id), typed.approved);
    if (atMostOnceDecision === "acknowledge") {
      recordAmbiguousMcpToolExecutionAudit(pendingMcpToolExecution, typed.id);
      return true;
    }
    if (atMostOnceDecision === "keep") return false;
    if (atMostOnceDecision === "reject") {
      if (decisionReason === "cancel") {
        recordCancelledMcpToolExecutionAudit(pendingMcpToolExecution, typed.id);
      } else {
        recordRejectedMcpToolExecutionAudit(pendingMcpToolExecution, typed.id);
      }
      return true;
    }
    executedDesktopApprovalIds.add(typed.id);
    pendingDesktopApprovals.set(typed.id, { ...approval, executionState: "executing" });
    await persistDesktopApprovalState();
    await assertExecutionAllowed("external.service", { approved: true });
    await executeMcpToolAfterApproval(pendingMcpToolExecution, typed.id);
    return true;
  }
  if (pendingF2ApprovalEffect) {
    if (!typed.approved) return true;
    executedDesktopApprovalIds.add(typed.id);
    executeF2ApprovalEffect(typed.id, pendingF2ApprovalEffect);
    return true;
  }
  if (pendingF3ApprovalEffect) {
    if (!typed.approved) return true;
    executedDesktopApprovalIds.add(typed.id);
    executeF3ApprovalEffect(typed.id, pendingF3ApprovalEffect);
    return true;
  }
    return !typed.approved;
    })();
  } catch (error) {
    const mcpRequest = pendingMcpToolExecutions.get(typed.id);
    if (mcpRequest && executedDesktopApprovalIds.has(typed.id)) {
      const current = pendingDesktopApprovals.get(typed.id);
      if (current) pendingDesktopApprovals.set(typed.id, recoverAmbiguousMcpApproval(current, mcpRequest));
      try { recordAmbiguousMcpToolExecutionAudit(mcpRequest, typed.id); } catch { /* Keep the durable ambiguous approval even if workspace audit is unavailable. */ }
    } else {
      executedDesktopApprovalIds.delete(typed.id);
    }
    await persistDesktopApprovalState();
    throw error;
  }
  if (!decided) {
    executedDesktopApprovalIds.delete(typed.id);
    await persistDesktopApprovalState();
    return false;
  }
  pendingDesktopApprovals.delete(typed.id);
  pendingShellCommandApprovals.delete(typed.id);
  pendingWorkspaceMutationApprovals.delete(typed.id);
  pendingWorkspaceCheckpointRestores.delete(typed.id);
  pendingGitCommitApprovals.delete(typed.id);
  pendingRemoteGatewayInstallApprovals.delete(typed.id);
  pendingForkLifecycleApprovals.delete(typed.id);
  pendingForkQueueStartApprovals.delete(typed.id);
  pendingForkConflictDraftWrites.delete(typed.id);
  pendingChannelOutboundDrafts.delete(typed.id);
  pendingMcpLiveEnumerations.delete(typed.id);
  pendingMcpToolExecutions.delete(typed.id);
  pendingF2ApprovalEffects.delete(typed.id);
  pendingF3ApprovalEffects.delete(typed.id);
  deleteDesktopApprovalPayloads(typed.id);
  await persistDesktopApprovalState();
  return true;
}

async function markShellWorkflowStepRunning(request: {
  workflowRunId?: string;
  workflowStepId?: string;
}): Promise<void> {
  if (!request.workflowRunId || !request.workflowStepId) return;
  const run = await markWorkflowRunTerminalStepRunning({
    runId: request.workflowRunId,
    stepId: request.workflowStepId,
  });
  if (run) {
    await upsertBackgroundTaskForWorkflowRun(run);
  }
}

function resolveBrowserUsePythonCommand(preferredPython?: string | null): string {
  if (process.env.OPENDRSAI_BROWSER_USE_PYTHON) {
    return process.env.OPENDRSAI_BROWSER_USE_PYTHON;
  }
  const python311 = "C:\\Python311\\python.exe";
  if (existsSync(python311)) return python311;
  return preferredPython || process.env.PYTHON || "python";
}

async function autoStartGatewayWhenInstalled(): Promise<void> {
  if (getGatewayStartupMode() !== "eager") return;
  try {
    const install = await getInstallStatus();
    if (!install.installed) return;
    if (await startGateway()) await migrateLegacyAgentRunsToRuntime();
  } catch (error) {
    console.warn(
      "[desktop] Gateway autostart skipped:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

let deferredStartupStarted = false;
async function startDeferredStartupTasks(): Promise<void> {
  if (deferredStartupStarted) return;
  deferredStartupStarted = true;
  recordStartupMilestone("deferred-tasks-start");
  recordE2eStartupTrace("startup:deferred-tasks-start");
  await recoverWorkflowRunStateAfterRestart();
  startScheduledTaskWorkerIfEnabled();
  await autoStartGatewayWhenInstalled();
  await restorePersistedRemoteWorkspaces();
  recordStartupMilestone("deferred-tasks-complete");
  recordE2eStartupTrace("startup:deferred-tasks-complete");
}

app.whenReady().then(async () => {
  recordStartupMilestone("electron-ready");
  configureCompletionNotifications({
    notifications: WINDOWS_NOTIFICATION_SERVICE,
    focusApp: focusMainWindow,
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
  await restoreDesktopApprovalState();
  confirmPendingUpdateLaunch();
  restorePreparedUpdate();
  cleanupExpiredVoiceTempFiles();
  if (!singleInstanceLock) return;
  if (process.env.OPENDRSAI_E2E_UPDATE_PROTOCOL === "1") {
    void runHeadlessUpdateProtocolSmoke();
    return;
  }
  if (process.env.OPENDRSAI_E2E_OIDC_HEADLESS === "1") {
    void runHeadlessOidcSmoke();
    return;
  }
  registerDeepLinkProtocol();
  registerRendererProtocol();
  await desktopDiagnostics.initialize();
  await Promise.all([productionDiagnostics.initialize(), interactiveDebugPolicy.initialize()]);
  desktopDiagnostics.setPublisher((event) => {
    productionDiagnostics.observeEvent(Buffer.byteLength(JSON.stringify(event), "utf8"), event.workspaceId);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send("desktop:diagnostics-event", event);
      }
    }
  });
  interactiveDebugger.setPublisher((debugSession) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send("desktop:interactive-debug-event", debugSession);
    }
    void desktopDiagnostics.record({
      traceId: debugSession.traceId ?? debugSession.id,
      spanId: debugSession.id,
      module: "desktop",
      component: "interactive-debugger",
      operation: `debug.${debugSession.state}`,
      message: debugSession.message,
      status: debugSession.state === "failed" ? "failed"
        : debugSession.state === "paused" ? "waiting"
        : debugSession.state === "disconnected" || debugSession.state === "stopped" ? "completed"
        : "running",
      level: debugSession.state === "failed" ? "error" : debugSession.state === "paused" ? "warn" : "info",
      workspaceId: debugSession.workspaceId,
      attributes: { target: debugSession.target.kind, breakpointCount: debugSession.breakpoints.length },
    });
  });
  registerIpc();
  setRemoteWorkspaceStatusPublisher((status) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("desktop:remote-workspace-status-event", status);
    desktopDiagnostics.registerHealth({
      id: `remote:${status.hostAlias}`,
      module: "workspace",
      component: "ssh-transport",
      state: status.connected && status.gatewayReady ? "running"
        : status.connectionState === "failed" ? "failed"
        : status.connectionState === "degraded" ? "degraded"
        : status.connectionState === "reconnecting" ? "starting"
        : "disconnected",
      message: status.error || `Remote workspace is ${status.connectionState}`,
      version: status.gatewayVersion,
      restartCount: 0,
      retryCount: status.connectionState === "reconnecting" ? 1 : 0,
      lastErrorCode: status.failureKind,
    });
  });
  setRemoteGatewayOperationPublisher((operation) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("desktop:remote-gateway-operation-event", operation);
    void desktopDiagnostics.record({
      traceId: operation.operationId,
      module: "runtime",
      component: "remote-runtime",
      operation: `remote-gateway.${operation.action}.${operation.phase}`,
      message: operation.message,
      status: operation.state === "running" ? "running"
        : operation.state === "completed" ? "completed"
        : operation.state === "cancelled" ? "cancelled"
        : "failed",
      level: operation.state === "failed" ? "error" : "info",
      remoteHostId: operation.hostAlias,
      attributes: { progress: operation.progress, phase: operation.phase },
    });
  });
  setRemoteFileChangePublisher((change) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("desktop:workspace-file-change-event", change);
  });
  createWindow();
  startUpdateScheduler();
  handleDeepLinkArgv(process.argv);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

async function runHeadlessOidcSmoke(): Promise<void> {
  const resultPath = process.env.OPENDRSAI_E2E_RESULT;
  if (!resultPath) {
    app.exit(1);
    return;
  }
  const result: {
    ok: boolean;
    checks: Record<string, boolean>;
    details: Record<string, unknown>;
    error?: string;
  } = { ok: false, checks: {}, details: {} };
  try {
    const loginResult = await startOidcLogin({ rememberMe: true });
    result.details.login = {
      ok: loginResult.ok,
      message: loginResult.message,
      session: loginResult.session,
    };
    result.checks.oidcLoginOk = Boolean(loginResult.ok);
    result.checks.oidcPublicSession = publicSessionLooksHeadlessOidc(
      loginResult.session,
    );

    const bootstrap = await bootstrapDesktop();
    result.details.bootstrap = bootstrap;
    result.checks.oidcBootstrapReady = Boolean(
      bootstrap.ready &&
      bootstrap.defaults.modelAlias === "drsai" &&
      bootstrap.models.some((model) => model.id === "drsai") &&
      bootstrap.capabilities.chat &&
      bootstrap.capabilities.tools.includes("files") &&
      bootstrap.capabilities.tools.includes("shell") &&
      bootstrap.capabilities.tools.includes("git"),
    );

    const restored = await getAuthSession();
    result.details.restored = restored;
    result.checks.restoredSession = publicSessionLooksHeadlessOidc(restored);

    const refreshed = await refreshAuthSession();
    result.details.refreshed = refreshed;
    result.checks.refreshSession = publicSessionLooksHeadlessOidc(refreshed);

    const authContext = await requireAuthContext();
    result.details.authContext = {
      userId: authContext.userId,
      authMode: authContext.authMode,
      hasAccessToken: Boolean(authContext.accessToken),
      publicSession: authContext.session,
    };
    result.checks.authContextUsesOidc = authContext.authMode === "oidc";
    result.checks.authContextHasBearerToken = Boolean(authContext.accessToken);
    result.checks.authContextPublicSession = publicSessionLooksHeadlessOidc(
      authContext.session,
    );

    const gatewayEvents: Array<{ channel: string; event: Record<string, unknown> }> = [];
    const gatewayWebContents = {
      isDestroyed() {
        return false;
      },
      send(channel: string, event: Record<string, unknown>) {
        gatewayEvents.push({ channel, event });
      },
    } as unknown as WebContents;

    const chatRequestId = "e2e-oidc-chat-0001";
    result.details.oidcChatReturnedRequestId = startChat(gatewayWebContents, {
      requestId: chatRequestId,
      model: "deepseek-v4-pro",
      workspacePath: process.cwd(),
      messages: [{ role: "user", content: "oidc chat bearer check" }],
    });
    await waitForHeadlessGatewayTerminal(gatewayEvents, chatRequestId);
    const chatEvents = gatewayEvents
      .filter((item) => item.channel === "desktop:chat-event" && item.event.requestId === chatRequestId)
      .map((item) => item.event);
    result.details.oidcChatEvents = summarizeHeadlessGatewayEvents(chatEvents);
    result.checks.oidcChatStart = chatEvents.some((event) => event.type === "start");
    result.checks.oidcChatChunk = chatEvents.some(
      (event) => event.type === "chunk" && String(event.content || "").includes("oidc chat bearer ok")
        || event.type === "structured" && JSON.stringify(event.structuredEvent || {}).includes("oidc chat bearer ok"),
    );
    result.checks.oidcChatDone = chatEvents.some(
      (event) => event.type === "done"
        || event.type === "structured" && (event.structuredEvent as { type?: string } | undefined)?.type === "turn.completed",
    );
    result.checks.oidcChatNoError = !chatEvents.some((event) => event.type === "error" || event.type === "aborted");

    const agentRequestId = "e2e-oidc-agent-0001";
    result.details.oidcAgentReturned = await startAgentRun(gatewayWebContents, {
      requestId: agentRequestId,
      sessionId: "e2e-oidc-agent-session",
      runId: "e2e-oidc-agent-run",
      task: "oidc agent bearer check",
      model: "drsai",
      metadata: { source: "e2e-oidc" },
    });
    await waitForHeadlessGatewayTerminal(gatewayEvents, agentRequestId);
    const agentEvents = gatewayEvents
      .filter((item) => item.channel === "desktop:agent-run-event" && item.event.requestId === agentRequestId)
      .map((item) => item.event);
    result.details.oidcAgentEvents = summarizeHeadlessGatewayEvents(agentEvents);
    result.checks.oidcAgentStart = agentEvents.some((event) => event.type === "start");
    result.checks.oidcAgentChunk = agentEvents.some(
      (event) => event.type === "chunk" && String(event.content || "").includes("oidc agent bearer ok"),
    );
    result.checks.oidcAgentDone = agentEvents.some((event) => event.type === "done");
    result.checks.oidcAgentNoError = !agentEvents.some((event) => event.type === "error" || event.type === "aborted");

    const storage = readHeadlessOidcStorage();
    result.details.storage = storage.details;
    result.checks.sessionFileExists = storage.checks.exists;
    result.checks.sessionUsesEncryptedTokens =
      storage.checks.usesEncryptedTokens;
    result.checks.sessionOmitsPlainTokens = storage.checks.omitsPlainTokens;

    const logoutResult = await logout({ clearLocalData: false });
    result.details.logout = logoutResult;
    result.checks.logoutOk = Boolean(logoutResult.ok);
    const afterLogout = await getAuthSession();
    result.details.afterLogout = afterLogout;
    result.checks.afterLogoutAnonymous = Boolean(
      afterLogout.authenticated === false,
    );
    result.checks.logoutClearsSessionFile = !existsSync(
      join(DRSAI_HOME, "auth", "auth.json"),
    );

    result.ok = Object.values(result.checks).every(Boolean);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  app.exit(result.ok ? 0 : 1);
}

async function waitForHeadlessGatewayTerminal(
  events: Array<{ event: Record<string, unknown> }>,
  requestId: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (
      events.some(
        (item) =>
          item.event.requestId === requestId &&
          (item.event.type === "done" ||
            (item.event.type === "structured" && (item.event.structuredEvent as { type?: string } | undefined)?.type === "turn.completed") ||
            item.event.type === "error" ||
            item.event.type === "aborted"),
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function summarizeHeadlessGatewayEvents(
  events: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return events.map((event) => ({
    type: event.type,
    requestId: event.requestId,
    content: event.content,
    error: event.error,
    structuredEvent: event.structuredEvent,
  }));
}

function publicSessionLooksHeadlessOidc(
  session: Awaited<ReturnType<typeof getAuthSession>> | null,
): boolean {
  if (!session) return false;
  const asRecord = session as unknown as Record<string, unknown>;
  const strictFakeUser =
    !process.env.OPENDRSAI_E2E_OIDC_EXTERNAL_ISSUER &&
    session.user?.id === "1f4b65b9-9f5d-4dfc-8d7d-10a61cd9f651" &&
    session.user?.email === "e2e-hai-user@ihep.ac.cn";
  const externalIssuerUser =
    Boolean(process.env.OPENDRSAI_E2E_OIDC_EXTERNAL_ISSUER) &&
    Boolean(session.user?.id) &&
    Boolean(session.user?.name || session.user?.email);
  return Boolean(
    session.authenticated === true &&
    session.authMode === "oidc" &&
    session.authProvider === "hai" &&
    session.user &&
    (strictFakeUser || externalIssuerUser) &&
    session.refreshable === true &&
    !("accessToken" in asRecord) &&
    !("refreshToken" in asRecord) &&
    !("idToken" in asRecord),
  );
}

function readHeadlessOidcStorage(): {
  checks: {
    exists: boolean;
    usesEncryptedTokens: boolean;
    omitsPlainTokens: boolean;
  };
  details: Record<string, unknown>;
} {
  const sessionPath = join(DRSAI_HOME, "auth", "auth.json");
  if (!existsSync(sessionPath)) {
    return {
      checks: {
        exists: false,
        usesEncryptedTokens: false,
        omitsPlainTokens: false,
      },
      details: { sessionPath, exists: false },
    };
  }
  const parsed = JSON.parse(readFileSync(sessionPath, "utf8")) as Record<
    string,
    unknown
  >;
  return {
    checks: {
      exists: true,
      usesEncryptedTokens: Boolean(
        parsed.encryptedAccessToken &&
        parsed.encryptedRefreshToken &&
        parsed.encryptedIdToken,
      ),
      omitsPlainTokens:
        !("accessToken" in parsed) &&
        !("refreshToken" in parsed) &&
        !("idToken" in parsed),
    },
    details: {
      sessionPath,
      exists: true,
      keys: Object.keys(parsed).sort(),
      authMode: parsed.authMode,
      authProvider: parsed.authProvider,
      hasEncryptedAccessToken: Boolean(parsed.encryptedAccessToken),
      hasEncryptedRefreshToken: Boolean(parsed.encryptedRefreshToken),
      hasEncryptedIdToken: Boolean(parsed.encryptedIdToken),
      hasPlainAccessToken: "accessToken" in parsed,
      hasPlainRefreshToken: "refreshToken" in parsed,
      hasPlainIdToken: "idToken" in parsed,
    },
  };
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let gatewayShutdownComplete = false;
let gatewayShutdownStarted = false;

app.on("before-quit", (event) => {
  appQuitRequested = true;
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    cancelVoiceTranscriptionsForSender(mainWindow.webContents);
    cancelVoiceSynthesisForSender(mainWindow.webContents);
    cancelStreamingVoiceSessionsForSender(mainWindow.webContents);
  }
  stopScheduledTaskWorker();
  browserTaskService.shutdown();
  killAllTerminalSessions();
  stopAllRemoteWorkspaces();
  if (gatewayShutdownComplete) return;
  event.preventDefault();
  if (gatewayShutdownStarted) return;
  gatewayShutdownStarted = true;
  void closeMobilePairingControllers()
    .then(() => shutdownGateway(true))
    .catch((error) => {
      console.error("[desktop] Failed to stop gateway during shutdown:", error);
    })
    .finally(() => {
      gatewayShutdownComplete = true;
      app.quit();
    });
});

async function runHeadlessUpdateProtocolSmoke(): Promise<void> {
  const resultPath = process.env.OPENDRSAI_E2E_RESULT;
  if (!resultPath) {
    app.exit(1);
    return;
  }
  const result: {
    ok: boolean;
    checks: Record<string, boolean>;
    details: Record<string, unknown>;
    error?: string;
  } = { ok: false, checks: {}, details: {} };
  try {
    if (process.env.OPENDRSAI_E2E_UPDATE_OUTCOME_ONLY === "1") {
      const restored = getUpdateStatus();
      result.details.restored = restored;
      result.checks.rollbackDetected = restored.phase === "rolled-back";
      result.checks.previousRuntimeActive = restored.currentVersion === app.getVersion();
      result.checks.recoveryIsAutomatic = restored.recovery === "automatic-rollback";
      result.checks.failedVersionVisible = Boolean(restored.version);
      result.ok = Object.values(result.checks).every(Boolean);
      mkdirSync(dirname(resultPath), { recursive: true });
      writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      app.exit(result.ok ? 0 : 1);
      return;
    }
    const checked = await checkForUpdates();
    result.details.checked = checked;
    result.checks.updateAvailable =
      (checked.phase === "available" && checked.canDownload) ||
      (checked.phase === "ready" && checked.canInstall);
    const downloaded = await downloadUpdate();
    result.details.downloaded = downloaded;
    result.checks.updateReady = downloaded.phase === "ready" && downloaded.canInstall;
    result.checks.downloadComplete = downloaded.downloaded && downloaded.progress === 100;
    result.checks.noUpdateError = downloaded.error === null;
    result.ok = Object.values(result.checks).every(Boolean);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  app.exit(result.ok ? 0 : 1);
}
