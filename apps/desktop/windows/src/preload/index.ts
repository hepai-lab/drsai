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
  DesktopHealth,
  DesktopSsoPollResult,
  DesktopSsoStartResult,
  GatewayStatus,
  InstallStatus,
  InstallProgress,
  LoginRequest,
  LoginResult,
  LogoutOptions,
  SaveApiKeyResult,
  StartInstallOptions,
  UpdateThreadRequest,
  UpdateStatus,
  UpdateWorkspaceRequest,
  WorkspaceContextOverview,
  WorkspaceFilePreview,
  WorkspaceFilePreviewRequest,
  WorkspaceFileTreeRequest,
  WorkspaceFileTreeResult,
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
  createThread: (request: CreateThreadRequest) =>
    ipcRenderer.invoke("desktop:create-thread", request),
  updateThread: (request: UpdateThreadRequest) =>
    ipcRenderer.invoke("desktop:update-thread", request),
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
  saveApiKey: (apiKey: string): Promise<SaveApiKeyResult> =>
    ipcRenderer.invoke("desktop:save-api-key", apiKey),
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
  previewWorkspaceFile: (
    request: WorkspaceFilePreviewRequest,
  ): Promise<WorkspaceFilePreview> =>
    ipcRenderer.invoke("desktop:workspace-file-preview", request),
  getWorkspaceGitDiff: (
    request: WorkspaceGitDiffRequest,
  ): Promise<WorkspaceGitDiffResult> =>
    ipcRenderer.invoke("desktop:workspace-git-diff", request),
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
  approveBrowserTaskAction: (
    request: BrowserTaskApprovalRequest,
  ): Promise<boolean> =>
    ipcRenderer.invoke("desktop:browser-task-approve", request),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("desktop:open-external", url),
  openPath: (path: string): Promise<string> =>
    ipcRenderer.invoke("desktop:open-path", path),
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
