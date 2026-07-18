import { randomUUID } from "crypto";
import { parseRemoteProtocolError, REMOTE_SSH_PROTOCOL_VERSION, type RemoteProtocolErrorBody } from "../shared/remoteSshProtocol";
import type { OWOPOperation, OWOPParamsByOperation } from "../shared/owop.generated";

export type RuntimeLocation = "local" | "remote";

export interface RuntimeIdentity {
  runtime_id: string;
  instance_id: string;
  version: string;
  protocol_version: number;
  platform: string;
}

export interface RuntimeCapabilities {
  protocol_version: number;
  capabilities: string[];
  capability_versions: Record<string, number>;
  agent_backends?: Record<string, AgentBackendCapability>;
}

export interface AgentBackendCapability {
  backend_id: string;
  available: boolean;
  reason?: string | null;
  version?: string;
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

export interface RuntimeSession { session_id: string; workspace_id: string; title: string; }
export interface RuntimeAgentRun { run_id: string; session_id: string; workspace_id: string; backend_id: string; status: string; }
export interface RuntimeAgentEvent { event_id: string; run_id: string; sequence: number; type: string; data: Record<string, unknown>; }

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
  startBackendLogin(backendId: string, type?: "chatgpt" | "chatgptDeviceCode"): Promise<BackendLoginStart>;
  cancelBackendLogin(backendId: string, loginId: string): Promise<void>;
  logoutBackend(backendId: string): Promise<void>;
  openWorkspace(path: string): Promise<RuntimeWorkspace>;
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
  getAgentRun(runId: string): Promise<RuntimeAgentRun>;
  createAgentRun(sessionId: string, agentDefinition: string, idempotencyKey: string): Promise<RuntimeAgentRun>;
  executeAgentRun(runId: string, prompt: string, signal?: AbortSignal): Promise<{ run: RuntimeAgentRun; result: unknown }>;
  cancelAgentRun(runId: string): Promise<RuntimeAgentRun>;
  listAgentRunEvents(runId: string, afterSequence?: number): Promise<RuntimeAgentEvent[]>;
  respondAgentApproval(runId: string, approvalId: string, decision: "accept" | "acceptForSession" | "decline" | "cancel"): Promise<void>;
  createRun(request: RuntimeRunRequest, signal?: AbortSignal): Promise<RuntimeRunStream>;
  executeOWOP<K extends OWOPOperation>(workspaceId: string, operation: K, params: OWOPParamsByOperation[K]): Promise<Record<string, unknown>>;
  requestFiles<T>(workspaceId: string, endpoint: string, init?: RequestInit): Promise<T>;
  requestGit<T>(workspaceId: string, endpoint: string, init?: RequestInit): Promise<T>;
  ptyEndpoint(): string;
}

export interface RuntimeAccess {
  baseUrl: string;
  headers: Record<string, string>;
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

  openWorkspace(path: string): Promise<RuntimeWorkspace> {
    return this.requestJson("/v1/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
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
    return this.requestJson(`/v1/threads?workspace_id=${encodeURIComponent(workspaceId)}&limit=100`);
  }

  createSession(workspaceId: string, title = "New session"): Promise<RuntimeSession> {
    return this.requestJson("/v1/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace_id: workspaceId, title }) });
  }

  updateSession(sessionId: string, updates: { archived?: boolean; title?: string }): Promise<RuntimeSession> {
    return this.requestJson(`/v1/sessions/${encodeURIComponent(sessionId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
  }

  getAgentRun(runId: string): Promise<RuntimeAgentRun> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}`);
  }

  createAgentRun(sessionId: string, agentDefinition: string, idempotencyKey: string): Promise<RuntimeAgentRun> {
    return this.requestJson(`/v1/sessions/${encodeURIComponent(sessionId)}/runs`, { method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ agent_definition: agentDefinition }) });
  }

  executeAgentRun(runId: string, prompt: string, signal?: AbortSignal): Promise<{ run: RuntimeAgentRun; result: unknown }> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/execute`, { method: "POST", signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
  }

  cancelAgentRun(runId: string): Promise<RuntimeAgentRun> {
    return this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
  }

  async listAgentRunEvents(runId: string, afterSequence = 0): Promise<RuntimeAgentEvent[]> {
    const result = await this.requestJson<{ data?: RuntimeAgentEvent[] }>(`/v1/runs/${encodeURIComponent(runId)}/events?after_sequence=${afterSequence}`);
    return result.data ?? [];
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

  protected async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    return response.json() as Promise<T>;
  }

  protected async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${this.access.baseUrl}${path}`, {
      ...init,
      headers: { "X-Correlation-ID": randomUUID(), ...this.access.headers, ...init.headers },
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
    const { getGatewayRequestHeaders, getGatewayStatus, startGateway } = await import("./gateway");
    if (!(await startGateway())) throw new Error("Local Runtime is not ready.");
    const status = await getGatewayStatus();
    if (!status.ready) throw new Error("Local Runtime failed its health check.");
    return new LocalRuntimeClient({ baseUrl: status.baseUrl, headers: getGatewayRequestHeaders() });
  }

  static forAccess(baseUrl: string, headers: Record<string, string> = {}): LocalRuntimeClient {
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) throw new Error("Local Runtime access must use loopback HTTP.");
    return new LocalRuntimeClient({ baseUrl, headers });
  }
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
): Promise<{ client: RuntimeClient; workspaceId: string }> {
  const [{ getRemoteGatewayAccess }, { findWorkspaceById }] = await Promise.all([
    import("./remoteWorkspace"),
    import("./workspaces"),
  ]);
  const access = getRemoteGatewayAccess(workspacePath, workspaceId);
  if (access) {
    return {
      client: new RemoteRuntimeClient(access.baseUrl, access.token),
      workspaceId: access.workspaceId,
    };
  }
  const persisted = workspaceId ? await findWorkspaceById(workspaceId) : undefined;
  if (persisted?.location === "remote") {
    throw new Error("Remote Workspace is offline; Runtime operation refused without local fallback (stale cache is read-only).");
  }
  const client = await LocalRuntimeClient.connect();
  // Desktop Workspace IDs are presentation/persistence identities. Local Full
  // Runtime owns a distinct authoritative Workspace ID, so resolve it by path.
  // A non-persisted ID is already a Runtime execution identity (for example a
  // Worktree Workspace selected by a Thread) and must remain unchanged.
  if (workspaceId && !persisted) return { client, workspaceId };
  const opened = await client.openWorkspace(workspacePath);
  return { client, workspaceId: opened.workspace_id };
}
