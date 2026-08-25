/**
 * The main-process implementation of the 19 IPC methods.
 *
 * This is where the wire vocabulary (`snake_case`, `session_id`, HTTP status)
 * becomes the renderer vocabulary (`camelCase`, `sessionId`, tagged results), and
 * it is the only place in the desktop tree where that translation happens.  A
 * second place would mean two definitions of "a session summary" that drift.
 *
 * Everything here is Electron-free on purpose: a `DispatchTarget` is anything
 * with `send` and `isDestroyed`, so `verify-desktop-surface.mts` drives the real
 * service against the real Runtime with a two-line fake target.  The Electron
 * binding is `ipc.ts`, which adds sender validation and nothing else.
 *
 * ## Connections, not a singleton
 *
 * Each renderer window gets its own `BridgeConnection`.  Subscriptions and the
 * bounded dispatcher belong to the window, so closing one window releases exactly
 * its own streams; the underlying HTTP subscription is shared through
 * `SessionStreamRegistry` and survives as long as another window still wants it.
 */

import { randomUUID } from "node:crypto";
import {
  BRIDGE_EVENT_CHANNEL,
  toBridgeFailure,
  type AuthSummary,
  type ChatCancelRequest,
  type ChatSendRequest,
  type ChatSendResult,
  type BridgeFailure,
  type BridgeMethod,
  type BridgeResult,
  type RuntimeSummary,
  type SessionArchiveRequest,
  type SessionCreateRequest,
  type SessionListRequest,
  type SessionRenameRequest,
  type SessionSummary,
  type VoiceTranscribeRequest,
  type VoiceTranscribeResult,
  type WorkspaceFilesRequest,
  type WorkspaceFilesResult,
  type WorkspaceFileRequest,
  type WorkspaceSummary,
} from "../../api/desktopBridge";
import {
  isFlatFileListing,
  type ModelCatalogEntry,
  type SessionRecord,
  type WorkspaceFileContent,
  type WorkspaceRecord,
} from "../../api/desktopGateway";
import type { DesktopGatewayClient } from "./client";
import { BoundedEventDispatcher, type DispatchTarget } from "./eventDispatcher";
import type { DesktopIdentity } from "./identity";
import type { DesktopRuntimeProcess } from "./runtimeProcess";
import { SessionStreamRegistry, type SessionSubscription } from "./sessionStream";

export interface BridgeDependencies {
  client: DesktopGatewayClient;
  identity: DesktopIdentity;
  runtime: DesktopRuntimeProcess;
  registry?: SessionStreamRegistry;
}

/* ------------------------------------------------------------- projections */

function toWorkspaceSummary(record: WorkspaceRecord): WorkspaceSummary {
  return {
    workspaceId: record.workspace_id,
    path: record.path,
    // The registry allows a null display name; the renderer must show something,
    // and the last path segment is what the user recognises.
    displayName: record.display_name?.trim() || basename(record.path),
    open: record.open,
    lastOpenedAt: record.last_opened_at,
  };
}

function basename(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function toSessionSummary(record: SessionRecord): SessionSummary {
  return {
    sessionId: record.session_id,
    workspaceId: record.workspace_id,
    title: record.title,
    lifecycle: record.lifecycle,
    archived: record.archived,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

/* ----------------------------------------------------------------- service */

export class BridgeService {
  readonly registry: SessionStreamRegistry;
  private readonly deps: BridgeDependencies;

  constructor(deps: BridgeDependencies) {
    this.deps = deps;
    this.registry = deps.registry ?? new SessionStreamRegistry(deps.client);
  }

  createConnection(target: DispatchTarget): BridgeConnection {
    return new BridgeConnection(this.deps, this.registry, target);
  }

  dispose(): void {
    this.registry.closeAll();
  }
}

export class BridgeConnection {
  private readonly dispatcher: BoundedEventDispatcher;
  private readonly subscriptions = new Map<string, SessionSubscription>();
  private readonly deps: BridgeDependencies;
  private readonly registry: SessionStreamRegistry;
  private disposed = false;

  constructor(
    deps: BridgeDependencies,
    registry: SessionStreamRegistry,
    target: DispatchTarget,
  ) {
    this.deps = deps;
    this.registry = registry;
    this.dispatcher = new BoundedEventDispatcher(target, BRIDGE_EVENT_CHANNEL);
  }

  /**
   * The dispatch table.  Every method returns a tagged result and none reject --
   * see the contract in `api/desktopBridge.ts` for why an IPC rejection is the
   * wrong shape for a failure the renderer has to reason about.
   */
  async invoke(method: BridgeMethod, request: unknown): Promise<BridgeResult<unknown>> {
    try {
      return { ok: true, value: await this.route(method, request) };
    } catch (error) {
      return { ok: false, error: toBridgeFailure(error) };
    }
  }

  private async route(method: BridgeMethod, request: unknown): Promise<unknown> {
    const { client, identity } = this.deps;
    switch (method) {
      case "runtime.identity":
        return this.runtimeSummary();
      case "auth.session":
        return identity.summary();
      case "auth.login":
        return identity.login();
      case "auth.logout":
        return identity.logout();

      case "workspaces.list":
        return (await client.listWorkspaces()).map(toWorkspaceSummary);
      case "workspaces.open": {
        const input = request as { path: string; displayName?: string };
        return toWorkspaceSummary(await client.openWorkspace(input.path, input.displayName));
      }
      case "workspaces.files":
        return this.workspaceFiles(request as WorkspaceFilesRequest);
      case "workspaces.readFile": {
        const input = request as WorkspaceFileRequest;
        return (await client.readWorkspaceFile(
          input.workspaceId,
          input.path,
          input.maxBytes,
        )) satisfies WorkspaceFileContent;
      }

      case "sessions.list": {
        const input = request as SessionListRequest;
        const page = await client.listSessions({
          workspace_id: input.workspaceId,
          offset: input.offset,
          limit: input.limit,
          archived: input.archived ?? false,
        });
        return page.data.map(toSessionSummary);
      }
      case "sessions.create": {
        const input = request as SessionCreateRequest;
        return toSessionSummary(await client.createSession(input.workspaceId, input.title));
      }
      case "sessions.get":
        return toSessionSummary(await client.getSession((request as { sessionId: string }).sessionId));
      case "sessions.rename": {
        const input = request as SessionRenameRequest;
        return toSessionSummary(await client.updateSession(input.sessionId, { title: input.title }));
      }
      case "sessions.archive": {
        const input = request as SessionArchiveRequest;
        return toSessionSummary(
          await client.updateSession(input.sessionId, { archived: input.archived }),
        );
      }
      case "sessions.subscribe":
        this.subscribe((request as { sessionId: string }).sessionId);
        return { subscribed: true };
      case "sessions.unsubscribe":
        this.unsubscribe((request as { sessionId: string }).sessionId);
        return { subscribed: false };

      case "chat.send":
        return this.send(request as ChatSendRequest);
      case "chat.cancel": {
        const input = request as ChatCancelRequest;
        await client.cancelRun(input.runId);
        return { cancelled: true };
      }

      case "models.catalog": {
        const catalog = await client.getModelCatalog();
        return {
          defaultAlias: catalog.default_alias ?? null,
          models: (catalog.models ?? []) as ModelCatalogEntry[],
        };
      }

      case "voice.transcribe":
        return this.transcribe(request as VoiceTranscribeRequest);

      default: {
        const exhaustive: never = method;
        throw new Error(`bridge_unhandled_method:${String(exhaustive)}`);
      }
    }
  }

  /* ---------------------------------------------------------- 1. runtime */

  private async runtimeSummary(): Promise<RuntimeSummary> {
    const state = await this.deps.runtime.refresh();
    if (state.status !== "ready") {
      return {
        reachable: false,
        runtimeId: null,
        version: null,
        surface: null,
        sourceDigest: null,
        capabilities: [],
        speechToTextReady: false,
      };
    }
    const { identity } = state;
    // The capability bit says the surface *has* the route; whether a provider
    // resolves right now is a separate question, and the microphone must be
    // hidden unless both hold.
    const speechToTextReady =
      identity.capabilities.includes("speech_to_text") && (await this.deps.identity.summary()).signedIn;
    return {
      reachable: true,
      runtimeId: identity.runtime_id,
      version: identity.version,
      surface: identity.surface,
      sourceDigest: identity.runtime_source_digest,
      capabilities: identity.capabilities,
      speechToTextReady,
    };
  }

  /* -------------------------------------------------------- 2. workspaces */

  private async workspaceFiles(input: WorkspaceFilesRequest): Promise<WorkspaceFilesResult> {
    const listing = await this.deps.client.listWorkspaceFiles(input.workspaceId, {
      path: input.path,
      depth: input.depth,
      query: input.query,
      offset: input.offset,
      max_entries: input.maxEntries,
    });
    return {
      workspaceId: listing.workspace_id,
      nodes: listing.data,
      // The server switches between a nested tree and flat matches depending on
      // the query; the renderer needs to know which it got, not infer it.
      flat: isFlatFileListing(listing),
      total: listing.total,
      nextOffset: listing.next_offset,
      truncated: listing.truncated,
    };
  }

  /* ------------------------------------------------------------ 3. streams */

  private subscribe(sessionId: string): void {
    if (this.disposed || this.subscriptions.has(sessionId)) return;
    const subscription = this.registry.subscribe(sessionId, (event) => this.dispatcher.push(event));
    this.subscriptions.set(sessionId, subscription);
  }

  private unsubscribe(sessionId: string): void {
    this.subscriptions.get(sessionId)?.close();
    this.subscriptions.delete(sessionId);
  }

  /* --------------------------------------------------------------- 4. chat */

  /**
   * One user turn: create the run, then start it.
   *
   * These are fused deliberately.  A renderer able to call them separately could
   * leave a created-but-never-executed run in the history -- a turn that renders
   * as an empty bubble forever, with no UI anywhere to clear it.
   *
   * The subscription is established *before* execute, which is the ordering the
   * 202 contract depends on: the run's events go to the journal the moment the
   * Agent starts, and a client that subscribes afterwards would have to rely on
   * replay to catch the opening tokens.  Replay would work -- that is the point
   * of the durable stream -- but it would make every first token arrive late, and
   * the race window is free to close.
   */
  private async send(input: ChatSendRequest): Promise<ChatSendResult> {
    const { client } = this.deps;
    this.subscribe(input.sessionId);
    const { run, created } = await client.createRun(input.sessionId, input.clientMessageId);
    await client.executeRun(run.run_id, {
      prompt: input.prompt,
      modelAlias: input.modelAlias ?? null,
      sourceMessageId: input.clientMessageId,
    });
    return { runId: run.run_id, status: run.status, created };
  }

  /* -------------------------------------------------------------- 5. voice */

  private async transcribe(input: VoiceTranscribeRequest): Promise<VoiceTranscribeResult> {
    const result = await this.deps.client.transcribeAudio({
      audio: new Uint8Array(input.audio),
      filename: input.filename || `recording-${randomUUID().slice(0, 8)}.webm`,
      media_type: input.mediaType || "application/octet-stream",
      language: input.language,
    });
    return { text: result.text, language: result.language ?? null };
  }

  /* ------------------------------------------------------------- teardown */

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const subscription of this.subscriptions.values()) subscription.close();
    this.subscriptions.clear();
    this.dispatcher.close();
  }

  /** Test seam: flush the dispatcher without waiting for the event loop. */
  flush(): void {
    this.dispatcher.flush();
  }

  get metrics(): { sent: number; merged: number; dropped: number; sessions: number } {
    return { ...this.dispatcher.metrics, sessions: this.subscriptions.size };
  }
}

export type { BridgeFailure };
export type { AuthSummary };
