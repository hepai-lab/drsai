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
  authMode: "password" | "api_key" | "sso" | "offline" | null;
  authProvider?: "ihep" | "wechat" | "local" | null;
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

export interface DesktopApi {
  getAuthSession(): Promise<AuthSession>;
  login(request: LoginRequest): Promise<LoginResult>;
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
  downloadUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  startInstall(options?: StartInstallOptions): Promise<void>;
  cancelInstall(): Promise<boolean>;
  startGateway(): Promise<boolean>;
  stopGateway(): Promise<boolean>;
  listThreads(): Promise<DesktopThread[]>;
  createThread(request: CreateThreadRequest): Promise<DesktopThread>;
  updateThread(request: UpdateThreadRequest): Promise<DesktopThread>;
  startChat(request: ChatRequest): Promise<string>;
  abortChat(requestId: string): Promise<boolean>;
  startAgentRun(request: AgentRunRequest): Promise<{ requestId: string; sessionId: string; runId: string }>;
  abortAgentRun(requestId: string): Promise<boolean>;
  saveApiKey(apiKey: string): Promise<SaveApiKeyResult>;
  pickFiles(): Promise<PickDialogResult>;
  pickFolder(): Promise<PickDialogResult>;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<string>;
  onInstallProgress(callback: (progress: InstallProgress) => void): () => void;
  onChatEvent(callback: (event: ChatEvent) => void): () => void;
  onAgentRunEvent(callback: (event: AgentRunEvent) => void): () => void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
}
