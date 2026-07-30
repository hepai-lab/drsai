import { randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { readFile, stat } from "node:fs/promises";
import type { RemoteGatewayInstallRequest, RemoteGatewayInstallResult, RemoteGatewayOperationEvent, RemoteGatewayPreflight } from "../api/desktopApi";
import { REMOTE_SSH_PROTOCOL_VERSION } from "../api/remoteSshProtocol";
import { loadRuntimeArtifactTrustStore, verifyRuntimeArtifactTrust } from "./runtimeArtifactTrust";
import { sshHostService } from "./sshHosts";

export interface RemoteGatewayTransport {
  executePython(hostAlias: string, script: string, timeoutMs: number, signal?: AbortSignal): Promise<string>;
  upload(hostAlias: string, localPath: string, remotePath: string, timeoutMs: number, signal?: AbortSignal): Promise<void>;
}

type ArtifactVerifier = (request: RemoteGatewayInstallRequest, bytes: Buffer) => Promise<string>;
export class RemoteGatewayInstaller {
  readonly #transport: RemoteGatewayTransport;
  readonly #verifyArtifact: ArtifactVerifier;
  readonly #operations = new Map<string, { operationId: string; controller: AbortController }>();
  #publisher?: (event: RemoteGatewayOperationEvent) => void;

  constructor(transport: RemoteGatewayTransport, verifyArtifact: ArtifactVerifier = verifyArtifactTrust) {
    this.#transport = transport; this.#verifyArtifact = verifyArtifact;
  }
  setPublisher(publisher: (event: RemoteGatewayOperationEvent) => void): void { this.#publisher = publisher; }
  cancel(rawAlias: unknown): boolean { const alias = assertAlias(rawAlias); const operation = this.#operations.get(alias); if (!operation) return false; operation.controller.abort(); return true; }
  shutdown(): void { for (const operation of this.#operations.values()) operation.controller.abort(); }

  async preflight(rawAlias: unknown): Promise<RemoteGatewayPreflight> {
    const alias = assertAlias(rawAlias);
    const output = await this.#transport.executePython(alias, PREFLIGHT_SCRIPT, 20_000);
    let parsed: Omit<RemoteGatewayPreflight, "hostAlias">;
    try { parsed = JSON.parse(output) as Omit<RemoteGatewayPreflight, "hostAlias">; } catch { throw new Error("Remote Gateway preflight returned invalid JSON."); }
    if (typeof parsed.operatingSystem !== "string" || typeof parsed.architecture !== "string" || typeof parsed.pythonVersion !== "string" || typeof parsed.compatible !== "boolean" || !Array.isArray(parsed.issues) || typeof parsed.gatewayInstalled !== "boolean") throw new Error("Remote Gateway preflight response is invalid.");
    return { hostAlias: alias, ...parsed, issues: parsed.issues.filter((item): item is string => typeof item === "string").slice(0, 20) };
  }

  async install(rawRequest: unknown): Promise<RemoteGatewayInstallResult> {
    const request = validateRemoteGatewayInstallRequest(rawRequest); const alias = request.hostAlias;
    if (this.#operations.has(alias)) throw new Error("A Remote Gateway operation is already running for this host.");
    const operationId = `${Date.now()}-${randomBytes(8).toString("hex")}`; const controller = new AbortController();
    this.#operations.set(alias, { operationId, controller });
    const emit = (phase: RemoteGatewayOperationEvent["phase"], progress: number, message: string, state: RemoteGatewayOperationEvent["state"] = "running") => this.#publisher?.({ operationId, hostAlias: alias, action: request.action, state, phase, progress, message });
    emit("validating", 2, "Validating the requested Remote Gateway transaction.");
    try {
      let artifactName: string | undefined; let artifactSha256: string | undefined;
      if (request.action !== "rollback") {
        emit("verifying", 8, "Verifying the local Runtime artifact trust and SHA-256 digest.");
        const artifactPath = request.artifactPath!; const details = await stat(artifactPath);
        if (!details.isFile() || details.size <= 0 || details.size > 1024 * 1024 * 1024) throw new Error("Gateway artifact is invalid or too large.");
        const bytes = await readFile(artifactPath); artifactSha256 = await this.#verifyArtifact(request, bytes); artifactName = basename(artifactPath);
        if (!/^[A-Za-z0-9_.+-]{1,200}$/.test(artifactName)) throw new Error("Gateway artifact filename is invalid.");
        await this.#transport.executePython(alias, CREATE_INCOMING_SCRIPT, 20_000, controller.signal);
        emit("uploading", 20, "Uploading the verified artifact through SCP.");
        await this.#transport.upload(alias, artifactPath, `.local/share/opendrsai/remote/incoming/${artifactName}`, 180_000, controller.signal);
      }
      throwIfAborted(controller.signal);
      emit(request.action === "rollback" ? "switching" : "installing", request.action === "rollback" ? 60 : 40, request.action === "rollback" ? "Preparing an atomic release rollback." : "Creating an isolated candidate release.");
      const payload = Buffer.from(JSON.stringify({ action: request.action, version: request.version, artifactName, artifactSha256, protocolVersion: REMOTE_SSH_PROTOCOL_VERSION }), "utf8").toString("base64");
      emit("health-check", 75, "Verifying candidate protocol compatibility and startup health.");
      await this.#transport.executePython(alias, INSTALL_SCRIPT.replace("__PAYLOAD__", payload), 180_000, controller.signal);
      throwIfAborted(controller.signal);
      emit("switching", 92, "Candidate is healthy and the release link was switched atomically.");
      const result = { ...(await this.preflight(alias)), changed: true, action: request.action };
      emit("completed", 100, "Remote Gateway operation completed.", "completed"); return result;
    } catch (error) {
      const cancelled = controller.signal.aborted;
      emit("completed", cancelled ? 0 : 100, cancelled ? "Remote Gateway operation cancelled; current release was preserved." : `Remote Gateway operation failed: ${safeMessage(error)}`, cancelled ? "cancelled" : "failed");
      throw cancelled ? new Error("Remote Gateway operation was cancelled.") : error;
    } finally { if (this.#operations.get(alias)?.operationId === operationId) this.#operations.delete(alias); }
  }
}

const PREFLIGHT_SCRIPT = `import importlib.metadata,json,pathlib,platform,subprocess
home=pathlib.Path.home()/".local"/"share"/"opendrsai"/"remote"
def link(name):
 p=home/name
 try: return p.resolve().name if p.exists() or p.is_symlink() else None
 except OSError: return None
managed=home/"current"/"bin"/"python"
if managed.exists():
 probe=subprocess.run([str(managed),"-c",'import importlib.metadata;print(importlib.metadata.version("drsai"))'],capture_output=True,text=True)
 version=probe.stdout.strip() if probe.returncode==0 else None
else:
 try: version=importlib.metadata.version("drsai")
 except importlib.metadata.PackageNotFoundError: version=None
py=tuple(int(part) for part in platform.python_version_tuple()[:2]); os_name=platform.system(); issues=[]
if os_name!="Linux": issues.append("Remote Runtime requires Linux")
if py<(3,11): issues.append("Python 3.11 or newer is required")
print(json.dumps({"operatingSystem":os_name,"architecture":platform.machine(),"pythonVersion":platform.python_version(),"compatible":not issues,"issues":issues,"installationHint":"Install python3, python3-venv, git and OpenSSH server." if issues else None,"gatewayInstalled":version is not None,"gatewayVersion":version,"currentRelease":link("current"),"previousRelease":link("previous")}))`;
const CREATE_INCOMING_SCRIPT = `import pathlib
p=pathlib.Path.home()/".local"/"share"/"opendrsai"/"remote"/"incoming"
p.mkdir(parents=True,exist_ok=True)`;
const INSTALL_SCRIPT = `import base64,fcntl,json,os,pathlib,subprocess,sys,shutil,socket,time,uuid,hashlib
cfg=json.loads(base64.b64decode("__PAYLOAD__")); home=pathlib.Path.home()/".local"/"share"/"opendrsai"/"remote"; releases=home/"releases"
releases.mkdir(parents=True,exist_ok=True); current=home/"current"; previous=home/"previous"; lock=(home/"install.lock").open("a+")
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
 if target.exists(): raise SystemExit("Remote Gateway release already exists.")
 staging=releases/(".staging-"+cfg["version"]+"-"+uuid.uuid4().hex); artifact=home/"incoming"/cfg["artifactName"]
 if hashlib.sha256(artifact.read_bytes()).hexdigest()!=cfg["artifactSha256"]: raise SystemExit("Artifact SHA-256 mismatch")
 try:
  subprocess.run([sys.executable,"-m","venv",str(staging)],check=True); py=staging/"bin"/"python"
  subprocess.run([str(py),"-m","pip","install","--disable-pip-version-check",str(artifact)],check=True)
  subprocess.run([str(py),"-c",f'import drsai.backend.gateway as g; assert getattr(g,"_REMOTE_PROTOCOL_VERSION",None)=={cfg["protocolVersion"]}'],check=True)
  probe=socket.socket(); probe.bind(("127.0.0.1",0)); port=probe.getsockname()[1]; probe.close(); env=os.environ.copy(); env.update({"DRSAI_API_HOST":"127.0.0.1","DRSAI_API_PORT":str(port),"OPENDRSAI_GATEWAY_INSTANCE_TOKEN":uuid.uuid4().hex})
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
 except BaseException: shutil.rmtree(staging,ignore_errors=True); artifact.unlink(missing_ok=True); raise
 if current.exists(): swap(previous,current.resolve())
 swap(current,target); artifact.unlink(missing_ok=True)
print("ok")`;

export function validateRemoteGatewayInstallRequest(value: unknown): RemoteGatewayInstallRequest {
  if (!value || typeof value !== "object") throw new Error("Remote Gateway request is invalid."); const request = value as Partial<RemoteGatewayInstallRequest>;
  const hostAlias = assertAlias(request.hostAlias); if (!request.action || !["install", "upgrade", "rollback"].includes(request.action)) throw new Error("Remote Gateway action is invalid.");
  if (request.action === "rollback") return { hostAlias, action: "rollback" };
  const version = request.version?.trim(); const artifactPath = request.artifactPath?.trim();
  if (!version || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(version)) throw new Error("A valid Gateway version is required.");
  if (!artifactPath || !/\.(whl|tar\.gz)$/i.test(artifactPath) || /[\r\n\0]/.test(artifactPath)) throw new Error("A local wheel or source archive is required.");
  return { ...request, hostAlias, action: request.action, version, artifactPath } as RemoteGatewayInstallRequest;
}
async function verifyArtifactTrust(request: RemoteGatewayInstallRequest, bytes: Buffer): Promise<string> { const trusted = await loadRuntimeArtifactTrustStore(); return verifyRuntimeArtifactTrust(bytes, { version: request.version!, expectedSha256: request.artifactSha256, publisher: request.artifactPublisher || "", signature: request.artifactSignature || "" }, trusted).sha256; }
function assertAlias(value: unknown): string { if (typeof value !== "string" || !/^[A-Za-z0-9_.@-]{1,128}$/.test(value)) throw new Error("SSH host alias is invalid."); return value; }
function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw new Error("Remote Gateway operation was cancelled."); }
function safeMessage(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/(password|token|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 1000); }

export function createSystemRemoteGatewayTransport(): RemoteGatewayTransport {
  const config = process.env.OPENDRSAI_SSH_CONFIG?.trim() ?? join(homedir(), ".ssh", "config"); const knownHosts = sshHostService.knownHostsPath;
  const ssh = process.env.OPENDRSAI_SSH_EXECUTABLE?.trim() ?? (process.platform === "darwin" ? "/usr/bin/ssh" : "ssh"); const scp = process.platform === "darwin" ? "/usr/bin/scp" : "scp";
  const base = (alias: string) => ["-F", config, "-o", `UserKnownHostsFile=${knownHosts}`, "-o", "StrictHostKeyChecking=yes", "-o", "BatchMode=yes", alias];
  return {
    executePython: (alias, script, timeout, signal) => new Promise((resolvePromise, reject) => { const child = spawn(ssh, [...base(assertAlias(alias)), "python3", "-"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, signal }); let stdout = "", stderr = ""; const timer = setTimeout(() => child.kill(), timeout); child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.length > 2 * 1024 * 1024) child.kill(); }); child.stderr.on("data", (chunk) => { stderr += chunk; if (stderr.length > 2 * 1024 * 1024) child.kill(); }); child.once("error", reject); child.once("close", (code) => { clearTimeout(timer); code === 0 ? resolvePromise(stdout.trim()) : reject(new Error(stderr.trim() || `Remote command exited with ${code}.`)); }); child.stdin.end(script, "utf8"); }),
    upload: (alias, local, remote, timeout, signal) => new Promise((resolvePromise, reject) => execFile(scp, ["-F", config, "-o", `UserKnownHostsFile=${knownHosts}`, "-o", "StrictHostKeyChecking=yes", "-q", local, `${assertAlias(alias)}:${remote}`], { timeout, windowsHide: true, signal }, (error, _stdout, stderr) => error ? reject(new Error(String(stderr || error.message).trim())) : resolvePromise())),
  };
}
export const remoteGatewayInstaller = new RemoteGatewayInstaller(createSystemRemoteGatewayTransport());
