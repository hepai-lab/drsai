/**
 * The IPC contract between the Electron main process and the renderer.
 *
 * ## Why this layer exists at all
 *
 * `v2-minimal-surface.zh-CN.md` §4 leaves one question open: *how does the
 * gateway token reach the renderer?*  The two candidate answers were "renderer
 * talks to the Runtime directly" and "the token never leaves the main process",
 * and they are mutually exclusive.
 *
 * **This contract settles it: the renderer never speaks HTTP.**
 *
 * The reason is not stylistic.  `x-opendrsai-gateway-token` is the proof that a
 * caller is the paired local process; the HepAI bearer token is the user's actual
 * credential.  A renderer that holds either one puts both inside a JavaScript
 * context that also renders model output, remote markdown and (via previews)
 * untrusted file content.  Handing a short-lived token down instead would mean
 * inventing a second token lifecycle -- issue, refresh, revoke, and a failure
 * mode for each -- to buy nothing the renderer can use: it still could not reach
 * a route the main process would refuse, because the main process is what the
 * Runtime authenticated in the first place.
 *
 * So the renderer's whole vocabulary is below.  Seven invoke domains, one push
 * channel.  Anything not here, the renderer cannot ask for.
 *
 * ## Naming
 *
 * This file is camelCase where `./wire.ts` is snake_case, and that boundary is
 * deliberate: the wire types describe bytes the network inspector shows, these
 * describe values React components hold.  Translation happens in exactly one
 * place -- `shared/main/desktopGateway/ipc.ts` -- so a field that appears in both
 * shapes can be traced by grepping for either spelling.
 */

import type {
  DesktopCapability,
  ModelCatalogEntry,
  OaepItem,
  RunStatus,
  SessionLifecycle,
  WorkspaceFileContent,
  WorkspaceFileNode,
} from "./wire";

/* ------------------------------------------------------------------ channels */

/**
 * Channel names.  The `drsai:bridge:` prefix keeps them disjoint from the ~200 legacy
 * `desktop:*` channels, so both surfaces can be registered on one `ipcMain`
 * during the migration without a name collision silently routing a bridge call into
 * a legacy handler.
 */
export const BRIDGE_INVOKE_CHANNEL = "drsai:bridge:invoke";

/** The single push channel. Every streamed update arrives here. */
export const BRIDGE_EVENT_CHANNEL = "drsai:bridge:session-event";

/**
 * One invoke channel carrying a tagged request, rather than ~20 named channels.
 *
 * The reason is auditability: a single `ipcMain.handle` is one place to enforce
 * the sender check, and `verify-desktop-surface.mts` can assert that the set of
 * handled methods equals `BRIDGE_METHODS` exactly.  With per-name channels
 * an unregistered method is a silent "no handler" rejection at runtime; here it
 * is a test failure.
 */
export const BRIDGE_METHODS = [
  "runtime.identity",
  "auth.session",
  "auth.login",
  "auth.logout",
  "workspaces.list",
  "workspaces.open",
  "workspaces.files",
  "workspaces.readFile",
  "sessions.list",
  "sessions.create",
  "sessions.get",
  "sessions.rename",
  "sessions.archive",
  "sessions.subscribe",
  "sessions.unsubscribe",
  "chat.send",
  "chat.cancel",
  "models.catalog",
  "voice.transcribe",
] as const;

export type BridgeMethod = (typeof BRIDGE_METHODS)[number];

/* ------------------------------------------------------------------- results */

/**
 * Every invoke resolves; none reject.
 *
 * An IPC rejection crosses the process boundary as a plain `Error` whose `name`,
 * `code` and `details` are flattened into a message string, so the renderer would
 * have to parse prose to tell "session is gone" from "the network blinked".
 * Returning a tagged failure keeps the machine-readable parts machine-readable,
 * which is what `retryable` and `code` are for.
 */
export type BridgeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: BridgeFailure };

export interface BridgeFailure {
  code: string;
  message: string;
  retryable: boolean;
  /** HTTP status when the failure came from the gateway; 0 for local failures. */
  status: number;
  details?: Record<string, unknown>;
  correlationId?: string | null;
}

/* -------------------------------------------------------- 1. runtime + identity */

export interface RuntimeSummary {
  reachable: boolean;
  runtimeId: string | null;
  version: string | null;
  surface: string | null;
  sourceDigest: string | null;
  capabilities: DesktopCapability[];
  /**
   * True only when the surface advertises the capability *and* a provider
   * currently resolves.  The microphone button is hidden unless this holds --
   * offering a control that always fails is worse than not offering it.
   */
  speechToTextReady: boolean;
}

/**
 * Feature 2.4 (个人信息).  These are OIDC claims the main process already holds;
 * no gateway route is involved, which is why this is the only domain here with no
 * counterpart in `wire.ts`.
 */
export interface AuthSummary {
  signedIn: boolean;
  userId: string | null;
  displayName: string | null;
  email: string | null;
  /** Epoch milliseconds; the renderer shows a re-login hint as it approaches. */
  expiresAt: number | null;
}

/* -------------------------------------------------------------- 2. workspaces */

export interface WorkspaceSummary {
  workspaceId: string;
  path: string;
  displayName: string;
  open: boolean;
  lastOpenedAt: string | null;
}

export interface WorkspaceFilesRequest {
  workspaceId: string;
  path?: string;
  depth?: number;
  query?: string;
  offset?: number;
  maxEntries?: number;
}

export interface WorkspaceFilesResult {
  workspaceId: string;
  /** Nested when browsing, flat when `query` or `offset` was supplied. */
  nodes: WorkspaceFileNode[];
  flat: boolean;
  total: number;
  nextOffset: number | null;
  truncated: boolean;
}

export interface WorkspaceFileRequest {
  workspaceId: string;
  path: string;
  maxBytes?: number;
}

/* ---------------------------------------------------------------- 3. sessions */

export interface SessionSummary {
  sessionId: string;
  workspaceId: string;
  title: string;
  lifecycle: SessionLifecycle;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionListRequest {
  workspaceId: string;
  offset?: number;
  limit?: number;
  /**
   * Filters; there is no "both". See `SessionListQuery` in `wire.ts` -- the
   * gateway's `bool | None` cannot receive null over a query string, so a
   * history view that shows archived and active together makes two calls.
   */
  archived?: boolean;
}

export interface SessionCreateRequest {
  workspaceId: string;
  title?: string;
}

export interface SessionRenameRequest {
  sessionId: string;
  title: string;
}

export interface SessionArchiveRequest {
  sessionId: string;
  archived: boolean;
}

/**
 * Subscribing is what starts the event stream for a session.  It is separate from
 * `sessions.get` because a window may hold several sessions open in tabs while
 * streaming only the visible one, and because the subscription -- not the fetch --
 * is what must survive a reconnect.
 */
export interface SessionSubscribeRequest {
  sessionId: string;
}

/* -------------------------------------------------------------------- 4. chat */

/**
 * One user turn.  This is `createRun` + `executeRun` fused, because a renderer
 * that could call them separately could also leave a created-but-never-executed
 * run in the history -- a turn that renders as an empty bubble forever.
 *
 * `clientMessageId` is the idempotency key.  The renderer generates it when the
 * user presses Enter, so a retry after a dropped IPC reply lands on the same run
 * instead of asking the model twice.
 */
export interface ChatSendRequest {
  sessionId: string;
  prompt: string;
  clientMessageId: string;
  modelAlias?: string | null;
}

export interface ChatSendResult {
  runId: string;
  status: RunStatus;
  /** False when the idempotency key matched an existing run (a retry landed). */
  created: boolean;
}

export interface ChatCancelRequest {
  runId: string;
}

/* ------------------------------------------------------------------- 5. voice */

export interface VoiceTranscribeRequest {
  /** Raw recording bytes. Transferred as an ArrayBuffer over the bridge. */
  audio: ArrayBuffer;
  filename: string;
  mediaType: string;
  language?: string;
}

export interface VoiceTranscribeResult {
  text: string;
  language: string | null;
}

/* --------------------------------------------------------- 6. streamed events */

/**
 * Stream phase, surfaced so the UI can distinguish "quiet" from "broken".
 *
 * `degraded` is the one worth explaining: it means the stream failed in a way
 * retrying will not fix (the session was deleted, the Runtime is a different
 * build), so the renderer should stop showing a spinner and say so.  A client
 * that treats every failure as retryable spins forever on a session that no
 * longer exists.
 */
export type SessionStreamPhase =
  | "idle"
  | "snapshot"
  | "replay"
  | "connected"
  | "retrying"
  | "degraded"
  | "closed";

/**
 * The push payload union.
 *
 * `snapshot` is authoritative and replaces state; `items` is incremental;
 * `delta` is presentation-only.  That last distinction is the important one:
 * deltas may be dropped under backpressure (see `BoundedEventDispatcher`), so a
 * renderer must never treat accumulated deltas as the message.  The text that
 * survives is whatever the next `items` or `snapshot` carries.
 */
export type BridgeSessionEvent =
  | {
      kind: "snapshot";
      sessionId: string;
      items: OaepItem[];
      runs: SessionRunState[];
      cursor: number;
    }
  | { kind: "items"; sessionId: string; items: OaepItem[]; cursor: number }
  | { kind: "run"; sessionId: string; run: SessionRunState; cursor: number }
  | {
      kind: "delta";
      sessionId: string;
      itemId: string;
      /** `message` drives the bubble, `reasoning` the thinking pane. */
      channel: "message" | "reasoning" | "output";
      text: string;
    }
  | { kind: "phase"; sessionId: string; phase: SessionStreamPhase }
  | { kind: "error"; sessionId: string; error: BridgeFailure; fatal: boolean };

export interface SessionRunState {
  runId: string;
  status: RunStatus;
  updatedAt: string;
}

/* -------------------------------------------------------------- 7. the bridge */

/**
 * What `contextBridge` exposes as `window.drsai`.  This interface is the entire
 * attack surface the renderer has; everything it can do to the machine, it does
 * through one of these methods.
 */
export interface DesktopBridge {
  runtime: {
    identity(): Promise<BridgeResult<RuntimeSummary>>;
  };
  auth: {
    session(): Promise<BridgeResult<AuthSummary>>;
    login(): Promise<BridgeResult<AuthSummary>>;
    logout(): Promise<BridgeResult<AuthSummary>>;
  };
  workspaces: {
    list(): Promise<BridgeResult<WorkspaceSummary[]>>;
    open(input: { path: string; displayName?: string }): Promise<BridgeResult<WorkspaceSummary>>;
    files(input: WorkspaceFilesRequest): Promise<BridgeResult<WorkspaceFilesResult>>;
    readFile(input: WorkspaceFileRequest): Promise<BridgeResult<WorkspaceFileContent>>;
  };
  sessions: {
    list(input: SessionListRequest): Promise<BridgeResult<SessionSummary[]>>;
    create(input: SessionCreateRequest): Promise<BridgeResult<SessionSummary>>;
    get(input: { sessionId: string }): Promise<BridgeResult<SessionSummary>>;
    rename(input: SessionRenameRequest): Promise<BridgeResult<SessionSummary>>;
    archive(input: SessionArchiveRequest): Promise<BridgeResult<SessionSummary>>;
    subscribe(input: SessionSubscribeRequest): Promise<BridgeResult<{ subscribed: true }>>;
    unsubscribe(input: SessionSubscribeRequest): Promise<BridgeResult<{ subscribed: false }>>;
  };
  chat: {
    send(input: ChatSendRequest): Promise<BridgeResult<ChatSendResult>>;
    cancel(input: ChatCancelRequest): Promise<BridgeResult<{ cancelled: boolean }>>;
  };
  models: {
    catalog(): Promise<BridgeResult<{ defaultAlias: string | null; models: ModelCatalogEntry[] }>>;
  };
  voice: {
    transcribe(input: VoiceTranscribeRequest): Promise<BridgeResult<VoiceTranscribeResult>>;
  };
  /** Returns an unsubscribe function; the renderer must call it on unmount. */
  onSessionEvent(listener: (event: BridgeSessionEvent) => void): () => void;
}

/** Maps each method name to its request and response types, for the dispatcher. */
export interface BridgeMethodMap {
  "runtime.identity": { request: void; response: RuntimeSummary };
  "auth.session": { request: void; response: AuthSummary };
  "auth.login": { request: void; response: AuthSummary };
  "auth.logout": { request: void; response: AuthSummary };
  "workspaces.list": { request: void; response: WorkspaceSummary[] };
  "workspaces.open": {
    request: { path: string; displayName?: string };
    response: WorkspaceSummary;
  };
  "workspaces.files": { request: WorkspaceFilesRequest; response: WorkspaceFilesResult };
  "workspaces.readFile": { request: WorkspaceFileRequest; response: WorkspaceFileContent };
  "sessions.list": { request: SessionListRequest; response: SessionSummary[] };
  "sessions.create": { request: SessionCreateRequest; response: SessionSummary };
  "sessions.get": { request: { sessionId: string }; response: SessionSummary };
  "sessions.rename": { request: SessionRenameRequest; response: SessionSummary };
  "sessions.archive": { request: SessionArchiveRequest; response: SessionSummary };
  "sessions.subscribe": { request: SessionSubscribeRequest; response: { subscribed: true } };
  "sessions.unsubscribe": { request: SessionSubscribeRequest; response: { subscribed: false } };
  "chat.send": { request: ChatSendRequest; response: ChatSendResult };
  "chat.cancel": { request: ChatCancelRequest; response: { cancelled: boolean } };
  "models.catalog": {
    request: void;
    response: { defaultAlias: string | null; models: ModelCatalogEntry[] };
  };
  "voice.transcribe": { request: VoiceTranscribeRequest; response: VoiceTranscribeResult };
}

export function isBridgeMethod(value: unknown): value is BridgeMethod {
  return typeof value === "string" && (BRIDGE_METHODS as readonly string[]).includes(value);
}

/** Normalises anything thrown in the main process into a transferable failure. */
export function toBridgeFailure(error: unknown): BridgeFailure {
  if (error && typeof error === "object" && "code" in error && "status" in error) {
    const typed = error as {
      code: unknown;
      status: unknown;
      message?: unknown;
      retryable?: unknown;
      details?: unknown;
      correlationId?: unknown;
    };
    return {
      code: String(typed.code),
      message: String(typed.message ?? "Request failed."),
      retryable: typed.retryable === true,
      status: Number(typed.status) || 0,
      details: (typed.details as Record<string, unknown>) ?? undefined,
      correlationId: (typed.correlationId as string | null) ?? null,
    };
  }
  return {
    code: "bridge_internal_error",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
    status: 0,
  };
}
