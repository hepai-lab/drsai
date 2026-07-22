import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ConnectRemoteWorkspaceRequest, DesktopThread, RemoteDirectoryEntry, RemoteHepaiWorker, RemoteSshDiagnosticReport, RemoteWorkspaceStatus, WorkspaceContextOverview, WorkspaceFilePreview, WorkspaceFilePreviewRequest, WorkspaceFileTreeRequest, WorkspaceFileTreeResult, WorkspaceFileWriteRequest, WorkspaceFileWriteResult, WorkspaceFolderSummaryRequest, WorkspaceFolderSummaryResult, WorkspaceGitDiffRequest, WorkspaceGitDiffResult, WorkspaceGitFileAtRefRequest, WorkspaceGitFileAtRefResult, WorkspaceProject } from "../api/desktopApi";
import { createRemoteWorkspace, findWorkspaceById, setRemoteWorkspaceAutoReconnect } from "./workspaces";
import { createSystemRemoteGatewayTransport } from "./remoteGatewayInstaller";
import { sshHostService } from "./sshHosts";

export interface RemoteWorkspaceSessionPort {
  open(request: ConnectRemoteWorkspaceRequest): Promise<{ workspaceId: string; canonicalPath: string; hostAlias: string; localPort: number; baseUrl: string; token: string; runtimeId: string; instanceId: string; gatewayVersion?: string; protocolVersion: number; capabilities: Record<string, number>; close(): Promise<void>; request<T>(path: string, init?: RequestInit): Promise<T> }>;
  listDirectories?(hostAlias: string, path: string): Promise<RemoteDirectoryEntry[]>;
}
type Opened = Awaited<ReturnType<RemoteWorkspaceSessionPort["open"]>>;
type Session = { opened: Opened; status: RemoteWorkspaceStatus; generation: number; threadIds: Set<string>; createdAt: number; events: Array<{ at: string; phase: string; message?: string }> };
export class RemoteGatewayHttpError extends Error { constructor(readonly status: number, readonly body: unknown) { super(`Remote Gateway request failed (${status}).`); } }

export class RemoteWorkspaceController {
  readonly #port: RemoteWorkspaceSessionPort;
  readonly #sessions = new Map<string, Session>();
  readonly #flights = new Map<string, Promise<WorkspaceProject>>();
  #publisher?: (status: RemoteWorkspaceStatus) => void;
  constructor(port: RemoteWorkspaceSessionPort) { this.#port = port; }
  setPublisher(publisher: (status: RemoteWorkspaceStatus) => void): void { this.#publisher = publisher; }
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
  bindThread(threadId: string, workspaceId: string): void { if (/^[A-Za-z0-9_.:-]{1,200}$/.test(threadId)) this.#sessions.get(workspaceId)?.threadIds.add(threadId); }
  async listDirectories(rawAlias: unknown, rawPath: unknown = "~"): Promise<RemoteDirectoryEntry[]> {
    const alias = assertId(rawAlias, "SSH host alias"); if (!/^[A-Za-z0-9_.@-]{1,128}$/.test(alias)) throw new Error("SSH host alias is invalid.");
    if (typeof rawPath !== "string" || !rawPath || rawPath.length > 4096 || /[\r\n\0]/.test(rawPath)) throw new Error("Remote directory path is invalid.");
    if (!this.#port.listDirectories) throw new Error("Remote directory transport is unavailable."); return this.#port.listDirectories(alias, rawPath);
  }

  async connect(raw: unknown): Promise<WorkspaceProject> {
    const request = validateConnectRequest(raw); const key = `${request.hostAlias}\0${request.path}`;
    const existing = [...this.#sessions.values()].find((session) => session.opened.hostAlias === request.hostAlias && session.opened.canonicalPath === request.path);
    if (existing) return (await findWorkspaceById(existing.opened.workspaceId))!;
    const inFlight = this.#flights.get(key); if (inFlight) return inFlight;
    const flight = this.#connect(request).finally(() => this.#flights.delete(key)); this.#flights.set(key, flight); return flight;
  }
  async disconnect(rawId: unknown): Promise<boolean> {
    const id = assertId(rawId, "Remote workspace id"); const session = this.#sessions.get(id);
    if (!session) { await setRemoteWorkspaceAutoReconnect(id, false); return false; }
    this.#sessions.delete(id); session.threadIds.clear(); await session.opened.close(); await setRemoteWorkspaceAutoReconnect(id, false);
    const status = { ...session.status, connected: false, gatewayReady: false, connectionState: "disconnected" as const, localPort: undefined }; this.#publisher?.(status); return true;
  }
  async status(rawId: unknown): Promise<RemoteWorkspaceStatus> {
    const id = assertId(rawId, "Remote workspace id"); const session = this.#sessions.get(id);
    if (!session) { const workspace = await findWorkspaceById(id); if (!workspace?.remote) throw new Error("Remote workspace not found."); return { ...workspace.remote, connected: false, gatewayReady: false, connectionState: "disconnected" }; }
    try {
      const identity = await session.opened.request<{ runtime_id?: string; instance_id?: string; gateway_version?: string; protocol_version?: number; capability_versions?: Record<string, number> }>("/v1/remote/handshake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ protocol_version: 1, workspace_path: session.status.canonicalPath }) });
      if (!identity.runtime_id || !identity.instance_id || identity.protocol_version !== 1) throw new Error("Remote Gateway identity response is invalid.");
      if (identity.runtime_id !== session.status.runtimeId || identity.instance_id !== session.status.instanceId) { session.generation += 1; session.threadIds.clear(); session.status = { ...session.status, runtimeId: identity.runtime_id, instanceId: identity.instance_id, gatewayVersion: identity.gateway_version, protocolVersion: identity.protocol_version, capabilities: identity.capability_versions ?? {}, connectionState: "ready", connected: true, gatewayReady: true }; this.#publisher?.(session.status); }
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
    const session = this.#requireReady(rawId); const payload = await session.opened.request<{ data?: Array<Record<string, unknown>> }>(`/v1/threads?workspace_id=${encodeURIComponent(session.opened.workspaceId)}&limit=100`);
    const threads = (payload.data ?? []).flatMap((row) => { const id = typeof row.thread_id === "string" ? row.thread_id : typeof row.session_id === "string" ? row.session_id : ""; if (!id) return []; session.threadIds.add(id); const updated = typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(); return [{ id, kind: "chat" as const, title: typeof row.name === "string" ? row.name : "Remote session", workspacePath: session.opened.canonicalPath, createdAt: updated, updatedAt: updated, status: "idle" as const, messageCount: typeof row.message_count === "number" ? row.message_count : 0 }]; });
    return threads.slice(0, 100);
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
    const session = this.#sessionFor(request.workspacePath, request.workspaceId); const parameters = new URLSearchParams({ depth: String(Math.max(0, Math.min(5, request.maxDepth ?? 2))), max_entries: String(Math.max(1, Math.min(5_000, request.maxEntries ?? 500))), offset: String(Math.max(0, request.offset ?? 0)) }); if (request.query) parameters.set("query", request.query.slice(0, 240));
    const payload = await session.opened.request<{ data?: Array<Record<string, unknown>>; total?: number; truncated?: boolean; next_offset?: number | null }>(this.#workspacePath(session, `/files?${parameters}`)); let count = 0;
    const mapNode = (row: Record<string, unknown>): WorkspaceFileTreeResult["nodes"][number] => { count += 1; const relativePath = String(row.path || "").replace(/^[/\\]+/, ""); const directory = row.directory === true; const gitStatus = ["modified", "added", "deleted", "renamed", "untracked", "clean"].includes(String(row.git_status)) ? row.git_status as "modified" | "added" | "deleted" | "renamed" | "untracked" | "clean" : undefined; return { name: String(row.name || "").slice(0, 512), path: `${request.workspacePath}/${relativePath}`, relativePath, type: directory ? "directory" : "file", size: typeof row.size === "number" ? row.size : undefined, modifiedAt: typeof row.modified_at === "number" ? new Date(row.modified_at * 1000).toISOString() : undefined, gitStatus, children: Array.isArray(row.children) ? row.children.slice(0, 5_000).map((child) => mapNode(child as Record<string, unknown>)) : undefined }; };
    const nodes = (payload.data ?? []).slice(0, 5_000).map(mapNode); return { workspacePath: request.workspacePath, nodes, totalEntries: payload.total ?? count, truncated: payload.truncated === true, stale: false, ...(typeof payload.next_offset === "number" ? { nextOffset: payload.next_offset } : {}) };
  }
  async previewFile(request: WorkspaceFilePreviewRequest): Promise<WorkspaceFilePreview> {
    const session = this.#sessionFor(request.workspacePath, request.workspaceId); const relative = relativeRemotePath(request.workspacePath, request.path); const maxBytes = Math.max(1, Math.min(2 * 1024 * 1024, request.maxBytes ?? 262_144));
    const payload = await session.opened.request<{ path: string; content?: string; data_url?: string; mime?: string; modified_at?: number; truncated?: boolean; size?: number }>(this.#workspacePath(session, `/file?path=${encodeURIComponent(relative)}&max_bytes=${maxBytes}`)); const path = String(payload.path || relative); const kind = payload.data_url ? (payload.mime?.startsWith("image/") ? "image" : "binary") : "text";
    return { workspacePath: request.workspacePath, path: request.path, relativePath: path, name: path.split("/").pop() || path, kind, mime: payload.mime || "text/plain", size: Number(payload.size ?? 0), modifiedAt: new Date(Number(payload.modified_at ?? 0) * 1000).toISOString(), truncated: payload.truncated === true, stale: false, content: payload.content, dataUrl: payload.data_url, mode: request.mode || "auto" };
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
    catch (error) { if (error instanceof RemoteGatewayHttpError && error.status === 409) { const detail = error.body && typeof error.body === "object" ? (error.body as { detail?: { current_sha256?: string } }).detail : undefined; return { status: "conflict", path: request.path, expectedHash: request.expectedHash, currentHash: detail?.current_sha256 || "", savedAs: false, overwroteExternal: false, message: "Remote file changed since it was read." }; } throw error; }
  }
  async mutateGit(action: "stage-file" | "revert-file" | "stage-hunk" | "revert-hunk", raw: unknown): Promise<unknown> { const value = raw as { workspacePath?: string; workspaceId?: string; path?: string; expectedDiffHash?: string; patch?: string }; if (!value?.workspacePath || !value.path || !/^[a-f0-9]{64}$/i.test(value.expectedDiffHash ?? "")) throw new Error("Remote workspace mutation request is incomplete."); const session = this.#sessionFor(value.workspacePath, value.workspaceId); const relative = relativeRemotePath(value.workspacePath, value.path); const operation = action.startsWith("stage") ? "stage" : "revert"; const endpoint = action.endsWith("hunk") ? `${operation}-hunk` : operation; await session.opened.request(this.#workspacePath(session, `/git/${endpoint}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: relative, expected_diff_hash: value.expectedDiffHash, patch: value.patch }) }); if (action.endsWith("hunk")) return { workspacePath: value.workspacePath, path: value.path, applied: true, message: "Remote Git hunk applied." }; return action === "stage-file" ? { workspacePath: value.workspacePath, path: value.path, staged: true, message: "Remote file staged." } : { workspacePath: value.workspacePath, path: value.path, reverted: true, message: "Remote file reverted." }; }
  async shutdown(): Promise<void> { const sessions = [...this.#sessions.values()]; this.#sessions.clear(); await Promise.allSettled(sessions.map((session) => session.opened.close())); }
  async #connect(request: ConnectRemoteWorkspaceRequest): Promise<WorkspaceProject> {
    const opened = await this.#port.open(request); const status: RemoteWorkspaceStatus = { hostAlias: opened.hostAlias, canonicalPath: opened.canonicalPath, workspaceId: opened.workspaceId, runtimeId: opened.runtimeId, instanceId: opened.instanceId, connectionState: "ready", localPort: opened.localPort, gatewayVersion: opened.gatewayVersion, protocolVersion: opened.protocolVersion, capabilities: opened.capabilities, connected: true, gatewayReady: true };
    const workspace = await createRemoteWorkspace({ id: opened.workspaceId, name: request.name, path: opened.canonicalPath, trusted: request.trusted, remote: status }); this.#sessions.set(opened.workspaceId, { opened, status, generation: 1, threadIds: new Set(), createdAt: Date.now(), events: [{ at: new Date().toISOString(), phase: "ready" }] }); this.#publisher?.(status); return workspace;
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
    const token = randomBytes(32).toString("base64url"); const generation = Date.now(); const payload = Buffer.from(JSON.stringify({ path: request.path, token, generation }), "utf8").toString("base64");
    const started = await gatewayTransport.executePython(request.hostAlias, START_GATEWAY_SCRIPT.replace("__PAYLOAD__", payload), 20_000); if (started !== "started" && started !== "superseded") throw new Error("Remote Gateway did not start.");
    const localPort = await availablePort(); const config = process.env.OPENDRSAI_SSH_CONFIG?.trim() ?? join(homedir(), ".ssh", "config"); const ssh = process.env.OPENDRSAI_SSH_EXECUTABLE?.trim() ?? (process.platform === "darwin" ? "/usr/bin/ssh" : "ssh");
    const tunnel = spawn(ssh, ["-F", config, "-S", controlPath, "-o", `UserKnownHostsFile=${sshHostService.knownHostsPath}`, "-o", "StrictHostKeyChecking=yes", "-o", "ExitOnForwardFailure=yes", "-N", "-L", `127.0.0.1:${localPort}:127.0.0.1:18642`, request.hostAlias], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
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
const START_GATEWAY_SCRIPT = `import base64,fcntl,json,os,pathlib,subprocess,sys
cfg=json.loads(base64.b64decode("__PAYLOAD__")); home=pathlib.Path.home()/".local"/"share"/"opendrsai"/"remote"; home.mkdir(parents=True,exist_ok=True)
lock=open(home/"gateway.start.lock","a+"); fcntl.flock(lock,fcntl.LOCK_EX); generationfile=home/"gateway.generation"
try: latest=int(generationfile.read_text().strip())
except (ValueError,FileNotFoundError): latest=0
if int(cfg["generation"])<latest: print("superseded"); sys.exit(0)
generationfile.write_text(str(int(cfg["generation"]))); pidfile=home/"gateway.pid"
if pidfile.exists():
 try: os.kill(int(pidfile.read_text().strip()),15)
 except (ValueError,ProcessLookupError,PermissionError): pass
log=open(home/"gateway.log","ab",buffering=0); env=os.environ.copy(); env.update({"DRSAI_API_HOST":"127.0.0.1","DRSAI_API_PORT":"18642","OPENDRSAI_GATEWAY_INSTANCE_TOKEN":cfg["token"]}); managed=home/"current"/"bin"/"python"; python=str(managed) if managed.exists() else sys.executable
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
