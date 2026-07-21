import { createHash, randomBytes } from "crypto";
import { spawn, execFile, type ChildProcess } from "child_process";
import { readFile, readdir, stat } from "fs/promises";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, resolve } from "path";
import type { ConnectRemoteWorkspaceRequest, DesktopForkWorktreeResult, DesktopThread, DesktopThreadContentSearchRequest, DesktopThreadContentSearchResult, DesktopThreadSnapshot, RemoteDirectoryEntry, RemoteGatewayInstallRequest, RemoteGatewayInstallResult, RemoteGatewayOperationEvent, RemoteGatewayPreflight, RemoteHepaiWorker, RemoteSshConnectivityResult, RemoteSshDiagnosticReport, RemoteSshHost, RemoteSshHostKey, RemoteWorkspaceStatus, WorkspaceCheckpoint, WorkspaceCheckpointAcceptRequest, WorkspaceCheckpointCreateRequest, WorkspaceCheckpointPreviewRequest, WorkspaceCheckpointPreviewResult, WorkspaceCheckpointRestoreRequest, WorkspaceCheckpointRestoreResult, WorkspaceContextOverview, WorkspaceFileChangeEvent, WorkspaceFilePreview, WorkspaceFilePreviewRequest, WorkspaceFileTreeRequest, WorkspaceFileTreeResult, WorkspaceFileWriteRequest, WorkspaceFileWriteResult, WorkspaceFolderSummaryRequest, WorkspaceFolderSummaryResult, WorkspaceGitDiffRequest, WorkspaceGitDiffResult, WorkspaceGitFileAtRefRequest, WorkspaceGitFileAtRefResult, WorkspaceProject } from "../shared/desktopApi";
import { createRemoteWorkspace, findWorkspaceById, listWorkspaces, setRemoteWorkspaceAutoReconnect } from "./workspaces";
import { RemoteGatewayClient } from "./remoteGatewayClient.generated";
import { RemoteRuntimeClient } from "./runtimeClient";
import { REMOTE_CAPABILITY_VERSIONS, REMOTE_SSH_PROTOCOL_VERSION } from "../shared/remoteSshProtocol";
import { resolveScpExecutable, resolveSshExecutable, resolveSshKeyscanExecutable } from "./sshExecutable";
import { ReconnectBackoff, RuntimeInstanceTracker, classifyRemoteFailure, type RemoteFailureKind } from "./runtimeReliability";
import { loadRuntimeArtifactTrustStore, verifyRuntimeArtifactTrust } from "./runtimeArtifactTrust";
import { HostProfileStore, assertHostCanBeRemoved, makeHostProfile, redactSshDiagnostic } from "./hostConnectionManager";
import { PortForwardRegistry, type CreatePortForwardRequest, type PortForwardResource } from "./portForwardRegistry";
import { shouldRestorePersistedRemoteWorkspace } from "./remoteWorkspaceRestorePolicy";

const SSH_TIMEOUT_MS = 12_000;
const REMOTE_PORT = 18642;
const HOST_IDLE_TIMEOUT_MS = Math.max(100, Number(process.env.OPENDRSAI_REMOTE_HOST_IDLE_MS || "30000") || 30_000);
const hostProfileStore = new HostProfileStore();
const portForwardRegistry = new PortForwardRegistry();
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
  idleTimer?: NodeJS.Timeout;
  createdAt: number;
  lastConnectedAt?: number;
  reconnectCount: number;
  events: Array<{ at: string; phase: string; elapsedMs?: number; message?: string }>;
  healthTimer?: NodeJS.Timeout;
  healthFailures: number;
  failureKind?: RemoteFailureKind;
  nextRetryAt?: number;
  backoff: ReconnectBackoff;
  instanceTracker: RuntimeInstanceTracker;
};
type RemoteConnection = { status: RemoteWorkspaceStatus; alias: string; path: string };
const connections = new Map<string, RemoteConnection>();
const hostConnections = new Map<string, HostConnection>();
const hostConnectionFlights = new Map<string, Promise<HostConnection>>();
const workspaceConnectionFlights = new Map<string, Promise<WorkspaceProject>>();
const remoteThreadWorkspaces = new Map<string, string>();

function recordHostEvent(host: HostConnection, phase: string, startedAt?: number, message?: string): void {
  host.events.push({ at: new Date().toISOString(), phase, ...(startedAt ? { elapsedMs: Date.now() - startedAt } : {}), ...(message ? { message: message.replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]") } : {}) });
  if (host.events.length > 100) host.events.splice(0, host.events.length - 100);
}

export function getRemoteSshDiagnosticReport(): RemoteSshDiagnosticReport {
  const now = Date.now();
  return { generatedAt: new Date(now).toISOString(), hosts: [...hostConnections.values()].map((host) => ({ hostAlias: host.alias, state: host.state, phase: host.events.at(-1)?.phase || host.state, failureKind: host.failureKind, failureCategory: classifyDiagnosticCategory(host.error, host.failureKind), workspaceCount: host.workspaceIds.size, gatewayVersion: host.gatewayVersion, protocolVersion: host.protocolVersion, reconnectAttempts: host.retries, reconnectCount: host.reconnectCount, ageMs: now - host.createdAt, ...(host.lastConnectedAt ? { lastConnectedAt: new Date(host.lastConnectedAt).toISOString() } : {}), ...(host.nextRetryAt ? { retryAt: new Date(host.nextRetryAt).toISOString() } : {}), ...(host.error ? { error: redactSshDiagnostic(host.error) } : {}), events: host.events.map((event) => ({ ...event, ...(event.message ? { message: redactSshDiagnostic(event.message) } : {}) })) })) };
}

function classifyDiagnosticCategory(error: string | undefined, kind: RemoteFailureKind | undefined): "dns" | "host_key" | "authentication" | "transport" | "runtime" | undefined {
  if (!error) return undefined;
  if (/resolve hostname|name resolution|dns/i.test(error)) return "dns";
  if (/host key|identification has changed/i.test(error)) return "host_key";
  if (/permission denied|authentication/i.test(error)) return "authentication";
  return kind === "runtime" ? "runtime" : "transport";
}

export function bindRemoteThread(threadId: string, workspaceId: string): void {
  if (threadId && connections.has(workspaceId)) remoteThreadWorkspaces.set(threadId, workspaceId);
}
let publishStatus: ((status: RemoteWorkspaceStatus) => void) | undefined;
let publishGatewayOperation: ((event: RemoteGatewayOperationEvent) => void) | undefined;
const activeGatewayOperations = new Map<string, { operationId: string; controller: AbortController }>();
const remoteFileWatchers = new Map<string, WebSocket>();
const remoteFileWatchCursors = new Map<string, number>();
const remoteReadCache = new Map<string, unknown>();
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

function ensureRemoteFileWatcher(workspacePath: string, workspaceId?: string): void {
  const watcherKey = workspaceId || workspacePath;
  if (remoteFileWatchers.has(watcherKey)) return;
  const access = getRemoteGatewayAccess(workspacePath, workspaceId); if (!access) return;
  const socket = new WebSocket(`${access.baseUrl.replace(/^http/, "ws")}/v1/workspaces/${encodeURIComponent(access.workspaceId)}/watch`);
  remoteFileWatchers.set(watcherKey, socket);
  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "auth", token: access.token, after_sequence: remoteFileWatchCursors.get(watcherKey) ?? 0 })));
  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(String(event.data)) as { type?: string; sequence?: number; changes?: Array<WorkspaceFileChangeEvent["changes"][number] & { sequence?: number }> };
      if (message.type === "changes" && Array.isArray(message.changes)) {
        const cursor = remoteFileWatchCursors.get(watcherKey) ?? 0;
        const fresh = message.changes.filter((change) => typeof change.sequence !== "number" || change.sequence > cursor);
        const next = Math.max(cursor, typeof message.sequence === "number" ? message.sequence : cursor, ...fresh.map((change) => typeof change.sequence === "number" ? change.sequence : cursor));
        remoteFileWatchCursors.set(watcherKey, next);
        if (fresh.length) publishFileChanges?.({ workspacePath, changes: fresh });
      }
    } catch { /* ignore malformed remote events */ }
  });
  socket.addEventListener("close", () => {
    if (remoteFileWatchers.get(watcherKey) === socket) remoteFileWatchers.delete(watcherKey);
    if (getRemoteGatewayAccess(workspacePath, workspaceId)) setTimeout(() => ensureRemoteFileWatcher(workspacePath, workspaceId), 1_000);
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
  return [...sshConfigArgs(), "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10", assertAlias(alias)];
}

function sshConfigArgs(): string[] {
  const configured = process.env.OPENDRSAI_SSH_CONFIG?.trim();
  if (!configured) return [];
  if (configured.length > 4096 || /[\r\n\0]/.test(configured)) throw new Error("SSH config path is invalid.");
  return ["-F", configured];
}

function remotePythonCommand(): string {
  const configured = process.env.OPENDRSAI_REMOTE_PYTHON?.trim();
  if (!configured) return "python3";
  if (
    configured.length > 4096 ||
    !configured.startsWith("/") ||
    !/^\/[A-Za-z0-9._/+~-]+$/.test(configured) ||
    configured.split("/").includes("..")
  ) {
    throw new Error("Remote Python path must be an absolute POSIX path without shell metacharacters.");
  }
  return configured;
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
      const resolved = await exec(resolveSshExecutable(), [...sshConfigArgs(), "-G", alias], 5000);
      const resolvedLines = resolved.split(/\r?\n/);
      const values = new Map(resolvedLines.map((line) => {
        const index = line.indexOf(" ");
        return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : ["", ""];
      }));
      const identityFiles = resolvedLines.filter((line) => line.startsWith("identityfile ")).map((line) => line.slice("identityfile ".length));
      const discovered = { alias, hostname: values.get("hostname") || alias, user: values.get("user") || undefined, port: Number(values.get("port") || 22), identityFiles, proxyJump: values.get("proxyjump") !== "none" ? values.get("proxyjump") : undefined };
      hosts.push(discovered);
      await hostProfileStore.upsert(makeHostProfile({ ...discovered, configSource: rootConfig, authPreference: identityFiles.length ? "identity_file" : "system_config" }));
    } catch { hosts.push({ alias, hostname: alias, port: 22, identityFiles: [] }); }
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
  return (await diagnoseSshHost(hostAlias)).state === "reachable";
}

export async function connectSshHost(hostAlias: string, bootstrapPath = "~"): Promise<boolean> {
  await getOrCreateHostConnection(assertAlias(hostAlias), bootstrapPath);
  return true;
}

export function disconnectSshHost(hostAlias: string): boolean {
  const alias = assertAlias(hostAlias);
  const host = hostConnections.get(alias);
  if (!host) return false;
  hostConnections.delete(alias);
  closeHostConnection(host);
  void portForwardRegistry.suspendHost(alias);
  host.state = "disconnected";
  updateHostWorkspaceStatuses(host);
  return true;
}

export async function reconnectSshHost(hostAlias: string): Promise<boolean> {
  const alias = assertAlias(hostAlias);
  const previous = hostConnections.get(alias);
  if (!previous) return false;
  const bootstrapPath = previous.bootstrapPath;
  const workspaceIds = [...previous.workspaceIds];
  disconnectSshHost(alias);
  const host = await getOrCreateHostConnection(alias, bootstrapPath);
  for (const workspaceId of workspaceIds) {
    const workspace = connections.get(workspaceId);
    if (!workspace) continue;
    await registerWorkspace(host, workspace.path, workspaceId);
    host.workspaceIds.add(workspaceId);
  }
  updateHostWorkspaceStatuses(host);
  return true;
}

export async function removeSshHostProfile(hostAlias: string): Promise<boolean> {
  const alias = assertAlias(hostAlias);
  const host = hostConnections.get(alias);
  const workspaceCount = host?.workspaceIds.size ?? [...connections.values()].filter((item) => item.alias === alias).length;
  const forwardCount = (await portForwardRegistry.list({ hostAlias: alias })).length;
  assertHostCanBeRemoved({ workspaces: workspaceCount, ptys: 0, portForwards: forwardCount || (host ? 1 : 0) });
  const profile = (await hostProfileStore.list()).find((item) => item.alias === alias);
  return profile ? hostProfileStore.remove(profile.profileId, { workspaces: 0, ptys: 0, portForwards: 0 }) : false;
}

export async function listPortForwards(filter: { hostAlias?: string; workspaceId?: string } = {}): Promise<PortForwardResource[]> {
  return portForwardRegistry.list(filter);
}

export async function createPortForward(request: CreatePortForwardRequest): Promise<PortForwardResource> {
  const connection = connections.get(request.workspaceId);
  const host = connection ? hostConnections.get(connection.alias) : undefined;
  if (!connection || connection.alias !== request.hostAlias || host?.state !== "ready") {
    throw new Error("Port Forward owner Workspace must be connected to the requested Host.");
  }
  return portForwardRegistry.create(request);
}

export async function pausePortForward(id: string): Promise<PortForwardResource> { return portForwardRegistry.pause(id); }
export async function resumePortForward(id: string): Promise<PortForwardResource> { return portForwardRegistry.resume(id); }
export async function removePortForward(id: string): Promise<boolean> { return portForwardRegistry.remove(id); }

export async function diagnoseSshHost(hostAlias: string, timeoutMs = SSH_TIMEOUT_MS): Promise<RemoteSshConnectivityResult> {
  const alias = assertAlias(hostAlias);
  const startedAt = Date.now();
  try {
    await exec(resolveSshExecutable(), [...sshArgs(alias), "printf", "opendrsai-ok"], timeoutMs);
    return { hostAlias: alias, state: "reachable", elapsedMs: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    const elapsedMs = Date.now() - startedAt;
    const state: RemoteSshConnectivityResult["state"] =
      /host key verification failed|remote host identification has changed|no .* host key is known/.test(normalized) ? "host_key_failed" :
      /permission denied|authentication failed|no supported authentication/.test(normalized) ? "authentication_failed" :
      /could not resolve hostname|name or service not known|temporary failure in name resolution/.test(normalized) ? "dns_failed" :
      /timed out|etimeout|connection timeout|operation timed out/.test(normalized) ? "timeout" :
      /connection refused|no route to host|network is unreachable/.test(normalized) ? "unreachable" :
      elapsedMs >= Math.max(100, timeoutMs - 100) ? "timeout" : "failed";
    const remediation = state === "authentication_failed"
      ? "Load an SSH key into the Windows system ssh-agent, attach your hardware security key, or run ssh interactively to complete authentication, then retry."
      : undefined;
    return { hostAlias: alias, state, elapsedMs, message, remediation };
  }
}

export async function approveSshHostKey(hostAlias: string): Promise<boolean> {
  try {
    const keys = await inspectSshHostKeys(hostAlias);
    await exec(resolveSshExecutable(), [...sshConfigArgs(), "-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", assertAlias(hostAlias), "printf", "opendrsai-ok"]);
    const discovered = (await listSshHosts()).find((host) => host.alias === hostAlias);
    if (discovered && keys[0]) await hostProfileStore.upsert(makeHostProfile({ ...discovered, configSource: process.env.OPENDRSAI_SSH_CONFIG?.trim() || join(homedir(), ".ssh", "config"), authPreference: discovered.identityFiles.length ? "identity_file" : "system_config", knownHostFingerprint: keys[0].fingerprint }));
    return true;
  } catch { return false; }
}

export async function inspectSshHostKeys(hostAlias: string): Promise<RemoteSshHostKey[]> {
  const alias = assertAlias(hostAlias);
  const resolved = await exec(resolveSshExecutable(), [...sshConfigArgs(), "-G", alias], 5_000);
  const values = new Map(resolved.split(/\r?\n/).map((line) => {
    const index = line.indexOf(" ");
    return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : ["", ""];
  }));
  const hostname = values.get("hostname") || alias;
  const port = Number(values.get("port") || 22);
  let output = "";
  try {
    output = await exec(resolveSshKeyscanExecutable(), ["-T", "5", "-p", String(port), hostname], 8_000);
  } catch {
    // Some older Windows ssh-keyscan builds cannot negotiate with newer
    // OpenSSH servers. The signed ssh client still reports the offered key's
    // SHA-256 fingerprint before refusing an untrusted first connection.
  }
  const keys: RemoteSshHostKey[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [, algorithm, encoded] = line.trim().split(/\s+/);
    if (!algorithm || !encoded) continue;
    const fingerprint = `SHA256:${createHash("sha256").update(Buffer.from(encoded, "base64")).digest("base64").replace(/=+$/, "")}`;
    keys.push({ hostAlias: alias, hostname, port, algorithm, fingerprint });
  }
  if (keys.length === 0) {
    try {
      await exec(resolveSshExecutable(), [...sshConfigArgs(), "-vv", "-o", "StrictHostKeyChecking=ask", "-o", "UserKnownHostsFile=NUL", "-o", "BatchMode=yes", alias, "true"], 8_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const debugMatch = message.match(/Server host key:\s+(\S+)\s+(SHA256:[A-Za-z0-9+/]+)/i);
      const promptMatch = message.match(/([A-Z0-9-]+) key fingerprint is (SHA256:[A-Za-z0-9+/]+)/i);
      if (debugMatch) keys.push({ hostAlias: alias, hostname, port, algorithm: debugMatch[1], fingerprint: debugMatch[2] });
      else if (promptMatch) keys.push({ hostAlias: alias, hostname, port, algorithm: `ssh-${promptMatch[1].toLowerCase()}`, fingerprint: promptMatch[2] });
    }
  }
  if (keys.length === 0) throw new Error("Remote computer did not provide a host key.");
  return keys;
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
  const output = await execWithInput(resolveSshExecutable(), [...sshArgs(alias), remotePythonCommand(), "-"], script);
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
  return execWithInput(resolveSshExecutable(), [...sshArgs(alias), remotePythonCommand(), "-"], script);
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
py=tuple(int(part) for part in platform.python_version_tuple()[:2]); os_name=platform.system(); arch=platform.machine(); issues=[]
if os_name!="Linux": issues.append("Remote Runtime V1 requires Linux")
if py<(3,11): issues.append("Python 3.11 or newer is required")
print(json.dumps({"operatingSystem":os_name,"architecture":arch,"pythonVersion":platform.python_version(),"compatible":not issues,"issues":issues,"installationHint":"Install python3, python3-venv, git and OpenSSH server." if issues else None,"gatewayInstalled":version is not None,"gatewayVersion":version,"currentRelease":link("current"),"previousRelease":link("previous")}))`;
  let output: string;
  try {
    output = await execWithInput(resolveSshExecutable(), [...sshArgs(alias), remotePythonCommand(), "-"], script);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/python.*(not found|not recognized)|command not found/i.test(message)) throw new Error("Remote computer requires Python 3.11 or newer. Install python3 and python3-venv before retrying.");
    throw error;
  }
  const result = JSON.parse(output) as Omit<RemoteGatewayPreflight, "hostAlias">;
  return { hostAlias: alias, ...result };
}

export async function installRemoteGateway(request: RemoteGatewayInstallRequest): Promise<RemoteGatewayInstallResult> {
  const alias = assertAlias(request.hostAlias);
  const host = hostConnections.get(alias);
  const previousState = host?.state;
  if (activeGatewayOperations.has(alias)) throw new Error("A Remote Gateway operation is already running for this host.");
  const operationId = `${Date.now()}-${randomBytes(8).toString("hex")}`;
  const controller = new AbortController();
  activeGatewayOperations.set(alias, { operationId, controller });
  const emit = (phase: RemoteGatewayOperationEvent["phase"], progress: number, message: string, state: RemoteGatewayOperationEvent["state"] = "running"): void => publishGatewayOperation?.({ operationId, hostAlias: alias, action: request.action, state, phase, progress, message });
  emit("validating", 2, "Validating the requested operation and local artifact.");
  if (host) {
    host.state = "runtime_check";
    recordHostEvent(host, `runtime.${request.action}.validating`);
    updateHostWorkspaceStatuses(host);
  }
  try {
    const result = await performRemoteGatewayInstall(request, controller.signal, emit);
    if (host && hostConnections.get(alias) === host) {
      host.state = "ready";
      host.error = undefined;
      recordHostEvent(host, `runtime.${request.action}.completed`);
      updateHostWorkspaceStatuses(host);
    }
    emit("completed", 100, "Remote Gateway operation completed.", "completed");
    return result;
  } catch (error) {
    const cancelled = controller.signal.aborted;
    if (host && hostConnections.get(alias) === host) {
      host.state = cancelled ? (previousState || "ready") : "degraded";
      host.error = cancelled ? undefined : `Remote Runtime ${request.action} failed: ${error instanceof Error ? error.message : String(error)}`;
      recordHostEvent(host, `runtime.${request.action}.${cancelled ? "cancelled" : "failed"}`, undefined, host.error);
      updateHostWorkspaceStatuses(host);
    }
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
    const artifact = await readFile(artifactPath);
    const trustedPublishers = await loadRuntimeArtifactTrustStore();
    const verified = verifyRuntimeArtifactTrust(artifact, {
      version: version!,
      expectedSha256: request.artifactSha256,
      publisher: request.artifactPublisher || "",
      signature: request.artifactSignature || "",
    }, trustedPublishers);
    artifactSha256 = verified.sha256;
    artifactName = basename(artifactPath);
    if (!/^[A-Za-z0-9_.+-]{1,200}$/.test(artifactName)) throw new Error("Gateway artifact filename is invalid.");
    await execWithInput(resolveSshExecutable(), [...sshArgs(alias), remotePythonCommand(), "-"], `import pathlib\np=pathlib.Path.home()/".local"/"share"/"opendrsai"/"remote"/"incoming"\np.mkdir(parents=True,exist_ok=True)\n`, SSH_TIMEOUT_MS, signal);
    emit("uploading", 20, "Uploading the verified artifact through SCP.");
    await exec(resolveScpExecutable(), [...sshConfigArgs(), "-q", artifactPath, `${alias}:.local/share/opendrsai/remote/incoming/${artifactName}`], 180_000, signal);
  }
  emit(request.action === "rollback" ? "switching" : "installing", request.action === "rollback" ? 60 : 40, request.action === "rollback" ? "Preparing an atomic release rollback." : "Creating an isolated candidate release.");
  const data = Buffer.from(JSON.stringify({ action: request.action, version, artifactName, artifactSha256, protocolVersion: REMOTE_SSH_PROTOCOL_VERSION }), "utf8").toString("base64");
  const script = `import base64,fcntl,json,os,pathlib,subprocess,sys,shutil,socket,time,uuid
cfg=json.loads(base64.b64decode("${data}")); home=pathlib.Path.home()/".local"/"share"/"opendrsai"/"remote"; releases=home/"releases"
releases.mkdir(parents=True,exist_ok=True); current=home/"current"; previous=home/"previous"
lock=(home/"install.lock").open("a+")
try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError: raise SystemExit("Another Remote Runtime installation transaction is active.")
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
   subprocess.run([sys.executable,"-m","venv",str(staging)],check=True)
   py=staging/("Scripts/python.exe" if os.name=="nt" else "bin/python")
   subprocess.run([str(py),"-m","pip","install","--disable-pip-version-check",str(artifact)],check=True)
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
  await execWithInput(resolveSshExecutable(), [...sshArgs(alias), remotePythonCommand(), "-"], script, 180_000, signal);
  emit("switching", 92, "Candidate is healthy; reading the atomically switched release state.");
  return { ...(await preflightRemoteGateway(alias)), changed: true, action: request.action };
}

function makeWorkspaceId(alias: string, path: string): string {
  return `ssh-${createHash("sha256").update(`${alias}\\0${path}`).digest("hex").slice(0, 24)}`;
}

async function startRemoteGateway(alias: string, path: string, token: string, generation: number): Promise<void> {
  const data = Buffer.from(JSON.stringify({ path, token, port: REMOTE_PORT, generation }), "utf8").toString("base64");
  const script = `import base64,fcntl,json,os,pathlib,subprocess,sys
cfg=json.loads(base64.b64decode("${data}"))
home=pathlib.Path.home()/".local"/"share"/"opendrsai"/"remote"
home.mkdir(parents=True,exist_ok=True)
startlock=open(home/"gateway.start.lock","a+")
fcntl.flock(startlock,fcntl.LOCK_EX)
generationfile=home/"gateway.generation"
try: latest=int(generationfile.read_text().strip())
except (ValueError,FileNotFoundError): latest=0
if int(cfg["generation"])<latest:
 print("superseded"); sys.exit(0)
generationfile.write_text(str(int(cfg["generation"])))
pidfile=home/"gateway.pid"
if pidfile.exists():
 try:
  old=int(pidfile.read_text().strip())
  os.kill(old,15)
  import time
  for _ in range(50):
   try: os.kill(old,0)
   except ProcessLookupError: break
   time.sleep(.1)
  else:
   os.kill(old,9); time.sleep(.2)
 except (ValueError,ProcessLookupError,PermissionError): pass
log=open(home/"gateway.log","ab",buffering=0)
env=os.environ.copy()
env.update({"DRSAI_API_HOST":"127.0.0.1","DRSAI_API_PORT":str(cfg["port"]),"OPENDRSAI_GATEWAY_INSTANCE_TOKEN":cfg["token"]})
managed=home/"current"/"bin"/"python"
python=str(managed) if managed.exists() else sys.executable
p=subprocess.Popen([python,"-m","drsai.backend.gateway"],cwd=cfg["path"],env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
pidfile.write_text(str(p.pid))
print("started")`;
  await execWithInput(resolveSshExecutable(), [...sshArgs(alias), remotePythonCommand(), "-"], script, 20_000);
}

function openTunnel(alias: string, localPort: number): ChildProcess {
  return spawn(resolveSshExecutable(), [...sshConfigArgs(),"-o","BatchMode=yes","-o","StrictHostKeyChecking=yes","-o","ExitOnForwardFailure=yes","-o","ServerAliveInterval=5","-o","ServerAliveCountMax=2","-N","-L",`127.0.0.1:${localPort}:127.0.0.1:${REMOTE_PORT}`,assertAlias(alias)], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
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
  const flightKey = `${alias}\0${path}`;
  const inFlight = workspaceConnectionFlights.get(flightKey);
  if (inFlight) return inFlight;
  const flight = (async (): Promise<WorkspaceProject> => {
    const previous = [...connections.entries()].find(([, item]) => item.alias === alias && item.path === path);
    if (previous) await disconnectRemoteWorkspace(previous[0]);
    try {
      const host = await getOrCreateHostConnection(alias, path);
      const registration = await registerWorkspace(host, path);
      const id = registration.workspaceId;
      const canonicalPath = registration.path;
      const status: RemoteWorkspaceStatus = { hostAlias: alias, canonicalPath, workspaceId: id, runtimeId: host.instanceTracker.runtimeId, instanceId: host.instanceTracker.instanceId, connectionState: "connecting", connected: false, gatewayReady: false };
      connections.set(id, { status, alias, path: canonicalPath });
      host.workspaceIds.add(id);
      status.localPort = host.localPort;
      status.gatewayVersion = host.gatewayVersion;
      status.protocolVersion = host.protocolVersion;
      status.capabilities = host.capabilities;
      status.connected = true; status.gatewayReady = true; status.connectionState = "ready";
      emitWorkspaceStatus(status);
    } catch (error) {
      const failed = [...connections.entries()].find(([, item]) => item.alias === alias && item.path === path);
      if (failed) connections.delete(failed[0]);
      throw error;
    }
    const connected = [...connections.entries()].find(([, item]) => item.alias === alias && item.path === path);
    if (!connected) throw new Error("Remote workspace registration did not produce a connection.");
    return createRemoteWorkspace({ id: connected[0], name: request.name, path: connected[1].path, trusted: request.trusted, remote: connected[1].status });
  })();
  workspaceConnectionFlights.set(flightKey, flight);
  try {
    return await flight;
  } finally {
    if (workspaceConnectionFlights.get(flightKey) === flight) workspaceConnectionFlights.delete(flightKey);
  }
}

async function getOrCreateHostConnection(alias: string, bootstrapPath: string): Promise<HostConnection> {
  const active = hostConnections.get(alias);
  if (active && active.state === "ready" && active.tunnel.exitCode === null) {
    if (active.idleTimer) clearTimeout(active.idleTimer);
    active.idleTimer = undefined;
    return active;
  }
  const inFlight = hostConnectionFlights.get(alias);
  if (inFlight) return inFlight;
  const flight = (async (): Promise<HostConnection> => {
    const stale = hostConnections.get(alias);
    if (stale && stale.state === "ready" && stale.tunnel.exitCode === null) return stale;
    if (stale) closeHostConnection(stale);
    const localPort = await availablePort();
    const host: HostConnection = { tunnel: openTunnel(alias, localPort), token: randomBytes(32).toString("base64url"), alias, bootstrapPath, localPort, retries: 0, intentionalClose: false, state: "connecting", workspaceIds: new Set(), createdAt: Date.now(), reconnectCount: 0, events: [], healthFailures: 0, backoff: new ReconnectBackoff(), instanceTracker: new RuntimeInstanceTracker() };
    recordHostEvent(host, "host.resolving");
    recordHostEvent(host, "ssh.authenticating");
    recordHostEvent(host, "tunnel.connecting");
    hostConnections.set(alias, host);
    attachTunnelLifecycle(host);
    try {
      await startRemoteGateway(alias, bootstrapPath, host.token, host.createdAt);
      host.state = "runtime_check";
      recordHostEvent(host, "runtime.check");
      await waitForGateway(host);
      host.state = "ready"; host.lastConnectedAt = Date.now();
      await portForwardRegistry.resumeHost(alias);
      recordHostEvent(host, "gateway.connected", host.createdAt);
      startHostHealthMonitor(host);
      return host;
    } catch (error) {
      if (hostConnections.get(alias) === host) hostConnections.delete(alias);
      closeHostConnection(host);
      throw error;
    }
  })();
  hostConnectionFlights.set(alias, flight);
  try {
    return await flight;
  } finally {
    if (hostConnectionFlights.get(alias) === flight) hostConnectionFlights.delete(alias);
  }
}

async function waitForGateway(host: HostConnection): Promise<void> {
  let ready = false;
  recordHostEvent(host, "recovery.handshake");
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (host.tunnel.exitCode !== null) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    try {
      const baseUrl = `http://127.0.0.1:${host.localPort}`;
      const handshake = await fetch(`${baseUrl}/v1/remote/handshake`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-OpenDrSai-Gateway-Token": host.token },
        body: JSON.stringify({ protocol_version: REMOTE_SSH_PROTOCOL_VERSION, client_version: "1.4.4", workspace_path: host.bootstrapPath }),
        signal: AbortSignal.timeout(1200),
      });
      if (handshake.ok) {
        const payload = await handshake.json() as { runtime_id?: string; instance_id?: string; protocol_version?: number; gateway_version?: string; capabilities?: string[]; capability_versions?: Record<string, number> };
        if (payload.protocol_version !== 1) throw new Error("Remote Gateway protocol is incompatible.");
        const instanceState = host.instanceTracker.observe(payload.runtime_id, payload.instance_id);
        recordHostEvent(host, "recovery.instance-check", undefined, `state=${instanceState}`);
        if (instanceState === "restarted") {
          host.protocolVersion = undefined; host.gatewayVersion = undefined; host.capabilities = undefined;
          recordHostEvent(host, "runtime.instance-changed", undefined, `generation=${host.instanceTracker.generation}`);
        }
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

async function registerWorkspace(host: HostConnection, path: string, expectedWorkspaceId?: string): Promise<{ workspaceId: string; path: string }> {
  let response = await fetch(`http://127.0.0.1:${host.localPort}/v1/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-OpenDrSai-Gateway-Token": host.token },
    body: JSON.stringify({ path }),
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) {
    const legacyWorkspaceId = expectedWorkspaceId || makeWorkspaceId(host.alias, path);
    response = await fetch(`http://127.0.0.1:${host.localPort}/v1/workspaces/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-OpenDrSai-Gateway-Token": host.token },
      body: JSON.stringify({ workspace_id: legacyWorkspaceId, path }),
      signal: AbortSignal.timeout(5000),
    });
  }
  if (!response.ok) throw new Error(`Remote workspace registration failed (${response.status}).`);
  const payload = await response.json() as { workspace_id?: string; path?: string };
  if (!payload.workspace_id || !payload.path) throw new Error("Remote workspace registration response is invalid.");
  if (expectedWorkspaceId && payload.workspace_id !== expectedWorkspaceId) throw new Error("Runtime workspace identity changed unexpectedly.");
  return { workspaceId: payload.workspace_id, path: payload.path };
}

async function recoverHostRuntimeResources(host: HostConnection): Promise<void> {
  recordHostEvent(host, "recovery.workspace-reopen");
  for (const workspaceId of host.workspaceIds) {
    const workspace = connections.get(workspaceId);
    if (workspace) await registerWorkspace(host, workspace.path, workspaceId);
  }
  const client = new RemoteRuntimeClient(`http://127.0.0.1:${host.localPort}`, host.token);
  recordHostEvent(host, "recovery.worktree-reconcile");
  if ((host.capabilities?.worktree || 0) >= 1) {
    for (const workspaceId of host.workspaceIds) await client.listWorktrees(workspaceId, true);
  }
  recordHostEvent(host, "recovery.pty-discover");
  if ((host.capabilities?.owop || 0) >= 1) {
    for (const workspaceId of host.workspaceIds) await client.executeOWOP(workspaceId, "pty.list", {});
  }
  recordHostEvent(host, "recovery.event-replay-ready");
}

function attachTunnelLifecycle(host: HostConnection): void {
  host.tunnel.once("exit", (code) => {
    if (hostConnections.get(host.alias) !== host || host.intentionalClose) return;
    if (host.healthTimer) clearInterval(host.healthTimer);
    host.healthTimer = undefined;
    host.state = "reconnecting";
    host.failureKind ??= "ssh";
    host.error = `SSH tunnel exited (${code ?? "unknown"}).`;
    updateHostWorkspaceStatuses(host);
    scheduleReconnect(host);
  });
}

function updateHostWorkspaceStatuses(host: HostConnection): void {
  for (const workspaceId of host.workspaceIds) {
    const workspace = connections.get(workspaceId);
    if (!workspace) continue;
    workspace.status = { ...workspace.status, localPort: host.localPort, gatewayVersion: host.gatewayVersion, protocolVersion: host.protocolVersion, capabilities: host.capabilities, connected: host.state === "ready", gatewayReady: host.state === "ready", connectionState: host.state, error: host.error, failureKind: host.failureKind };
    emitWorkspaceStatus(workspace.status);
  }
}

function scheduleReconnect(host: HostConnection): void {
  const next = host.backoff.next();
  if (next.exhausted) {
    host.state = "failed";
    host.error = "Remote SSH reconnect attempts were exhausted.";
    recordHostEvent(host, "reconnect.exhausted", undefined, host.error);
    updateHostWorkspaceStatuses(host);
    return;
  }
  const delay = next.delayMs;
  host.retries = next.attempt;
  host.nextRetryAt = Date.now() + delay;
  recordHostEvent(host, "reconnect.scheduled", undefined, `attempt=${host.retries} delayMs=${delay}`);
  host.reconnectTimer = setTimeout(async () => {
    if (hostConnections.get(host.alias) !== host || host.intentionalClose) return;
    try {
      host.localPort = await availablePort();
      host.token = randomBytes(32).toString("base64url");
      await startRemoteGateway(host.alias, host.bootstrapPath, host.token, host.createdAt);
      if (hostConnections.get(host.alias) !== host || host.intentionalClose) return;
      host.tunnel = openTunnel(host.alias, host.localPort);
      attachTunnelLifecycle(host);
      host.state = "runtime_check";
      recordHostEvent(host, "runtime.check");
      await waitForGateway(host);
      if (hostConnections.get(host.alias) !== host || host.intentionalClose) return;
      await recoverHostRuntimeResources(host);
      host.reconnectCount += 1; host.retries = 0; host.nextRetryAt = undefined; host.backoff.reset(); host.state = "ready"; host.error = undefined; host.failureKind = undefined; host.lastConnectedAt = Date.now();
      await portForwardRegistry.resumeHost(host.alias);
      recordHostEvent(host, "reconnect.connected");
      startHostHealthMonitor(host);
      updateHostWorkspaceStatuses(host);
      for (const workspaceId of host.workspaceIds) {
        const workspace = connections.get(workspaceId);
        if (workspace) ensureRemoteFileWatcher(workspace.path);
      }
    } catch (error) {
      host.error = error instanceof Error ? error.message : String(error);
      recordHostEvent(host, "reconnect.failed", undefined, host.error);
      scheduleReconnect(host);
    }
  }, delay);
}

export async function disconnectRemoteWorkspace(id: string): Promise<boolean> {
  const item = connections.get(id);
  if (!item) { await setRemoteWorkspaceAutoReconnect(id, false); return false; }
  const activeHost = hostConnections.get(item.alias);
  if (activeHost?.state === "ready") {
    await fetch(`http://127.0.0.1:${activeHost.localPort}/v1/workspaces/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "X-OpenDrSai-Gateway-Token": activeHost.token },
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
  }
  connections.delete(id);
  await setRemoteWorkspaceAutoReconnect(id, false);
  const watcher = remoteFileWatchers.get(item.path); remoteFileWatchers.delete(item.path); watcher?.close();
  remoteFileWatchCursors.delete(item.path);
  emitWorkspaceStatus({ ...item.status, connected: false, gatewayReady: false, connectionState: "disconnected", localPort: undefined });
  const host = hostConnections.get(item.alias);
  if (host) {
    host.workspaceIds.delete(id);
    if (host.workspaceIds.size === 0) {
      if (host.idleTimer) clearTimeout(host.idleTimer);
      host.idleTimer = setTimeout(() => {
        if (hostConnections.get(item.alias) !== host || host.workspaceIds.size > 0) return;
        hostConnections.delete(item.alias);
        closeHostConnection(host);
      }, HOST_IDLE_TIMEOUT_MS);
      host.idleTimer.unref();
    }
  }
  return true;
}

export async function restorePersistedRemoteWorkspaces(): Promise<void> {
  for (const workspace of await listWorkspaces()) {
    if (workspace.location !== "remote" || workspace.transport !== "ssh" || !workspace.remote || connections.has(workspace.id)) continue;
    if (!shouldRestorePersistedRemoteWorkspace(workspace)) continue;
    if ([...connections.values()].some((connection) => connection.alias === workspace.remote!.hostAlias && connection.path === workspace.remote!.canonicalPath)) continue;
    void connectRemoteWorkspace({ hostAlias: workspace.remote.hostAlias, path: workspace.remote.canonicalPath, name: workspace.name, trusted: workspace.trusted }).catch((error) => {
      emitWorkspaceStatus({ ...workspace.remote!, connected: false, gatewayReady: false, connectionState: "failed", error: error instanceof Error ? error.message : String(error) });
    });
  }
}

function closeHostConnection(host: HostConnection): void {
  host.intentionalClose = true;
  if (host.reconnectTimer) clearTimeout(host.reconnectTimer);
  if (host.healthTimer) clearInterval(host.healthTimer);
  if (host.idleTimer) clearTimeout(host.idleTimer);
  host.idleTimer = undefined;
  host.tunnel.kill();
}

function startHostHealthMonitor(host: HostConnection): void {
  if (host.healthTimer) clearInterval(host.healthTimer);
  host.healthFailures = 0;
  host.healthTimer = setInterval(async () => {
    if (host.intentionalClose || host.state !== "ready") return;
    try {
      const response = await fetch(`http://127.0.0.1:${host.localPort}/v1/runtime`, { headers: { "X-OpenDrSai-Gateway-Token": host.token }, signal: AbortSignal.timeout(2_000) });
      if (!response.ok) throw new Error(`health status ${response.status}`);
      host.healthFailures = 0;
    } catch (error) {
      host.healthFailures += 1;
      recordHostEvent(host, "gateway.health-failed", undefined, error instanceof Error ? error.message : String(error));
      if (host.healthFailures >= 2) {
        const ssh = await diagnoseSshHost(host.alias, 2_500);
        host.failureKind = classifyRemoteFailure(false, ssh.state === "reachable");
        host.error = host.failureKind === "ssh" ? `SSH transport unavailable (${ssh.state}).` : "Remote Runtime unavailable while SSH remains reachable.";
        recordHostEvent(host, `${host.failureKind}.health-failed`, undefined, host.error);
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
    return host ? { ...active.status, localPort: host.localPort, connected: host.state === "ready", gatewayReady: host.state === "ready", connectionState: host.state, error: host.error, failureKind: host.failureKind } : { ...active.status };
  }
  const workspace = await findWorkspaceById(id);
  if (!workspace?.remote) throw new Error("Remote workspace not found.");
  return { ...workspace.remote, connected: false, gatewayReady: false, connectionState: "disconnected" };
}

export function getRemoteGatewayAccess(workspacePathOrId?: string, workspaceId?: string): { baseUrl: string; token: string; workspaceId: string } | null {
  const authoritativeId = workspaceId || (workspacePathOrId && connections.has(workspacePathOrId) ? workspacePathOrId : undefined);
  if (authoritativeId) {
    const connection = connections.get(authoritativeId);
    const host = connection ? hostConnections.get(connection.alias) : undefined;
    return connection && host?.state === "ready"
      ? { baseUrl: `http://127.0.0.1:${host.localPort}`, token: host.token, workspaceId: authoritativeId }
      : null;
  }
  if (!workspacePathOrId) return null;
  const matches = [...connections.entries()].filter(([, connection]) => connection.status.canonicalPath === workspacePathOrId);
  if (matches.length !== 1) return null;
  const [matchedId, connection] = matches[0];
  const host = hostConnections.get(connection.alias);
  return host?.state === "ready"
    ? { baseUrl: `http://127.0.0.1:${host.localPort}`, token: host.token, workspaceId: matchedId }
    : null;
}

export function getRemoteWorkspaceRootForPath(path?: string): string | null {
  if (!path) return null;
  for (const connection of connections.values()) {
    if (path === connection.path || path.startsWith(`${connection.path}/`)) return connection.path;
  }
  return null;
}

export async function resolveRemoteWorkspaceTarget(
  workspacePath?: string,
  workspaceId?: string,
): Promise<"remote_online" | "remote_offline" | "local_or_unknown"> {
  if (getRemoteGatewayAccess(workspacePath, workspaceId)) return "remote_online";
  const persisted = workspaceId
    ? await findWorkspaceById(workspaceId)
    : (await listWorkspaces()).find((item) => item.path === workspacePath);
  return persisted?.location === "remote" ? "remote_offline" : "local_or_unknown";
}

async function remoteJson<T>(workspacePath: string, endpoint: string, workspaceId?: string): Promise<T> {
  const access = getRemoteGatewayAccess(workspacePath, workspaceId);
  const cacheKey = `${workspaceId || workspacePath}\0${endpoint}`;
  if (!access) {
    if (remoteReadCache.has(cacheKey)) return structuredClone(remoteReadCache.get(cacheKey)) as T;
    throw new Error("Remote Workspace is offline and no stale read-only cache is available.");
  }
  const value = await new RemoteGatewayClient(access.baseUrl, access.token, access.workspaceId).get<T>(endpoint);
  remoteReadCache.set(cacheKey, structuredClone(value));
  return value;
}

async function remotePost<T>(workspacePath: string, endpoint: string, body: unknown, workspaceId?: string): Promise<T> {
  const access = getRemoteGatewayAccess(workspacePath, workspaceId);
  if (!access) throw new Error("Remote workspace is not connected.");
  return new RemoteGatewayClient(access.baseUrl, access.token, access.workspaceId).post<T>(endpoint, body);
}

export async function prepareRemoteForkWorktree(workspacePath: string, intent?: string): Promise<DesktopForkWorktreeResult> {
  const access = getRemoteGatewayAccess(workspacePath);
  if (!access) throw new Error("Remote workspace is not connected.");
  const parent = connections.get(access.workspaceId);
  const host = parent ? hostConnections.get(parent.alias) : undefined;
  if (!parent || !host) throw new Error("Remote computer connection is unavailable.");
  const result = await remotePost<{
    worktree_id: string;
    workspace_id: string;
    source_workspace_path: string;
    repo_root: string;
    worktree_path: string;
    branch: string;
    base_ref: string;
    source_has_changes: boolean;
    source_status_summary?: string;
  }>(workspacePath, "/worktrees", {
    intent: intent || "subtask",
    idempotency_key: `desktop-${randomBytes(16).toString("hex")}`,
  });
  const status: RemoteWorkspaceStatus = {
    hostAlias: parent.alias,
    canonicalPath: result.worktree_path,
    workspaceId: result.workspace_id,
    connectionState: "ready",
    connected: true,
    gatewayReady: true,
    localPort: host.localPort,
    gatewayVersion: host.gatewayVersion,
    protocolVersion: host.protocolVersion,
  };
  connections.set(result.workspace_id, { status, alias: parent.alias, path: result.worktree_path });
  host.workspaceIds.add(result.workspace_id);
  return {
    worktreeId: result.worktree_id,
    sourceWorkspaceId: access.workspaceId,
    location: "remote",
    transport: "ssh",
    workspaceId: result.workspace_id,
    sourceWorkspacePath: result.source_workspace_path,
    repoRoot: result.repo_root,
    worktreePath: result.worktree_path,
    branch: result.branch,
    baseRef: result.base_ref,
    sourceHasChanges: result.source_has_changes,
    sourceStatusSummary: result.source_status_summary,
  };
}

export async function listRemoteWorkspaceCheckpoints(workspacePath: string, workspaceId?: string): Promise<WorkspaceCheckpoint[]> {
  return (await remoteJson<{ data: WorkspaceCheckpoint[] }>(workspacePath, "/checkpoints", workspaceId)).data;
}
export async function createRemoteWorkspaceCheckpoint(request: WorkspaceCheckpointCreateRequest): Promise<WorkspaceCheckpoint> {
  return remotePost(request.workspacePath, "/checkpoints", request, request.workspaceId);
}
export async function previewRemoteWorkspaceCheckpoint(request: WorkspaceCheckpointPreviewRequest): Promise<WorkspaceCheckpointPreviewResult> {
  return remotePost(request.workspacePath, "/checkpoints/preview", request, request.workspaceId);
}
export async function restoreRemoteWorkspaceCheckpoint(request: WorkspaceCheckpointRestoreRequest): Promise<WorkspaceCheckpointRestoreResult> {
  return remotePost(request.workspacePath, "/checkpoints/restore", request, request.workspaceId);
}
export async function acceptRemoteWorkspaceCheckpoint(request: WorkspaceCheckpointAcceptRequest): Promise<WorkspaceCheckpoint> {
  return remotePost(request.workspacePath, "/checkpoints/accept", request, request.workspaceId);
}

export async function executeRemoteWorkspaceMutation(action: "stage-file" | "revert-file" | "stage-hunk" | "revert-hunk", request: unknown): Promise<unknown> {
  const value = request as { workspacePath?: string; workspaceId?: string; path?: string; expectedDiffHash?: string; patch?: string };
  if (!value.workspacePath || !value.path || !value.expectedDiffHash) throw new Error("Remote workspace mutation request is incomplete.");
  const access = getRemoteGatewayAccess(value.workspacePath, value.workspaceId);
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
  const stale = !getRemoteGatewayAccess(request.workspacePath, request.workspaceId);
  ensureRemoteFileWatcher(request.workspacePath, request.workspaceId);
  const parameters = new URLSearchParams({ depth: String(Math.max(0, Math.min(5, request.maxDepth ?? 2))), max_entries: String(request.maxEntries ?? 500), offset: String(request.offset ?? 0) });
  if (request.query) parameters.set("query", request.query);
  const payload = await remoteJson<{ data: Array<Record<string, unknown>>; total?: number; truncated?: boolean; next_offset?: number | null }>(request.workspacePath, `/files?${parameters}`, request.workspaceId);
  let count = 0;
  const mapNode = (row: Record<string, unknown>): any => {
    count += 1;
    const directory = row.directory === true;
    const gitStatus = ["modified", "added", "deleted", "renamed", "untracked", "clean"].includes(String(row.git_status)) ? row.git_status as "modified" | "added" | "deleted" | "renamed" | "untracked" | "clean" : undefined;
    return { name: String(row.name || ""), path: `${request.workspacePath}/${String(row.path || "")}`, relativePath: String(row.path || ""), type: directory ? "directory" : "file", size: typeof row.size === "number" ? row.size : undefined, modifiedAt: typeof row.modified_at === "number" ? new Date(row.modified_at * 1000).toISOString() : undefined, gitStatus, children: Array.isArray(row.children) ? row.children.map((child) => mapNode(child as Record<string, unknown>)) : undefined };
  };
  const nodes = payload.data.map(mapNode);
  return { workspacePath: request.workspacePath, nodes, totalEntries: payload.total ?? count, truncated: payload.truncated === true, stale, ...(typeof payload.next_offset === "number" ? { nextOffset: payload.next_offset } : {}) };
}

export async function getRemoteWorkspaceContextOverview(workspacePath: string, workspaceId?: string): Promise<WorkspaceContextOverview> {
  return remoteJson(workspacePath, "/context", workspaceId);
}

export async function previewRemoteWorkspaceFile(request: WorkspaceFilePreviewRequest): Promise<WorkspaceFilePreview> {
  const stale = !getRemoteGatewayAccess(request.workspacePath, request.workspaceId);
  const relative = request.path.startsWith(request.workspacePath) ? request.path.slice(request.workspacePath.length).replace(/^[/\\]+/, "") : request.path;
  const payload = await remoteJson<{ path: string; content?: string; data_url?: string; mime?: string; modified_at?: number; truncated: boolean; size: number }>(request.workspacePath, `/file?path=${encodeURIComponent(relative)}&max_bytes=${request.maxBytes ?? 262144}`, request.workspaceId);
  const kind = payload.data_url ? (payload.mime?.startsWith("image/") ? "image" : "binary") : "text";
  return { workspacePath: request.workspacePath, path: request.path, relativePath: payload.path, name: payload.path.split("/").pop() || payload.path, kind, mime: payload.mime || "text/plain", size: payload.size, modifiedAt: new Date((payload.modified_at || 0) * 1000).toISOString(), truncated: payload.truncated, stale, content: payload.content, dataUrl: payload.data_url, mode: request.mode || "auto" };
}

export async function getRemoteWorkspaceGitDiff(request: WorkspaceGitDiffRequest): Promise<WorkspaceGitDiffResult> {
  const stale = !getRemoteGatewayAccess(request.workspacePath, request.workspaceId);
  const relative = request.path?.startsWith(request.workspacePath) ? request.path.slice(request.workspacePath.length).replace(/^[/\\]+/, "") : request.path;
  const payload = await remoteJson<{ diff: string; staged: boolean }>(request.workspacePath, `/git/diff?staged=${request.staged === true}${relative ? `&path=${encodeURIComponent(relative)}` : ""}`, request.workspaceId);
  const diff = payload.diff.slice(0, request.maxChars ?? 200_000);
  return { workspacePath: request.workspacePath, path: request.path, diff, diffHash: createHash("sha256").update(payload.diff).digest("hex"), truncated: diff.length < payload.diff.length, staged: payload.staged, stale };
}

export async function summarizeRemoteWorkspaceFolder(request: WorkspaceFolderSummaryRequest, workspacePath: string): Promise<WorkspaceFolderSummaryResult> {
  const relative = request.path.startsWith(workspacePath) ? request.path.slice(workspacePath.length).replace(/^[/\\]+/, "") || "." : request.path;
  return remoteJson(workspacePath, `/folder-summary?path=${encodeURIComponent(relative)}&max_entries=${request.maxEntries ?? 500}&max_sample_files=${request.maxSampleFiles ?? 20}&max_chars=${request.maxChars ?? 20000}`);
}

export async function getRemoteWorkspaceGitFileAtRef(request: WorkspaceGitFileAtRefRequest): Promise<WorkspaceGitFileAtRefResult> {
  const relative = request.path.startsWith(request.workspacePath) ? request.path.slice(request.workspacePath.length).replace(/^[/\\]+/, "") : request.path;
  return remoteJson(request.workspacePath, `/git/file-at-ref?ref=${encodeURIComponent(request.ref)}&path=${encodeURIComponent(relative)}&max_bytes=${request.maxBytes ?? 262144}`, request.workspaceId);
}

export async function writeRemoteWorkspaceFile(request: WorkspaceFileWriteRequest): Promise<WorkspaceFileWriteResult> {
  if (request.mode === "save_as") throw new Error("Remote Save As requires an explicit remote destination workflow.");
  const access = getRemoteGatewayAccess(request.workspacePath, request.workspaceId);
  if (!access) throw new Error("Remote workspace is not connected.");
  const relative = request.path.startsWith(request.workspacePath) ? request.path.slice(request.workspacePath.length).replace(/^[/\\]+/, "") : request.path;
  const expectedHash = request.mode === "overwrite" ? undefined : request.expectedHash;
  const response = await fetch(`${access.baseUrl}/v1/workspaces/${encodeURIComponent(access.workspaceId)}/file`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-OpenDrSai-Gateway-Token": access.token },
    body: JSON.stringify({ path: relative, content_base64: Buffer.from(request.content, "utf8").toString("base64"), expected_sha256: expectedHash }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 409) {
    const conflict = await response.json() as { detail?: { current_sha256?: string } };
    const currentHash = conflict.detail?.current_sha256 || "";
    return { status: "conflict", path: request.path, expectedHash: request.expectedHash, currentHash, savedAs: false, overwroteExternal: false, message: "Remote file changed since it was read." };
  }
  if (!response.ok) throw new Error(`Remote file write failed (${response.status}).`);
  const payload = await response.json() as { sha256: string; modified_at?: number; size?: number };
  return { status: "saved", path: request.path, expectedHash: request.expectedHash, currentHash: payload.sha256, savedHash: payload.sha256, savedAs: false, overwroteExternal: request.mode === "overwrite", ...(payload.modified_at ? { externalModifiedAt: new Date(payload.modified_at * 1000).toISOString() } : {}), ...(typeof payload.size === "number" ? { externalSize: payload.size } : {}), message: "Remote file saved." };
}

export async function listRemoteThreads(workspaceId: string): Promise<DesktopThread[]> {
  const connection = connections.get(workspaceId);
  const host = connection ? hostConnections.get(connection.alias) : undefined;
  if (!connection || !host || host.state !== "ready") throw new Error("Remote workspace is not connected.");
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
  if (!host || host.state !== "ready") return null;
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
  if (!connection || !host || host.state !== "ready") throw new Error("Remote workspace is not connected.");
  const response = await fetch(`http://127.0.0.1:${host.localPort}/v1/hepai/workers`, { headers: { "X-OpenDrSai-Gateway-Token": host.token }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HepAI worker discovery failed (${response.status}).`);
  const payload = await response.json() as { data?: Array<Record<string, unknown>> };
  return (payload.data || []).map((row, index) => ({ id: String(row.id || row.model || `worker-${index}`), name: String(row.name || row.id || row.model || `Worker ${index + 1}`), description: typeof row.description === "string" ? row.description : undefined, enabled: row.enabled !== false, callables: Array.isArray(row.callables) ? row.callables.map(String) : [], status: row.status === "available" || row.status === "disabled" ? row.status : "unavailable" }));
}

export async function setRemoteHepaiWorkerEnabled(workspaceId: string, workerId: string, enabled: boolean): Promise<boolean> {
  const connection = connections.get(workspaceId); const host = connection ? hostConnections.get(connection.alias) : undefined;
  if (!host || host.state !== "ready" || !/^[A-Za-z0-9_.:/-]{1,200}$/.test(workerId)) throw new Error("Remote Worker request is invalid.");
  const response = await fetch(`http://127.0.0.1:${host.localPort}/v1/hepai/workers/${encodeURIComponent(workerId)}/state`, { method: "PUT", headers: { "Content-Type": "application/json", "X-OpenDrSai-Gateway-Token": host.token }, body: JSON.stringify({ enabled }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Remote Worker update failed (${response.status}).`);
  return true;
}

export function stopAllRemoteWorkspaces(): void {
  for (const host of hostConnections.values()) closeHostConnection(host);
  hostConnections.clear();
  connections.clear();
}
