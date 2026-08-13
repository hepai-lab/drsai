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
import type { DesktopPlatformDescriptor } from "./platform";
import type { InteractionOption, StructuredConversationEvent, StructuredTurnState } from "./structuredConversation";
import type { OaepEvent } from "./oaep.generated";
export type { InteractionOption } from "./structuredConversation";
import type {
  RunInspection,
  RunInspectionOpenRequest,
  RunItemLocator,
  RunItemLocatorRequest,
  RunManifestReadRequest,
  RunManifestExportResult,
  RunReproductionManifest,
  SessionRunList,
  SessionRunsReadRequest,
} from "./runInspection";
import type {
  CreateReplayPlanRequest,
  CreateRunExperimentRequest,
  GetRunExperimentCapabilitiesRequest,
  FinalizeRunExperimentCandidateRequest,
  CreateRunComparisonRequest,
  CreateRunComparisonEvaluationRequest,
  GetRunAdoptionPreviewRequest,
  ApplyRunAdoptionRequest,
  DiscardRunAdoptionRequest,
  RuntimeApprovalRequired,
  RuntimeRunApprovalDecisionRequest,
  RuntimeSecurityApprovalDecisionRequest,
  DeleteRunExperimentRequest,
  RunExperimentPackageExportResult,
  ExecuteReplayPlanRequest,
  GetReplayBoundariesRequest,
  GetReplayPlanRequest,
  GetWorktreeAdoptionPreviewRequest,
  GetRunExperimentRequest,
  GetRunComparisonRequest,
  ListRunComparisonEvaluationsRequest,
  GetRunRelationsRequest,
  ReplayBoundaries,
  ReplayPlan,
  ReplayExecutionResult,
  RunExperiment,
  RunExperimentCapabilities,
  RunExperimentCandidateSnapshot,
  RunRelations,
  RunComparison,
  RunComparisonEvaluation,
  RunComparisonEvaluationList,
  RunAdoption,
  WorktreeAdoptionPreview,
  ApplyWorktreeAdoptionRequest,
  WorktreeAdoptionApplyResult,
  UpdateRunExperimentRequest,
} from "./runExperiment";
export type * from "./runExperiment";
export type {
  RunInspection,
  RunInspectionOpenRequest,
  RunItemLocator,
  RunItemLocatorRequest,
  RunManifestReadRequest,
  RunReproductionManifest,
  SessionRunList,
  SessionRunsReadRequest,
} from "./runInspection";
import type {
  DiagnosticClearResult,
  DiagnosticEvent,
  DiagnosticEventInput,
  DiagnosticExportResult,
  DiagnosticQuery,
  DiagnosticSnapshot,
  DiagnosticIssueUpdateRequest,
  DiagnosticIssueUpdateResult,
  InteractiveDebugBreakpointRequest,
  InteractiveDebugPolicy,
  InteractiveDebugPolicyUpdateRequest,
  InteractiveDebugControlRequest,
  InteractiveDebugEvaluateRequest,
  InteractiveDebugEvaluateResult,
  InteractiveDebugScope,
  InteractiveDebugSession,
  InteractiveDebugStartRequest,
  InteractiveDebugTarget,
  InteractiveDebugVariable,
  DiagnosticSourceContext,
  DiagnosticSourceContextRequest,
  DiagnosticSourceOpenRequest,
  DiagnosticSourceOpenResult,
  DiagnosticPackagePreview,
  DiagnosticPackageResult,
  ProductionDiagnosticSettings,
  ProductionDiagnosticStatus,
} from "./diagnostics";

export type {
  DiagnosticComponentHealth,
  DiagnosticEvent,
  DiagnosticEventInput,
  DiagnosticExportResult,
  DiagnosticFinding,
  DiagnosticIssueUpdateRequest,
  DiagnosticIssueUpdateResult,
  DiagnosticRootCauseAnalysis,
  DiagnosticRootCauseCandidate,
  DiagnosticRootCauseSnapshot,
  DiagnosticErrorCluster,
  DiagnosticQuery,
  DiagnosticSnapshot,
  DiagnosticSourceLocation,
  DiagnosticSourceContext,
  DiagnosticSourceContextRequest,
  DiagnosticSourceOpenRequest,
  DiagnosticSourceOpenResult,
  DiagnosticStackFrame,
  DiagnosticStatus,
  DiagnosticTrace,
  InteractiveDebugBreakpoint,
  InteractiveDebugPolicy,
  InteractiveDebugPolicyUpdateRequest,
  InteractiveDebugBreakpointRequest,
  InteractiveDebugCapabilities,
  InteractiveDebugControlRequest,
  InteractiveDebugEvaluateRequest,
  InteractiveDebugEvaluateResult,
  InteractiveDebugScope,
  InteractiveDebugSession,
  InteractiveDebugStackFrame,
  InteractiveDebugStartRequest,
  InteractiveDebugTarget,
  InteractiveDebugVariable,
  DiagnosticPackagePreview,
  DiagnosticPackageResult,
  ProductionDiagnosticAuditEntry,
  ProductionDiagnosticMode,
  ProductionDiagnosticSettings,
  ProductionDiagnosticStatus,
} from "./diagnostics";

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
  portOpen?: boolean;
  diagnosticCode?: string;
  diagnosticMessage?: string;
  endpoints?: {
    health: GatewayEndpointStatus;
    models: GatewayEndpointStatus;
  };
}

export type GatewayEndpointState =
  | "ok"
  | "not_checked"
  | "unauthorized"
  | "unreachable"
  | "timeout"
  | "invalid_response"
  | "http_error";

export interface GatewayEndpointStatus {
  ok: boolean;
  statusCode: number | null;
  state: GatewayEndpointState;
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
    | "rolled-back"
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
  recovery: "automatic-rollback" | null;
  source: "cdn" | "github" | "test" | null;
  fallbackUsed: boolean;
}

export type CodexBackendState = "available" | "not_installed" | "version_incompatible" | "not_logged_in" | "account_unavailable" | "fault";

export interface CodexBackendStatus {
  backendId: "codex";
  state: CodexBackendState;
  available: boolean;
  installed?: boolean;
  authenticated?: boolean;
  contractCompatible?: boolean;
  executable?: boolean;
  version: string | null;
  loggedIn: boolean;
  authMode: string | null;
  accountLabel: string | null;
  reason: string | null;
  retryable: boolean;
  action: "none" | "install" | "upgrade" | "login" | "reconnect" | "restart";
  appServerState?: "running" | "stopped" | "fault";
  connectionState?: string;
  transport?: "local-process" | "ssh" | string;
  adapterVersion?: string;
}

export interface CodexBackendLogin {
  type: "chatgpt" | "chatgptDeviceCode";
  loginId: string;
  verificationUrl?: string;
  userCode?: string;
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

// Read-only migration alias. Current Agent identities come from config.toml
// and configs/agents, never from a product-wide constant.
export const LEGACY_MY_DRSAI_AGENT_ID = "my-drsai";
export const LOCAL_OPENDRSAI_AGENT_NAME = "OpenDrSai";

export interface ConfiguredAgentDescriptor {
  agent_name: string;
  display_name: string;
  enabled: boolean;
  config_file: string;
  current: boolean;
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
  | "device-code-request"
  | "device-code-ready"
  | "device-code-polling"
  | "device-code-slow-down"
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
  userCode?: string;
  expiresAt?: string;
}

export type DesktopVoiceRuntimeId =
  | "mock-local"
  | "gateway-provider"
  | "local-whisper"
  | "realtime-provider";

export type DesktopVoiceInteractionMode = "serial" | "streaming" | "duplex";

export type DesktopStreamingAudioEncoding = "pcm_s16le";

export const DESKTOP_DUPLEX_VOICE_PROTOCOL_VERSION = 1 as const;

export type DesktopDuplexVoiceAudioEncoding = "pcm_s16le" | "pcm_f32le";
export type DesktopDuplexVoiceTerminalState = "completed" | "cancelled" | "failed";
export type DesktopDuplexVoiceConnectionState = "connecting" | "connected" | "reconnecting" | "reconnected" | "disconnected";
export type DesktopDuplexVoiceErrorCode =
  | "auth"
  | "model"
  | "protocol"
  | "network"
  | "device"
  | "audio"
  | "rate_limit"
  | "policy"
  | "cancelled"
  | "internal";

export interface DesktopDuplexVoiceError {
  code: DesktopDuplexVoiceErrorCode;
  message: string;
  retryable: boolean;
  providerCode?: string;
  requestId?: string;
}

export interface DesktopDuplexVoiceCapabilities {
  protocolVersion: typeof DESKTOP_DUPLEX_VOICE_PROTOCOL_VERSION;
  inputAudioEncodings: DesktopDuplexVoiceAudioEncoding[];
  outputAudioEncodings: DesktopDuplexVoiceAudioEncoding[];
  inputSampleRatesHz: number[];
  outputSampleRatesHz: number[];
  supportsInputTranscription: boolean;
  supportsOutputTranscription: boolean;
  supportsServerVad: boolean;
  supportsResponseCancel: boolean;
  supportsConversationTruncation: boolean;
  supportsToolCalling: boolean;
  supportsSessionResume: boolean;
  maxUplinkBufferedAudioMs: number;
  maxPlaybackBufferedAudioMs: number;
  maxSessionDurationSeconds?: number;
}

export interface DesktopDuplexVoiceSessionStartRequest {
  protocolVersion: typeof DESKTOP_DUPLEX_VOICE_PROTOCOL_VERSION;
  sessionId: string;
  providerId: string;
  modelId: string;
  inputEncoding: DesktopDuplexVoiceAudioEncoding;
  inputSampleRateHz: number;
  outputEncoding: DesktopDuplexVoiceAudioEncoding;
  outputSampleRateHz: number;
  channels: 1;
  languageHint?: string;
  voice?: string;
  instructions?: string;
  enableInputTranscription: boolean;
  enableOutputTranscription: boolean;
  enableServerVad: boolean;
  enableToolCalling: boolean;
}

export interface DesktopDuplexVoiceSessionStartResult {
  sessionId: string;
  acceptedAt: string;
  runtimeId: "realtime-provider" | "mock-local";
  providerId: string;
  modelId: string;
  capabilities: DesktopDuplexVoiceCapabilities;
}

export interface DesktopDuplexVoiceInterruptRequest {
  sessionId: string;
  responseId: string;
  itemId: string;
  contentIndex: number;
  playedAudioMs: number;
  reason: "user_speech" | "manual" | "stop_intent";
}

export interface DesktopDuplexVoiceToolResultRequest {
  sessionId: string;
  callId: string;
  output: string;
}

export interface DesktopDuplexVoiceHistoryAppendRequest {
  threadId: string;
  messages: Array<{ id: string; role: "user" | "assistant"; content: string; statusContent?: string }>;
}

export interface DesktopDuplexVoiceAudioChunk {
  protocolVersion: typeof DESKTOP_DUPLEX_VOICE_PROTOCOL_VERSION;
  sessionId: string;
  sequence: number;
  capturedAtMs: number;
  durationMs: number;
  encoding: DesktopDuplexVoiceAudioEncoding;
  sampleRateHz: number;
  channels: 1;
  audioData: Uint8Array;
}

export interface DesktopDuplexVoiceAudioDelta {
  responseId: string;
  itemId: string;
  contentIndex: number;
  sequence: number;
  encoding: DesktopDuplexVoiceAudioEncoding;
  sampleRateHz: number;
  channels: 1;
  audioData: Uint8Array;
}

export interface DesktopDuplexVoiceTranscriptDelta {
  itemId: string;
  responseId?: string;
  contentIndex: number;
  text: string;
}

export interface DesktopDuplexVoiceToolCall {
  callId: string;
  itemId: string;
  name: string;
  argumentsJson: string;
}

export type DesktopDuplexVoiceEvent = {
  protocolVersion: typeof DESKTOP_DUPLEX_VOICE_PROTOCOL_VERSION;
  sessionId: string;
  sequence: number;
} & (
  | { type: "session_started"; runtimeId: "realtime-provider" | "mock-local"; providerId: string; modelId: string; capabilities: DesktopDuplexVoiceCapabilities }
  | { type: "connection_state"; state: DesktopDuplexVoiceConnectionState; attempt?: number }
  | { type: "input_audio_ack"; acknowledgedSequence: number; bufferedAudioMs: number }
  | { type: "flow_control"; direction: "uplink" | "playback"; paused: boolean; bufferedAudioMs: number; reason: "high_watermark" | "low_watermark" }
  | { type: "input_speech_started"; itemId?: string; audioStartMs?: number }
  | { type: "input_speech_stopped"; itemId?: string; audioEndMs?: number }
  | { type: "input_transcript_delta"; delta: DesktopDuplexVoiceTranscriptDelta }
  | { type: "input_transcript_completed"; itemId: string; text: string }
  | { type: "response_started"; responseId: string }
  | { type: "response_audio_delta"; delta: DesktopDuplexVoiceAudioDelta }
  | { type: "response_audio_completed"; responseId: string; itemId: string; contentIndex: number }
  | { type: "response_transcript_delta"; delta: DesktopDuplexVoiceTranscriptDelta }
  | { type: "response_transcript_completed"; responseId: string; itemId: string; text: string }
  | { type: "tool_call"; call: DesktopDuplexVoiceToolCall }
  | { type: "usage_update"; inputAudioMs: number; outputAudioMs: number; inputTokens: number | null; outputTokens: number | null; estimatedCostUsd: number | null; warning: boolean; exceeded: boolean }
  | { type: "diagnostic"; metrics: { connectMs: number | null; firstInputEventMs: number | null; ttfaMs: number | null; reconnects: number; interrupts: number; maxBufferedAudioMs: number; inputAudioMs: number; outputAudioMs: number } }
  | { type: "interrupted"; responseId: string; playedAudioMs: number; reason: "user_speech" | "manual" | "stop_intent" }
  | { type: "completed"; terminal: "completed" }
  | { type: "cancelled"; terminal: "cancelled" }
  | { type: "failed"; terminal: "failed"; error: DesktopDuplexVoiceError }
);

export interface DesktopStreamingVoiceCapabilities {
  serialStt: boolean;
  serialTts: boolean;
  streamingStt: boolean;
  streamingTts: boolean;
  audioEncodings: DesktopStreamingAudioEncoding[];
  sampleRatesHz: number[];
  supportsPartialTranscripts: boolean;
  supportsProviderEndpointing: boolean;
  supportsSessionResume: boolean;
  supportsAdaptiveEndpointing?: boolean;
  supportsContextualRepair?: boolean;
  supportsProviderFailover?: boolean;
  protocolVersion?: 1 | 2;
  maxBufferedAudioMs: number;
}

export type DesktopTranscriptRepairSourceType = "later_speech" | "conversation_summary" | "user_dictionary" | "workspace_term";

export interface DesktopTranscriptRepairSource {
  type: DesktopTranscriptRepairSourceType;
  label?: string;
}

export interface DesktopTranscriptRepairCandidate {
  id: string;
  revision: number;
  originalText: string;
  suggestedText: string;
  confidence: number;
  sources: DesktopTranscriptRepairSource[];
  risk: "none" | "meaning_change" | "sensitive_value" | "command_or_code";
  autoAccept: boolean;
  reasons: string[];
}

export interface DesktopStreamingVoiceStartRequest {
  protocolVersion?: 1 | 2;
  turnId: string;
  languageHint?: string;
  encoding: DesktopStreamingAudioEncoding;
  sampleRateHz: number;
  channels: 1;
  frameDurationMs: number;
  providerEndpointing: boolean;
}

export interface DesktopStreamingVoiceStartResult {
  sessionId: string;
  turnId: string;
  acceptedAt: string;
  capabilities: DesktopStreamingVoiceCapabilities;
}

export interface DesktopStreamingVoiceAudioChunk {
  protocolVersion?: 1 | 2;
  sessionId: string;
  turnId: string;
  sequence: number;
  capturedAtMs: number;
  durationMs: number;
  encoding: DesktopStreamingAudioEncoding;
  sampleRateHz: number;
  channels: 1;
  audioData: Uint8Array;
}

export interface DesktopStreamingVoiceAudioAck {
  sessionId: string;
  turnId: string;
  acknowledgedSequence: number;
  bufferedAudioMs: number;
  receivedAt: string;
}

export interface DesktopStreamingVoiceTranscriptSegment {
  text: string;
  revision: number;
  confidence?: number;
  startMs?: number;
  endMs?: number;
}

export type DesktopStreamingVoiceTranscriptionEvent = { protocolVersion?: 1 | 2 } & (
  | { sessionId: string; turnId: string; sequence: number; type: "accepted"; runtimeId: DesktopVoiceRuntimeId }
  | { sessionId: string; turnId: string; sequence: number; type: "audio_ack"; ack: DesktopStreamingVoiceAudioAck }
  | { sessionId: string; turnId: string; sequence: number; type: "flow_control"; paused: boolean; bufferedAudioMs: number; reason: "high_watermark" | "low_watermark" }
  | { sessionId: string; turnId: string; sequence: number; type: "connection_state"; state: "connected" | "reconnecting" | "reconnected"; attempt?: number }
  | { sessionId: string; turnId: string; sequence: number; type: "partial"; segment: DesktopStreamingVoiceTranscriptSegment }
  | { sessionId: string; turnId: string; sequence: number; type: "final"; segment: DesktopStreamingVoiceTranscriptSegment }
  | { sessionId: string; turnId: string; sequence: number; type: "endpoint"; reason: "provider" | "local_vad" | "manual" }
  | { sessionId: string; turnId: string; sequence: number; type: "completed" }
  | { sessionId: string; turnId: string; sequence: number; type: "failed"; error: DesktopVoiceError }
  | { sessionId: string; turnId: string; sequence: number; type: "cancelled" }
);

export interface DesktopStreamingVoiceTtsSegmentRequest {
  sessionId: string;
  turnId: string;
  messageId: string;
  segmentId: string;
  segmentIndex: number;
  text: string;
  voice?: string;
  speed?: number;
  format: "wav" | "mp3" | "opus";
}

export interface DesktopStreamingVoiceTtsAudioSegment {
  sessionId: string;
  turnId: string;
  messageId: string;
  segmentId: string;
  segmentIndex: number;
  mimeType: string;
  durationMs?: number;
  audioData: Uint8Array;
  final: boolean;
}

export type DesktopStreamingVoiceTtsEvent =
  | { sessionId: string; turnId: string; sequence: number; type: "accepted"; segmentId: string; segmentIndex: number }
  | { sessionId: string; turnId: string; sequence: number; type: "audio"; segment: DesktopStreamingVoiceTtsAudioSegment }
  | { sessionId: string; turnId: string; sequence: number; type: "segment_completed"; segmentId: string; segmentIndex: number }
  | { sessionId: string; turnId: string; sequence: number; type: "completed" }
  | { sessionId: string; turnId: string; sequence: number; type: "failed"; error: DesktopVoiceError; segmentId?: string }
  | { sessionId: string; turnId: string; sequence: number; type: "cancelled" };

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

export type DesktopVoiceSynthesisRuntimeId = "mock-local" | "gateway-provider" | "system";
export type DesktopVoiceAudioFormat = "mp3" | "wav" | "opus";

export interface DesktopVoiceSynthesisRequest {
  text: string;
  language?: string;
  voice?: string;
  speed?: number;
  format?: DesktopVoiceAudioFormat;
  /** Optional runtime override; defaults to the globally configured runtime. */
  runtime?: DesktopVoiceSynthesisRuntimeId;
}

export interface DesktopVoiceSynthesisStartResult {
  requestId: string;
  acceptedAt: string;
}

export interface DesktopVoiceSynthesisRuntimeStatus {
  runtimeId: DesktopVoiceSynthesisRuntimeId;
  state: "ready" | "unavailable" | "auth_required" | "degraded";
  supportsSynthesisTask: boolean;
  supportedFormats: DesktopVoiceAudioFormat[];
  maxTextChars: number;
  providerDisclosure: string;
  message: string;
}

export interface DesktopVoiceSynthesisResult {
  audioData: Uint8Array;
  mimeType: string;
  runtimeId: DesktopVoiceSynthesisRuntimeId;
  createdAt: string;
  providerDisclosure: string;
}

export type DesktopVoiceSynthesisEvent =
  | { requestId: string; type: "accepted"; runtimeId: DesktopVoiceSynthesisRuntimeId }
  | { requestId: string; type: "progress"; stage: "preparing" | "synthesizing"; message: string }
  | { requestId: string; type: "completed"; result: DesktopVoiceSynthesisResult }
  | { requestId: string; type: "failed"; error: DesktopVoiceError }
  | { requestId: string; type: "cancelled" };

export type DesktopDataCleanupScope = "sessions" | "all_local_data";
export type DesktopDataCategory = "account" | "sessions" | "cache" | "memory" | "tasks" | "settings";

export interface DesktopDataCleanupPreview {
  scope: DesktopDataCleanupScope;
  applicationData: Array<{ category: DesktopDataCategory; label: string; description: string }>;
  preservedUserMaterials: Array<{ name: string; path: string; reason: string }>;
  preservesAllWorkspaceFiles: boolean;
  confirmationPhrase?: string;
  requiresSignInAgain: boolean;
}

export interface DesktopDataCleanupRequest {
  scope: DesktopDataCleanupScope;
  confirmation: "CLEAR_SESSIONS" | "DELETE_LOCAL_DATA";
}

export interface DesktopDataCleanupResult {
  ok: boolean;
  scope: DesktopDataCleanupScope;
  removedPaths: string[];
  protectedWorkspacePaths: string[];
  skippedTargets: string[];
  requiresSignInAgain: boolean;
  message: string;
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

export interface OaepInputResource {
  protocol: "oaep.input/1";
  resource_id: string;
  kind: ChatAttachment["kind"];
  name: string;
  permission: "read";
  status: "encoded";
  reference?: string;
  content?: string;
  mime?: string;
  title?: string;
  url?: string;
  size_bytes?: number;
  sha256?: string;
  captured_at?: string;
}

export interface ChatRequest {
  requestId?: string;
  agentId?: string;
  model?: string;
  workspacePath?: string;
  workspaceId?: string;
  workspaceName?: string;
  threadId?: string;
  sessionId?: string;
  runId?: string;
  attachments?: ChatAttachment[];
  metadata?: Record<string, unknown>;
  messages: ChatMessage[];
}

export interface ChatToolTimelineEvent {
  id: string;
  oaepItemId?: string;
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

export type DesktopFailureKind = "network" | "file_busy" | "external_service" | "disk_full" | "permission_denied" | "model_timeout" | "unexpected";

export interface DesktopFailureRecovery {
  kind: DesktopFailureKind;
  attempts: number;
  retryLimit: number;
  retryable: boolean;
  exhausted: boolean;
  escalationLevel: "automatic" | "user_action" | "administrator";
  reason: string;
  affectedObject: string;
  suggestedAction: string;
  recoveryAction: "retry";
  message: string;
}

export interface ChatEvent {
  requestId: string;
  /** Monotonic per-request sequence assigned by the main process. */
  seq?: number;
  type: "start" | "oaep" | "structured" | "chunk" | "reasoning" | "status" | "connection" | "tool_timeline" | "input_request" | "done" | "error" | "aborted";
  content?: string;
  error?: string;
  level?: "INFO" | "WARNING" | "ERROR" | "DEBUG" | "TRACE" | "FATAL" | string;
  toolTimeline?: ChatToolTimelineEvent;
  prompt?: string;
  inputRequestId?: string;
  inputType?: "text_input" | "approval" | "choice" | "confirmation";
  inputOptions?: InteractionOption[];
  inputDefault?: string;
  inputAllowCustom?: boolean;
  inputTimeoutAt?: string;
  sessionId?: string;
  runId?: string;
  failureRecovery?: DesktopFailureRecovery;
  errorEnvelope?: RuntimeErrorEnvelope;
  structuredEvent?: StructuredConversationEvent;
  /** Authoritative OAEP event, forwarded unchanged for diagnostics and protocol inspection. */
  oaepEvent?: OaepEvent;
  connection?: {
    status: "retrying" | "restored";
    attempt: number;
    delayMs?: number;
    timestamp: string;
    source: "gateway" | "remote-gateway" | "opendrsai-runtime" | "codex-runtime";
  };
}

export interface ChatRunRecoveryRequest {
  requestId: string;
  sessionId: string;
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
  businessAction?: string;
  businessObject?: string;
  target?: string;
  scope?: string;
  impact?: string;
  createdAt: string;
  risk: "low" | "medium" | "high";
  executionState?: "executing" | "ambiguous";
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
  businessAction?: string;
  businessObject?: string;
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
  alreadyExecuted?: boolean;
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
  query?: string;
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

export interface DesktopTeamMemoryEntry {
  id: string;
  teamId: string;
  content: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopTeamMemoryListRequest {
  teamId?: string;
  limit?: number;
  query?: string;
}

export interface DesktopTeamMemoryAddRequest {
  teamId: string;
  content: string;
}

export interface DesktopTeamMemoryDeleteRequest {
  teamId: string;
  entryId: string;
}

export interface DesktopTeamMemoryDeleteResult {
  teamId: string;
  removedCount: number;
}

export type DesktopUserPreferenceCategory =
  | "output_language"
  | "chart_gridlines"
  | "report_format"
  | "audience";

export type DesktopUserPreferenceValue =
  | "zh"
  | "en"
  | "hidden"
  | "visible"
  | "presentation"
  | "report"
  | "summary"
  | "manager"
  | "expert"
  | "general";

export interface DesktopUserPreference {
  category: DesktopUserPreferenceCategory;
  value: DesktopUserPreferenceValue;
  createdAt: string;
  updatedAt: string;
  source: "explicit_user_request";
}

export interface DesktopUserPreferenceUpsertRequest {
  category: DesktopUserPreferenceCategory;
  value: DesktopUserPreferenceValue;
  source: "explicit_user_request";
}

export interface DesktopUserPreferenceDeleteRequest {
  category: DesktopUserPreferenceCategory;
}

export interface DesktopUserPreferenceDeleteResult {
  category: DesktopUserPreferenceCategory;
  removed: boolean;
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
  approvalId?: string;
  approvalQueued?: boolean;
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
  approvalId?: string;
  approvalQueued?: boolean;
}


export interface GatewaySkill {
  name: string;
  category: string;
  description: string;
  path: string;
  size?: number;
  mtime?: number;
}

export interface GatewayAvailableSkill extends GatewaySkill {
  source: string;
  installed: boolean;
}

export interface GatewaySkillInstallRequest {
  name: string;
  content?: string;
  source?: string;
  userId?: string;
}

export interface GfsObjectInfo {
  path: string;
  size: number;
  etag: string;
  modifiedMs: number;
  isDir: boolean;
}

export interface GfsListRequest {
  prefix?: string;
  recursive?: boolean;
  maxItems?: number;
}

export interface GfsListResult {
  items: GfsObjectInfo[];
  prefix: string;
  truncated: boolean;
}

export interface GfsUploadRequest {
  localPath: string;
  remotePath: string;
}

export interface GfsDownloadRequest {
  remotePath: string;
  localPath: string;
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
  | "scheduled_monitor"
  | "presentation_generation";

export type DesktopBackgroundTaskSource =
  | "chat"
  | "workflow"
  | "agent"
  | "connector"
  | "manual"
  | "scheduled"
  | "monitor"
  | "presentation";

export type DesktopBackgroundTaskStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type DesktopTaskPlanPhase = "input" | "process" | "check" | "output";

export interface DesktopTaskPlanStep {
  id: string;
  phase: DesktopTaskPlanPhase;
  title: string;
}

export interface DesktopTaskPlanAdjustment {
  id: string;
  failedStepId?: string;
  failedStepTitle: string;
  reason: string;
  replacementStepTitle: string;
  impact: string;
  completeness: "partial" | "blocked";
  timestamp?: string;
}

export interface DesktopBackgroundTask {
  id: string;
  /** Account owner used by the main process to isolate locally persisted task results. */
  ownerUserId?: string;
  kind: DesktopBackgroundTaskKind;
  source: DesktopBackgroundTaskSource;
  title: string;
  status: DesktopBackgroundTaskStatus;
  createdAt: string;
  updatedAt: string;
  workspacePath?: string;
  threadId?: string;
  targetId?: string;
  approvalId?: string;
  currentStep?: string;
  progress?: number;
  planSteps?: DesktopTaskPlanStep[];
  planAdjustments?: DesktopTaskPlanAdjustment[];
  completedSteps?: string[];
  pendingDecisions?: string[];
  message: string;
  verification: string;
  deliverySummary?: DesktopTaskDeliverySummary;
  idempotencyKey?: string;
  attempt?: number;
  maxAttempts?: number;
  retryOfTaskId?: string;
  recoveredAt?: string;
  cancelledAt?: string;
}

export type DesktopTaskImportance = "high" | "medium" | "low";

export interface DesktopTaskArtifactLink {
  id: string;
  label: string;
  path: string;
  kind: "file" | "presentation" | "report" | "folder";
  provenance?: DesktopArtifactProvenance;
  quality?: DesktopArtifactQuality;
  chartQuality?: DesktopChartDataQuality;
  editLineage?: DesktopArtifactEditLineage;
  analysisRoute?: DesktopArtifactAnalysisRoute;
  keyConclusions?: DesktopArtifactConclusionEvidence[];
  conclusionTraceabilityRate?: number;
  consistencyCheck?: DesktopConsistencyCheckResult;
  independentReviews?: DesktopIndependentReviewRecord[];
  anomalyDecision?: DesktopAnomalyDecisionRecord;
}

export type DesktopAnomalyDecision = "keep" | "exclude" | "both";

export interface DesktopAnomalyDecisionOutput {
  role: "kept_all" | "excluded_anomalies";
  path: string;
  rowCount: number;
  anomalyCount: number;
  sha256: string;
}

export interface DesktopAnomalyDecisionRecord {
  sourcePath: string;
  anomalyColumn: string;
  totalRows: number;
  anomalyRows: number;
  normalRows: number;
  decision?: DesktopAnomalyDecision;
  decidedAt?: string;
  resultSummary?: string;
  sourceSha256?: string;
  receiptPath?: string;
  outputs?: DesktopAnomalyDecisionOutput[];
}

export interface DesktopAnomalyDecisionApplyRequest {
  workspacePath: string;
  sourcePath: string;
  anomalyColumn: string;
  decision: DesktopAnomalyDecision;
}

export interface DesktopAnomalyDecisionApplyResult extends DesktopAnomalyDecisionRecord {
  decision: DesktopAnomalyDecision;
  decidedAt: string;
  resultSummary: string;
  sourceSha256: string;
  receiptPath: string;
  outputs: DesktopAnomalyDecisionOutput[];
}

export interface DesktopArtifactAnalysisRoute {
  routeGroupId: string;
  routeId: string;
  role: "original" | "alternative";
  method: string;
  inputSummary: string;
  keyConclusion: string;
  risk: string;
  recommendedUse: string;
  status: "completed" | "failed";
  selected: boolean;
  selectedAt?: string;
  sourceArtifactId: string;
  sourcePath: string;
  inputFingerprint: string;
  createdAt: string;
}

export interface DesktopConsistencyCheckItem {
  id: string;
  category: "outdated_number" | "chart_mismatch" | "source_mismatch";
  severity: "high" | "medium" | "low";
  status: "open" | "accepted" | "ignored";
  title: string;
  finding: string;
  sourcePath: string;
  locatorType: "pdf_page" | "file_paragraph" | "data_range" | "calculation";
  locator: string;
  observedValue: string;
  expectedValue: string;
  evidenceText: string;
  recommendation: string;
}

export interface DesktopConsistencyCheckResult {
  checkedAt: string;
  status: "passed" | "issues_found";
  expectedIssues: number;
  detectedIssues: number;
  summary: string;
  items: DesktopConsistencyCheckItem[];
}

export interface DesktopIndependentReviewFinding {
  id: string;
  title: string;
  outcome: "confirmed" | "issue_found" | "not_reproduced";
  detail: string;
  sourcePath: string;
  locatorType: "pdf_page" | "file_paragraph" | "data_range" | "calculation";
  locator: string;
  evidenceText: string;
}

export interface DesktopIndependentReviewRecord {
  id: string;
  mode: "repeat" | "alternative";
  method: "reverse_source_trace" | "constraint_recalculation";
  methodLabel: string;
  reviewerLabel: string;
  requestedAt: string;
  completedAt: string;
  status: "passed" | "issues_found" | "inconclusive";
  checkedClaimCount: number;
  checkedSourceCount: number;
  scope: string[];
  findings: DesktopIndependentReviewFinding[];
  uncovered: string[];
  summary: string;
  baselineCheckId: string;
  usesOriginalAnswerText: false;
  methodDifference: string;
  evidenceFingerprint: string;
}

export interface DesktopArtifactConclusionEvidence {
  id: string;
  conclusion: string;
  sourcePath: string;
  locatorType: "pdf_page" | "file_paragraph" | "data_range" | "calculation";
  locator: string;
  evidenceText: string;
  verified: boolean;
  citations?: DesktopCitationRecord[];
  numericEvidence?: DesktopNumericEvidence[];
  uncertainty?: DesktopConclusionUncertainty;
  trust?: DesktopTrustAssessment;
}

export type DesktopTrustStatus = "evidence_sufficient" | "needs_confirmation" | "insufficient_data" | "source_conflict" | "inference";

export interface DesktopTrustAssessment {
  status: DesktopTrustStatus;
  label: "依据充分" | "需要确认" | "数据不足" | "来源冲突" | "属于推测";
  definition: string;
  reason: string;
  icon: "check" | "question" | "warning" | "compare" | "hypothesis";
  recommendedAction: string;
  evidenceRule: "verified_source" | "provisional_source" | "insufficient_observation" | "conflicting_sources" | "inference_only";
  evidenceIds: string[];
  ruleSatisfied: boolean;
}

export interface DesktopCitationRecord {
  id: string;
  title: string;
  authors: string[];
  sourcePath: string;
  locatorType: "pdf_page" | "file_paragraph" | "data_range" | "calculation";
  locator: string;
  excerpt: string;
  relation: "supports" | "contradicts" | "insufficient";
  supportScore: number;
}

export interface DesktopNumericSourceValue {
  label: string;
  value: number;
  unit: string;
  sourcePath: string;
  locator: string;
  rawText: string;
}

export interface DesktopNumericEvidence {
  id: string;
  label: string;
  displayValue: string;
  reportedValue: number;
  unit: string;
  kind: "direct" | "calculated";
  sourcePath: string;
  locatorType: "pdf_page" | "file_paragraph" | "data_range" | "calculation";
  locator: string;
  sourceValues: DesktopNumericSourceValue[];
  formula: string;
  recalculatedValue?: number;
  tolerance: number;
  status: "verified" | "unverifiable";
  explanation: string;
}

export interface DesktopUncertaintyClaim {
  id: string;
  position: string;
  sourcePath: string;
  locatorType: "pdf_page" | "file_paragraph" | "data_range" | "calculation";
  locator: string;
  excerpt: string;
  stance: "supports" | "contradicts" | "insufficient";
}

export interface DesktopConclusionUncertainty {
  status: "source_conflict" | "insufficient_data" | "inference";
  label: string;
  explanation: string;
  recommendedAction: string;
  requiresQualification: true;
  qualifyingLanguage: string[];
  claims: DesktopUncertaintyClaim[];
}

export interface DesktopChartDataQuality {
  status: "passed" | "failed";
  checkedAt: string;
  sourcePath: string;
  xAxis: string;
  yAxis: string;
  unit: string;
  legend: string;
  axisLabelsVisible: boolean;
  unitVisible: boolean;
  legendVisible: boolean;
  pointsExpected: number;
  pointsMatched: number;
  coordinateMatches: number;
  anomaliesExpected: number;
  anomaliesMatched: number;
  mismatchCount: number;
  checks: string[];
}

export interface DesktopArtifactEditLineage {
  sourceArtifactId: string;
  sourcePath: string;
  scopeType: "text" | "table" | "image";
  scopeLabel: string;
  action: "simplify_text" | "sort_table_numeric" | "log_scale_image";
}

export interface DesktopArtifactQuality {
  status: "passed" | "failed";
  checkedAt: string;
  format: "markdown";
  formatValid: boolean;
  requiredSections: string[];
  presentSections: string[];
  missingSections: string[];
  placeholderCount: number;
  mojibakeCount: number;
  emptyImageCount: number;
  brokenLinkCount: number;
  goldenFactsExpected: number;
  goldenFactsMatched: number;
  goldenFactCoverage: number;
  checks: string[];
}

export interface DesktopTaskDeliverySummary {
  findingSummary: string;
  importance: DesktopTaskImportance;
  importanceReason: string;
  artifacts: DesktopTaskArtifactLink[];
  suggestedAction: string;
  workSummary: string;
  coreConclusion: string;
  verification: string;
  remainingRisks: string;
  completionCriteria?: {
    passed: string[];
    incomplete: string[];
  };
}

export type DesktopShareScope = "result_only" | "complete_task";
export type DesktopShareObjectType = "artifact" | "task";

export interface DesktopShareManifestObject {
  objectType: DesktopShareObjectType;
  objectId: string;
  label: string;
  kind?: DesktopTaskArtifactLink["kind"];
  bytes?: number;
  sha256?: string;
  version: number;
}

export interface DesktopShareManifest {
  id: string;
  ownerAccount: string;
  recipientAccount: string;
  scope: DesktopShareScope;
  sourceTaskId: string;
  selectedArtifactId?: string;
  objects: DesktopShareManifestObject[];
  createdAt: string;
  version: number;
  versionUpdatedAt: string;
  versionUpdatedByAccount: string;
  status: "active" | "revoked";
  revokedAt?: string;
  revokedByAccount?: string;
  permission: DesktopSharePermission;
  sensitiveReview?: DesktopShareSensitiveReviewSummary;
}

export type DesktopSharePermission = "view" | "comment" | "continue";

export interface DesktopSharePermissionUpdateRequest {
  shareId: string;
  permission: DesktopSharePermission;
}

export interface DesktopShareRevokeRequest {
  shareId: string;
  confirmation: "REVOKE";
}

export interface DesktopShareRevocationResult {
  shareId: string;
  status: "revoked";
  revokedAt: string;
  recipientAccount: string;
  objectsInvalidated: number;
  auditEntryId: string;
}

export interface DesktopShareComment {
  id: string;
  shareId: string;
  authorAccount: string;
  body: string;
  target: DesktopShareCommentTarget;
  createdAt: string;
  version: number;
  versionStatus: "current" | "stale";
}

export interface DesktopShareVersionFingerprint {
  objectId: string;
  sha256: string;
}

export interface DesktopShareVersionInspectionRequest { shareId: string }
export interface DesktopShareVersionInspectionArtifact {
  objectId: string;
  label: string;
  publishedSha256: string;
  sourceSha256: string;
  changed: boolean;
}
export interface DesktopShareVersionInspection {
  shareId: string;
  currentVersion: number;
  nextVersion: number;
  hasChanges: boolean;
  currentCommentCount: number;
  commentsThatWillBecomeStale: number;
  sourceFingerprints: DesktopShareVersionFingerprint[];
  artifacts: DesktopShareVersionInspectionArtifact[];
}
export interface DesktopShareVersionPublishRequest {
  shareId: string;
  expectedVersion: number;
  sourceFingerprints: DesktopShareVersionFingerprint[];
  sensitiveResolutions?: DesktopShareSensitiveResolution[];
}
export interface DesktopShareVersionPublishResult {
  status: "published";
  shareId: string;
  previousVersion: number;
  currentVersion: number;
  publishedAt: string;
  staleCommentCount: number;
  manifest: DesktopShareManifest;
}

export interface DesktopShareCommentListRequest { shareId: string }
export type DesktopShareCommentAnchorType = "whole_result" | "paragraph" | "chart";
export interface DesktopShareCommentTarget {
  objectType: DesktopShareObjectType;
  objectId: string;
  objectLabel: string;
  anchorType: DesktopShareCommentAnchorType;
  anchorLabel: string;
}
export interface DesktopShareCommentAddRequest {
  shareId: string;
  body: string;
  objectId?: string;
  anchorType?: DesktopShareCommentAnchorType;
  anchorLabel?: string;
}

export interface DesktopShareCommentTaskPreviewRequest { shareId: string; commentId: string }
export interface DesktopShareCommentTaskPreview {
  shareId: string;
  commentId: string;
  title: string;
  instructions: string;
  commentBody: string;
  commentAuthorAccount: string;
  target: DesktopShareCommentTarget;
}
export interface DesktopShareCommentTaskCreateRequest extends DesktopShareCommentTaskPreviewRequest { title: string; instructions: string }
export interface DesktopShareCommentTaskUpdateRequest { taskId: string; title: string; instructions: string }
export interface DesktopShareCommentTaskCompleteRequest { taskId: string }
export interface DesktopShareCommentTaskListRequest { shareId?: string }
export interface DesktopShareCommentTask {
  id: string;
  shareId: string;
  commentId: string;
  backgroundTaskId: string;
  title: string;
  instructions: string;
  commentBody: string;
  commentAuthorAccount: string;
  target: DesktopShareCommentTarget;
  status: "ready" | "completed";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface DesktopShareContinuationRequest { shareId: string }
export interface DesktopShareContinuationResult {
  id: string;
  shareId: string;
  requesterAccount: string;
  sourceTaskId: string;
  artifactIds: string[];
  status: "requested";
  createdAt: string;
}

export type DesktopShareAuditAction = "permission_update" | "comment" | "continue" | "comment_task" | "revoke" | "version_publish" | "version_conflict";
export interface DesktopShareAuditEntry {
  id: string;
  shareId: string;
  actorAccount: string;
  action: DesktopShareAuditAction;
  outcome: "allowed" | "denied";
  permission: DesktopSharePermission;
  reason: string;
  createdAt: string;
}
export interface DesktopShareAuditListRequest { shareId: string }

export type DesktopShareSensitiveFindingKind = "api_key" | "bearer_token" | "email" | "phone" | "user_secret";
export type DesktopShareSensitiveAction = "redact" | "remove";

export interface DesktopShareSensitiveFinding {
  id: string;
  artifactId: string;
  artifactLabel: string;
  kind: DesktopShareSensitiveFindingKind;
  severity: "high" | "personal";
  occurrences: number;
  maskedPreview: string;
  supportedActions: DesktopShareSensitiveAction[];
}

export interface DesktopShareSensitiveResolution {
  findingId: string;
  action: DesktopShareSensitiveAction;
}

export interface DesktopShareSensitiveReviewSummary {
  findingsCount: number;
  redactedCount: number;
  removedCount: number;
  highRiskSecretsDirectlyShared: 0;
}

export interface DesktopShareInspectionRequest {
  sourceTaskId: string;
  scope: DesktopShareScope;
  artifactId?: string;
}

export interface DesktopShareInspectionResult {
  sourceTaskId: string;
  scope: DesktopShareScope;
  artifactId?: string;
  scannedArtifactCount: number;
  findings: DesktopShareSensitiveFinding[];
  requiresResolution: boolean;
}

export interface DesktopShareCreateRequest {
  sourceTaskId: string;
  scope: DesktopShareScope;
  recipientAccount: string;
  artifactId?: string;
  sensitiveResolutions?: DesktopShareSensitiveResolution[];
  permission?: DesktopSharePermission;
}

export interface DesktopSharedObjectOpenRequest {
  shareId: string;
  objectType: DesktopShareObjectType;
  objectId: string;
}

export interface DesktopSharedObjectOpenResult {
  shareId: string;
  version: number;
  objectType: DesktopShareObjectType;
  objectId: string;
  label: string;
  authorized: true;
  task?: {
    id: string;
    title: string;
    status: DesktopBackgroundTaskStatus;
    updatedAt: string;
    artifactIds: string[];
  };
  artifact?: {
    id: string;
    label: string;
    kind: DesktopTaskArtifactLink["kind"];
    bytes: number;
    sha256: string;
    content?: string;
  };
}

export interface DesktopSharedArtifactDownloadRequest {
  shareId: string;
  objectId: string;
}

export interface DesktopSharedArtifactDownloadResult {
  shareId: string;
  version: number;
  artifactId: string;
  fileName: string;
  kind: DesktopTaskArtifactLink["kind"];
  bytes: number;
  sha256: string;
  base64: string;
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
  threadId?: string;
  targetId?: string;
  approvalId?: string;
  currentStep?: string;
  progress?: number;
  planSteps?: DesktopTaskPlanStep[];
  planAdjustments?: DesktopTaskPlanAdjustment[];
  completedSteps?: string[];
  pendingDecisions?: string[];
  message?: string;
  verification?: string;
  status?: DesktopBackgroundTaskStatus;
  deliverySummary?: DesktopTaskDeliverySummary;
  idempotencyKey?: string;
  maxAttempts?: number;
}

export interface DesktopBackgroundTaskUpdateRequest {
  taskId: string;
  status: DesktopBackgroundTaskStatus;
  title?: string;
  message?: string;
  currentStep?: string;
  progress?: number;
  planSteps?: DesktopTaskPlanStep[];
  planAdjustments?: DesktopTaskPlanAdjustment[];
  completedSteps?: string[];
  pendingDecisions?: string[];
  verification?: string;
  deliverySummary?: DesktopTaskDeliverySummary;
}

export interface DesktopReusableTaskInput {
  id: string;
  label: string;
  kind: "file" | "folder";
  required: boolean;
  originalValue: string;
}

export interface DesktopReusableTaskAdjustments {
  outputLanguage?: "zh" | "en";
  deadline?: string;
  checkItems: string[];
}

export type DesktopReusableTaskAdjustmentScope = "this_run" | "update_template";

export interface DesktopReusableTask {
  id: string;
  name: string;
  sourceTaskId: string;
  sourceTaskTitle: string;
  sourceWorkspacePath?: string;
  taskTemplate: string;
  inputs: DesktopReusableTaskInput[];
  fixedRules: string[];
  savedAdjustments: DesktopReusableTaskAdjustments;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  lastRunAt?: string;
  lastInputFingerprint?: string;
}

export interface DesktopReusableTaskSaveRequest {
  sourceTaskId: string;
  name: string;
}

export interface DesktopReusableTaskRunPrepareRequest {
  reusableTaskId: string;
  workspacePath: string;
  inputs: Record<string, string>;
  adjustments: DesktopReusableTaskAdjustments;
  adjustmentScope: DesktopReusableTaskAdjustmentScope;
}

export interface DesktopReusableTaskResolvedInput {
  id: string;
  label: string;
  path: string;
  sha256: string;
  bytes: number;
}

export interface DesktopReusableTaskRunRecipe {
  id: string;
  reusableTaskId: string;
  reusableTaskName: string;
  workspacePath: string;
  resolvedTask: string;
  inputs: DesktopReusableTaskResolvedInput[];
  fixedRules: string[];
  adjustments: DesktopReusableTaskAdjustments;
  adjustmentScope: DesktopReusableTaskAdjustmentScope;
  cachePolicy: "force_fresh_input_read";
  createdAt: string;
}

export interface CompletionNotificationPreference {
  enabled: boolean;
  language: "zh" | "en";
}

export interface CompletionNotificationTarget {
  kind: DesktopBackgroundTaskKind;
  targetId: string;
  workspacePath?: string;
  workspaceId?: string;
  threadId?: string;
}

export interface CompletionNotificationClickEvent {
  target: CompletionNotificationTarget;
  clickedAt: string;
}

export type DesktopScheduledTaskKind = "scheduled" | "monitor";

export type DesktopScheduledTaskStatus = "enabled" | "paused" | "blocked";

export type DesktopScheduledTaskCadence =
  | "manual"
  | "hourly"
  | "daily"
  | "weekly";

export interface DesktopScheduledTaskUserDefinition {
  sourceText: string;
  timeDescription: string;
  materialDescription: string;
  actionDescription: string;
  notificationDescription: string;
  timezone: string;
  weekday?: number;
  localTime?: string;
  confirmedAt: string;
}

export type DesktopScheduledTaskMissedRunPolicy = "run_once_immediately";
export type DesktopScheduledTaskDaylightSavingPolicy = "follow_timezone_wall_clock";

export interface DesktopScheduledTaskTriggerAudit {
  triggerKey: string;
  scheduledFor: string;
  triggeredAt: string;
  missed: boolean;
  missedByMs: number;
  missedRunPolicy: DesktopScheduledTaskMissedRunPolicy;
  timezone: string;
  daylightSavingPolicy: DesktopScheduledTaskDaylightSavingPolicy;
}

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
  userDefinition?: DesktopScheduledTaskUserDefinition;
  missedRunPolicy?: DesktopScheduledTaskMissedRunPolicy;
  lastTriggerAudit?: DesktopScheduledTaskTriggerAudit;
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
  userDefinition?: DesktopScheduledTaskUserDefinition;
}

export interface DesktopScheduledTaskUpdateRequest {
  taskId: string;
  status: DesktopScheduledTaskStatus;
  nextRunAt?: string;
  message?: string;
  verification?: string;
  title?: string;
  cadence?: DesktopScheduledTaskCadence;
  target?: string;
  userDefinition?: DesktopScheduledTaskUserDefinition;
}

export interface DesktopScheduledTaskDeleteRequest {
  taskId: string;
}

export interface DesktopScheduledTaskDeleteResult {
  taskId: string;
  removed: boolean;
  historyPolicy: "retain_results";
  retainedWorkflowRunId?: string;
  message: string;
}

export type DesktopScheduledTaskRunItemStatus =
  | "started"
  | "queued_approval"
  | "reconnected"
  | "skipped"
  | "failed"
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
  triggerAudit?: DesktopScheduledTaskTriggerAudit;
}

export interface DesktopScheduledTaskRunResult {
  generatedAt: string;
  checked: number;
  triggered: number;
  reconnected: number;
  skipped: number;
  failed: number;
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
    failed?: number;
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
  authMode?: "not_configured" | "local_git_remote" | "oauth" | "provider_token" | "session_stub";
  accountLabel?: string;
  scopeLabel?: string;
  configuredAt?: string;
  lastImportAt?: string;
  credentialState?: "missing" | "placeholder" | "configured" | "expired";
  sessionExpiresAt?: string;
  authPreparedAt?: string;
  authOperationId?: string;
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
  mode?: "local_git_remote";
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
  operationId?: string;
  message: string;
  verification: string;
}

export interface DesktopChannelAdapterAuthPollRequest { adapterId: string; workspacePath: string; operationId: string; }
export interface DesktopChannelAdapterAuthPollResult { adapterId: string; status: "pending" | "slow_down" | "complete" | "expired" | "denied"; operationId: string; intervalSeconds?: number; expiresAt?: string; accountLabel?: string; message: string; }
export interface DesktopChannelAdapterAuthRevokeRequest { adapterId: string; workspacePath: string; }
export interface DesktopChannelAdapterAuthRevokeResult { adapterId: string; revoked: boolean; message: string; }
export interface DesktopChannelProviderTokenConfigureRequest { adapterId: "slack-chat" | "docs-connector" | "calendar-connector"; workspacePath: string; token: string; }
export interface DesktopChannelProviderTokenConfigureResult { adapterId: "slack-chat" | "docs-connector" | "calendar-connector"; accountLabel: string; configuredAt: string; expiresAt?: string; message: string; }

export interface DesktopChannelConnection {
  adapterId: string;
  workspacePath: string;
  provider: DesktopChannelAdapterProvider;
  mode: "local_git_remote" | "oauth" | "provider_token" | "session_stub";
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
  authOperationId?: string;
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

export interface DesktopChannelLiveSyncRequest { adapterId: string; workspacePath: string; repository?: string; channelId?: string; documentId?: string; calendarId?: string; timeMin?: string; timeMax?: string; limit?: number; }

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
  | "pending"
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
  runtime?: "missing_live_provider" | "workspace_local_outbox" | "github_api" | "slack_api" | "google_docs_api";
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
  status?: "approval_queued" | "completed" | "already_executed" | "blocked" | "cancelled";
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
  | "ambiguous"
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
  | "ambiguous"
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
  executionDepth?: AgentTaskDepth;
  executionPlan?: DesktopTaskPlanStep[];
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

export interface DesktopAgentLocalizedText {
  en?: string;
  zh?: string;
}

export type AgentTaskDepth = "quick" | "standard" | "deep";

export interface DesktopAgent {
  id: string;
  name: string;
  description: string;
  localizedDescription?: DesktopAgentLocalizedText;
  owner: string;
  source: DesktopAgentSource;
  status: DesktopAgentStatus;
  mode?: string;
  available?: boolean;
  featured?: boolean;
  isDefault?: boolean;
  capabilities?: string[];
  lastUsedAt?: string;
  catalogGroup?: "local" | "official" | "mine";
  url?: string;
  model?: string;
  models?: string[];
  logo?: string;
  examples?: DesktopAgentExample[] | string;
  error?: string;
  catalogState?: "live" | "cached";
}

export interface DesktopArtifactProvenanceInput {
  summary: string;
  attachments: string[];
  digest: string;
}

export interface DesktopArtifactProvenanceTarget {
  artifactId: string;
  version: number;
  versionId: string;
}

/** Public, path-free identity chain for navigating and verifying a result's origin. */
export interface DesktopArtifactProvenance {
  schemaVersion: "opendrsai.result-provenance/1";
  sourceTaskId: string;
  sourceSessionId: string;
  sourceRunId: string;
  input: DesktopArtifactProvenanceInput;
  target: DesktopArtifactProvenanceTarget;
  capturedAt: string;
  sourceDigest: string;
}

export type RuntimeErrorCategory = "binding" | "auth" | "transport" | "contract" | "model" | "approval" | "resource" | "history" | "runtime" | "backend" | "unknown";
export type RuntimeRecoveryAction = "retry" | "login" | "sync" | "repair" | "new_task" | "select_model" | "remove_resource" | "reconnect" | "diagnostics" | "continue" | "redo" | "abandon";
export interface RuntimeErrorEnvelope {
  code: string;
  category: RuntimeErrorCategory;
  retryable: boolean;
  user_message_key: string;
  recovery_actions: RuntimeRecoveryAction[];
  diagnostic_reference: string;
  redacted_details: Record<string, unknown>;
  message?: string;
}

export interface DesktopAgentListOptions {
  refresh?: boolean;
  preferCache?: boolean;
}

export interface DesktopAgentPreferenceResult {
  agentId: string;
  saved: boolean;
  message: string;
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

export type RuntimeModelInputModality = "text" | "image" | "audio" | "video";
export type RuntimeModelOutputModality = "text" | "image" | "audio" | "video";
export type RuntimeModelOperation = "chat" | "tool_calling" | "reasoning" | "image_generation" | "image_edit" | "speech_to_text" | "text_to_speech" | "video_generation";
export type RuntimeModelAvailability = "available" | "configured_unverified" | "unavailable" | "stale" | "offline" | "unauthorized" | "error";
export type RuntimeModelCapabilitySource = "user_override" | "provider" | "builtin" | "unknown";
export type RuntimeModelCapabilityConfidence = "verified" | "declared" | "inferred" | "unknown";
export type RuntimeModelCatalogState = "fresh" | "stale" | "offline" | "unauthorized" | "error";

export interface RuntimeModelRef {
  provider_id: string;
  model_id: string;
  catalog_revision?: string;
}

export interface RuntimeModelDescriptor {
  ref: RuntimeModelRef;
  display_name: string;
  input_modalities: RuntimeModelInputModality[];
  output_modalities: RuntimeModelOutputModality[];
  operations: RuntimeModelOperation[];
  reasoning_efforts: Array<"none" | "low" | "medium" | "high" | "xhigh" | "max">;
  token_limit?: number | null;
  max_output_tokens?: number | null;
  availability: RuntimeModelAvailability;
  capability_source: RuntimeModelCapabilitySource;
  capability_confidence: RuntimeModelCapabilityConfidence;
  updated_at?: string | null;
}

export type AgentModelSelection = { mode: "explicit"; ref?: RuntimeModelRef | null };

export interface AgentModelPolicy {
  agent_id: string;
  primary_model: AgentModelSelection;
  image_understanding_model?: AgentModelSelection | null;
  image_generation_model?: AgentModelSelection | null;
  text_to_speech_model?: AgentModelSelection | null;
  realtime_voice_model?: AgentModelSelection | null;
  speech_to_text_model?: AgentModelSelection | null;
  reasoning_effort?: "none" | "low" | "medium" | "high" | "xhigh" | "max" | null;
  /** @deprecated Migrated to image_generation_model. */
  image_model?: AgentModelSelection | null;
  expected_revision?: string | null;
}

export interface MyDrSaiAgentModelPolicy extends AgentModelPolicy {
  effective_ref?: RuntimeModelRef | null;
  effective_image_ref?: RuntimeModelRef | null;
  effective_image_understanding_ref?: RuntimeModelRef | null;
  effective_image_generation_ref?: RuntimeModelRef | null;
  effective_text_to_speech_ref?: RuntimeModelRef | null;
  effective_realtime_voice_ref?: RuntimeModelRef | null;
  effective_speech_to_text_ref?: RuntimeModelRef | null;
  revision: string;
  valid: boolean;
  error?: string | null;
  migrated?: boolean;
  warning?: string | null;
}

export interface ChatTurnIdentity {
  requestId: string;
  sessionId?: string;
  runId?: string;
}

export interface ChatTurnCancelResult {
  accepted: boolean;
  state: "cancelling" | "cancelled" | "completed" | "failed" | "not_found";
}

export type AgentResourceMode = "inherit" | "explicit" | "all_enabled";

export interface AgentToolPolicy {
  agent_id: string;
  mode: AgentResourceMode;
  enabled: string[];
  disabled: string[];
  require_approval: string[];
  revision: string;
  expected_revision?: string | null;
}

export interface AgentToolPreviewRow {
  tool_id: string;
  status: "configured" | "available" | "degraded" | "credential_required" | "runtime_unavailable" | "unsupported_platform" | "disabled";
  error?: string | null;
  capabilities: string[];
  selected: boolean;
}

export interface AgentToolPreview {
  agent_id: string;
  mode: AgentResourceMode;
  tools: AgentToolPreviewRow[];
  missing_ids: string[];
  disabled_ids: string[];
  agent_revision: string;
  registry_revision: string;
}

export interface AgentSkillPolicy {
  agent_id: string;
  mode: AgentResourceMode;
  enabled: string[];
  disabled: string[];
  allow_thread_override: boolean;
  revision: string;
  expected_revision?: string | null;
}

export interface AgentSkillPreview {
  agent_id: string;
  mode: AgentResourceMode;
  skills: Array<GatewaySkill & { enabled_for_agent: boolean }>;
  enabled_ids: string[];
  missing_ids: string[];
  allow_thread_override: boolean;
  revision: string;
}

export interface AgentKnowledgePolicy {
  agent_id: string;
  mode: AgentResourceMode;
  sources: string[];
  retrieval_policy: "auto" | "always" | "never";
  top_k: number;
  score_threshold: number;
  require_citations: boolean;
  revision: string;
  expected_revision?: string | null;
}

export interface KnowledgeBaseResource {
  knowledge_id: string;
  display_name: string;
  type: "local-files" | "ragflow";
  enabled: boolean;
  config: Record<string, unknown>;
  credential_configured?: boolean;
  status?: "not_indexed" | "indexing" | "ready" | "stale" | "failed" | "credential_required" | "configured" | "disabled";
  document_count?: number;
  chunk_count?: number;
  selected?: boolean;
}

export interface PerceptorResource {
  perceptor_id: string;
  name?: string | null;
  kind: "public_web" | "large_facility_data";
  adapter: "tavily" | "facility_gateway";
  enabled: boolean;
  capabilities: string[];
  config: Record<string, unknown>;
  revision: string;
}

export interface SavePerceptorRequest {
  perceptor_id: string;
  name?: string;
  kind: "public_web" | "large_facility_data";
  adapter: "tavily" | "facility_gateway";
  enabled: boolean;
  capabilities: string[];
  config: Record<string, unknown>;
}

export interface SaveKnowledgeBaseRequest {
  knowledge_id: string;
  display_name: string;
  type: "local-files" | "ragflow";
  enabled: boolean;
  config: Record<string, unknown>;
  credential?: string;
}

export interface AgentKnowledgePreview {
  agent_id: string;
  mode: AgentResourceMode;
  sources: string[];
  missing_ids: string[];
  knowledge_bases: KnowledgeBaseResource[];
  retrieval_policy: "auto" | "always" | "never";
  top_k: number;
  score_threshold: number;
  require_citations: boolean;
  revision: string;
}

export interface KnowledgeSearchEvidence {
  knowledge_id: string;
  document_id: string;
  chunk_id: string;
  source: string;
  score: number;
  content_sha256: string;
  content?: string;
}

export interface ModelCapabilityProbeStatus {
  probe_id: string;
  agent_id: string;
  provider_id: string;
  model_id: string;
  operation: string;
  protocol: string;
  status: "verified" | "runtime_verified" | "unsupported" | "unavailable" | "inconclusive" | "stale" | "error";
  started_at: string;
  duration_ms: number;
  error_code?: string | null;
  retryable: boolean;
}

export type ModelCapabilityProbeOperation = "chat" | "tool_calling" | "reasoning" | "image_generation" | "image_edit" | "text_to_speech" | "speech_to_text";
export interface ModelCapabilityProbeResult extends ModelCapabilityProbeStatus {
  upstream_model_id?: string;
  http_status?: number | null;
  may_incur_cost?: boolean;
  evidence_kind?: "real_provider" | "configuration";
  assertions?: Array<{ id: string; passed: boolean; detail?: string }>;
}

export interface AgentModelCapabilityStatus {
  agent_id: string;
  capabilities: ModelCapabilityProbeStatus[];
}

export interface RuntimeModelCatalog {
  models: RuntimeModelDescriptor[];
  revision: string;
  state: RuntimeModelCatalogState;
}

export interface MyDrSaiModelConfig {
  alias: string;
  provider_id?: string;
  display_name?: string;
  client_type?: string;
  model?: string;
  token_limit?: number;
  max_tokens?: number;
  tokenizer_calibration?: MyDrSaiTokenizerCalibrationSample[];
  vision?: boolean;
  input_modalities?: RuntimeModelInputModality[];
  output_modalities?: RuntimeModelOutputModality[];
  operations?: RuntimeModelOperation[];
  reasoning_efforts?: Array<"none" | "low" | "medium" | "high" | "xhigh" | "max">;
  availability?: RuntimeModelAvailability;
  capability_source?: RuntimeModelCapabilitySource;
  reasoning?: MyDrSaiReasoningConfig;
}

export interface MyDrSaiCliConfig {
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
  /** Provider definitions and their persisted local model catalogs. This is
   * intentionally independent from the currently effective Agent model. */
  modelProviders?: MyDrSaiModelProvider[];
  modelConnection?: MyDrSaiModelConnection;
  modelCatalog?: {
    state: RuntimeModelCatalogState | "unconfigured" | "empty" | "timeout";
    revision?: string;
    message?: string;
  };
  error?: string;
}

export interface CodexWorkspaceSessionSyncResult {
  workspaceId: string;
  cancelled?: boolean;
  discovered: number;
  active: number;
  archived: number;
  created: number;
  updated: number;
  skipped: number;
  conflicts?: number;
  threads: DesktopThread[];
}

export interface CodexWorkspaceSessionSyncProgress {
  requestId: string;
  phase: "discovered" | "read" | "projected" | "persisted" | "cancelled";
  completed: number;
  total: number;
}

export interface MyDrSaiModelProvider {
  name: string;
  base_url: string;
  anthropic_base_url?: string;
  google_base_url?: string;
  wire_api: "openai" | "anthropic" | "gemini";
  requires_api_key: boolean;
  has_api_key: boolean;
  api_key_source?: string;
  models_file?: string;
  models?: string[];
  model_aliases?: Record<string, string>;
  model_upstream_ids?: Record<string, string>;
  model_operations?: Record<string, RuntimeModelOperation[]>;
  model_configs?: Record<string, MyDrSaiProviderModelConfig>;
}

export type MyDrSaiModelApiProtocol = "openai" | "anthropic" | "gemini";
export type MyDrSaiModelModality = "text" | "image" | "audio" | "video";
export type MyDrSaiModelCapability = RuntimeModelOperation | "speech_to_text" | "text_to_speech" | "video_generation";

export interface MyDrSaiProviderModelConfig {
  alias?: string;
  input_modalities: MyDrSaiModelModality[];
  output_modalities: MyDrSaiModelModality[];
  api_protocol: MyDrSaiModelApiProtocol;
  enabled: boolean;
  capabilities: MyDrSaiModelCapability[];
  upstream_id?: string;
}

export interface MyDrSaiModelConnection {
  model: string;
  model_provider: string;
  provider: MyDrSaiModelProvider;
  providers?: MyDrSaiModelProvider[];
  path?: string;
  metadata?: { known_model?: boolean; metadata_source?: string; token_limit?: number; max_tokens?: number; vision?: boolean };
  revision?: string;
  warnings?: string[];
  runtime?: { configured_revision: string; runtime_revisions: string[]; runtime_status: "not_started" | "applied" | "partially_applied" | "pending_next_turn"; active_runtime_count: number };
  last_test?: { provider: string; model?: string; mode: string; ok: boolean; tested_at: string; error?: string; status_code?: number; fingerprint?: string; last_success?: { provider: string; model?: string; mode: string; ok: boolean; tested_at: string; fingerprint?: string } } | null;
}

export interface MyDrSaiProviderPreset {
  id: string;
  label: string;
  base_url: string;
  anthropic_base_url?: string;
  google_base_url?: string;
  default_model?: string;
  wire_api: MyDrSaiModelApiProtocol;
  requires_api_key: boolean;
  api_key_env?: string;
  base_url_editable: boolean;
  supports_model_discovery: boolean;
  auth_mode?: "oidc" | "api_key" | "none";
}

export interface MyDrSaiModelDiscoveryResult {
  ok: boolean;
  provider?: string;
  models: string[];
  cached?: boolean;
  descriptors?: RuntimeModelDescriptor[];
  catalog_revision?: string;
  catalog_state?: RuntimeModelCatalogState;
  updated_at?: string;
  error?: string;
}

export interface MyDrSaiProviderReference {
  kind:
    | "agent_model_policy"
    | "agent_image_model_policy"
    | "agent_image_understanding_model_policy"
    | "agent_text_to_speech_model_policy"
    | "agent_speech_to_text_model_policy";
  id: string;
  label: string;
  model_id: string;
}

export interface MyDrSaiProviderDeletePreflight {
  provider: string;
  references: MyDrSaiProviderReference[];
  can_delete: boolean;
}

export interface MyDrSaiModelProviderDraft {
  base_url: string;
  anthropic_base_url?: string;
  google_base_url?: string;
  api_key?: string;
  api_key_env?: string;
  wire_api: MyDrSaiModelApiProtocol;
  requires_api_key: boolean;
  models?: string[] | Record<string, MyDrSaiProviderModelConfig>;
  model_aliases?: Record<string, string>;
  model_upstream_ids?: Record<string, string>;
  model_operations?: Record<string, RuntimeModelOperation[]>;
}

export interface SaveMyDrSaiModelProviderRequest extends MyDrSaiModelProviderDraft {
  expected_revision?: string;
}

export interface UpdateMyDrSaiModelConnectionRequest {
  model: string;
  model_provider: string;
  base_url?: string;
  anthropic_base_url?: string;
  google_base_url?: string;
  api_key?: string;
  api_key_env?: string;
  api_key_credential?: string;
  wire_api?: MyDrSaiModelApiProtocol;
  requires_api_key?: boolean;
  models?: string[] | Record<string, MyDrSaiProviderModelConfig>;
  model_aliases?: Record<string, string>;
  model_upstream_ids?: Record<string, string>;
  model_operations?: Record<string, RuntimeModelOperation[]>;
  expected_revision?: string;
}

export interface MyDrSaiProviderTestResult {
  ok: boolean;
  provider?: string;
  model?: string;
  wire_api?: string;
  error?: "timeout" | "connection_failed" | "authentication_failed" | "permission_denied" | "endpoint_not_found" | "model_not_found" | "invalid_response" | "model_output_empty" | "model_output_mismatch";
  status_code?: number;
  persisted?: boolean;
  may_incur_cost?: boolean;
  output?: string;
  guidance?: { code: string; title: string; message: string; actions: string[]; retryable: boolean; localizations?: Record<string, { title: string; message: string; actions: string[] }> };
}

export interface MyDrSaiModelConfigPreview {
  ok: true;
  persisted: false;
  base_revision: string;
  effective: MyDrSaiModelConnection;
}

export interface MyDrSaiModelDoctorCheck {
  id: string;
  status: "ok" | "warning" | "error";
  message: string;
  guidance?: MyDrSaiProviderTestResult["guidance"];
}

export interface MyDrSaiModelDoctorResult {
  ok: boolean;
  revision: string;
  last_known_good_available: boolean;
  checks: MyDrSaiModelDoctorCheck[];
  effective?: MyDrSaiModelConnection;
}

export interface UpdateMyDrSaiConfigRequest {
  plan_mode?: boolean;
  workspace_enabled?: boolean;
  dangerous_allowed?: boolean;
}

export interface DesktopThread {
  id: string;
  kind: "chat" | "agent_run";
  title: string;
  workspacePath?: string;
  boundAgentId?: string;
  boundAgentName?: string;
  fork?: DesktopThreadForkMetadata;
  createdAt: string;
  updatedAt: string;
  lastRunId?: string;
  lastRequestId?: string;
  runtimeSessionId?: string;
  status?: "idle" | "running" | "error";
  messageCount?: number;
  pinned?: boolean;
  archived?: boolean;
  archivedAt?: string;
  archiveSource?: "opendrsai" | "codex";
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
  structuredTurn?: StructuredTurnState;
  /** User-visible attachment chips; not part of the model prompt text. */
  attachments?: ChatAttachment[];
  inputRequest?: {
    requestId: string;
    prompt: string;
    inputType: "text_input" | "approval" | "choice" | "confirmation";
    options?: InteractionOption[];
    defaultValue?: string;
    allowCustom?: boolean;
    timeoutAt?: string;
  };
  startedAt?: number;
  lastEventAt?: number;
}

export interface DesktopThreadSnapshot {
  threadId: string;
  title: string;
  messages: DesktopThreadMessageSnapshot[];
  updatedAt: number;
  messageCount: number;
  history?: DesktopThreadHistoryState;
  connectionState?: "connected" | "retrying" | "degraded" | "action-required";
}

export interface DesktopThreadHistoryState {
  state: "loading" | "ready" | "partial" | "error";
  source: "opendrsai" | "codex";
  syncedAt?: string;
  loadedRuns: number;
  totalRuns: number;
  loadedItems: number;
  totalItems: number;
  correctedItems?: number;
  warningCount?: number;
  message?: string;
  nextCursor?: string | null;
  truncated?: boolean;
}

export interface DesktopThreadSnapshotEvent {
  version: 1;
  projection: "oaep/1" | "conversation/1";
  threadId: string;
  runtimeSessionId: string;
  sessionSequence: number;
  generation: number;
  snapshot: DesktopThreadSnapshot;
  source?: "cache" | "runtime" | "persisted";
}

/**
 * Authoritative pull response for the same transactional boundary used by
 * pushed snapshots.  A caller must apply the snapshot, sequence and
 * generation together; applying only the content can leave the Patch v2
 * cursor permanently out of sync.
 */
export type DesktopThreadSnapshotEnvelope = DesktopThreadSnapshotEvent;

export interface DesktopThreadSnapshotRequest {
  forceFresh?: boolean;
  minimumSequence?: number;
  expectedGeneration?: number;
  historyCursor?: string;
}

export interface DesktopThreadSnapshotPatchEvent {
  version: 2;
  threadId: string;
  runtimeSessionId: string;
  baseSequence: number;
  sessionSequence: number;
  generation: number;
  patch: {
    kind: "item.upsert";
    runId: string;
    itemId: string;
    message: DesktopThreadMessageSnapshot;
    insertAt: number;
    updatedAt: number;
    messageCount: number;
  } | {
    kind: "item.delta";
    runId: string;
    itemId: string;
    messageId: string;
    delta: { kind: string; text: string; segmentId?: string };
    updatedAt: number;
    messageCount: number;
  } | {
    kind: "item.remove";
    runId: string;
    itemId: string;
    removeMessageIds: string[];
    updatedAt: number;
    messageCount: number;
  } | {
    kind: "run.state";
    runId: string;
    message?: DesktopThreadMessageSnapshot;
    insertAt?: number;
    updatedAt: number;
    messageCount: number;
  } | {
    /** Full replacement is reserved for explicit hydrate/resync/migration. */
    kind: "run.replace";
    runId: string;
    removeMessageIds: string[];
    insertAt: number;
    messages: DesktopThreadMessageSnapshot[];
    updatedAt: number;
    messageCount: number;
  } | {
    kind: "connection.state";
    state: "connected" | "retrying" | "degraded" | "action-required";
    updatedAt: number;
  };
}

export type DesktopRuntimeLogProtocol = "runtime" | "oaep/1" | "conversation/1";
export type DesktopRuntimeLogPhase = "capability" | "snapshot" | "replay" | "stream" | "event" | "cursor" | "retry" | "lifecycle";

/** Read-only, sanitized evidence describing how Desktop consumes Runtime protocols. */
export interface DesktopRuntimeLogEvent {
  id: string;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  status: "started" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  protocol: DesktopRuntimeLogProtocol;
  phase: DesktopRuntimeLogPhase;
  operation: string;
  message: string;
  threadId: string;
  sessionId: string;
  runId?: string;
  itemId?: string;
  eventType?: string;
  sequence?: number;
  cursor?: number;
  source?: string;
  details?: Record<string, unknown>;
}

export interface DesktopThreadCatalogEvent {
  thread: DesktopThread;
  source: "runtime-session";
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
  worktreeId?: string;
  sourceWorkspaceId?: string;
  workspaceId?: string;
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
  worktreeId?: string;
  sourceWorkspaceId?: string;
  location: "local" | "remote";
  transport?: "ssh";
  workspaceId?: string;
  sourceWorkspacePath: string;
  repoRoot: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  sourceHasChanges: boolean;
  sourceStatusSummary?: string;
}

export interface DesktopWorktreeListRequest {
  workspacePath: string;
  workspaceId?: string;
  includeRemoved?: boolean;
}

export interface DesktopWorktreeEventRequest {
  workspacePath: string;
  workspaceId?: string;
  afterSequence?: number;
}

export interface DesktopWorktreeEventBatch {
  events: Array<{
    eventId: string;
    workspaceId: string;
    sequence: number;
    type: string;
    data: Record<string, unknown>;
  }>;
  nextSequence: number;
  degraded?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface DesktopWorktreeSummary {
  worktreeId: string;
  sourceWorkspaceId: string;
  workspaceId: string | null;
  repoRoot: string;
  canonicalPath: string;
  branch: string;
  baseCommit: string;
  headCommit?: string | null;
  status: "creating" | "active" | "review" | "merge_pending" | "merged" | "archived" | "removing" | "removed";
  location: "local" | "remote";
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  activity: { sessions: number; runs: number; terminals: number; total: number };
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
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
  location: "local" | "remote";
  transport?: "ssh";
  /** @deprecated Compatibility field for workspaces persisted before location/transport. */
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
  workspaceId?: string;
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
  stale?: boolean;
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
  importedFileCount: number;
  skippedFileCount: number;
  failedFileCount: number;
  unsupportedExtensions: string[];
  truncated: boolean;
  estimatedTokens: number;
  sampledFiles: WorkspaceFolderSummaryFile[];
  summary: string;
}

export interface WorkspaceFilePreviewRequest {
  workspacePath: string;
  workspaceId?: string;
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
  stale?: boolean;
  fileHash?: string;
  content?: string;
  dataUrl?: string;
  rows?: string[][];
  columns?: string[];
  message?: string;
  metadata?: Record<string, string | number | boolean | null>;
  mode?: "auto" | "head" | "tail" | "outline";
  outline?: string[];
  presentationStory?: WorkspacePresentationStory;
}

export interface WorkspacePresentationStoryItem {
  text: string;
  page: number;
}

export interface WorkspacePresentationStoryQuality {
  status: "passed" | "failed";
  checkedAt: string;
  sourcePageCount: number;
  agendaItems: number;
  storySections: number;
  summaryPoints: number;
  numericHighlights: number;
  sourceMappedItems: number;
  sourceMappingExpected: number;
  numericSourceMatches: number;
  numericSourceExpected: number;
  checks: string[];
}

export interface WorkspacePresentationStory {
  title: string;
  agenda: WorkspacePresentationStoryItem[];
  storySections: WorkspacePresentationStoryItem[];
  summaryPoints: WorkspacePresentationStoryItem[];
  numericHighlights: WorkspacePresentationStoryItem[];
  quality: WorkspacePresentationStoryQuality;
}

export interface WorkspaceFileSaveAsRequest {
  workspacePath: string;
  path: string;
  suggestedName?: string;
  /** Deterministic packaged-test destination. Interactive product calls use the native save dialog. */
  destinationPath?: string;
}

export interface WorkspaceFileSaveAsResult {
  canceled: boolean;
  sourcePath: string;
  destinationPath?: string;
  name: string;
  extension: string;
  size: number;
  sourceHash: string;
  destinationHash?: string;
  integrityVerified: boolean;
  message: string;
}

export interface WorkspaceFileWriteRequest {
  workspacePath: string;
  workspaceId?: string;
  path: string;
  content: string;
  expectedHash: string;
  mode?: "save" | "overwrite" | "save_as";
  suggestedName?: string;
  /** Deterministic packaged-test destination. Interactive product calls use the native save dialog. */
  destinationPath?: string;
}

export interface WorkspaceFileWriteResult {
  status: "saved" | "conflict" | "canceled";
  path: string;
  expectedHash: string;
  currentHash: string;
  savedHash?: string;
  destinationPath?: string;
  savedAs: boolean;
  overwroteExternal: boolean;
  externalModifiedAt?: string;
  externalSize?: number;
  message: string;
}

export interface WorkspaceGitDiffRequest {
  workspacePath: string;
  workspaceId?: string;
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
  stale?: boolean;
}

export interface WorkspaceGitFileAtRefRequest {
  workspacePath: string;
  workspaceId?: string;
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
  workspaceId?: string;
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
  workspaceId?: string;
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
  workspaceId?: string;
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
  versionPath?: string;
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
  kind?: "manual" | "agent_run_baseline" | "artifact_version";
  runId?: string;
  automatic?: boolean;
  versionGroupId?: string;
  versionPhase?: "before" | "after";
  versionNumber?: number;
  versionScope?: "workspace" | "explicit_paths";
  changeReason?: string;
  objectLabel?: string;
  reviewStatus?: "pending" | "accepted" | "rejected";
  reviewedAt?: string;
  restoreCount?: number;
  lastRestoredAt?: string;
  lastRestoreOperationId?: string;
  lastRestoreMode?: "whole" | "partial";
  lastRestoredPaths?: string[];
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
  identityFiles: string[];
  proxyJump?: string;
}

export interface RemoteSshConnectivityResult {
  hostAlias: string;
  state: "reachable" | "authentication_failed" | "host_key_failed" | "timeout" | "dns_failed" | "unreachable" | "failed";
  elapsedMs: number;
  message?: string;
  remediation?: string;
}

export interface RemoteSshHostKey {
  hostAlias: string;
  hostname: string;
  port: number;
  algorithm: string;
  fingerprint: string;
}

export interface RemoteSshHostActionResult {
  hostAlias: string;
  action: "connect" | "disconnect" | "reconnect" | "remove";
  changed: boolean;
}

export type DesktopPortForwardStatus = "starting" | "active" | "paused" | "reconnecting" | "failed" | "removed";
export interface DesktopPortForward {
  portForwardId: string;
  hostAlias: string;
  workspaceId: string;
  remoteHost: string;
  remotePort: number;
  bindAddress: string;
  requestedLocalPort?: number;
  localPort: number;
  status: DesktopPortForwardStatus;
  reconnectPolicy: "automatic" | "manual";
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}
export interface DesktopPortForwardCreateRequest {
  hostAlias: string;
  workspaceId: string;
  remoteHost?: string;
  remotePort: number;
  localPort?: number;
  reconnectPolicy?: "automatic" | "manual";
  authorization: {
    permissionGranted: true;
    approvalId: string;
    correlationId: string;
    operationId: string;
  };
}

export type RemoteWorkspaceConnectionState =
  | "disconnected"
  | "resolving"
  | "authenticating"
  | "connecting"
  | "runtime_check"
  | "ready"
  | "reconnecting"
  | "degraded"
  | "failed";

export interface RemoteSshWorkspaceDescriptor {
  hostAlias: string;
  canonicalPath: string;
  workspaceId: string;
  runtimeId?: string;
  instanceId?: string;
  connectionState: RemoteWorkspaceConnectionState;
  localPort?: number;
  gatewayVersion?: string;
  protocolVersion?: number;
  capabilities?: Record<string, number>;
  error?: string;
  failureKind?: "ssh" | "runtime";
  mode?: string;
  autoReconnect?: boolean;
}

export type PlatformAgentState =
  | "loading"
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
  lastSuccessfulSyncAt?: string | null;
  cacheState?: "none" | "fresh" | "stale";
}

export interface DesktopAgentCatalogSnapshot {
  agents: DesktopAgent[];
  platformStatus: PlatformAgentStatus;
  loadedAt: string;
}

export type ManagerPresentationProgressPhase =
  | "analyzing"
  | "planning"
  | "generating"
  | "validating"
  | "pausing"
  | "paused"
  | "resuming"
  | "interrupted"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed";

export type ManagerPresentationWorkStage =
  | "analyzing"
  | "planning"
  | "generating"
  | "validating";

export interface ManagerPresentationStageArtifact {
  id: string;
  requestId: string;
  stage: "analysis" | "outline";
  label: string;
  summary: string;
  path: string;
  createdAt: string;
  taskElapsedMs: number;
  temporary: true;
  immutable: true;
}

export interface ManagerPresentationGenerateRequest {
  requestId: string;
  workspacePath: string;
  sourcePath: string;
  audience?: ManagerPresentationAudience;
  requirements?: string[];
}

export type ManagerPresentationAudience = "non_expert_managers" | "technical_experts";

export interface ManagerPresentationAudienceProfile {
  audience: ManagerPresentationAudience;
  goldenFactIds: string[];
  impactDecisionSignals: number;
  technicalDetailSignals: number;
  acronymOccurrences: number;
  contentHash: string;
}

export interface ManagerPresentationRequirementUpdateRequest {
  requestId: string;
  text: string;
}

export interface ManagerPresentationRequirementUpdateResult {
  requestId: string;
  accepted: boolean;
  activeStage?: ManagerPresentationWorkStage;
  scope: "current_unfinished_stages" | "regenerate_required";
  requirements: string[];
  message: string;
}

export interface ManagerPresentationCancelRequest {
  requestId: string;
}

export interface ManagerPresentationCancelResult {
  requestId: string;
  accepted: boolean;
}

export interface ManagerPresentationPauseRequest {
  requestId: string;
}

export interface ManagerPresentationPauseResult {
  requestId: string;
  accepted: boolean;
}

export interface ManagerPresentationRecoveryRequest {
  workspacePath: string;
  sourcePath: string;
}

export interface ManagerPresentationRecoveryDecisionRequest extends ManagerPresentationRecoveryRequest {
  requestId: string;
  decision: "restart" | "abandon";
}

export interface ManagerPresentationRecoveryDecisionResult {
  requestId: string;
  decision: ManagerPresentationRecoveryDecisionRequest["decision"];
  accepted: boolean;
}

export interface ManagerPresentationRecoveryResult {
  requestId: string;
  workspacePath: string;
  sourcePath: string;
  audience?: ManagerPresentationAudience;
  phase: ManagerPresentationProgressPhase;
  activeStage?: ManagerPresentationWorkStage;
  progress: number;
  message: string;
  outputPath?: string;
  requirements?: string[];
  stageArtifacts?: ManagerPresentationStageArtifact[];
  updatedAt: string;
}

export interface ManagerPresentationProgressEvent {
  requestId: string;
  phase: ManagerPresentationProgressPhase;
  activeStage?: ManagerPresentationWorkStage;
  progress: number;
  message: string;
  outputPath?: string;
  failureRecovery?: DesktopFailureRecovery;
  stageArtifacts?: ManagerPresentationStageArtifact[];
  deliverySummary?: DesktopTaskDeliverySummary;
}

export interface ManagerPresentationQualityResult {
  ok: boolean;
  checks: Record<string, boolean>;
  failures: string[];
  mediaCount: number;
  sourcePageCoverage: number;
}

export interface ManagerPresentationSourceLink {
  slide: number;
  role: string;
  title: string;
  sourcePages: number[];
}

export interface ManagerPresentationKeyConclusionEvidence {
  id: string;
  conclusion: string;
  sourcePath: string;
  sourceType: "pdf_page";
  page: number;
  evidenceText: string;
  verified: boolean;
  citations: DesktopCitationRecord[];
  numericEvidence: DesktopNumericEvidence[];
  uncertainty?: DesktopConclusionUncertainty;
  trust: DesktopTrustAssessment;
}

export interface ManagerPresentationGenerateResult {
  requestId: string;
  audience: ManagerPresentationAudience;
  sourcePath: string;
  outputPath: string;
  manifestPath: string;
  slideCount: number;
  speakerNotesCoverage: number;
  sourcePageCoverage: number;
  sourceLinks: ManagerPresentationSourceLink[];
  keyConclusions: ManagerPresentationKeyConclusionEvidence[];
  conclusionTraceabilityRate: number;
  appliedRequirements: string[];
  stageArtifacts: ManagerPresentationStageArtifact[];
  deliverySummary: DesktopTaskDeliverySummary;
  quality: ManagerPresentationQualityResult;
  audienceProfile: ManagerPresentationAudienceProfile;
}

export interface PdfPageOpenRequest {
  path: string;
  page: number;
}

export interface PdfPageOpenResult {
  ok: boolean;
  path: string;
  page: number;
  viewerUrl: string;
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
  hosts: Array<{ hostAlias: string; state: RemoteWorkspaceConnectionState; phase: string; failureKind?: "ssh" | "runtime"; failureCategory?: "dns" | "host_key" | "authentication" | "transport" | "runtime"; workspaceCount: number; gatewayVersion?: string; protocolVersion?: number; reconnectAttempts: number; reconnectCount: number; ageMs: number; lastConnectedAt?: string; retryAt?: string; error?: string; events: Array<{ at: string; phase: string; elapsedMs?: number; message?: string }> }>;
}

export interface RemoteGatewayPreflight {
  hostAlias: string;
  operatingSystem: string;
  architecture: string;
  pythonVersion: string;
  compatible: boolean;
  issues: string[];
  installationHint?: string;
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
  artifactPublisher?: string;
  artifactSignature?: string;
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
  workspaceId?: string;
  label?: string;
  maxFiles?: number;
  maxBytesPerFile?: number;
  kind?: "manual" | "agent_run_baseline" | "artifact_version";
  runId?: string;
  automatic?: boolean;
  versionGroupId?: string;
  versionPhase?: "before" | "after";
  versionNumber?: number;
  versionScope?: "workspace" | "explicit_paths";
  changeReason?: string;
  objectLabel?: string;
  includePaths?: string[];
}

export interface WorkspaceCheckpointRestoreRequest {
  workspacePath: string;
  workspaceId?: string;
  checkpointId: string;
  operationId?: string;
  includePaths?: string[];
}

export interface WorkspaceCheckpointAcceptRequest {
  workspacePath: string;
  workspaceId?: string;
  checkpointId: string;
}

export interface WorkspaceCheckpointPreviewRequest {
  workspacePath: string;
  workspaceId?: string;
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
  boundAgentId?: string;
  boundAgentName?: string;
  fork?: DesktopThreadForkMetadata;
}

export interface UpdateThreadRequest {
  id: string;
  kind?: DesktopThread["kind"];
  title?: string;
  workspacePath?: string;
  boundAgentId?: string;
  boundAgentName?: string;
  fork?: DesktopThreadForkMetadata;
  lastRunId?: string;
  lastRequestId?: string;
  runtimeSessionId?: string;
  status?: DesktopThread["status"];
  messageCount?: number;
  pinned?: boolean;
  archived?: boolean;
  archiveSource?: "opendrsai" | "codex";
  unread?: boolean;
}

/** Read-only conversation share (local HTML preview + optional WebUI public link). */
export interface CreateThreadShareRequest {
  threadId: string;
  /** When omitted, all non-system messages are included. */
  messageIds?: string[];
  title?: string;
}

export interface DesktopThreadShareResult {
  shareId: string;
  threadId: string;
  title: string;
  messageCount: number;
  filePath: string;
  /** file:// URL for opening a local preview in a browser */
  fileUrl: string;
  /**
   * Public WebUI share URL (`/share?token=...`) when publish succeeded.
   * Prefer this for "Copy link" so others can open it.
   */
  publicShareUrl?: string;
  shareToken?: string;
  /** Present when local HTML was saved but WebUI publish failed. */
  publishError?: string;
  deepLink: string;
  createdAt: string;
  readOnly: true;
}

export interface AgentRunEvent {
  requestId: string;
  sessionId: string;
  runId: string;
  type: "start" | "chunk" | "status" | "plan_adjustment" | "file_event" | "done" | "error" | "aborted";
  content?: string;
  error?: string;
  fileEvent?: AgentRunFileEvent;
  planAdjustment?: DesktopTaskPlanAdjustment;
  failureRecovery?: DesktopFailureRecovery;
  /** Durable OAEP Item identity retained when adapting Runtime events for the Agent surface. */
  oaepItemId?: string;
  /** Turn-local structured event sequence used to prove ordered Replay/Live parity. */
  structuredSequence?: number;
  /** Stable Tool/Skill invocation identity shared with OAEP, audit, and side-effect records. */
  callId?: string;
  operationId?: string;
  correlationId?: string;
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
  files?: PickedFileDescriptor[];
}

export type PickedFileCategory =
  | "pdf"
  | "word"
  | "spreadsheet"
  | "table"
  | "image"
  | "presentation"
  | "text"
  | "other";

export interface PickedFileDescriptor {
  path: string;
  name: string;
  extension: string;
  category: PickedFileCategory;
  sizeBytes?: number;
  status: "ready" | "unsupported" | "unreadable";
  message?: string;
  diagnosticCode?: "large_file" | "corrupt_file" | "password_protected" | "unsupported_format" | "inspection_timeout" | "unreadable";
  processingMode?: "full" | "bounded" | "blocked";
  recoveryAction?: string;
  sensitiveDataDetected?: boolean;
  sensitiveKinds?: Array<"api_key" | "bearer_token" | "email" | "phone" | "user_secret">;
  sensitiveValueCount?: number;
  privacyNotice?: string;
}

export type MaterialRole =
  | "previous_report"
  | "latest_data"
  | "result_image"
  | "reference_material";

export interface MaterialRoleAnalysisRequest {
  paths: string[];
}

export interface MaterialRoleItem {
  path: string;
  name: string;
  role: MaterialRole;
  confidence: number;
  reason: string;
  suggestedUse: string;
}

export interface MaterialRoleAnalysisResult {
  items: MaterialRoleItem[];
  roleCounts: Record<MaterialRole, number>;
  summary: string;
}

export type MaterialConsistencyFindingKind =
  | "consensus"
  | "source_conflict"
  | "outdated_number"
  | "chart_mismatch"
  | "evidence_gap";

export interface MaterialConsistencySource {
  path: string;
  name: string;
  role: MaterialRole;
  locator: string;
  value: string;
  excerpt: string;
}

export interface MaterialConsistencyFinding {
  id: string;
  kind: MaterialConsistencyFindingKind;
  severity: "high" | "medium" | "info";
  title: string;
  explanation: string;
  recommendation: string;
  sources: MaterialConsistencySource[];
}

export interface MaterialConsistencyAnalysisRequest {
  paths: string[];
}

export interface MaterialConsistencyAnalysisResult {
  findings: MaterialConsistencyFinding[];
  counts: Record<MaterialConsistencyFindingKind, number>;
  filesAnalyzed: number;
  summary: string;
}

export type MaterialQueryKind = "title" | "numeric" | "method" | "comparison" | "general";

export interface MaterialQueryRequest {
  paths: string[];
  question: string;
}

export interface MaterialQueryCitation {
  path: string;
  name: string;
  locator: string;
  excerpt: string;
}

export interface MaterialQueryResult {
  status: "answered" | "not_found";
  queryKind: MaterialQueryKind;
  answer: string;
  confidence: number;
  citations: MaterialQueryCitation[];
  filesSearched: number;
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
  workspaceId?: string;
}

export type TerminalShellProfile =
  | "powershell"
  | "pwsh"
  | "cmd"
  | "git-bash"
  | "wsl"
  | "zsh"
  | "bash";

export interface TerminalSessionInfo {
  id: string;
  pid: number;
  shell: string;
  shellProfile: TerminalShellProfile;
  cwd: string;
  title: string;
  workspaceKey: string;
  createdAt: string;
  workspaceId?: string;
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

export type DesktopEditCommand = "undo" | "redo" | "cut" | "copy" | "paste" | "delete" | "selectAll";

export type DesktopOpenRequest =
  | { kind: "auth-complete"; source: "protocol" | "second-instance"; url: string }
  | { kind: "thread"; source: "protocol" | "second-instance"; url: string; threadId: string }
  | { kind: "file"; source: "finder" | "second-instance"; path: string }
  | { kind: "settings"; source: "menu" };

export interface DesktopLifecycleEvent {
  reason: "suspend" | "lock-screen" | "resume" | "unlock-screen" | "network-online" | "display-change" | "renderer-recovered" | "gpu-recovered";
  recoveredGateway: boolean;
  at: string;
}

export interface DesktopBackgroundTaskActionRequest { taskId: string; reason?: string }
export interface DesktopBackgroundTaskRecoveryResult {
  generatedAt: string;
  recovered: number;
  tasks: DesktopBackgroundTask[];
}

export type DesktopSystemPermissionKind = "microphone" | "notifications" | "files" | "automation" | "accessibility" | "screen-recording";
export type DesktopSystemPermissionState = "granted" | "denied" | "restricted" | "not-determined" | "unknown";
export interface DesktopSystemPermissionStatus {
  kind: DesktopSystemPermissionKind;
  state: DesktopSystemPermissionState;
  canRequest: boolean;
  canOpenSettings: boolean;
  message: string;
  source?: "native-helper" | "electron" | "system-settings";
}

export type DesktopMobilePairingReadinessState =
  | "ready"
  | "not_registered"
  | "credential_invalid"
  | "offline"
  | "paused";

export interface DesktopMobilePairingReadiness {
  state: DesktopMobilePairingReadinessState;
  action: string;
  runtime_id?: string;
  /** Runtime process identity used to prove Workspace/Session routing. */
  gateway_runtime_id?: string;
  environment?: string;
}

export type DesktopMobilePairingGrantStatus = "pending" | "consumed" | "expired" | "revoked";

export interface DesktopMobilePairingGrant {
  grant_id: string;
  expires_at: string;
  status: DesktopMobilePairingGrantStatus;
  payload?: string;
}

export interface DesktopMobileAssociation {
  association_id: string;
  subject_summary: string;
  device_summary: string;
  device_name: string;
  status: "active" | "revoked";
  access_state: "online" | "offline" | "accessing" | "revoked";
  created_at: string;
  last_seen_at?: string | null;
  revoked_at?: string | null;
  device_type: "android";
  workspace_scope: "all" | "selected";
  workspace_ids?: string[];
  permissions: Array<"read" | "send" | "approve" | "files">;
}

export interface DesktopMobilePairingScope {
  workspace_scope: "all" | "selected";
  workspace_ids: string[];
}

export interface DesktopRuntimeEnrollmentRevocation {
  runtime_id: string;
  status: "revoked";
  revoked_at?: string | null;
}

export interface DesktopRuntimeRemoteAccessState {
  runtime_id: string;
  status: "active" | "paused";
  updated_at?: string | null;
}

export interface DesktopRuntimeDisplayNameResult {
  runtime_id: string;
  display_name: string;
}

export interface DesktopMobileRemoteDiagnostics {
  status: "healthy" | "action_required";
  action: "none" | "start_runtime" | "sign_in" | "retry_relay" | "repair_device_identity" | "reconnect_runtime" | "update_runtime" | "enable_notifications";
  checks: Record<"runtime" | "relay" | "oidc" | "device_proof" | "wss" | "heartbeat" | "protocol" | "push", "ok" | "failed" | "unknown">;
}

export type ExperimentReleaseGateFeatureId = "M31-02" | "M31-03" | "M31-04" | "M31-05";

export interface ExperimentReleaseGateState {
  schema_version: "opendrsai.experiment-release-gate/1";
  enabled: boolean;
  required_features: ExperimentReleaseGateFeatureId[];
  passed_features: ExperimentReleaseGateFeatureId[];
  blocking_features: ExperimentReleaseGateFeatureId[];
  source_ledger_sha256: string | null;
  reason: "all_release_evidence_passed" | "release_evidence_incomplete" | "release_gate_resource_missing" | "release_gate_resource_invalid";
}

export interface DesktopApi {
  isAppDialogE2eEnabled(): boolean;
  isOperationalStateE2eEnabled(): boolean;
  getPlatformDescriptor(): Promise<DesktopPlatformDescriptor>;
  onOpenRequest(callback: (request: DesktopOpenRequest) => void): () => void;
  onLifecycleEvent(callback: (event: DesktopLifecycleEvent) => void): () => void;
  getSystemPermissions(): Promise<DesktopSystemPermissionStatus[]>;
  requestSystemPermission(kind: DesktopSystemPermissionKind): Promise<DesktopSystemPermissionStatus>;
  openSystemPermissionSettings(kind: DesktopSystemPermissionKind): Promise<boolean>;
  recordDiagnostic(event: DiagnosticEventInput): Promise<DiagnosticEvent>;
  getDiagnosticSnapshot(query?: DiagnosticQuery): Promise<DiagnosticSnapshot>;
  clearDiagnostics(): Promise<DiagnosticClearResult>;
  exportDiagnostics(): Promise<DiagnosticExportResult>;
  onDiagnosticEvent(callback: (event: DiagnosticEvent) => void): () => void;
  getDiagnosticSourceContext(request: DiagnosticSourceContextRequest): Promise<DiagnosticSourceContext>;
  openDiagnosticSource(request: DiagnosticSourceOpenRequest): Promise<DiagnosticSourceOpenResult>;
  updateDiagnosticIssue(request: DiagnosticIssueUpdateRequest): Promise<DiagnosticIssueUpdateResult>;
  getInteractiveDebugPolicy(): Promise<InteractiveDebugPolicy>;
  updateInteractiveDebugPolicy(request: InteractiveDebugPolicyUpdateRequest): Promise<InteractiveDebugPolicy>;
  listInteractiveDebugTargets(): Promise<InteractiveDebugTarget[]>;
  listInteractiveDebugSessions(): Promise<InteractiveDebugSession[]>;
  startInteractiveDebugSession(request: InteractiveDebugStartRequest): Promise<InteractiveDebugSession>;
  setInteractiveDebugBreakpoint(request: InteractiveDebugBreakpointRequest): Promise<InteractiveDebugSession>;
  controlInteractiveDebugSession(request: InteractiveDebugControlRequest): Promise<InteractiveDebugSession>;
  getInteractiveDebugScopes(sessionId: string, frameId: string): Promise<InteractiveDebugScope[]>;
  getInteractiveDebugVariables(sessionId: string, reference: string): Promise<InteractiveDebugVariable[]>;
  evaluateInteractiveDebugExpression(request: InteractiveDebugEvaluateRequest): Promise<InteractiveDebugEvaluateResult>;
  onInteractiveDebugEvent(callback: (session: InteractiveDebugSession) => void): () => void;
  getProductionDiagnosticStatus(): Promise<ProductionDiagnosticStatus>;
  updateProductionDiagnosticSettings(patch: Partial<ProductionDiagnosticSettings>): Promise<ProductionDiagnosticStatus>;
  previewDiagnosticPackage(): Promise<DiagnosticPackagePreview>;
  exportProductionDiagnosticPackage(): Promise<DiagnosticPackageResult>;
  importProductionDiagnosticPackage(): Promise<DiagnosticPackageResult | null>;
  getAuthSession(): Promise<AuthSession>;
  onAuthSessionInvalidated(callback: () => void): () => void;
  getA5ServiceGuidanceScenario(): Promise<DesktopA5ServiceGuidanceScenario | null>;
  login(request: LoginRequest): Promise<LoginResult>;
  startOidcLogin(request?: { rememberMe?: boolean }): Promise<LoginResult>;
  cancelOidcLogin(): Promise<boolean>;
  logout(options?: LogoutOptions): Promise<{ ok: boolean; message: string }>;
  restartApplication(): Promise<boolean>;
  previewLocalDataCleanup(scope: DesktopDataCleanupScope): Promise<DesktopDataCleanupPreview>;
  clearLocalData(request: DesktopDataCleanupRequest): Promise<DesktopDataCleanupResult>;
  refreshAuthSession(): Promise<AuthSession>;
  bootstrapDesktop(): Promise<DesktopBootstrapResult>;
  getHealth(): Promise<DesktopHealth>;
  getInstallStatus(): Promise<InstallStatus>;
  getGatewayStatus(): Promise<GatewayStatus>;
  getCodexBackendStatus(refresh?: boolean): Promise<CodexBackendStatus>;
  restartCodexBackend(): Promise<CodexBackendStatus>;
  syncCodexWorkspaceSessions(workspaceId: string, workspacePath: string, requestId: string): Promise<CodexWorkspaceSessionSyncResult>;
  cancelCodexWorkspaceSessionSync(requestId: string): Promise<boolean>;
  onCodexWorkspaceSessionSyncProgress(callback: (progress: CodexWorkspaceSessionSyncProgress) => void): () => void;
  startCodexBackendLogin(type?: "chatgpt" | "chatgptDeviceCode"): Promise<CodexBackendLogin>;
  cancelCodexBackendLogin(loginId: string): Promise<boolean>;
  logoutCodexBackend(): Promise<boolean>;
  listProviderUsageAnalytics(): Promise<DesktopProviderUsageAnalyticsRecord[]>;
  listProviderErrorAnalytics(): Promise<DesktopProviderErrorAnalyticsRecord[]>;
  checkForUpdates(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  cancelUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<UpdateStatus>;
  startInstall(options?: StartInstallOptions): Promise<void>;
  cancelInstall(): Promise<boolean>;
  copyTextToClipboard(text: string): Promise<boolean>;
  performEditCommand(command: DesktopEditCommand): Promise<boolean>;
  openLogFolder(): Promise<string>;
  startGateway(): Promise<boolean>;
  stopGateway(): Promise<boolean>;
  getMobilePairingReadiness(): Promise<DesktopMobilePairingReadiness>;
  enableMobileRemoteAccess(): Promise<DesktopMobilePairingReadiness>;
  pauseMobileRemoteAccess(): Promise<DesktopRuntimeRemoteAccessState>;
  resumeMobileRemoteAccess(): Promise<DesktopRuntimeRemoteAccessState>;
  renameMobileRuntime(displayName: string): Promise<DesktopRuntimeDisplayNameResult>;
  diagnoseMobileRemoteAccess(): Promise<DesktopMobileRemoteDiagnostics>;
  createMobilePairingGrant(scope?: DesktopMobilePairingScope): Promise<DesktopMobilePairingGrant>;
  getMobilePairingGrant(grantId: string): Promise<DesktopMobilePairingGrant>;
  revokeMobilePairingGrant(grantId: string): Promise<DesktopMobilePairingGrant>;
  listMobileAssociations(): Promise<DesktopMobileAssociation[]>;
  revokeMobileAssociation(associationId: string): Promise<DesktopMobileAssociation>;
  shrinkMobileAssociation(
    associationId: string,
    permissions: Array<"read" | "send" | "approve" | "files">,
    scope?: DesktopMobilePairingScope,
  ): Promise<DesktopMobileAssociation>;
  revokeMobileRuntimeEnrollment(): Promise<DesktopRuntimeEnrollmentRevocation>;
  listSshHosts(): Promise<RemoteSshHost[]>;
  diagnoseSshHost(hostAlias: string): Promise<RemoteSshConnectivityResult>;
  inspectSshHostKeys(hostAlias: string): Promise<RemoteSshHostKey[]>;
  testSshHost(hostAlias: string): Promise<boolean>;
  approveSshHostKey(hostAlias: string): Promise<boolean>;
  connectSshHost(hostAlias: string): Promise<RemoteSshHostActionResult>;
  disconnectSshHost(hostAlias: string): Promise<RemoteSshHostActionResult>;
  reconnectSshHost(hostAlias: string): Promise<RemoteSshHostActionResult>;
  removeSshHost(hostAlias: string): Promise<RemoteSshHostActionResult>;
  listPortForwards(filter?: { hostAlias?: string; workspaceId?: string }): Promise<DesktopPortForward[]>;
  createPortForward(request: DesktopPortForwardCreateRequest): Promise<DesktopPortForward>;
  pausePortForward(id: string): Promise<DesktopPortForward>;
  resumePortForward(id: string): Promise<DesktopPortForward>;
  removePortForward(id: string): Promise<boolean>;
  listRemoteDirectories(hostAlias: string, path?: string): Promise<RemoteDirectoryEntry[]>;
  connectRemoteWorkspace(request: ConnectRemoteWorkspaceRequest): Promise<WorkspaceProject>;
  disconnectRemoteWorkspace(workspaceId: string): Promise<boolean>;
  getRemoteWorkspaceStatus(workspaceId: string): Promise<RemoteWorkspaceStatus>;
  listRemoteThreads(workspaceId: string): Promise<DesktopThread[]>;
  preflightRemoteGateway(hostAlias: string): Promise<RemoteGatewayPreflight>;
  getRemoteSshDiagnosticReport(): Promise<RemoteSshDiagnosticReport>;
  installRemoteGateway(request: RemoteGatewayInstallRequest): Promise<RemoteGatewayInstallResult | null>;
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
  createDefaultWorkspace(): Promise<WorkspaceProject>;
  updateWorkspace(request: UpdateWorkspaceRequest): Promise<WorkspaceProject>;
  deleteWorkspace(id: string): Promise<boolean>;
  getWorkspaceContextOverview(workspacePath: string, workspaceId?: string): Promise<WorkspaceContextOverview>;
  listWorkspaceFiles(request: WorkspaceFileTreeRequest): Promise<WorkspaceFileTreeResult>;
  onWorkspaceFileChanges(callback: (event: WorkspaceFileChangeEvent) => void): () => void;
  generateManagerPresentation(
    request: ManagerPresentationGenerateRequest,
  ): Promise<ManagerPresentationGenerateResult | null>;
  cancelManagerPresentation(
    request: ManagerPresentationCancelRequest,
  ): Promise<ManagerPresentationCancelResult>;
  pauseManagerPresentation(
    request: ManagerPresentationPauseRequest,
  ): Promise<ManagerPresentationPauseResult>;
  resumeManagerPresentation(
    request: ManagerPresentationPauseRequest,
  ): Promise<ManagerPresentationPauseResult>;
  updateManagerPresentationRequirement(
    request: ManagerPresentationRequirementUpdateRequest,
  ): Promise<ManagerPresentationRequirementUpdateResult>;
  getManagerPresentationRecovery(
    request: ManagerPresentationRecoveryRequest,
  ): Promise<ManagerPresentationRecoveryResult | null>;
  resolveManagerPresentationRecovery(
    request: ManagerPresentationRecoveryDecisionRequest,
  ): Promise<ManagerPresentationRecoveryDecisionResult>;
  onManagerPresentationProgress(
    callback: (event: ManagerPresentationProgressEvent) => void,
  ): () => void;
  summarizeWorkspaceFolder(
    request: WorkspaceFolderSummaryRequest,
  ): Promise<WorkspaceFolderSummaryResult>;
  analyzeMaterialRoles(
    request: MaterialRoleAnalysisRequest,
  ): Promise<MaterialRoleAnalysisResult>;
  analyzeMaterialConsistency(
    request: MaterialConsistencyAnalysisRequest,
  ): Promise<MaterialConsistencyAnalysisResult>;
  queryMaterials(request: MaterialQueryRequest): Promise<MaterialQueryResult>;
  previewWorkspaceFile(request: WorkspaceFilePreviewRequest): Promise<WorkspaceFilePreview>;
  saveWorkspaceFileAs(request: WorkspaceFileSaveAsRequest): Promise<WorkspaceFileSaveAsResult>;
  writeWorkspaceFile(request: WorkspaceFileWriteRequest): Promise<WorkspaceFileWriteResult>;
  applyAnomalyDecision(
    request: DesktopAnomalyDecisionApplyRequest,
  ): Promise<DesktopAnomalyDecisionApplyResult>;
  getWorkspaceGitDiff(request: WorkspaceGitDiffRequest): Promise<WorkspaceGitDiffResult>;
  getWorkspaceGitFileAtRef(
    request: WorkspaceGitFileAtRefRequest,
  ): Promise<WorkspaceGitFileAtRefResult>;
  revertWorkspaceFile(request: WorkspaceRevertFileRequest): Promise<WorkspaceRevertFileResult>;
  stageWorkspaceFile(request: WorkspaceStageFileRequest): Promise<WorkspaceStageFileResult>;
  stageWorkspaceHunk(request: WorkspaceHunkActionRequest): Promise<WorkspaceHunkActionResult>;
  revertWorkspaceHunk(request: WorkspaceHunkActionRequest): Promise<WorkspaceHunkActionResult>;
  listWorkspaceCheckpoints(workspacePath: string, workspaceId?: string): Promise<WorkspaceCheckpoint[]>;
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
  listAgents(options?: DesktopAgentListOptions): Promise<DesktopAgent[]>;
  getAgentCatalogSnapshot(options?: DesktopAgentListOptions): Promise<DesktopAgentCatalogSnapshot>;
  setDefaultAgent(agentId: string): Promise<DesktopAgentPreferenceResult>;
  recordAgentUsage(agentId: string): Promise<DesktopAgentPreferenceResult>;
  getPlatformAgentStatus(): Promise<PlatformAgentStatus>;
  getMyDrSaiConfig(workspacePath?: string): Promise<MyDrSaiConfig>;
  getMyDrSaiRuntimeModelCatalog(): Promise<RuntimeModelCatalog>;
  getMyDrSaiAgentModelPolicy(agentId?: string): Promise<MyDrSaiAgentModelPolicy>;
  getMyDrSaiAgentToolPolicy(agentId: string): Promise<AgentToolPolicy>;
  updateMyDrSaiAgentToolPolicy(agentId: string, policy: AgentToolPolicy): Promise<AgentToolPolicy>;
  previewMyDrSaiAgentTools(agentId: string): Promise<AgentToolPreview>;
  testAgentTool(toolId: string): Promise<{ ok: boolean; tool_id: string; status: string; tested: string; error?: string }>;
  getMyDrSaiAgentSkillPolicy(agentId: string): Promise<AgentSkillPolicy>;
  updateMyDrSaiAgentSkillPolicy(agentId: string, policy: AgentSkillPolicy): Promise<AgentSkillPolicy>;
  previewMyDrSaiAgentSkills(agentId: string): Promise<AgentSkillPreview>;
  getMyDrSaiAgentKnowledgePolicy(agentId: string): Promise<AgentKnowledgePolicy>;
  updateMyDrSaiAgentKnowledgePolicy(agentId: string, policy: AgentKnowledgePolicy): Promise<AgentKnowledgePolicy>;
  previewMyDrSaiAgentKnowledge(agentId: string): Promise<AgentKnowledgePreview>;
  indexKnowledgeBase(knowledgeId: string): Promise<{ knowledge_id: string; status: string; document_count: number; chunk_count: number }>;
  testKnowledgeBase(knowledgeId: string): Promise<{ ok: boolean; knowledge_id: string; type: string; status?: string; dataset_count?: number }>;
  searchKnowledgeBase(knowledgeId: string, query: string): Promise<{ knowledge_id: string; query: string; evidence: KnowledgeSearchEvidence[] }>;
  listKnowledgeBases(): Promise<KnowledgeBaseResource[]>;
  listPerceptors(): Promise<PerceptorResource[]>;
  savePerceptor(request: SavePerceptorRequest): Promise<PerceptorResource>;
  updatePerceptor(perceptorId: string, request: SavePerceptorRequest): Promise<PerceptorResource>;
  testPerceptor(perceptorId: string, capability?: "search" | "extract"): Promise<{ ok: boolean; perceptor_id: string; status: string; tested?: string; result_count?: number; error?: string }>;
  deletePerceptor(perceptorId: string): Promise<{ status: string; perceptor_id: string }>;
  createKnowledgeBase(request: SaveKnowledgeBaseRequest): Promise<KnowledgeBaseResource>;
  deleteKnowledgeBase(knowledgeId: string): Promise<{ status: string }>;
  getMyDrSaiAgentModelCapabilityStatus(agentId?: string): Promise<AgentModelCapabilityStatus>;
  updateMyDrSaiAgentModelPolicy(agentId: string, policy: AgentModelPolicy): Promise<MyDrSaiAgentModelPolicy>;
  migrateMyDrSaiAgentModelPolicy(agentId: string, legacyModel: string, expectedRevision?: string): Promise<MyDrSaiAgentModelPolicy>;
  updateMyDrSaiConfig(request: UpdateMyDrSaiConfigRequest): Promise<MyDrSaiConfig>;
  updateMyDrSaiModelConnection(request: UpdateMyDrSaiModelConnectionRequest): Promise<MyDrSaiModelConnection>;
  previewMyDrSaiModelConnection(request: UpdateMyDrSaiModelConnectionRequest): Promise<MyDrSaiModelConfigPreview>;
  diagnoseMyDrSaiModelConnection(online?: boolean): Promise<MyDrSaiModelDoctorResult>;
  restoreMyDrSaiModelConnection(expectedRevision?: string): Promise<MyDrSaiModelConnection>;
  saveMyDrSaiModelProvider(provider: string, request: SaveMyDrSaiModelProviderRequest): Promise<MyDrSaiModelConnection>;
  testMyDrSaiModelProvider(provider: string, model?: string): Promise<MyDrSaiProviderTestResult>;
  probeMyDrSaiProviderModel(provider: string, request: { model: string; operation: ModelCapabilityProbeOperation; protocol?: string }): Promise<ModelCapabilityProbeResult>;
  testMyDrSaiModelDraft(request: UpdateMyDrSaiModelConnectionRequest, mode?: "basic" | "model"): Promise<MyDrSaiProviderTestResult>;
  listMyDrSaiModelProviderPresets(): Promise<MyDrSaiProviderPreset[]>;
  discoverMyDrSaiProviderModels(provider: string, refresh?: boolean, draft?: MyDrSaiModelProviderDraft): Promise<MyDrSaiModelDiscoveryResult>;
  preflightMyDrSaiModelProviderDeletion(provider: string): Promise<MyDrSaiProviderDeletePreflight>;
  deleteMyDrSaiModelProvider(provider: string, deleteCredential?: boolean): Promise<{ ok: boolean; active?: string }>;
  createThread(request: CreateThreadRequest): Promise<DesktopThread>;
  updateThread(request: UpdateThreadRequest): Promise<DesktopThread>;
  deleteThread(threadId: string): Promise<boolean>;
  setThreadArchived(request: { threadId: string; archived: boolean }): Promise<DesktopThread>;
  getThreadSnapshot(threadId: string): Promise<DesktopThreadSnapshot | null>;
  getThreadSnapshotEnvelope(threadId: string, requestId?: string, options?: DesktopThreadSnapshotRequest): Promise<DesktopThreadSnapshotEnvelope | null>;
  cancelThreadSnapshotHydration(requestId: string): Promise<boolean>;
  subscribeThreadSnapshot(threadId: string): Promise<boolean>;
  unsubscribeThreadSnapshot(threadId: string): Promise<boolean>;
  onThreadSnapshot(callback: (event: DesktopThreadSnapshotEvent) => void): () => void;
  onThreadSnapshotPatch(callback: (event: DesktopThreadSnapshotPatchEvent) => void): () => void;
  onRuntimeLogEvent(callback: (event: DesktopRuntimeLogEvent) => void): () => void;
  onThreadCatalogUpdate(callback: (event: DesktopThreadCatalogEvent) => void): () => void;
  searchThreadMessages(
    request: DesktopThreadContentSearchRequest,
  ): Promise<DesktopThreadContentSearchResult[]>;
  updateThreadSnapshot(snapshot: DesktopThreadSnapshot): Promise<DesktopThreadSnapshot>;
  createThreadShare(request: CreateThreadShareRequest): Promise<DesktopThreadShareResult>;
  openThreadShare(filePath: string): Promise<boolean>;
  revealThreadShare(filePath: string): Promise<boolean>;
  prepareForkWorktree(
    request: DesktopForkWorktreeRequest,
  ): Promise<DesktopForkWorktreeResult>;
  listWorktrees(request: DesktopWorktreeListRequest): Promise<DesktopWorktreeSummary[]>;
  listWorktreeEvents(request: DesktopWorktreeEventRequest): Promise<DesktopWorktreeEventBatch>;
  startChat(request: ChatRequest): Promise<string>;
  recoverChatRun(request: ChatRunRecoveryRequest): Promise<ChatEvent[]>;
  cancelChatTurn(request: ChatTurnIdentity): Promise<ChatTurnCancelResult>;
  listSessionRuns(request: SessionRunsReadRequest): Promise<SessionRunList>;
  getRunInspection(request: RunInspectionOpenRequest): Promise<RunInspection>;
  locateRunItem(request: RunItemLocatorRequest): Promise<RunItemLocator>;
  getRunReproductionManifest(request: RunManifestReadRequest): Promise<RunReproductionManifest>;
  exportRunReproductionManifest(request: RunManifestReadRequest): Promise<RunManifestExportResult>;
  getExperimentReleaseGate(): Promise<ExperimentReleaseGateState>;
  createRunExperiment(request: CreateRunExperimentRequest): Promise<RunExperiment>;
  getRunExperimentCapabilities(request: GetRunExperimentCapabilitiesRequest): Promise<RunExperimentCapabilities>;
  finalizeRunExperimentCandidate(request: FinalizeRunExperimentCandidateRequest): Promise<RunExperimentCandidateSnapshot | RuntimeApprovalRequired>;
  getRunExperiment(request: GetRunExperimentRequest): Promise<RunExperiment>;
  updateRunExperiment(request: UpdateRunExperimentRequest): Promise<RunExperiment>;
  deleteRunExperiment(request: DeleteRunExperimentRequest): Promise<boolean>;
  exportRunExperimentPackage(request: GetRunExperimentRequest): Promise<RunExperimentPackageExportResult>;
  createReplayPlan(request: CreateReplayPlanRequest): Promise<ReplayPlan>;
  getReplayPlan(request: GetReplayPlanRequest): Promise<ReplayPlan>;
  getReplayBoundaries(request: GetReplayBoundariesRequest): Promise<ReplayBoundaries>;
  getRunRelations(request: GetRunRelationsRequest): Promise<RunRelations>;
  executeReplayPlan(request: ExecuteReplayPlanRequest): Promise<ReplayExecutionResult | RuntimeApprovalRequired>;
  createRunComparison(request: CreateRunComparisonRequest): Promise<RunComparison>;
  getRunComparison(request: GetRunComparisonRequest): Promise<RunComparison>;
  listRunComparisonEvaluations(request: ListRunComparisonEvaluationsRequest): Promise<RunComparisonEvaluationList>;
  createRunComparisonEvaluation(request: CreateRunComparisonEvaluationRequest): Promise<RunComparisonEvaluation>;
  getWorktreeAdoptionPreview(request: GetWorktreeAdoptionPreviewRequest): Promise<WorktreeAdoptionPreview>;
  applyWorktreeAdoption(request: ApplyWorktreeAdoptionRequest): Promise<WorktreeAdoptionApplyResult>;
  getRunAdoptionPreview(request: GetRunAdoptionPreviewRequest): Promise<RunAdoption>;
  applyRunAdoption(request: ApplyRunAdoptionRequest): Promise<RunAdoption | RuntimeApprovalRequired>;
  discardRunAdoption(request: DiscardRunAdoptionRequest): Promise<RunAdoption | RuntimeApprovalRequired>;
  decideRuntimeSecurityApproval(request: RuntimeSecurityApprovalDecisionRequest): Promise<{ approval_id: string; decision: string }>;
  decideRuntimeRunApproval(request: RuntimeRunApprovalDecisionRequest): Promise<Record<string, unknown> & { approval_id: string; status: string }>;
  respondChatInput(requestId: string, response: string | Record<string, unknown>): Promise<boolean>;
  startAgentRun(
    request: AgentRunRequest,
  ): Promise<{ requestId: string; sessionId: string; runId: string }>;
  abortAgentRun(requestId: string): Promise<boolean>;
  recoverAgentRun(threadId: string): Promise<AgentRunEvent[]>;
  startVoiceTranscription(
    request: DesktopVoiceTranscriptionRequest,
  ): Promise<DesktopVoiceTranscriptionStartResult>;
  cancelVoiceTranscription(requestId: string): Promise<boolean>;
  getVoiceRuntimeStatus(): Promise<DesktopVoiceRuntimeStatus>;
  getStreamingVoiceCapabilities(): Promise<DesktopStreamingVoiceCapabilities>;
  getDuplexVoiceCapabilities(): Promise<DesktopDuplexVoiceCapabilities>;
  startDuplexVoiceSession(request: DesktopDuplexVoiceSessionStartRequest): Promise<DesktopDuplexVoiceSessionStartResult>;
  sendDuplexVoiceAudioChunk(chunk: DesktopDuplexVoiceAudioChunk): boolean;
  updateDuplexVoiceSession(request: DesktopDuplexVoiceSessionStartRequest): Promise<boolean>;
  interruptDuplexVoiceSession(request: DesktopDuplexVoiceInterruptRequest): Promise<boolean>;
  submitDuplexVoiceToolResult(request: DesktopDuplexVoiceToolResultRequest): Promise<boolean>;
  stopDuplexVoiceSession(sessionId: string): Promise<boolean>;
  cancelDuplexVoiceSession(sessionId: string): Promise<boolean>;
  disposeDuplexVoiceSession(sessionId: string): Promise<boolean>;
  onDuplexVoiceEvents(callback: (events: DesktopDuplexVoiceEvent[]) => void): () => void;
  appendDuplexVoiceHistory(request: DesktopDuplexVoiceHistoryAppendRequest): Promise<DesktopThreadSnapshot>;
  startStreamingVoiceTranscription(
    request: DesktopStreamingVoiceStartRequest,
  ): Promise<DesktopStreamingVoiceStartResult>;
  sendStreamingVoiceAudioChunk(chunk: DesktopStreamingVoiceAudioChunk): boolean;
  stopStreamingVoiceTranscription(sessionId: string, reason?: "provider" | "local_vad" | "manual"): Promise<boolean>;
  cancelStreamingVoiceTranscription(sessionId: string): Promise<boolean>;
  onStreamingVoiceTranscriptionEvent(
    callback: (event: DesktopStreamingVoiceTranscriptionEvent) => void,
  ): () => void;
  onVoiceTranscriptionEvent(
    callback: (event: DesktopVoiceTranscriptionEvent) => void,
  ): () => void;
  writeVoiceTranscriptHandoff(
    request: DesktopVoiceTranscriptHandoffRequest,
  ): Promise<DesktopVoiceTranscriptHandoffResult>;
  startVoiceSynthesis(
    request: DesktopVoiceSynthesisRequest,
  ): Promise<DesktopVoiceSynthesisStartResult>;
  cancelVoiceSynthesis(requestId: string): Promise<boolean>;
  getVoiceSynthesisRuntimeStatus(): Promise<DesktopVoiceSynthesisRuntimeStatus>;
  onVoiceSynthesisEvent(
    callback: (event: DesktopVoiceSynthesisEvent) => void,
  ): () => void;
  saveApiKey(apiKey: string): Promise<SaveApiKeyResult>;
  pickFiles(): Promise<PickDialogResult>;
  pickFolder(): Promise<PickDialogResult>;
  getPathForFile(file: File): string;
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
  listTeamMemory(
    request?: DesktopTeamMemoryListRequest,
  ): Promise<DesktopTeamMemoryEntry[]>;
  addTeamMemory(
    request: DesktopTeamMemoryAddRequest,
  ): Promise<DesktopTeamMemoryEntry>;
  deleteTeamMemory(
    request: DesktopTeamMemoryDeleteRequest,
  ): Promise<DesktopTeamMemoryDeleteResult>;
  listUserPreferences(): Promise<DesktopUserPreference[]>;
  upsertUserPreference(
    request: DesktopUserPreferenceUpsertRequest,
  ): Promise<DesktopUserPreference>;
  deleteUserPreference(
    request: DesktopUserPreferenceDeleteRequest,
  ): Promise<DesktopUserPreferenceDeleteResult>;
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
  createShare(request: DesktopShareCreateRequest): Promise<DesktopShareManifest>;
  inspectShare(request: DesktopShareInspectionRequest): Promise<DesktopShareInspectionResult>;
  updateSharePermission(request: DesktopSharePermissionUpdateRequest): Promise<DesktopShareManifest>;
  revokeShare(request: DesktopShareRevokeRequest): Promise<DesktopShareRevocationResult>;
  inspectShareVersion(request: DesktopShareVersionInspectionRequest): Promise<DesktopShareVersionInspection>;
  publishShareVersion(request: DesktopShareVersionPublishRequest): Promise<DesktopShareVersionPublishResult>;
  listShareComments(request: DesktopShareCommentListRequest): Promise<DesktopShareComment[]>;
  addShareComment(request: DesktopShareCommentAddRequest): Promise<DesktopShareComment>;
  previewShareCommentTask(request: DesktopShareCommentTaskPreviewRequest): Promise<DesktopShareCommentTaskPreview>;
  createShareCommentTask(request: DesktopShareCommentTaskCreateRequest): Promise<DesktopShareCommentTask>;
  updateShareCommentTask(request: DesktopShareCommentTaskUpdateRequest): Promise<DesktopShareCommentTask>;
  completeShareCommentTask(request: DesktopShareCommentTaskCompleteRequest): Promise<DesktopShareCommentTask>;
  listShareCommentTasks(request?: DesktopShareCommentTaskListRequest): Promise<DesktopShareCommentTask[]>;
  continueSharedTask(request: DesktopShareContinuationRequest): Promise<DesktopShareContinuationResult>;
  listShareAudit(request: DesktopShareAuditListRequest): Promise<DesktopShareAuditEntry[]>;
  listIncomingShares(): Promise<DesktopShareManifest[]>;
  listOutgoingShares(): Promise<DesktopShareManifest[]>;
  openSharedObject(request: DesktopSharedObjectOpenRequest): Promise<DesktopSharedObjectOpenResult>;
  downloadSharedArtifact(request: DesktopSharedArtifactDownloadRequest): Promise<DesktopSharedArtifactDownloadResult>;
  enqueueBackgroundTask(
    request: DesktopBackgroundTaskEnqueueRequest,
  ): Promise<DesktopBackgroundTask>;
  updateBackgroundTask(
    request: DesktopBackgroundTaskUpdateRequest,
  ): Promise<DesktopBackgroundTask>;
  cancelBackgroundTask(request: DesktopBackgroundTaskActionRequest): Promise<DesktopBackgroundTask>;
  retryBackgroundTask(request: DesktopBackgroundTaskActionRequest): Promise<DesktopBackgroundTask>;
  recoverBackgroundTasks(): Promise<DesktopBackgroundTaskRecoveryResult>;
  listReusableTasks(): Promise<DesktopReusableTask[]>;
  saveReusableTask(
    request: DesktopReusableTaskSaveRequest,
  ): Promise<DesktopReusableTask>;
  prepareReusableTaskRun(
    request: DesktopReusableTaskRunPrepareRequest,
  ): Promise<DesktopReusableTaskRunRecipe>;
  setCompletionNotificationPreference(
    preference: CompletionNotificationPreference,
  ): Promise<CompletionNotificationPreference>;
  onCompletionNotificationClick(
    callback: (event: CompletionNotificationClickEvent) => void,
  ): () => void;
  listScheduledTasks(
    request?: DesktopScheduledTaskListRequest,
  ): Promise<DesktopScheduledTask[]>;
  createScheduledTask(
    request: DesktopScheduledTaskCreateRequest,
  ): Promise<DesktopScheduledTask>;
  updateScheduledTask(
    request: DesktopScheduledTaskUpdateRequest,
  ): Promise<DesktopScheduledTask>;
  deleteScheduledTask(
    request: DesktopScheduledTaskDeleteRequest,
  ): Promise<DesktopScheduledTaskDeleteResult>;
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
  pollChannelAdapterAuth(request: DesktopChannelAdapterAuthPollRequest): Promise<DesktopChannelAdapterAuthPollResult>;
  revokeChannelAdapterAuth(request: DesktopChannelAdapterAuthRevokeRequest): Promise<DesktopChannelAdapterAuthRevokeResult>;
  configureChannelProviderToken(request: DesktopChannelProviderTokenConfigureRequest): Promise<DesktopChannelProviderTokenConfigureResult>;
  importChannelContext(
    request: DesktopChannelContextImportRequest,
  ): Promise<DesktopChannelContextImportResult>;
  syncLiveChannelContext(request: DesktopChannelLiveSyncRequest): Promise<DesktopChannelContextImportResult>;
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
  openRegressionReference(uri: string): Promise<string>;
  openPath(path: string): Promise<string>;
  openPdfPage(request: PdfPageOpenRequest): Promise<PdfPageOpenResult>;
  getIdeContext(workspacePath: string): Promise<DesktopIdeContextSnapshot>;
  getFileIcon(path: string): Promise<DesktopFileIconResult>;
  createTerminal(options?: TerminalCreateOptions): Promise<TerminalSessionInfo>;
  listTerminalSessions(workspaceKey?: string, workspaceId?: string): Promise<TerminalSessionInfo[]>;
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

  // Skills (gateway-managed)
  listInstalledSkills(request?: { userId?: string }): Promise<GatewaySkill[]>;
  listAvailableSkills(request?: { userId?: string }): Promise<GatewayAvailableSkill[]>;
  getSkillContent(request: { skillPath: string }): Promise<{ path: string; content: string }>;
  installSkill(request: GatewaySkillInstallRequest): Promise<{ status: string; name: string; path: string }>;
  updateSkill(request: { name: string; content: string; userId?: string }): Promise<{ status: string; name: string; path: string }>;
  uninstallSkill(request: { name: string; userId?: string }): Promise<{ status: string; name: string }>;
  reloadSkills(request?: { threadId?: string; userId?: string }): Promise<{ ok: boolean; reloaded: boolean }>;

  // GFS cloud storage
  gfsList(request: GfsListRequest): Promise<GfsListResult>;
  gfsStat(request: { path: string }): Promise<GfsObjectInfo>;
  gfsRead(request: { path: string }): Promise<{ path: string; content: string }>;
  gfsWrite(request: {
    path: string;
    content: string;
    contentType?: string;
  }): Promise<{ path: string; etag: string }>;
  gfsUploadFile(request: GfsUploadRequest): Promise<{ path: string; size: number }>;
  gfsDownloadFile(request: GfsDownloadRequest): Promise<{ localPath: string; size: number }>;
  gfsDelete(request: { path: string }): Promise<{ path: string }>;
  gfsShareUrl(request: {
    path: string;
    ttlMinutes?: number;
    responseContentType?: string;
  }): Promise<{ url: string; expiresAt: string }>;
  gfsHealthcheck(): Promise<{ ok: boolean; bucket?: string; mode?: string; reason?: string }>;
}
