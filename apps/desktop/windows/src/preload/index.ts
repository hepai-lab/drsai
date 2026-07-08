import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type {
  DesktopApi,
  AgentRunEvent,
  AgentRunRequest,
  AuthSession,
  ChatEvent,
  ChatRequest,
  BrowserActionRequest,
  BrowserActionResult,
  BrowserTaskApprovalRequest,
  BrowserTaskEvent,
  BrowserTaskStartRequest,
  BrowserTaskStopRequest,
  BrowserUrlCheck,
  CreateWorkspaceRequest,
  CreateThreadRequest,
  DesktopBackgroundTask,
  DesktopBackgroundTaskEnqueueRequest,
  DesktopBackgroundTaskListRequest,
  DesktopBackgroundTaskUpdateRequest,
  DesktopChannelAdapterConfigureRequest,
  DesktopChannelAdapterConfigureResult,
  DesktopChannelAdapterAuthStartRequest,
  DesktopChannelAdapterAuthStartResult,
  DesktopChannelAdapterListResult,
  DesktopChannelContextImportRequest,
  DesktopChannelContextImportResult,
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
  DesktopApprovalProposalRequest,
  DesktopApprovalProposalResult,
  DesktopHealth,
  DesktopForkWorktreeRequest,
  DesktopForkWorktreeResult,
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
  DesktopGitCommitApprovalRequest,
  DesktopShellCommandApprovalRequest,
  DesktopCustomCommand,
  DesktopCustomCommandDeleteRequest,
  DesktopCustomCommandDeleteResult,
  DesktopCustomCommandListRequest,
  DesktopCustomCommandUpsertRequest,
  DesktopScheduledTask,
  DesktopScheduledTaskCreateRequest,
  DesktopScheduledTaskListRequest,
  DesktopScheduledTaskRunRequest,
  DesktopScheduledTaskRunResult,
  DesktopScheduledTaskWorkerStatus,
  DesktopScheduledTaskUpdateRequest,
  DesktopProjectMemoryAddRequest,
  DesktopProjectMemoryClearRequest,
  DesktopProjectMemoryClearResult,
  DesktopProjectMemoryEntry,
  DesktopProjectMemoryListRequest,
  DesktopProjectMemoryUpdateRequest,
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
  MyDrSaiConfig,
  SaveApiKeyResult,
  StartInstallOptions,
  UpdateMyDrSaiConfigRequest,
  UpdateThreadRequest,
  UpdateStatus,
  UpdateWorkspaceRequest,
  WorkspaceContextOverview,
  WorkspaceCheckpoint,
  WorkspaceCheckpointCreateRequest,
  WorkspaceCheckpointPreviewRequest,
  WorkspaceCheckpointPreviewResult,
  WorkspaceCheckpointRestoreRequest,
  WorkspaceCheckpointRestoreResult,
  WorkspaceFilePreview,
  WorkspaceFilePreviewRequest,
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
} from "../shared/desktopApi";

const api: DesktopApi = {
  getAuthSession: (): Promise<AuthSession> =>
    ipcRenderer.invoke("desktop:get-auth-session"),
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
  refreshAuthSession: (): Promise<AuthSession> =>
    ipcRenderer.invoke("desktop:refresh-auth-session"),
  getHealth: (): Promise<DesktopHealth> =>
    ipcRenderer.invoke("desktop:get-health"),
  getInstallStatus: (): Promise<InstallStatus> =>
    ipcRenderer.invoke("desktop:get-install-status"),
  getGatewayStatus: (): Promise<GatewayStatus> =>
    ipcRenderer.invoke("desktop:get-gateway-status"),
  checkForUpdates: (): Promise<UpdateStatus> =>
    ipcRenderer.invoke("desktop:check-for-updates"),
  startInstall: (options?: StartInstallOptions): Promise<void> =>
    ipcRenderer.invoke("desktop:start-install", options),
  cancelInstall: (): Promise<boolean> =>
    ipcRenderer.invoke("desktop:cancel-install"),
  startGateway: (): Promise<boolean> =>
    ipcRenderer.invoke("desktop:start-gateway"),
  stopGateway: (): Promise<boolean> =>
    ipcRenderer.invoke("desktop:stop-gateway"),
  listWorkspaces: () => ipcRenderer.invoke("desktop:list-workspaces"),
  createWorkspace: (request: CreateWorkspaceRequest) =>
    ipcRenderer.invoke("desktop:create-workspace", request),
  updateWorkspace: (request: UpdateWorkspaceRequest) =>
    ipcRenderer.invoke("desktop:update-workspace", request),
  deleteWorkspace: (id: string) =>
    ipcRenderer.invoke("desktop:delete-workspace", id),
  listThreads: () => ipcRenderer.invoke("desktop:list-threads"),
  listAgents: () => ipcRenderer.invoke("desktop:list-agents"),
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
  prepareForkWorktree: (
    request: DesktopForkWorktreeRequest,
  ): Promise<DesktopForkWorktreeResult> =>
    ipcRenderer.invoke("desktop:prepare-fork-worktree", request),
  startChat: (request: ChatRequest): Promise<string> =>
    ipcRenderer.invoke("desktop:start-chat", request),
  abortChat: (requestId: string): Promise<boolean> =>
    ipcRenderer.invoke("desktop:abort-chat", requestId),
  startAgentRun: (
    request: AgentRunRequest,
  ): Promise<{ requestId: string; sessionId: string; runId: string }> =>
    ipcRenderer.invoke("desktop:start-agent-run", request),
  abortAgentRun: (requestId: string): Promise<boolean> =>
    ipcRenderer.invoke("desktop:abort-agent-run", requestId),
  saveApiKey: (apiKey: string, defaultModel?: string): Promise<SaveApiKeyResult> =>
    ipcRenderer.invoke("desktop:save-api-key", apiKey, defaultModel),
  pickFiles: () => ipcRenderer.invoke("desktop:pick-files"),
  pickFolder: () => ipcRenderer.invoke("desktop:pick-folder"),
  getWorkspaceContextOverview: (
    workspacePath: string,
  ): Promise<WorkspaceContextOverview> =>
    ipcRenderer.invoke("desktop:workspace-context-overview", workspacePath),
  listWorkspaceFiles: (
    request: WorkspaceFileTreeRequest,
  ): Promise<WorkspaceFileTreeResult> =>
    ipcRenderer.invoke("desktop:workspace-files", request),
  summarizeWorkspaceFolder: (
    request: WorkspaceFolderSummaryRequest,
  ): Promise<WorkspaceFolderSummaryResult> =>
    ipcRenderer.invoke("desktop:workspace-folder-summary", request),
  previewWorkspaceFile: (
    request: WorkspaceFilePreviewRequest,
  ): Promise<WorkspaceFilePreview> =>
    ipcRenderer.invoke("desktop:workspace-file-preview", request),
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
  ): Promise<WorkspaceCheckpoint[]> =>
    ipcRenderer.invoke("desktop:workspace-checkpoints-list", workspacePath),
  createWorkspaceCheckpoint: (
    request: WorkspaceCheckpointCreateRequest,
  ): Promise<WorkspaceCheckpoint> =>
    ipcRenderer.invoke("desktop:workspace-checkpoint-create", request),
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
  runDueScheduledTasks: (
    request?: DesktopScheduledTaskRunRequest,
  ): Promise<DesktopScheduledTaskRunResult> =>
    ipcRenderer.invoke("desktop:scheduled-tasks-run-due", request),
  getScheduledTaskWorkerStatus: (): Promise<DesktopScheduledTaskWorkerStatus> =>
    ipcRenderer.invoke("desktop:scheduled-task-worker-status"),
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
  importChannelContext: (
    request: DesktopChannelContextImportRequest,
  ): Promise<DesktopChannelContextImportResult> =>
    ipcRenderer.invoke("desktop:channel-context-import", request),
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
  getIdeContext: (workspacePath: string): Promise<DesktopIdeContextSnapshot> =>
    ipcRenderer.invoke("desktop:ide-context", workspacePath),
  getFileIcon: (path: string) =>
    ipcRenderer.invoke("desktop:get-file-icon", path),
  createTerminal: (options) =>
    ipcRenderer.invoke("desktop:terminal-create", options),
  listTerminalSessions: (workspaceKey) =>
    ipcRenderer.invoke("desktop:terminal-list", workspaceKey),
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
  onChatEvent: (callback: (event: ChatEvent) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, event: ChatEvent) => {
      callback(event);
    };
    ipcRenderer.on("desktop:chat-event", listener);
    return () => ipcRenderer.removeListener("desktop:chat-event", listener);
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
