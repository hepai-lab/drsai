import type {
  BrowserActionRequest,
  BrowserActionResult,
  BrowserTaskApprovalRequest,
  BrowserTaskEvent,
  BrowserTaskStartRequest,
  BrowserTaskStopRequest,
  BrowserUrlCheck,
} from "./browser/types";
import type { ExecutionActionKind } from "./executionPolicy";

export type {
  ExecutionActionKind,
  ExecutionPermissionDecision,
  ExecutionPolicyConfig,
  ExecutionPolicyMode,
} from "./executionPolicy";

export type {
  BrowserActionLogEntry,
  BrowserActionName,
  BrowserActionOptions,
  BrowserActionRequest,
  BrowserActionResult,
  BrowserPageState,
  BrowserScreenshot,
  BrowserSnapshot,
  BrowserTaskEvent,
  BrowserTaskApprovalRequest,
  BrowserTaskStartRequest,
  BrowserTaskStopRequest,
  BrowserUrlCheck,
  BrowserWaitTarget,
} from "./browser/types";

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
  phase:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "verifying"
    | "staging"
    | "ready"
    | "installing"
    | "complete"
    | "rollback"
    | "failed";
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  progress: number | null;
  version: string | null;
  currentVersion: string;
  mandatory: boolean;
  releaseNotesUrl: string | null;
  canDownload: boolean;
  canInstall: boolean;
  canCancel: boolean;
  errorCode: string | null;
  error: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: "user" | "admin";
  roles?: string[];
  groups?: string[];
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

export interface DesktopBootstrapResult {
  ready: boolean;
  message: string;
  user: AuthUser;
  blocker?: DesktopBootstrapBlocker | null;
  capabilities: {
    chat: boolean;
    agent: boolean;
    tools: Array<"files" | "shell" | "git">;
  };
  defaults: {
    agentId: string;
    modelAlias: string | null;
  };
  models: Array<{ id: string; name: string }>;
  limits: {
    maxConcurrentRuns: number;
  };
}

export type DesktopBootstrapBlockerKind =
  | "auth_required"
  | "service_unavailable"
  | "runtime_missing"
  | "permission_denied";

export interface DesktopBootstrapBlocker {
  kind: DesktopBootstrapBlockerKind;
  title: string;
  message: string;
  retryable: boolean;
  canRepairRuntime: boolean;
  canSignInAgain: boolean;
  diagnosticCode: string;
}

export interface DesktopA5ServiceGuidanceScenario {
  kind: DesktopBootstrapBlockerKind;
  message: string;
  session: AuthSession;
  blocker: DesktopBootstrapBlocker;
}

export type OidcLoginDebugStage =
  | "started"
  | "callback-listening"
  | "discovery"
  | "authorize-url"
  | "browser-opened"
  | "waiting-callback"
  | "callback-received"
  | "token-exchange"
  | "token-verified"
  | "session-created"
  | "cancelled"
  | "failed";

export interface OidcLoginDebugEvent {
  stage: OidcLoginDebugStage;
  status: "info" | "success" | "error";
  message: string;
  at: string;
  url?: string;
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

export type DesktopVoiceRuntimeId =
  | "mock-local"
  | "gateway-provider"
  | "local-whisper";

export interface DesktopVoiceTranscriptionRequest {
  workspacePath?: string;
  audioData?: Uint8Array;
  mimeType: string;
  durationSeconds: number;
  languageHint?: string;
  sourceLabel?: string;
}

export type DesktopVoiceErrorCode =
  | "empty_audio" | "audio_too_large" | "duration_exceeded" | "unsupported_format"
  | "runtime_unavailable" | "auth_required" | "network_error" | "rate_limited"
  | "timeout" | "provider_error" | "cancelled" | "internal_error";

export interface DesktopVoiceError {
  code: DesktopVoiceErrorCode;
  message: string;
  retryable: boolean;
  requestId?: string;
}

export interface DesktopVoiceTranscriptionStartResult {
  requestId: string;
  acceptedAt: string;
}

export interface DesktopVoiceRuntimeStatus {
  runtimeId: DesktopVoiceRuntimeId;
  state: "ready" | "unavailable" | "auth_required" | "degraded";
  supportedMimeTypes: string[];
  maxBytes: number;
  maxDurationSeconds: number;
  supportsPartial: boolean;
  providerDisclosure: string;
  message: string;
}

export type DesktopVoiceTranscriptionEvent =
  | { requestId: string; type: "accepted"; runtimeId: DesktopVoiceRuntimeId }
  | { requestId: string; type: "progress"; stage: "preparing" | "uploading" | "transcribing"; message: string }
  | { requestId: string; type: "completed"; result: DesktopVoiceTranscriptionResult }
  | { requestId: string; type: "failed"; error: DesktopVoiceError }
  | { requestId: string; type: "cancelled" };

export interface DesktopVoiceTranscriptionResult {
  ok: boolean;
  transcript: string;
  language?: string;
  durationSeconds: number;
  confidence?: number;
  runtimeId: DesktopVoiceRuntimeId;
  sourceId: string;
  createdAt: string;
  truncated: boolean;
  providerDisclosure: string;
  message: string;
  error?: string;
}

export interface DesktopVoiceTranscriptHandoffRequest {
  workspacePath: string;
  transcript: string;
  title?: string;
  speaker?: string;
  language?: string;
  durationSeconds?: number;
  sourceId?: string;
  runtimeId?: DesktopVoiceRuntimeId;
  capturedAt?: string;
}

export interface DesktopVoiceTranscriptHandoffResult {
  ok: boolean;
  transcriptPath: string;
  relativePath: string;
  recordId: string;
  itemCount: number;
  importRequest: DesktopChannelContextImportRequest;
  message: string;
}

export interface LoginRequest {
  email?: string;
  password?: string;
  apiKey?: string;
  defaultModel?: string;
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
  kind: "file" | "folder" | "browser" | "terminal" | "selection";
  path: string;
  name: string;
  url?: string;
  title?: string;
  visibleText?: string;
  screenshotDataUrl?: string;
  note?: string;
  fileHash?: string;
  blockedReason?: string;
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

export interface ChatToolTimelineEvent {
  id: string;
  kind: "tool_call" | "tool_result" | "log" | "diff" | "artifact";
  title: string;
  status?: "started" | "running" | "completed" | "failed";
  content?: string;
  toolName?: string;
  path?: string;
  timestamp?: string;
  level?: "INFO" | "WARNING" | "ERROR" | "DEBUG" | "TRACE" | "FATAL" | string;
}

export type ChatPartStatus = "pending" | "running" | "completed" | "error" | "cancelled";

export type ChatMessagePart =
  | { id: string; type: "text"; text: string; format: "markdown" | "plain"; status: ChatPartStatus }
  | { id: string; type: "reasoning"; text: string; visibility: "summary" | "raw"; status: ChatPartStatus }
  | { id: string; type: "tool"; event: ChatToolTimelineEvent; status: ChatPartStatus }
  | { id: string; type: "status"; text: string; level?: string; status: ChatPartStatus }
  | { id: string; type: "error"; message: string; code?: string; retryable: boolean; status: "error" }
  | { id: string; type: "file"; name: string; path: string; mime?: string; status: ChatPartStatus }
  | { id: string; type: "patch"; path?: string; diff: string; status: ChatPartStatus }
  | { id: string; type: "approval"; requestId: string; prompt: string; status: ChatPartStatus };

export interface ChatEvent {
  requestId: string;
  /** Monotonic per-request sequence assigned by the main process. */
  seq?: number;
  type: "start" | "chunk" | "reasoning" | "status" | "tool_timeline" | "done" | "error" | "aborted";
  content?: string;
  error?: string;
  level?: "INFO" | "WARNING" | "ERROR" | "DEBUG" | "TRACE" | "FATAL" | string;
  toolTimeline?: ChatToolTimelineEvent;
  sessionId?: string;
  runId?: string;
}

export type DesktopProviderAnalyticsProvider = "openai_responses" | "anthropic" | "google_gemini";

export interface DesktopProviderUsageAnalyticsRecord {
  id: string;
  recordedAt: string;
  requestId: string;
  sessionId: string;
  runId: string;
  provider: DesktopProviderAnalyticsProvider;
  eventName: string;
  status?: string;
  stopReason?: string;
  summary: string;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface DesktopProviderErrorAnalyticsRecord {
  id: string;
  recordedAt: string;
  requestId: string;
  sessionId: string;
  runId: string;
  provider: DesktopProviderAnalyticsProvider;
  eventName: string;
  code?: string;
  message: string;
  retryable: boolean;
  summary: string;
}

export type BrowserTaskPendingApproval = Extract<
  BrowserTaskEvent,
  { type: "action.proposed" }
>;

export type DesktopPendingApprovalSource =
  | "browser_task"
  | "shell"
  | "workspace"
  | "git"
  | "fork"
  | "workflow"
  | "network"
  | "connector";

export interface DesktopPendingApproval {
  id: string;
  source: DesktopPendingApprovalSource;
  actionKind: ExecutionActionKind;
  title: string;
  detail: string;
  target?: string;
  scope?: string;
  impact?: string;
  createdAt: string;
  risk: "low" | "medium" | "high";
  checklist?: DesktopCommitApprovalChecklist;
  taskId?: string;
  actionId?: string;
}

export interface DesktopCommitApprovalChecklist {
  type: "git_commit";
  stagedFiles: string[];
  workspaceChangedFileCount: number;
  unstagedFileCount: number;
  diffLineCount: number;
  diffTruncated: boolean;
  riskSummary: string;
  testCommitment: string;
  recentTestResult?: string;
}

export interface DesktopApprovalProposalRequest {
  source: Exclude<DesktopPendingApprovalSource, "browser_task">;
  actionKind: ExecutionActionKind;
  title: string;
  detail: string;
  target?: string;
  scope?: string;
  impact?: string;
  risk?: DesktopPendingApproval["risk"];
  checklist?: DesktopCommitApprovalChecklist;
  idempotencyKey?: string;
}

export interface DesktopApprovalProposalResult {
  queued: boolean;
  approval?: DesktopPendingApproval;
  allowed: boolean;
  requiresApproval: boolean;
  blocked: boolean;
  reason: string;
}

export interface DesktopApprovalDecisionRequest {
  id: string;
  approved: boolean;
  reason?: "reject" | "cancel";
}

export interface DesktopShellCommandApprovalRequest {
  terminalSessionId: string;
  commandId: string;
  command: string;
  invocation: string;
  risk?: DesktopPendingApproval["risk"];
  workflowRunId?: string;
  workflowStepId?: string;
}

export interface DesktopGitCommitApprovalRequest {
  workspacePath: string;
  message: string;
  body?: string;
  checklist?: DesktopCommitApprovalChecklist;
  requestId?: string;
}

export type DesktopForkLifecycleAction = "merge_back" | "discard";

export type DesktopForkQueueStatus =
  | "queued"
  | "waiting_approval"
  | "ready"
  | "running"
  | "blocked"
  | "completed";

export interface DesktopForkLifecycleApprovalRequest {
  threadId: string;
  action: DesktopForkLifecycleAction;
}

export interface DesktopForkLifecycleApprovalResult {
  queued: boolean;
  approval?: DesktopPendingApproval;
  thread?: DesktopThread;
  allowed: boolean;
  blocked: boolean;
  reason: string;
}

export interface DesktopForkQueueStartApprovalRequest {
  threadIds: string[];
}

export interface DesktopForkQueueStartApprovalResult {
  queued: boolean;
  approval?: DesktopPendingApproval;
  threads: DesktopThread[];
  allowed: boolean;
  blocked: boolean;
  reason: string;
}

export interface DesktopForkQueueDispatchRequest {
  threadIds: string[];
  selectedAgentId?: string;
  selectedAgentName?: string;
  threadAgentAssignments?: Record<string, DesktopForkQueueAgentAssignment>;
  model?: string;
}

export interface DesktopForkQueueAgentAssignment {
  agentId?: string;
  agentName?: string;
}

export interface DesktopForkQueueDispatchStartedRun {
  threadId: string;
  requestId: string;
  runId: string;
}

export interface DesktopForkQueueDispatchResult {
  startedRuns: DesktopForkQueueDispatchStartedRun[];
  threads: DesktopThread[];
  blockedThreadIds: string[];
  reason: string;
}

export interface DesktopForkConflictDraftWriteRequest {
  threadId: string;
  workspacePath: string;
  path: string;
  draft: string;
  expectedDiffHash: string;
}

export interface DesktopForkConflictDraftWriteResult {
  threadId: string;
  workspacePath: string;
  path: string;
  written: boolean;
  approvalId?: string;
  approvalQueued?: boolean;
  message: string;
}

export type DesktopProjectMemorySource =
  | "manual"
  | "chat_command"
  | "retrospective";

export interface DesktopProjectMemoryEntry {
  id: string;
  workspacePath: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  source: DesktopProjectMemorySource;
}

export interface DesktopProjectMemoryListRequest {
  workspacePath: string;
  limit?: number;
}

export interface DesktopProjectMemoryAddRequest {
  workspacePath: string;
  content: string;
  source?: DesktopProjectMemorySource;
}

export interface DesktopProjectMemoryUpdateRequest {
  workspacePath: string;
  entryId: string;
  content: string;
  source?: DesktopProjectMemorySource;
}

export interface DesktopProjectMemoryClearRequest {
  workspacePath: string;
  entryId?: string;
}

export interface DesktopProjectMemoryClearResult {
  workspacePath: string;
  removedCount: number;
}

export interface DesktopCustomCommand {
  id: string;
  workspacePath: string;
  name: string;
  title: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  source: "manual" | "chat_command";
}

export interface DesktopCustomCommandListRequest {
  workspacePath: string;
  limit?: number;
}

export interface DesktopCustomCommandUpsertRequest {
  workspacePath: string;
  name: string;
  prompt: string;
  title?: string;
  source?: DesktopCustomCommand["source"];
}

export interface DesktopCustomCommandDeleteRequest {
  workspacePath: string;
  commandIdOrName: string;
}

export interface DesktopCustomCommandDeleteResult {
  workspacePath: string;
  removedCount: number;
}

export interface DesktopProjectSkillDraft {
  id: string;
  workspacePath: string;
  title: string;
  slug: string;
  summary: string;
  skillMarkdown: string;
  draftPath: string;
  createdAt: string;
  updatedAt: string;
  source: "project_memory" | "manual";
  memoryEntryId?: string;
  installedAt?: string;
  installPath?: string;
  publishedAt?: string;
  marketplaceSubmissionPath?: string;
}

export interface DesktopProjectSkillDraftListRequest {
  workspacePath: string;
  limit?: number;
}

export interface DesktopProjectSkillDraftCreateRequest {
  workspacePath: string;
  content: string;
  title?: string;
  memoryEntryId?: string;
  source?: DesktopProjectSkillDraft["source"];
}

export interface DesktopProjectSkillInstallRequest {
  workspacePath: string;
  draftId: string;
  target?: "desktop_local";
}

export interface DesktopProjectSkillInstallResult {
  workspacePath: string;
  draftId: string;
  title: string;
  slug: string;
  target: "desktop_local";
  installedAt: string;
  installPath: string;
  alreadyInstalled: boolean;
}

export interface DesktopProjectSkillPublishRequest {
  workspacePath: string;
  draftId: string;
  target?: "marketplace_submission";
  notes?: string;
}

export interface DesktopProjectSkillPublishResult {
  workspacePath: string;
  draftId: string;
  title: string;
  slug: string;
  target: "marketplace_submission";
  publishedAt: string;
  submissionPath: string;
  alreadyPublished: boolean;
  verification: string;
}

export type DesktopWorkflowTemplateStatus =
  | "available"
  | "preview"
  | "planned";

export type DesktopWorkflowTemplateCategory =
  | "planning"
  | "review"
  | "testing"
  | "release"
  | "research"
  | "automation";

export interface DesktopWorkflowTemplate {
  id: string;
  name: string;
  category: DesktopWorkflowTemplateCategory;
  status: DesktopWorkflowTemplateStatus;
  summary: string;
  trigger: string;
  steps: string[];
  requiredCapabilities: string[];
  approvalRequired: boolean;
  verification: string;
  risk: "low" | "medium" | "high";
}

export interface DesktopWorkflowMarketplaceListResult {
  templates: DesktopWorkflowTemplate[];
  generatedAt: string;
  availableCount: number;
  approvalRequiredCount: number;
  syncedCount?: number;
  lastSyncedAt?: string;
}

export interface DesktopWorkflowMarketplaceSyncRequest {
  workspacePath: string;
  sourcePath?: string;
}

export interface DesktopWorkflowMarketplaceSyncResult {
  workspacePath: string;
  sourcePath: string;
  syncedAt: string;
  importedCount: number;
  ignoredCount: number;
  templates: DesktopWorkflowTemplate[];
  message: string;
}

export type DesktopWorkflowRunStepKind =
  | "chat_command"
  | "terminal_command"
  | "external_runtime"
  | "manual_review"
  | "approval";

export interface DesktopWorkflowRunStep {
  id: string;
  kind: DesktopWorkflowRunStepKind;
  title: string;
  detail: string;
  command?: string;
  requiresApproval: boolean;
}

export interface DesktopWorkflowRunPrepareRequest {
  templateId: string;
  workspacePath?: string;
}

export type DesktopWorkflowRunStatus =
  | "ready"
  | "approval_queued"
  | "blocked";

export interface DesktopWorkflowRunRecipe {
  id: string;
  templateId: string;
  name: string;
  workspacePath?: string;
  status: DesktopWorkflowRunStatus;
  createdAt: string;
  steps: DesktopWorkflowRunStep[];
  verification: string;
  approvalId?: string;
  message: string;
}

export interface DesktopWorkflowRunPrepareResult {
  recipe: DesktopWorkflowRunRecipe;
  approval?: DesktopPendingApproval;
  blocked: boolean;
  queued: boolean;
  reason: string;
}

export type DesktopWorkflowExecutionStatus =
  | "running"
  | "waiting_approval"
  | "blocked"
  | "complete";

export type DesktopWorkflowRunStepStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting_approval"
  | "blocked"
  | "completed";

export type DesktopWorkflowRunResumeAction =
  | "dispatch_chat"
  | "prepare_terminal"
  | "reconnect_external"
  | "confirm_manual"
  | "wait_approval";

export interface DesktopWorkflowRunStepExecution
  extends DesktopWorkflowRunStep {
  status: DesktopWorkflowRunStepStatus;
  message: string;
  completedAt?: string;
  resumableAfterRestart?: boolean;
  resumeAction?: DesktopWorkflowRunResumeAction;
  resumeMessage?: string;
  lastResumedAt?: string;
}

export interface DesktopWorkflowRunResumePlan {
  restartDetectedAt: string;
  pendingStepCount: number;
  resumableStepIds: string[];
  waitingApprovalStepIds: string[];
  message: string;
}

export interface DesktopWorkflowRun {
  id: string;
  recipeId: string;
  templateId: string;
  name: string;
  workspacePath?: string;
  status: DesktopWorkflowExecutionStatus;
  createdAt: string;
  updatedAt: string;
  currentStepId?: string;
  approvalId?: string;
  steps: DesktopWorkflowRunStepExecution[];
  verification: string;
  message: string;
  resumePlan?: DesktopWorkflowRunResumePlan;
}

export interface DesktopWorkflowRunStartRequest {
  recipe: DesktopWorkflowRunRecipe;
}

export interface DesktopWorkflowRunStartResult {
  run: DesktopWorkflowRun;
  chatCommands: string[];
  terminalCommands: string[];
  approvalIds: string[];
  manualCheckpoints: string[];
}

export interface DesktopWorkflowRunStepDispatchRequest {
  runId: string;
  stepId: string;
}

export interface DesktopWorkflowRunStepDispatchResult {
  run: DesktopWorkflowRun;
  dispatched: boolean;
  kind: DesktopWorkflowRunStepKind;
  command?: string;
  requiresApproval: boolean;
  message: string;
}

export interface DesktopWorkflowRunStepCompleteRequest {
  runId: string;
  stepId: string;
  exitCode: number;
  output?: string;
}

export interface DesktopWorkflowRunStepCompleteResult {
  run: DesktopWorkflowRun;
  completed: boolean;
  blocked: boolean;
  message: string;
}

export type DesktopBackgroundTaskKind =
  | "chat_run"
  | "workflow_run"
  | "agent_run"
  | "connector_sync"
  | "scheduled_monitor";

export type DesktopBackgroundTaskSource =
  | "chat"
  | "workflow"
  | "agent"
  | "connector"
  | "manual"
  | "scheduled"
  | "monitor";

export type DesktopBackgroundTaskStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export interface DesktopBackgroundTask {
  id: string;
  kind: DesktopBackgroundTaskKind;
  source: DesktopBackgroundTaskSource;
  title: string;
  status: DesktopBackgroundTaskStatus;
  createdAt: string;
  updatedAt: string;
  workspacePath?: string;
  targetId?: string;
  approvalId?: string;
  currentStep?: string;
  message: string;
  verification: string;
}

export interface DesktopBackgroundTaskListRequest {
  workspacePath?: string;
  limit?: number;
}

export interface DesktopBackgroundTaskEnqueueRequest {
  kind: DesktopBackgroundTaskKind;
  source: DesktopBackgroundTaskSource;
  title: string;
  workspacePath?: string;
  targetId?: string;
  approvalId?: string;
  currentStep?: string;
  message?: string;
  verification?: string;
  status?: DesktopBackgroundTaskStatus;
}

export interface DesktopBackgroundTaskUpdateRequest {
  taskId: string;
  status: DesktopBackgroundTaskStatus;
  message?: string;
  currentStep?: string;
  verification?: string;
}

export type DesktopScheduledTaskKind = "scheduled" | "monitor";

export type DesktopScheduledTaskStatus = "enabled" | "paused" | "blocked";

export type DesktopScheduledTaskCadence =
  | "manual"
  | "hourly"
  | "daily"
  | "weekly";

export interface DesktopScheduledTask {
  id: string;
  kind: DesktopScheduledTaskKind;
  title: string;
  status: DesktopScheduledTaskStatus;
  cadence: DesktopScheduledTaskCadence;
  createdAt: string;
  updatedAt: string;
  workspacePath?: string;
  target: string;
  workflowTemplateId?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  activeWorkflowRunId?: string;
  activeWorkflowRunStatus?: DesktopWorkflowExecutionStatus;
  activeWorkflowRunUpdatedAt?: string;
  approvalRequired: boolean;
  message: string;
  verification: string;
}

export interface DesktopScheduledTaskListRequest {
  workspacePath?: string;
  limit?: number;
}

export interface DesktopScheduledTaskCreateRequest {
  kind: DesktopScheduledTaskKind;
  title: string;
  cadence: DesktopScheduledTaskCadence;
  target: string;
  workspacePath?: string;
  workflowTemplateId?: string;
  nextRunAt?: string;
  approvalRequired?: boolean;
  verification?: string;
  message?: string;
  status?: DesktopScheduledTaskStatus;
}

export interface DesktopScheduledTaskUpdateRequest {
  taskId: string;
  status: DesktopScheduledTaskStatus;
  nextRunAt?: string;
  message?: string;
  verification?: string;
}

export type DesktopScheduledTaskRunItemStatus =
  | "started"
  | "queued_approval"
  | "reconnected"
  | "skipped"
  | "blocked";

export interface DesktopScheduledTaskRunRequest {
  workspacePath?: string;
  now?: string;
  limit?: number;
}

export interface DesktopScheduledTaskRunItem {
  taskId: string;
  title: string;
  status: DesktopScheduledTaskRunItemStatus;
  message: string;
  nextRunAt?: string;
  workflowRunId?: string;
  approvalId?: string;
  reason?: string;
}

export interface DesktopScheduledTaskRunResult {
  generatedAt: string;
  checked: number;
  triggered: number;
  reconnected: number;
  skipped: number;
  blocked: number;
  items: DesktopScheduledTaskRunItem[];
  runs: DesktopWorkflowRun[];
}

export interface DesktopScheduledTaskWorkerStatus {
  enabled: boolean;
  running: boolean;
  stopped: boolean;
  intervalMs: number;
  initialDelayMs: number;
  nextRunAt?: string;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastResult?: {
    generatedAt: string;
    checked: number;
    triggered: number;
    reconnected: number;
    skipped: number;
    blocked: number;
  };
  lastError?: string;
  message: string;
}

export type DesktopChannelAdapterProvider =
  | "mobile"
  | "slack"
  | "github"
  | "docs"
  | "calendar"
  | "database"
  | "telegram"
  | "discord"
  | "voice"
  | "file_upload";

export type DesktopChannelAdapterKind =
  | "chat"
  | "connector"
  | "input";

export type DesktopChannelAdapterStatus =
  | "available"
  | "config_required"
  | "planned"
  | "disabled";

export interface DesktopChannelAdapter {
  id: string;
  name: string;
  provider: DesktopChannelAdapterProvider;
  kind: DesktopChannelAdapterKind;
  status: DesktopChannelAdapterStatus;
  direction: "inbound" | "outbound" | "bidirectional";
  configured: boolean;
  requiresApproval: boolean;
  capabilities: string[];
  description: string;
  setupHint?: string;
  authMode?: "not_configured" | "local_git_remote" | "oauth" | "session_stub";
  accountLabel?: string;
  scopeLabel?: string;
  configuredAt?: string;
  lastImportAt?: string;
  credentialState?: "missing" | "placeholder" | "configured";
  sessionExpiresAt?: string;
  authPreparedAt?: string;
}

export interface DesktopChannelAdapterListResult {
  adapters: DesktopChannelAdapter[];
  generatedAt: string;
  configuredCount: number;
  availableCount: number;
}

export interface DesktopChannelAdapterConfigureRequest {
  adapterId: string;
  workspacePath: string;
  mode?: "local_git_remote" | "session_stub";
  accountLabel?: string;
  scopeLabel?: string;
  credentialState?: "missing" | "placeholder" | "configured";
  sessionExpiresAt?: string;
}

export interface DesktopChannelAdapterAuthStartRequest {
  adapterId: string;
  workspacePath: string;
  scopes?: string[];
}

export interface DesktopChannelAdapterAuthStartResult {
  adapterId: string;
  provider: DesktopChannelAdapterProvider;
  workspacePath: string;
  authMode: "oauth" | "device_pairing";
  authorizationUrl: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  intervalSeconds: number;
  scopes: string[];
  message: string;
  verification: string;
}

export interface DesktopChannelConnection {
  adapterId: string;
  workspacePath: string;
  provider: DesktopChannelAdapterProvider;
  mode: "local_git_remote" | "session_stub";
  configuredAt: string;
  updatedAt: string;
  accountLabel: string;
  scopeLabel: string;
  repository?: string;
  remoteUrl?: string;
  lastImportAt?: string;
  credentialState?: "missing" | "placeholder" | "configured";
  sessionExpiresAt?: string;
  authPreparedAt?: string;
  readOnly: boolean;
}

export interface DesktopChannelAdapterConfigureResult {
  adapter: DesktopChannelAdapter;
  connection: DesktopChannelConnection;
  message: string;
  verification: string;
}

export interface DesktopChannelContextImportRequest {
  adapterId: string;
  workspacePath: string;
  limit?: number;
  paths?: string[];
  githubSnapshotPath?: string;
  snapshotPath?: string;
  slackSnapshotPath?: string;
  mobileSnapshotPath?: string;
  voiceTranscriptPath?: string;
  logMonitorPath?: string;
}

export type DesktopChannelContextItemKind =
  | "file"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "folder"
  | "issue"
  | "pull_request"
  | "meeting"
  | "database_table"
  | "slack_message"
  | "mobile_message"
  | "voice_transcript";

export interface DesktopChannelContextItem {
  id: string;
  adapterId: string;
  provider: DesktopChannelAdapterProvider;
  kind: DesktopChannelContextItemKind;
  title: string;
  path: string;
  relativePath: string;
  summary: string;
  size?: number;
  mime?: string;
  truncated: boolean;
}

export interface DesktopChannelContextImportResult {
  adapterId: string;
  workspacePath: string;
  importedAt: string;
  items: DesktopChannelContextItem[];
  truncated: boolean;
  message: string;
  verification: string;
}

export interface DesktopChannelSnapshotSyncRequest {
  workspacePath: string;
  adapterIds?: string[];
  limit?: number;
}

export interface DesktopChannelSnapshotSyncResult {
  workspacePath: string;
  syncedAt: string;
  adapterIds: string[];
  results: DesktopChannelContextImportResult[];
  queuedEventCount: number;
  skippedAdapterIds: string[];
  message: string;
  verification: string;
}

export type DesktopChannelInboundEventStatus = "queued" | "routed" | "dismissed";

export interface DesktopChannelInboundEvent {
  id: string;
  adapterId: string;
  provider: DesktopChannelAdapterProvider;
  workspacePath: string;
  status: DesktopChannelInboundEventStatus;
  title: string;
  summary: string;
  receivedAt: string;
  updatedAt: string;
  itemCount: number;
  items: DesktopChannelContextItem[];
  verification: string;
}

export interface DesktopChannelInboundEventListRequest {
  workspacePath?: string;
  status?: DesktopChannelInboundEventStatus;
  limit?: number;
}

export interface DesktopChannelInboundEventRouteRequest {
  eventId: string;
  workspacePath?: string;
  action?: "route_to_chat" | "dismiss";
}

export interface DesktopChannelInboundEventRouteResult {
  event: DesktopChannelInboundEvent;
  importResult: DesktopChannelContextImportResult;
  message: string;
  verification: string;
}

export interface DesktopChannelOutboundDraftRequest {
  adapterId: string;
  workspacePath?: string;
  target: string;
  body: string;
  subject?: string;
  idempotencyKey?: string;
}

export interface DesktopChannelOutboundDraftResult {
  queued: boolean;
  approval?: DesktopPendingApproval;
  delivery?: DesktopChannelOutboundDelivery;
  allowed: boolean;
  blocked: boolean;
  reason: string;
  verification: string;
}

export type DesktopChannelOutboundDeliveryStatus =
  | "blocked"
  | "rejected"
  | "sent"
  | "failed";

export interface DesktopChannelOutboundDelivery {
  id: string;
  approvalId: string;
  adapterId: string;
  provider: DesktopChannelAdapterProvider;
  workspacePath?: string;
  target: string;
  subject?: string;
  status: DesktopChannelOutboundDeliveryStatus;
  runtime?: "missing_live_provider" | "workspace_local_outbox";
  outboxPath?: string;
  createdAt: string;
  updatedAt: string;
  message: string;
  verification: string;
}

export interface DesktopChannelOutboundDeliveryListRequest {
  workspacePath?: string;
  limit?: number;
}

export type DesktopExternalConnectionId =
  | "github"
  | "chrome"
  | "latex"
  | "mobile"
  | "slack"
  | "docs"
  | "calendar"
  | "database"
  | "log-monitor"
  | "unified";

export type DesktopExternalConnectionReadinessStatus =
  | "available"
  | "partial"
  | "planned";

export interface DesktopExternalReconnectPolicy {
  mode: "manual_review";
  automatic: boolean;
  triggers: string[];
  safeguards: string[];
  nextStep: string;
  verification: string;
}

export interface DesktopExternalConnectionReadiness {
  id: DesktopExternalConnectionId;
  name: string;
  status: DesktopExternalConnectionReadinessStatus;
  configured: boolean;
  readOnly: boolean;
  capabilitySources: string[];
  evidence: string[];
  gaps: string[];
  reconnectReadinessChecks?: string[];
  reconnectPolicy?: DesktopExternalReconnectPolicy;
  approvalBoundary: string;
  verification: string;
}

export interface DesktopExternalConnectionReadinessResult {
  workspacePath?: string;
  generatedAt: string;
  readyCount: number;
  partialCount: number;
  plannedCount: number;
  connections: DesktopExternalConnectionReadiness[];
  message: string;
  verification: string;
}

export type DesktopMcpContextKind = "resource" | "tool";

export interface DesktopMcpContextRequest {
  workspacePath: string;
  kind: DesktopMcpContextKind;
  selector?: string;
  limit?: number;
}

export interface DesktopMcpContextItem {
  id: string;
  kind: DesktopMcpContextKind;
  server: string;
  name: string;
  title: string;
  uri?: string;
  description?: string;
  inputSchema?: string;
  content: string;
  truncated: boolean;
}

export interface DesktopMcpContextResult {
  workspacePath: string;
  importedAt: string;
  sourcePath: string;
  kind: DesktopMcpContextKind;
  items: DesktopMcpContextItem[];
  truncated: boolean;
  message: string;
  verification: string;
}

export type DesktopMcpLiveEnumerationStatus =
  | "approval_queued"
  | "completed"
  | "blocked"
  | "cancelled";

export interface DesktopMcpLiveEnumerationRequest {
  workspacePath: string;
  server?: string;
  reuseSession?: boolean;
}

export interface DesktopMcpLiveServerSummary {
  name: string;
  command: string;
  status: "configured" | "enumerated";
  resourceCount: number;
  toolCount: number;
  description?: string;
}

export interface DesktopMcpLiveEnumerationResult {
  workspacePath: string;
  configPath: string;
  sourcePath: string;
  status: DesktopMcpLiveEnumerationStatus;
  servers: DesktopMcpLiveServerSummary[];
  resourceCount: number;
  toolCount: number;
  approvalId?: string;
  approvalQueued: boolean;
  reusedSession?: boolean;
  sessionReuseKey?: string;
  message: string;
  verification: string;
  enumeratedAt?: string;
}

export interface DesktopMcpToolExecutionApprovalRequest {
  workspacePath: string;
  server: string;
  tool: string;
  input?: string;
  reuseSession?: boolean;
}

export interface DesktopMcpToolExecutionApprovalResult {
  workspacePath: string;
  server: string;
  tool: string;
  status?: "approval_queued" | "completed" | "blocked" | "cancelled";
  approvalId?: string;
  queued: boolean;
  blocked: boolean;
  allowed: boolean;
  sourcePath?: string;
  resultContextName?: string;
  outputPreview?: string;
  reusedSession?: boolean;
  sessionReuseKey?: string;
  executedAt?: string;
  message: string;
  verification: string;
}

export type DesktopMcpToolExecutionAuditStatus =
  | "completed"
  | "failed"
  | "rejected"
  | "cancelled";

export interface DesktopMcpToolExecutionAuditEntry {
  id: string;
  workspacePath: string;
  approvalId?: string;
  server: string;
  tool: string;
  status: DesktopMcpToolExecutionAuditStatus;
  resultContextName?: string;
  sourcePath?: string;
  inputPreview: string;
  outputPreview?: string;
  reusedSession?: boolean;
  sessionReuseKey?: string;
  message: string;
  verification: string;
  createdAt: string;
}

export interface DesktopMcpToolExecutionAuditListRequest {
  workspacePath: string;
  limit?: number;
}

export type DesktopMcpSessionAuditPhase =
  | "enumeration"
  | "tool_execution"
  | "reusable_pool";

export type DesktopMcpSessionAuditStatus =
  | "started"
  | "completed"
  | "failed"
  | "timed_out"
  | "rejected"
  | "cancelled"
  | "closed";

export interface DesktopMcpSessionAuditEntry {
  id: string;
  workspacePath: string;
  approvalId?: string;
  sessionId: string;
  phase: DesktopMcpSessionAuditPhase;
  server: string;
  tool?: string;
  status: DesktopMcpSessionAuditStatus;
  resourceCount?: number;
  toolCount?: number;
  reusedSession?: boolean;
  sessionReuseKey?: string;
  message: string;
  verification: string;
  createdAt: string;
}

export interface DesktopMcpSessionAuditListRequest {
  workspacePath: string;
  limit?: number;
}

export interface DesktopMcpActiveSession {
  sessionId: string;
  workspacePath: string;
  phase: DesktopMcpSessionAuditPhase;
  server: string;
  tool?: string;
  startedAt: string;
  approvalId?: string;
  command: string;
  reusable?: boolean;
  sessionReuseKey?: string;
}

export interface DesktopMcpActiveSessionListRequest {
  workspacePath: string;
}

export type DesktopMcpReusableSessionStatus =
  | "ready"
  | "busy"
  | "idle"
  | "restart_reconnect_required";

export interface DesktopMcpReusableSession {
  sessionReuseKey: string;
  workspacePath: string;
  server: string;
  command: string;
  startedAt: string;
  lastUsedAt: string;
  status: DesktopMcpReusableSessionStatus;
  pendingRequestCount: number;
  idleExpiresAt?: string;
  idleExpiresInMs?: number;
  stderrPreview?: string;
  restartDetectedAt?: string;
  diagnosticMessage?: string;
}

export interface DesktopMcpReusableSessionListRequest {
  workspacePath: string;
}

export interface DesktopMcpReusableSessionCloseRequest {
  workspacePath: string;
  sessionReuseKey: string;
}

export interface DesktopMcpReusableSessionCloseResult {
  workspacePath: string;
  sessionReuseKey: string;
  closed: boolean;
  message: string;
  verification: string;
}

export interface DesktopMcpSessionCancelRequest {
  workspacePath: string;
  sessionId: string;
}

export interface DesktopMcpSessionCancelResult {
  workspacePath: string;
  sessionId: string;
  cancelled: boolean;
  message: string;
  verification: string;
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

export type DesktopAgentSource = "local" | "remote";
export type DesktopAgentStatus = "running" | "stopped" | "unreachable";
export type DesktopAgentExample =
  | string
  | {
      en?: string;
      zh?: string;
    };

export interface DesktopAgent {
  id: string;
  name: string;
  description: string;
  owner: string;
  source: DesktopAgentSource;
  status: DesktopAgentStatus;
  url?: string;
  model?: string;
  logo?: string;
  examples?: DesktopAgentExample[] | string;
  error?: string;
}

export interface MyDrSaiReasoningConfig {
  supported?: boolean;
  effort_levels?: string[];
  param_type?: string;
}

export interface MyDrSaiTokenizerCalibrationSample {
  sample: string;
  tokens: number;
}

export interface MyDrSaiModelConfig {
  alias: string;
  display_name?: string;
  client_type?: string;
  model?: string;
  token_limit?: number;
  max_tokens?: number;
  tokenizer_calibration?: MyDrSaiTokenizerCalibrationSample[];
  vision?: boolean;
  reasoning?: MyDrSaiReasoningConfig;
}

export interface MyDrSaiCliConfig {
  user_id?: string;
  defult_config_name?: string;
  plan_mode?: boolean;
  workspace_enabled?: boolean;
  dangerous_allowed?: boolean;
  max_agent_concurrent?: number;
  context_type?: string;
  [key: string]: unknown;
}

export interface MyDrSaiConfig {
  ready: boolean;
  baseUrl: string;
  cliPath?: string;
  config: MyDrSaiCliConfig;
  models: MyDrSaiModelConfig[];
  defaultModelAlias?: string;
  error?: string;
}

export interface UpdateMyDrSaiConfigRequest {
  user_id?: string;
  defult_config_name?: string;
  plan_mode?: boolean;
  workspace_enabled?: boolean;
  dangerous_allowed?: boolean;
}

export interface DesktopThread {
  id: string;
  kind: "chat" | "agent_run";
  title: string;
  workspacePath?: string;
  fork?: DesktopThreadForkMetadata;
  createdAt: string;
  updatedAt: string;
  lastRunId?: string;
  lastRequestId?: string;
  status?: "idle" | "running" | "error";
  messageCount?: number;
  pinned?: boolean;
  archived?: boolean;
  unread?: boolean;
}

export interface DesktopThreadMessageSnapshot extends ChatMessage {
  id: string;
  streaming?: boolean;
  error?: boolean;
  statusContent?: string;
  reasoningContent?: string;
  toolTimeline?: ChatToolTimelineEvent[];
  /** Canonical structured display representation; legacy fields remain during migration. */
  parts?: ChatMessagePart[];
  startedAt?: number;
  lastEventAt?: number;
}

export interface DesktopThreadSnapshot {
  threadId: string;
  title: string;
  messages: DesktopThreadMessageSnapshot[];
  updatedAt: number;
  messageCount: number;
}

export interface DesktopThreadContentSearchRequest {
  query: string;
  threadIds?: string[];
  limit?: number;
}

export interface DesktopThreadContentSearchResult {
  threadId: string;
  messageId: string;
  role: ChatMessage["role"];
  snippet: string;
  updatedAt: number;
}

export interface DesktopThreadForkMetadata {
  sourceWorkspacePath: string;
  repoRoot: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  createdAt: string;
  sourceHasChanges: boolean;
  sourceStatusSummary?: string;
  lifecycleStatus: "active" | "merge_pending" | "merged" | "cleanup_pending" | "closed";
  lifecycleMessage?: string;
  lifecycleUpdatedAt?: string;
  mergedCommit?: string;
  branchCleanupStatus?: "pending" | "deleted" | "archived" | "retained";
  branchCleanupMessage?: string;
  archivedBranch?: string;
  queueGroupId?: string;
  queueIndex?: number;
  queueSize?: number;
  queueStatus?: DesktopForkQueueStatus;
  queueApprovalId?: string;
  queueAgentHint?: string;
  queueAgentId?: string;
  queueAgentName?: string;
  queueMessage?: string;
  queueUpdatedAt?: string;
}

export interface DesktopForkWorktreeRequest {
  workspacePath: string;
  intent?: string;
}

export interface DesktopForkWorktreeResult {
  sourceWorkspacePath: string;
  repoRoot: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  sourceHasChanges: boolean;
  sourceStatusSummary?: string;
}

export interface WorkspaceGitStatus {
  repoRoot?: string;
  branch?: string;
  hasChanges?: boolean;
}

export interface WorkspaceInstructionSummary {
  name: "AGENTS.md" | "DRSAI.md" | "CLAUDE.md" | "project.md";
  path: string;
  content: string;
  truncated: boolean;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  path: string;
  type: "local" | "remote-ssh";
  remote?: RemoteSshWorkspaceDescriptor;
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

export type WorkspacePreviewKind =
  | "text"
  | "code"
  | "markdown"
  | "html"
  | "json"
  | "config"
  | "structured"
  | "table"
  | "image"
  | "notebook"
  | "pdf"
  | "office"
  | "media"
  | "binary"
  | "large"
  | "unknown";

export type WorkspaceFileGitStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "clean";

export interface WorkspaceContextOverview {
  workspacePath: string;
  trusted: boolean;
  git?: WorkspaceGitStatus & {
    changedFiles: Array<{
      path: string;
      status: WorkspaceFileGitStatus;
    }>;
  };
  instructions: WorkspaceInstructionSummary[];
  stats: {
    instructionCount: number;
    changedFileCount: number;
  };
}

export interface WorkspaceFileNode {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "directory";
  extension?: string;
  size?: number;
  modifiedAt?: string;
  gitStatus?: WorkspaceFileGitStatus;
  previewKind?: WorkspacePreviewKind;
  children?: WorkspaceFileNode[];
  truncated?: boolean;
}

export interface WorkspaceFileTreeRequest {
  workspacePath: string;
  query?: string;
  maxDepth?: number;
  maxEntries?: number;
  offset?: number;
}

export interface WorkspaceFileTreeResult {
  workspacePath: string;
  nodes: WorkspaceFileNode[];
  totalEntries: number;
  truncated: boolean;
  nextOffset?: number;
}

export interface WorkspaceFolderSummaryRequest {
  path: string;
  maxDepth?: number;
  maxEntries?: number;
  maxSampleFiles?: number;
  maxChars?: number;
}

export interface WorkspaceFolderSummaryFile {
  path: string;
  relativePath: string;
  kind: WorkspacePreviewKind;
  size: number;
  outline?: string[];
}

export interface WorkspaceFolderSummaryResult {
  path: string;
  name: string;
  totalEntries: number;
  fileCount: number;
  directoryCount: number;
  skippedDirectoryCount: number;
  truncated: boolean;
  estimatedTokens: number;
  sampledFiles: WorkspaceFolderSummaryFile[];
  summary: string;
}

export interface WorkspaceFilePreviewRequest {
  workspacePath: string;
  path: string;
  maxBytes?: number;
  mode?: "auto" | "head" | "tail" | "outline";
}

export interface WorkspaceFilePreview {
  workspacePath: string;
  path: string;
  relativePath: string;
  name: string;
  kind: WorkspacePreviewKind;
  mime: string;
  size: number;
  modifiedAt: string;
  truncated: boolean;
  fileHash?: string;
  content?: string;
  dataUrl?: string;
  rows?: string[][];
  columns?: string[];
  message?: string;
  metadata?: Record<string, string | number | boolean | null>;
  mode?: "auto" | "head" | "tail" | "outline";
  outline?: string[];
}

export interface WorkspaceGitDiffRequest {
  workspacePath: string;
  path?: string;
  maxChars?: number;
  staged?: boolean;
}

export interface WorkspaceGitDiffResult {
  workspacePath: string;
  path?: string;
  diff: string;
  diffHash?: string;
  truncated: boolean;
  staged?: boolean;
}

export interface WorkspaceGitFileAtRefRequest {
  workspacePath: string;
  ref: string;
  path: string;
  maxBytes?: number;
}

export interface WorkspaceGitFileAtRefResult {
  workspacePath: string;
  ref: string;
  path: string;
  content: string;
  contentHash?: string;
  truncated: boolean;
  missing: boolean;
  message: string;
}

export interface WorkspaceRevertFileRequest {
  workspacePath: string;
  path: string;
  expectedDiffHash: string;
}

export interface WorkspaceRevertFileResult {
  workspacePath: string;
  path: string;
  reverted: boolean;
  approvalId?: string;
  approvalQueued?: boolean;
  message: string;
}

export interface WorkspaceStageFileRequest {
  workspacePath: string;
  path: string;
  expectedDiffHash: string;
}

export interface WorkspaceStageFileResult {
  workspacePath: string;
  path: string;
  staged: boolean;
  approvalId?: string;
  approvalQueued?: boolean;
  message: string;
}

export interface WorkspaceHunkActionRequest {
  workspacePath: string;
  path: string;
  expectedDiffHash: string;
  patch: string;
}

export interface WorkspaceHunkActionResult {
  workspacePath: string;
  path: string;
  applied: boolean;
  approvalId?: string;
  approvalQueued?: boolean;
  message: string;
}

export interface WorkspaceCheckpointEntry {
  path: string;
  relativePath: string;
  status: WorkspaceFileGitStatus;
  size: number;
  fileHash?: string;
  stored: boolean;
  existed: boolean;
  skippedReason?: string;
}

export interface WorkspaceCheckpoint {
  id: string;
  workspacePath: string;
  label: string;
  createdAt: string;
  baseRef?: string;
  changedFileCount: number;
  storedFileCount: number;
  skippedFileCount: number;
  truncated?: boolean;
  entries: WorkspaceCheckpointEntry[];
  kind?: "manual" | "agent_run_baseline";
  runId?: string;
  reviewStatus?: "pending" | "accepted" | "rejected";
  reviewedAt?: string;
}

export interface WorkspaceFileChangeEvent {
  workspacePath: string;
  changes: Array<{ path: string; type: "created" | "modified" | "deleted" }>;
}

export interface RemoteSshHost {
  alias: string;
  hostname: string;
  user?: string;
  port: number;
  proxyJump?: string;
}

export type RemoteWorkspaceConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export interface RemoteSshWorkspaceDescriptor {
  hostAlias: string;
  canonicalPath: string;
  workspaceId: string;
  connectionState: RemoteWorkspaceConnectionState;
  localPort?: number;
  gatewayVersion?: string;
  protocolVersion?: number;
  capabilities?: Record<string, number>;
  error?: string;
  mode?: string;
}

export type PlatformAgentState =
  | "ready"
  | "native_api_unavailable"
  | "requires_login"
  | "forbidden"
  | "error";

export interface PlatformAgentStatus {
  state: PlatformAgentState;
  apiVersion: string | null;
  capabilities: string[];
  message: string;
  lastCheckedAt: string | null;
}

export interface RemoteDirectoryEntry {
  name: string;
  path: string;
  directory: boolean;
  readable?: boolean;
  writable?: boolean;
  mode?: string;
}

export interface ConnectRemoteWorkspaceRequest {
  hostAlias: string;
  path: string;
  trusted?: boolean;
  name?: string;
}

export interface RemoteWorkspaceStatus extends RemoteSshWorkspaceDescriptor {
  connected: boolean;
  gatewayReady: boolean;
}

export interface RemoteSshDiagnosticReport {
  generatedAt: string;
  hosts: Array<{ hostAlias: string; state: RemoteWorkspaceConnectionState; workspaceCount: number; gatewayVersion?: string; protocolVersion?: number; reconnectAttempts: number; reconnectCount: number; ageMs: number; lastConnectedAt?: string; error?: string; events: Array<{ at: string; phase: string; elapsedMs?: number; message?: string }> }>;
}

export interface RemoteGatewayPreflight {
  hostAlias: string;
  pythonVersion: string;
  gatewayInstalled: boolean;
  gatewayVersion?: string;
  currentRelease?: string;
  previousRelease?: string;
}

export interface RemoteGatewayInstallRequest {
  hostAlias: string;
  action: "install" | "upgrade" | "rollback";
  version?: string;
  artifactPath?: string;
  artifactSha256?: string;
}

export interface RemoteGatewayInstallResult extends RemoteGatewayPreflight {
  changed: boolean;
  action: RemoteGatewayInstallRequest["action"];
}

export interface RemoteGatewayOperationEvent {
  operationId: string;
  hostAlias: string;
  action: RemoteGatewayInstallRequest["action"];
  state: "running" | "completed" | "failed" | "cancelled";
  phase: "validating" | "uploading" | "verifying" | "installing" | "health-check" | "switching" | "completed";
  progress: number;
  message: string;
}

export interface RemoteHepaiWorker {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  callables?: string[];
  status?: "available" | "unavailable" | "disabled";
}

export interface WorkspaceCheckpointCreateRequest {
  workspacePath: string;
  label?: string;
  maxFiles?: number;
  maxBytesPerFile?: number;
  kind?: "manual" | "agent_run_baseline";
  runId?: string;
}

export interface WorkspaceCheckpointRestoreRequest {
  workspacePath: string;
  checkpointId: string;
}

export interface WorkspaceCheckpointAcceptRequest {
  workspacePath: string;
  checkpointId: string;
}

export interface WorkspaceCheckpointPreviewRequest {
  workspacePath: string;
  checkpointId: string;
  maxFiles?: number;
  maxCharsPerFile?: number;
}

export type WorkspaceCheckpointPreviewChange =
  | "added"
  | "modified"
  | "deleted"
  | "unchanged"
  | "skipped";

export interface WorkspaceCheckpointPreviewEntry {
  path: string;
  relativePath: string;
  checkpointStatus: WorkspaceFileGitStatus;
  change: WorkspaceCheckpointPreviewChange;
  stored: boolean;
  existedAtCheckpoint: boolean;
  currentExists: boolean;
  checkpointHash?: string;
  currentHash?: string;
  checkpointSize?: number;
  currentSize?: number;
  checkpointSnippet?: string;
  currentSnippet?: string;
  message: string;
}

export interface WorkspaceCheckpointPreviewResult {
  workspacePath: string;
  checkpointId: string;
  label: string;
  createdAt: string;
  totalEntries: number;
  changedEntryCount: number;
  skippedEntryCount: number;
  truncated: boolean;
  entries: WorkspaceCheckpointPreviewEntry[];
  message: string;
}

export interface WorkspaceCheckpointRestoreResult {
  workspacePath: string;
  checkpointId: string;
  restored: boolean;
  restoredFileCount: number;
  removedFileCount: number;
  skippedFileCount: number;
  approvalId?: string;
  approvalQueued?: boolean;
  message: string;
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
  fork?: DesktopThreadForkMetadata;
}

export interface UpdateThreadRequest {
  id: string;
  kind?: DesktopThread["kind"];
  title?: string;
  workspacePath?: string;
  fork?: DesktopThreadForkMetadata;
  lastRunId?: string;
  lastRequestId?: string;
  status?: DesktopThread["status"];
  messageCount?: number;
  pinned?: boolean;
  archived?: boolean;
  unread?: boolean;
}

export interface AgentRunEvent {
  requestId: string;
  sessionId: string;
  runId: string;
  type: "start" | "chunk" | "file_event" | "done" | "error" | "aborted";
  content?: string;
  error?: string;
  fileEvent?: AgentRunFileEvent;
}

export interface AgentRunFileEvent {
  action: "read" | "create" | "modify" | "delete" | "rename" | "patch" | "artifact";
  path: string;
  name?: string;
  hash?: string;
  diff?: string;
  source?: string;
  targetPath?: string;
  timestamp?: string;
}

export interface SaveApiKeyResult {
  ok: boolean;
  message: string;
}

export interface PickDialogResult {
  canceled: boolean;
  paths: string[];
}

export type DesktopIdeContextSource =
  | "vscode"
  | "jetbrains"
  | "visual_studio"
  | "manual"
  | "unknown";

export interface DesktopIdeContextFile {
  path: string;
  name: string;
  relativePath?: string;
  language?: string;
  line?: number;
  column?: number;
}

export interface DesktopIdeContextSelection {
  path: string;
  name: string;
  relativePath?: string;
  text: string;
  startLine?: number;
  endLine?: number;
  language?: string;
  truncated: boolean;
}

export interface DesktopIdeContextSnapshot {
  available: boolean;
  workspacePath: string;
  source: DesktopIdeContextSource;
  capturedAt?: string;
  currentFile?: DesktopIdeContextFile;
  currentSelection?: DesktopIdeContextSelection;
  message: string;
}

export interface DesktopFileIconResult {
  path: string;
  dataUrl: string | null;
}

export interface TerminalCreateOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  workspaceKey?: string;
  title?: string;
  shellProfile?: TerminalShellProfile;
  remoteHostAlias?: string;
}

export type TerminalShellProfile =
  | "powershell"
  | "pwsh"
  | "cmd"
  | "git-bash"
  | "wsl";

export interface TerminalSessionInfo {
  id: string;
  pid: number;
  shell: string;
  shellProfile: TerminalShellProfile;
  cwd: string;
  title: string;
  workspaceKey: string;
  createdAt: string;
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
  onAuthSessionInvalidated(callback: () => void): () => void;
  getA5ServiceGuidanceScenario(): Promise<DesktopA5ServiceGuidanceScenario | null>;
  login(request: LoginRequest): Promise<LoginResult>;
  startOidcLogin(request?: { rememberMe?: boolean }): Promise<LoginResult>;
  cancelOidcLogin(): Promise<boolean>;
  startDesktopSsoLogin(): Promise<DesktopSsoStartResult>;
  startWechatDesktopLogin(): Promise<DesktopSsoStartResult>;
  pollDesktopSsoLogin(deviceCode: string): Promise<DesktopSsoPollResult>;
  cancelDesktopSsoLogin(deviceCode: string): Promise<boolean>;
  logout(options?: LogoutOptions): Promise<{ ok: boolean; message: string }>;
  refreshAuthSession(): Promise<AuthSession>;
  bootstrapDesktop(): Promise<DesktopBootstrapResult>;
  getHealth(): Promise<DesktopHealth>;
  getInstallStatus(): Promise<InstallStatus>;
  getGatewayStatus(): Promise<GatewayStatus>;
  listProviderUsageAnalytics(): Promise<DesktopProviderUsageAnalyticsRecord[]>;
  listProviderErrorAnalytics(): Promise<DesktopProviderErrorAnalyticsRecord[]>;
  checkForUpdates(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  cancelUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<UpdateStatus>;
  startInstall(options?: StartInstallOptions): Promise<void>;
  cancelInstall(): Promise<boolean>;
  copyTextToClipboard(text: string): Promise<boolean>;
  startGateway(): Promise<boolean>;
  stopGateway(): Promise<boolean>;
  listSshHosts(): Promise<RemoteSshHost[]>;
  testSshHost(hostAlias: string): Promise<boolean>;
  approveSshHostKey(hostAlias: string): Promise<boolean>;
  listRemoteDirectories(hostAlias: string, path?: string): Promise<RemoteDirectoryEntry[]>;
  connectRemoteWorkspace(request: ConnectRemoteWorkspaceRequest): Promise<WorkspaceProject>;
  disconnectRemoteWorkspace(workspaceId: string): Promise<boolean>;
  getRemoteWorkspaceStatus(workspaceId: string): Promise<RemoteWorkspaceStatus>;
  listRemoteThreads(workspaceId: string): Promise<DesktopThread[]>;
  preflightRemoteGateway(hostAlias: string): Promise<RemoteGatewayPreflight>;
  getRemoteSshDiagnosticReport(): Promise<RemoteSshDiagnosticReport>;
  installRemoteGateway(request: RemoteGatewayInstallRequest): Promise<RemoteGatewayInstallResult>;
  requestRemoteGatewayInstallApproval(
    request: RemoteGatewayInstallRequest,
  ): Promise<DesktopApprovalProposalResult>;
  cancelRemoteGatewayOperation(hostAlias: string): Promise<boolean>;
  onRemoteGatewayOperation(callback: (event: RemoteGatewayOperationEvent) => void): () => void;
  listRemoteHepaiWorkers(workspaceId: string): Promise<RemoteHepaiWorker[]>;
  setRemoteHepaiWorkerEnabled(workspaceId: string, workerId: string, enabled: boolean): Promise<boolean>;
  onRemoteWorkspaceStatus(callback: (status: RemoteWorkspaceStatus) => void): () => void;
  listWorkspaces(): Promise<WorkspaceProject[]>;
  createWorkspace(request: CreateWorkspaceRequest): Promise<WorkspaceProject>;
  updateWorkspace(request: UpdateWorkspaceRequest): Promise<WorkspaceProject>;
  deleteWorkspace(id: string): Promise<boolean>;
  getWorkspaceContextOverview(workspacePath: string): Promise<WorkspaceContextOverview>;
  listWorkspaceFiles(request: WorkspaceFileTreeRequest): Promise<WorkspaceFileTreeResult>;
  onWorkspaceFileChanges(callback: (event: WorkspaceFileChangeEvent) => void): () => void;
  summarizeWorkspaceFolder(
    request: WorkspaceFolderSummaryRequest,
  ): Promise<WorkspaceFolderSummaryResult>;
  previewWorkspaceFile(request: WorkspaceFilePreviewRequest): Promise<WorkspaceFilePreview>;
  getWorkspaceGitDiff(request: WorkspaceGitDiffRequest): Promise<WorkspaceGitDiffResult>;
  getWorkspaceGitFileAtRef(
    request: WorkspaceGitFileAtRefRequest,
  ): Promise<WorkspaceGitFileAtRefResult>;
  revertWorkspaceFile(request: WorkspaceRevertFileRequest): Promise<WorkspaceRevertFileResult>;
  stageWorkspaceFile(request: WorkspaceStageFileRequest): Promise<WorkspaceStageFileResult>;
  stageWorkspaceHunk(request: WorkspaceHunkActionRequest): Promise<WorkspaceHunkActionResult>;
  revertWorkspaceHunk(request: WorkspaceHunkActionRequest): Promise<WorkspaceHunkActionResult>;
  listWorkspaceCheckpoints(workspacePath: string): Promise<WorkspaceCheckpoint[]>;
  createWorkspaceCheckpoint(
    request: WorkspaceCheckpointCreateRequest,
  ): Promise<WorkspaceCheckpoint>;
  acceptWorkspaceCheckpoint(
    request: WorkspaceCheckpointAcceptRequest,
  ): Promise<WorkspaceCheckpoint>;
  previewWorkspaceCheckpoint(
    request: WorkspaceCheckpointPreviewRequest,
  ): Promise<WorkspaceCheckpointPreviewResult>;
  restoreWorkspaceCheckpoint(
    request: WorkspaceCheckpointRestoreRequest,
  ): Promise<WorkspaceCheckpointRestoreResult>;
  listThreads(): Promise<DesktopThread[]>;
  listAgents(): Promise<DesktopAgent[]>;
  getPlatformAgentStatus(): Promise<PlatformAgentStatus>;
  getMyDrSaiConfig(workspacePath?: string): Promise<MyDrSaiConfig>;
  updateMyDrSaiConfig(request: UpdateMyDrSaiConfigRequest): Promise<MyDrSaiConfig>;
  createThread(request: CreateThreadRequest): Promise<DesktopThread>;
  updateThread(request: UpdateThreadRequest): Promise<DesktopThread>;
  getThreadSnapshot(threadId: string): Promise<DesktopThreadSnapshot | null>;
  searchThreadMessages(
    request: DesktopThreadContentSearchRequest,
  ): Promise<DesktopThreadContentSearchResult[]>;
  updateThreadSnapshot(snapshot: DesktopThreadSnapshot): Promise<DesktopThreadSnapshot>;
  prepareForkWorktree(
    request: DesktopForkWorktreeRequest,
  ): Promise<DesktopForkWorktreeResult>;
  startChat(request: ChatRequest): Promise<string>;
  abortChat(requestId: string): Promise<boolean>;
  startAgentRun(
    request: AgentRunRequest,
  ): Promise<{ requestId: string; sessionId: string; runId: string }>;
  abortAgentRun(requestId: string): Promise<boolean>;
  startVoiceTranscription(
    request: DesktopVoiceTranscriptionRequest,
  ): Promise<DesktopVoiceTranscriptionStartResult>;
  cancelVoiceTranscription(requestId: string): Promise<boolean>;
  getVoiceRuntimeStatus(): Promise<DesktopVoiceRuntimeStatus>;
  onVoiceTranscriptionEvent(
    callback: (event: DesktopVoiceTranscriptionEvent) => void,
  ): () => void;
  writeVoiceTranscriptHandoff(
    request: DesktopVoiceTranscriptHandoffRequest,
  ): Promise<DesktopVoiceTranscriptHandoffResult>;
  saveApiKey(apiKey: string, defaultModel?: string): Promise<SaveApiKeyResult>;
  pickFiles(): Promise<PickDialogResult>;
  pickFolder(): Promise<PickDialogResult>;
  checkBrowserUrl(url: string): Promise<BrowserUrlCheck>;
  requestBrowserAction(
    request: BrowserActionRequest,
  ): Promise<BrowserActionResult>;
  startBrowserTask(request: BrowserTaskStartRequest): Promise<{ taskId: string }>;
  stopBrowserTask(request: BrowserTaskStopRequest): Promise<boolean>;
  proposeApproval(
    request: DesktopApprovalProposalRequest,
  ): Promise<DesktopApprovalProposalResult>;
  requestShellCommandApproval(
    request: DesktopShellCommandApprovalRequest,
  ): Promise<DesktopApprovalProposalResult>;
  requestGitCommitApproval(
    request: DesktopGitCommitApprovalRequest,
  ): Promise<DesktopApprovalProposalResult>;
  requestForkLifecycleApproval(
    request: DesktopForkLifecycleApprovalRequest,
  ): Promise<DesktopForkLifecycleApprovalResult>;
  requestForkQueueStartApproval(
    request: DesktopForkQueueStartApprovalRequest,
  ): Promise<DesktopForkQueueStartApprovalResult>;
  dispatchForkQueue(
    request: DesktopForkQueueDispatchRequest,
  ): Promise<DesktopForkQueueDispatchResult>;
  writeForkConflictDraft(
    request: DesktopForkConflictDraftWriteRequest,
  ): Promise<DesktopForkConflictDraftWriteResult>;
  listProjectMemory(
    request: DesktopProjectMemoryListRequest,
  ): Promise<DesktopProjectMemoryEntry[]>;
  addProjectMemory(
    request: DesktopProjectMemoryAddRequest,
  ): Promise<DesktopProjectMemoryEntry>;
  updateProjectMemory(
    request: DesktopProjectMemoryUpdateRequest,
  ): Promise<DesktopProjectMemoryEntry>;
  clearProjectMemory(
    request: DesktopProjectMemoryClearRequest,
  ): Promise<DesktopProjectMemoryClearResult>;
  listCustomCommands(
    request: DesktopCustomCommandListRequest,
  ): Promise<DesktopCustomCommand[]>;
  upsertCustomCommand(
    request: DesktopCustomCommandUpsertRequest,
  ): Promise<DesktopCustomCommand>;
  deleteCustomCommand(
    request: DesktopCustomCommandDeleteRequest,
  ): Promise<DesktopCustomCommandDeleteResult>;
  listProjectSkillDrafts(
    request: DesktopProjectSkillDraftListRequest,
  ): Promise<DesktopProjectSkillDraft[]>;
  createProjectSkillDraft(
    request: DesktopProjectSkillDraftCreateRequest,
  ): Promise<DesktopProjectSkillDraft>;
  installProjectSkillDraft(
    request: DesktopProjectSkillInstallRequest,
  ): Promise<DesktopProjectSkillInstallResult>;
  publishProjectSkillDraft(
    request: DesktopProjectSkillPublishRequest,
  ): Promise<DesktopProjectSkillPublishResult>;
  listWorkflowMarketplace(
    workspacePath?: string,
  ): Promise<DesktopWorkflowMarketplaceListResult>;
  syncWorkflowMarketplace(
    request: DesktopWorkflowMarketplaceSyncRequest,
  ): Promise<DesktopWorkflowMarketplaceSyncResult>;
  prepareWorkflowRun(
    request: DesktopWorkflowRunPrepareRequest,
  ): Promise<DesktopWorkflowRunPrepareResult>;
  startWorkflowRun(
    request: DesktopWorkflowRunStartRequest,
  ): Promise<DesktopWorkflowRunStartResult>;
  listWorkflowRuns(workspacePath?: string): Promise<DesktopWorkflowRun[]>;
  dispatchWorkflowRunStep(
    request: DesktopWorkflowRunStepDispatchRequest,
  ): Promise<DesktopWorkflowRunStepDispatchResult>;
  completeWorkflowRunStep(
    request: DesktopWorkflowRunStepCompleteRequest,
  ): Promise<DesktopWorkflowRunStepCompleteResult>;
  listBackgroundTasks(
    request?: DesktopBackgroundTaskListRequest,
  ): Promise<DesktopBackgroundTask[]>;
  enqueueBackgroundTask(
    request: DesktopBackgroundTaskEnqueueRequest,
  ): Promise<DesktopBackgroundTask>;
  updateBackgroundTask(
    request: DesktopBackgroundTaskUpdateRequest,
  ): Promise<DesktopBackgroundTask>;
  listScheduledTasks(
    request?: DesktopScheduledTaskListRequest,
  ): Promise<DesktopScheduledTask[]>;
  createScheduledTask(
    request: DesktopScheduledTaskCreateRequest,
  ): Promise<DesktopScheduledTask>;
  updateScheduledTask(
    request: DesktopScheduledTaskUpdateRequest,
  ): Promise<DesktopScheduledTask>;
  runDueScheduledTasks(
    request?: DesktopScheduledTaskRunRequest,
  ): Promise<DesktopScheduledTaskRunResult>;
  getScheduledTaskWorkerStatus(): Promise<DesktopScheduledTaskWorkerStatus>;
  listChannelAdapters(workspacePath?: string): Promise<DesktopChannelAdapterListResult>;
  configureChannelAdapter(
    request: DesktopChannelAdapterConfigureRequest,
  ): Promise<DesktopChannelAdapterConfigureResult>;
  startChannelAdapterAuth(
    request: DesktopChannelAdapterAuthStartRequest,
  ): Promise<DesktopChannelAdapterAuthStartResult>;
  importChannelContext(
    request: DesktopChannelContextImportRequest,
  ): Promise<DesktopChannelContextImportResult>;
  syncChannelSnapshots(
    request: DesktopChannelSnapshotSyncRequest,
  ): Promise<DesktopChannelSnapshotSyncResult>;
  listChannelInboundEvents(
    request?: DesktopChannelInboundEventListRequest,
  ): Promise<DesktopChannelInboundEvent[]>;
  routeChannelInboundEvent(
    request: DesktopChannelInboundEventRouteRequest,
  ): Promise<DesktopChannelInboundEventRouteResult>;
  proposeChannelOutboundDraft(
    request: DesktopChannelOutboundDraftRequest,
  ): Promise<DesktopChannelOutboundDraftResult>;
  listChannelOutboundDeliveries(
    request?: DesktopChannelOutboundDeliveryListRequest,
  ): Promise<DesktopChannelOutboundDelivery[]>;
  listExternalConnectionReadiness(
    workspacePath?: string,
  ): Promise<DesktopExternalConnectionReadinessResult>;
  importMcpContext(
    request: DesktopMcpContextRequest,
  ): Promise<DesktopMcpContextResult>;
  requestMcpLiveEnumeration(
    request: DesktopMcpLiveEnumerationRequest,
  ): Promise<DesktopMcpLiveEnumerationResult>;
  requestMcpToolExecutionApproval(
    request: DesktopMcpToolExecutionApprovalRequest,
  ): Promise<DesktopMcpToolExecutionApprovalResult>;
  listMcpToolExecutionAudits(
    request: DesktopMcpToolExecutionAuditListRequest,
  ): Promise<DesktopMcpToolExecutionAuditEntry[]>;
  listMcpSessionAudits(
    request: DesktopMcpSessionAuditListRequest,
  ): Promise<DesktopMcpSessionAuditEntry[]>;
  listMcpActiveSessions(
    request: DesktopMcpActiveSessionListRequest,
  ): Promise<DesktopMcpActiveSession[]>;
  listMcpReusableSessions(
    request: DesktopMcpReusableSessionListRequest,
  ): Promise<DesktopMcpReusableSession[]>;
  closeMcpReusableSession(
    request: DesktopMcpReusableSessionCloseRequest,
  ): Promise<DesktopMcpReusableSessionCloseResult>;
  cancelMcpActiveSession(
    request: DesktopMcpSessionCancelRequest,
  ): Promise<DesktopMcpSessionCancelResult>;
  listPendingApprovals(): Promise<DesktopPendingApproval[]>;
  decidePendingApproval(request: DesktopApprovalDecisionRequest): Promise<boolean>;
  decideApproval(request: DesktopApprovalDecisionRequest): Promise<boolean>;
  listPendingBrowserTaskApprovals(): Promise<BrowserTaskPendingApproval[]>;
  approveBrowserTaskAction(request: BrowserTaskApprovalRequest): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<string>;
  getIdeContext(workspacePath: string): Promise<DesktopIdeContextSnapshot>;
  getFileIcon(path: string): Promise<DesktopFileIconResult>;
  createTerminal(options?: TerminalCreateOptions): Promise<TerminalSessionInfo>;
  listTerminalSessions(workspaceKey?: string): Promise<TerminalSessionInfo[]>;
  getTerminalBuffer(id: string): Promise<string>;
  renameTerminal(
    id: string,
    title: string,
  ): Promise<TerminalSessionInfo | null>;
  writeTerminal(id: string, data: string): Promise<boolean>;
  resizeTerminal(id: string, cols: number, rows: number): Promise<boolean>;
  killTerminal(id: string): Promise<boolean>;
  onInstallProgress(callback: (progress: InstallProgress) => void): () => void;
  onOidcLoginDebug(callback: (event: OidcLoginDebugEvent) => void): () => void;
  onChatEvent(callback: (event: ChatEvent) => void): () => void;
  onAgentRunEvent(callback: (event: AgentRunEvent) => void): () => void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  onTerminalData(callback: (event: TerminalDataEvent) => void): () => void;
  onTerminalExit(callback: (event: TerminalExitEvent) => void): () => void;
  onBrowserTaskEvent(callback: (event: BrowserTaskEvent) => void): () => void;
}
