export const DIAGNOSTIC_SCHEMA_VERSION = 1 as const;

export type DiagnosticLevel = "debug" | "info" | "warn" | "error";
export type DiagnosticStatus =
  | "started"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";
export type DiagnosticKind = "operation" | "log" | "error" | "health" | "snapshot";
export type DiagnosticComponentState =
  | "unknown"
  | "starting"
  | "running"
  | "waiting"
  | "degraded"
  | "disconnected"
  | "stopped"
  | "failed";

export interface DiagnosticSourceLocation {
  file?: string;
  function?: string;
  line?: number;
  column?: number;
  language?: "typescript" | "javascript" | "python" | "native" | "unknown";
}

export type DiagnosticSourceKind =
  | "local"
  | "workspace"
  | "remote"
  | "package"
  | "python"
  | "generated"
  | "unknown";

export type DiagnosticSourceMappingStatus =
  | "not-required"
  | "mapped"
  | "missing"
  | "invalid"
  | "unsupported";

export interface DiagnosticSourceAddress extends DiagnosticSourceLocation {
  kind: DiagnosticSourceKind;
  uri: string;
  workspaceId?: string;
  relativePath?: string;
  version?: string;
  available: boolean;
  trusted: boolean;
  remote: boolean;
}

export interface DiagnosticSourceContextRequest {
  source: DiagnosticSourceLocation;
  workspaceId?: string;
  contextLines?: number;
  preferOriginal?: boolean;
}

export interface DiagnosticSourceMapping {
  status: DiagnosticSourceMappingStatus;
  generated: DiagnosticSourceLocation;
  original?: DiagnosticSourceLocation;
  mapFile?: string;
  message: string;
}

export interface DiagnosticSourceContext {
  available: boolean;
  reason?: string;
  address: DiagnosticSourceAddress;
  mapping: DiagnosticSourceMapping;
  location: DiagnosticSourceLocation;
  content?: string;
  startLine?: number;
  endLine?: number;
  highlightLine?: number;
  language: DiagnosticSourceLocation["language"];
  truncated: boolean;
  redacted: boolean;
  canOpen: boolean;
}

export interface DiagnosticSourceOpenRequest extends DiagnosticSourceContextRequest {
  target?: "system" | "editor" | "reveal";
}

export interface DiagnosticSourceOpenResult {
  opened: boolean;
  path?: string;
  line?: number;
  column?: number;
  message: string;
}

export interface DiagnosticStackFrame extends DiagnosticSourceLocation {
  raw: string;
  inApp?: boolean;
}

export interface DiagnosticEvent {
  schemaVersion: typeof DIAGNOSTIC_SCHEMA_VERSION;
  id: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  timestamp: string;
  endedAt?: string;
  durationMs?: number;
  kind: DiagnosticKind;
  level: DiagnosticLevel;
  status: DiagnosticStatus;
  module: string;
  component: string;
  operation: string;
  message: string;
  source?: DiagnosticSourceLocation;
  stack?: DiagnosticStackFrame[];
  errorCode?: string;
  sessionId?: string;
  turnId?: string;
  runId?: string;
  workspaceId?: string;
  backendId?: string;
  remoteHostId?: string;
  machineId?: string;
  sequence?: number;
  attributes?: Record<string, string | number | boolean | null>;
}

export interface DiagnosticEventInput extends Partial<Omit<DiagnosticEvent,
  "schemaVersion" | "id" | "timestamp" | "traceId" | "spanId"
>> {
  traceId?: string;
  spanId?: string;
  id?: string;
  timestamp?: string;
  module: string;
  component: string;
  operation: string;
  message: string;
}

export interface DiagnosticQuery {
  traceId?: string;
  module?: string;
  component?: string;
  status?: DiagnosticStatus;
  level?: DiagnosticLevel;
  since?: string;
  limit?: number;
}

export interface DiagnosticTrace {
  traceId: string;
  startedAt: string;
  endedAt?: string;
  status: DiagnosticStatus;
  durationMs?: number;
  rootOperation: string;
  events: DiagnosticEvent[];
  activeEvent?: DiagnosticEvent;
  firstFailure?: DiagnosticEvent;
  criticalPathMs?: number;
  recovered?: boolean;
  machineIds?: string[];
}

export interface DiagnosticPerformanceSummary {
  key: string;
  module: string;
  component: string;
  operation: string;
  count: number;
  failureCount: number;
  totalDurationMs: number;
  averageDurationMs: number;
  p95DurationMs: number;
  maxDurationMs: number;
}

export interface DiagnosticResourceSample {
  timestamp: string;
  machineId: string;
  processId: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
  eventLoopDelayMs: number;
}

export interface DiagnosticTraceCheckpoint {
  traceId: string;
  rootOperation: string;
  status: DiagnosticStatus;
  lastEventAt: string;
  eventCount: number;
  machineIds: string[];
  recovered: boolean;
}

export interface DiagnosticDeepTracingSnapshot {
  performance: DiagnosticPerformanceSummary[];
  resources: DiagnosticResourceSample[];
  activeCheckpoints: DiagnosticTraceCheckpoint[];
  clockOffsets: Array<{ machineId: string; offsetMs: number; sampledAt: string }>;
}

export type DiagnosticFaultCategory =
  | "authentication"
  | "configuration"
  | "network"
  | "timeout"
  | "process"
  | "resource"
  | "source-code"
  | "dependency"
  | "user-cancelled"
  | "unknown";

export interface DiagnosticRootCauseCandidate {
  id: string;
  traceId: string;
  eventId: string;
  category: DiagnosticFaultCategory;
  severity: "info" | "warning" | "error" | "critical";
  confidence: number;
  recoverable: boolean;
  title: string;
  explanation: string;
  evidenceEventIds: string[];
  propagatedEventIds: string[];
  suggestedActions: string[];
}

export type DiagnosticClusterState = "open" | "known" | "ignored" | "resolved";

export interface DiagnosticErrorCluster {
  id: string;
  fingerprint: string;
  title: string;
  category: DiagnosticFaultCategory;
  state: DiagnosticClusterState;
  count: number;
  traceIds: string[];
  eventIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  trend: "new" | "stable" | "improving" | "worsening";
  knownIssueNote?: string;
}

export interface DiagnosticRootCauseAnalysis {
  traceId: string;
  primary?: DiagnosticRootCauseCandidate;
  alternatives: DiagnosticRootCauseCandidate[];
  facts: string[];
  inferences: Array<{ text: string; confidence: number }>;
  uncertainties: string[];
  summary: string;
}

export interface DiagnosticRootCauseSnapshot {
  analyses: DiagnosticRootCauseAnalysis[];
  clusters: DiagnosticErrorCluster[];
  generatedAt: string;
}

export interface DiagnosticIssueUpdateRequest {
  action: "mark-known" | "ignore" | "resolve" | "reopen" | "merge" | "split";
  clusterId: string;
  targetClusterId?: string;
  eventIds?: string[];
  note?: string;
}

export interface DiagnosticIssueUpdateResult {
  updated: boolean;
  message: string;
}

export type InteractiveDebugTargetKind = "electron-renderer" | "electron-main" | "node" | "python" | "remote-python";
export type InteractiveDebugSessionState = "starting" | "running" | "paused" | "disconnected" | "stopped" | "failed";

export interface InteractiveDebugCapabilities {
  supportsPause: boolean;
  supportsStep: boolean;
  supportsConditionalBreakpoints: boolean;
  supportsHitConditionalBreakpoints: boolean;
  supportsLogPoints: boolean;
  supportsEvaluateForHovers: boolean;
  supportsSetVariable: boolean;
  supportsTerminateRequest: boolean;
  supportsRemoteTargets: boolean;
}

export interface InteractiveDebugTarget {
  id: string;
  kind: InteractiveDebugTargetKind;
  name: string;
  description: string;
  available: boolean;
  reason?: string;
  processId?: number;
  remote: boolean;
  capabilities: InteractiveDebugCapabilities;
}

export interface InteractiveDebugBreakpoint {
  id: string;
  source: DiagnosticSourceLocation;
  enabled: boolean;
  verified: boolean;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
  message?: string;
}

export interface InteractiveDebugStackFrame {
  id: string;
  name: string;
  source?: DiagnosticSourceLocation;
  presentationHint?: "normal" | "label" | "subtle";
  canRestart: boolean;
}

export interface InteractiveDebugScope {
  id: string;
  name: string;
  variablesReference: string;
  expensive: boolean;
}

export interface InteractiveDebugVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference?: string;
  indexedVariables?: number;
  namedVariables?: number;
  sensitive: boolean;
}

export interface InteractiveDebugSession {
  id: string;
  target: InteractiveDebugTarget;
  state: InteractiveDebugSessionState;
  startedAt: string;
  updatedAt: string;
  pausedReason?: string;
  activeThreadId?: string;
  activeFrameId?: string;
  breakpoints: InteractiveDebugBreakpoint[];
  stackFrames: InteractiveDebugStackFrame[];
  message: string;
  traceId?: string;
  workspaceId?: string;
}

export interface InteractiveDebugStartRequest {
  targetId: string;
  traceId?: string;
  workspaceId?: string;
  program?: string;
  cwd?: string;
  inspectorUrl?: string;
  host?: string;
  port?: number;
  stopOnEntry?: boolean;
}

export interface InteractiveDebugBreakpointRequest {
  sessionId: string;
  source: DiagnosticSourceLocation;
  enabled?: boolean;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
}

export type ProductionDiagnosticMode = "off" | "basic" | "detailed" | "interactive";

export interface ProductionDiagnosticSettings {
  mode: ProductionDiagnosticMode;
  retentionDays: number;
  diskLimitMb: number;
  remoteTransmission: boolean;
  includeSource: boolean;
  allowRemoteTargets: boolean;
  allowDebugAttach: boolean;
  allowExport: boolean;
  encryptedPackages: boolean;
}

export interface ProductionDiagnosticAuditEntry {
  id: string;
  timestamp: string;
  action: string;
  result: "allowed" | "denied" | "failed";
  detail: string;
}

export interface ProductionDiagnosticStatus {
  settings: ProductionDiagnosticSettings;
  lockedSettings: Array<keyof ProductionDiagnosticSettings>;
  policySource: "defaults" | "environment" | "enterprise-file";
  selfCheck: "healthy" | "degraded" | "disabled";
  selfCheckMessages: string[];
  degraded: boolean;
  eventRatePerMinute: number;
  observedEvents: number;
  droppedEvents: number;
  estimatedBytes: number;
  budgets: { cpuPercent: number; memoryMb: number; diskMb: number; uiLatencyMs: number };
  releaseGates: Array<{ id: string; passed: boolean; message: string }>;
  audit: ProductionDiagnosticAuditEntry[];
}

export interface DiagnosticPackagePreview {
  formatVersion: number;
  encrypted: boolean;
  eventCount: number;
  byteLength: number;
  sensitiveMatchesRemoved: number;
  sections: string[];
  integritySha256: string;
  warnings: string[];
}

export interface DiagnosticPackageResult {
  ok: boolean;
  path?: string;
  preview: DiagnosticPackagePreview;
  message: string;
}

export interface InteractiveDebugControlRequest {
  sessionId: string;
  action: "pause" | "continue" | "next" | "step-in" | "step-out" | "disconnect" | "terminate";
  threadId?: string;
}

export interface InteractiveDebugEvaluateRequest {
  sessionId: string;
  frameId: string;
  expression: string;
}

export interface InteractiveDebugEvaluateResult {
  result: string;
  type?: string;
  variablesReference?: string;
  safe: boolean;
  message: string;
}

export interface DiagnosticComponentHealth {
  id: string;
  module: string;
  component: string;
  state: DiagnosticComponentState;
  message: string;
  pid?: number;
  version?: string;
  lastHeartbeatAt: string;
  restartCount: number;
  retryCount: number;
  lastErrorCode?: string;
  lastTraceId?: string;
}

export interface DiagnosticFinding {
  id: string;
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  module: string;
  component: string;
  traceId?: string;
  eventId?: string;
  suggestedAction: string;
}

export interface DiagnosticSnapshot {
  generatedAt: string;
  events: DiagnosticEvent[];
  traces: DiagnosticTrace[];
  health: DiagnosticComponentHealth[];
  findings: DiagnosticFinding[];
  deepTracing: DiagnosticDeepTracingSnapshot;
  rootCause: DiagnosticRootCauseSnapshot;
  droppedEvents: number;
  storage: {
    eventCount: number;
    maxEvents: number;
    persisted: boolean;
  };
}

export interface DiagnosticExportResult {
  exported: boolean;
  path?: string;
  eventCount: number;
  message: string;
}

export interface DiagnosticClearResult {
  cleared: boolean;
  removedEvents: number;
}

export function isTerminalDiagnosticStatus(status: DiagnosticStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
