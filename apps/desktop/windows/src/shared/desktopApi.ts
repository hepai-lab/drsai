export interface DesktopHealth {
  installed: boolean;
  gatewayReady: boolean;
  mode: "local" | "remote" | "ssh";
  version: string | null;
  install: InstallStatus;
  gateway: GatewayStatus;
  update: UpdateStatus;
}

export interface InstallStatus {
  installed: boolean;
  home: string;
  repoPath: string;
  pythonPath: string;
  scriptPath: string;
  version: string | null;
  expectedVersion: string | null;
  backendNeedsRepair: boolean;
  bundledBackendAvailable: boolean;
  configExists: boolean;
  envExists: boolean;
  apiKeyConfigured: boolean;
  prerequisites: PrerequisiteStatus;
  missing: string[];
}

export interface PrerequisiteStatus {
  pythonOnPath: boolean;
  pythonVersion: string | null;
  pythonCommand: string | null;
  gitOnPath: boolean;
  gitVersion: string | null;
  gitCommand: string | null;
  apiKeyConfigured: boolean;
  problems: string[];
}

export interface GatewayStatus {
  ready: boolean;
  managed: boolean;
  externalReady: boolean;
  externalConflict: boolean;
  baseUrl: string;
  pid: number | null;
  lastLog: string;
}

export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  progress: number | null;
  version: string | null;
  error: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: "user" | "admin";
}

export interface AuthSession {
  authenticated: boolean;
  user: AuthUser | null;
  expiresAt: string | null;
  authMode: "password" | "api_key" | "sso" | "oidc" | "offline" | null;
  authProvider?: "ihep" | "wechat" | "hai" | "local" | null;
  accessTokenExpiresAt?: string | null;
  refreshable?: boolean;
}

export interface DesktopSsoStartResult {
  ok: boolean;
  message: string;
  deviceCode?: string;
  loginUrl?: string;
  expiresAt?: string;
  intervalSeconds?: number;
}

export interface DesktopSsoPollResult {
  ok: boolean;
  state: "pending" | "authorized" | "expired" | "cancelled" | "error";
  message: string;
  session?: AuthSession | null;
}

export interface LoginRequest {
  email?: string;
  password?: string;
  apiKey?: string;
  developerBypass?: boolean;
  oidc?: boolean;
  rememberMe?: boolean;
}

export interface LoginResult {
  ok: boolean;
  session: AuthSession | null;
  message: string;
}

export interface LogoutOptions {
  clearLocalData?: boolean;
}

export interface InstallProgress {
  phase: "idle" | "running" | "complete" | "error";
  message: string;
  log: string;
  logFile?: string;
  exitCode?: number;
}

export interface StartInstallOptions {
  installPrerequisites?: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatAttachment {
  kind: "file" | "folder";
  path: string;
  name: string;
}

export interface ChatRequest {
  requestId?: string;
  model?: string;
  workspacePath?: string;
  threadId?: string;
  sessionId?: string;
  runId?: string;
  attachments?: ChatAttachment[];
  metadata?: Record<string, unknown>;
  messages: ChatMessage[];
}

export interface ChatEvent {
  requestId: string;
  type: "start" | "chunk" | "done" | "error" | "aborted";
  content?: string;
  error?: string;
  sessionId?: string;
  runId?: string;
}

export interface AgentRunRequest {
  requestId?: string;
  threadId?: string;
  sessionId?: string;
  runId?: string;
  task: string;
  model?: string;
  workspacePath?: string;
  files?: unknown[];
  teamConfig?: Record<string, unknown> | null;
  settingsConfig?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export interface DesktopThread {
  id: string;
  kind: "chat" | "agent_run";
  title: string;
  workspacePath?: string;
  createdAt: string;
  updatedAt: string;
  lastRunId?: string;
  lastRequestId?: string;
  status?: "idle" | "running" | "error";
  messageCount?: number;
}

export interface WorkspaceGitStatus {
  repoRoot?: string;
  branch?: string;
  hasChanges?: boolean;
}

export interface WorkspaceInstructionSummary {
  name: "AGENTS.md" | "DRSAI.md";
  path: string;
  content: string;
  truncated: boolean;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  path: string;
  type: "local";
  description?: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  trusted: boolean;
  pinned?: boolean;
  git?: WorkspaceGitStatus;
  hasAgentInstructions?: boolean;
  instructions?: WorkspaceInstructionSummary[];
  metadata?: Record<string, unknown>;
}

export interface CreateWorkspaceRequest {
  source?: "existing" | "empty" | "git";
  path?: string;
  parentPath?: string;
  repoUrl?: string;
  name?: string;
  description?: string;
  trusted?: boolean;
  pinned?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateWorkspaceRequest {
  id: string;
  name?: string;
  description?: string;
  trusted?: boolean;
  pinned?: boolean;
  lastOpenedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateThreadRequest {
  kind: DesktopThread["kind"];
  title?: string;
  workspacePath?: string;
}

export interface UpdateThreadRequest {
  id: string;
  kind?: DesktopThread["kind"];
  title?: string;
  workspacePath?: string;
  lastRunId?: string;
  lastRequestId?: string;
  status?: DesktopThread["status"];
  messageCount?: number;
}

export interface AgentRunEvent {
  requestId: string;
  sessionId: string;
  runId: string;
  type: "start" | "chunk" | "done" | "error" | "aborted";
  content?: string;
  error?: string;
}

export interface SaveApiKeyResult {
  ok: boolean;
  message: string;
}

export interface PickDialogResult {
  canceled: boolean;
  paths: string[];
}

export interface TerminalCreateOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
}

export interface TerminalSessionInfo {
  id: string;
  pid: number;
  shell: string;
  cwd: string;
}

export interface TerminalDataEvent {
  id: string;
  data: string;
}

export interface TerminalExitEvent {
  id: string;
  exitCode: number;
  signal?: number;
}

export interface DesktopApi {
  getAuthSession(): Promise<AuthSession>;
  login(request: LoginRequest): Promise<LoginResult>;
  startOidcLogin(request?: { rememberMe?: boolean }): Promise<LoginResult>;
  cancelOidcLogin(): Promise<boolean>;
  startDesktopSsoLogin(): Promise<DesktopSsoStartResult>;
  startWechatDesktopLogin(): Promise<DesktopSsoStartResult>;
  pollDesktopSsoLogin(deviceCode: string): Promise<DesktopSsoPollResult>;
  cancelDesktopSsoLogin(deviceCode: string): Promise<boolean>;
  logout(options?: LogoutOptions): Promise<{ ok: boolean; message: string }>;
  refreshAuthSession(): Promise<AuthSession>;
  getHealth(): Promise<DesktopHealth>;
  getInstallStatus(): Promise<InstallStatus>;
  getGatewayStatus(): Promise<GatewayStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  startInstall(options?: StartInstallOptions): Promise<void>;
  cancelInstall(): Promise<boolean>;
  startGateway(): Promise<boolean>;
  stopGateway(): Promise<boolean>;
  listWorkspaces(): Promise<WorkspaceProject[]>;
  createWorkspace(request: CreateWorkspaceRequest): Promise<WorkspaceProject>;
  updateWorkspace(request: UpdateWorkspaceRequest): Promise<WorkspaceProject>;
  deleteWorkspace(id: string): Promise<boolean>;
  listThreads(): Promise<DesktopThread[]>;
  createThread(request: CreateThreadRequest): Promise<DesktopThread>;
  updateThread(request: UpdateThreadRequest): Promise<DesktopThread>;
  startChat(request: ChatRequest): Promise<string>;
  abortChat(requestId: string): Promise<boolean>;
  startAgentRun(
    request: AgentRunRequest,
  ): Promise<{ requestId: string; sessionId: string; runId: string }>;
  abortAgentRun(requestId: string): Promise<boolean>;
  saveApiKey(apiKey: string): Promise<SaveApiKeyResult>;
  pickFiles(): Promise<PickDialogResult>;
  pickFolder(): Promise<PickDialogResult>;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<string>;
  createTerminal(options?: TerminalCreateOptions): Promise<TerminalSessionInfo>;
  writeTerminal(id: string, data: string): Promise<boolean>;
  resizeTerminal(id: string, cols: number, rows: number): Promise<boolean>;
  killTerminal(id: string): Promise<boolean>;
  onInstallProgress(callback: (progress: InstallProgress) => void): () => void;
  onChatEvent(callback: (event: ChatEvent) => void): () => void;
  onAgentRunEvent(callback: (event: AgentRunEvent) => void): () => void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  onTerminalData(callback: (event: TerminalDataEvent) => void): () => void;
  onTerminalExit(callback: (event: TerminalExitEvent) => void): () => void;
}
