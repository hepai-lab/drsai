import { createHash, randomBytes } from "crypto";
import { spawn, execFile, type ChildProcess } from "child_process";
import { readFile, readdir, stat } from "fs/promises";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, resolve } from "path";
import type { ConnectRemoteWorkspaceRequest, DesktopThread, DesktopThreadContentSearchRequest, DesktopThreadContentSearchResult, DesktopThreadSnapshot, RemoteDirectoryEntry, RemoteGatewayInstallRequest, RemoteGatewayInstallResult, RemoteGatewayOperationEvent, RemoteGatewayPreflight, RemoteHepaiWorker, RemoteSshDiagnosticReport, RemoteSshHost, RemoteWorkspaceStatus, WorkspaceCheckpoint, WorkspaceCheckpointAcceptRequest, WorkspaceCheckpointCreateRequest, WorkspaceCheckpointPreviewRequest, WorkspaceCheckpointPreviewResult, WorkspaceCheckpointRestoreRequest, WorkspaceCheckpointRestoreResult, WorkspaceContextOverview, WorkspaceFileChangeEvent, WorkspaceFilePreview, WorkspaceFilePreviewRequest, WorkspaceFileTreeRequest, WorkspaceFileTreeResult, WorkspaceFolderSummaryRequest, WorkspaceFolderSummaryResult, WorkspaceGitDiffRequest, WorkspaceGitDiffResult, WorkspaceGitFileAtRefRequest, WorkspaceGitFileAtRefResult, WorkspaceProject } from "../shared/desktopApi";
import { createRemoteWorkspace, findWorkspaceById, listWorkspaces } from "./workspaces";
import { RemoteGatewayClient } from "./remoteGatewayClient.generated";
import { REMOTE_CAPABILITY_VERSIONS, REMOTE_SSH_PROTOCOL_VERSION } from "../shared/remoteSshProtocol";

const SSH_TIMEOUT_MS = 12_000;
const REMOTE_PORT = 18642;
type HostConnection = {
  tunnel: ChildProcess;
  token: string;
  alias: string;
  bootstrapPath: string;
  localPort: number;
  retries: number;
  intentionalClose: boolean;
  state: RemoteWorkspaceStatus["connectionState"];
  error?: string;
  workspaceIds: Set<string>;
  gatewayVersion?: string;
  protocolVersion?: number;
  capabilities?: Record<string, number>;
  reconnectTimer?: NodeJS.Timeout;
  createdAt: number;
  lastConnectedAt?: number;
  reconnectCount: number;
  events: Array<{ at: string; phase: string; elapsedMs?: number; message?: string }>;
  healthTimer?: NodeJS.Timeout;
  healthFailures: number;
};
type RemoteConnection = { status: RemoteWorkspaceStatus; alias: string; path: string };
const connections = new Map<string, RemoteConnection>();
const hostConnections = new Map<string, HostConnection>();
const remoteThreadWorkspaces = new Map<string, string>();

function recordHostEvent(host: HostConnection, phase: string, startedAt?: number, message?: string): void {
  host.events.push({ at: new Date().toISOString(), phase, ...(startedAt ? { elapsedMs: Date.now() - startedAt } : {}), ...(message ? { message: message.replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]") } : {}) });
  if (host.events.length > 100) host.events.splice(0, host.events.length - 100);
}

export function getRemoteSshDiagnosticReport(): RemoteSshDiagnosticReport {
  const now = Date.now();
  return { generatedAt: new Date(now).toISOString(), hosts: [...hostConnections.values()].map((host) => ({ hostAlias: host.alias, state: host.state, workspaceCount: host.workspaceIds.size, gatewayVersion: host.gatewayVersion, protocolVersion: host.protocolVersion, reconnectAttempts: host.retries, reconnectCount: host.reconnectCount, ageMs: now - host.createdAt, ...(host.lastConnectedAt ? { lastConnectedAt: new Date(host.lastConnectedAt).toISOString() } : {}), ...(host.error ? { error: host.error.replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]") } : {}), events: host.events.map((event) => ({ ...event })) })) };
}

export function bindRemoteThread(threadId: string, workspaceId: string): void {
  if (threadId && connections.has(workspaceId)) remoteThreadWorkspaces.set(threadId, workspaceId);
}
const MAX_RECONNECT_ATTEMPTS = 5;
let publishStatus: ((status: RemoteWorkspaceStatus) => void) | undefined;
let publishGatewayOperation: ((event: RemoteGatewayOperationEvent) => void) | undefined;
const activeGatewayOperations = new Map<string, { operationId: string; controller: AbortController }>();
const remoteFileWatchers = new Map<string, WebSocket>();
let publishFileChanges: ((event: WorkspaceFileChangeEvent) => void) | undefined;

export function setRemoteWorkspaceStatusPublisher(publisher: (status: RemoteWorkspaceStatus) => void): void {
  publishStatus = publisher;
}

export function setRemoteGatewayOperationPublisher(publisher: (event: RemoteGatewayOperationEvent) => void): void {
  publishGatewayOperation = publisher;
}

export function setRemoteFileChangePublisher(publisher: (event: WorkspaceFileChangeEvent) => void): void {
  publishFileChanges = publisher;
}

function ensureRemoteFileWatcher(workspacePath: string): void {
  if (remoteFileWatchers.has(workspacePath)) return;
  const access = getRemoteGatewayAccess(workspacePath); if (!access) return;
  const socket = new WebSocket(`${access.baseUrl.replace(/^http/, "ws")}/v1/workspaces/${encodeURIComponent(access.workspaceId)}/watch`);
  remoteFileWatchers.set(workspacePath, socket);
  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "auth", token: access.token })));
  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(String(event.data)) as { type?: string; changes?: WorkspaceFileChangeEvent["changes"] };
      if (message.type === "changes" && Array.isArray(message.changes)) publishFileChanges?.({ workspacePath, changes: message.changes });
    } catch { /* ignore malformed remote events */ }
  });
  socket.addEventListener("close", () => {
    if (remoteFileWatchers.get(workspacePath) === socket) remoteFileWatchers.delete(workspacePath);
    if (getRemoteGatewayAccess(workspacePath)) setTimeout(() => ensureRemoteFileWatcher(workspacePath), 1_000);
  });
}

export function cancelRemoteGatewayOperation(hostAlias: string): boolean {
  const operation = activeGatewayOperations.get(assertAlias(hostAlias));
  if (!operation) return false;
  operation.controller.abort();
  return true;
}

function emitWorkspaceStatus(status: RemoteWorkspaceStatus): void {
  publishStatus?.({ ...status });
}

function exec(command: string, args: string[], timeout = SSH_TIMEOUT_MS, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024, signal }, (error, stdout, stderr) => {
      if (error) return reject(new Error((stderr || error.message).trim()));
      resolve(stdout.trim());
    });
  });
}

function execWithInput(command: string, args: string[], input: string, timeout = SSH_TIMEOUT_MS, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeout);
    const abort = (): void => { child.kill(); };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (code !== 0) return reject(new Error(stderr.trim() || `Command exited with ${code}.`));
      resolve(stdout.trim());
    });
    child.stdin.end(input, "utf8");
  });
}

function assertAlias(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.@-]{1,128}$/.test(value)) throw new Error("SSH host alias is invalid.");
  return value;
}

function sshArgs(alias: string): string[] {
  return [...sshConfigArgs(), "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", assertAlias(alias)];
}

function sshConfigArgs(): string[] {
  const configured = process.env.OPENDRSAI_SSH_CONFIG?.trim();
  if (!configured) return [];
  if (configured.length > 4096 || /[\r\n\0]/.test(configured)) throw new Error("SSH config path is invalid.");
  return ["-F", configured];
}

export async function listSshHosts(): Promise<RemoteSshHost[]> {
  const rootConfig = process.env.OPENDRSAI_SSH_CONFIG?.trim() || join(homedir(), ".ssh", "config");
  const sources = await readSshConfigSources(rootConfig);
  if (sources.length === 0) return [];
  const aliases = new Set<string>();
  for (const source of sources) for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*Host\s+(.+)$/i);
    if (!match) continue;
    for (const alias of match[1].trim().split(/\s+/)) {
      if (!alias.includes("*") && !alias.includes("?") && /^[A-Za-z0-9_.@-]+$/.test(alias)) aliases.add(alias);
    }
  }
  const hosts: RemoteSshHost[] = [];
  for (const alias of aliases) {
    try {
      const resolved = await exec("ssh.exe", [...sshConfigArgs(), "-G", alias], 5000);
      const values = new Map(resolved.split(/\r?\n/).map((line) => {
        const index = line.indexOf(" ");
        return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : ["", ""];
      }));
      hosts.push({ alias, hostname: values.get("hostname") || alias, user: values.get("user") || undefined, port: Number(values.get("port") || 22), proxyJump: values.get("proxyjump") !== "none" ? values.get("proxyjump") : undefined });
    } catch { hosts.push({ alias, hostname: alias, port: 22 }); }
  }
  return hosts.sort((a, b) => a.alias.localeCompare(b.alias));
}

async function readSshConfigSources(rootPath: string): Promise<string[]> {
  const queue = [resolve(rootPath.replace(/^~(?=[/\\])/, homedir()))]; const seen = new Set<string>(); const sources: string[] = [];
  while (queue.length && seen.size < 64) {
    const file = queue.shift()!; if (seen.has(file)) continue; seen.add(file);
    let source: string; try { source = await readFile(file, "utf8"); } catch { continue; }
    sources.push(source);
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*Include\s+(.+)$/i); if (!match) continue;
      for (const token of match[1].trim().split(/\s+/)) {
        const expanded = token.replace(/^~(?=[/\\])/, homedir()); const candidate = isAbsolute(expanded) ? expanded : resolve(dirname(file), expanded);
        if (!/[?*]/.test(candidate)) { queue.push(candidate); continue; }
        const folder = dirname(candidate); const pattern = basename(candidate).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
        try { for (const name of await readdir(folder)) if (new RegExp(`^${pattern}$`, "i").test(name)) queue.push(join(folder, name)); } catch { /* ignored */ }
      }
    }
  }
  return sources;
}

export async function testSshHost(hostAlias: string): Promise<boolean> {
  try { await exec("ssh.exe", [...sshArgs(hostAlias), "printf", "opendrsai-ok"]); return true; } catch { return false; }
}

export async function approveSshHostKey(hostAlias: string): Promise<boolean> {
  try {
    await exec("ssh.exe", [...sshConfigArgs(), "-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", assertAlias(hostAlias), "printf", "opendrsai-ok"]);
    return true;
  } catch { return false; }
}

export async function listRemoteDirectories(hostAlias: string, rawPath = "~"): Promise<RemoteDirectoryEntry[]> {
  const alias = assertAlias(hostAlias);
  if (typeof rawPath !== "string" || rawPath.length > 4096 || /[\r\n\0]/.test(rawPath)) throw new Error("Remote path is invalid.");
  const pathPayload = Buffer.from(rawPath, "utf8").toString("base64");
  const script = `import base64,json,os
p=os.path.realpath(os.path.expanduser(base64.b64decode("${pathPayload}").decode()))
rows=[]
for e in os.scandir(p):
    if e.is_dir(follow_symlinks=False):
        st=e.stat(follow_symlinks=False)
        rows.append({"name":e.name,"path":os.path.realpath(e.path),"directory":True,"readable":os.access(e.path,os.R_OK|os.X_OK),"writable":os.access(e.path,os.W_OK),"mode":oct(st.st_mode & 0o777)})
print(json.dumps(sorted(rows,key=lambda x:x["name"].lower())))`;
  const output = await execWithInput("ssh.exe", [...sshArgs(alias), "python3", "-"], script);
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed)) throw new Error("Remote directory response is invalid.");
  return parsed;
}

async function canonicalRemotePath(alias: string, path: string): Promise<string> {
  if (typeof path !== "string" || path.length > 4096 || /[\r\n\0]/.test(path)) throw new Error("Remote path is invalid.");
  const payload = Buffer.from(path, "utf8").toString("base64");
  const script = `import base64,os
p=os.path.realpath(os.path.expanduser(base64.b64decode("${payload}").decode()))
if not os.path.isdir(p): raise SystemExit("not a directory")
print(p)`;
  return execWithInput("ssh.exe", [...sshArgs(alias), "python3", "-"], script);
}

export async function preflightRemoteGateway(hostAlias: string): Promise<RemoteGatewayPreflight> {
  const alias = assertAlias(hostAlias);
  const script = `import importlib.metadata,json,pathlib,platform
home=pathlib.Path.home()/".local"/"share"/"opendrsai"/"remote"
def link(name):
 p=home/name
 try: return p.resolve().name if p.exists() or p.is_symlink() else None
 except OSError: return None
current=home/"current"; managed=current/"bin"/"python"
if managed.exists():
 import subprocess
 probe=subprocess.run([str(managed),"-c",'import importlib.metadata;print(importlib.metadata.version("drsai"))'],capture_output=True,text=True)
 version=probe.stdout.strip() if probe.returncode==0 else None
else:
 try: version=importlib.metadata.version("drsai")
 except importlib.metadata.PackageNotFoundError: version=None
print(json.dumps({"pythonVersion":platform.python_version(),"gatewayInstalled":version is not None,"gatewayVersion":version,"currentRelease":link("current"),"previousRelease":link("previous")}))`;
  const result = JSON.parse(await execWithInput("ssh.exe", [...sshArgs(alias), "python3", "-"], script)) as Omit<RemoteGatewayPreflight, "hostAlias">;
  return { hostAlias: alias, ...result };
}

export async function installRemoteGateway(request: RemoteGatewayInstallRequest): Promise<RemoteGatewayInstallResult> {
  const alias = assertAlias(request.hostAlias);
  if (activeGatewayOperations.has(alias)) throw new Error("A Remote Gateway operation is already running for this host.");
  const operationId = `${Date.now()}-${randomBytes(8).toString("hex")}`;
  const controller = new AbortController();
  activeGatewayOperations.set(alias, { operationId, controller });
  const emit = (phase: RemoteGatewayOperationEvent["phase"], progress: number, message: string, state: RemoteGatewayOperationEvent["state"] = "running"): void => publishGatewayOperation?.({ operationId, hostAlias: alias, action: request.action, state, phase, progress, message });
  emit("validating", 2, "Validating the requested operation and local artifact.");
  try {
    const result = await performRemoteGatewayInstall(request, controller.signal, emit);
    emit("completed", 100, "Remote Gateway operation completed.", "completed");
    return result;
  } catch (error) {
    const cancelled = controller.signal.aborted;
    emit("completed", cancelled ? 0 : 100, cancelled ? "Remote Gateway operation cancelled; current release was preserved." : `Remote Gateway operation failed: ${error instanceof Error ? error.message : String(error)}`, cancelled ? "cancelled" : "failed");
    throw error;
  } finally {
    if (activeGatewayOperations.get(alias)?.operationId === operationId) activeGatewayOperations.delete(alias);
  }
}

async function performRemoteGatewayInstall(request: RemoteGatewayInstallRequest, signal: AbortSignal, emit: (phase: RemoteGatewayOperationEvent["phase"], progress: number, message: string) => void): Promise<RemoteGatewayInstallResult> {
  const alias = assertAlias(request.hostAlias);
  if (!request || !["install", "upgrade", "rollback"].includes(request.action)) throw new Error("Remote Gateway action is invalid.");
  const version = request.version?.trim();
  if (request.action !== "rollback" && (!version || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(version))) throw new Error("A valid Gateway version is required.");
  let artifactName: string | undefined; let artifactSha256: string | undefined;
  if (request.action !== "rollback") {
    emit("validating", 8, "Calculating and validating the artifact SHA-256 digest.");
    const artifactPath = request.artifactPath?.trim();
    if (!artifactPath || !/\.(whl|tar\.gz)$/i.test(artifactPath) || /[\r\n\0]/.test(artifactPath)) throw new Error("A local wheel or source archive is required.");
    const details = await stat(artifactPath); if (!details.isFile() || details.size > 1024 * 1024 * 1024) throw new Error("Gateway artifact is invalid or too large.");
    artifactSha256 = createHash("sha256").update(await readFile(artifactPath)).digest("hex");
    if (request.artifactSha256 && request.artifactSha256.toLowerCase() !== artifactSha256) throw new Error("Gateway artifact SHA-256 does not match.");
    artifactName = basename(artifactPath);
    if (!/^[A-Za-z0-9_.+-]{1,200}$/.test(artifactName)) throw new Error("Gateway artifact filename is invalid.");
    await execWithInput("ssh.exe", [...sshArgs(alias), "python3", "-"], `import pathlib\np=pathlib.Path.home()/".local"/"share"/"opendrsai"/"remote"/"incoming"\np.mkdir(parents=True,exist_ok=True)\n`, SSH_TIMEOUT_MS, signal);
    emit("uploading", 20, "Uploading the verified artifact through SCP.");
    await exec("scp.exe", [...sshConfigArgs(), "-q", artifactPath, `${alias}:.local/share/opendrsai/remote/incoming/${artifactName}`], 180_000, signal);
  }
  emit(request.action === "rollback" ? "switching" : "installing", request.action === "rollback" ? 60 : 40, request.action === "rollback" ? "Preparing an atomic release rollback." : "Creating an isolated candidate release.");
  const data = Buffer.from(JSON.stringify({ action: request.action, version, artifactName, artifactSha256, protocolVersion: REMOTE_SSH_PROTOCOL_VERSION }), "utf8").toString("base64");
  const script = `import base64,json,os,pathlib,subprocess,sys,shutil,socket,time,uuid
cfg=json.loads(base64.b64decode("${data}")); home=pathlib.Path.home()/".local"/"share"/"opendrsai"/"remote"; releases=home/"releases"
releases.mkdir(parents=True,exist_ok=True); current=home/"current"; previous=home/"previous"
def swap(link,target):
 tmp=link.with_name(link.name+".tmp")
 try: tmp.unlink()
 except FileNotFoundError: pass
 tmp.symlink_to(target,target_is_directory=True); os.replace(tmp,link)
if cfg["action"]=="rollback":
 if not previous.exists(): raise SystemExit("No previous Remote Gateway release is available.")
 old=current.resolve() if current.exists() else None; target=previous.resolve(); swap(current,target)
 if old: swap(previous,old)
else:
  target=releases/cfg["version"]
  if target.exists(): raise SystemExit("Remote Gateway release already exists; use a new version or rollback.")
  staging=releases/(".staging-"+cfg["version"]+"-"+uuid.uuid4().hex)
  artifact=home/"incoming"/cfg["artifactName"]
  import hashlib
  if hashlib.sha256(artifact.read_bytes()).hexdigest()!=cfg["artifactSha256"]: raise SystemExit("Artifact SHA-256 mismatch")
  try:
   subprocess.run([sys.executable,"-m","venv","--system-site-packages",str(staging)],check=True)
   py=staging/("Scripts/python.exe" if os.name=="nt" else "bin/python")
   subprocess.run([str(py),"-m","pip","install","--disable-pip-version-check","--no-deps",str(artifact)],check=True)
   subprocess.run([str(py),"-c",f'import drsai.backend.gateway as g; assert getattr(g,"_REMOTE_PROTOCOL_VERSION",None)=={cfg["protocolVersion"]}'],check=True)
   probe=socket.socket(); probe.bind(("127.0.0.1",0)); port=probe.getsockname()[1]; probe.close()
   env=os.environ.copy(); env.update({"DRSAI_API_HOST":"127.0.0.1","DRSAI_API_PORT":str(port),"OPENDRSAI_GATEWAY_INSTANCE_TOKEN":uuid.uuid4().hex})
   process=subprocess.Popen([str(py),"-m","drsai.backend.gateway"],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   try:
    for _ in range(50):
     if process.poll() is not None: raise RuntimeError("Candidate Gateway exited during startup")
     try:
      with socket.create_connection(("127.0.0.1",port),timeout=.1): break
     except OSError: time.sleep(.1)
    else: raise RuntimeError("Candidate Gateway did not start")
   finally:
    process.terminate()
    try: process.wait(timeout=5)
    except subprocess.TimeoutExpired: process.kill()
   os.replace(staging,target)
  except BaseException:
   shutil.rmtree(staging,ignore_errors=True); artifact.unlink(missing_ok=True); raise
  if current.exists(): swap(previous,current.resolve())
  swap(current,target)
  artifact.unlink(missing_ok=True)
print("ok")`;
  emit("health-check", 75, "Verifying protocol compatibility and candidate Gateway startup.");
  await execWithInput("ssh.exe", [...sshArgs(alias), "python3", "-"], script, 180_000, signal);
  emit("switching", 92, "Candidate is healthy; reading the atomically switched release state.");
  return { ...(await preflightRemoteGateway(alias)), changed: true, action: request.action };
}

function makeWorkspaceId(alias: string, path: string): string {
  return `ssh-${createHash("sha256").update(`${alias}\\0${path}`).digest("hex").slice(0, 24)}`;
}

async function startRemoteGateway(alias: string, path: string, token: string): Promise<void> {
  const data = Buffer.from(JSON.stringify({ path, token, port: REMOTE_PORT }), "utf8").toString("base64");
  const script = `import base64,json,os,pathlib,subprocess,sys
cfg=json.loads(base64.b64decode("${data}"))
home=pathlib.Path.home()/".local"/"share"/"opendrsai"/"remote"
home.mkdir(parents=True,exist_ok=True)
pidfile=home/"gateway.pid"
if pidfile.exists():
 try:
  old=int(pidfile.read_text().strip())
  os.kill(old,15)
  import time; time.sleep(.2)
 except (ValueError,ProcessLookupError,PermissionError): pass
log=open(home/"gateway.log","ab",buffering=0)
env=os.environ.copy()
env.update({"DRSAI_API_HOST":"127.0.0.1","DRSAI_API_PORT":str(cfg["port"]),"OPENDRSAI_GATEWAY_INSTANCE_TOKEN":cfg["token"]})
managed=home/"current"/"bin"/"python"
python=str(managed) if managed.exists() else sys.executable
p=subprocess.Popen([python,"-m","drsai.backend.gateway"],cwd=cfg["path"],env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
pidfile.write_text(str(p.pid))
print("started")`;
  await execWithInput("ssh.exe", [...sshArgs(alias), "python3", "-"], script, 20_000);
}

function openTunnel(alias: string, localPort: number): ChildProcess {
  return spawn("ssh.exe", [...sshConfigArgs(),"-o","BatchMode=yes","-o","ExitOnForwardFailure=yes","-o","ServerAliveInterval=5","-o","ServerAliveCountMax=2","-N","-L",`127.0.0.1:${localPort}:127.0.0.1:${REMOTE_PORT}`,assertAlias(alias)], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
}

async function availablePort(): Promise<number> {
  const net = await import("net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => port ? resolve(port) : reject(new Error("No local port available.")));
    });
  });
}

export async function connectRemoteWorkspace(request: ConnectRemoteWorkspaceRequest): Promise<WorkspaceProject> {
  const alias = assertAlias(request.hostAlias);
  const path = await canonicalRemotePath(alias, request.path);
  const id = makeWorkspaceId(alias, path);
  const previous = connections.get(id);
  if (previous) await disconnectRemoteWorkspace(id);
  const status: RemoteWorkspaceStatus = { hostAlias: alias, canonicalPath: path, workspaceId: id, connectionState: "connecting", connected: false, gatewayReady: false };
  connections.set(id, { status, alias, path });
  try {
    const host = await getOrCreateHostConnection(alias, path);
    host.workspaceIds.add(id);
    await registerWorkspace(host, id, path);
    status.localPort = host.localPort;
    status.gatewayVersion = host.gatewayVersion;
    status.protocolVersion = host.protocolVersion;
    status.capabilities = host.capabilities;
    status.connected = true; status.gatewayReady = true; status.connectionState = "connected";
    emitWorkspaceStatus(status);
  } catch (error) {
    connections.delete(id);
    throw error;
  }
  return createRemoteWorkspace({ id, name: request.name, path, trusted: request.trusted, remote: status });
}

async function getOrCreateHostConnection(alias: string, bootstrapPath: string): Promise<HostConnection> {
  const active = hostConnections.get(alias);
  if (active && active.state === "connected" && active.tunnel.exitCode === null) return active;
  if (active) closeHostConnection(active);
  const localPort = await availablePort();
  const host: HostConnection = { tunnel: openTunnel(alias, localPort), token: randomBytes(32).toString("base64url"), alias, bootstrapPath, localPort, retries: 0, intentionalClose: false, state: "connecting", workspaceIds: new Set(), createdAt: Date.now(), reconnectCount: 0, events: [], healthFailures: 0 };
  recordHostEvent(host, "tunnel.connecting");
  hostConnections.set(alias, host);
  attachTunnelLifecycle(host);
  try {
    await startRemoteGateway(alias, bootstrapPath, host.token);
    await waitForGateway(host);
    host.state = "connected"; host.lastConnectedAt = Date.now();
    recordHostEvent(host, "gateway.connected", host.createdAt);
    startHostHealthMonitor(host);
    return host;
  } catch (error) {
    if (hostConnections.get(alias) === host) hostConnections.delete(alias);
    closeHostConnection(host);
    throw error;
  }
}

async function waitForGateway(host: HostConnection): Promise<void> {
  const baseUrl = `http://127.0.0.1:${host.localPort}`;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (host.tunnel.exitCode !== null) break;
    try {
      const handshake = await fetch(`${baseUrl}/v1/remote/handshake`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-OpenDrSai-Gateway-Token": host.token },
        body: JSON.stringify({ protocol_version: REMOTE_SSH_PROTOCOL_VERSION, client_version: "1.4.4", workspace_path: host.bootstrapPath }),
        signal: AbortSignal.timeout(1200),
      });
      if (handshake.ok) {
        const payload = await handshake.json() as { protocol_version?: number; gateway_version?: string; capabilities?: string[]; capability_versions?: Record<string, number> };
        if (payload.protocol_version !== 1) throw new Error("Remote Gateway protocol is incompatible.");
        host.protocolVersion = payload.protocol_version;
        host.gatewayVersion = payload.gateway_version;
        host.capabilities = payload.capability_versions || Object.fromEntries((payload.capabilities || []).map((name) => [name, 1]));
        for (const [capability, minimum] of Object.entries(REMOTE_CAPABILITY_VERSIONS)) {
          if ((host.capabilities[capability] || 0) < minimum) throw new Error(`Remote Gateway capability ${capability} is incompatible.`);
        }
        ready = true; break;
      }
    } catch { /* Gateway is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) {
    throw new Error("Remote Gateway did not become ready.");
  }
}

async function registerWorkspace(host: HostConnection, workspaceId: string, path: string): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${host.localPort}/v1/workspaces/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-OpenDrSai-Gateway-Token": host.token },
    body: JSON.stringify({ workspace_id: workspaceId, path }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Remote workspace registration failed (${response.status}).`);
}

function attachTunnelLifecycle(host: HostConnection): void {
  host.tunnel.once("exit", (code) => {
    if (hostConnections.get(host.alias) !== host || host.intentionalClose) return;
    if (host.healthTimer) clearInterval(host.healthTimer);
    host.healthTimer = undefined;
    host.state = "reconnecting";
    host.error = `SSH tunnel exited (${code ?? "unknown"}).`;
    updateHostWorkspaceStatuses(host);
    scheduleReconnect(host);
  });
}

function updateHostWorkspaceStatuses(host: HostConnection): void {
  for (const workspaceId of host.workspaceIds) {
    const workspace = connections.get(workspaceId);
    if (!workspace) continue;
    workspace.status = { ...workspace.status, localPort: host.localPort, gatewayVersion: host.gatewayVersion, protocolVersion: host.protocolVersion, capabilities: host.capabilities, connected: host.state === "connected", gatewayReady: host.state === "connected", connectionState: host.state, error: host.error };
    emitWorkspaceStatus(workspace.status);
  }
}

function scheduleReconnect(host: HostConnection): void {
  if (host.retries >= MAX_RECONNECT_ATTEMPTS) {
    host.state = "failed";
    host.error = "Remote SSH reconnect attempts were exhausted.";
    recordHostEvent(host, "reconnect.exhausted", undefined, host.error);
    updateHostWorkspaceStatuses(host);
    return;
  }
  const delay = Math.min(1000 * 2 ** host.retries, 16_000);
  host.retries += 1;
  recordHostEvent(host, "reconnect.scheduled", undefined, `attempt=${host.retries} delayMs=${delay}`);
  host.reconnectTimer = setTimeout(async () => {
    if (hostConnections.get(host.alias) !== host || host.intentionalClose) return;
    try {
      host.localPort = await availablePort();
      host.token = randomBytes(32).toString("base64url");
      await startRemoteGateway(host.alias, host.bootstrapPath, host.token);
      host.tunnel = openTunnel(host.alias, host.localPort);
      attachTunnelLifecycle(host);
      await waitForGateway(host);
      for (const workspaceId of host.workspaceIds) {
        const workspace = connections.get(workspaceId);
        if (workspace) await registerWorkspace(host, workspaceId, workspace.path);
      }
      host.reconnectCount += 1; host.retries = 0; host.state = "connected"; host.error = undefined; host.lastConnectedAt = Date.now();
      recordHostEvent(host, "reconnect.connected");
      startHostHealthMonitor(host);
      updateHostWorkspaceStatuses(host);
    } catch (error) {
      host.error = error instanceof Error ? error.message : String(error);
      recordHostEvent(host, "reconnect.failed", undefined, host.error);
      scheduleReconnect(host);
    }
  }, delay);
}

export async function disconnectRemoteWorkspace(id: string): Promise<boolean> {
  const item = connections.get(id);
  if (!item) return false;
  connections.delete(id);
  const watcher = remoteFileWatchers.get(item.path); remoteFileWatchers.delete(item.path); watcher?.close();
  emitWorkspaceStatus({ ...item.status, connected: false, gatewayReady: false, connectionState: "disconnected", localPort: undefined });
  const host = hostConnections.get(item.alias);
  if (host) {
    host.workspaceIds.delete(id);
    if (host.workspaceIds.size === 0) {
      hostConnections.delete(item.alias);
      closeHostConnection(host);
    }
  }
  return true;
}

export async function restorePersistedRemoteWorkspaces(): Promise<void> {
  for (const workspace of await listWorkspaces()) {
    if (workspace.type !== "remote-ssh" || !workspace.remote || connections.has(workspace.id)) continue;
    void connectRemoteWorkspace({ hostAlias: workspace.remote.hostAlias, path: workspace.remote.canonicalPath, name: workspace.name, trusted: workspace.trusted }).catch((error) => {
      emitWorkspaceStatus({ ...workspace.remote!, connected: false, gatewayReady: false, connectionState: "failed", error: error instanceof Error ? error.message : String(error) });
    });
  }
}

function closeHostConnection(host: HostConnection): void {
  host.intentionalClose = true;
  if (host.reconnectTimer) clearTimeout(host.reconnectTimer);
  if (host.healthTimer) clearInterval(host.healthTimer);
  host.tunnel.kill();
}

function startHostHealthMonitor(host: HostConnection): void {
  if (host.healthTimer) clearInterval(host.healthTimer);
  host.healthFailures = 0;
  host.healthTimer = setInterval(async () => {
    if (host.intentionalClose || host.state !== "connected") return;
    try {
      const response = await fetch(`http://127.0.0.1:${host.localPort}/health`, { headers: { "X-OpenDrSai-Gateway-Token": host.token }, signal: AbortSignal.timeout(2_000) });
      if (!response.ok) throw new Error(`health status ${response.status}`);
      host.healthFailures = 0;
    } catch (error) {
      host.healthFailures += 1;
      recordHostEvent(host, "gateway.health-failed", undefined, error instanceof Error ? error.message : String(error));
      if (host.healthFailures >= 2) {
        if (host.healthTimer) clearInterval(host.healthTimer);
        host.healthTimer = undefined; host.state = "reconnecting"; updateHostWorkspaceStatuses(host); host.tunnel.kill();
      }
    }
  }, 3_000);
}

export async function getRemoteWorkspaceStatus(id: string): Promise<RemoteWorkspaceStatus> {
  const active = connections.get(id);
  if (active) {
    const host = hostConnections.get(active.alias);
    return host ? { ...active.status, localPort: host.localPort, connected: host.state === "connected", gatewayReady: host.state === "connected", connectionState: host.state, error: host.error } : { ...active.status };
  }
  const workspace = await findWorkspaceById(id);
  if (!workspace?.remote) throw new Error("Remote workspace not found.");
  return { ...workspace.remote, connected: false, gatewayReady: false, connectionState: "disconnected" };
}

export function getRemoteGatewayAccess(workspacePath?: string): { baseUrl: string; token: string; workspaceId: string } | null {
  if (!workspacePath) return null;
  for (const [workspaceId, connection] of connections) {
    const host = hostConnections.get(connection.alias);
    if (connection.status.canonicalPath === workspacePath && host?.state === "connected") {
      return { baseUrl: `http://127.0.0.1:${host.localPort}`, token: host.token, workspaceId };
    }
  }
  return null;
}

export function getRemoteWorkspaceRootForPath(path?: string): string | null {
  if (!path) return null;
  for (const connection of connections.values()) {
    if (path === connection.path || path.startsWith(`${connection.path}/`)) return connection.path;
  }
  return null;
}

async function remoteJson<T>(workspacePath: string, endpoint: string): Promise<T> {
  const access = getRemoteGatewayAccess(workspacePath);
  if (!access) throw new Error("Remote workspace is not connected.");
  return new RemoteGatewayClient(access.baseUrl, access.token, access.workspaceId).get<T>(endpoint);
}

async function remotePost<T>(workspacePath: string, endpoint: string, body: unknown): Promise<T> {
  const access = getRemoteGatewayAccess(workspacePath);
  if (!access) throw new Error("Remote workspace is not connected.");
  return new RemoteGatewayClient(access.baseUrl, access.token, access.workspaceId).post<T>(endpoint, body);
}

export async function listRemoteWorkspaceCheckpoints(workspacePath: string): Promise<WorkspaceCheckpoint[]> {
  return (await remoteJson<{ data: WorkspaceCheckpoint[] }>(workspacePath, "/checkpoints")).data;
}
export async function createRemoteWorkspaceCheckpoint(request: WorkspaceCheckpointCreateRequest): Promise<WorkspaceCheckpoint> {
  return remotePost(request.workspacePath, "/checkpoints", request);
}
export async function previewRemoteWorkspaceCheckpoint(request: WorkspaceCheckpointPreviewRequest): Promise<WorkspaceCheckpointPreviewResult> {
  return remotePost(request.workspacePath, "/checkpoints/preview", request);
}
export async function restoreRemoteWorkspaceCheckpoint(request: WorkspaceCheckpointRestoreRequest): Promise<WorkspaceCheckpointRestoreResult> {
  return remotePost(request.workspacePath, "/checkpoints/restore", request);
}
export async function acceptRemoteWorkspaceCheckpoint(request: WorkspaceCheckpointAcceptRequest): Promise<WorkspaceCheckpoint> {
  return remotePost(request.workspacePath, "/checkpoints/accept", request);
}

export async function executeRemoteWorkspaceMutation(action: "stage-file" | "revert-file" | "stage-hunk" | "revert-hunk", request: unknown): Promise<unknown> {
  const value = request as { workspacePath?: string; path?: string; expectedDiffHash?: string; patch?: string };
  if (!value.workspacePath || !value.path || !value.expectedDiffHash) throw new Error("Remote workspace mutation request is incomplete.");
  const access = getRemoteGatewayAccess(value.workspacePath);
  if (!access) throw new Error("Remote workspace is not connected.");
  const relative = value.path.startsWith(value.workspacePath) ? value.path.slice(value.workspacePath.length).replace(/^[/\\]+/, "") : value.path;
  const operation = action.startsWith("stage") ? "stage" : "revert";
  const endpoint = action.endsWith("hunk") ? `${operation}-hunk` : operation;
  const response = await fetch(`${access.baseUrl}/v1/workspaces/${encodeURIComponent(access.workspaceId)}/git/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-OpenDrSai-Gateway-Token": access.token },
    body: JSON.stringify({ path: relative, expected_diff_hash: value.expectedDiffHash, patch: value.patch }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Remote Git ${operation} failed (${response.status}).`);
  if (action.endsWith("hunk")) return { workspacePath: value.workspacePath, path: value.path, applied: true, message: "Remote Git hunk applied." };
  return action === "stage-file"
    ? { workspacePath: value.workspacePath, path: value.path, staged: true, message: "Remote file staged." }
    : { workspacePath: value.workspacePath, path: value.path, reverted: true, message: "Remote file reverted." };
}

export async function commitRemoteWorkspace(workspacePath: string, message: string, body?: string): Promise<void> {
  await remotePost(workspacePath, "/git/commit", { message, body });
}

export async function listRemoteWorkspaceFiles(request: WorkspaceFileTreeRequest): Promise<WorkspaceFileTreeResult> {
  ensureRemoteFileWatcher(request.workspacePath);
  const parameters = new URLSearchParams({ depth: String(Math.max(0, Math.min(5, request.maxDepth ?? 2))), max_entries: String(request.maxEntries ?? 500), offset: String(request.offset ?? 0) });
  if (request.query) parameters.set("query", request.query);
  const payload = await remoteJson<{ data: Array<Record<string, unknown>>; total?: number; truncated?: boolean; next_offset?: number | null }>(request.workspacePath, `/files?${parameters}`);
  let count = 0;
  const mapNode = (row: Record<string, unknown>): any => {
    count += 1;
    const directory = row.directory === true;
    const gitStatus = ["modified", "added", "deleted", "renamed", "untracked", "clean"].includes(String(row.git_status)) ? row.git_status as "modified" | "added" | "deleted" | "renamed" | "untracked" | "clean" : undefined;
    return { name: String(row.name || ""), path: `${request.workspacePath}/${String(row.path || "")}`, relativePath: String(row.path || ""), type: directory ? "directory" : "file", size: typeof row.size === "number" ? row.size : undefined, modifiedAt: typeof row.modified_at === "number" ? new Date(row.modified_at * 1000).toISOString() : undefined, gitStatus, children: Array.isArray(row.children) ? row.children.map((child) => mapNode(child as Record<string, unknown>)) : undefined };
  };
  const nodes = payload.data.map(mapNode);
  return { workspacePath: request.workspacePath, nodes, totalEntries: payload.total ?? count, truncated: payload.truncated === true, ...(typeof payload.next_offset === "number" ? { nextOffset: payload.next_offset } : {}) };
}

export async function getRemoteWorkspaceContextOverview(workspacePath: string): Promise<WorkspaceContextOverview> {
  return remoteJson(workspacePath, "/context");
}

export async function previewRemoteWorkspaceFile(request: WorkspaceFilePreviewRequest): Promise<WorkspaceFilePreview> {
  const relative = request.path.startsWith(request.workspacePath) ? request.path.slice(request.workspacePath.length).replace(/^[/\\]+/, "") : request.path;
  const payload = await remoteJson<{ path: string; content?: string; data_url?: string; mime?: string; modified_at?: number; truncated: boolean; size: number }>(request.workspacePath, `/file?path=${encodeURIComponent(relative)}&max_bytes=${request.maxBytes ?? 262144}`);
  const kind = payload.data_url ? (payload.mime?.startsWith("image/") ? "image" : "binary") : "text";
  return { workspacePath: request.workspacePath, path: request.path, relativePath: payload.path, name: payload.path.split("/").pop() || payload.path, kind, mime: payload.mime || "text/plain", size: payload.size, modifiedAt: new Date((payload.modified_at || 0) * 1000).toISOString(), truncated: payload.truncated, content: payload.content, dataUrl: payload.data_url, mode: request.mode || "auto" };
}

export async function getRemoteWorkspaceGitDiff(request: WorkspaceGitDiffRequest): Promise<WorkspaceGitDiffResult> {
  const relative = request.path?.startsWith(request.workspacePath) ? request.path.slice(request.workspacePath.length).replace(/^[/\\]+/, "") : request.path;
  const payload = await remoteJson<{ diff: string; staged: boolean }>(request.workspacePath, `/git/diff?staged=${request.staged === true}${relative ? `&path=${encodeURIComponent(relative)}` : ""}`);
  const diff = payload.diff.slice(0, request.maxChars ?? 200_000);
  return { workspacePath: request.workspacePath, path: request.path, diff, diffHash: createHash("sha256").update(payload.diff).digest("hex"), truncated: diff.length < payload.diff.length, staged: payload.staged };
}

export async function summarizeRemoteWorkspaceFolder(request: WorkspaceFolderSummaryRequest, workspacePath: string): Promise<WorkspaceFolderSummaryResult> {
  const relative = request.path.startsWith(workspacePath) ? request.path.slice(workspacePath.length).replace(/^[/\\]+/, "") || "." : request.path;
  return remoteJson(workspacePath, `/folder-summary?path=${encodeURIComponent(relative)}&max_entries=${request.maxEntries ?? 500}&max_sample_files=${request.maxSampleFiles ?? 20}&max_chars=${request.maxChars ?? 20000}`);
}

export async function getRemoteWorkspaceGitFileAtRef(request: WorkspaceGitFileAtRefRequest): Promise<WorkspaceGitFileAtRefResult> {
  const relative = request.path.startsWith(request.workspacePath) ? request.path.slice(request.workspacePath.length).replace(/^[/\\]+/, "") : request.path;
  return remoteJson(request.workspacePath, `/git/file-at-ref?ref=${encodeURIComponent(request.ref)}&path=${encodeURIComponent(relative)}&max_bytes=${request.maxBytes ?? 262144}`);
}

export async function listRemoteThreads(workspaceId: string): Promise<DesktopThread[]> {
  const connection = connections.get(workspaceId);
  const host = connection ? hostConnections.get(connection.alias) : undefined;
  if (!connection || !host || host.state !== "connected") throw new Error("Remote workspace is not connected.");
  const response = await fetch(`http://127.0.0.1:${host.localPort}/v1/threads?workspace_id=${encodeURIComponent(workspaceId)}&limit=100`, {
    headers: { "X-OpenDrSai-Gateway-Token": host.token },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Remote thread list failed (${response.status}).`);
  const payload = await response.json() as { data?: Array<Record<string, unknown>> };
  return (payload.data || []).flatMap((row) => {
    const id = typeof row.thread_id === "string" ? row.thread_id : typeof row.session_id === "string" ? row.session_id : "";
    if (!id) return [];
    remoteThreadWorkspaces.set(id, workspaceId);
    const updated = typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString();
    return [{ id, kind: "chat" as const, title: typeof row.name === "string" ? row.name : "Remote session", workspacePath: connection.status.canonicalPath, createdAt: updated, updatedAt: updated, status: "idle" as const, messageCount: typeof row.message_count === "number" ? row.message_count : 0 }];
  });
}

export async function getRemoteThreadSnapshot(threadId: string): Promise<DesktopThreadSnapshot | null> {
  const workspaceId = remoteThreadWorkspaces.get(threadId);
  const connection = workspaceId ? connections.get(workspaceId) : undefined;
  const host = connection ? hostConnections.get(connection.alias) : undefined;
  if (!host || host.state !== "connected") return null;
  const response = await fetch(`http://127.0.0.1:${host.localPort}/v1/threads/${encodeURIComponent(threadId)}`, { headers: { "X-OpenDrSai-Gateway-Token": host.token }, signal: AbortSignal.timeout(5000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Remote thread snapshot failed (${response.status}).`);
  const payload = await response.json() as { name?: string; messages?: Array<{ role?: string; content?: string; type?: string }> };
  const now = Date.now();
  const messages = (payload.messages || []).map((message, index) => {
    const role: "user" | "assistant" | "system" = message.role === "assistant" || message.role === "system" ? message.role : "user";
    return { id: `${threadId}-${index}`, role, content: String(message.content || ""), startedAt: now, lastEventAt: now };
  });
  return { threadId, title: payload.name || "Remote session", messages, updatedAt: now, messageCount: messages.length };
}

export async function searchRemoteThreadMessages(request: DesktopThreadContentSearchRequest): Promise<DesktopThreadContentSearchResult[] | null> {
  const ids = (request.threadIds || []).filter((id) => remoteThreadWorkspaces.has(id));
  if (ids.length === 0) return null;
  const query = request.query.toLocaleLowerCase(); const results: DesktopThreadContentSearchResult[] = [];
  for (const threadId of ids) {
    const snapshot = await getRemoteThreadSnapshot(threadId);
    const message = [...(snapshot?.messages || [])].reverse().find((item) => item.content.toLocaleLowerCase().includes(query));
    if (message) results.push({ threadId, messageId: message.id, role: message.role, snippet: message.content.slice(0, 180), updatedAt: snapshot!.updatedAt });
    if (results.length >= (request.limit || 24)) break;
  }
  return results;
}

export async function listRemoteHepaiWorkers(workspaceId: string): Promise<RemoteHepaiWorker[]> {
  const connection = connections.get(workspaceId);
  const host = connection ? hostConnections.get(connection.alias) : undefined;
  if (!connection || !host || host.state !== "connected") throw new Error("Remote workspace is not connected.");
  const response = await fetch(`http://127.0.0.1:${host.localPort}/v1/hepai/workers`, { headers: { "X-OpenDrSai-Gateway-Token": host.token }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HepAI worker discovery failed (${response.status}).`);
  const payload = await response.json() as { data?: Array<Record<string, unknown>> };
  return (payload.data || []).map((row, index) => ({ id: String(row.id || row.model || `worker-${index}`), name: String(row.name || row.id || row.model || `Worker ${index + 1}`), description: typeof row.description === "string" ? row.description : undefined, enabled: row.enabled !== false, callables: Array.isArray(row.callables) ? row.callables.map(String) : [], status: row.status === "available" || row.status === "disabled" ? row.status : "unavailable" }));
}

export async function setRemoteHepaiWorkerEnabled(workspaceId: string, workerId: string, enabled: boolean): Promise<boolean> {
  const connection = connections.get(workspaceId); const host = connection ? hostConnections.get(connection.alias) : undefined;
  if (!host || host.state !== "connected" || !/^[A-Za-z0-9_.:/-]{1,200}$/.test(workerId)) throw new Error("Remote Worker request is invalid.");
  const response = await fetch(`http://127.0.0.1:${host.localPort}/v1/hepai/workers/${encodeURIComponent(workerId)}/state`, { method: "PUT", headers: { "Content-Type": "application/json", "X-OpenDrSai-Gateway-Token": host.token }, body: JSON.stringify({ enabled }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Remote Worker update failed (${response.status}).`);
  return true;
}

export function stopAllRemoteWorkspaces(): void {
  for (const host of hostConnections.values()) closeHostConnection(host);
  hostConnections.clear();
  connections.clear();
}
