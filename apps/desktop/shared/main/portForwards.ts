import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFile, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { DesktopPortForward, DesktopPortForwardCreateRequest, DesktopPortForwardStatus } from "../api/desktopApi";
import { replaceFileSafely } from "./atomicFileReplace";
import { sshHostService } from "./sshHosts";

export interface PortForwardEvent {
  type: "created" | "status_changed" | "local_port_reassigned" | "removed";
  portForward: DesktopPortForward;
  previousLocalPort?: number;
}

type PersistedForward = DesktopPortForward & { correlationId: string; operationId: string };
type ForwardProcess = Pick<ChildProcess, "exitCode" | "kill" | "once" | "removeListener">;
export interface PortForwardPlatform {
  ensureHost(hostAlias: string): Promise<void>;
  spawn(resource: DesktopPortForward): ForwardProcess;
  choosePort(bindAddress: string, preferred?: number): Promise<number>;
  waitForStart(child: ForwardProcess): Promise<void>;
}

export class PortForwardRegistry {
  readonly #resources = new Map<string, PersistedForward>();
  readonly #processes = new Map<string, ForwardProcess>();
  readonly #timers = new Map<string, NodeJS.Timeout>();
  readonly #attempts = new Map<string, number>();
  readonly #filePath: string;
  readonly #platform: PortForwardPlatform;
  #publish: (event: PortForwardEvent) => void;
  #loaded = false;
  #closed = false;

  constructor(filePath: string, platform: PortForwardPlatform = systemPortForwardPlatform, publish: (event: PortForwardEvent) => void = () => undefined) {
    this.#filePath = filePath;
    this.#platform = platform;
    this.#publish = publish;
  }

  setPublisher(publish: (event: PortForwardEvent) => void): void { this.#publish = publish; }

  async list(rawFilter: unknown = {}): Promise<DesktopPortForward[]> {
    await this.#load();
    const filter = validateFilter(rawFilter);
    return [...this.#resources.values()].filter((item) => item.status !== "removed"
      && (!filter.hostAlias || item.hostAlias === filter.hostAlias)
      && (!filter.workspaceId || item.workspaceId === filter.workspaceId)).map(publicResource);
  }

  async create(raw: unknown): Promise<DesktopPortForward> {
    this.#assertOpen();
    await this.#load();
    const request = validateCreateRequest(raw);
    const localPort = await this.#platform.choosePort("127.0.0.1", request.localPort);
    const now = new Date().toISOString();
    const resource: PersistedForward = {
      portForwardId: `pf_${randomUUID()}`,
      hostAlias: request.hostAlias,
      workspaceId: request.workspaceId,
      remoteHost: request.remoteHost ?? "127.0.0.1",
      remotePort: request.remotePort,
      bindAddress: "127.0.0.1",
      ...(request.localPort ? { requestedLocalPort: request.localPort } : {}),
      localPort,
      status: "starting",
      reconnectPolicy: request.reconnectPolicy ?? "automatic",
      createdAt: now,
      updatedAt: now,
      correlationId: request.authorization.correlationId,
      operationId: request.authorization.operationId,
    };
    this.#resources.set(resource.portForwardId, resource);
    try {
      await this.#audit("port_forward.authorized", resource, request.authorization.approvalId);
      await this.#start(resource, request.localPort !== undefined && request.localPort !== localPort ? request.localPort : undefined);
      await this.#audit("port_forward.created", resource, request.authorization.approvalId);
      this.#publish({ type: "created", portForward: publicResource(resource) });
      return publicResource(resource);
    } catch (error) {
      resource.lastError = safeMessage(error);
      await this.#transition(resource, "failed");
      throw error;
    }
  }

  async pause(rawId: unknown): Promise<DesktopPortForward> {
    const resource = await this.#require(rawId);
    this.#cancelReconnect(resource.portForwardId);
    this.#stopProcess(resource.portForwardId);
    await this.#transition(resource, "paused");
    return publicResource(resource);
  }

  async resume(rawId: unknown): Promise<DesktopPortForward> {
    this.#assertOpen();
    const resource = await this.#require(rawId);
    if (!["paused", "failed", "reconnecting"].includes(resource.status)) return publicResource(resource);
    const previous = resource.localPort;
    resource.localPort = await this.#platform.choosePort(resource.bindAddress, resource.requestedLocalPort ?? previous);
    await this.#start(resource, previous !== resource.localPort ? previous : undefined);
    return publicResource(resource);
  }

  async remove(rawId: unknown): Promise<boolean> {
    const resource = await this.#require(rawId);
    this.#cancelReconnect(resource.portForwardId);
    this.#stopProcess(resource.portForwardId);
    resource.status = "removed";
    resource.updatedAt = new Date().toISOString();
    await this.#persist();
    await this.#audit("port_forward.removed", resource);
    this.#publish({ type: "removed", portForward: publicResource(resource) });
    return true;
  }

  async restore(): Promise<void> {
    this.#assertOpen();
    await this.#load();
    for (const resource of this.#resources.values()) {
      if (resource.reconnectPolicy !== "automatic" || !["active", "starting", "reconnecting"].includes(resource.status)) continue;
      try { resource.localPort = await this.#platform.choosePort(resource.bindAddress, resource.requestedLocalPort ?? resource.localPort); await this.#start(resource); }
      catch (error) { resource.lastError = safeMessage(error); await this.#scheduleReconnect(resource); }
    }
  }

  async suspendHost(hostAlias: string): Promise<void> {
    await this.#load();
    for (const resource of this.#resources.values()) {
      if (resource.hostAlias !== hostAlias || ["removed", "paused"].includes(resource.status)) continue;
      this.#cancelReconnect(resource.portForwardId);
      this.#stopProcess(resource.portForwardId);
      await this.#transition(resource, resource.reconnectPolicy === "automatic" ? "reconnecting" : "failed");
    }
  }

  async resumeHost(hostAlias: string): Promise<void> {
    await this.#load();
    for (const resource of this.#resources.values()) {
      if (resource.hostAlias !== hostAlias || resource.reconnectPolicy !== "automatic" || !["active", "starting", "reconnecting"].includes(resource.status) || this.#processes.has(resource.portForwardId)) continue;
      try { resource.localPort = await this.#platform.choosePort(resource.bindAddress, resource.requestedLocalPort ?? resource.localPort); await this.#start(resource); }
      catch (error) { resource.lastError = safeMessage(error); await this.#scheduleReconnect(resource); }
    }
  }

  async suspendAll(): Promise<void> {
    await this.#load();
    for (const alias of new Set([...this.#resources.values()].map((item) => item.hostAlias))) await this.suspendHost(alias);
  }

  async resumeAll(): Promise<void> {
    await this.#load();
    for (const alias of new Set([...this.#resources.values()].map((item) => item.hostAlias))) await this.resumeHost(alias);
  }

  async shutdown(): Promise<void> {
    this.#closed = true;
    for (const id of this.#timers.keys()) this.#cancelReconnect(id);
    for (const id of this.#processes.keys()) this.#stopProcess(id);
    await this.#persist().catch(() => undefined);
  }

  async #start(resource: PersistedForward, reassignedFrom?: number): Promise<void> {
    this.#assertOpen();
    this.#cancelReconnect(resource.portForwardId);
    await this.#platform.ensureHost(resource.hostAlias);
    resource.status = "starting";
    resource.lastError = undefined;
    resource.updatedAt = new Date().toISOString();
    const child = this.#platform.spawn(resource);
    this.#processes.set(resource.portForwardId, child);
    try { await this.#platform.waitForStart(child); }
    catch (error) { if (this.#processes.get(resource.portForwardId) === child) this.#processes.delete(resource.portForwardId); child.kill(); throw error; }
    child.once("exit", (code) => {
      if (this.#processes.get(resource.portForwardId) !== child) return;
      this.#processes.delete(resource.portForwardId);
      if (["paused", "removed"].includes(resource.status) || this.#closed) return;
      resource.lastError = `SSH port forward exited (${code ?? "unknown"}).`;
      if (resource.reconnectPolicy === "manual") void this.#transition(resource, "failed");
      else void this.#scheduleReconnect(resource);
    });
    resource.status = "active";
    this.#attempts.delete(resource.portForwardId);
    await this.#persist();
    if (reassignedFrom !== undefined) this.#publish({ type: "local_port_reassigned", portForward: publicResource(resource), previousLocalPort: reassignedFrom });
    this.#publish({ type: "status_changed", portForward: publicResource(resource) });
  }

  async #scheduleReconnect(resource: PersistedForward): Promise<void> {
    if (this.#closed || resource.status === "removed" || resource.status === "paused") return;
    const attempt = (this.#attempts.get(resource.portForwardId) ?? 0) + 1;
    this.#attempts.set(resource.portForwardId, attempt);
    if (attempt > 8) { await this.#transition(resource, "failed"); return; }
    await this.#transition(resource, "reconnecting");
    const delay = Math.min(30_000, 250 * (2 ** (attempt - 1)));
    const timer = setTimeout(async () => {
      this.#timers.delete(resource.portForwardId);
      if (resource.status !== "reconnecting" || this.#closed) return;
      try {
        const previous = resource.localPort;
        resource.localPort = await this.#platform.choosePort(resource.bindAddress, resource.requestedLocalPort ?? previous);
        await this.#start(resource, previous !== resource.localPort ? previous : undefined);
      } catch (error) { resource.lastError = safeMessage(error); await this.#scheduleReconnect(resource); }
    }, delay);
    timer.unref();
    this.#timers.set(resource.portForwardId, timer);
  }

  async #transition(resource: PersistedForward, status: DesktopPortForwardStatus): Promise<void> {
    resource.status = status;
    resource.updatedAt = new Date().toISOString();
    await this.#persist();
    this.#publish({ type: "status_changed", portForward: publicResource(resource) });
  }

  async #require(rawId: unknown): Promise<PersistedForward> {
    await this.#load();
    if (typeof rawId !== "string" || !/^pf_[a-f0-9-]{36}$/i.test(rawId)) throw new Error("Port Forward id is invalid.");
    const resource = this.#resources.get(rawId);
    if (!resource || resource.status === "removed") throw new Error("Port Forward not found.");
    return resource;
  }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.#filePath, "utf8")) as { resources?: unknown[] };
      for (const value of parsed.resources ?? []) { const resource = parseResource(value); if (resource) this.#resources.set(resource.portForwardId, resource); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }

  async #persist(): Promise<void> {
    if (!this.#loaded) return;
    await mkdir(dirname(this.#filePath), { recursive: true });
    const temporary = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify({ version: 2, resources: [...this.#resources.values()] }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await replaceFileSafely(temporary, this.#filePath);
      await chmod(this.#filePath, 0o600).catch(() => undefined);
    } finally { await rm(temporary, { force: true }); }
  }

  async #audit(event: string, resource: PersistedForward, approvalId?: string): Promise<void> {
    await mkdir(dirname(this.#filePath), { recursive: true });
    const record = { timestamp: new Date().toISOString(), event, hostId: resource.hostAlias, workspaceId: resource.workspaceId, portForwardId: resource.portForwardId, operationId: resource.operationId, correlationId: resource.correlationId, ...(approvalId ? { approvalId } : {}), status: resource.status };
    const auditPath = `${this.#filePath}.audit.jsonl`;
    await appendFile(auditPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(auditPath, 0o600).catch(() => undefined);
  }

  #stopProcess(id: string): void { const child = this.#processes.get(id); this.#processes.delete(id); child?.kill(); }
  #cancelReconnect(id: string): void { const timer = this.#timers.get(id); if (timer) clearTimeout(timer); this.#timers.delete(id); this.#attempts.delete(id); }
  #assertOpen(): void { if (this.#closed) throw new Error("Port Forward registry is shutting down."); }
}

function validateFilter(raw: unknown): { hostAlias?: string; workspaceId?: string } {
  if (!raw || typeof raw !== "object") return {};
  const value = raw as Record<string, unknown>;
  if (value.hostAlias !== undefined && (typeof value.hostAlias !== "string" || !/^[A-Za-z0-9_.@-]{1,128}$/.test(value.hostAlias))) throw new Error("Port Forward host filter is invalid.");
  if (value.workspaceId !== undefined && (typeof value.workspaceId !== "string" || !/^[A-Za-z0-9_.:@/-]{1,240}$/.test(value.workspaceId))) throw new Error("Port Forward workspace filter is invalid.");
  return { ...(value.hostAlias ? { hostAlias: value.hostAlias } : {}), ...(value.workspaceId ? { workspaceId: value.workspaceId } : {}) };
}

function validateCreateRequest(raw: unknown): DesktopPortForwardCreateRequest {
  if (!raw || typeof raw !== "object") throw new Error("Port Forward request is invalid.");
  const value = raw as Partial<DesktopPortForwardCreateRequest>;
  if (typeof value.hostAlias !== "string" || !/^[A-Za-z0-9_.@-]{1,128}$/.test(value.hostAlias)) throw new Error("Port Forward host alias is invalid.");
  if (typeof value.workspaceId !== "string" || !/^[A-Za-z0-9_.:@/-]{1,240}$/.test(value.workspaceId)) throw new Error("Port Forward owner Workspace is invalid.");
  if (!Number.isInteger(value.remotePort) || Number(value.remotePort) < 1 || Number(value.remotePort) > 65535) throw new Error("Remote port is invalid.");
  if (value.localPort !== undefined && (!Number.isInteger(value.localPort) || value.localPort < 1 || value.localPort > 65535)) throw new Error("Local port is invalid.");
  if (value.remoteHost !== undefined && (typeof value.remoteHost !== "string" || !/^[A-Za-z0-9_.:-]{1,255}$/.test(value.remoteHost))) throw new Error("Remote host is invalid.");
  if (value.reconnectPolicy !== undefined && value.reconnectPolicy !== "automatic" && value.reconnectPolicy !== "manual") throw new Error("Reconnect policy is invalid.");
  const authorization = value.authorization;
  if (!authorization?.permissionGranted || typeof authorization.approvalId !== "string" || !/^approval:[a-f0-9-]{36,64}$/i.test(authorization.approvalId)
    || typeof authorization.correlationId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(authorization.correlationId)
    || typeof authorization.operationId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(authorization.operationId)) throw new Error("Port Forward requires Permission, scoped Approval, operation_id and correlation_id.");
  return value as DesktopPortForwardCreateRequest;
}

function parseResource(value: unknown): PersistedForward | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<PersistedForward>;
  if (typeof item.portForwardId !== "string" || !/^pf_[a-f0-9-]{36}$/i.test(item.portForwardId) || typeof item.hostAlias !== "string" || typeof item.workspaceId !== "string" || typeof item.localPort !== "number" || typeof item.remotePort !== "number" || !["starting", "active", "paused", "reconnecting", "failed", "removed"].includes(String(item.status))) return null;
  return { ...item, correlationId: item.correlationId ?? `legacy:${item.portForwardId}`, operationId: item.operationId ?? `legacy-import:${item.portForwardId}` } as PersistedForward;
}

function publicResource(resource: PersistedForward): DesktopPortForward { const { correlationId: _correlationId, operationId: _operationId, ...value } = resource; return { ...value }; }
function safeMessage(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/(token|password|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 1000); }

const systemPortForwardPlatform: PortForwardPlatform = {
  ensureHost: (hostAlias) => sshHostService.connect(hostAlias).then(() => undefined),
  spawn(resource) {
    const controlPath = sshHostService.controlPath(resource.hostAlias);
    if (!controlPath) throw new Error("SSH ControlMaster is unavailable.");
    const config = process.env.OPENDRSAI_SSH_CONFIG?.trim() ?? join(homedir(), ".ssh", "config");
    const executable = process.env.OPENDRSAI_SSH_EXECUTABLE?.trim() ?? (process.platform === "darwin" ? "/usr/bin/ssh" : "ssh");
    return spawn(executable, ["-F", config, "-S", "none", "-o", `UserKnownHostsFile=${sshHostService.knownHostsPath}`, "-o", "StrictHostKeyChecking=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2", "-N", "-L", `${resource.bindAddress}:${resource.localPort}:${resource.remoteHost}:${resource.remotePort}`, resource.hostAlias], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  },
  choosePort,
  waitForStart,
};

async function choosePort(host: string, preferred?: number): Promise<number> {
  if (preferred && await portAvailable(host, preferred)) return preferred;
  return new Promise((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, host, () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close(() => port ? resolve(port) : reject(new Error("No local port is available."))); }); });
}
function portAvailable(host: string, port: number): Promise<boolean> { return new Promise((resolve) => { const server = createServer(); server.once("error", () => resolve(false)); server.listen(port, host, () => server.close(() => resolve(true))); }); }
function waitForStart(child: ForwardProcess): Promise<void> { return new Promise((resolve, reject) => { const timer = setTimeout(() => { cleanup(); resolve(); }, 150); const onError = (error: Error) => { cleanup(); reject(error); }; const onExit = (code: number | null) => { cleanup(); reject(new Error(`SSH port forward exited during startup (${code ?? "unknown"}).`)); }; const cleanup = () => { clearTimeout(timer); child.removeListener("error", onError); child.removeListener("exit", onExit); }; child.once("error", onError); child.once("exit", onExit); }); }

export const portForwardRegistry = new PortForwardRegistry(join(process.env.DRSAI_HOME?.trim() || join(homedir(), ".drsai"), "desktop", "port-forwards.json"));
