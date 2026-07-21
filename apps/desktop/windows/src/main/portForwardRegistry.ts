import { randomUUID } from "crypto";
import { spawn, type ChildProcess } from "child_process";
import { appendFile, mkdir, readFile, rename, writeFile } from "fs/promises";
import { createServer } from "net";
import { dirname, join } from "path";
import { DRSAI_HOME } from "./paths";
import { ReconnectBackoff } from "./runtimeReliability";
import { resolveSshExecutable } from "./sshExecutable";

export type PortForwardStatus = "starting" | "active" | "paused" | "reconnecting" | "failed" | "removed";

export interface PortForwardResource {
  portForwardId: string;
  hostAlias: string;
  workspaceId: string;
  remoteHost: string;
  remotePort: number;
  bindAddress: string;
  requestedLocalPort?: number;
  localPort: number;
  status: PortForwardStatus;
  reconnectPolicy: "automatic" | "manual";
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  correlationId: string;
  operationId: string;
}

export interface PortForwardEvent {
  type: "created" | "status_changed" | "local_port_reassigned" | "removed";
  portForward: PortForwardResource;
  previousLocalPort?: number;
}

export interface CreatePortForwardRequest {
  hostAlias: string;
  workspaceId: string;
  remoteHost?: string;
  remotePort: number;
  bindAddress?: string;
  localPort?: number;
  reconnectPolicy?: "automatic" | "manual";
  nonLoopbackApproval?: { approved: true; approvalId: string };
  authorization: {
    permissionGranted: true;
    approvalId: string;
    correlationId: string;
    operationId: string;
  };
}

type ForwardProcess = Pick<ChildProcess, "exitCode" | "kill" | "once">;
type SpawnForward = (resource: PortForwardResource) => ForwardProcess;

export class PortForwardRegistry {
  private readonly resources = new Map<string, PortForwardResource>();
  private readonly processes = new Map<string, ForwardProcess>();
  private readonly reconnect = new Map<string, ReconnectBackoff>();
  private loaded = false;

  constructor(
    private readonly filePath = join(DRSAI_HOME, "desktop", "port-forwards.json"),
    private readonly spawnForward: SpawnForward = spawnSshForward,
    private readonly publish: (event: PortForwardEvent) => void = () => undefined,
  ) {}

  async list(filter: { hostAlias?: string; workspaceId?: string } = {}): Promise<PortForwardResource[]> {
    await this.load();
    return [...this.resources.values()].filter((item) => item.status !== "removed"
      && (!filter.hostAlias || item.hostAlias === filter.hostAlias)
      && (!filter.workspaceId || item.workspaceId === filter.workspaceId)).map(copyResource);
  }

  async create(request: CreatePortForwardRequest): Promise<PortForwardResource> {
    await this.load();
    validateCreateRequest(request);
    const bindAddress = request.bindAddress || "127.0.0.1";
    if (!isLoopback(bindAddress) && (!request.nonLoopbackApproval?.approved || !request.nonLoopbackApproval.approvalId)) {
      throw new Error("Non-loopback port forwarding requires Permission policy and explicit Approval Center confirmation.");
    }
    const requested = request.localPort;
    const localPort = await chooseLocalPort(bindAddress, requested);
    const now = new Date().toISOString();
    const resource: PortForwardResource = {
      portForwardId: `pf_${randomUUID()}`,
      hostAlias: request.hostAlias,
      workspaceId: request.workspaceId,
      remoteHost: request.remoteHost || "127.0.0.1",
      remotePort: request.remotePort,
      bindAddress,
      ...(requested ? { requestedLocalPort: requested } : {}),
      localPort,
      status: "starting",
      reconnectPolicy: request.reconnectPolicy || "automatic",
      createdAt: now,
      updatedAt: now,
      correlationId: request.authorization.correlationId,
      operationId: request.authorization.operationId,
    };
    this.resources.set(resource.portForwardId, resource);
    await this.audit("port_forward.authorized", resource, request.authorization.approvalId);
    await this.start(resource, requested !== undefined && requested !== localPort ? requested : undefined);
    await this.audit("port_forward.created", resource, request.authorization.approvalId);
    this.publish({ type: "created", portForward: copyResource(resource) });
    return copyResource(resource);
  }

  async pause(id: string): Promise<PortForwardResource> {
    const resource = await this.require(id);
    const child = this.processes.get(id);
    this.processes.delete(id);
    this.reconnect.delete(id);
    resource.status = "paused";
    child?.kill();
    await this.transition(resource, "paused");
    return copyResource(resource);
  }

  async resume(id: string): Promise<PortForwardResource> {
    const resource = await this.require(id);
    if (!(["paused", "failed", "reconnecting"] as PortForwardStatus[]).includes(resource.status)) return copyResource(resource);
    resource.localPort = await chooseLocalPort(resource.bindAddress, resource.requestedLocalPort || resource.localPort);
    await this.start(resource);
    return copyResource(resource);
  }

  async remove(id: string): Promise<boolean> {
    const resource = await this.require(id);
    const child = this.processes.get(id);
    this.processes.delete(id);
    this.reconnect.delete(id);
    resource.status = "removed";
    child?.kill();
    resource.updatedAt = new Date().toISOString();
    await this.persist();
    this.publish({ type: "removed", portForward: copyResource(resource) });
    return true;
  }

  async restore(): Promise<void> {
    await this.load();
    for (const resource of this.resources.values()) {
      if (["active", "starting", "reconnecting"].includes(resource.status) && resource.reconnectPolicy === "automatic") {
        resource.localPort = await chooseLocalPort(resource.bindAddress, resource.requestedLocalPort || resource.localPort);
        await this.start(resource);
      }
    }
  }

  async suspendHost(hostAlias: string): Promise<void> {
    await this.load();
    for (const resource of this.resources.values()) {
      if (resource.hostAlias !== hostAlias || resource.status === "removed" || resource.status === "paused") continue;
      const child = this.processes.get(resource.portForwardId);
      this.processes.delete(resource.portForwardId);
      resource.status = resource.reconnectPolicy === "automatic" ? "reconnecting" : "failed";
      child?.kill();
      await this.transition(resource, resource.reconnectPolicy === "automatic" ? "reconnecting" : "failed");
    }
  }

  async resumeHost(hostAlias: string): Promise<void> {
    await this.load();
    for (const resource of this.resources.values()) {
      if (resource.hostAlias === hostAlias && ["active", "starting", "reconnecting"].includes(resource.status) && !this.processes.has(resource.portForwardId) && resource.reconnectPolicy === "automatic") {
        resource.localPort = await chooseLocalPort(resource.bindAddress, resource.requestedLocalPort || resource.localPort);
        await this.start(resource);
      }
    }
  }

  private async start(resource: PortForwardResource, reassignedFrom?: number): Promise<void> {
    resource.status = "starting";
    resource.lastError = undefined;
    resource.updatedAt = new Date().toISOString();
    const child = this.spawnForward(resource);
    this.processes.set(resource.portForwardId, child);
    child.once("exit", (code) => {
      if (this.processes.get(resource.portForwardId) !== child) return;
      this.processes.delete(resource.portForwardId);
      if (["paused", "removed"].includes(resource.status)) return;
      resource.lastError = `SSH port forward exited (${code ?? "unknown"}).`;
      if (resource.reconnectPolicy === "manual") void this.transition(resource, "failed");
      else void this.scheduleReconnect(resource);
    });
    resource.status = "active";
    await this.persist();
    if (reassignedFrom !== undefined) this.publish({ type: "local_port_reassigned", portForward: copyResource(resource), previousLocalPort: reassignedFrom });
    this.publish({ type: "status_changed", portForward: copyResource(resource) });
  }

  private async scheduleReconnect(resource: PortForwardResource): Promise<void> {
    const policy = this.reconnect.get(resource.portForwardId) || new ReconnectBackoff();
    this.reconnect.set(resource.portForwardId, policy);
    const next = policy.next();
    if (next.exhausted) return this.transition(resource, "failed");
    await this.transition(resource, "reconnecting");
    const timer = setTimeout(async () => {
      if (resource.status !== "reconnecting") return;
      try {
        const previous = resource.localPort;
        resource.localPort = await chooseLocalPort(resource.bindAddress, resource.requestedLocalPort || previous);
        await this.start(resource, resource.localPort !== previous ? previous : undefined);
        policy.reset();
      } catch (error) {
        resource.lastError = error instanceof Error ? error.message : String(error);
        await this.scheduleReconnect(resource);
      }
    }, next.delayMs);
    timer.unref();
  }

  private async transition(resource: PortForwardResource, status: PortForwardStatus): Promise<void> {
    resource.status = status;
    resource.updatedAt = new Date().toISOString();
    await this.persist();
    this.publish({ type: "status_changed", portForward: copyResource(resource) });
  }

  private async require(id: string): Promise<PortForwardResource> {
    await this.load();
    const resource = this.resources.get(id);
    if (!resource || resource.status === "removed") throw new Error("Port Forward not found.");
    return resource;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as { resources?: PortForwardResource[] };
      for (const item of parsed.resources || []) if (isResource(item)) {
        const migrated = {
          ...item,
          correlationId: item.correlationId || `legacy:${item.portForwardId}`,
          operationId: item.operationId || `legacy-import:${item.portForwardId}`,
        };
        this.resources.set(migrated.portForwardId, migrated);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ version: 2, resources: [...this.resources.values()] }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }

  private async audit(event: string, resource: PortForwardResource, approvalId?: string): Promise<void> {
    const record = {
      timestamp: new Date().toISOString(), event,
      hostId: resource.hostAlias, workspaceId: resource.workspaceId,
      portForwardId: resource.portForwardId, operationId: resource.operationId,
      correlationId: resource.correlationId, ...(approvalId ? { approvalId } : {}),
      status: resource.status,
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(`${this.filePath}.audit.jsonl`, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}

function spawnSshForward(resource: PortForwardResource): ForwardProcess {
  const config = process.env.OPENDRSAI_SSH_CONFIG?.trim();
  const args = [
    ...(config ? ["-F", config] : []),
    "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2", "-N", "-L",
    `${resource.bindAddress}:${resource.localPort}:${resource.remoteHost}:${resource.remotePort}`,
    resource.hostAlias,
  ];
  return spawn(resolveSshExecutable(), args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
}

async function chooseLocalPort(host: string, preferred?: number): Promise<number> {
  if (preferred && await portAvailable(host, preferred)) return preferred;
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => port ? resolve(port) : reject(new Error("No local port is available.")));
    });
  });
}

function portAvailable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

function isLoopback(host: string): boolean { return host === "127.0.0.1" || host === "::1" || host === "localhost"; }
function copyResource(resource: PortForwardResource): PortForwardResource { return { ...resource }; }
function validateCreateRequest(request: CreatePortForwardRequest): void {
  if (!/^[A-Za-z0-9_.@-]{1,128}$/.test(request.hostAlias)) throw new Error("Port Forward host alias is invalid.");
  if (!request.workspaceId || /[\r\n\0]/.test(request.workspaceId)) throw new Error("Port Forward owner Workspace is invalid.");
  if (!Number.isInteger(request.remotePort) || request.remotePort < 1 || request.remotePort > 65535) throw new Error("Remote port is invalid.");
  if (request.localPort !== undefined && (!Number.isInteger(request.localPort) || request.localPort < 1 || request.localPort > 65535)) throw new Error("Local port is invalid.");
  if (!/^[A-Za-z0-9_.:-]{1,255}$/.test(request.remoteHost || "127.0.0.1")) throw new Error("Remote host is invalid.");
  if (!request.authorization?.permissionGranted || !request.authorization.approvalId
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(request.authorization.correlationId)
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(request.authorization.operationId)) {
    throw new Error("Port Forward requires Permission, scoped Approval, operation_id and correlation_id.");
  }
}
function isResource(value: unknown): value is PortForwardResource {
  const item = value as PortForwardResource;
  return Boolean(item && typeof item.portForwardId === "string" && typeof item.hostAlias === "string" && typeof item.workspaceId === "string"
    && typeof item.localPort === "number" && typeof item.remotePort === "number" && typeof item.status === "string");
}
