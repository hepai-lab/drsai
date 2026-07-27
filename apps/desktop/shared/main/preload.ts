import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

const desktopPlatform = process.platform === "darwin" ? "macos" : "windows";
const applyDesktopPlatformMarker = (): void => {
  document.documentElement.dataset.desktopPlatform = desktopPlatform;
};
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyDesktopPlatformMarker, { once: true });
} else {
  applyDesktopPlatformMarker();
}

import type {
  DesktopApi,
  DesktopOpenRequest,
  DesktopLifecycleEvent,
  DesktopSystemPermissionKind,
  DesktopSystemPermissionStatus,
  MaterialConsistencyAnalysisRequest,
  MaterialConsistencyAnalysisResult,
  MaterialQueryRequest,
  MaterialQueryResult,
  MaterialRoleAnalysisRequest,
  MaterialRoleAnalysisResult,
  DesktopDataCleanupRequest,
  DesktopDataCleanupScope,
  DiagnosticEvent,
  DiagnosticEventInput,
  DiagnosticQuery,
  DiagnosticSourceContextRequest,
  DiagnosticSourceOpenRequest,
  DiagnosticIssueUpdateRequest,
  InteractiveDebugBreakpointRequest,
  InteractiveDebugControlRequest,
  InteractiveDebugEvaluateRequest,
  InteractiveDebugSession,
  InteractiveDebugStartRequest,
  AgentRunEvent,
  AgentRunRequest,
  AuthSession,
  ChatEvent,
  ChatRequest,
  CompletionNotificationClickEvent,
  CompletionNotificationPreference,
  BrowserActionRequest,
  BrowserActionResult,
  BrowserTaskApprovalRequest,
  BrowserTaskEvent,
  BrowserTaskStartRequest,
  BrowserTaskStopRequest,
  BrowserUrlCheck,
  CreateWorkspaceRequest,
  ConnectRemoteWorkspaceRequest,
  RemoteGatewayInstallRequest,
  RemoteGatewayOperationEvent,
  RemoteWorkspaceStatus,
  WorkspaceFileChangeEvent,
  CreateThreadRequest,
  DesktopBackgroundTask,
  DesktopBackgroundTaskActionRequest,
  DesktopBackgroundTaskEnqueueRequest,
  DesktopBackgroundTaskListRequest,
  DesktopBackgroundTaskRecoveryResult,
  DesktopBackgroundTaskUpdateRequest,
  DesktopAnomalyDecisionApplyRequest,
  DesktopAnomalyDecisionApplyResult,
  DesktopReusableTask,
  DesktopReusableTaskRunPrepareRequest,
  DesktopReusableTaskRunRecipe,
  DesktopReusableTaskSaveRequest,
  DesktopChannelAdapterConfigureRequest,
  DesktopChannelAdapterConfigureResult,
  DesktopChannelAdapterAuthStartRequest,
  DesktopChannelAdapterAuthStartResult,
  DesktopChannelAdapterAuthPollRequest,
  DesktopChannelAdapterAuthPollResult,
  DesktopChannelAdapterAuthRevokeRequest,
  DesktopChannelAdapterAuthRevokeResult,
  DesktopChannelProviderTokenConfigureRequest,
  DesktopChannelProviderTokenConfigureResult,
  DesktopChannelAdapterListResult,
  DesktopChannelContextImportRequest,
  DesktopChannelContextImportResult,
  DesktopChannelLiveSyncRequest,
  DesktopChannelInboundEvent,
  DesktopChannelInboundEventListRequest,
  DesktopChannelInboundEventRouteRequest,
  DesktopChannelInboundEventRouteResult,
  DesktopChannelOutboundDelivery,
  DesktopChannelOutboundDeliveryListRequest,
  DesktopChannelOutboundDraftRequest,
  DesktopChannelOutboundDraftResult,
  DesktopChannelSnapshotSyncRequest,
  DesktopChannelSnapshotSyncResult,
  DesktopExternalConnectionReadinessResult,
  DesktopApprovalProposalRequest,
  DesktopApprovalProposalResult,
  DesktopHealth,
  DesktopBootstrapResult,
  DesktopForkWorktreeRequest,
  DesktopForkWorktreeResult,
  DesktopWorktreeListRequest,
  DesktopWorktreeSummary,
  DesktopWorktreeEventRequest,
  DesktopWorktreeEventBatch,
  DesktopWorktreeMigrationDiagnostic,
  DesktopForkLifecycleApprovalRequest,
  DesktopForkLifecycleApprovalResult,
  DesktopForkConflictDraftWriteRequest,
  DesktopForkConflictDraftWriteResult,
  DesktopForkQueueDispatchRequest,
  DesktopForkQueueDispatchResult,
  DesktopForkQueueStartApprovalRequest,
  DesktopForkQueueStartApprovalResult,
  DesktopIdeContextSnapshot,
  DesktopMcpContextRequest,
  DesktopMcpContextResult,
  DesktopMcpActiveSession,
  DesktopMcpActiveSessionListRequest,
  DesktopMcpReusableSession,
  DesktopMcpReusableSessionCloseRequest,
  DesktopMcpReusableSessionCloseResult,
  DesktopMcpReusableSessionListRequest,
  DesktopMcpLiveEnumerationRequest,
  DesktopMcpLiveEnumerationResult,
  DesktopMcpSessionCancelRequest,
  DesktopMcpSessionCancelResult,
  DesktopMcpSessionAuditEntry,
  DesktopMcpSessionAuditListRequest,
  DesktopMcpToolExecutionAuditEntry,
  DesktopMcpToolExecutionAuditListRequest,
  DesktopMcpToolExecutionApprovalRequest,
  DesktopMcpToolExecutionApprovalResult,
  DesktopApprovalDecisionRequest,
  DesktopPendingApproval,
  DesktopProviderErrorAnalyticsRecord,
  DesktopProviderUsageAnalyticsRecord,
  DesktopGitCommitApprovalRequest,
  DesktopShellCommandApprovalRequest,
  DesktopCustomCommand,
  DesktopCustomCommandDeleteRequest,
  DesktopCustomCommandDeleteResult,
  DesktopCustomCommandListRequest,
  DesktopCustomCommandUpsertRequest,
  DesktopThreadSnapshot,
  DesktopThreadContentSearchRequest,
  DesktopThreadContentSearchResult,
  DesktopVoiceTranscriptHandoffRequest,
  DesktopVoiceTranscriptHandoffResult,
  DesktopVoiceTranscriptionRequest,
  DesktopVoiceTranscriptionStartResult,
  DesktopVoiceRuntimeStatus,
  DesktopVoiceTranscriptionEvent,
  DesktopStreamingVoiceAudioChunk,
  DesktopStreamingVoiceCapabilities,
  DesktopStreamingVoiceStartRequest,
  DesktopStreamingVoiceStartResult,
  DesktopStreamingVoiceTranscriptionEvent,
  DesktopVoiceSynthesisEvent,
  DesktopVoiceSynthesisRequest,
  DesktopVoiceSynthesisRuntimeStatus,
  DesktopVoiceSynthesisStartResult,
  DesktopScheduledTask,
  DesktopScheduledTaskCreateRequest,
  DesktopScheduledTaskDeleteRequest,
  DesktopScheduledTaskDeleteResult,
  DesktopScheduledTaskListRequest,
  DesktopScheduledTaskRunRequest,
  DesktopScheduledTaskRunResult,
  DesktopScheduledTaskWorkerStatus,
  DesktopScheduledTaskUpdateRequest,
  DesktopShareCreateRequest,
  DesktopShareInspectionRequest,
  DesktopShareInspectionResult,
  DesktopSharePermissionUpdateRequest,
  DesktopShareRevokeRequest,
  DesktopShareRevocationResult,
  DesktopShareVersionInspection,
  DesktopShareVersionInspectionRequest,
  DesktopShareVersionPublishRequest,
  DesktopShareVersionPublishResult,
  DesktopShareComment,
  DesktopShareCommentAddRequest,
  DesktopShareCommentListRequest,
  DesktopShareCommentTask,
  DesktopShareCommentTaskCompleteRequest,
  DesktopShareCommentTaskCreateRequest,
  DesktopShareCommentTaskListRequest,
  DesktopShareCommentTaskPreview,
  DesktopShareCommentTaskPreviewRequest,
  DesktopShareCommentTaskUpdateRequest,
  DesktopShareContinuationRequest,
  DesktopShareContinuationResult,
  DesktopShareAuditEntry,
  DesktopShareAuditListRequest,
  DesktopShareManifest,
  DesktopSharedObjectOpenRequest,
  DesktopSharedObjectOpenResult,
  DesktopSharedArtifactDownloadRequest,
  DesktopSharedArtifactDownloadResult,
  DesktopProjectMemoryAddRequest,
  DesktopProjectMemoryClearRequest,
  DesktopProjectMemoryClearResult,
  DesktopProjectMemoryEntry,
  DesktopProjectMemoryListRequest,
  DesktopProjectMemoryUpdateRequest,
  DesktopUserPreference,
  DesktopUserPreferenceDeleteRequest,
  DesktopUserPreferenceDeleteResult,
  DesktopUserPreferenceUpsertRequest,
  DesktopTeamMemoryAddRequest,
  DesktopTeamMemoryDeleteRequest,
  DesktopTeamMemoryDeleteResult,
  DesktopTeamMemoryEntry,
  DesktopTeamMemoryListRequest,
  DesktopProjectSkillDraft,
  DesktopProjectSkillDraftCreateRequest,
  DesktopProjectSkillDraftListRequest,
  DesktopProjectSkillInstallRequest,
  DesktopProjectSkillInstallResult,
  DesktopProjectSkillPublishRequest,
  DesktopProjectSkillPublishResult,
  DesktopWorkflowMarketplaceListResult,
  DesktopWorkflowMarketplaceSyncRequest,
  DesktopWorkflowMarketplaceSyncResult,
  DesktopWorkflowRun,
  DesktopWorkflowRunPrepareRequest,
  DesktopWorkflowRunPrepareResult,
  DesktopWorkflowRunStepCompleteRequest,
  DesktopWorkflowRunStepCompleteResult,
  DesktopWorkflowRunStepDispatchRequest,
  DesktopWorkflowRunStepDispatchResult,
  DesktopWorkflowRunStartRequest,
  DesktopWorkflowRunStartResult,
  DesktopSsoPollResult,
  DesktopSsoStartResult,
  GatewayStatus,
  InstallStatus,
  InstallProgress,
  LoginRequest,
  LoginResult,
  LogoutOptions,
  ManagerPresentationCancelRequest,
  ManagerPresentationCancelResult,
  ManagerPresentationPauseRequest,
  ManagerPresentationPauseResult,
  ManagerPresentationRecoveryRequest,
  ManagerPresentationRecoveryResult,
  ManagerPresentationRecoveryDecisionRequest,
  ManagerPresentationRecoveryDecisionResult,
  ManagerPresentationGenerateRequest,
  ManagerPresentationGenerateResult,
  ManagerPresentationRequirementUpdateRequest,
  ManagerPresentationRequirementUpdateResult,
  ManagerPresentationProgressEvent,
  PdfPageOpenRequest,
  PdfPageOpenResult,
  MyDrSaiConfig,
  OidcLoginDebugEvent,
  SaveApiKeyResult,
  StartInstallOptions,
  UpdateMyDrSaiConfigRequest,
  UpdateThreadRequest,
  UpdateStatus,
  UpdateWorkspaceRequest,
  WorkspaceContextOverview,
  WorkspaceCheckpoint,
  WorkspaceCheckpointAcceptRequest,
  WorkspaceCheckpointCreateRequest,
  WorkspaceCheckpointPreviewRequest,
  WorkspaceCheckpointPreviewResult,
  WorkspaceCheckpointRestoreRequest,
  WorkspaceCheckpointRestoreResult,
  WorkspaceFilePreview,
  WorkspaceFilePreviewRequest,
  WorkspaceFileSaveAsRequest,
  WorkspaceFileSaveAsResult,
  WorkspaceFileWriteRequest,
  WorkspaceFileWriteResult,
  WorkspaceFileTreeRequest,
  WorkspaceFileTreeResult,
  WorkspaceFolderSummaryRequest,
  WorkspaceFolderSummaryResult,
  WorkspaceGitFileAtRefRequest,
  WorkspaceGitFileAtRefResult,
  WorkspaceGitDiffRequest,
  WorkspaceGitDiffResult,
  WorkspaceHunkActionRequest,
  WorkspaceHunkActionResult,
  WorkspaceRevertFileRequest,
  WorkspaceRevertFileResult,
  WorkspaceStageFileRequest,
  WorkspaceStageFileResult,
} from "../api/desktopApi";

const streamingVoicePorts = new Map<string, MessagePort>();

const api: DesktopApi = {
  getPlatformDescriptor: () => ipcRenderer.invoke("desktop:platform-descriptor"),
  onOpenRequest: (callback: (request: DesktopOpenRequest) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, request: DesktopOpenRequest): void => callback(request);
    ipcRenderer.on("desktop:open-request", listener);
    return () => ipcRenderer.removeListener("desktop:open-request", listener);
  },
  onLifecycleEvent: (callback: (event: DesktopLifecycleEvent) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, event: DesktopLifecycleEvent): void => callback(event);
    ipcRenderer.on("desktop:lifecycle-event", listener);
    return () => ipcRenderer.removeListener("desktop:lifecycle-event", listener);
  },
  getSystemPermissions: (): Promise<DesktopSystemPermissionStatus[]> =>
    ipcRenderer.invoke("desktop:system-permissions-get"),
  requestSystemPermission: (kind: DesktopSystemPermissionKind): Promise<DesktopSystemPermissionStatus> =>
    ipcRenderer.invoke("desktop:system-permission-request", kind),
  openSystemPermissionSettings: (kind: DesktopSystemPermissionKind): Promise<boolean> =>
    ipcRenderer.invoke("desktop:system-permission-settings", kind),
  recordDiagnostic: (event: DiagnosticEventInput) =>
    ipcRenderer.invoke("desktop:diagnostics-record", event),
  getDiagnosticSnapshot: (query: DiagnosticQuery = {}) =>
    ipcRenderer.invoke("desktop:diagnostics-snapshot", query),
  clearDiagnostics: () => ipcRenderer.invoke("desktop:diagnostics-clear"),
  exportDiagnostics: () => ipcRenderer.invoke("desktop:diagnostics-export"),
  onDiagnosticEvent: (callback: (event: DiagnosticEvent) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, event: DiagnosticEvent): void => callback(event);
    ipcRenderer.on("desktop:diagnostics-event", listener);
    return () => ipcRenderer.removeListener("desktop:diagnostics-event", listener);
  },
  getDiagnosticSourceContext: (request: DiagnosticSourceContextRequest) =>
    ipcRenderer.invoke("desktop:diagnostics-source-context", request),
  openDiagnosticSource: (request: DiagnosticSourceOpenRequest) =>
    ipcRenderer.invoke("desktop:diagnostics-source-open", request),
  updateDiagnosticIssue: (request: DiagnosticIssueUpdateRequest) =>
    ipcRenderer.invoke("desktop:diagnostics-issue-update", request),
  getInteractiveDebugPolicy: () => ipcRenderer.invoke("desktop:interactive-debug-policy"),
  updateInteractiveDebugPolicy: (request) => ipcRenderer.invoke("desktop:interactive-debug-policy-update", request),
  listInteractiveDebugTargets: () => ipcRenderer.invoke("desktop:interactive-debug-targets"),
  listInteractiveDebugSessions: () => ipcRenderer.invoke("desktop:interactive-debug-sessions"),
  startInteractiveDebugSession: (request: InteractiveDebugStartRequest) => ipcRenderer.invoke("desktop:interactive-debug-start", request),
  setInteractiveDebugBreakpoint: (request: InteractiveDebugBreakpointRequest) => ipcRenderer.invoke("desktop:interactive-debug-breakpoint", request),
  controlInteractiveDebugSession: (request: InteractiveDebugControlRequest) => ipcRenderer.invoke("desktop:interactive-debug-control", request),
  getInteractiveDebugScopes: (sessionId: string, frameId: string) => ipcRenderer.invoke("desktop:interactive-debug-scopes", sessionId, frameId),
  getInteractiveDebugVariables: (sessionId: string, reference: string) => ipcRenderer.invoke("desktop:interactive-debug-variables", sessionId, reference),
  evaluateInteractiveDebugExpression: (request: InteractiveDebugEvaluateRequest) => ipcRenderer.invoke("desktop:interactive-debug-evaluate", request),
  onInteractiveDebugEvent: (callback: (session: InteractiveDebugSession) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, session: InteractiveDebugSession): void => callback(session);
    ipcRenderer.on("desktop:interactive-debug-event", listener);
    return () => ipcRenderer.removeListener("desktop:interactive-debug-event", listener);
  },
  getProductionDiagnosticStatus: () => ipcRenderer.invoke("desktop:production-diagnostics-status"),
  updateProductionDiagnosticSettings: (patch) => ipcRenderer.invoke("desktop:production-diagnostics-settings", patch),
  previewDiagnosticPackage: () => ipcRenderer.invoke("desktop:production-diagnostics-preview"),
  exportProductionDiagnosticPackage: () => ipcRenderer.invoke("desktop:production-diagnostics-export"),
  importProductionDiagnosticPackage: () => ipcRenderer.invoke("desktop:production-diagnostics-import"),
  getAuthSession: (): Promise<AuthSession> =>
    ipcRenderer.invoke("desktop:get-auth-session"),
  onAuthSessionInvalidated: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on("desktop:auth-session-invalidated", listener);
    return () => ipcRenderer.removeListener("desktop:auth-session-invalidated", listener);
  },
  getA5ServiceGuidanceScenario: () =>
    ipcRenderer.invoke("desktop:e2e-a5-service-guidance-scenario"),
  login: (request: LoginRequest): Promise<LoginResult> =>
    ipcRenderer.invoke("desktop:login", request),
  startOidcLogin: (request?: { rememberMe?: boolean }): Promise<LoginResult> =>
    ipcRenderer.invoke("desktop:start-oidc-login", request),
  cancelOidcLogin: (): Promise<boolean> =>
    ipcRenderer.invoke("desktop:cancel-oidc-login"),
  startDesktopSsoLogin: (): Promise<DesktopSsoStartResult> =>
    ipcRenderer.invoke("desktop:start-desktop-sso-login"),
  startWechatDesktopLogin: (): Promise<DesktopSsoStartResult> =>
    ipcRenderer.invoke("desktop:start-wechat-desktop-login"),
  pollDesktopSsoLogin: (deviceCode: string): Promise<DesktopSsoPollResult> =>
    ipcRenderer.invoke("desktop:poll-desktop-sso-login", deviceCode),
  cancelDesktopSsoLogin: (deviceCode: string): Promise<boolean> =>
    ipcRenderer.invoke("desktop:cancel-desktop-sso-login", deviceCode),
  logout: (
    options?: LogoutOptions,
  ): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke("desktop:logout", options),
  previewLocalDataCleanup: (scope: DesktopDataCleanupScope) =>
    ipcRenderer.invoke("desktop:local-data-cleanup-preview", scope),
  clearLocalData: (request: DesktopDataCleanupRequest) =>
    ipcRenderer.invoke("desktop:local-data-cleanup", request),
  refreshAuthSession: (): Promise<AuthSession> =>
    ipcRenderer.invoke("desktop:refresh-auth-session"),
  bootstrapDesktop: (): Promise<DesktopBootstrapResult> =>
    ipcRenderer.invoke("desktop:bootstrap"),
  getHealth: (): Promise<DesktopHealth> =>
    ipcRenderer.invoke("desktop:get-health"),
  getInstallStatus: (): Promise<InstallStatus> =>
    ipcRenderer.invoke("desktop:get-install-status"),
  getGatewayStatus: (): Promise<GatewayStatus> =>
    ipcRenderer.invoke("desktop:get-gateway-status"),
  getCodexBackendStatus: (refresh = false) =>
    ipcRenderer.invoke("desktop:get-codex-backend-status", refresh),
  startCodexBackendLogin: (type = "chatgpt") =>
    ipcRenderer.invoke("desktop:start-codex-backend-login", type),
  cancelCodexBackendLogin: (loginId: string) =>
    ipcRenderer.invoke("desktop:cancel-codex-backend-login", loginId),
  logoutCodexBackend: () => ipcRenderer.invoke("desktop:logout-codex-backend"),
  listProviderUsageAnalytics: (): Promise<DesktopProviderUsageAnalyticsRecord[]> =>
    ipcRenderer.invoke("desktop:provider-usage-analytics-list"),
  listProviderErrorAnalytics: (): Promise<DesktopProviderErrorAnalyticsRecord[]> =>
    ipcRenderer.invoke("desktop:provider-error-analytics-list"),
  checkForUpdates: (): Promise<UpdateStatus> =>
    ipcRenderer.invoke("desktop:check-for-updates"),
  downloadUpdate: (): Promise<UpdateStatus> =>
    ipcRenderer.invoke("desktop:download-update"),
  cancelUpdate: (): Promise<UpdateStatus> =>
    ipcRenderer.invoke("desktop:cancel-update"),
  installUpdate: (): Promise<UpdateStatus> =>
    ipcRenderer.invoke("desktop:install-update"),
  startInstall: (options?: StartInstallOptions): Promise<void> =>
    ipcRenderer.invoke("desktop:start-install", options),
  cancelInstall: (): Promise<boolean> =>
    ipcRenderer.invoke("desktop:cancel-install"),
  copyTextToClipboard: (text: string): Promise<boolean> =>
    ipcRenderer.invoke("desktop:clipboard-copy-text", text),
  performEditCommand: (command) =>
    ipcRenderer.invoke("desktop:edit-command", command),
  openLogFolder: () =>
    ipcRenderer.invoke("desktop:open-log-folder"),
  startGateway: (): Promise<boolean> =>
    ipcRenderer.invoke("desktop:start-gateway"),
  stopGateway: (): Promise<boolean> =>
    ipcRenderer.invoke("desktop:stop-gateway"),
  getMobilePairingReadiness: () =>
    ipcRenderer.invoke("desktop:mobile-pairing-readiness"),
  createMobilePairingGrant: () =>
    ipcRenderer.invoke("desktop:mobile-pairing-create"),
  getMobilePairingGrant: (grantId: string) =>
    ipcRenderer.invoke("desktop:mobile-pairing-read", grantId),
  revokeMobilePairingGrant: (grantId: string) =>
    ipcRenderer.invoke("desktop:mobile-pairing-revoke", grantId),
  listMobileAssociations: () =>
    ipcRenderer.invoke("desktop:mobile-associations-list"),
  revokeMobileAssociation: (associationId: string) =>
    ipcRenderer.invoke("desktop:mobile-association-revoke", associationId),
  revokeMobileRuntimeEnrollment: () =>
    ipcRenderer.invoke("desktop:mobile-enrollment-revoke"),
  listSshHosts: () => ipcRenderer.invoke("desktop:ssh-hosts"),
  diagnoseSshHost: (hostAlias: string) => ipcRenderer.invoke("desktop:ssh-diagnose", hostAlias),
  inspectSshHostKeys: (hostAlias: string) => ipcRenderer.invoke("desktop:ssh-host-keys", hostAlias),
  testSshHost: (hostAlias: string) => ipcRenderer.invoke("desktop:ssh-test", hostAlias),
  approveSshHostKey: (hostAlias: string) => ipcRenderer.invoke("desktop:ssh-approve-host-key", hostAlias),
  connectSshHost: (hostAlias: string) => ipcRenderer.invoke("desktop:ssh-host-connect", hostAlias),
  disconnectSshHost: (hostAlias: string) => ipcRenderer.invoke("desktop:ssh-host-disconnect", hostAlias),
  reconnectSshHost: (hostAlias: string) => ipcRenderer.invoke("desktop:ssh-host-reconnect", hostAlias),
  removeSshHost: (hostAlias: string) => ipcRenderer.invoke("desktop:ssh-host-remove", hostAlias),
  listPortForwards: (filter = {}) => ipcRenderer.invoke("desktop:port-forward-list", filter),
  createPortForward: (request) => ipcRenderer.invoke("desktop:port-forward-create", request),
  pausePortForward: (id: string) => ipcRenderer.invoke("desktop:port-forward-pause", id),
  resumePortForward: (id: string) => ipcRenderer.invoke("desktop:port-forward-resume", id),
  removePortForward: (id: string) => ipcRenderer.invoke("desktop:port-forward-remove", id),
  listRemoteDirectories: (hostAlias: string, path?: string) =>
    ipcRenderer.invoke("desktop:ssh-directories", hostAlias, path),
  connectRemoteWorkspace: (request: ConnectRemoteWorkspaceRequest) =>
    ipcRenderer.invoke("desktop:remote-workspace-connect", request),
  disconnectRemoteWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke("desktop:remote-workspace-disconnect", workspaceId),
  getRemoteWorkspaceStatus: (workspaceId: string) =>
    ipcRenderer.invoke("desktop:remote-workspace-status", workspaceId),
  listRemoteThreads: (workspaceId: string) =>
    ipcRenderer.invoke("desktop:remote-workspace-threads", workspaceId),
  listRemoteHepaiWorkers: (workspaceId: string) =>
    ipcRenderer.invoke("desktop:remote-hepai-workers", workspaceId),
  setRemoteHepaiWorkerEnabled: (workspaceId: string, workerId: string, enabled: boolean) =>
    ipcRenderer.invoke("desktop:remote-hepai-worker-state", workspaceId, workerId, enabled),
  onRemoteWorkspaceStatus: (callback) => {
    const listener = (_event: IpcRendererEvent, status: RemoteWorkspaceStatus): void => callback(status);
    ipcRenderer.on("desktop:remote-workspace-status-event", listener);
    return () => ipcRenderer.removeListener("desktop:remote-workspace-status-event", listener);
  },
  preflightRemoteGateway: (hostAlias: string) =>
    ipcRenderer.invoke("desktop:remote-gateway-preflight", hostAlias),
  getRemoteSshDiagnosticReport: () => ipcRenderer.invoke("desktop:remote-ssh-diagnostics"),
  installRemoteGateway: (request: RemoteGatewayInstallRequest) =>
    ipcRenderer.invoke("desktop:remote-gateway-install", request),
  requestRemoteGatewayInstallApproval: (request: RemoteGatewayInstallRequest) =>
    ipcRenderer.invoke("desktop:remote-gateway-install-approval", request),
  cancelRemoteGatewayOperation: (hostAlias: string) =>
    ipcRenderer.invoke("desktop:remote-gateway-cancel", hostAlias),
  onRemoteGatewayOperation: (callback: (event: RemoteGatewayOperationEvent) => void) => {
    const listener = (_event: IpcRendererEvent, operation: RemoteGatewayOperationEvent): void => callback(operation);
    ipcRenderer.on("desktop:remote-gateway-operation-event", listener);
    return () => ipcRenderer.removeListener("desktop:remote-gateway-operation-event", listener);
  },
  onWorkspaceFileChanges: (callback: (event: WorkspaceFileChangeEvent) => void) => {
    const listener = (_event: IpcRendererEvent, change: WorkspaceFileChangeEvent): void => callback(change);
    ipcRenderer.on("desktop:workspace-file-change-event", listener);
    return () => ipcRenderer.removeListener("desktop:workspace-file-change-event", listener);
  },
  generateManagerPresentation: (
    request: ManagerPresentationGenerateRequest,
  ): Promise<ManagerPresentationGenerateResult> =>
    ipcRenderer.invoke("desktop:manager-presentation-generate", request),
  cancelManagerPresentation: (
    request: ManagerPresentationCancelRequest,
  ): Promise<ManagerPresentationCancelResult> =>
    ipcRenderer.invoke("desktop:manager-presentation-cancel", request),
  pauseManagerPresentation: (
    request: ManagerPresentationPauseRequest,
  ): Promise<ManagerPresentationPauseResult> =>
    ipcRenderer.invoke("desktop:manager-presentation-pause", request),
  resumeManagerPresentation: (
    request: ManagerPresentationPauseRequest,
  ): Promise<ManagerPresentationPauseResult> =>
    ipcRenderer.invoke("desktop:manager-presentation-resume", request),
  updateManagerPresentationRequirement: (
    request: ManagerPresentationRequirementUpdateRequest,
  ): Promise<ManagerPresentationRequirementUpdateResult> =>
    ipcRenderer.invoke("desktop:manager-presentation-requirement-update", request),
  getManagerPresentationRecovery: (
    request: ManagerPresentationRecoveryRequest,
  ): Promise<ManagerPresentationRecoveryResult | null> =>
    ipcRenderer.invoke("desktop:manager-presentation-recovery", request),
  resolveManagerPresentationRecovery: (
    request: ManagerPresentationRecoveryDecisionRequest,
  ): Promise<ManagerPresentationRecoveryDecisionResult> =>
    ipcRenderer.invoke("desktop:manager-presentation-recovery-resolve", request),
  onManagerPresentationProgress: (
    callback: (event: ManagerPresentationProgressEvent) => void,
  ) => {
    const listener = (_event: IpcRendererEvent, progress: ManagerPresentationProgressEvent): void => callback(progress);
    ipcRenderer.on("desktop:manager-presentation-progress", listener);
    return () => ipcRenderer.removeListener("desktop:manager-presentation-progress", listener);
  },
  listWorkspaces: () => ipcRenderer.invoke("desktop:list-workspaces"),
  createWorkspace: (request: CreateWorkspaceRequest) =>
    ipcRenderer.invoke("desktop:create-workspace", request),
  updateWorkspace: (request: UpdateWorkspaceRequest) =>
    ipcRenderer.invoke("desktop:update-workspace", request),
  deleteWorkspace: (id: string) =>
    ipcRenderer.invoke("desktop:delete-workspace", id),
  listThreads: () => ipcRenderer.invoke("desktop:list-threads"),
  listAgents: (options) => ipcRenderer.invoke("desktop:list-agents", options),
  setDefaultAgent: (agentId) => ipcRenderer.invoke("desktop:set-default-agent", agentId),
  recordAgentUsage: (agentId) => ipcRenderer.invoke("desktop:record-agent-usage", agentId),
  getPlatformAgentStatus: () => ipcRenderer.invoke("desktop:get-platform-agent-status"),
  getMyDrSaiConfig: (workspacePath?: string): Promise<MyDrSaiConfig> =>
    ipcRenderer.invoke("desktop:get-my-drsai-config", workspacePath),
  updateMyDrSaiConfig: (
    request: UpdateMyDrSaiConfigRequest,
  ): Promise<MyDrSaiConfig> =>
    ipcRenderer.invoke("desktop:update-my-drsai-config", request),
  createThread: (request: CreateThreadRequest) =>
    ipcRenderer.invoke("desktop:create-thread", request),
  updateThread: (request: UpdateThreadRequest) =>
    ipcRenderer.invoke("desktop:update-thread", request),
  deleteThread: (threadId: string) => ipcRenderer.invoke("desktop:delete-thread", threadId),
  setThreadArchived: (request) => ipcRenderer.invoke("desktop:set-thread-archived", request),
  getThreadSnapshot: (threadId: string): Promise<DesktopThreadSnapshot | null> =>
    ipcRenderer.invoke("desktop:get-thread-snapshot", threadId),
  subscribeThreadSnapshot: (threadId: string): Promise<boolean> =>
    ipcRenderer.invoke("desktop:subscribe-thread-snapshot", threadId),
  unsubscribeThreadSnapshot: (threadId: string): Promise<boolean> =>
    ipcRenderer.invoke("desktop:unsubscribe-thread-snapshot", threadId),
  onThreadSnapshot: (callback): (() => void) => {
    const listener = (_event: IpcRendererEvent, event: Parameters<typeof callback>[0]): void => callback(event);
    ipcRenderer.on("desktop:thread-snapshot", listener);
    return () => ipcRenderer.removeListener("desktop:thread-snapshot", listener);
  },
  onThreadCatalogUpdate: (callback): (() => void) => {
    const listener = (_event: IpcRendererEvent, value: Parameters<typeof callback>[0]): void => callback(value);
    ipcRenderer.on("desktop:thread-catalog", listener);
    return () => ipcRenderer.removeListener("desktop:thread-catalog", listener);
  },
  searchThreadMessages: (
    request: DesktopThreadContentSearchRequest,
  ): Promise<DesktopThreadContentSearchResult[]> =>
    ipcRenderer.invoke("desktop:search-thread-messages", request),
  updateThreadSnapshot: (snapshot: DesktopThreadSnapshot): Promise<DesktopThreadSnapshot> =>
    ipcRenderer.invoke("desktop:update-thread-snapshot", snapshot),
  prepareForkWorktree: (
    request: DesktopForkWorktreeRequest,
  ): Promise<DesktopForkWorktreeResult> =>
    ipcRenderer.invoke("desktop:prepare-fork-worktree", request),
  listWorktrees: (request: DesktopWorktreeListRequest): Promise<DesktopWorktreeSummary[]> =>
    ipcRenderer.invoke("desktop:list-worktrees", request),
  listWorktreeEvents: (request: DesktopWorktreeEventRequest): Promise<DesktopWorktreeEventBatch> =>
    ipcRenderer.invoke("desktop:list-worktree-events", request),
  getWorktreeMigrationDiagnostics: (request: DesktopWorktreeListRequest): Promise<DesktopWorktreeMigrationDiagnostic[]> =>
    ipcRenderer.invoke("desktop:worktree-migration-diagnostics", request),
  startChat: (request: ChatRequest): Promise<string> =>
    ipcRenderer.invoke("desktop:start-chat", request),
  recoverChatRun: (request) => ipcRenderer.invoke("desktop:recover-chat-run", request),
  abortChat: (requestId: string): Promise<boolean> =>
    ipcRenderer.invoke("desktop:abort-chat", requestId),
  respondChatInput: (requestId, response) =>
    ipcRenderer.invoke("desktop:respond-chat-input", requestId, response),
  startVoiceTranscription: (
    request: DesktopVoiceTranscriptionRequest,
  ): Promise<DesktopVoiceTranscriptionStartResult> =>
    ipcRenderer.invoke("desktop:voice-transcription-start", request),
  cancelVoiceTranscription: (requestId: string): Promise<boolean> =>
    ipcRenderer.invoke("desktop:voice-transcription-cancel", requestId),
  getVoiceRuntimeStatus: (): Promise<DesktopVoiceRuntimeStatus> =>
    ipcRenderer.invoke("desktop:voice-runtime-status"),
  getStreamingVoiceCapabilities: (): Promise<DesktopStreamingVoiceCapabilities> =>
    ipcRenderer.invoke("desktop:voice-streaming-capabilities"),
  startStreamingVoiceTranscription: async (
    request: DesktopStreamingVoiceStartRequest,
  ): Promise<DesktopStreamingVoiceStartResult> => {
    const result = await ipcRenderer.invoke("desktop:voice-streaming-start", request) as DesktopStreamingVoiceStartResult;
    const channel = new MessageChannel();
    streamingVoicePorts.set(result.sessionId, channel.port2);
    ipcRenderer.postMessage("desktop:voice-streaming-audio-port", { sessionId: result.sessionId }, [channel.port1]);
    return result;
  },
  sendStreamingVoiceAudioChunk: (chunk: DesktopStreamingVoiceAudioChunk): boolean => {
    const port = streamingVoicePorts.get(chunk.sessionId);
    if (!port) return false;
    // contextBridge arguments are proxied values. Rebuild a plain payload
    // before handing it to MessagePort; directly transferring a proxied typed
    // array can arrive as null in the Main process in packaged Electron.
    const audioData = new Uint8Array(chunk.audioData);
    const payload: DesktopStreamingVoiceAudioChunk = { ...chunk, audioData };
    // Electron 39 packaged builds can deliver a null MessageEvent when an
    // ArrayBuffer is included in this cross-context port's transfer list.
    // Structured clone is bounded by the 100 ms batching and Main queue caps.
    port.postMessage(payload);
    return true;
  },
  stopStreamingVoiceTranscription: async (sessionId: string, reason = "manual"): Promise<boolean> => {
    const stopped = await ipcRenderer.invoke("desktop:voice-streaming-stop", sessionId, reason) as boolean;
    if (!stopped) return false;
    return true;
  },
  cancelStreamingVoiceTranscription: async (sessionId: string): Promise<boolean> => {
    const cancelled = await ipcRenderer.invoke("desktop:voice-streaming-cancel", sessionId) as boolean;
    if (cancelled) {
      streamingVoicePorts.get(sessionId)?.close();
      streamingVoicePorts.delete(sessionId);
    }
    return cancelled;
  },
  startVoiceSynthesis: (
    request: DesktopVoiceSynthesisRequest,
  ): Promise<DesktopVoiceSynthesisStartResult> =>
    ipcRenderer.invoke("desktop:voice-synthesis-start", request),
  cancelVoiceSynthesis: (requestId: string): Promise<boolean> =>
    ipcRenderer.invoke("desktop:voice-synthesis-cancel", requestId),
  getVoiceSynthesisRuntimeStatus: (): Promise<DesktopVoiceSynthesisRuntimeStatus> =>
    ipcRenderer.invoke("desktop:voice-synthesis-runtime-status"),
  writeVoiceTranscriptHandoff: (
    request: DesktopVoiceTranscriptHandoffRequest,
  ): Promise<DesktopVoiceTranscriptHandoffResult> =>
    ipcRenderer.invoke("desktop:voice-handoff-write", request),
  startAgentRun: (
    request: AgentRunRequest,
  ): Promise<{ requestId: string; sessionId: string; runId: string }> =>
    ipcRenderer.invoke("desktop:start-agent-run", request),
  abortAgentRun: (requestId: string): Promise<boolean> =>
    ipcRenderer.invoke("desktop:abort-agent-run", requestId),
  recoverAgentRun: (threadId: string): Promise<AgentRunEvent[]> =>
    ipcRenderer.invoke("desktop:recover-agent-run", threadId),
  saveApiKey: (apiKey: string, defaultModel?: string): Promise<SaveApiKeyResult> =>
    ipcRenderer.invoke("desktop:save-api-key", apiKey, defaultModel),
  pickFiles: () => ipcRenderer.invoke("desktop:pick-files"),
  pickFolder: () => ipcRenderer.invoke("desktop:pick-folder"),
  getWorkspaceContextOverview: (
    workspacePath: string,
    workspaceId?: string,
  ): Promise<WorkspaceContextOverview> =>
    ipcRenderer.invoke("desktop:workspace-context-overview", workspacePath, workspaceId),
  listWorkspaceFiles: (
    request: WorkspaceFileTreeRequest,
  ): Promise<WorkspaceFileTreeResult> =>
    ipcRenderer.invoke("desktop:workspace-files", request),
  summarizeWorkspaceFolder: (
    request: WorkspaceFolderSummaryRequest,
  ): Promise<WorkspaceFolderSummaryResult> =>
    ipcRenderer.invoke("desktop:workspace-folder-summary", request),
  analyzeMaterialRoles: (
    request: MaterialRoleAnalysisRequest,
  ): Promise<MaterialRoleAnalysisResult> =>
    ipcRenderer.invoke("desktop:material-role-analysis", request),
  analyzeMaterialConsistency: (
    request: MaterialConsistencyAnalysisRequest,
  ): Promise<MaterialConsistencyAnalysisResult> =>
    ipcRenderer.invoke("desktop:material-consistency-analysis", request),
  queryMaterials: (request: MaterialQueryRequest): Promise<MaterialQueryResult> =>
    ipcRenderer.invoke("desktop:material-query", request),
  previewWorkspaceFile: (
    request: WorkspaceFilePreviewRequest,
  ): Promise<WorkspaceFilePreview> =>
    ipcRenderer.invoke("desktop:workspace-file-preview", request),
  saveWorkspaceFileAs: (
    request: WorkspaceFileSaveAsRequest,
  ): Promise<WorkspaceFileSaveAsResult> =>
    ipcRenderer.invoke("desktop:workspace-file-save-as", request),
  writeWorkspaceFile: (
    request: WorkspaceFileWriteRequest,
  ): Promise<WorkspaceFileWriteResult> =>
    ipcRenderer.invoke("desktop:workspace-file-write", request),
  applyAnomalyDecision: (
    request: DesktopAnomalyDecisionApplyRequest,
  ): Promise<DesktopAnomalyDecisionApplyResult> =>
    ipcRenderer.invoke("desktop:apply-anomaly-decision", request),
  getWorkspaceGitDiff: (
    request: WorkspaceGitDiffRequest,
  ): Promise<WorkspaceGitDiffResult> =>
    ipcRenderer.invoke("desktop:workspace-git-diff", request),
  getWorkspaceGitFileAtRef: (
    request: WorkspaceGitFileAtRefRequest,
  ): Promise<WorkspaceGitFileAtRefResult> =>
    ipcRenderer.invoke("desktop:workspace-git-file-at-ref", request),
  revertWorkspaceFile: (
    request: WorkspaceRevertFileRequest,
  ): Promise<WorkspaceRevertFileResult> =>
    ipcRenderer.invoke("desktop:workspace-revert-file", request),
  stageWorkspaceFile: (
    request: WorkspaceStageFileRequest,
  ): Promise<WorkspaceStageFileResult> =>
    ipcRenderer.invoke("desktop:workspace-stage-file", request),
  stageWorkspaceHunk: (
    request: WorkspaceHunkActionRequest,
  ): Promise<WorkspaceHunkActionResult> =>
    ipcRenderer.invoke("desktop:workspace-stage-hunk", request),
  revertWorkspaceHunk: (
    request: WorkspaceHunkActionRequest,
  ): Promise<WorkspaceHunkActionResult> =>
    ipcRenderer.invoke("desktop:workspace-revert-hunk", request),
  listWorkspaceCheckpoints: (
    workspacePath: string,
    workspaceId?: string,
  ): Promise<WorkspaceCheckpoint[]> =>
    ipcRenderer.invoke("desktop:workspace-checkpoints-list", workspacePath, workspaceId),
  createWorkspaceCheckpoint: (
    request: WorkspaceCheckpointCreateRequest,
  ): Promise<WorkspaceCheckpoint> =>
    ipcRenderer.invoke("desktop:workspace-checkpoint-create", request),
  acceptWorkspaceCheckpoint: (
    request: WorkspaceCheckpointAcceptRequest,
  ): Promise<WorkspaceCheckpoint> =>
    ipcRenderer.invoke("desktop:workspace-checkpoint-accept", request),
  previewWorkspaceCheckpoint: (
    request: WorkspaceCheckpointPreviewRequest,
  ): Promise<WorkspaceCheckpointPreviewResult> =>
    ipcRenderer.invoke("desktop:workspace-checkpoint-preview", request),
  restoreWorkspaceCheckpoint: (
    request: WorkspaceCheckpointRestoreRequest,
  ): Promise<WorkspaceCheckpointRestoreResult> =>
    ipcRenderer.invoke("desktop:workspace-checkpoint-restore", request),
  writeForkConflictDraft: (
    request: DesktopForkConflictDraftWriteRequest,
  ): Promise<DesktopForkConflictDraftWriteResult> =>
    ipcRenderer.invoke("desktop:fork-conflict-draft-write", request),
  checkBrowserUrl: (url: string): Promise<BrowserUrlCheck> =>
    ipcRenderer.invoke("desktop:browser-check-url", url),
  requestBrowserAction: (
    request: BrowserActionRequest,
  ): Promise<BrowserActionResult> =>
    ipcRenderer.invoke("desktop:browser-action-request", request),
  startBrowserTask: (
    request: BrowserTaskStartRequest,
  ): Promise<{ taskId: string }> =>
    ipcRenderer.invoke("desktop:browser-task-start", request),
  stopBrowserTask: (request: BrowserTaskStopRequest): Promise<boolean> =>
    ipcRenderer.invoke("desktop:browser-task-stop", request),
  proposeApproval: (
    request: DesktopApprovalProposalRequest,
  ): Promise<DesktopApprovalProposalResult> =>
    ipcRenderer.invoke("desktop:propose-approval", request),
  requestShellCommandApproval: (
    request: DesktopShellCommandApprovalRequest,
  ): Promise<DesktopApprovalProposalResult> =>
    ipcRenderer.invoke("desktop:shell-command-approval", request),
  requestGitCommitApproval: (
    request: DesktopGitCommitApprovalRequest,
  ): Promise<DesktopApprovalProposalResult> =>
    ipcRenderer.invoke("desktop:git-commit-approval", request),
  requestForkLifecycleApproval: (
    request: DesktopForkLifecycleApprovalRequest,
  ): Promise<DesktopForkLifecycleApprovalResult> =>
    ipcRenderer.invoke("desktop:fork-lifecycle-approval", request),
  requestForkQueueStartApproval: (
    request: DesktopForkQueueStartApprovalRequest,
  ): Promise<DesktopForkQueueStartApprovalResult> =>
    ipcRenderer.invoke("desktop:fork-queue-start-approval", request),
  dispatchForkQueue: (
    request: DesktopForkQueueDispatchRequest,
  ): Promise<DesktopForkQueueDispatchResult> =>
    ipcRenderer.invoke("desktop:fork-queue-dispatch", request),
  listProjectMemory: (
    request: DesktopProjectMemoryListRequest,
  ): Promise<DesktopProjectMemoryEntry[]> =>
    ipcRenderer.invoke("desktop:project-memory-list", request),
  addProjectMemory: (
    request: DesktopProjectMemoryAddRequest,
  ): Promise<DesktopProjectMemoryEntry> =>
    ipcRenderer.invoke("desktop:project-memory-add", request),
  updateProjectMemory: (
    request: DesktopProjectMemoryUpdateRequest,
  ): Promise<DesktopProjectMemoryEntry> =>
    ipcRenderer.invoke("desktop:project-memory-update", request),
  clearProjectMemory: (
    request: DesktopProjectMemoryClearRequest,
  ): Promise<DesktopProjectMemoryClearResult> =>
    ipcRenderer.invoke("desktop:project-memory-clear", request),
  listUserPreferences: (): Promise<DesktopUserPreference[]> =>
    ipcRenderer.invoke("desktop:user-preferences-list"),
  upsertUserPreference: (
    request: DesktopUserPreferenceUpsertRequest,
  ): Promise<DesktopUserPreference> =>
    ipcRenderer.invoke("desktop:user-preference-upsert", request),
  deleteUserPreference: (
    request: DesktopUserPreferenceDeleteRequest,
  ): Promise<DesktopUserPreferenceDeleteResult> =>
    ipcRenderer.invoke("desktop:user-preference-delete", request),
  listTeamMemory: (
    request: DesktopTeamMemoryListRequest = {},
  ): Promise<DesktopTeamMemoryEntry[]> =>
    ipcRenderer.invoke("desktop:team-memory-list", request),
  addTeamMemory: (
    request: DesktopTeamMemoryAddRequest,
  ): Promise<DesktopTeamMemoryEntry> =>
    ipcRenderer.invoke("desktop:team-memory-add", request),
  deleteTeamMemory: (
    request: DesktopTeamMemoryDeleteRequest,
  ): Promise<DesktopTeamMemoryDeleteResult> =>
    ipcRenderer.invoke("desktop:team-memory-delete", request),
  listCustomCommands: (
    request: DesktopCustomCommandListRequest,
  ): Promise<DesktopCustomCommand[]> =>
    ipcRenderer.invoke("desktop:custom-commands-list", request),
  upsertCustomCommand: (
    request: DesktopCustomCommandUpsertRequest,
  ): Promise<DesktopCustomCommand> =>
    ipcRenderer.invoke("desktop:custom-command-upsert", request),
  deleteCustomCommand: (
    request: DesktopCustomCommandDeleteRequest,
  ): Promise<DesktopCustomCommandDeleteResult> =>
    ipcRenderer.invoke("desktop:custom-command-delete", request),
  listProjectSkillDrafts: (
    request: DesktopProjectSkillDraftListRequest,
  ): Promise<DesktopProjectSkillDraft[]> =>
    ipcRenderer.invoke("desktop:project-skill-drafts-list", request),
  createProjectSkillDraft: (
    request: DesktopProjectSkillDraftCreateRequest,
  ): Promise<DesktopProjectSkillDraft> =>
    ipcRenderer.invoke("desktop:project-skill-draft-create", request),
  installProjectSkillDraft: (
    request: DesktopProjectSkillInstallRequest,
  ): Promise<DesktopProjectSkillInstallResult> =>
    ipcRenderer.invoke("desktop:project-skill-draft-install", request),
  publishProjectSkillDraft: (
    request: DesktopProjectSkillPublishRequest,
  ): Promise<DesktopProjectSkillPublishResult> =>
    ipcRenderer.invoke("desktop:project-skill-draft-publish", request),
  listWorkflowMarketplace: (
    workspacePath?: string,
  ): Promise<DesktopWorkflowMarketplaceListResult> =>
    ipcRenderer.invoke("desktop:workflow-marketplace-list", workspacePath),
  syncWorkflowMarketplace: (
    request: DesktopWorkflowMarketplaceSyncRequest,
  ): Promise<DesktopWorkflowMarketplaceSyncResult> =>
    ipcRenderer.invoke("desktop:workflow-marketplace-sync", request),
  prepareWorkflowRun: (
    request: DesktopWorkflowRunPrepareRequest,
  ): Promise<DesktopWorkflowRunPrepareResult> =>
    ipcRenderer.invoke("desktop:workflow-run-prepare", request),
  startWorkflowRun: (
    request: DesktopWorkflowRunStartRequest,
  ): Promise<DesktopWorkflowRunStartResult> =>
    ipcRenderer.invoke("desktop:workflow-run-start", request),
  listWorkflowRuns: (workspacePath?: string): Promise<DesktopWorkflowRun[]> =>
    ipcRenderer.invoke("desktop:workflow-runs-list", workspacePath),
  dispatchWorkflowRunStep: (
    request: DesktopWorkflowRunStepDispatchRequest,
  ): Promise<DesktopWorkflowRunStepDispatchResult> =>
    ipcRenderer.invoke("desktop:workflow-run-step-dispatch", request),
  completeWorkflowRunStep: (
    request: DesktopWorkflowRunStepCompleteRequest,
  ): Promise<DesktopWorkflowRunStepCompleteResult> =>
    ipcRenderer.invoke("desktop:workflow-run-step-complete", request),
  listBackgroundTasks: (
    request?: DesktopBackgroundTaskListRequest,
  ): Promise<DesktopBackgroundTask[]> =>
    ipcRenderer.invoke("desktop:background-tasks-list", request),
  enqueueBackgroundTask: (
    request: DesktopBackgroundTaskEnqueueRequest,
  ): Promise<DesktopBackgroundTask> =>
    ipcRenderer.invoke("desktop:background-task-enqueue", request),
  updateBackgroundTask: (
    request: DesktopBackgroundTaskUpdateRequest,
  ): Promise<DesktopBackgroundTask> =>
    ipcRenderer.invoke("desktop:background-task-update", request),
  cancelBackgroundTask: (request: DesktopBackgroundTaskActionRequest): Promise<DesktopBackgroundTask> =>
    ipcRenderer.invoke("desktop:background-task-cancel", request),
  retryBackgroundTask: (request: DesktopBackgroundTaskActionRequest): Promise<DesktopBackgroundTask> =>
    ipcRenderer.invoke("desktop:background-task-retry", request),
  recoverBackgroundTasks: (): Promise<DesktopBackgroundTaskRecoveryResult> =>
    ipcRenderer.invoke("desktop:background-tasks-recover"),
  listReusableTasks: (): Promise<DesktopReusableTask[]> =>
    ipcRenderer.invoke("desktop:reusable-tasks-list"),
  saveReusableTask: (
    request: DesktopReusableTaskSaveRequest,
  ): Promise<DesktopReusableTask> =>
    ipcRenderer.invoke("desktop:reusable-task-save", request),
  prepareReusableTaskRun: (
    request: DesktopReusableTaskRunPrepareRequest,
  ): Promise<DesktopReusableTaskRunRecipe> =>
    ipcRenderer.invoke("desktop:reusable-task-run-prepare", request),
  setCompletionNotificationPreference: (
    preference: CompletionNotificationPreference,
  ): Promise<CompletionNotificationPreference> =>
    ipcRenderer.invoke("desktop:completion-notification-preference-set", preference),
  onCompletionNotificationClick: (
    callback: (event: CompletionNotificationClickEvent) => void,
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, event: CompletionNotificationClickEvent): void => callback(event);
    ipcRenderer.on("desktop:completion-notification-click", listener);
    return () => ipcRenderer.removeListener("desktop:completion-notification-click", listener);
  },
  listScheduledTasks: (
    request?: DesktopScheduledTaskListRequest,
  ): Promise<DesktopScheduledTask[]> =>
    ipcRenderer.invoke("desktop:scheduled-tasks-list", request),
  createScheduledTask: (
    request: DesktopScheduledTaskCreateRequest,
  ): Promise<DesktopScheduledTask> =>
    ipcRenderer.invoke("desktop:scheduled-task-create", request),
  updateScheduledTask: (
    request: DesktopScheduledTaskUpdateRequest,
  ): Promise<DesktopScheduledTask> =>
    ipcRenderer.invoke("desktop:scheduled-task-update", request),
  deleteScheduledTask: (
    request: DesktopScheduledTaskDeleteRequest,
  ): Promise<DesktopScheduledTaskDeleteResult> =>
    ipcRenderer.invoke("desktop:scheduled-task-delete", request),
  runDueScheduledTasks: (
    request?: DesktopScheduledTaskRunRequest,
  ): Promise<DesktopScheduledTaskRunResult> =>
    ipcRenderer.invoke("desktop:scheduled-tasks-run-due", request),
  getScheduledTaskWorkerStatus: (): Promise<DesktopScheduledTaskWorkerStatus> =>
    ipcRenderer.invoke("desktop:scheduled-task-worker-status"),
  createShare: (request: DesktopShareCreateRequest): Promise<DesktopShareManifest> =>
    ipcRenderer.invoke("desktop:share-create", request),
  inspectShare: (request: DesktopShareInspectionRequest): Promise<DesktopShareInspectionResult> =>
    ipcRenderer.invoke("desktop:share-inspect", request),
  updateSharePermission: (request: DesktopSharePermissionUpdateRequest): Promise<DesktopShareManifest> =>
    ipcRenderer.invoke("desktop:share-permission-update", request),
  revokeShare: (request: DesktopShareRevokeRequest): Promise<DesktopShareRevocationResult> =>
    ipcRenderer.invoke("desktop:share-revoke", request),
  inspectShareVersion: (request: DesktopShareVersionInspectionRequest): Promise<DesktopShareVersionInspection> =>
    ipcRenderer.invoke("desktop:share-version-inspect", request),
  publishShareVersion: (request: DesktopShareVersionPublishRequest): Promise<DesktopShareVersionPublishResult> =>
    ipcRenderer.invoke("desktop:share-version-publish", request),
  listShareComments: (request: DesktopShareCommentListRequest): Promise<DesktopShareComment[]> =>
    ipcRenderer.invoke("desktop:share-comments-list", request),
  addShareComment: (request: DesktopShareCommentAddRequest): Promise<DesktopShareComment> =>
    ipcRenderer.invoke("desktop:share-comment-add", request),
  previewShareCommentTask: (request: DesktopShareCommentTaskPreviewRequest): Promise<DesktopShareCommentTaskPreview> =>
    ipcRenderer.invoke("desktop:share-comment-task-preview", request),
  createShareCommentTask: (request: DesktopShareCommentTaskCreateRequest): Promise<DesktopShareCommentTask> =>
    ipcRenderer.invoke("desktop:share-comment-task-create", request),
  updateShareCommentTask: (request: DesktopShareCommentTaskUpdateRequest): Promise<DesktopShareCommentTask> =>
    ipcRenderer.invoke("desktop:share-comment-task-update", request),
  completeShareCommentTask: (request: DesktopShareCommentTaskCompleteRequest): Promise<DesktopShareCommentTask> =>
    ipcRenderer.invoke("desktop:share-comment-task-complete", request),
  listShareCommentTasks: (request: DesktopShareCommentTaskListRequest = {}): Promise<DesktopShareCommentTask[]> =>
    ipcRenderer.invoke("desktop:share-comment-tasks-list", request),
  continueSharedTask: (request: DesktopShareContinuationRequest): Promise<DesktopShareContinuationResult> =>
    ipcRenderer.invoke("desktop:share-continue", request),
  listShareAudit: (request: DesktopShareAuditListRequest): Promise<DesktopShareAuditEntry[]> =>
    ipcRenderer.invoke("desktop:share-audit-list", request),
  listIncomingShares: (): Promise<DesktopShareManifest[]> =>
    ipcRenderer.invoke("desktop:shares-incoming-list"),
  listOutgoingShares: (): Promise<DesktopShareManifest[]> =>
    ipcRenderer.invoke("desktop:shares-outgoing-list"),
  openSharedObject: (request: DesktopSharedObjectOpenRequest): Promise<DesktopSharedObjectOpenResult> =>
    ipcRenderer.invoke("desktop:shared-object-open", request),
  downloadSharedArtifact: (request: DesktopSharedArtifactDownloadRequest): Promise<DesktopSharedArtifactDownloadResult> =>
    ipcRenderer.invoke("desktop:shared-artifact-download", request),
  listChannelAdapters: (workspacePath?: string): Promise<DesktopChannelAdapterListResult> =>
    ipcRenderer.invoke("desktop:channel-adapters-list", workspacePath),
  configureChannelAdapter: (
    request: DesktopChannelAdapterConfigureRequest,
  ): Promise<DesktopChannelAdapterConfigureResult> =>
    ipcRenderer.invoke("desktop:channel-adapter-configure", request),
  startChannelAdapterAuth: (
    request: DesktopChannelAdapterAuthStartRequest,
  ): Promise<DesktopChannelAdapterAuthStartResult> =>
    ipcRenderer.invoke("desktop:channel-adapter-auth-start", request),
  pollChannelAdapterAuth: (request: DesktopChannelAdapterAuthPollRequest): Promise<DesktopChannelAdapterAuthPollResult> =>
    ipcRenderer.invoke("desktop:channel-adapter-auth-poll", request),
  revokeChannelAdapterAuth: (request: DesktopChannelAdapterAuthRevokeRequest): Promise<DesktopChannelAdapterAuthRevokeResult> =>
    ipcRenderer.invoke("desktop:channel-adapter-auth-revoke", request),
  configureChannelProviderToken: (request: DesktopChannelProviderTokenConfigureRequest): Promise<DesktopChannelProviderTokenConfigureResult> =>
    ipcRenderer.invoke("desktop:channel-provider-token-configure", request),
  importChannelContext: (
    request: DesktopChannelContextImportRequest,
  ): Promise<DesktopChannelContextImportResult> =>
    ipcRenderer.invoke("desktop:channel-context-import", request),
  syncLiveChannelContext: (request: DesktopChannelLiveSyncRequest): Promise<DesktopChannelContextImportResult> =>
    ipcRenderer.invoke("desktop:channel-live-sync", request),
  syncChannelSnapshots: (
    request: DesktopChannelSnapshotSyncRequest,
  ): Promise<DesktopChannelSnapshotSyncResult> =>
    ipcRenderer.invoke("desktop:channel-snapshot-sync", request),
  listChannelInboundEvents: (
    request?: DesktopChannelInboundEventListRequest,
  ): Promise<DesktopChannelInboundEvent[]> =>
    ipcRenderer.invoke("desktop:channel-inbound-events", request),
  routeChannelInboundEvent: (
    request: DesktopChannelInboundEventRouteRequest,
  ): Promise<DesktopChannelInboundEventRouteResult> =>
    ipcRenderer.invoke("desktop:channel-inbound-route", request),
  proposeChannelOutboundDraft: (
    request: DesktopChannelOutboundDraftRequest,
  ): Promise<DesktopChannelOutboundDraftResult> =>
    ipcRenderer.invoke("desktop:channel-outbound-draft", request),
  listChannelOutboundDeliveries: (
    request?: DesktopChannelOutboundDeliveryListRequest,
  ): Promise<DesktopChannelOutboundDelivery[]> =>
    ipcRenderer.invoke("desktop:channel-outbound-deliveries", request),
  listExternalConnectionReadiness: (
    workspacePath?: string,
  ): Promise<DesktopExternalConnectionReadinessResult> =>
    ipcRenderer.invoke("desktop:external-connection-readiness", workspacePath),
  importMcpContext: (
    request: DesktopMcpContextRequest,
  ): Promise<DesktopMcpContextResult> =>
    ipcRenderer.invoke("desktop:mcp-context-import", request),
  requestMcpLiveEnumeration: (
    request: DesktopMcpLiveEnumerationRequest,
  ): Promise<DesktopMcpLiveEnumerationResult> =>
    ipcRenderer.invoke("desktop:mcp-live-enumerate", request),
  requestMcpToolExecutionApproval: (
    request: DesktopMcpToolExecutionApprovalRequest,
  ): Promise<DesktopMcpToolExecutionApprovalResult> =>
    ipcRenderer.invoke("desktop:mcp-tool-execution-approval", request),
  listMcpToolExecutionAudits: (
    request: DesktopMcpToolExecutionAuditListRequest,
  ): Promise<DesktopMcpToolExecutionAuditEntry[]> =>
    ipcRenderer.invoke("desktop:mcp-execution-audits", request),
  listMcpSessionAudits: (
    request: DesktopMcpSessionAuditListRequest,
  ): Promise<DesktopMcpSessionAuditEntry[]> =>
    ipcRenderer.invoke("desktop:mcp-session-audits", request),
  listMcpActiveSessions: (
    request: DesktopMcpActiveSessionListRequest,
  ): Promise<DesktopMcpActiveSession[]> =>
    ipcRenderer.invoke("desktop:mcp-active-sessions", request),
  listMcpReusableSessions: (
    request: DesktopMcpReusableSessionListRequest,
  ): Promise<DesktopMcpReusableSession[]> =>
    ipcRenderer.invoke("desktop:mcp-reusable-sessions", request),
  closeMcpReusableSession: (
    request: DesktopMcpReusableSessionCloseRequest,
  ): Promise<DesktopMcpReusableSessionCloseResult> =>
    ipcRenderer.invoke("desktop:mcp-reusable-session-close", request),
  cancelMcpActiveSession: (
    request: DesktopMcpSessionCancelRequest,
  ): Promise<DesktopMcpSessionCancelResult> =>
    ipcRenderer.invoke("desktop:mcp-session-cancel", request),
  listPendingApprovals: (): Promise<DesktopPendingApproval[]> =>
    ipcRenderer.invoke("desktop:pending-approvals"),
  decidePendingApproval: (
    request: DesktopApprovalDecisionRequest,
  ): Promise<boolean> => ipcRenderer.invoke("desktop:decide-approval", request),
  decideApproval: (
    request: DesktopApprovalDecisionRequest,
  ): Promise<boolean> => ipcRenderer.invoke("desktop:decide-approval", request),
  listPendingBrowserTaskApprovals: () =>
    ipcRenderer.invoke("desktop:browser-task-pending-approvals"),
  approveBrowserTaskAction: (
    request: BrowserTaskApprovalRequest,
  ): Promise<boolean> =>
    ipcRenderer.invoke("desktop:browser-task-approve", request),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("desktop:open-external", url),
  openPath: (path: string): Promise<string> =>
    ipcRenderer.invoke("desktop:open-path", path),
  openPdfPage: (request: PdfPageOpenRequest): Promise<PdfPageOpenResult> =>
    ipcRenderer.invoke("desktop:open-pdf-page", request),
  getIdeContext: (workspacePath: string): Promise<DesktopIdeContextSnapshot> =>
    ipcRenderer.invoke("desktop:ide-context", workspacePath),
  getFileIcon: (path: string) =>
    ipcRenderer.invoke("desktop:get-file-icon", path),
  createTerminal: (options) =>
    ipcRenderer.invoke("desktop:terminal-create", options),
  listTerminalSessions: (workspaceKey, workspaceId) =>
    ipcRenderer.invoke("desktop:terminal-list", workspaceKey, workspaceId),
  getTerminalBuffer: (id) => ipcRenderer.invoke("desktop:terminal-buffer", id),
  renameTerminal: (id, title) =>
    ipcRenderer.invoke("desktop:terminal-rename", id, title),
  writeTerminal: (id, data) =>
    ipcRenderer.invoke("desktop:terminal-write", id, data),
  resizeTerminal: (id, cols, rows) =>
    ipcRenderer.invoke("desktop:terminal-resize", id, cols, rows),
  killTerminal: (id) => ipcRenderer.invoke("desktop:terminal-kill", id),
  onInstallProgress: (
    callback: (progress: InstallProgress) => void,
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, progress: InstallProgress) => {
      callback(progress);
    };
    ipcRenderer.on("desktop:install-progress", listener);
    return () =>
      ipcRenderer.removeListener("desktop:install-progress", listener);
  },
  onOidcLoginDebug: (
    callback: (event: OidcLoginDebugEvent) => void,
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, event: OidcLoginDebugEvent) => {
      callback(event);
    };
    ipcRenderer.on("desktop:oidc-login-debug", listener);
    return () =>
      ipcRenderer.removeListener("desktop:oidc-login-debug", listener);
  },
  onChatEvent: (callback: (event: ChatEvent) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, event: ChatEvent) => {
      callback(event);
    };
    ipcRenderer.on("desktop:chat-event", listener);
    return () => ipcRenderer.removeListener("desktop:chat-event", listener);
  },
  onVoiceTranscriptionEvent: (
    callback: (event: DesktopVoiceTranscriptionEvent) => void,
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, event: DesktopVoiceTranscriptionEvent): void => callback(event);
    ipcRenderer.on("desktop:voice-transcription-event", listener);
    return () => ipcRenderer.removeListener("desktop:voice-transcription-event", listener);
  },
  onStreamingVoiceTranscriptionEvent: (
    callback: (event: DesktopStreamingVoiceTranscriptionEvent) => void,
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, event: DesktopStreamingVoiceTranscriptionEvent): void => {
      callback(event);
      if (event.type === "completed" || event.type === "cancelled" || event.type === "failed") {
        streamingVoicePorts.get(event.sessionId)?.close();
        streamingVoicePorts.delete(event.sessionId);
      }
    };
    ipcRenderer.on("desktop:voice-streaming-transcription-event", listener);
    return () => ipcRenderer.removeListener("desktop:voice-streaming-transcription-event", listener);
  },
  onVoiceSynthesisEvent: (
    callback: (event: DesktopVoiceSynthesisEvent) => void,
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, event: DesktopVoiceSynthesisEvent): void => callback(event);
    ipcRenderer.on("desktop:voice-synthesis-event", listener);
    return () => ipcRenderer.removeListener("desktop:voice-synthesis-event", listener);
  },
  onAgentRunEvent: (callback: (event: AgentRunEvent) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, event: AgentRunEvent) => {
      callback(event);
    };
    ipcRenderer.on("desktop:agent-run-event", listener);
    return () =>
      ipcRenderer.removeListener("desktop:agent-run-event", listener);
  },
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, status: UpdateStatus) => {
      callback(status);
    };
    ipcRenderer.on("desktop:update-status", listener);
    return () => ipcRenderer.removeListener("desktop:update-status", listener);
  },
  onTerminalData: (callback): (() => void) => {
    const listener = (_event: IpcRendererEvent, event) => {
      callback(event);
    };
    ipcRenderer.on("desktop:terminal-data", listener);
    return () => ipcRenderer.removeListener("desktop:terminal-data", listener);
  },
  onTerminalExit: (callback): (() => void) => {
    const listener = (_event: IpcRendererEvent, event) => {
      callback(event);
    };
    ipcRenderer.on("desktop:terminal-exit", listener);
    return () => ipcRenderer.removeListener("desktop:terminal-exit", listener);
  },
  onBrowserTaskEvent: (
    callback: (event: BrowserTaskEvent) => void,
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, event: BrowserTaskEvent) => {
      callback(event);
    };
    ipcRenderer.on("desktop:browser-task-event", listener);
    return () =>
      ipcRenderer.removeListener("desktop:browser-task-event", listener);
  },
};

contextBridge.exposeInMainWorld("openDrSai", api);
