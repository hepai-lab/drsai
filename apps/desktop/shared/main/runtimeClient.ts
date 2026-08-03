import { randomUUID } from "crypto";
import { getDiagnosticPropagationHeaders } from "./diagnosticContext";
import { getGatewayRequestHeaders, getGatewayStatus, startGateway } from "./gateway";
import { parseRemoteProtocolError, REMOTE_SSH_PROTOCOL_VERSION, type RemoteProtocolErrorBody } from "../api/remoteSshProtocol";
import type { OWOPOperation, OWOPParamsByOperation } from "../api/owop.generated";
import type {
  OaepEventPage,
  OaepSnapshot,
} from "../api/oaep.generated";
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
  DesktopMobilePairingReadiness,
  DesktopMobileAssociation,
  DesktopRuntimeEnrollmentRevocation,
  GatewayStatus,
  WorkspaceProject,
} from "../api/desktopApi";

const packagedRecoveryRuns = new Map<string, { failures: number; events: RuntimeAgentEvent[] }>();

interface RemoteGatewayAccess {
  baseUrl: string;
  token: string;
  workspaceId: string;
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
  reason?: string | null;
  version?: string;
  connection_state?: string;
  app_server_state?: "running" | "stopped" | "fault";
  transport?: "local-process" | "ssh" | string;
  adapter_version?: string;
}

export interface BackendAccountStatus {
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

export interface RuntimeSession { session_id: string; workspace_id: string; title: string; archived?: boolean; lifecycle?: string; created_at?: string; updated_at?: string; message_count?: number; }
export interface RuntimeBackendSessionSyncResult {
  backend_id: string; workspace_id: string; discovered: number; active: number; archived: number;
  created: number; updated: number; skipped: number; conflicts?: number; sessions: RuntimeSession[];
}
export interface RuntimeAgentRun { run_id: string; session_id: string; workspace_id: string; backend_id: string; status: string; }
export interface RuntimeAgentEvent { event_id: string; run_id: string; sequence: number; type: string; data: Record<string, unknown>; }
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
  getRuntime(): Promise<RuntimeIdentity>;
  getCapabilities(): Promise<RuntimeCapabilities>;
  getBackendAccount(backendId: string, refresh?: boolean): Promise<BackendAccountStatus>;
  restartBackend(backendId: string): Promise<Record<string, unknown>>;
  syncBackendSessions(workspaceId: string, backendId: string): Promise<RuntimeBackendSessionSyncResult>;
  syncBackendSessionHistory(sessionId: string): Promise<{ session_id: string; backend_id: string; imported: number; total: number; runs?: number; warnings?: number; mapping_version?: string }>;
  startBackendLogin(backendId: string, type?: "chatgpt" | "chatgptDeviceCode"): Promise<BackendLoginStart>;
  cancelBackendLogin(backendId: string, loginId: string): Promise<void>;
  logoutBackend(backendId: string): Promise<void>;
  openWorkspace(path: string, displayName?: string): Promise<RuntimeWorkspace>;
  updateWorkspaceDisplayName(workspaceId: string, displayName: string): Promise<RuntimeWorkspace>;
  listWorkspaces(includeClosed?: boolean): Promise<RuntimeWorkspace[]>;
  closeWorkspace(workspaceId: string): Promise<RuntimeWorkspace>;
  createWorktree(workspaceId: string, intent: string, idempotencyKey: string): Promise<RuntimeWorktreeCreateResult>;
  adoptWorktree(workspaceId: string, request: { idempotencyKey: string; canonicalPath: string; branch: string; baseRef: string }): Promise<RuntimeWorktree>;
  listWorktrees(workspaceId: string, includeRemoved?: boolean): Promise<RuntimeWorktree[]>;
  listWorkspaceEvents(workspaceId: string, afterSequence?: number): Promise<{ events: RuntimeWorkspaceEvent[]; nextSequence: number }>;
  describeWorktree(workspaceId: string, worktreeId: string): Promise<RuntimeWorktree>;
  mergeWorktree(workspaceId: string, worktreeId: string, idempotencyKey: string, expectedHead?: string): Promise<RuntimeWorktree>;
  archiveWorktree(workspaceId: string, worktreeId: string, idempotencyKey: string): Promise<RuntimeWorktree>;
  removeWorktree(workspaceId: string, worktreeId: string, expectedStatus: "merged" | "archived", idempotencyKey: string): Promise<RuntimeWorktree>;
  listSessions(workspaceId: string): Promise<RuntimeSessionList>;
  createSession(workspaceId: string, title?: string): Promise<RuntimeSession>;
  updateSession(sessionId: string, updates: { archived?: boolean; title?: string }): Promise<RuntimeSession>;
  getConversationSnapshot(sessionId: string): Promise<RuntimeConversationSnapshot>;
  listSessionEvents(sessionId: string, afterSequence?: number, limit?: number): Promise<RuntimeSessionEventPage>;
  openSessionEventStream(sessionId: string, afterSequence: number, signal: AbortSignal): Promise<RuntimeSessionEventStream>;
  getOaepSnapshot(sessionId: string): Promise<OaepSnapshot>;
  listOaepEvents(sessionId: string, afterSequence?: number, limit?: number): Promise<OaepEventPage>;
  openOaepEventStream(sessionId: string, afterSequence: number, signal: AbortSignal): Promise<OaepEventStream>;
  getAgentRun(runId: string): Promise<RuntimeAgentRun>;
  createAgentRun(sessionId: string, agentDefinition: string, idempotencyKey: string): Promise<RuntimeAgentRun>;
  executeAgentRun(
    runId: string,
    prompt: string,
    signal?: AbortSignal,
    provenance?: { sourceClient: "windows" | "android"; sourceMessageId: string; attachmentRefs?: string[]; metadata?: Record<string, unknown> },
    auth?: RuntimeExecutionAuth,
  ): Promise<{ run: RuntimeAgentRun; result: unknown }>;
  cancelAgentRun(runId: string): Promise<RuntimeAgentRun>;
  listAgentRunEvents(runId: string, afterSequence?: number): Promise<RuntimeAgentEvent[]>;
  getAgentRunDiagnostics(runId: string): Promise<Record<string, unknown>>;
  respondAgentApproval(runId: string, approvalId: string, decision: "accept" | "acceptForSession" | "decline" | "cancel"): Promise<void>;
  createRun(request: RuntimeRunRequest, signal?: AbortSignal): Promise<RuntimeRunStream>;
  executeOWOP<K extends OWOPOperation>(workspaceId: string, operation: K, params: OWOPParamsByOperation[K]): Promise<Record<string, unknown>>;
  requestFiles<T>(workspaceId: string, endpoint: string, init?: RequestInit): Promise<T>;
  requestGit<T>(workspaceId: string, endpoint: string, init?: RequestInit): Promise<T>;
  ptyEndpoint(): string;
  getMobilePairingReadiness(): Promise<DesktopMobilePairingReadiness>;
  createMobilePairingGrant(): Promise<DesktopMobilePairingGrant>;
  getMobilePairingGrant(grantId: string): Promise<DesktopMobilePairingGrant>;
  revokeMobilePairingGrant(grantId: string): Promise<DesktopMobilePairingGrant>;
  listMobileAssociations(): Promise<DesktopMobileAssociation[]>;
  revokeMobileAssociation(associationId: string): Promise<DesktopMobileAssociation>;
  revokeMobileRuntimeEnrollment(): Promise<DesktopRuntimeEnrollmentRevocation>;
}

export interface RuntimeAccess {
  baseUrl: string;
  headers: Record<string, string>;
}

export interface RuntimeExecutionAuth {
  authMode: "oidc" | "offline";
  accessToken?: string;
  userId: string;
}

export class RuntimeProtocolCompatibilityError extends Error {
  constructor(readonly received: number) {
    super(`Runtime protocol ${received} is incompatible with Desktop protocol ${REMOTE_SSH_PROTOCOL_VERSION}.`);
    this.name = "RuntimeProtocolCompatibilityError";
  }
}

abstract class HttpRuntimeClient implements RuntimeClient {
  abstract readonly location: RuntimeLocation;
  constructor(protected readonly access: RuntimeAccess) {}

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

  async listWorktrees(workspaceId: string, includeRemoved = false): Promise<RuntimeWorktree[]> {
    this.assertResourceId("Workspace", workspaceId);
    const result = await this.requestJson<{ worktrees?: RuntimeWorktree[] }>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/worktrees?include_removed=${includeRemoved ? "true" : "false"}`,
    );
    return result.worktrees ?? [];
  }

  async listWorkspaceEvents(workspaceId: string, afterSequence = 0): Promise<{ events: RuntimeWorkspaceEvent[]; nextSequence: number }> {
    this.assertResourceId("Workspace", workspaceId);
    const cursor = Math.max(0, Math.trunc(afterSequence));
    const result = await this.requestJson<{ events?: RuntimeWorkspaceEvent[]; next_sequence?: number }>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/events?after_sequence=${cursor}`,
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

  restartBackend(backendId: string): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/agent-backends/${this.backendId(backendId)}/restart`, { method: "POST" });
  }

  syncBackendSessions(workspaceId: string, backendId: string): Promise<RuntimeBackendSessionSyncResult> {
    this.assertResourceId("Workspace", workspaceId);
    return this.requestJson(`/v1/workspaces/${encodeURIComponent(workspaceId)}/agent-backends/${this.backendId(backendId)}/sessions/sync`, { method: "POST" });
  }

  syncBackendSessionHistory(sessionId: string): Promise<{ session_id: string; backend_id: string; imported: number; total: number; runs?: number; warnings?: number; mapping_version?: string }> {
    return this.requestJson(`/v1/sessions/${encodeURIComponent(sessionId)}/agent-backend/history/sync`, { method: "POST" });
  }

  getOaepSnapshot(sessionId: string): Promise<OaepSnapshot> {
    this.assertResourceId("Session", sessionId);
    return this.requestJson(`/v1/sessions/${encodeURIComponent(sessionId)}/oaep-snapshot`);
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

  executeAgentRun(
    runId: string,
    prompt: string,
    signal?: AbortSignal,
    provenance?: { sourceClient: "windows" | "android"; sourceMessageId: string; attachmentRefs?: string[]; metadata?: Record<string, unknown> },
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
        metadata: provenance ? {
          ...(provenance.metadata ?? {}),
          source_client: provenance.sourceClient,
          source_message_id: provenance.sourceMessageId,
          attachment_refs: provenance.attachmentRefs ?? [],
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

  getAgentRunDiagnostics(runId: string): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/diagnostics`);
  }

  async respondAgentApproval(runId: string, approvalId: string, decision: "accept" | "acceptForSession" | "decline" | "cancel"): Promise<void> {
    await this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}/decision`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }),
    });
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

  createMobilePairingGrant(): Promise<DesktopMobilePairingGrant> {
    return this.requestJson("/v1/mobile-pairing/grants", { method: "POST" });
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
    const response = await fetch(`${this.access.baseUrl}${path}`, {
      ...init,
      headers: { "X-Correlation-ID": randomUUID(), ...getDiagnosticPropagationHeaders(), ...this.access.headers, ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      let body: RemoteProtocolErrorBody | null = null;
      try { body = await response.json() as RemoteProtocolErrorBody; } catch { /* non-JSON failure */ }
      throw parseRemoteProtocolError(response.status, body, response.headers.get("x-correlation-id"));
    }
    return response;
  }

  private assertProtocol(received: number): void {
    if (received !== REMOTE_SSH_PROTOCOL_VERSION) throw new RuntimeProtocolCompatibilityError(received);
  }
}

export class LocalRuntimeClient extends HttpRuntimeClient {
  readonly location = "local" as const;

  static async connect(): Promise<LocalRuntimeClient> {
    if (!(await startGateway())) throw await createLocalRuntimeUnavailableError("start");
    const status = await getGatewayStatus();
    if (!status.ready) throw createLocalRuntimeUnavailableErrorFromStatus(status, "health");
    return new LocalRuntimeClient({ baseUrl: status.baseUrl, headers: getGatewayRequestHeaders() });
  }

  static forAccess(baseUrl: string, headers: Record<string, string> = {}): LocalRuntimeClient {
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) throw new Error("Local Runtime access must use loopback HTTP.");
    return new LocalRuntimeClient({ baseUrl, headers });
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

async function createLocalRuntimeUnavailableError(phase: "start" | "health"): Promise<LocalRuntimeUnavailableError> {
  return createLocalRuntimeUnavailableErrorFromStatus(await getGatewayStatus(), phase);
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
  if (status.managed) {
    return `Local Runtime is unavailable${code}.${detail} Restart the OpenDrSai Runtime, then retry.`;
  }
  return phase === "start"
    ? `Local Runtime could not be started${code}.${detail} Check the Runtime installation, then retry.`
    : `Local Runtime is unavailable${code}.${detail} Check the Runtime installation, then retry.`;
}

export class RemoteRuntimeClient extends HttpRuntimeClient {
  readonly location = "remote" as const;

  constructor(baseUrl: string, token: string) {
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) throw new Error("Remote Runtime must use an SSH loopback tunnel.");
    if (!token || /[\r\n\0]/.test(token)) throw new Error("Remote Runtime token is invalid.");
    super({ baseUrl, headers: { "X-OpenDrSai-Gateway-Token": token } });
  }
}

export async function connectRuntimeClientForWorkspace(
  workspacePath: string,
  workspaceId?: string,
  workspaceName?: string,
): Promise<{ client: RuntimeClient; workspaceId: string }> {
  const access = workspaceRouting.getRemoteGatewayAccess(workspacePath, workspaceId);
  if (access) {
    return {
      client: new RemoteRuntimeClient(access.baseUrl, access.token),
      workspaceId: access.workspaceId,
    };
  }
  const persisted = workspaceId ? await workspaceRouting.findWorkspaceById(workspaceId) : undefined;
  if (persisted?.location === "remote") {
    throw new Error("Remote Workspace is offline; Runtime operation refused without local fallback (stale cache is read-only).");
  }
  const client = await LocalRuntimeClient.connect();
  // Desktop Workspace IDs are presentation/persistence identities. Local Full
  // Runtime owns a distinct authoritative Workspace ID, so resolve it by path.
  // A non-persisted ID is already a Runtime execution identity (for example a
  // Worktree Workspace selected by a Thread) and must remain unchanged.
  if (workspaceId && workspaceId !== "current" && !persisted) return { client, workspaceId };
  const opened = await client.openWorkspace(workspacePath, persisted?.name ?? workspaceName);
  return { client, workspaceId: opened.workspace_id };
}
