/**
 * The HTTP wire contract of `drsai.backend.desktop_gateway` -- 17 operations.
 *
 * This file is hand-written and is the single source of truth for the TypeScript
 * side.  It is deliberately *not* generated from the OpenAPI document: the
 * generator that produced `remoteGatewayClient.generated.ts` emits one method per
 * path with `unknown` bodies, which is how the legacy client grew to 1,934 lines
 * without ever telling a caller what a Session actually contains.  Seventeen
 * operations are small enough to type by hand and be right.
 *
 * Every key of `DESKTOP_OPERATIONS` matches the `operation_id=` on the Python
 * route, so a rename on either side is caught by `verify-desktop-surface.mts`
 * rather than by a 404 at click time.
 *
 * Field naming is snake_case throughout, on purpose.  These types describe bytes
 * on the wire; converting to camelCase here would mean every debugging session
 * translates between what the network inspector shows and what the code says.
 * The camelCase boundary is the IPC contract in `./ipc.ts`, which is where the
 * renderer's vocabulary begins.
 */

import type { OaepEvent, OaepEventPage, OaepSnapshot } from "../oaep.generated";

export type {
  OaepEvent,
  OaepEventPage,
  OaepItem,
  OaepRun,
  OaepSession,
  OaepSnapshot,
} from "../oaep.generated";

/**
 * The contract generation this client speaks, as it appears on the wire.
 *
 * This is the one place "v2" survives in the desktop tree, and it survives
 * because it is a **protocol value**, not a label for our code: the Python route
 * returns `"surface": "desktop-v2"`, the design it implements is
 * `apps/desktop/docs/v2/v2-minimal-surface.zh-CN.md`, and the wire contract lives
 * under `cores/protocol/desktop-v2/`. Renaming it here would make this client
 * reject the Runtime it was written for.
 *
 * Nothing else -- no module, class, channel or CSS class -- is named for the
 * migration that produced it.
 */
export const DESKTOP_SURFACE = "desktop-v2";

/* ------------------------------------------------------------------ 1. runtime */

/**
 * Capability names advertised by `GET /v1/runtime`.
 *
 * The renderer hides a control it has no route for instead of discovering a 404
 * when the user clicks it.  Note what is absent: 个人信息 (2.4) and 会话状态 (3.3)
 * have no capability because they have no route -- the first reads OIDC claims
 * the main process already holds, the second folds `run.status` off the event
 * stream.
 */
export type DesktopCapability =
  | "workspaces"
  | "sessions"
  | "session_events"
  | "runs"
  | "model_catalog"
  | "speech_to_text"
  | "workspace_files";

export interface RuntimeIdentity {
  runtime_id: string;
  instance_id: string;
  version: string;
  /** `remote_ssh.workspace.PROTOCOL_VERSION` -- an integer, not a semver string. */
  protocol_version: number;
  surface: string;
  capabilities: DesktopCapability[];
  platform: string;
  dev_managed: boolean;
  /**
   * SHA-256 over the gateway package *as loaded by that process*, captured at
   * import time.  A dev Runtime still running yesterday's code therefore reports
   * yesterday's digest, so "did my edit take effect?" is answerable instead of
   * guessable.
   */
  runtime_source_digest: string;
}

/* --------------------------------------------------------------- 2. workspaces */

export interface WorkspaceRecord {
  workspace_id: string;
  /** Absolute, in the host's native form -- backslashes on Windows. */
  path: string;
  display_name: string | null;
  lifecycle: "active" | "removed";
  open: boolean;
  revision: number;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  closed_at: string | null;
  removed_at: string | null;
}

export interface WorkspaceListResponse {
  data: WorkspaceRecord[];
}

export interface WorkspaceOpenRequest {
  path: string;
  display_name?: string | null;
}

export interface WorkspaceFileNode {
  name: string;
  path: string;
  directory: boolean;
  size: number;
  /** POSIX epoch seconds as a float -- `Path.stat().st_mtime` verbatim. */
  modified_at: number;
  git_status?: "untracked" | "renamed" | "deleted" | "added" | "modified";
  /** Present only on the nested browse shape, never on search results. */
  children?: WorkspaceFileNode[];
}

/**
 * Note the two shapes behind `data`.  A plain browse returns a nested tree; a
 * search or a paged request returns flat matches, because a filtered tree cannot
 * be rendered as a tree -- its interior nodes may not themselves match.  Callers
 * must branch on `children` rather than assume one shape; see
 * `isFlatFileListing`.
 */
export interface WorkspaceFileListing {
  workspace_id: string;
  /**
   * Which of the two shapes `data` holds.  Stated by the server rather than
   * inferred, because the two are indistinguishable from the data alone: a flat
   * listing and a tree whose entries happen to have no subdirectories both
   * consist of nodes with no `children`.
   */
  shape: "tree" | "flat";
  data: WorkspaceFileNode[];
  total: number;
  offset: number;
  next_offset: number | null;
  truncated: boolean;
  scan_limit: number;
}

export interface WorkspaceFileQuery {
  path?: string;
  depth?: number;
  query?: string;
  offset?: number;
  max_entries?: number;
}

interface WorkspaceFileCommon {
  path: string;
  mime: string;
  truncated: boolean;
  size: number;
  modified_at: number;
  sha256: string;
}

export interface WorkspaceTextFile extends WorkspaceFileCommon {
  binary: false;
  encoding: "utf-8";
  content: string;
}

export interface WorkspaceBinaryFile extends WorkspaceFileCommon {
  binary: true;
  encoding: null;
  /** `data:<mime>;base64,...` -- directly assignable to `img.src` or an iframe. */
  data_url: string;
}

export type WorkspaceFileContent = WorkspaceTextFile | WorkspaceBinaryFile;

/* ----------------------------------------------------------------- 3. sessions */

export type SessionLifecycle = "active" | "archived" | "removed";

/**
 * The REST record, which is *not* the `OaepSession` that rides the event stream.
 * This one keys on `session_id` and carries Runtime bookkeeping (`revision`,
 * `agent_definition`); the OAEP one keys on `id` and carries only what a client
 * renders.  Both are correct for their own channel -- the mistake to avoid is
 * assuming a value read from one can be handed to code expecting the other.
 */
export interface SessionRecord {
  session_id: string;
  workspace_id: string;
  worktree_id: string | null;
  title: string;
  archived: boolean;
  lifecycle: SessionLifecycle;
  revision: number;
  agent_definition: string;
  backend_id: string;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionListResponse {
  object: "list";
  data: SessionRecord[];
  total: number;
  offset: number;
}

export interface SessionCreateRequest {
  workspace_id: string;
  title?: string;
}

/** `lifecycle` wins over `archived` when both are supplied. */
export interface SessionUpdateRequest {
  title?: string | null;
  archived?: boolean | null;
  lifecycle?: SessionLifecycle | null;
}

/**
 * `archived` filters; it does not have a "both" value.
 *
 * The Python signature is `bool | None = False`, and `None` would mean both --
 * but a query string cannot express null, so omitting the parameter yields the
 * default `False` rather than `None`.  That branch is therefore unreachable over
 * HTTP, and pretending otherwise here would produce a client option that
 * silently does the opposite of what it says.  A UI that wants both makes two
 * calls, which is also what a tabbed history list does anyway.
 */
export interface SessionListQuery {
  workspace_id: string;
  offset?: number;
  limit?: number;
  archived?: boolean;
}

/* --------------------------------------------------------------------- 4. runs */

export type RunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * The REST record.  As with `SessionRecord`, the OAEP stream carries a different
 * projection of the same run (`OaepRun`, keyed `id`), so the two are not
 * interchangeable.  `input_message` is empty until `executeRun` binds the prompt.
 */
export interface RunRecord {
  run_id: string;
  session_id: string;
  workspace_id: string;
  worktree_id: string | null;
  runtime_id: string;
  instance_id: string;
  agent_definition: string;
  backend_id: string;
  status: RunStatus;
  idempotency_key: string;
  input_message: string;
  correlation_id: string | null;
  parent_run_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancel_requested_at: string | null;
}

/**
 * The idempotency key is required by the server, not optional.  A submit retried
 * after a dropped response must land on the run the first attempt created;
 * without the key the user gets two agents answering the same message.
 */
export interface RunCreateRequest {
  idempotency_key: string;
}

export interface RunExecuteRequest {
  prompt: string;
  /** An `alias` from `GET /v1/config/model-catalog`; feature 3.2 in one field. */
  model_alias?: string | null;
  user_id?: string | null;
  source_message_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * The 202 body.  There is no model output here and there never was: the run's
 * events go to the journal and reach the client on the session event stream.
 * `events` is that stream's path, echoed back so a caller cannot subscribe to
 * the wrong session.
 */
export interface RunAcceptedResponse {
  run: RunRecord;
  accepted: true;
  events: string;
}

/* ------------------------------------------------------------------- 5. models */

export interface ModelCatalogEntry {
  alias: string;
  display_name: string;
  client_type: string;
  model: string;
  token_limit?: number | null;
  max_tokens?: number | null;
  vision?: boolean;
}

export interface ModelCatalog {
  default_alias?: string | null;
  models: ModelCatalogEntry[];
  [key: string]: unknown;
}

/* -------------------------------------------------------------------- 6. audio */

export interface TranscriptionResult {
  text: string;
  language?: string | null;
  confidence?: number | null;
  model_ref: Record<string, unknown>;
  protocol: "openai_audio_transcriptions";
}

export interface TranscriptionRequest {
  audio: Uint8Array;
  filename: string;
  media_type: string;
  model?: string;
  language?: string;
}

/* --------------------------------------------------------------------- errors */

/**
 * The error envelope every route produces.  `code` is the stable machine name
 * (`_errors.http_errors` maps Runtime exceptions onto it); `message` is prose the
 * renderer may show; `details` carries whatever that code needs -- for
 * `cursor_expired` it is the oldest sequence still retained, which is what a
 * client needs in order to re-snapshot rather than guess.
 */
export interface DesktopErrorBody {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export class DesktopGatewayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;
  readonly correlationId: string | null;
  readonly operationId: string;

  constructor(input: {
    status: number;
    body: DesktopErrorBody;
    operationId: string;
    correlationId?: string | null;
  }) {
    super(
      `${input.operationId} failed (${input.status} ${input.body.code}): ${input.body.message}`,
    );
    this.name = "DesktopGatewayError";
    this.status = input.status;
    this.code = input.body.code;
    this.retryable = input.body.retryable ?? false;
    this.details = input.body.details ?? {};
    this.correlationId = input.correlationId ?? null;
    this.operationId = input.operationId;
  }

  /**
   * The cursor the client asked for is no longer retained.  This is a distinct
   * outcome from "no new events": `after_sequence` is exclusive over a dense
   * sequence space, so a gap is indistinguishable from loss.  The only correct
   * response is a fresh snapshot -- never an empty render.
   */
  get isCursorExpired(): boolean {
    return this.status === 409 && this.code === "cursor_expired";
  }

  get isUnauthorized(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/* ------------------------------------------------------------------ operations */

export interface DesktopOperation {
  method: "GET" | "POST" | "PATCH";
  path: string;
  /** `GET /v1/runtime` is the only route reachable before pairing. */
  public: boolean;
}

/**
 * Every operation this surface has, keyed by the `operation_id` on the Python
 * route.  `verify-desktop-surface.mts` asserts this set equals the server's
 * OpenAPI document, so a route added, removed or renamed on either side fails a
 * test instead of a user.
 */
export const DESKTOP_OPERATIONS: Record<string, DesktopOperation> = {
  getRuntimeIdentity: { method: "GET", path: "/v1/runtime", public: true },
  listWorkspaces: { method: "GET", path: "/v1/workspaces", public: false },
  openWorkspace: { method: "POST", path: "/v1/workspaces", public: false },
  listWorkspaceFiles: {
    method: "GET",
    path: "/v1/workspaces/{workspace_id}/files",
    public: false,
  },
  readWorkspaceFile: {
    method: "GET",
    path: "/v1/workspaces/{workspace_id}/file",
    public: false,
  },
  createSession: { method: "POST", path: "/v1/sessions", public: false },
  listSessions: { method: "GET", path: "/v1/sessions", public: false },
  getSession: { method: "GET", path: "/v1/sessions/{session_id}", public: false },
  updateSession: { method: "PATCH", path: "/v1/sessions/{session_id}", public: false },
  getSessionSnapshot: {
    method: "GET",
    path: "/v1/sessions/{session_id}/oaep-snapshot",
    public: false,
  },
  listSessionEvents: {
    method: "GET",
    path: "/v1/sessions/{session_id}/oaep-events",
    public: false,
  },
  streamSessionEvents: {
    method: "GET",
    path: "/v1/sessions/{session_id}/oaep-events/stream",
    public: false,
  },
  createRun: { method: "POST", path: "/v1/sessions/{session_id}/runs", public: false },
  executeRun: { method: "POST", path: "/v1/runs/{run_id}/execute", public: false },
  cancelRun: { method: "POST", path: "/v1/runs/{run_id}/cancel", public: false },
  getModelCatalog: { method: "GET", path: "/v1/config/model-catalog", public: false },
  transcribeAudio: { method: "POST", path: "/v1/audio/transcriptions", public: false },
};

export type DesktopOperationId = keyof typeof DESKTOP_OPERATIONS;

/** Discriminates the two shapes `listWorkspaceFiles` can return. */
export function isFlatFileListing(listing: WorkspaceFileListing): boolean {
  return listing.shape === "flat";
}

export type DesktopSessionEvent = OaepEvent;
export type DesktopSessionEventPage = OaepEventPage;
export type DesktopSessionSnapshot = OaepSnapshot;
