import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ConnectRemoteWorkspaceRequest, DesktopForkWorktreeResult, DesktopGitCommitApprovalRequest, DesktopThread, DesktopThreadContentSearchRequest, DesktopThreadContentSearchResult, DesktopThreadSnapshot, RemoteDirectoryEntry, RemoteHepaiWorker, RemoteSshDiagnosticReport, RemoteWorkspaceStatus, WorkspaceCheckpoint, WorkspaceCheckpointAcceptRequest, WorkspaceCheckpointCreateRequest, WorkspaceCheckpointPreviewRequest, WorkspaceCheckpointPreviewResult, WorkspaceCheckpointRestoreRequest, WorkspaceCheckpointRestoreResult, WorkspaceContextOverview, WorkspaceFileChangeEvent, WorkspaceFilePreview, WorkspaceFilePreviewRequest, WorkspaceFileTreeRequest, WorkspaceFileTreeResult, WorkspaceFileWriteRequest, WorkspaceFileWriteResult, WorkspaceFolderSummaryRequest, WorkspaceFolderSummaryResult, WorkspaceGitDiffRequest, WorkspaceGitDiffResult, WorkspaceGitFileAtRefRequest, WorkspaceGitFileAtRefResult, WorkspaceProject } from "../api/desktopApi";
import { createRemoteWorkspace, findWorkspaceById, listWorkspaces, setRemoteWorkspaceAutoReconnect } from "./workspaces";
import { createSystemRemoteGatewayTransport } from "./remoteGatewayInstaller";
import { shouldRestorePersistedRemoteWorkspace } from "./remoteWorkspaceRestorePolicy";
import { sshHostService } from "./sshHosts";
import { projectRuntimeThreadSnapshot } from "./threadRuntimeProjection";
import type { RuntimeConversationSnapshot } from "./runtimeClient";

export interface RemoteWorkspaceSessionPort {
  open(request: ConnectRemoteWorkspaceRequest): Promise<{ workspaceId: string; canonicalPath: string; hostAlias: string; localPort: number; baseUrl: string; token: string; runtimeId: string; instanceId: string; gatewayVersion?: string; protocolVersion: number; capabilities: Record<string, number>; close(): Promise<void>; request<T>(path: string, init?: RequestInit): Promise<T> }>;
  listDirectories?(hostAlias: string, path: string): Promise<RemoteDirectoryEntry[]>;
}
type Opened = Awaited<ReturnType<RemoteWorkspaceSessionPort["open"]>>;
type Session = { opened: Opened; status: RemoteWorkspaceStatus; generation: number; threadIds: Set<string>; createdAt: number; ownsTransport: boolean; events: Array<{ at: string; phase: string; message?: string }> };
export class RemoteGatewayHttpError extends Error { constructor(readonly status: number, readonly body: unknown) { super(`Remote Gateway request failed (${status}).`); } }

export class RemoteWorkspaceController {
  readonly #port: RemoteWorkspaceSessionPort;
  readonly #sessions = new Map<string, Session>();
  readonly #flights = new Map<string, Promise<WorkspaceProject>>();
  readonly #threads = new Map<string, { workspaceId: string; thread: DesktopThread }>();
  readonly #fileWatchers = new Map<string, WebSocket>();
  readonly #fileWatchCursors = new Map<string, number>();
  readonly #fileWatchRetries = new Map<string, NodeJS.Timeout>();
  #publisher?: (status: RemoteWorkspaceStatus) => void;
  #filePublisher?: (event: WorkspaceFileChangeEvent) => void;
  #closed = false;
  constructor(port: RemoteWorkspaceSessionPort) { this.#port = port; }
  setPublisher(publisher: (status: RemoteWorkspaceStatus) => void): void { this.#publisher = publisher; }
  setFilePublisher(publisher: (event: WorkspaceFileChangeEvent) => void): void { this.#filePublisher = publisher; }
  getAccess(workspacePathOrId?: string, workspaceId?: string): { baseUrl: string; token: string; workspaceId: string } | null {
    const id = workspaceId || (workspacePathOrId && this.#sessions.has(workspacePathOrId) ? workspacePathOrId : undefined);
    const matches = id ? [[id, this.#sessions.get(id)] as const] : [...this.#sessions.entries()].filter(([, session]) => session.opened.canonicalPath === workspacePathOrId);
    if (matches.length !== 1) return null; const [matchedId, session] = matches[0];
    return session?.status.connected && session.status.gatewayReady ? { baseUrl: session.opened.baseUrl, token: session.opened.token, workspaceId: matchedId } : null;
  }
  async resolveTarget(workspacePath?: string, workspaceId?: string): Promise<"remote_online" | "remote_offline" | "local_or_unknown"> {
    const workspace = workspaceId ? await findWorkspaceById(workspaceId) : undefined;
    const remote = workspace?.location === "remote" || [...this.#sessions.values()].some((session) => session.opened.canonicalPath === workspacePath);
    if (!remote) return "local_or_unknown"; return this.getAccess(workspacePath, workspaceId) ? "remote_online" : "remote_offline";
  }
  resolvePathTarget(path: string): "remote_online" | "remote_offline" | "local_or_unknown" {
    const matches = [...this.#sessions.values()].filter((session) => path === session.opened.canonicalPath || path.startsWith(`${session.opened.canonicalPath}/`));
    if (matches.length !== 1) return "local_or_unknown";
    return matches[0].status.connected && matches[0].status.gatewayReady ? "remote_online" : "remote_offline";
  }
  bindThread(threadId: string, workspaceId: string, runtimeSessionId = threadId): void { const session = this.#sessions.get(workspaceId); if (!session || !/^[A-Za-z0-9_.:-]{1,200}$/.test(threadId) || !/^[A-Za-z0-9_.:-]{1,200}$/.test(runtimeSessionId)) return; session.threadIds.add(threadId); if (!this.#threads.has(threadId)) { const now = new Date().toISOString(); this.#threads.set(threadId, { workspaceId, thread: { id: threadId, kind: "chat", title: "Remote session", workspacePath: session.opened.canonicalPath, runtimeSessionId, createdAt: now, updatedAt: now, status: "running", messageCount: 0 } }); } }
  async listDirectories(rawAlias: unknown, rawPath: unknown = "~"): Promise<RemoteDirectoryEntry[]> {
    const alias = assertId(rawAlias, "SSH host alias"); if (!/^[A-Za-z0-9_.@-]{1,128}$/.test(alias)) throw new Error("SSH host alias is invalid.");
    if (typeof rawPath !== "string" || !rawPath || rawPath.length > 4096 || /[\r\n\0]/.test(rawPath)) throw new Error("Remote directory path is invalid.");
    if (!this.#port.listDirectories) throw new Error("Remote directory transport is unavailable."); return this.#port.listDirectories(alias, rawPath);
  }

  async connect(raw: unknown): Promise<WorkspaceProject> {
    if (this.#closed) throw new Error("Remote Workspace controller is shutting down.");
    const request = validateConnectRequest(raw); const key = `${request.hostAlias}\0${request.path}`;
    const existing = [...this.#sessions.values()].find((session) => session.opened.hostAlias === request.hostAlias && session.opened.canonicalPath === request.path);
    if (existing) return (await findWorkspaceById(existing.opened.workspaceId))!;
    const inFlight = this.#flights.get(key); if (inFlight) return inFlight;
    const flight = this.#connect(request).finally(() => this.#flights.delete(key)); this.#flights.set(key, flight); return flight;
  }
  async disconnect(rawId: unknown): Promise<boolean> {
    const id = assertId(rawId, "Remote workspace id"); const session = this.#sessions.get(id);
    if (!session) { await setRemoteWorkspaceAutoReconnect(id, false); return false; }
    const linked = session.ownsTransport ? [...this.#sessions.entries()].filter(([, item]) => item.opened.baseUrl === session.opened.baseUrl && item.opened.hostAlias === session.opened.hostAlias) : [[id, session] as const];
    for (const [linkedId, linkedSession] of linked) { this.#sessions.delete(linkedId); this.#clearWorkspaceThreads(linkedId); this.#stopFileWatcher(linkedId); linkedSession.threadIds.clear(); await setRemoteWorkspaceAutoReconnect(linkedId, false); this.#publisher?.({ ...linkedSession.status, connected: false, gatewayReady: false, connectionState: "disconnected", localPort: undefined }); }
    if (session.ownsTransport) await session.opened.close(); return true;
  }
  async status(rawId: unknown): Promise<RemoteWorkspaceStatus> {
    const id = assertId(rawId, "Remote workspace id"); const session = this.#sessions.get(id);
    if (!session) { const workspace = await findWorkspaceById(id); if (!workspace?.remote) throw new Error("Remote workspace not found."); return { ...workspace.remote, connected: false, gatewayReady: false, connectionState: "disconnected" }; }
    try {
      const identity = await session.opened.request<{ runtime_id?: string; instance_id?: string; gateway_version?: string; protocol_version?: number; capability_versions?: Record<string, number> }>("/v1/remote/handshake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ protocol_version: 1, workspace_path: session.status.canonicalPath }) });
      if (!identity.runtime_id || !identity.instance_id || identity.protocol_version !== 1) throw new Error("Remote Gateway identity response is invalid.");
      if (identity.runtime_id !== session.status.runtimeId || identity.instance_id !== session.status.instanceId) { session.generation += 1; session.threadIds.clear(); this.#clearWorkspaceThreads(id); session.status = { ...session.status, runtimeId: identity.runtime_id, instanceId: identity.instance_id, gatewayVersion: identity.gateway_version, protocolVersion: identity.protocol_version, capabilities: identity.capability_versions ?? {}, connectionState: "ready", connected: true, gatewayReady: true }; this.#publisher?.(session.status); }
      return { ...session.status };
    } catch (error) { session.status = { ...session.status, connected: false, gatewayReady: false, connectionState: "degraded", error: safeMessage(error), failureKind: "runtime" }; this.#publisher?.(session.status); return { ...session.status }; }
  }
  diagnostics(): RemoteSshDiagnosticReport {
    const now = Date.now();
    return {
      generatedAt: new Date(now).toISOString(),
      hosts: [...this.#sessions.values()].map((session) => ({
        hostAlias: session.status.hostAlias,
        state: session.status.connectionState,
        phase: session.events.at(-1)?.phase ?? session.status.connectionState,
        ...(session.status.failureKind ? { failureKind: session.status.failureKind } : {}),
        ...(session.status.error ? { error: safeMessage(session.status.error) } : {}),
        workspaceCount: 1,
        gatewayVersion: session.status.gatewayVersion,
        protocolVersion: session.status.protocolVersion,
        reconnectAttempts: 0,
        reconnectCount: 0,
        ageMs: Math.max(0, now - session.createdAt),
        events: session.events.map((event) => ({ ...event })),
      })),
    };
  }
  async listThreads(rawId: unknown): Promise<DesktopThread[]> {
    const session = this.#requireReady(rawId); let payload: { data?: Array<Record<string, unknown>> };
    try { payload = await session.opened.request(`/v1/sessions?workspace_id=${encodeURIComponent(session.opened.workspaceId)}&limit=100`); }
    catch (error) { if (!(error instanceof RemoteGatewayHttpError) || error.status !== 404) throw error; payload = await session.opened.request(`/v1/threads?workspace_id=${encodeURIComponent(session.opened.workspaceId)}&limit=100`); }
    const threads = (payload.data ?? []).flatMap((row) => { const id = typeof row.session_id === "string" ? row.session_id : typeof row.thread_id === "string" ? row.thread_id : ""; if (!id) return []; session.threadIds.add(id); const updated = typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(); const created = typeof row.created_at === "string" ? row.created_at : updated; const thread: DesktopThread = { id, kind: "chat", title: typeof row.title === "string" ? row.title : typeof row.name === "string" ? row.name : "Remote session", workspacePath: session.opened.canonicalPath, runtimeSessionId: id, createdAt: created, updatedAt: updated, status: row.status === "running" ? "running" : "idle", messageCount: typeof row.message_count === "number" ? row.message_count : 0 }; this.#threads.set(id, { workspaceId: session.opened.workspaceId, thread }); return [thread]; });
    return threads.slice(0, 100);
  }
  async getThreadSnapshot(rawThreadId: unknown): Promise<DesktopThreadSnapshot | null> {
    const threadId = assertId(rawThreadId, "Remote thread id"); const binding = this.#threads.get(threadId); if (!binding) return null;
    const session = this.#sessions.get(binding.workspaceId); if (!session?.status.connected || !session.status.gatewayReady) return null;
    try {
      const snapshot = await session.opened.request<RuntimeConversationSnapshot>(`/v1/sessions/${encodeURIComponent(binding.thread.runtimeSessionId ?? threadId)}/conversation-snapshot`);
      return projectRuntimeThreadSnapshot(binding.thread, snapshot.items ?? []);
    } catch (error) {
      if (!(error instanceof RemoteGatewayHttpError) || error.status !== 404) throw error;
    }
    try {
      const payload = await session.opened.request<{ name?: string; messages?: Array<{ role?: string; content?: string }> }>(`/v1/threads/${encodeURIComponent(threadId)}`);
      const now = Date.now(); const messages = (payload.messages ?? []).slice(0, 10_000).map((message, index) => { const role: "user" | "assistant" | "system" = message.role === "assistant" || message.role === "system" ? message.role : "user"; return { id: `${threadId}-${index}`, role, content: String(message.content ?? ""), startedAt: now, lastEventAt: now }; });
      return { threadId, title: payload.name || binding.thread.title, messages, updatedAt: now, messageCount: messages.length };
    } catch (error) { if (error instanceof RemoteGatewayHttpError && error.status === 404) return null; throw error; }
  }
  async searchThreadMessages(request: DesktopThreadContentSearchRequest): Promise<DesktopThreadContentSearchResult[]> {
    if (!request || typeof request.query !== "string" || !request.query.trim() || request.query.length > 500) throw new Error("Thread search query is invalid.");
    const ids = (request.threadIds ?? [...this.#threads.keys()]).filter((id) => this.#threads.has(id)); const query = request.query.toLocaleLowerCase(); const limit = Math.max(1, Math.min(100, Math.floor(request.limit ?? 24))); const results: DesktopThreadContentSearchResult[] = [];
    for (const threadId of ids) { const snapshot = await this.getThreadSnapshot(threadId); const message = [...(snapshot?.messages ?? [])].reverse().find((item) => item.content.toLocaleLowerCase().includes(query)); if (message && snapshot) results.push({ threadId, messageId: message.id, role: message.role, snippet: message.content.slice(0, 180), updatedAt: snapshot.updatedAt }); if (results.length >= limit) break; }
    return results;
  }
  async listWorkers(rawId: unknown): Promise<RemoteHepaiWorker[]> {
    const session = this.#requireReady(rawId); const payload = await session.opened.request<{ data?: Array<Record<string, unknown>> }>("/v1/hepai/workers");
    return (payload.data ?? []).slice(0, 200).map((row, index) => ({ id: String(row.id || row.model || `worker-${index}`), name: String(row.name || row.id || row.model || `Worker ${index + 1}`), description: typeof row.description === "string" ? row.description : undefined, enabled: row.enabled !== false, callables: Array.isArray(row.callables) ? row.callables.map(String).slice(0, 100) : [], status: row.status === "available" || row.status === "disabled" ? row.status : "unavailable" }));
  }
  async setWorkerState(rawId: unknown, rawWorkerId: unknown, rawEnabled: unknown): Promise<boolean> {
    const session = this.#requireReady(rawId); const workerId = assertWorkerId(rawWorkerId); if (typeof rawEnabled !== "boolean") throw new Error("Remote worker enabled state is invalid.");
    await session.opened.request(`/v1/hepai/workers/${encodeURIComponent(workerId)}/state`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: rawEnabled }) }); return true;
  }
  async contextOverview(workspacePath: string, workspaceId?: string): Promise<WorkspaceContextOverview> { return this.#workspaceRequest(workspacePath, workspaceId, "/context"); }
  async listFiles(request: WorkspaceFileTreeRequest): Promise<WorkspaceFileTreeResult> {
    this.#ensureFileWatcher(request.workspacePath, request.workspaceId);
    const session = this.#sessionFor(request.workspacePath, request.workspaceId); const parameters = new URLSearchParams({ depth: String(Math.max(0, Math.min(5, request.maxDepth ?? 2))), max_entries: String(Math.max(1, Math.min(5_000, request.maxEntries ?? 500))), offset: String(Math.max(0, request.offset ?? 0)) }); if (request.query) parameters.set("query", request.query.slice(0, 240));
    const payload = await session.opened.request<{ data?: Array<Record<string, unknown>>; total?: number; truncated?: boolean; next_offset?: number | null }>(this.#workspacePath(session, `/files?${parameters}`)); let count = 0;
    const mapNode = (row: Record<string, unknown>): WorkspaceFileTreeResult["nodes"][number] => { count += 1; const relativePath = String(row.path || "").replace(/^[/\\]+/, ""); const directory = row.directory === true; const gitStatus = ["modified", "added", "deleted", "renamed", "untracked", "clean"].includes(String(row.git_status)) ? row.git_status as "modified" | "added" | "deleted" | "renamed" | "untracked" | "clean" : undefined; return { name: String(row.name || "").slice(0, 512), path: `${request.workspacePath}/${relativePath}`, relativePath, type: directory ? "directory" : "file", size: typeof row.size === "number" ? row.size : undefined, modifiedAt: typeof row.modified_at === "number" ? new Date(row.modified_at * 1000).toISOString() : undefined, gitStatus, children: Array.isArray(row.children) ? row.children.slice(0, 5_000).map((child) => mapNode(child as Record<string, unknown>)) : undefined }; };
    const nodes = (payload.data ?? []).slice(0, 5_000).map(mapNode); return { workspacePath: request.workspacePath, nodes, totalEntries: payload.total ?? count, truncated: payload.truncated === true, stale: false, ...(typeof payload.next_offset === "number" ? { nextOffset: payload.next_offset } : {}) };
  }
  async previewFile(request: WorkspaceFilePreviewRequest): Promise<WorkspaceFilePreview> {
    const session = this.#sessionFor(request.workspacePath, request.workspaceId); const relative = relativeRemotePath(request.workspacePath, request.path); const maxBytes = Math.max(1, Math.min(2 * 1024 * 1024, request.maxBytes ?? 262_144));
    const payload = await session.opened.request<{ path: string; content?: string; data_url?: string; mime?: string; modified_at?: number; truncated?: boolean; size?: number; sha256?: string }>(this.#workspacePath(session, `/file?path=${encodeURIComponent(relative)}&max_bytes=${maxBytes}`)); const path = String(payload.path || relative); const kind = payload.data_url ? (payload.mime?.startsWith("image/") ? "image" : "binary") : "text";
    return { workspacePath: request.workspacePath, path: request.path, relativePath: path, name: path.split("/").pop() || path, kind, mime: payload.mime || "text/plain", size: Number(payload.size ?? 0), modifiedAt: new Date(Number(payload.modified_at ?? 0) * 1000).toISOString(), truncated: payload.truncated === true, stale: false, fileHash: payload.sha256, content: payload.content, dataUrl: payload.data_url, mode: request.mode || "auto" };
  }
  async folderSummary(request: WorkspaceFolderSummaryRequest): Promise<WorkspaceFolderSummaryResult> {
    const session = this.#sessionContaining(request.path);
    const relative = relativeRemotePath(session.opened.canonicalPath, request.path);
    return session.opened.request(this.#workspacePath(session, `/folder-summary?path=${encodeURIComponent(relative)}&max_entries=${Math.max(1, Math.min(5_000, request.maxEntries ?? 500))}&max_sample_files=${Math.max(0, Math.min(100, request.maxSampleFiles ?? 20))}&max_chars=${Math.max(1_000, Math.min(200_000, request.maxChars ?? 20_000))}`));
  }
  async gitDiff(request: WorkspaceGitDiffRequest): Promise<WorkspaceGitDiffResult> { const session = this.#sessionFor(request.workspacePath, request.workspaceId); const relative = request.path ? relativeRemotePath(request.workspacePath, request.path) : ""; const payload = await session.opened.request<{ diff?: string; staged?: boolean }>(this.#workspacePath(session, `/git/diff?staged=${request.staged === true}${relative ? `&path=${encodeURIComponent(relative)}` : ""}`)); const full = String(payload.diff || ""); const diff = full.slice(0, Math.max(1_000, Math.min(1_000_000, request.maxChars ?? 200_000))); return { workspacePath: request.workspacePath, path: request.path, diff, diffHash: createHash("sha256").update(full).digest("hex"), truncated: diff.length < full.length, staged: payload.staged === true, stale: false }; }
  async gitFileAtRef(request: WorkspaceGitFileAtRefRequest): Promise<WorkspaceGitFileAtRefResult> { const session = this.#sessionFor(request.workspacePath, request.workspaceId); const relative = relativeRemotePath(request.workspacePath, request.path); if (!/^[A-Za-z0-9_./@{}^~:-]{1,240}$/.test(request.ref)) throw new Error("Remote Git ref is invalid."); return session.opened.request(this.#workspacePath(session, `/git/file-at-ref?ref=${encodeURIComponent(request.ref)}&path=${encodeURIComponent(relative)}&max_bytes=${Math.max(1, Math.min(2 * 1024 * 1024, request.maxBytes ?? 262_144))}`)); }
  async writeFile(request: WorkspaceFileWriteRequest): Promise<WorkspaceFileWriteResult> {
    if (request.mode === "save_as") throw new Error("Remote Save As requires an explicit remote destination workflow."); const session = this.#sessionFor(request.workspacePath, request.workspaceId); const relative = relativeRemotePath(request.workspacePath, request.path); if (request.content.length > 4 * 1024 * 1024) throw new Error("Remote file content is too large.");
    try { const payload = await session.opened.request<{ sha256: string; modified_at?: number; size?: number }>(this.#workspacePath(session, "/file"), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: relative, content_base64: Buffer.from(request.content, "utf8").toString("base64"), expected_sha256: request.mode === "overwrite" ? undefined : request.expectedHash }) }); return { status: "saved", path: request.path, expectedHash: request.expectedHash, currentHash: payload.sha256, savedHash: payload.sha256, savedAs: false, overwroteExternal: request.mode === "overwrite", ...(payload.modified_at ? { externalModifiedAt: new Date(payload.modified_at * 1000).toISOString() } : {}), ...(typeof payload.size === "number" ? { externalSize: payload.size } : {}), message: "Remote file saved." }; }
    catch (error) { if (error instanceof RemoteGatewayHttpError && error.status === 409) { const body = error.body && typeof error.body === "object" ? error.body as { detail?: { current_sha256?: string }; current_sha256?: string } : undefined; let currentHash = body?.detail?.current_sha256 ?? body?.current_sha256 ?? ""; if (!currentHash) { currentHash = await session.opened.request<{ sha256?: string }>(this.#workspacePath(session, `/file?path=${encodeURIComponent(relative)}&max_bytes=1`)).then((value) => value.sha256 ?? "").catch(() => ""); } return { status: "conflict", path: request.path, expectedHash: request.expectedHash, currentHash, savedAs: false, overwroteExternal: false, message: "Remote file changed since it was read." }; } throw error; }
  }
  async mutateGit(action: "stage-file" | "revert-file" | "stage-hunk" | "revert-hunk", raw: unknown): Promise<unknown> { const value = raw as { workspacePath?: string; workspaceId?: string; path?: string; expectedDiffHash?: string; patch?: string }; if (!value?.workspacePath || !value.path || !/^[a-f0-9]{64}$/i.test(value.expectedDiffHash ?? "")) throw new Error("Remote workspace mutation request is incomplete."); const session = this.#sessionFor(value.workspacePath, value.workspaceId); const relative = relativeRemotePath(value.workspacePath, value.path); const operation = action.startsWith("stage") ? "stage" : "revert"; const endpoint = action.endsWith("hunk") ? `${operation}-hunk` : operation; await session.opened.request(this.#workspacePath(session, `/git/${endpoint}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: relative, expected_diff_hash: value.expectedDiffHash, patch: value.patch }) }); if (action.endsWith("hunk")) return { workspacePath: value.workspacePath, path: value.path, applied: true, message: "Remote Git hunk applied." }; return action === "stage-file" ? { workspacePath: value.workspacePath, path: value.path, staged: true, message: "Remote file staged." } : { workspacePath: value.workspacePath, path: value.path, reverted: true, message: "Remote file reverted." }; }
  async commitGit(request: DesktopGitCommitApprovalRequest, approvalId: string): Promise<boolean> { const session = this.#sessionFor(request.workspacePath); await session.opened.request(this.#workspacePath(session, "/git/commit"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: request.message, body: request.body, idempotency_key: approvalId }) }); return true; }
  async listCheckpoints(workspacePath: string, workspaceId?: string): Promise<WorkspaceCheckpoint[]> { const session = this.#sessionFor(workspacePath, workspaceId); return (await session.opened.request<{ data?: WorkspaceCheckpoint[] }>(this.#workspacePath(session, "/checkpoints"))).data ?? []; }
  async createCheckpoint(request: WorkspaceCheckpointCreateRequest): Promise<WorkspaceCheckpoint> { return this.#workspacePost(request.workspacePath, request.workspaceId, "/checkpoints", request); }
  async previewCheckpoint(request: WorkspaceCheckpointPreviewRequest): Promise<WorkspaceCheckpointPreviewResult> { return this.#workspacePost(request.workspacePath, request.workspaceId, "/checkpoints/preview", request); }
  async restoreCheckpoint(request: WorkspaceCheckpointRestoreRequest): Promise<WorkspaceCheckpointRestoreResult> { return this.#workspacePost(request.workspacePath, request.workspaceId, "/checkpoints/restore", request); }
  async acceptCheckpoint(request: WorkspaceCheckpointAcceptRequest): Promise<WorkspaceCheckpoint> { return this.#workspacePost(request.workspacePath, request.workspaceId, "/checkpoints/accept", request); }
  async prepareForkWorktree(workspacePath: string, intent?: string, workspaceId?: string): Promise<DesktopForkWorktreeResult> {
    const parent = this.#sessionFor(workspacePath, workspaceId);
    const result = await this.#workspacePost<{ worktree_id: string; workspace_id: string; source_workspace_path: string; repo_root: string; worktree_path: string; branch: string; base_ref: string; source_has_changes: boolean; source_status_summary?: string }>(workspacePath, workspaceId, "/worktrees", { intent: intent?.trim() || "subtask", idempotency_key: `desktop-${randomBytes(16).toString("hex")}` });
    const status: RemoteWorkspaceStatus = { ...parent.status, workspaceId: result.workspace_id, canonicalPath: result.worktree_path, connected: true, gatewayReady: true, connectionState: "ready" };
    this.#sessions.set(result.workspace_id, { opened: { ...parent.opened, workspaceId: result.workspace_id, canonicalPath: result.worktree_path, close: async () => {} }, status, generation: parent.generation, threadIds: new Set(), createdAt: Date.now(), ownsTransport: false, events: [{ at: new Date().toISOString(), phase: "ready", message: "Remote worktree connected." }] });
    this.#publisher?.(status);
    return { worktreeId: result.worktree_id, sourceWorkspaceId: parent.opened.workspaceId, location: "remote", transport: "ssh", workspaceId: result.workspace_id, sourceWorkspacePath: result.source_workspace_path, repoRoot: result.repo_root, worktreePath: result.worktree_path, branch: result.branch, baseRef: result.base_ref, sourceHasChanges: result.source_has_changes, sourceStatusSummary: result.source_status_summary };
  }
  async restorePersisted(): Promise<{ restored: number; failed: number }> {
    const candidates = (await listWorkspaces()).filter((workspace) => workspace.location === "remote" && workspace.transport === "ssh" && workspace.remote && shouldRestorePersistedRemoteWorkspace(workspace));
    const unique = candidates.filter((workspace, index) => candidates.findIndex((item) => item.remote?.hostAlias === workspace.remote?.hostAlias && item.remote?.canonicalPath === workspace.remote?.canonicalPath) === index);
    const results = await Promise.allSettled(unique.map(async (workspace) => {
      if (this.#sessions.has(workspace.id)) return;
      try { await this.connect({ hostAlias: workspace.remote!.hostAlias, path: workspace.remote!.canonicalPath, name: workspace.name, trusted: workspace.trusted }); }
      catch (error) { this.#publisher?.({ ...workspace.remote!, connected: false, gatewayReady: false, connectionState: "failed", error: safeMessage(error), failureKind: "ssh" }); throw error; }
    }));
    return { restored: results.filter((item) => item.status === "fulfilled").length, failed: results.filter((item) => item.status === "rejected").length };
  }
  async shutdown(): Promise<void> { this.#closed = true; const flights = [...this.#flights.values()]; const sessions = [...this.#sessions.values()]; this.#sessions.clear(); this.#threads.clear(); for (const id of new Set([...this.#fileWatchers.keys(), ...this.#fileWatchRetries.keys()])) this.#stopFileWatcher(id); await Promise.allSettled([...sessions.filter((session) => session.ownsTransport).map((session) => session.opened.close()), ...flights]); }
  async #connect(request: ConnectRemoteWorkspaceRequest): Promise<WorkspaceProject> {
    const opened = await this.#port.open(request); if (this.#closed) { await opened.close(); throw new Error("Remote Workspace controller shut down while connecting."); } const status: RemoteWorkspaceStatus = { hostAlias: opened.hostAlias, canonicalPath: opened.canonicalPath, workspaceId: opened.workspaceId, runtimeId: opened.runtimeId, instanceId: opened.instanceId, connectionState: "ready", localPort: opened.localPort, gatewayVersion: opened.gatewayVersion, protocolVersion: opened.protocolVersion, capabilities: opened.capabilities, connected: true, gatewayReady: true };
    const workspace = await createRemoteWorkspace({ id: opened.workspaceId, name: request.name, path: opened.canonicalPath, trusted: request.trusted, remote: status }); this.#sessions.set(opened.workspaceId, { opened, status, generation: 1, threadIds: new Set(), createdAt: Date.now(), ownsTransport: true, events: [{ at: new Date().toISOString(), phase: "ready" }] }); this.#ensureFileWatcher(opened.canonicalPath, opened.workspaceId); this.#publisher?.(status); return workspace;
  }
  #requireReady(rawId: unknown): Session { const id = assertId(rawId, "Remote workspace id"); const session = this.#sessions.get(id); if (!session || !session.status.connected || !session.status.gatewayReady) throw new Error("Remote workspace is not connected."); return session; }
  #sessionFor(workspacePath: string, workspaceId?: string): Session { const byId = workspaceId ? this.#sessions.get(workspaceId) : undefined; const matches = byId ? [byId] : [...this.#sessions.values()].filter((session) => session.opened.canonicalPath === workspacePath); if (matches.length !== 1 || !matches[0].status.connected || !matches[0].status.gatewayReady) throw new Error("Remote workspace is not connected."); return matches[0]; }
  #sessionContaining(path: string): Session {
    const matches = [...this.#sessions.values()].filter((session) => path === session.opened.canonicalPath || path.startsWith(`${session.opened.canonicalPath}/`));
    if (matches.length !== 1 || !matches[0].status.connected || !matches[0].status.gatewayReady) throw new Error("Remote workspace is not connected.");
    return matches[0];
  }
  #workspacePath(session: Session, suffix: string): string { return `/v1/workspaces/${encodeURIComponent(session.opened.workspaceId)}${suffix}`; }
  async #workspaceRequest<T>(workspacePath: string, workspaceId: string | undefined, suffix: string): Promise<T> { const session = this.#sessionFor(workspacePath, workspaceId); return session.opened.request(this.#workspacePath(session, suffix)); }
  async #workspacePost<T>(workspacePath: string, workspaceId: string | undefined, suffix: string, body: unknown): Promise<T> { const session = this.#sessionFor(workspacePath, workspaceId); return session.opened.request(this.#workspacePath(session, suffix), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  #clearWorkspaceThreads(workspaceId: string): void { for (const [threadId, binding] of this.#threads) if (binding.workspaceId === workspaceId) this.#threads.delete(threadId); }
  #ensureFileWatcher(workspacePath: string, workspaceId?: string): void {
    if (!this.#filePublisher) return;
    const session = this.#sessionFor(workspacePath, workspaceId); const key = session.opened.workspaceId; if (this.#fileWatchers.has(key)) return;
    const retry = this.#fileWatchRetries.get(key); if (retry) { clearTimeout(retry); this.#fileWatchRetries.delete(key); }
    const socket = new WebSocket(`${session.opened.baseUrl.replace(/^http/, "ws")}/v1/workspaces/${encodeURIComponent(key)}/watch`); this.#fileWatchers.set(key, socket);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "auth", token: session.opened.token, after_sequence: this.#fileWatchCursors.get(key) ?? 0 })));
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; sequence?: number; changes?: Array<{ path?: string; type?: string; sequence?: number }> };
        if (message.type !== "changes" || !Array.isArray(message.changes)) return;
        const cursor = this.#fileWatchCursors.get(key) ?? 0; const fresh = message.changes.filter((change) => typeof change.sequence !== "number" || change.sequence > cursor);
        const next = Math.max(cursor, typeof message.sequence === "number" ? message.sequence : cursor, ...fresh.map((change) => typeof change.sequence === "number" ? change.sequence : cursor)); this.#fileWatchCursors.set(key, next);
        const changes = fresh.flatMap((change) => typeof change.path === "string" && ["created", "modified", "deleted", "renamed"].includes(String(change.type)) ? [{ path: change.path, type: change.type === "renamed" ? "modified" as const : change.type as "created" | "modified" | "deleted" }] : []);
        if (changes.length) this.#filePublisher?.({ workspacePath, changes });
      } catch { /* malformed remote events are ignored */ }
    });
    socket.addEventListener("close", () => {
      if (this.#fileWatchers.get(key) === socket) this.#fileWatchers.delete(key);
      const current = this.#sessions.get(key); if (!current?.status.connected || !current.status.gatewayReady) return;
      const timer = setTimeout(() => { this.#fileWatchRetries.delete(key); if (this.#sessions.get(key) === current) this.#ensureFileWatcher(workspacePath, key); }, 1_000); timer.unref(); this.#fileWatchRetries.set(key, timer);
    });
  }
  #stopFileWatcher(workspaceId: string): void { const retry = this.#fileWatchRetries.get(workspaceId); if (retry) clearTimeout(retry); this.#fileWatchRetries.delete(workspaceId); const watcher = this.#fileWatchers.get(workspaceId); this.#fileWatchers.delete(workspaceId); watcher?.close(); }
}

function validateConnectRequest(value: unknown): ConnectRemoteWorkspaceRequest { if (!value || typeof value !== "object") throw new Error("Remote workspace request is invalid."); const request = value as Partial<ConnectRemoteWorkspaceRequest>; const hostAlias = assertId(request.hostAlias, "SSH host alias"); if (!/^[A-Za-z0-9_.@-]{1,128}$/.test(hostAlias)) throw new Error("SSH host alias is invalid."); if (typeof request.path !== "string" || !request.path.trim() || request.path.length > 4096 || /[\r\n\0]/.test(request.path)) throw new Error("Remote workspace path is invalid."); return { hostAlias, path: request.path.trim(), ...(typeof request.name === "string" ? { name: request.name.trim().slice(0, 200) } : {}), ...(typeof request.trusted === "boolean" ? { trusted: request.trusted } : {}) }; }
function assertId(value: unknown, label: string): string { if (typeof value !== "string" || !/^[A-Za-z0-9_.:@/-]{1,240}$/.test(value)) throw new Error(`${label} is invalid.`); return value; }
function assertWorkerId(value: unknown): string { if (typeof value !== "string" || !/^[A-Za-z0-9_.:@-]{1,200}$/.test(value)) throw new Error("Remote worker id is invalid."); return value; }
function safeMessage(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/(token|password|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 1000); }
function relativeRemotePath(workspacePath: string, path: string): string { if (typeof path !== "string" || !path || path.length > 4096 || /[\r\n\0]/.test(path)) throw new Error("Remote path is invalid."); const relative = path.startsWith(`${workspacePath}/`) ? path.slice(workspacePath.length + 1) : path === workspacePath ? "" : path; if (!relative || relative.startsWith("/") || relative.split(/[\\/]/).some((part) => part === "..")) throw new Error("Remote path must stay inside the workspace."); return relative.replace(/\\/g, "/"); }

const gatewayTransport = createSystemRemoteGatewayTransport();
class SystemRemoteWorkspacePort implements RemoteWorkspaceSessionPort {
  async listDirectories(hostAlias: string, path: string): Promise<RemoteDirectoryEntry[]> { const encoded = Buffer.from(path, "utf8").toString("base64"); const output = await gatewayTransport.executePython(hostAlias, DIRECTORY_SCRIPT.replace("__PATH__", encoded), 20_000); let rows: unknown; try { rows = JSON.parse(output); } catch { throw new Error("Remote directory response is invalid."); } if (!Array.isArray(rows)) throw new Error("Remote directory response is invalid."); return rows.slice(0, 1000).flatMap((row) => { if (!row || typeof row !== "object") return []; const item = row as Record<string, unknown>; if (typeof item.name !== "string" || typeof item.path !== "string" || item.directory !== true) return []; return [{ name: item.name.slice(0, 512), path: item.path.slice(0, 4096), directory: true as const, ...(typeof item.readable === "boolean" ? { readable: item.readable } : {}), ...(typeof item.writable === "boolean" ? { writable: item.writable } : {}), ...(typeof item.mode === "string" ? { mode: item.mode.slice(0, 16) } : {}) }]; }); }
  async open(request: ConnectRemoteWorkspaceRequest) {
    await sshHostService.connect(request.hostAlias); const controlPath = sshHostService.controlPath(request.hostAlias); if (!controlPath) throw new Error("SSH ControlMaster is unavailable.");
    const remotePort = configuredRemoteGatewayPort();
    const token = randomBytes(32).toString("base64url"); const generation = Date.now(); const payload = Buffer.from(JSON.stringify({ path: request.path, token, generation, port: remotePort, packagedChatFixture: process.env.OPENDRSAI_REMOTE_PACKAGED_CHAT_FIXTURE === "1" }), "utf8").toString("base64");
    const started = await gatewayTransport.executePython(request.hostAlias, START_GATEWAY_SCRIPT.replace("__PAYLOAD__", payload), 20_000); if (started !== "started" && started !== "superseded") throw new Error("Remote Gateway did not start.");
    const localPort = await availablePort(); const config = process.env.OPENDRSAI_SSH_CONFIG?.trim() ?? join(homedir(), ".ssh", "config"); const ssh = process.env.OPENDRSAI_SSH_EXECUTABLE?.trim() ?? (process.platform === "darwin" ? "/usr/bin/ssh" : "ssh");
    const tunnel = spawn(ssh, ["-F", config, "-S", "none", "-o", `UserKnownHostsFile=${sshHostService.knownHostsPath}`, "-o", "StrictHostKeyChecking=yes", "-o", "ExitOnForwardFailure=yes", "-N", "-L", `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`, request.hostAlias], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    await waitForChild(tunnel, 100); const baseUrl = `http://127.0.0.1:${localPort}`; const requestGateway = <T>(path: string, init: RequestInit = {}) => gatewayRequest<T>(baseUrl, token, path, init);
    let identity: { runtime_id?: string; instance_id?: string; gateway_version?: string; protocol_version?: number; capability_versions?: Record<string, number> } | undefined;
    for (let attempt = 0; attempt < 60; attempt += 1) { try { identity = await requestGateway("/v1/remote/handshake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ protocol_version: 1, workspace_path: request.path }) }); break; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); } }
    if (!identity?.runtime_id || !identity.instance_id || identity.protocol_version !== 1) { tunnel.kill(); throw new Error("Remote Gateway handshake failed or is incompatible."); }
    const opened = await requestGateway<{ workspace_id?: string; id?: string; path?: string }>("/v1/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: request.path }) }); const workspaceId = opened.workspace_id || opened.id; if (!workspaceId) { tunnel.kill(); throw new Error("Remote Gateway did not return a workspace id."); }
    return { workspaceId, canonicalPath: opened.path || request.path, hostAlias: request.hostAlias, localPort, baseUrl, token, runtimeId: identity.runtime_id, instanceId: identity.instance_id, gatewayVersion: identity.gateway_version, protocolVersion: identity.protocol_version, capabilities: identity.capability_versions ?? {}, close: async () => { await requestGateway(`/v1/workspaces/${encodeURIComponent(workspaceId)}`, { method: "DELETE" }).catch(() => undefined); tunnel.kill(); }, request: requestGateway };
  }
}

async function gatewayRequest<T>(baseUrl: string, token: string, path: string, init: RequestInit): Promise<T> { const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), "X-OpenDrSai-Gateway-Token": token }, signal: AbortSignal.timeout(10_000) }); if (!response.ok) { let body: unknown; try { body = await response.json(); } catch { body = undefined; } throw new RemoteGatewayHttpError(response.status, body); } return response.status === 204 ? undefined as T : response.json() as Promise<T>; }
function availablePort(): Promise<number> { return new Promise((resolvePromise, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close(() => port ? resolvePromise(port) : reject(new Error("No local port available."))); }); }); }
function waitForChild(child: ChildProcess, ms: number): Promise<void> { return new Promise((resolvePromise, reject) => { const timer = setTimeout(() => { cleanup(); resolvePromise(); }, ms); const error = (value: Error) => { cleanup(); reject(value); }; const exit = () => { cleanup(); reject(new Error("SSH tunnel exited during startup.")); }; const cleanup = () => { clearTimeout(timer); child.removeListener("error", error); child.removeListener("exit", exit); }; child.once("error", error); child.once("exit", exit); }); }
function configuredRemoteGatewayPort(): number { const raw = process.env.OPENDRSAI_REMOTE_GATEWAY_PORT?.trim(); if (!raw) return 18642; const port = Number(raw); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Remote Gateway port is invalid."); return port; }
const START_GATEWAY_SCRIPT = `import base64,fcntl,json,os,pathlib,subprocess,sys,time
cfg=json.loads(base64.b64decode("__PAYLOAD__")); home=pathlib.Path.home()/".local"/"share"/"opendrsai"/"remote"; home.mkdir(parents=True,exist_ok=True)
lock=open(home/"gateway.start.lock","a+"); fcntl.flock(lock,fcntl.LOCK_EX); generationfile=home/"gateway.generation"
try: latest=int(generationfile.read_text().strip())
except (ValueError,FileNotFoundError): latest=0
if int(cfg["generation"])<latest: print("superseded"); sys.exit(0)
generationfile.write_text(str(int(cfg["generation"]))); pidfile=home/"gateway.pid"
if pidfile.exists():
 try:
  old=int(pidfile.read_text().strip()); os.kill(old,15)
  for _ in range(50):
   try: os.kill(old,0); time.sleep(.1)
   except ProcessLookupError: break
  else: os.kill(old,9)
 except (ValueError,ProcessLookupError,PermissionError): pass
log=open(home/"gateway.log","ab",buffering=0); env=os.environ.copy(); env.update({"DRSAI_API_HOST":"127.0.0.1","DRSAI_API_PORT":str(cfg["port"]),"OPENDRSAI_GATEWAY_INSTANCE_TOKEN":cfg["token"]});
if cfg.get("packagedChatFixture"): env.update({"OPENDRSAI_PACKAGED_CHAT_RECOVERY_FIXTURE":"1","OPENDRSAI_DEV_AUTH_BYPASS":"1"})
managed=home/"current"/"bin"/"python"; python=str(managed) if managed.exists() else sys.executable
p=subprocess.Popen([python,"-m","drsai.backend.gateway"],cwd=cfg["path"],env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True); pidfile.write_text(str(p.pid)); print("started")`;
const DIRECTORY_SCRIPT = `import base64,json,os
p=os.path.realpath(os.path.expanduser(base64.b64decode("__PATH__").decode()))
if not os.path.isdir(p): raise SystemExit("not a directory")
rows=[]
for e in os.scandir(p):
 if e.is_dir(follow_symlinks=False):
  st=e.stat(follow_symlinks=False); rows.append({"name":e.name,"path":os.path.realpath(e.path),"directory":True,"readable":os.access(e.path,os.R_OK|os.X_OK),"writable":os.access(e.path,os.W_OK),"mode":oct(st.st_mode & 0o777)})
print(json.dumps(sorted(rows,key=lambda x:x["name"].lower())[:1000]))`;
export const remoteWorkspaceController = new RemoteWorkspaceController(new SystemRemoteWorkspacePort());
