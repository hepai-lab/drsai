import { createHash, randomUUID } from "crypto";
import { getDiagnosticPropagationHeaders } from "./diagnosticContext";
import { getGatewayRequestHeaders, getGatewayStatus, startGateway } from "./gateway";
import { parseRemoteProtocolError, RemoteProtocolError, REMOTE_SSH_PROTOCOL_VERSION, type RemoteProtocolErrorBody } from "../api/remoteSshProtocol";
import type { OWOPOperation, OWOPParamsByOperation } from "../api/owop.generated";
import type {
  OaepEventPage,
  OaepSnapshot,
} from "../api/oaep.generated";
import { assertOaepSnapshotIntegrity } from "./oaepIntegrity";
import type { RunInspection, RunItemLocator, RunReproductionManifest, SessionRunList } from "../api/runInspection";
import type { CreateRunComparisonEvaluationRequest, ReplayBoundaries, ReplayExecutionResult, ReplayPlan, RunAdoption, RunComparison, RunComparisonEvaluation, RunComparisonEvaluationList, RunExperiment, RunExperimentCandidateSnapshot, RunExperimentCapabilities, RunExperimentPackage, RunRelations, RunExperimentOverrides, ReplayMode, WorktreeAdoptionApplyResult, WorktreeAdoptionPreview } from "../api/runExperiment";
export type {
  OaepEvent,
  OaepEventPage,
  OaepItem,
  OaepItemStatus,
  OaepItemType,
  OaepRun,
  OaepSession,
  OaepSnapshot,
  OaepSource,
} from "../api/oaep.generated";
import type {
  DesktopMobilePairingGrant,
  DesktopMobilePairingScope,
  DesktopMobilePairingReadiness,
  DesktopMobileAssociation,
  DesktopRuntimeEnrollmentRevocation,
  DesktopRuntimeRemoteAccessState,
  DesktopMobileRemoteDiagnostics,
  GatewayStatus,
  WorkspaceProject,
  OaepInputResource,
  RuntimeModelRef,
} from "../api/desktopApi";

function ensureLoopbackNoProxy(): void {
  for (const key of ["NO_PROXY", "no_proxy"] as const) {
    const entries = String(process.env[key] || "").split(",").map((value) => value.trim()).filter(Boolean);
    for (const host of ["127.0.0.1", "localhost"]) {
      if (!entries.some((entry) => entry.toLowerCase() === host)) entries.push(host);
    }
    process.env[key] = entries.join(",");
  }
}

// Node 24 can route global fetch through HTTP_PROXY when NODE_USE_ENV_PROXY is
// enabled. Runtime endpoints are deliberately loopback-only and must remain
// direct, including on corporate/proxied Windows installations.
ensureLoopbackNoProxy();

const packagedRecoveryRuns = new Map<string, { failures: number; events: RuntimeAgentEvent[] }>();
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{1,200}$/;

interface RemoteGatewayAccess {
  baseUrl: string;
  token: string;
  workspaceId: string;
  /** Optional transport generation supplied by the SSH manager. */
  authGeneration?: string;
}

interface RuntimeWorkspaceRouting {
  getRemoteGatewayAccess(workspacePath: string, workspaceId?: string): RemoteGatewayAccess | undefined;
  findWorkspaceById(workspaceId: string): Promise<WorkspaceProject | undefined>;
  bindRemoteThread?(threadId: string, workspaceId: string, runtimeSessionId: string): void;
}

let workspaceRouting: RuntimeWorkspaceRouting = {
  getRemoteGatewayAccess: () => undefined,
  findWorkspaceById: async () => undefined,
};

export function configureRuntimeWorkspaceRouting(routing: RuntimeWorkspaceRouting): void {
  workspaceRouting = routing;
}

export function bindRuntimeThreadToWorkspace(threadId: string, workspaceId: string, runtimeSessionId: string): void {
  workspaceRouting.bindRemoteThread?.(threadId, workspaceId, runtimeSessionId);
}

export type RuntimeLocation = "local" | "remote";

export interface RuntimeIdentity {
  runtime_id: string;
  instance_id: string;
  version: string;
  protocol_version: number;
  platform: string;
  dev_managed?: boolean;
}

export interface RuntimeCapabilities {
  protocol_version: number;
  capabilities: string[];
  capability_versions: Record<string, number>;
  protocols?: {
    oaep?: { version: string; profiles: string[] };
    owop?: { version: string; capabilities: string[] };
    control?: { version: string };
    relay?: { version: string };
  };
  agent_backends?: Record<string, AgentBackendCapability>;
}

export interface AgentBackendCapability {
  backend_id: string;
  available: boolean;
  installed?: boolean;
  authenticated?: boolean;
  contract_compatible?: boolean;
  executable?: boolean;
  reason?: string | null;
  version?: string;
  connection_state?: string;
  app_server_state?: "running" | "stopped" | "fault";
  transport?: "local-process" | "ssh" | string;
  adapter_version?: string;
  readiness?: {
    refreshed_at: string;
    transport: BackendReadinessFacet;
    installed: BackendReadinessFacet;
    contract: BackendReadinessFacet;
    account: BackendReadinessFacet;
    models: BackendReadinessFacet;
    executable: BackendReadinessFacet & { blockers?: string[] };
  };
  model_catalog?: {
    generation?: number | null;
    stale?: boolean;
    last_successful_at?: string | null;
    error?: string | null;
    default_model?: string | null;
    models?: Array<{
      id: string;
      display_name?: string;
      default?: boolean;
      hidden?: boolean;
      reasoning_efforts?: string[];
      modalities?: string[];
    }>;
  };
}

export type BackendModelCatalog = NonNullable<AgentBackendCapability["model_catalog"]>;

export interface BackendAccountStatus {
  state: "signed_in" | "signed_out" | "unavailable" | "unknown";
  logged_in: boolean;
  auth_mode: "chatgpt" | "apiKey" | string | null;
  email: string | null;
  plan_type: string | null;
  credential_source: string | null;
  requires_openai_auth: boolean;
  reason?: string | null;
  retryable?: boolean;
}

export interface BackendLoginStart {
  type: "chatgpt" | "chatgptDeviceCode";
  loginId: string;
  authUrl?: string;
  verificationUrl?: string;
  userCode?: string;
}

export interface RuntimeWorkspace {
  workspace_id: string;
  path: string;
  display_name?: string;
  created_at: string;
  last_opened_at: string;
  closed_at?: string | null;
  open: boolean;
}

export interface RuntimeWorktree {
  worktree_id: string;
  source_workspace_id: string;
  workspace_id: string | null;
  repo_root: string;
  canonical_path: string;
  branch: string;
  base_commit: string;
  status: "creating" | "active" | "review" | "merge_pending" | "merged" | "archived" | "removing" | "removed";
  location: "local" | "remote";
  source_dirty?: boolean;
  source_status_summary?: string | null;
  created_at: string;
  updated_at: string;
  removed_at?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  head_commit?: string | null;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  activity?: { sessions: number; runs: number; terminals: number; total: number };
}

export interface RuntimeWorktreeCreateResult {
  worktree_id: string;
  workspace_id: string;
  source_workspace_path: string;
  repo_root: string;
  worktree_path: string;
  branch: string;
  base_ref: string;
  source_has_changes: boolean;
  source_status_summary?: string | null;
  location: "local" | "remote";
  transport?: "ssh";
}

export interface RuntimeWorkspaceEvent {
  event_id: string;
  workspace_id: string;
  sequence: number;
  type: string;
  data: Record<string, unknown>;
}

export interface RuntimeSessionList {
  object: "list";
  data: unknown[];
  total: number;
}

export interface RuntimeWorkspaceSessionCatalogEvent {
  event_id: string;
  session_id: string;
  type: "event.session.created" | "event.session.updated" | "event.session.archived" | "event.session.unarchived" | "event.session.deleted";
  sequence: number;
}

export interface RuntimeWorkspaceSessionCatalogStream {
  response: Response;
  events: ReadableStream<Uint8Array>;
}

export interface RuntimeSession { session_id: string; workspace_id: string; title: string; archived?: boolean; lifecycle?: string; created_at?: string; updated_at?: string; message_count?: number; }
export interface RuntimeBackendSessionSyncResult {
  backend_id: string; workspace_id: string; discovered: number; active: number; archived: number;
  created: number; updated: number; skipped: number; conflicts?: number; sessions: RuntimeSession[];
}

export interface BackendReadinessFacet {
  state: "ready" | "stopped" | "fault" | "missing" | "blocked" | "stale" | "empty" | "signed_in" | "signed_out" | "unavailable" | "unknown";
  reason?: string | null;
}
export interface RuntimeBackendSessionBindingStatus {
  session_id: string;
  backend_id?: string;
  backend?: string;
  state: "unbound" | "bound" | "recovery-required" | "conflict" | "backend-missing";
  backend_session_id?: string;
  thread_id?: string;
  backend_version?: string;
  backend_model_id?: string | null;
  model_id?: string | null;
  workspace_fingerprint?: string | null;
  operation_state?: string;
  reason?: string | null;
  available_actions?: Array<"continue" | "archive" | "new_task" | "bind" | "recover" | "sync">;
}
export interface RuntimeAgentRun {
  run_id: string;
  session_id: string;
  workspace_id: string;
  backend_id: string;
  status: string;
  runtime_id?: string;
  instance_id?: string;
  input_message?: string;
}
export interface LegacyDesktopAgentRunMigrationRequest {
  workspace_id: string;
  thread_id: string;
  run_id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
  events: Array<Record<string, unknown>>;
}
export interface LegacyDesktopAgentRunMigrationResult {
  session_id: string;
  run_id: string;
  session_created: boolean;
  run_created: boolean;
  items_created: number;
  items_total: number;
  terminal_status: "completed" | "failed" | "cancelled";
  oaep_item_count: number;
}
export interface RuntimeAgentEvent { event_id: string; run_id: string; sequence: number; type: string; data: Record<string, unknown>; }
export interface RuntimeSideEffect {
  effect_id: string;
  approval_id: string;
  run_id: string;
  idempotency_key: string;
  operation: string;
  request_digest: string;
  status: "requested" | "approved" | "rejected" | "executing" | "completed" | "failed";
  result_digest?: string | null;
  error_code?: string | null;
  requested_at: string;
  approved_at?: string | null;
  execution_started_at?: string | null;
  completed_at?: string | null;
  recovered_at?: string | null;
}
export interface RuntimeGoal {
  run_id: string;
  version: number;
  goal: {
    objective: string;
    materials: string[];
    outputs: string[];
    constraints: string[];
    defaults: { language: string; length: string; citation_style: string; format: string };
    default_sources: { language: string; length: string; citation_style: string; format: string };
  };
  confirmed: boolean;
  created_at: string;
  confirmed_at?: string;
}
export interface RuntimeGoalProposal {
  status: "ready" | "clarification_required";
  questions: Array<{ field: string; prompt: string; reason: string }>;
  side_effects_allowed: false;
  goal?: RuntimeGoal["goal"];
  goal_revision?: RuntimeGoal;
}
export interface RuntimeConversationItem {
  item_id: string;
  session_id: string;
  run_id: string | null;
  kind: "message" | "reasoning" | "tool" | "file_change" | "approval" | "artifact" | "error";
  role: "user" | "assistant" | "system" | "tool" | null;
  revision: number;
  session_sequence: number;
  source_client: "windows" | "android" | "runtime";
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
  payload: Record<string, unknown>;
}
export interface RuntimeConversationSnapshot {
  session_id: string;
  snapshot_sequence: number;
  items: RuntimeConversationItem[];
  next_cursor: string | null;
}
export interface RuntimeSessionEvent {
  event_id: string;
  runtime_id: string;
  workspace_id: string;
  session_id: string;
  run_id: string | null;
  session_sequence: number;
  kind: string;
  timestamp: string;
  payload: Record<string, unknown>;
}
export interface RuntimeSessionEventPage {
  object: "list";
  data: RuntimeSessionEvent[];
  next_sequence: number;
}
export interface RuntimeSessionEventStream {
  response: Response;
  events: ReadableStream<Uint8Array>;
}
export interface OaepEventStream {
  response: Response;
  events: ReadableStream<Uint8Array>;
}

export interface RuntimeRunRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  workspace_id: string;
  thread_id: string;
  metadata?: Record<string, unknown>;
  stream: true;
}

export interface RuntimeRunStream {
  requestId: string;
  response: Response;
  events: ReadableStream<Uint8Array>;
}

export class RuntimeOWOPError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly correlationId: string,
    readonly retryable: boolean,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RuntimeOWOPError";
  }
}

export interface RuntimeClient {
  readonly location: RuntimeLocation;
  /** Stable, secret-free identity used to share one live transport per Runtime endpoint. */
  readonly streamIdentity: string;
  getRuntime(): Promise<RuntimeIdentity>;
  getCapabilities(): Promise<RuntimeCapabilities>;
  getBackendAccount(backendId: string, refresh?: boolean): Promise<BackendAccountStatus>;
  getBackendModels(backendId: string, refresh?: boolean): Promise<BackendModelCatalog>;
  restartBackend(backendId: string): Promise<Record<string, unknown>>;
  syncBackendSessions(workspaceId: string, backendId: string, signal?: AbortSignal): Promise<RuntimeBackendSessionSyncResult>;
  syncBackendSessionHistory(sessionId: string, signal?: AbortSignal, repair?: boolean, cursor?: string, limit?: number): Promise<{ session_id: string; backend_id: string; imported: number; total: number; runs?: number; warnings?: number; mapping_version?: string; next_cursor?: string | null; estimated_total?: number; truncated?: boolean; loaded_runs?: number }>;
  getBackendSessionBinding(sessionId: string): Promise<RuntimeBackendSessionBindingStatus>;
  startBackendLogin(backendId: string, type?: "chatgpt" | "chatgptDeviceCode"): Promise<BackendLoginStart>;
  cancelBackendLogin(backendId: string, loginId: string): Promise<void>;
  logoutBackend(backendId: string): Promise<void>;
  openWorkspace(path: string, displayName?: string): Promise<RuntimeWorkspace>;
  updateWorkspaceDisplayName(workspaceId: string, displayName: string): Promise<RuntimeWorkspace>;
  listWorkspaces(includeClosed?: boolean): Promise<RuntimeWorkspace[]>;
  closeWorkspace(workspaceId: string): Promise<RuntimeWorkspace>;
  createWorktree(workspaceId: string, intent: string, idempotencyKey: string): Promise<RuntimeWorktreeCreateResult>;
  adoptWorktree(workspaceId: string, request: { idempotencyKey: string; canonicalPath: string; branch: string; baseRef: string }): Promise<RuntimeWorktree>;
  listWorktrees(workspaceId: string, includeRemoved?: boolean, auth?: RuntimeExecutionAuth): Promise<RuntimeWorktree[]>;
  listWorkspaceEvents(workspaceId: string, afterSequence?: number, auth?: RuntimeExecutionAuth): Promise<{ events: RuntimeWorkspaceEvent[]; nextSequence: number }>;
  describeWorktree(workspaceId: string, worktreeId: string): Promise<RuntimeWorktree>;
  mergeWorktree(workspaceId: string, worktreeId: string, idempotencyKey: string, expectedHead?: string): Promise<RuntimeWorktree>;
  archiveWorktree(workspaceId: string, worktreeId: string, idempotencyKey: string): Promise<RuntimeWorktree>;
  removeWorktree(workspaceId: string, worktreeId: string, expectedStatus: "merged" | "archived", idempotencyKey: string): Promise<RuntimeWorktree>;
  listSessions(workspaceId: string): Promise<RuntimeSessionList>;
  getSession(sessionId: string): Promise<RuntimeSession>;
  openWorkspaceSessionCatalogStream(workspaceId: string, signal: AbortSignal): Promise<RuntimeWorkspaceSessionCatalogStream>;
  createSession(workspaceId: string, title?: string): Promise<RuntimeSession>;
  updateSession(sessionId: string, updates: { archived?: boolean; title?: string }): Promise<RuntimeSession>;
  importLegacyDesktopAgentRun(request: LegacyDesktopAgentRunMigrationRequest): Promise<LegacyDesktopAgentRunMigrationResult>;
  getConversationSnapshot(sessionId: string): Promise<RuntimeConversationSnapshot>;
  listSessionEvents(sessionId: string, afterSequence?: number, limit?: number): Promise<RuntimeSessionEventPage>;
  openSessionEventStream(sessionId: string, afterSequence: number, signal: AbortSignal): Promise<RuntimeSessionEventStream>;
  getOaepSnapshot(sessionId: string): Promise<OaepSnapshot>;
  listOaepEvents(sessionId: string, afterSequence?: number, limit?: number): Promise<OaepEventPage>;
  openOaepEventStream(sessionId: string, afterSequence: number, signal: AbortSignal): Promise<OaepEventStream>;
  getAgentRun(runId: string): Promise<RuntimeAgentRun>;
  createAgentRun(sessionId: string, agentDefinition: string, idempotencyKey: string): Promise<RuntimeAgentRun>;
  getAgentRunByIdempotency(sessionId: string, idempotencyKey: string): Promise<RuntimeAgentRun | null>;
  getRunGoal(runId: string): Promise<RuntimeGoal>;
  proposeRunGoal(runId: string, prompt: string, materials: string[], expectedVersion?: number, clarifications?: Record<string, string>): Promise<RuntimeGoalProposal>;
  reviseRunGoal(runId: string, goal: RuntimeGoal["goal"], expectedVersion: number): Promise<RuntimeGoal>;
  confirmRunGoal(runId: string, version: number): Promise<RuntimeGoal>;
  executeAgentRun(
    runId: string,
    prompt: string,
    signal?: AbortSignal,
    provenance?: { sourceClient: "windows" | "android"; sourceMessageId: string; attachmentRefs?: string[]; inputResources?: OaepInputResource[]; model?: string; modelSelection?: RuntimeModelRef; metadata?: Record<string, unknown> },
    auth?: RuntimeExecutionAuth,
  ): Promise<{ run: RuntimeAgentRun; result: unknown }>;
  cancelAgentRun(runId: string): Promise<RuntimeAgentRun>;
  listAgentRunEvents(runId: string, afterSequence?: number): Promise<RuntimeAgentEvent[]>;
  listRunSideEffects(runId: string): Promise<RuntimeSideEffect[]>;
  getAgentRunDiagnostics(runId: string): Promise<Record<string, unknown>>;
  listSessionRuns(sessionId: string, cursor?: string, limit?: number, status?: string, auth?: RuntimeExecutionAuth): Promise<SessionRunList>;
  getRunInspection(runId: string, cursor?: string, limit?: number, itemType?: string, status?: string, auth?: RuntimeExecutionAuth): Promise<RunInspection>;
  locateRunItem(runId: string, itemId: string, itemType?: string, status?: string, auth?: RuntimeExecutionAuth): Promise<RunItemLocator>;
  getRunReproductionManifest(runId: string, auth?: RuntimeExecutionAuth): Promise<RunReproductionManifest>;
  exportRunReproductionManifest(runId: string, auth?: RuntimeExecutionAuth): Promise<RunReproductionManifest>;
  createRunExperiment(runId: string, request: { idempotencyKey: string; title?: string; forkedFromItemId?: string; replayMode?: ReplayMode }, auth?: RuntimeExecutionAuth): Promise<RunExperiment>;
  getRunExperimentCapabilities(runId: string, auth?: RuntimeExecutionAuth): Promise<RunExperimentCapabilities>;
  finalizeRunExperimentCandidate(experimentId: string, approvalId?: string, auth?: RuntimeExecutionAuth): Promise<RunExperimentCandidateSnapshot>;
  getRunExperiment(experimentId: string, auth?: RuntimeExecutionAuth): Promise<RunExperiment>;
  updateRunExperiment(experimentId: string, request: { expectedVersion: number; idempotencyKey: string; patch: { title?: string; overrides?: RunExperimentOverrides; replay_mode?: ReplayMode } }, auth?: RuntimeExecutionAuth): Promise<RunExperiment>;
  deleteRunExperiment(experimentId: string, auth?: RuntimeExecutionAuth): Promise<void>;
  exportRunExperimentPackage(experimentId: string, auth?: RuntimeExecutionAuth): Promise<RunExperimentPackage>;
  createReplayPlan(experimentId: string, request: { expectedDraftVersion: number; expiresInSeconds?: number; availability?: Record<string, unknown> }, auth?: RuntimeExecutionAuth): Promise<ReplayPlan>;
  getReplayPlan(replayPlanId: string, auth?: RuntimeExecutionAuth): Promise<ReplayPlan>;
  getReplayBoundaries(runId: string, auth?: RuntimeExecutionAuth): Promise<ReplayBoundaries>;
  getRunRelations(runId: string, auth?: RuntimeExecutionAuth): Promise<RunRelations>;
  executeReplayPlan(replayPlanId: string, request: { draftVersion: number; planDigest: string; baseManifestDigest: string; idempotencyKey: string; approvalId?: string; runtimeApprovalId?: string; isolatedWorktreeId?: string }, auth?: RuntimeExecutionAuth): Promise<ReplayExecutionResult>;
  createRunComparison(baselineRunId: string, candidateRunId: string, auth?: RuntimeExecutionAuth): Promise<RunComparison>;
  getRunComparison(comparisonId: string, auth?: RuntimeExecutionAuth): Promise<RunComparison>;
  listRunComparisonEvaluations(comparisonId: string, auth?: RuntimeExecutionAuth): Promise<RunComparisonEvaluationList>;
  createRunComparisonEvaluation(request: CreateRunComparisonEvaluationRequest, auth?: RuntimeExecutionAuth): Promise<RunComparisonEvaluation>;
  getWorktreeAdoptionPreview(sourceWorkspaceId: string, worktreeId: string, auth?: RuntimeExecutionAuth): Promise<WorktreeAdoptionPreview>;
  applyWorktreeAdoption(sourceWorkspaceId: string, worktreeId: string, request: { previewDigest: string; selectedPaths: string[]; approvalId: string }, auth?: RuntimeExecutionAuth): Promise<WorktreeAdoptionApplyResult>;
  getRunAdoptionPreview(comparisonId: string, auth?: RuntimeExecutionAuth): Promise<RunAdoption>;
  applyRunAdoption(adoptionId: string, selectedPaths: string[], approvalId?: string, auth?: RuntimeExecutionAuth): Promise<RunAdoption>;
  discardRunAdoption(adoptionId: string, cleanup: boolean, approvalId?: string, auth?: RuntimeExecutionAuth): Promise<RunAdoption>;
  decideSecurityApproval(approvalId: string, decision: "approved" | "denied", auth?: RuntimeExecutionAuth): Promise<{ approval_id: string; decision: string }>;
  getRunApproval(approvalId: string, auth?: RuntimeExecutionAuth): Promise<Record<string, unknown> & { approval_id: string; status: string }>;
  decideRunApproval(approvalId: string, decision: "approved" | "denied", auth?: RuntimeExecutionAuth): Promise<Record<string, unknown> & { approval_id: string; status: string }>;
  respondAgentApproval(runId: string, approvalId: string, decision: "accept" | "acceptForSession" | "decline" | "cancel"): Promise<void>;
  createRun(request: RuntimeRunRequest, signal?: AbortSignal): Promise<RuntimeRunStream>;
  executeOWOP<K extends OWOPOperation>(workspaceId: string, operation: K, params: OWOPParamsByOperation[K]): Promise<Record<string, unknown>>;
  requestFiles<T>(workspaceId: string, endpoint: string, init?: RequestInit): Promise<T>;
  requestGit<T>(workspaceId: string, endpoint: string, init?: RequestInit): Promise<T>;
  ptyEndpoint(): string;
  getMobilePairingReadiness(): Promise<DesktopMobilePairingReadiness>;
  createMobilePairingGrant(scope?: DesktopMobilePairingScope): Promise<DesktopMobilePairingGrant>;
  getMobilePairingGrant(grantId: string): Promise<DesktopMobilePairingGrant>;
  revokeMobilePairingGrant(grantId: string): Promise<DesktopMobilePairingGrant>;
  listMobileAssociations(): Promise<DesktopMobileAssociation[]>;
  revokeMobileAssociation(associationId: string): Promise<DesktopMobileAssociation>;
  shrinkMobileAssociation(
    associationId: string,
    permissions: DesktopMobileAssociation["permissions"],
    scope?: DesktopMobilePairingScope,
  ): Promise<DesktopMobileAssociation>;
  revokeMobileRuntimeEnrollment(): Promise<DesktopRuntimeEnrollmentRevocation>;
  pauseMobileRemoteAccess(): Promise<DesktopRuntimeRemoteAccessState>;
  resumeMobileRemoteAccess(): Promise<DesktopRuntimeRemoteAccessState>;
  getMobileRemoteDiagnostics(): Promise<DesktopMobileRemoteDiagnostics>;
}

export interface RuntimeAccess {
  baseUrl: string;
  headers: Record<string, string>;
  identity?: {
    location?: RuntimeLocation;
    routeId?: string;
    runtimeId?: string;
    instanceId?: string;
    authGeneration?: string;
  };
}

/**
 * Promote a transport/route identity with the identity returned by /v1/runtime.
 * Keeping this pure makes reconnect and restart behaviour independently testable.
 */
export function promoteRuntimeAccess(access: RuntimeAccess, runtime: RuntimeIdentity): RuntimeAccess {
  return {
    ...access,
    headers: { ...access.headers },
    identity: {
      ...access.identity,
      runtimeId: runtime.runtime_id,
      instanceId: runtime.instance_id,
    },
  };
}

export interface RuntimeExecutionAuth {
  authMode: "password" | "api_key" | "sso" | "oidc" | "offline";
  accessToken?: string;
  userId: string;
}

export class RuntimeProtocolCompatibilityError extends Error {
  constructor(readonly received: number) {
    super(`Runtime protocol ${received} is incompatible with Desktop protocol ${REMOTE_SSH_PROTOCOL_VERSION}.`);
    this.name = "RuntimeProtocolCompatibilityError";
  }
}

export class RuntimeClientGenerationInvalidatedError extends Error {
  readonly code = "runtime_client_generation_invalidated";
  readonly retryable = false;
  constructor() {
    super("Runtime connection generation changed; reconnect using the current Runtime endpoint.");
    this.name = "RuntimeClientGenerationInvalidatedError";
  }
}

abstract class HttpRuntimeClient implements RuntimeClient {
  abstract readonly location: RuntimeLocation;
  readonly streamIdentity: string;
  private readonly lifecycle = new AbortController();
  private lifecycleStateValue: "active" | "invalidated" | "disposed" = "active";

  constructor(protected readonly access: RuntimeAccess) {
    this.streamIdentity = runtimeAccessIdentity(access);
  }

  get lifecycleState(): "active" | "invalidated" | "disposed" { return this.lifecycleStateValue; }

  invalidate(): void {
    if (this.lifecycleStateValue !== "active") return;
    this.lifecycleStateValue = "invalidated";
    if (!this.lifecycle.signal.aborted) this.lifecycle.abort(new RuntimeClientGenerationInvalidatedError());
  }

  close(): void {
    if (this.lifecycleStateValue === "disposed") return;
    if (this.lifecycleStateValue === "active" && !this.lifecycle.signal.aborted) {
      this.lifecycle.abort(new RuntimeClientGenerationInvalidatedError());
    }
    this.lifecycleStateValue = "disposed";
  }

  async getRuntime(): Promise<RuntimeIdentity> {
    const identity = await this.requestJson<RuntimeIdentity>("/v1/runtime");
    this.assertProtocol(identity.protocol_version);
    return identity;
  }

  async getCapabilities(): Promise<RuntimeCapabilities> {
    const capabilities = await this.requestJson<RuntimeCapabilities>("/v1/capabilities");
    this.assertProtocol(capabilities.protocol_version);
    return capabilities;
  }

  getBackendAccount(backendId: string, refresh = false): Promise<BackendAccountStatus> {
    return this.requestJson(`/v1/agent-backends/${this.backendId(backendId)}/account?refresh=${refresh ? "true" : "false"}`);
  }

  startBackendLogin(backendId: string, type: "chatgpt" | "chatgptDeviceCode" = "chatgpt"): Promise<BackendLoginStart> {
    return this.requestJson(`/v1/agent-backends/${this.backendId(backendId)}/account/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type }),
    });
  }

  async cancelBackendLogin(backendId: string, loginId: string): Promise<void> {
    await this.requestJson(`/v1/agent-backends/${this.backendId(backendId)}/account/login/cancel`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login_id: loginId }),
    });
  }

  async logoutBackend(backendId: string): Promise<void> {
    await this.requestJson(`/v1/agent-backends/${this.backendId(backendId)}/account/logout`, { method: "POST" });
  }

  openWorkspace(path: string, displayName?: string): Promise<RuntimeWorkspace> {
    return this.requestJson("/v1/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, ...(displayName ? { display_name: displayName } : {}) }),
    });
  }

  updateWorkspaceDisplayName(workspaceId: string, displayName: string): Promise<RuntimeWorkspace> {
    this.assertResourceId("Workspace", workspaceId);
    return this.requestJson(`/v1/workspaces/${encodeURIComponent(workspaceId)}/display-name`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: displayName }),
    });
  }

  async listWorkspaces(includeClosed = false): Promise<RuntimeWorkspace[]> {
    const result = await this.requestJson<{ data?: RuntimeWorkspace[] }>(`/v1/workspaces?include_closed=${includeClosed ? "true" : "false"}`);
    return result.data ?? [];
  }

  closeWorkspace(workspaceId: string): Promise<RuntimeWorkspace> {
    return this.requestJson(`/v1/workspaces/${encodeURIComponent(workspaceId)}`, { method: "DELETE" });
  }

  createWorktree(workspaceId: string, intent: string, idempotencyKey: string): Promise<RuntimeWorktreeCreateResult> {
    this.assertResourceId("Workspace", workspaceId);
    if (!intent.trim() || intent.length > 180) throw new Error("Worktree intent is invalid.");
    if (!idempotencyKey || idempotencyKey.length > 256 || /[\r\n\0]/.test(idempotencyKey)) throw new Error("Worktree idempotency key is invalid.");
    return this.requestJson(`/v1/workspaces/${encodeURIComponent(workspaceId)}/worktrees`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ intent, idempotency_key: idempotencyKey, location: this.location }),
    });
  }

  async adoptWorktree(workspaceId: string, request: { idempotencyKey: string; canonicalPath: string; branch: string; baseRef: string }): Promise<RuntimeWorktree> {
    this.assertResourceId("Workspace", workspaceId);
    this.assertIdempotencyKey(request.idempotencyKey);
    const result = await this.requestJson<{ worktree: RuntimeWorktree }>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/worktrees/adopt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotency_key: request.idempotencyKey,
          canonical_path: request.canonicalPath,
          branch: request.branch,
          base_ref: request.baseRef,
          location: this.location,
        }),
      },
    );
    return result.worktree;
  }

  async listWorktrees(workspaceId: string, includeRemoved = false, auth?: RuntimeExecutionAuth): Promise<RuntimeWorktree[]> {
    this.assertResourceId("Workspace", workspaceId);
    const result = await this.requestJson<{ worktrees?: RuntimeWorktree[] }>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/worktrees?include_removed=${includeRemoved ? "true" : "false"}`,
      { headers: this.runtimeEvidenceHeaders(auth) },
    );
    return result.worktrees ?? [];
  }

  async listWorkspaceEvents(workspaceId: string, afterSequence = 0, auth?: RuntimeExecutionAuth): Promise<{ events: RuntimeWorkspaceEvent[]; nextSequence: number }> {
    this.assertResourceId("Workspace", workspaceId);
    const cursor = Math.max(0, Math.trunc(afterSequence));
    const result = await this.requestJson<{ events?: RuntimeWorkspaceEvent[]; next_sequence?: number }>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/events?after_sequence=${cursor}`,
      { headers: this.runtimeEvidenceHeaders(auth) },
    );
    return { events: result.events ?? [], nextSequence: result.next_sequence ?? cursor };
  }

  async describeWorktree(workspaceId: string, worktreeId: string): Promise<RuntimeWorktree> {
    const result = await this.worktreeRequest<{ worktree: RuntimeWorktree }>(workspaceId, worktreeId);
    return result.worktree;
  }

  async mergeWorktree(workspaceId: string, worktreeId: string, idempotencyKey: string, expectedHead?: string): Promise<RuntimeWorktree> {
    this.assertIdempotencyKey(idempotencyKey);
    const result = await this.worktreeRequest<{ worktree: RuntimeWorktree }>(workspaceId, worktreeId, "/merge", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotency_key: idempotencyKey, ...(expectedHead ? { expected_head: expectedHead } : {}) }),
    });
    return result.worktree;
  }

  async archiveWorktree(workspaceId: string, worktreeId: string, idempotencyKey: string): Promise<RuntimeWorktree> {
    this.assertIdempotencyKey(idempotencyKey);
    const result = await this.worktreeRequest<{ worktree: RuntimeWorktree }>(workspaceId, worktreeId, "/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotency_key: idempotencyKey }) });
    return result.worktree;
  }

  async removeWorktree(workspaceId: string, worktreeId: string, expectedStatus: "merged" | "archived", idempotencyKey: string): Promise<RuntimeWorktree> {
    this.assertIdempotencyKey(idempotencyKey);
    const result = await this.worktreeRequest<{ worktree: RuntimeWorktree }>(workspaceId, worktreeId, "", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_status: expectedStatus, idempotency_key: idempotencyKey }),
    });
    return result.worktree;
  }

  listSessions(workspaceId: string): Promise<RuntimeSessionList> {
    return this.requestJson(`/v1/sessions?workspace_id=${encodeURIComponent(workspaceId)}&limit=100`);
  }

  getSession(sessionId: string): Promise<RuntimeSession> {
    this.assertResourceId("Session", sessionId);
    return this.requestJson(`/v1/sessions/${encodeURIComponent(sessionId)}`);
  }

  async openWorkspaceSessionCatalogStream(
    workspaceId: string,
    signal: AbortSignal,
  ): Promise<RuntimeWorkspaceSessionCatalogStream> {
    this.assertResourceId("Workspace", workspaceId);
    const response = await this.request(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/session-catalog-events/stream`,
      { headers: { Accept: "text/event-stream" }, signal },
    );
    if (!response.body) throw new Error("Runtime Workspace did not return a Session catalog stream.");
    return { response, events: response.body };
  }

  createSession(workspaceId: string, title = "New session"): Promise<RuntimeSession> {
    return this.requestJson("/v1/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: workspaceId, title }) });
  }

  updateSession(sessionId: string, updates: { archived?: boolean; title?: string }): Promise<RuntimeSession> {
    return this.requestJson(`/v1/sessions/${encodeURIComponent(sessionId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
  }

  getConversationSnapshot(sessionId: string): Promise<RuntimeConversationSnapshot> {
    this.assertResourceId("Session", sessionId);
    return this.requestJson(`/v1/sessions/${encodeURIComponent(sessionId)}/conversation-snapshot`);
  }

  listSessionEvents(sessionId: string, afterSequence = 0, limit = 500): Promise<RuntimeSessionEventPage> {
    this.assertResourceId("Session", sessionId);
    const cursor = Math.max(0, Math.trunc(afterSequence));
    const pageSize = Math.max(1, Math.min(2000, Math.trunc(limit)));
    return this.requestJson(
      `/v1/sessions/${encodeURIComponent(sessionId)}/events?after_sequence=${cursor}&limit=${pageSize}`,
    );
  }

  async openSessionEventStream(
    sessionId: string,
    afterSequence: number,
    signal: AbortSignal,
  ): Promise<RuntimeSessionEventStream> {
    this.assertResourceId("Session", sessionId);
    const cursor = Math.max(0, Math.trunc(afterSequence));
    const response = await this.request(
      `/v1/sessions/${encodeURIComponent(sessionId)}/events/stream?after_sequence=${cursor}`,
      { headers: { Accept: "text/event-stream" }, signal },
    );
    if (!response.body) throw new Error("Runtime Session did not return an Event stream.");
    return { response, events: response.body };
  }

  importLegacyDesktopAgentRun(request: LegacyDesktopAgentRunMigrationRequest): Promise<LegacyDesktopAgentRunMigrationResult> {
    return this.requestJson("/v1/migrations/legacy-desktop-agent-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  }

  getBackendModels(backendId: string, refresh = false): Promise<BackendModelCatalog> {
    return this.requestJson(`/v1/agent-backends/${this.backendId(backendId)}/models?refresh=${refresh ? "true" : "false"}`);
  }

  restartBackend(backendId: string): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/agent-backends/${this.backendId(backendId)}/restart`, { method: "POST" });
  }

  syncBackendSessions(workspaceId: string, backendId: string, signal?: AbortSignal): Promise<RuntimeBackendSessionSyncResult> {
    this.assertResourceId("Workspace", workspaceId);
    return this.requestJson(`/v1/workspaces/${encodeURIComponent(workspaceId)}/agent-backends/${this.backendId(backendId)}/sessions/sync`, { method: "POST", signal });
  }

  syncBackendSessionHistory(sessionId: string, signal?: AbortSignal, repair = false, cursor?: string, limit = 100): Promise<{ session_id: string; backend_id: string; imported: number; total: number; runs?: number; warnings?: number; mapping_version?: string; next_cursor?: string | null; estimated_total?: number; truncated?: boolean; loaded_runs?: number }> {
    const query = new URLSearchParams({ limit: String(Math.max(1, Math.min(500, Math.trunc(limit)))) });
    if (repair) query.set("repair", "true");
    if (cursor) query.set("cursor", cursor);
    return this.requestJson(`/v1/sessions/${encodeURIComponent(sessionId)}/agent-backend/history/sync?${query}`, { method: "POST", signal });
  }

  getBackendSessionBinding(sessionId: string): Promise<RuntimeBackendSessionBindingStatus> {
    this.assertResourceId("Session", sessionId);
    return this.requestJson(`/v1/sessions/${encodeURIComponent(sessionId)}/agent-backend/binding`);
  }

  async getOaepSnapshot(sessionId: string): Promise<OaepSnapshot> {
    this.assertResourceId("Session", sessionId);
    const snapshot = await this.requestJson<OaepSnapshot>(`/v1/sessions/${encodeURIComponent(sessionId)}/oaep-snapshot`);
    assertOaepSnapshotIntegrity(snapshot);
    return snapshot;
  }

  listOaepEvents(sessionId: string, afterSequence = 0, limit = 500): Promise<OaepEventPage> {
    this.assertResourceId("Session", sessionId);
    const cursor = Math.max(0, Math.trunc(afterSequence));
    const pageSize = Math.max(1, Math.min(2000, Math.trunc(limit)));
    return this.requestJson(
      `/v1/sessions/${encodeURIComponent(sessionId)}/oaep-events?after_sequence=${cursor}&limit=${pageSize}`,
    );
  }

  async openOaepEventStream(
    sessionId: string,
    afterSequence: number,
    signal: AbortSignal,
  ): Promise<OaepEventStream> {
    this.assertResourceId("Session", sessionId);
    const cursor = Math.max(0, Math.trunc(afterSequence));
    const response = await this.request(
      `/v1/sessions/${encodeURIComponent(sessionId)}/oaep-events/stream?after_sequence=${cursor}`,
      { headers: { Accept: "text/event-stream" }, signal },
    );
    if (!response.body) throw new Error("Runtime Session did not return an OAEP Event stream.");
    return { response, events: response.body };
  }

  getAgentRun(runId: string): Promise<RuntimeAgentRun> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}`);
  }

  createAgentRun(sessionId: string, agentDefinition: string, idempotencyKey: string): Promise<RuntimeAgentRun> {
    if (process.env.OPENDRSAI_PACKAGED_CHAT_RECOVERY_FIXTURE === "1" && idempotencyKey === "desktop-runtime-packaged_chat_crash_001") {
      return Promise.resolve({ run_id: "packaged-runtime-crash-run", session_id: sessionId, workspace_id: "packaged-runtime-workspace", backend_id: agentDefinition, status: "running" });
    }
    if (process.env.OPENDRSAI_PACKAGED_CHAT_RECOVERY_FIXTURE === "1" && idempotencyKey === "desktop-runtime-packaged_chat_recovery_001") {
      return Promise.resolve({ run_id: "packaged-runtime-recovery-run", session_id: sessionId, workspace_id: "packaged-runtime-workspace", backend_id: agentDefinition, status: "running" });
    }
    return this.requestJson(`/v1/sessions/${encodeURIComponent(sessionId)}/runs`, { method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ agent_definition: agentDefinition }) });
  }

  async getAgentRunByIdempotency(sessionId: string, idempotencyKey: string): Promise<RuntimeAgentRun | null> {
    this.assertResourceId("Session", sessionId);
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new Error("Run idempotency key is invalid.");
    try {
      return await this.requestJson(
        `/v1/sessions/${encodeURIComponent(sessionId)}/runs/by-idempotency/${encodeURIComponent(idempotencyKey)}`,
      );
    } catch (error) {
      if (error instanceof RemoteProtocolError && error.status === 404) return null;
      throw error;
    }
  }

  getRunGoal(runId: string): Promise<RuntimeGoal> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/goal`);
  }

  proposeRunGoal(runId: string, prompt: string, materials: string[], expectedVersion = 0, clarifications: Record<string, string> = {}): Promise<RuntimeGoalProposal> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/goal/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, materials, expected_version: expectedVersion, clarifications }),
    });
  }

  reviseRunGoal(runId: string, goal: RuntimeGoal["goal"], expectedVersion: number): Promise<RuntimeGoal> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/goal`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_version: expectedVersion, goal }),
    });
  }

  confirmRunGoal(runId: string, version: number): Promise<RuntimeGoal> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/goal/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
    });
  }

  executeAgentRun(
    runId: string,
    prompt: string,
    signal?: AbortSignal,
    provenance?: { sourceClient: "windows" | "android"; sourceMessageId: string; attachmentRefs?: string[]; inputResources?: OaepInputResource[]; model?: string; modelSelection?: RuntimeModelRef; metadata?: Record<string, unknown> },
    auth?: RuntimeExecutionAuth,
  ): Promise<{ run: RuntimeAgentRun; result: unknown }> {
    if (process.env.OPENDRSAI_PACKAGED_CHAT_RECOVERY_FIXTURE === "1" && provenance?.sourceMessageId === "desktop:packaged_chat_crash_001") {
      packagedRecoveryRuns.set(runId, { failures: 0, events: [{ event_id: `fixture-${runId}-1`, run_id: runId, sequence: 1, type: "agent.message.delta", data: { text: "preserved before crash" } }] });
      return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Packaged crash fixture aborted.", "AbortError")), { once: true }));
    }
    if (process.env.OPENDRSAI_PACKAGED_CHAT_RECOVERY_FIXTURE === "1" && provenance?.sourceMessageId === "desktop:packaged_chat_recovery_001") {
      packagedRecoveryRuns.set(runId, { failures: 1, events: [
        { event_id: `fixture-${runId}-1`, run_id: runId, sequence: 1, type: "agent.message.delta", data: { text: "alpha" } },
        { event_id: `fixture-${runId}-2`, run_id: runId, sequence: 2, type: "agent.message.delta", data: { text: " beta" } },
        { event_id: `fixture-${runId}-3`, run_id: runId, sequence: 3, type: "run.completed", data: {} },
      ] });
      return new Promise((resolve) => setTimeout(() => resolve({ run: { run_id: runId } as RuntimeAgentRun, result: { fixture: "runtime-event-poll-recovery" } }), 250));
    }
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/execute`, { method: "POST", signal,
      headers: {
        "Content-Type": "application/json",
        ...(auth ? {
          ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
          "X-OpenDrSai-Auth-Mode": auth.authMode,
          "X-OpenDrSai-Principal": auth.userId,
        } : {}),
      }, body: JSON.stringify({
        prompt,
        ...(auth ? { user_id: auth.userId } : {}),
        ...(provenance?.modelSelection
          ? { model_selection: provenance.modelSelection }
          : provenance?.model
            ? { model: provenance.model }
            : {}),
        ...(typeof provenance?.metadata?.reasoning_effort === "string"
          ? { reasoning_effort: provenance.metadata.reasoning_effort }
          : {}),
        metadata: provenance ? {
          ...(provenance.metadata ?? {}),
          source_client: provenance.sourceClient,
          source_message_id: provenance.sourceMessageId,
          attachment_refs: provenance.attachmentRefs ?? [],
          input_resources: provenance.inputResources ?? [],
        } : {},
      }) });
  }

  cancelAgentRun(runId: string): Promise<RuntimeAgentRun> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
  }

  async listAgentRunEvents(runId: string, afterSequence = 0): Promise<RuntimeAgentEvent[]> {
    const fixture = packagedRecoveryRuns.get(runId);
    if (fixture?.failures) { fixture.failures -= 1; throw new Error("Packaged Runtime event poll network interruption."); }
    if (fixture) return fixture.events.filter((event) => event.sequence > afterSequence);
    if (process.env.OPENDRSAI_PACKAGED_CHAT_RECOVERY_FIXTURE === "1" && runId === "packaged-runtime-crash-run") return [
      { event_id: `fixture-${runId}-1`, run_id: runId, sequence: 1, type: "agent.message.delta", data: { text: "preserved before crash" } },
      { event_id: `fixture-${runId}-2`, run_id: runId, sequence: 2, type: "run.failed", data: { reason: "desktop_process_crash" } },
    ].filter((event) => event.sequence > afterSequence);
    const result = await this.requestJson<{ data?: RuntimeAgentEvent[] }>(`/v1/runs/${encodeURIComponent(runId)}/events?after_sequence=${afterSequence}`);
    return result.data ?? [];
  }

  async listRunSideEffects(runId: string): Promise<RuntimeSideEffect[]> {
    const result = await this.requestJson<{ data?: RuntimeSideEffect[] }>(`/v1/runs/${encodeURIComponent(runId)}/side-effects`);
    return result.data ?? [];
  }

  getAgentRunDiagnostics(runId: string): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/diagnostics`);
  }

  listSessionRuns(sessionId: string, cursor?: string, limit = 100, status?: string, auth?: RuntimeExecutionAuth): Promise<SessionRunList> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set("cursor", cursor);
    if (status) query.set("status", status);
    return this.requestJson(`/v1/sessions/${encodeURIComponent(sessionId)}/runs?${query}`, { headers: this.runtimeEvidenceHeaders(auth, { sessionId }) });
  }

  getRunInspection(runId: string, cursor?: string, limit = 100, itemType?: string, status?: string, auth?: RuntimeExecutionAuth): Promise<RunInspection> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set("timeline_cursor", cursor);
    if (itemType) query.set("type", itemType);
    if (status) query.set("status", status);
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/inspection?${query}`, { headers: this.runtimeEvidenceHeaders(auth, { runId }) });
  }

  locateRunItem(runId: string, itemId: string, itemType?: string, status?: string, auth?: RuntimeExecutionAuth): Promise<RunItemLocator> {
    const query = new URLSearchParams();
    if (itemType) query.set("type", itemType);
    if (status) query.set("status", status);
    const suffix = query.size ? `?${query}` : "";
    return this.requestJson(
      `/v1/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/locator${suffix}`,
      { headers: this.runtimeEvidenceHeaders(auth, { runId }) },
    );
  }

  getRunReproductionManifest(runId: string, auth?: RuntimeExecutionAuth): Promise<RunReproductionManifest> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/reproduction-manifest`, { headers: this.runtimeEvidenceHeaders(auth, { runId }) });
  }

  exportRunReproductionManifest(runId: string, auth?: RuntimeExecutionAuth): Promise<RunReproductionManifest> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/reproduction-manifest/export`, { headers: this.runtimeEvidenceHeaders(auth, { runId }) });
  }

  createRunExperiment(runId: string, request: { idempotencyKey: string; title?: string; forkedFromItemId?: string; replayMode?: ReplayMode }, auth?: RuntimeExecutionAuth): Promise<RunExperiment> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/experiments`, {
      method: "POST",
      headers: { ...this.runtimeEvidenceHeaders(auth, { runId }), "Content-Type": "application/json", "Idempotency-Key": request.idempotencyKey },
      body: JSON.stringify({ title: request.title, forked_from_item_id: request.forkedFromItemId, replay_mode: request.replayMode }),
    });
  }

  getRunExperimentCapabilities(runId: string, auth?: RuntimeExecutionAuth): Promise<RunExperimentCapabilities> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/experiment-capabilities`, {
      headers: this.runtimeEvidenceHeaders(auth),
    });
  }

  finalizeRunExperimentCandidate(experimentId: string, approvalId?: string, auth?: RuntimeExecutionAuth): Promise<RunExperimentCandidateSnapshot> {
    return this.requestJson(`/v1/experiments/${encodeURIComponent(experimentId)}/candidate-snapshot`, {
      method: "POST", headers: {
        ...this.runtimeEvidenceHeaders(auth),
        ...(approvalId ? { "X-OpenDrSai-Approval-ID": approvalId } : {}),
      },
    });
  }

  getRunExperiment(experimentId: string, auth?: RuntimeExecutionAuth): Promise<RunExperiment> {
    return this.requestJson(`/v1/experiments/${encodeURIComponent(experimentId)}`, { headers: this.runtimeEvidenceHeaders(auth) });
  }

  updateRunExperiment(experimentId: string, request: { expectedVersion: number; idempotencyKey: string; patch: { title?: string; overrides?: RunExperimentOverrides; replay_mode?: ReplayMode } }, auth?: RuntimeExecutionAuth): Promise<RunExperiment> {
    return this.requestJson(`/v1/experiments/${encodeURIComponent(experimentId)}`, {
      method: "PATCH",
      headers: { ...this.runtimeEvidenceHeaders(auth), "Content-Type": "application/json", "Idempotency-Key": request.idempotencyKey },
      body: JSON.stringify({ expected_version: request.expectedVersion, ...request.patch }),
    });
  }

  async deleteRunExperiment(experimentId: string, auth?: RuntimeExecutionAuth): Promise<void> {
    await this.request(`/v1/experiments/${encodeURIComponent(experimentId)}`, { method: "DELETE", headers: this.runtimeEvidenceHeaders(auth) });
  }

  exportRunExperimentPackage(experimentId: string, auth?: RuntimeExecutionAuth): Promise<RunExperimentPackage> {
    return this.requestJson(`/v1/experiments/${encodeURIComponent(experimentId)}/export`, {
      headers: this.runtimeEvidenceHeaders(auth),
    });
  }

  createReplayPlan(experimentId: string, request: { expectedDraftVersion: number; expiresInSeconds?: number; availability?: Record<string, unknown> }, auth?: RuntimeExecutionAuth): Promise<ReplayPlan> {
    return this.requestJson(`/v1/experiments/${encodeURIComponent(experimentId)}/plan`, {
      method: "POST", headers: { ...this.runtimeEvidenceHeaders(auth), "Content-Type": "application/json" },
      body: JSON.stringify({ expected_draft_version: request.expectedDraftVersion, expires_in_seconds: request.expiresInSeconds, availability: request.availability || {} }),
    });
  }

  getReplayPlan(replayPlanId: string, auth?: RuntimeExecutionAuth): Promise<ReplayPlan> {
    return this.requestJson(`/v1/replay-plans/${encodeURIComponent(replayPlanId)}`, { headers: this.runtimeEvidenceHeaders(auth) });
  }

  getReplayBoundaries(runId: string, auth?: RuntimeExecutionAuth): Promise<ReplayBoundaries> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/replay-boundaries`, { headers: this.runtimeEvidenceHeaders(auth, { runId }) });
  }

  getRunRelations(runId: string, auth?: RuntimeExecutionAuth): Promise<RunRelations> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/relations`, { headers: this.runtimeEvidenceHeaders(auth, { runId }) });
  }

  executeReplayPlan(replayPlanId: string, request: { draftVersion: number; planDigest: string; baseManifestDigest: string; idempotencyKey: string; approvalId?: string; runtimeApprovalId?: string; isolatedWorktreeId?: string }, auth?: RuntimeExecutionAuth): Promise<ReplayExecutionResult> {
    return this.requestJson(`/v1/replay-plans/${encodeURIComponent(replayPlanId)}/execute`, {
      method: "POST",
      headers: {
        ...this.runtimeEvidenceHeaders(auth), "Content-Type": "application/json",
        "Idempotency-Key": request.idempotencyKey,
        ...(request.approvalId ? { "X-OpenDrSai-Approval-ID": request.approvalId } : {}),
      },
      body: JSON.stringify({
        draft_version: request.draftVersion, plan_digest: request.planDigest,
        base_manifest_digest: request.baseManifestDigest, approval_id: request.approvalId,
        runtime_approval_id: request.runtimeApprovalId,
        isolated_worktree_id: request.isolatedWorktreeId, location: this.location,
      }),
    });
  }

  getRunApproval(approvalId: string, auth?: RuntimeExecutionAuth): Promise<Record<string, unknown> & { approval_id: string; status: string }> {
    return this.requestJson(`/v1/approvals/${encodeURIComponent(approvalId)}`, {
      headers: this.runtimeEvidenceHeaders(auth),
    });
  }

  async decideRunApproval(approvalId: string, decision: "approved" | "denied", auth?: RuntimeExecutionAuth): Promise<Record<string, unknown> & { approval_id: string; status: string }> {
    try {
      return await this.requestJson(`/v1/approvals/${encodeURIComponent(approvalId)}/decision`, {
        method: "POST", headers: { ...this.runtimeEvidenceHeaders(auth), "Content-Type": "application/json" },
        body: JSON.stringify({ decision, detail: { idempotency_key: `desktop:${approvalId}:${decision}` } }),
      });
    } catch (failure) {
      if (!this.isUncertainMutationFailure(failure)) throw failure;
      const recovered = await this.recoverApprovalOutcome(approvalId, auth);
      if (recovered) return recovered;
      throw failure;
    }
  }

  createRunComparison(baselineRunId: string, candidateRunId: string, auth?: RuntimeExecutionAuth): Promise<RunComparison> {
    return this.requestJson("/v1/run-comparisons", {
      method: "POST", headers: { ...this.runtimeEvidenceHeaders(auth, { runId: baselineRunId }), "Content-Type": "application/json" },
      body: JSON.stringify({ baseline_run_id: baselineRunId, candidate_run_id: candidateRunId }),
    });
  }

  getRunComparison(comparisonId: string, auth?: RuntimeExecutionAuth): Promise<RunComparison> {
    return this.requestJson(`/v1/run-comparisons/${encodeURIComponent(comparisonId)}`, { headers: this.runtimeEvidenceHeaders(auth) });
  }

  listRunComparisonEvaluations(comparisonId: string, auth?: RuntimeExecutionAuth): Promise<RunComparisonEvaluationList> {
    return this.requestJson(`/v1/run-comparisons/${encodeURIComponent(comparisonId)}/evaluations`, { headers: this.runtimeEvidenceHeaders(auth) });
  }

  createRunComparisonEvaluation(request: CreateRunComparisonEvaluationRequest, auth?: RuntimeExecutionAuth): Promise<RunComparisonEvaluation> {
    return this.requestJson(`/v1/run-comparisons/${encodeURIComponent(request.comparisonId)}/evaluations`, {
      method: "POST",
      headers: { ...this.runtimeEvidenceHeaders(auth), "Content-Type": "application/json", "Idempotency-Key": request.idempotencyKey },
      body: JSON.stringify({
        expected_latest_revision: request.expectedLatestRevision,
        verdict: request.verdict,
        scores: request.scores,
        note: request.note || "",
        evidence_refs: request.evidenceRefs || [],
      }),
    });
  }

  getWorktreeAdoptionPreview(sourceWorkspaceId: string, worktreeId: string, auth?: RuntimeExecutionAuth): Promise<WorktreeAdoptionPreview> {
    return this.requestJson(`/v1/workspaces/${encodeURIComponent(sourceWorkspaceId)}/worktrees/${encodeURIComponent(worktreeId)}/adoption-preview`, { headers: this.runtimeEvidenceHeaders(auth) });
  }

  applyWorktreeAdoption(sourceWorkspaceId: string, worktreeId: string, request: { previewDigest: string; selectedPaths: string[]; approvalId: string }, auth?: RuntimeExecutionAuth): Promise<WorktreeAdoptionApplyResult> {
    return this.requestJson(`/v1/workspaces/${encodeURIComponent(sourceWorkspaceId)}/worktrees/${encodeURIComponent(worktreeId)}/adoption-apply`, {
      method: "POST",
      headers: { ...this.runtimeEvidenceHeaders(auth), "Content-Type": "application/json", "X-OpenDrSai-Approval-ID": request.approvalId },
      body: JSON.stringify({ preview_digest: request.previewDigest, selected_paths: request.selectedPaths }),
    });
  }

  getRunAdoptionPreview(comparisonId: string, auth?: RuntimeExecutionAuth): Promise<RunAdoption> {
    return this.requestJson(`/v1/run-comparisons/${encodeURIComponent(comparisonId)}/adoption-preview`, { headers: this.runtimeEvidenceHeaders(auth) });
  }

  applyRunAdoption(adoptionId: string, selectedPaths: string[], approvalId?: string, auth?: RuntimeExecutionAuth): Promise<RunAdoption> {
    return this.requestJson(`/v1/adoptions/${encodeURIComponent(adoptionId)}/apply`, {
      method: "POST", headers: { ...this.runtimeEvidenceHeaders(auth), "Content-Type": "application/json", ...(approvalId ? { "X-OpenDrSai-Approval-ID": approvalId } : {}) },
      body: JSON.stringify({ selected_paths: selectedPaths }),
    });
  }

  discardRunAdoption(adoptionId: string, cleanup: boolean, approvalId?: string, auth?: RuntimeExecutionAuth): Promise<RunAdoption> {
    return this.requestJson(`/v1/adoptions/${encodeURIComponent(adoptionId)}/discard`, {
      method: "POST", headers: { ...this.runtimeEvidenceHeaders(auth), "Content-Type": "application/json", ...(approvalId ? { "X-OpenDrSai-Approval-ID": approvalId } : {}) },
      body: JSON.stringify({ cleanup }),
    });
  }

  decideSecurityApproval(approvalId: string, decision: "approved" | "denied", auth?: RuntimeExecutionAuth): Promise<{ approval_id: string; decision: string }> {
    return this.requestJson(`/v1/security/approvals/${encodeURIComponent(approvalId)}/decision`, {
      method: "POST", headers: { ...this.runtimeEvidenceHeaders(auth), "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
  }

  private runtimeEvidenceHeaders(auth?: RuntimeExecutionAuth, context?: { sessionId?: string; runId?: string }): Record<string, string> {
    if (!auth) return {};
    return {
      ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
      "X-OpenDrSai-Auth-Mode": auth.authMode,
      "X-OpenDrSai-Principal": auth.userId,
      ...(context?.sessionId ? { "X-OpenDrSai-Session-Id": context.sessionId } : {}),
      ...(context?.runId ? { "X-OpenDrSai-Run-Id": context.runId } : {}),
    };
  }

  async respondAgentApproval(runId: string, approvalId: string, decision: "accept" | "acceptForSession" | "decline" | "cancel"): Promise<void> {
    try {
      await this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }),
      });
    } catch (failure) {
      if (!this.isUncertainMutationFailure(failure)) throw failure;
      if (await this.recoverApprovalOutcome(approvalId)) return;
      throw failure;
    }
  }

  async createRun(request: RuntimeRunRequest, signal?: AbortSignal): Promise<RuntimeRunStream> {
    const requestId = randomUUID();
    const response = await this.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", "Idempotency-Key": requestId },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.body) throw new Error("Runtime Run did not return an Event stream.");
    return { requestId, response, events: response.body };
  }

  async executeOWOP<K extends OWOPOperation>(
    workspaceId: string,
    operation: K,
    params: OWOPParamsByOperation[K],
  ): Promise<Record<string, unknown>> {
    this.assertResourceId("Workspace", workspaceId);
    const requestId = randomUUID();
    const correlationId = randomUUID();
    const response = await this.requestJson<
      | { ok: true; result: Record<string, unknown> }
      | { ok: false; error: { code: string; message: string; correlation_id: string; retryable: boolean; details: Record<string, unknown> } }
    >("/v1/owop", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Correlation-ID": correlationId },
      body: JSON.stringify({
        version: "1.0", request_id: requestId, correlation_id: correlationId,
        workspace_id: workspaceId, operation, params,
        binding: { kind: this.location === "local" ? "local_ipc" : "ssh" },
      }),
    });
    if (!response.ok) {
      throw new RuntimeOWOPError(
        response.error.code, response.error.message, response.error.correlation_id,
        response.error.retryable, response.error.details,
      );
    }
    return response.result;
  }

  requestFiles<T>(workspaceId: string, endpoint: string, init?: RequestInit): Promise<T> {
    return this.workspaceRequest(workspaceId, endpoint, init);
  }

  requestGit<T>(workspaceId: string, endpoint: string, init?: RequestInit): Promise<T> {
    const normalized = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    if (!normalized.startsWith("/git/")) throw new Error("Runtime Git endpoint must start with /git/.");
    return this.workspaceRequest(workspaceId, normalized, init);
  }

  ptyEndpoint(): string {
    return `${this.access.baseUrl.replace(/^http/, "ws")}/v1/pty`;
  }

  getMobilePairingReadiness(): Promise<DesktopMobilePairingReadiness> {
    return this.requestJson("/v1/mobile-pairing/status");
  }

  registerMobilePairingRuntime(input: {
    registrationCode: string;
    relayHttpsUrl: string;
    displayName: string;
  }): Promise<{ registered: true; runtime_id: string }> {
    return this.requestJson("/v1/mobile-pairing/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        registration_code: input.registrationCode,
        relay_https_url: input.relayHttpsUrl,
        display_name: input.displayName,
      }),
    });
  }

  createMobilePairingGrant(scope?: DesktopMobilePairingScope): Promise<DesktopMobilePairingGrant> {
    const selection = scope ?? { workspace_scope: "all" as const, workspace_ids: [] };
    return this.requestJson("/v1/mobile-pairing/grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selection),
    });
  }

  getMobilePairingGrant(grantId: string): Promise<DesktopMobilePairingGrant> {
    return this.requestJson(`/v1/mobile-pairing/grants/${this.pairingGrantId(grantId)}`);
  }

  revokeMobilePairingGrant(grantId: string): Promise<DesktopMobilePairingGrant> {
    return this.requestJson(`/v1/mobile-pairing/grants/${this.pairingGrantId(grantId)}`, { method: "DELETE" });
  }

  async listMobileAssociations(): Promise<DesktopMobileAssociation[]> {
    const result = await this.requestJson<{ items: DesktopMobileAssociation[] }>(
      "/v1/mobile-pairing/associations",
    );
    return result.items;
  }

  revokeMobileAssociation(associationId: string): Promise<DesktopMobileAssociation> {
    this.assertResourceId("Association", associationId);
    return this.requestJson(
      `/v1/mobile-pairing/associations/${encodeURIComponent(associationId)}`,
      { method: "DELETE" },
    );
  }

  revokeMobileRuntimeEnrollment(): Promise<DesktopRuntimeEnrollmentRevocation> {
    return this.requestJson("/v1/mobile-pairing/enrollment", { method: "DELETE" });
  }

  shrinkMobileAssociation(
    associationId: string,
    permissions: DesktopMobileAssociation["permissions"],
    scope?: DesktopMobilePairingScope,
  ): Promise<DesktopMobileAssociation> {
    this.assertResourceId("Association", associationId);
    return this.requestJson(
      `/v1/mobile-pairing/associations/${encodeURIComponent(associationId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions, ...(scope ?? {}) }),
      },
    );
  }

  pauseMobileRemoteAccess(): Promise<DesktopRuntimeRemoteAccessState> {
    return this.requestJson("/v1/mobile-pairing/enrollment/pause", { method: "POST" });
  }

  resumeMobileRemoteAccess(): Promise<DesktopRuntimeRemoteAccessState> {
    return this.requestJson("/v1/mobile-pairing/enrollment/resume", { method: "POST" });
  }

  getMobileRemoteDiagnostics(): Promise<DesktopMobileRemoteDiagnostics> {
    return this.requestJson("/v1/mobile-pairing/diagnostics");
  }

  private workspaceRequest<T>(workspaceId: string, endpoint: string, init?: RequestInit): Promise<T> {
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(workspaceId)) throw new Error("Runtime Workspace ID is invalid.");
    const normalized = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    if (/[\r\n\0]/.test(normalized) || normalized.includes("..")) throw new Error("Runtime Workspace endpoint is invalid.");
    return this.requestJson(`/v1/workspaces/${encodeURIComponent(workspaceId)}${normalized}`, init);
  }

  private backendId(value: string): string {
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(value)) throw new Error("Agent Backend ID is invalid.");
    return encodeURIComponent(value);
  }

  private worktreeRequest<T>(workspaceId: string, worktreeId: string, suffix = "", init?: RequestInit): Promise<T> {
    this.assertResourceId("Workspace", workspaceId);
    this.assertResourceId("Worktree", worktreeId);
    return this.requestJson(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/worktrees/${encodeURIComponent(worktreeId)}${suffix}`,
      init,
    );
  }

  private assertResourceId(label: string, value: string): void {
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(value)) throw new Error(`${label} ID is invalid.`);
  }

  private assertIdempotencyKey(value: string): void {
    if (!value || value.length > 256 || /[\r\n\0]/.test(value)) throw new Error("Worktree idempotency key is invalid.");
  }

  private pairingGrantId(value: string): string {
    if (!/^ag_[0-9a-f]{32}$/.test(value)) throw new Error("Mobile pairing grant ID is invalid.");
    return encodeURIComponent(value);
  }

  protected async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    return response.json() as Promise<T>;
  }

  protected async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (this.lifecycle.signal.aborted) throw new RuntimeClientGenerationInvalidatedError();
    let response: Response;
    try {
      response = await fetch(`${this.access.baseUrl}${path}`, {
        ...init,
        headers: { "X-Correlation-ID": randomUUID(), ...getDiagnosticPropagationHeaders(), ...this.access.headers, ...init.headers },
        signal: AbortSignal.any([this.lifecycle.signal, init.signal ?? AbortSignal.timeout(30_000)]),
      });
    } catch (error) {
      if (this.lifecycle.signal.aborted) throw new RuntimeClientGenerationInvalidatedError();
      throw error;
    }
    if (!response.ok) {
      let body: RemoteProtocolErrorBody | null = null;
      try { body = await response.json() as RemoteProtocolErrorBody; } catch { /* non-JSON failure */ }
      throw parseRemoteProtocolError(response.status, body, response.headers.get("x-correlation-id"));
    }
    return response;
  }

  private isUncertainMutationFailure(failure: unknown): boolean {
    return failure instanceof RemoteProtocolError ? failure.status >= 500 : failure instanceof Error;
  }

  private async recoverApprovalOutcome(
    approvalId: string,
    auth?: RuntimeExecutionAuth,
  ): Promise<(Record<string, unknown> & { approval_id: string; status: string }) | null> {
    for (const delayMs of [0, 100, 250, 500, 1_000]) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        const approval = await this.getRunApproval(approvalId, auth);
        if (["approved", "denied", "cancelled", "expired", "disconnected", "timeout"].includes(approval.status)) {
          return approval;
        }
      } catch (failure) {
        if (!this.isUncertainMutationFailure(failure)) throw failure;
      }
    }
    return null;
  }

  private assertProtocol(received: number): void {
    if (received !== REMOTE_SSH_PROTOCOL_VERSION) throw new RuntimeProtocolCompatibilityError(received);
  }
}

export class LocalRuntimeClient extends HttpRuntimeClient {
  readonly location = "local" as const;

  /** Connect only when a Runtime is already healthy; never spawn one as a
   * side effect of read-only startup discovery. */
  static async connectIfAvailable(): Promise<LocalRuntimeClient | null> {
    const status = await getGatewayStatus();
    if (!status.ready && !status.externalReady) return null;
    try {
      return await LocalRuntimeClient.connect();
    } catch {
      return null;
    }
  }

  static async connect(): Promise<LocalRuntimeClient> {
    const started = await startGateway();
    let status = await getGatewayStatus();
    if (!status.ready && status.managed && status.diagnosticCode === "gateway_probe_timeout") {
      for (const delayMs of [800, 1_200]) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        status = await getGatewayStatus();
        if (status.ready) break;
      }
    }
    if (!status.ready) {
      throw createLocalRuntimeUnavailableErrorFromStatus(status, started ? "health" : "start");
    }
    const access = {
      baseUrl: status.baseUrl,
      headers: getGatewayRequestHeaders(),
      identity: { location: "local" as const, routeId: status.pid ? `pid:${status.pid}` : "persistent" },
    };
    return connectAuthoritativeRuntimeClient(access, (resolvedAccess) => new LocalRuntimeClient(resolvedAccess));
  }

  static forAccess(baseUrl: string, headers: Record<string, string> = {}): LocalRuntimeClient {
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) throw new Error("Local Runtime access must use loopback HTTP.");
    const access = { baseUrl, headers, identity: { location: "local" as const } };
    return registeredRuntimeClient(access, () => new LocalRuntimeClient(access));
  }
}

export class LocalRuntimeUnavailableError extends Error {
  readonly code = "local_runtime_unavailable";
  readonly retryable = true;
  readonly gatewayStatus: GatewayStatus;

  constructor(status: GatewayStatus, phase: "start" | "health") {
    super(localRuntimeUnavailableMessage(status, phase));
    this.name = "LocalRuntimeUnavailableError";
    this.gatewayStatus = status;
  }
}

export function isLocalRuntimeUnavailableError(error: unknown): error is LocalRuntimeUnavailableError {
  return error instanceof LocalRuntimeUnavailableError
    || Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "local_runtime_unavailable");
}

function createLocalRuntimeUnavailableErrorFromStatus(
  status: GatewayStatus,
  phase: "start" | "health",
): LocalRuntimeUnavailableError {
  return new LocalRuntimeUnavailableError(status, phase);
}

function localRuntimeUnavailableMessage(status: GatewayStatus, phase: "start" | "health"): string {
  const code = status.diagnosticCode && status.diagnosticCode !== "gateway_ready"
    ? ` (${status.diagnosticCode})`
    : "";
  const detail = status.diagnosticMessage ? ` ${status.diagnosticMessage}` : "";
  if (status.externalConflict) {
    return `Local Runtime is unavailable${code}: another process is using the Runtime port or rejected this Desktop token.${detail} Stop the other OpenDrSai Runtime or restart Desktop, then retry.`;
  }
  if (status.managed && status.diagnosticCode === "gateway_probe_timeout") {
    return `Local Runtime is temporarily busy${code}.${detail} Desktop will retry without starting another Runtime process.`;
  }
  if (status.managed) {
    return `Local Runtime is unavailable${code}.${detail} Restart the OpenDrSai Runtime, then retry.`;
  }
  return phase === "start"
    ? `Local Runtime could not be started${code}.${detail} Check the Runtime installation, then retry.`
    : `Local Runtime is unavailable${code}.${detail} Check the Runtime installation, then retry.`;
}

export class RemoteRuntimeClient extends HttpRuntimeClient {
  readonly location = "remote" as const;

  constructor(baseUrl: string, token: string, routeId = "", runtimeId?: string, instanceId?: string, authGeneration?: string) {
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) throw new Error("Remote Runtime must use an SSH loopback tunnel.");
    if (!token || /[\r\n\0]/.test(token)) throw new Error("Remote Runtime token is invalid.");
    super({
      baseUrl,
      headers: { "X-OpenDrSai-Gateway-Token": token },
      identity: { location: "remote", routeId, runtimeId, instanceId, authGeneration },
    });
  }
}

interface RuntimeClientRegistryEntry {
  client: RuntimeClient;
  references: number;
  lastUsedAt: number;
  invalidated: boolean;
  disposed: boolean;
}

const runtimeClientRegistry = new Map<string, RuntimeClientRegistryEntry>();
const authoritativeRuntimeConnections = new Map<string, Promise<RuntimeClient>>();
const authoritativeRuntimeClients = new Map<string, RuntimeClient>();
const MAX_REGISTERED_RUNTIME_CLIENTS = 16;

export function createRuntimeEndpointKey(access: RuntimeAccess): string {
  const authentication = Object.entries(access.headers)
    .filter(([name]) => /^(?:authorization|x-opendrsai-gateway-token)$/i.test(name))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name.toLowerCase()}:${value}`)
    .join("\n");
  const endpointMaterial = `${access.identity?.location ?? "runtime"}:${access.baseUrl}`;
  const generationMaterial = JSON.stringify({
    routeId: access.identity?.routeId ?? "",
    runtimeId: access.identity?.runtimeId ?? "",
    instanceId: access.identity?.instanceId ?? "",
    authGeneration: access.identity?.authGeneration ?? createHash("sha256").update(authentication).digest("hex"),
  });
  const endpoint = createHash("sha256").update(endpointMaterial).digest("hex").slice(0, 12);
  const generation = createHash("sha256").update(generationMaterial).digest("hex").slice(0, 16);
  return `runtime:${endpoint}:${generation}`;
}

const runtimeAccessIdentity = createRuntimeEndpointKey;

function disposeRegistryEntry(entry: RuntimeClientRegistryEntry): void {
  if (entry.disposed) return;
  entry.disposed = true;
  const close = (entry.client as RuntimeClient & { close?: () => void }).close;
  if (typeof close === "function") close.call(entry.client);
}

function invalidateRegistryEntry(entry: RuntimeClientRegistryEntry): void {
  if (entry.invalidated) return;
  entry.invalidated = true;
  const invalidate = (entry.client as RuntimeClient & { invalidate?: () => void }).invalidate;
  if (typeof invalidate === "function") invalidate.call(entry.client);
  if (entry.references === 0) disposeRegistryEntry(entry);
}

function runtimeClientLifecycle(client: RuntimeClient): "active" | "invalidated" | "disposed" | undefined {
  const state = (client as RuntimeClient & { lifecycleState?: unknown }).lifecycleState;
  return state === "active" || state === "invalidated" || state === "disposed" ? state : undefined;
}

function trimRuntimeClientRegistry(): void {
  while (runtimeClientRegistry.size > MAX_REGISTERED_RUNTIME_CLIENTS) {
    const candidate = [...runtimeClientRegistry.entries()]
      .filter(([, entry]) => entry.references === 0)
      .sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt)[0];
    if (!candidate) break;
    runtimeClientRegistry.delete(candidate[0]);
    disposeRegistryEntry(candidate[1]);
  }
}

function registeredRuntimeClient<T extends RuntimeClient>(access: RuntimeAccess, create: () => T): T {
  const identity = runtimeAccessIdentity(access);
  const existing = runtimeClientRegistry.get(identity);
  if (existing && !existing.invalidated && !existing.disposed && runtimeClientLifecycle(existing.client) !== "disposed") {
    existing.lastUsedAt = Date.now();
    return existing.client as T;
  }
  const endpointPrefix = identity.slice(0, identity.lastIndexOf(":") + 1);
  for (const [oldIdentity, entry] of runtimeClientRegistry) {
    if (oldIdentity !== identity && oldIdentity.startsWith(endpointPrefix)) {
      runtimeClientRegistry.delete(oldIdentity);
      invalidateRegistryEntry(entry);
    }
  }
  const client = create();
  runtimeClientRegistry.set(identity, { client, references: 0, lastUsedAt: Date.now(), invalidated: false, disposed: false });
  trimRuntimeClientRegistry();
  return client;
}

/**
 * Establishes one provisional client per transport generation, performs the
 * authoritative Runtime handshake once, then registers a client whose stream
 * identity includes runtime_id + instance_id. Concurrent callers share the
 * handshake so one caller cannot invalidate another caller's provisional client.
 */
export async function connectAuthoritativeRuntimeClient<T extends RuntimeClient>(
  access: RuntimeAccess,
  create: (resolvedAccess: RuntimeAccess) => T,
): Promise<T> {
  const provisionalKey = createRuntimeEndpointKey(access);
  const cached = authoritativeRuntimeClients.get(provisionalKey);
  if (cached && runtimeClientLifecycle(cached) === "active") return cached as T;
  if (cached) authoritativeRuntimeClients.delete(provisionalKey);
  const inflight = authoritativeRuntimeConnections.get(provisionalKey);
  if (inflight) return inflight as Promise<T>;

  const connection = (async (): Promise<T> => {
    const provisional = registeredRuntimeClient(access, () => create(access));
    let identity: RuntimeIdentity;
    try {
      identity = await provisional.getRuntime();
    } catch (error) {
      invalidateRuntimeClientRegistry(provisional.streamIdentity);
      throw error;
    }
    const promoted = promoteRuntimeAccess(access, identity);
    if (createRuntimeEndpointKey(promoted) === provisional.streamIdentity) return provisional;
    const authoritative = registeredRuntimeClient(promoted, () => create(promoted));
    authoritativeRuntimeClients.set(provisionalKey, authoritative);
    return authoritative;
  })();
  authoritativeRuntimeConnections.set(provisionalKey, connection);
  try {
    return await connection;
  } finally {
    if (authoritativeRuntimeConnections.get(provisionalKey) === connection) {
      authoritativeRuntimeConnections.delete(provisionalKey);
    }
  }
}

export function retainRuntimeClient(client: RuntimeClient): () => void {
  const identity = client.streamIdentity;
  const lifecycle = runtimeClientLifecycle(client);
  if (lifecycle === "invalidated" || lifecycle === "disposed") {
    throw new RuntimeClientGenerationInvalidatedError();
  }
  let entry = runtimeClientRegistry.get(identity);
  if (entry?.invalidated || entry?.disposed) throw new RuntimeClientGenerationInvalidatedError();
  if (!entry || entry.client !== client) {
    if (entry && entry.client !== client) throw new RuntimeClientGenerationInvalidatedError();
    entry = { client, references: 0, lastUsedAt: Date.now(), invalidated: false, disposed: false };
    runtimeClientRegistry.set(identity, entry);
  }
  entry.references += 1;
  entry.lastUsedAt = Date.now();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry!.references = Math.max(0, entry!.references - 1);
    entry!.lastUsedAt = Date.now();
    if (entry!.references === 0) {
      if (runtimeClientRegistry.get(identity) === entry) runtimeClientRegistry.delete(identity);
      disposeRegistryEntry(entry!);
    }
    trimRuntimeClientRegistry();
  };
}

export function getRuntimeClientRegistryDiagnostics(): Array<{
  endpointKey: string;
  location: RuntimeLocation;
  references: number;
  invalidated: boolean;
  lifecycle: "active" | "invalidated" | "disposed";
}> {
  return [...runtimeClientRegistry.entries()].map(([endpointKey, entry]) => ({
    endpointKey,
    location: entry.client.location,
    references: entry.references,
    invalidated: entry.invalidated,
    lifecycle: runtimeClientLifecycle(entry.client) ?? (entry.disposed ? "disposed" : entry.invalidated ? "invalidated" : "active"),
  }));
}

/** Explicit lifecycle hook for gateway restart, logout, or test isolation. */
export function invalidateRuntimeClientRegistry(streamIdentity?: string): void {
  if (!streamIdentity) {
    authoritativeRuntimeConnections.clear();
    authoritativeRuntimeClients.clear();
  } else {
    for (const [key, client] of authoritativeRuntimeClients) {
      if (client.streamIdentity === streamIdentity) authoritativeRuntimeClients.delete(key);
    }
  }
  const entries = streamIdentity
    ? [...runtimeClientRegistry.entries()].filter(([identity]) => identity === streamIdentity)
    : [...runtimeClientRegistry.entries()];
  for (const [identity, entry] of entries) {
    runtimeClientRegistry.delete(identity);
    invalidateRegistryEntry(entry);
  }
}

export async function connectRuntimeClientForWorkspace(
  workspacePath: string,
  workspaceId?: string,
  workspaceName?: string,
): Promise<{ client: RuntimeClient; workspaceId: string }> {
  const access = workspaceRouting.getRemoteGatewayAccess(workspacePath, workspaceId);
  if (access) {
    const runtimeAccess = {
      baseUrl: access.baseUrl,
      headers: { "X-OpenDrSai-Gateway-Token": access.token },
      identity: { location: "remote" as const, routeId: access.workspaceId, authGeneration: access.authGeneration },
    };
    return {
      client: await connectAuthoritativeRuntimeClient(runtimeAccess, (resolvedAccess) => new RemoteRuntimeClient(
        access.baseUrl,
        access.token,
        access.workspaceId,
        resolvedAccess.identity?.runtimeId,
        resolvedAccess.identity?.instanceId,
        resolvedAccess.identity?.authGeneration,
      )),
      workspaceId: access.workspaceId,
    };
  }
  const persisted = workspaceId ? await workspaceRouting.findWorkspaceById(workspaceId) : undefined;
  if (persisted?.location === "remote") {
    throw new Error("Remote Workspace is offline; Runtime operation refused without local fallback (stale cache is read-only).");
  }
  const client = await LocalRuntimeClient.connect();
  return resolveLocalRuntimeWorkspace(client, workspacePath, workspaceId, persisted?.name ?? workspaceName, Boolean(persisted));
}

/** Resolve an already-running Runtime for read-only restoration work without
 * spawning the local Gateway. Callers can fall back to persisted Desktop data
 * when this returns null. */
export async function connectRuntimeClientForWorkspaceIfAvailable(
  workspacePath: string,
  workspaceId?: string,
  workspaceName?: string,
): Promise<{ client: RuntimeClient; workspaceId: string } | null> {
  const access = workspaceRouting.getRemoteGatewayAccess(workspacePath, workspaceId);
  if (access) {
    const runtimeAccess = {
      baseUrl: access.baseUrl,
      headers: { "X-OpenDrSai-Gateway-Token": access.token },
      identity: { location: "remote" as const, routeId: access.workspaceId, authGeneration: access.authGeneration },
    };
    return {
      client: await connectAuthoritativeRuntimeClient(runtimeAccess, (resolvedAccess) => new RemoteRuntimeClient(
        access.baseUrl,
        access.token,
        access.workspaceId,
        resolvedAccess.identity?.runtimeId,
        resolvedAccess.identity?.instanceId,
        resolvedAccess.identity?.authGeneration,
      )),
      workspaceId: access.workspaceId,
    };
  }
  const persisted = workspaceId ? await workspaceRouting.findWorkspaceById(workspaceId) : undefined;
  if (persisted?.location === "remote") return null;
  const client = await LocalRuntimeClient.connectIfAvailable();
  if (!client) return null;
  return resolveLocalRuntimeWorkspace(client, workspacePath, workspaceId, persisted?.name ?? workspaceName, Boolean(persisted));
}

/**
 * Desktop can briefly retain a provisional Workspace ID while the Runtime
 * startup refresh replaces it with an authoritative ID. Unknown IDs may also
 * legitimately identify a Runtime-owned Worktree, so validate them against
 * Runtime before deciding whether to preserve or heal them by canonical path.
 */
export async function resolveLocalRuntimeWorkspace<T extends Pick<RuntimeClient, "listWorkspaces" | "openWorkspace">>(
  client: T,
  workspacePath: string,
  workspaceId?: string,
  workspaceName?: string,
  persisted = false,
): Promise<{ client: T; workspaceId: string }> {
  if (workspaceId && workspaceId !== "current" && !persisted) {
    try {
      const runtimeWorkspace = (await client.listWorkspaces(true)).find(
        (candidate) => candidate.workspace_id === workspaceId && candidate.open,
      );
      if (runtimeWorkspace) return { client, workspaceId };
    } catch {
      // Opening by path is the safe fallback: it heals provisional IDs and
      // preserves Worktree identity because Worktree paths are authoritative.
    }
  }
  const opened = await client.openWorkspace(workspacePath, workspaceName);
  return { client, workspaceId: opened.workspace_id };
}
