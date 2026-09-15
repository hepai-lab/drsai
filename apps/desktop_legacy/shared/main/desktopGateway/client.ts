/**
 * The typed client for `drsai.backend.desktop_gateway` -- 17 operations.
 *
 * Replaces `runtimeClient.ts` (1,934 lines, 103 distinct paths) for this
 * surface.  The size difference is almost entirely the paths that are gone; what
 * remains here that the legacy client also had is the authentication header
 * assembly and the error normalisation, because both are genuinely required and
 * both are easy to get subtly wrong.
 *
 * ## Authentication, and why it is two headers and not one
 *
 * `x-opendrsai-gateway-token` answers "is this the local process we paired with?"
 * The bearer token answers "which HepAI user is this?"  They are different
 * questions with different failure modes: a missing pairing token means the
 * Runtime was launched by someone else and every route 401s; a missing bearer
 * means the user is signed out and only model-backed routes fail.  Collapsing
 * them into one credential would make a signed-out desktop look compromised.
 *
 * `x-opendrsai-principal` is sent alongside the bearer so the gateway can reject
 * a valid token presented for a different subject.  Sending the bearer without it
 * is accepted by the middleware but leaves that cross-check unmade, so this
 * client always sends both or neither.
 */

import { randomUUID } from "node:crypto";
import {
  DESKTOP_OPERATIONS,
  DesktopGatewayError,
  type DesktopErrorBody,
  type DesktopOperationId,
  type ModelCatalog,
  type RunAcceptedResponse,
  type RunRecord,
  type RuntimeIdentity,
  type SessionListQuery,
  type SessionListResponse,
  type SessionRecord,
  type SessionUpdateRequest,
  type TranscriptionRequest,
  type TranscriptionResult,
  type WorkspaceFileContent,
  type WorkspaceFileListing,
  type WorkspaceFileQuery,
  type WorkspaceListResponse,
  type WorkspaceRecord,
} from "../../api/desktopGateway";
import type { DesktopSessionEventPage, DesktopSessionSnapshot } from "../../api/desktopGateway";

export interface DesktopGatewayIdentity {
  /** HepAI access token, or null when signed out (offline mode). */
  bearer: string | null;
  /** The OIDC subject the bearer belongs to. Required whenever `bearer` is set. */
  principal: string | null;
}

export interface DesktopGatewayClientOptions {
  baseUrl: string;
  /** The pairing token from `$DRSAI_HOME/runtime/instance-token`. */
  instanceToken: string;
  /** Read fresh on every request: a token refresh must not need a new client. */
  identity: () => DesktopGatewayIdentity;
  /** Non-stream request timeout. Streams are never timed out; they idle by design. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class DesktopGatewayClient {
  private readonly baseUrl: string;
  private readonly instanceToken: string;
  private readonly identity: () => DesktopGatewayIdentity;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DesktopGatewayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.instanceToken = options.instanceToken;
    this.identity = options.identity;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /* ------------------------------------------------------------ 1. runtime */

  /**
   * The handshake.  Unauthenticated on purpose: the desktop must be able to ask
   * "which Runtime are you?" before it has proven anything, or a token mismatch
   * would be indistinguishable from a Runtime that failed to start.
   */
  async getRuntimeIdentity(signal?: AbortSignal): Promise<RuntimeIdentity> {
    return this.request<RuntimeIdentity>("getRuntimeIdentity", { signal });
  }

  /* --------------------------------------------------------- 2. workspaces */

  async listWorkspaces(includeClosed = false): Promise<WorkspaceRecord[]> {
    const body = await this.request<WorkspaceListResponse>("listWorkspaces", {
      query: { include_closed: includeClosed },
    });
    return body.data;
  }

  /** Idempotent on path: re-opening a known directory returns the same record. */
  async openWorkspace(path: string, displayName?: string | null): Promise<WorkspaceRecord> {
    return this.request<WorkspaceRecord>("openWorkspace", {
      body: { path, display_name: displayName ?? null },
    });
  }

  async listWorkspaceFiles(
    workspaceId: string,
    query: WorkspaceFileQuery = {},
  ): Promise<WorkspaceFileListing> {
    return this.request<WorkspaceFileListing>("listWorkspaceFiles", {
      params: { workspace_id: workspaceId },
      query: {
        path: query.path ?? ".",
        depth: query.depth,
        query: query.query,
        offset: query.offset,
        max_entries: query.max_entries,
      },
    });
  }

  async readWorkspaceFile(
    workspaceId: string,
    path: string,
    maxBytes?: number,
  ): Promise<WorkspaceFileContent> {
    return this.request<WorkspaceFileContent>("readWorkspaceFile", {
      params: { workspace_id: workspaceId },
      query: { path, max_bytes: maxBytes },
    });
  }

  /* ----------------------------------------------------------- 3. sessions */

  async createSession(workspaceId: string, title?: string): Promise<SessionRecord> {
    return this.request<SessionRecord>("createSession", {
      body: { workspace_id: workspaceId, title: title ?? "New session" },
    });
  }

  async listSessions(query: SessionListQuery): Promise<SessionListResponse> {
    return this.request<SessionListResponse>("listSessions", {
      query: {
        workspace_id: query.workspace_id,
        offset: query.offset,
        limit: query.limit,
        archived: query.archived,
      },
    });
  }

  async getSession(sessionId: string): Promise<SessionRecord> {
    return this.request<SessionRecord>("getSession", { params: { session_id: sessionId } });
  }

  async updateSession(sessionId: string, patch: SessionUpdateRequest): Promise<SessionRecord> {
    return this.request<SessionRecord>("updateSession", {
      params: { session_id: sessionId },
      body: patch,
    });
  }

  async getSessionSnapshot(
    sessionId: string,
    options: { cursor?: string | null; limit?: number } = {},
  ): Promise<DesktopSessionSnapshot> {
    return this.request<DesktopSessionSnapshot>("getSessionSnapshot", {
      params: { session_id: sessionId },
      query: { cursor: options.cursor ?? undefined, limit: options.limit },
    });
  }

  /**
   * Durable replay after an **exclusive** cursor.  A 409 `cursor_expired` here is
   * not a transport failure and must not be retried with the same cursor -- the
   * events are gone and the only correct recovery is a fresh snapshot.
   */
  async listSessionEvents(
    sessionId: string,
    afterSequence: number,
    limit?: number,
  ): Promise<DesktopSessionEventPage> {
    return this.request<DesktopSessionEventPage>("listSessionEvents", {
      params: { session_id: sessionId },
      query: { after_sequence: afterSequence, limit },
    });
  }

  /**
   * Opens the SSE stream and hands back the raw body.
   *
   * The cursor is validated by the server *before* the response starts, so a bad
   * session id or an expired cursor arrives here as a thrown
   * `DesktopGatewayError` rather than a 200 that closes immediately -- the latter
   * is indistinguishable from an idle stream on the client side.
   *
   * No timeout is applied.  A healthy stream is mostly silent; the server sends a
   * heartbeat comment every 15 s and the caller's own idle detector decides when
   * silence has become suspicious.
   */
  async streamSessionEvents(
    sessionId: string,
    afterSequence: number,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const operation = DESKTOP_OPERATIONS.streamSessionEvents;
    const url = this.url(operation.path, { session_id: sessionId }, { after_sequence: afterSequence });
    const correlationId = randomUUID().replace(/-/g, "");
    const response = await this.fetchImpl(url, {
      method: operation.method,
      headers: { ...this.headers(correlationId), accept: "text/event-stream" },
      signal,
    });
    if (!response.ok) {
      throw await this.toError(response, "streamSessionEvents", correlationId);
    }
    if (!response.body) {
      throw new DesktopGatewayError({
        status: response.status,
        body: { code: "stream_body_missing", message: "The event stream carried no body." },
        operationId: "streamSessionEvents",
        correlationId,
      });
    }
    return response.body;
  }

  /* --------------------------------------------------------------- 4. runs */

  /**
   * Create the turn record.  201 when new, 200 when the idempotency key already
   * ran; the boolean says which, because the caller needs to know whether it is
   * looking at its own submission or a duplicate that landed first.
   */
  async createRun(
    sessionId: string,
    idempotencyKey: string,
  ): Promise<{ run: RunRecord; created: boolean }> {
    const { body, status } = await this.requestWithStatus<RunRecord>("createRun", {
      params: { session_id: sessionId },
      body: { idempotency_key: idempotencyKey },
    });
    return { run: body, created: status === 201 };
  }

  /**
   * Start the Agent.  Returns as soon as the Runtime has accepted the work: the
   * output was never on this response, it goes to the journal and reaches the
   * client on the session event stream.
   *
   * `wait` exists for scripts and tests that want the synchronous shape.  The
   * desktop never uses it -- a run whose lifetime is tied to one HTTP connection
   * is lost by a page refresh, a second window, or a dropped Wi-Fi link.
   */
  async executeRun(
    runId: string,
    input: { prompt: string; modelAlias?: string | null; sourceMessageId?: string | null },
    options: { wait?: boolean } = {},
  ): Promise<RunAcceptedResponse> {
    return this.request<RunAcceptedResponse>("executeRun", {
      params: { run_id: runId },
      query: options.wait ? { wait: true } : {},
      body: {
        prompt: input.prompt,
        model_alias: input.modelAlias ?? null,
        source_message_id: input.sourceMessageId ?? null,
        metadata: { source_client: "windows" },
      },
      // The Agent may take a while to accept; the 202 itself is fast, but
      // `set_run_input` writes to SQLite behind a lock that a busy session holds.
      timeoutMs: 60_000,
    });
  }

  async cancelRun(runId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("cancelRun", { params: { run_id: runId } });
  }

  /* ------------------------------------------------------------- 5. models */

  async getModelCatalog(): Promise<ModelCatalog> {
    return this.request<ModelCatalog>("getModelCatalog");
  }

  /* -------------------------------------------------------------- 6. audio */

  async transcribeAudio(input: TranscriptionRequest): Promise<TranscriptionResult> {
    const form = new FormData();
    // Copy into a fresh ArrayBuffer: the incoming view may be a slice of a larger
    // pooled buffer, and Blob would otherwise capture the whole pool.
    const bytes = new Uint8Array(input.audio.byteLength);
    bytes.set(input.audio);
    form.append("file", new Blob([bytes], { type: input.media_type }), input.filename);
    if (input.model) form.append("model", input.model);
    if (input.language) form.append("language", input.language);
    return this.request<TranscriptionResult>("transcribeAudio", {
      form,
      timeoutMs: 120_000,
    });
  }

  /* ------------------------------------------------------------- internals */

  private headers(correlationId: string): Record<string, string> {
    const headers: Record<string, string> = {
      "x-opendrsai-gateway-token": this.instanceToken,
      "x-correlation-id": correlationId,
    };
    const { bearer, principal } = this.identity();
    if (bearer && principal) {
      headers["x-opendrsai-auth-mode"] = "oidc";
      headers.authorization = `Bearer ${bearer}`;
      headers["x-opendrsai-principal"] = principal;
    } else {
      // Explicit rather than absent: the gateway's offline branch is a supported
      // state (no HepAI identity, static provider credentials), not a fallback
      // for a request that forgot its headers.
      headers["x-opendrsai-auth-mode"] = "offline";
    }
    return headers;
  }

  private url(
    template: string,
    params: Record<string, string> = {},
    query: Record<string, unknown> = {},
  ): string {
    let path = template;
    for (const [key, value] of Object.entries(params)) {
      path = path.replace(`{${key}}`, encodeURIComponent(value));
    }
    const remaining = path.match(/\{([^}]+)\}/);
    if (remaining) throw new Error(`desktop_gateway_path_parameter_missing:${remaining[1]}`);
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      search.set(key, String(value));
    }
    const suffix = search.toString();
    return `${this.baseUrl}${path}${suffix ? `?${suffix}` : ""}`;
  }

  private async request<T>(
    operationId: DesktopOperationId,
    options: {
      params?: Record<string, string>;
      query?: Record<string, unknown>;
      body?: unknown;
      form?: FormData;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    return (await this.requestWithStatus<T>(operationId, options)).body;
  }

  private async requestWithStatus<T>(
    operationId: DesktopOperationId,
    options: {
      params?: Record<string, string>;
      query?: Record<string, unknown>;
      body?: unknown;
      form?: FormData;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ): Promise<{ body: T; status: number }> {
    const operation = DESKTOP_OPERATIONS[operationId];
    if (!operation) throw new Error(`desktop_gateway_unknown_operation:${operationId}`);
    const url = this.url(operation.path, options.params, options.query);
    const correlationId = randomUUID().replace(/-/g, "");
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), options.timeoutMs ?? this.timeoutMs);
    // Either the caller's cancellation or our timeout ends the request; whichever
    // fires first wins, and the caller's reason survives so a user-initiated
    // cancel is not reported as a timeout.
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout.signal])
      : timeout.signal;
    const headers = this.headers(correlationId);
    let payload: BodyInit | undefined;
    if (options.form) {
      payload = options.form;
    } else if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(options.body);
    } else if (operation.method !== "GET") {
      // FastAPI's body models are required even when every field has a default,
      // so a POST with no body must still send `{}` rather than nothing.
      headers["content-type"] = "application/json";
      payload = "{}";
    }
    try {
      const response = await this.fetchImpl(url, {
        method: operation.method,
        headers,
        body: payload,
        signal,
      });
      if (!response.ok) throw await this.toError(response, operationId, correlationId);
      const text = await response.text();
      return { body: (text ? JSON.parse(text) : {}) as T, status: response.status };
    } catch (error) {
      if (error instanceof DesktopGatewayError) throw error;
      if (timeout.signal.aborted && !options.signal?.aborted) {
        throw new DesktopGatewayError({
          status: 0,
          body: {
            code: "runtime_timeout",
            message: `${operationId} did not answer within ${options.timeoutMs ?? this.timeoutMs} ms.`,
            retryable: true,
          },
          operationId,
          correlationId,
        });
      }
      throw new DesktopGatewayError({
        status: 0,
        body: {
          code: "runtime_unreachable",
          message: error instanceof Error ? error.message : String(error),
          // Transport failures are worth one retry; the Runtime may simply be
          // mid-restart. Application failures above are not.
          retryable: true,
        },
        operationId,
        correlationId,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * FastAPI's `detail` has three shapes and the client sees all three: a plain
   * string from `HTTPException(detail="...")`, the structured object
   * `_errors.py` builds, and the validation array Pydantic produces on 422.
   * Flattening them here is what lets every caller test `error.code`.
   */
  private async toError(
    response: Response,
    operationId: DesktopOperationId,
    correlationId: string,
  ): Promise<DesktopGatewayError> {
    const correlation = response.headers.get("x-correlation-id") ?? correlationId;
    let detail: unknown = null;
    try {
      const text = await response.text();
      detail = text ? (JSON.parse(text) as { detail?: unknown }).detail ?? text : null;
    } catch {
      detail = null;
    }
    let body: DesktopErrorBody;
    if (detail && typeof detail === "object" && !Array.isArray(detail) && "code" in detail) {
      body = detail as DesktopErrorBody;
    } else if (Array.isArray(detail)) {
      body = {
        code: "request_invalid",
        message: detail
          .map((entry) => {
            const item = entry as { loc?: unknown[]; msg?: unknown };
            return `${(item.loc ?? []).join(".")}: ${item.msg ?? "invalid"}`;
          })
          .join("; "),
        retryable: false,
      };
    } else {
      body = {
        code: statusCode(response.status),
        message: typeof detail === "string" && detail ? detail : response.statusText,
        retryable: response.status >= 500,
      };
    }
    return new DesktopGatewayError({
      status: response.status,
      body,
      operationId,
      correlationId: correlation,
    });
  }
}

/** A stable machine name for statuses the server did not name itself. */
function statusCode(status: number): string {
  if (status === 401) return "gateway_unauthorized";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 413) return "payload_too_large";
  if (status === 422) return "request_invalid";
  if (status >= 500) return "runtime_error";
  return "request_failed";
}
