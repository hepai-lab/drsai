import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = resolve(desktop, "../../..");
const checkOnly = process.argv.includes("--check");
const hostAlias = String(process.env.OPENDRSAI_REMOTE_HOST_ALIAS || "").trim();
const confirmed = process.env.OPENDRSAI_REMOTE_HOST_ACCEPTANCE === "1";
const runId = randomUUID();
const evidencePath = process.env.OPENDRSAI_REMOTE_HOST_EVIDENCE
  || join(desktop, "release", "product-evidence", "remote-workspace", "remote-host-smoke.json");
let temporaryRoot = "";
let remoteRoot = "";
let remote;
let workspace;
let installedAcceptanceRelease = false;
let previousRelease = null;
let acceptanceEvidence = null;
let verifiedHostKeyFingerprint = null;

if (checkOnly) {
  console.log(JSON.stringify({
    schemaVersion: 1,
    marker: "External Remote Workspace host smoke entrypoint is ready.",
    requiredEnvironment: ["OPENDRSAI_REMOTE_HOST_ALIAS", "OPENDRSAI_REMOTE_HOST_ACCEPTANCE=1"],
    optionalEnvironment: ["OPENDRSAI_SSH_CONFIG", "OPENDRSAI_REMOTE_HOST_NAME", "OPENDRSAI_REMOTE_HOST_USER", "OPENDRSAI_REMOTE_HOST_PORT", "OPENDRSAI_REMOTE_HOST_IDENTITY_FILE", "OPENDRSAI_REMOTE_HOST_FINGERPRINT", "OPENDRSAI_REMOTE_HOST_EVIDENCE", "OPENDRSAI_REMOTE_PYTHON", "OPENDRSAI_TEST_PYTHON"],
    safety: ["BatchMode SSH only", "non-root account required", "unique temporary workspace", "exact-path cleanup", "temporary artifact publisher", "previous Runtime release restored when present"],
  }, null, 2));
  process.exit(0);
}

if (!hostAlias || !/^[A-Za-z0-9_.-]{1,255}$/.test(hostAlias)) {
  throw new Error("Set OPENDRSAI_REMOTE_HOST_ALIAS to an SSH config alias or host name.");
}
if (!confirmed) {
  throw new Error("Set OPENDRSAI_REMOTE_HOST_ACCEPTANCE=1 to confirm non-destructive acceptance on the selected host.");
}
temporaryRoot = mkdtempSync(join(tmpdir(), "opendrsai-external-host-"));
// The acceptance bundle imports the real workspace persistence layer. Redirect it
// before module compilation/import so a smoke host can never enter the user's
// production Workspace list and reconnect on a later Desktop startup.
process.env.DRSAI_HOME = join(temporaryRoot, "isolated-drsai-home");

try {
  configureInlineSshTarget();
  const identity = prepareRemoteWorkspace();
  remoteRoot = identity.root;
  if (identity.uid === 0) throw new Error("External Remote Workspace acceptance refuses to run as root.");

  const wheel = buildWheel();
  const artifact = prepareSignedArtifact(wheel);
  process.env.OPENDRSAI_RUNTIME_TRUST_STORE = artifact.trustStore;
  compileRemoteWorkspace();
  remote = await import(new URL("../.cache/remoteWorkspace-external-host.mjs", import.meta.url).href + `?t=${Date.now()}`);
  const connectivity = await remote.diagnoseSshHost(hostAlias, 15_000);
  if (connectivity.state !== "reachable") {
    throw new Error(`SSH connectivity/authentication failed: ${JSON.stringify(connectivity)}`);
  }
  const preflight = await remote.preflightRemoteGateway(hostAlias);
  if (!preflight.compatible) throw new Error(`Remote Runtime preflight failed: ${preflight.issues.join("; ")}`);
  previousRelease = preflight.currentRelease || null;
  await remote.installRemoteGateway({
    hostAlias,
    action: preflight.gatewayInstalled ? "upgrade" : "install",
    version: artifact.version,
    artifactPath: wheel,
    artifactSha256: artifact.sha256,
    artifactPublisher: artifact.publisher,
    artifactSignature: artifact.signature,
  });
  installedAcceptanceRelease = true;

  workspace = await remote.connectRemoteWorkspace({ hostAlias, path: remoteRoot, trusted: true });
  const status = await remote.getRemoteWorkspaceStatus(workspace.id);
  if (!status.connected || !status.capabilities?.pty) throw new Error(`Remote Workspace did not become ready: ${JSON.stringify(status)}`);
  const access = remote.getRemoteGatewayAccess(workspace.id);
  if (!access) throw new Error("Remote Runtime access was not published.");

  const runtimeIdentity = await requestJson(`${access.baseUrl}/v1/runtime`, access.token);
  const tree = await remote.listRemoteWorkspaceFiles({ workspacePath: workspace.path, workspaceId: workspace.id, maxDepth: 3 });
  if (!tree.nodes.some((node) => node.name === "tracked.txt")) throw new Error("Remote file listing omitted the acceptance fixture.");
  const initial = await remote.previewRemoteWorkspaceFile({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/tracked.txt` });
  const write = await remote.writeRemoteWorkspaceFile({
    workspacePath: workspace.path,
    workspaceId: workspace.id,
    path: `${workspace.path}/tracked.txt`,
    content: "external remote workspace acceptance\n",
    expectedSha256: initial.sha256,
  });
  const diff = await remote.getRemoteWorkspaceGitDiff({ workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/tracked.txt` });
  if (!diff.diff.includes("external remote workspace acceptance")) throw new Error("Remote Git diff did not include the accepted file change.");
  await remote.executeRemoteWorkspaceMutation("stage-file", { workspacePath: workspace.path, workspaceId: workspace.id, path: `${workspace.path}/tracked.txt`, expectedDiffHash: diff.diffHash });
  await remote.commitRemoteWorkspace(workspace.path, "OpenDrSai temporary remote acceptance");

  const session = await requestJson(`${access.baseUrl}/v1/sessions`, access.token, {
    method: "POST", body: JSON.stringify({ workspace_id: workspace.id, title: "Temporary external host acceptance" }),
  });
  const run = await requestJson(`${access.baseUrl}/v1/sessions/${session.session_id}/runs`, access.token, {
    method: "POST", headers: { "Idempotency-Key": `external-${runId}` }, body: JSON.stringify({ agent_definition: "external-acceptance@1" }),
  });
  await requestJson(`${access.baseUrl}/v1/runs/${run.run_id}/transition`, access.token, { method: "POST", body: JSON.stringify({ status: "running" }) });
  await requestJson(`${access.baseUrl}/v1/runs/${run.run_id}/events`, access.token, { method: "POST", body: JSON.stringify({ type: "tool.started", data: { kind: "workspace.file", operation: "write" } }) });
  await requestJson(`${access.baseUrl}/v1/runs/${run.run_id}/events`, access.token, { method: "POST", body: JSON.stringify({ type: "tool.completed", data: { kind: "workspace.file", operation: "write", sha256: write.sha256 } }) });
  await requestJson(`${access.baseUrl}/v1/runs/${run.run_id}/checkpoint`, access.token, { method: "POST", body: JSON.stringify({ state: { phase: "external-host-smoke", file_sha256: write.sha256 } }) });
  const approval = await requestJson(`${access.baseUrl}/v1/runs/${run.run_id}/approvals`, access.token, { method: "POST", body: JSON.stringify({ request: { tool: "shell", reason: "temporary acceptance" } }) });
  await requestJson(`${access.baseUrl}/v1/approvals/${approval.approval_id}/decision`, access.token, { method: "POST", body: JSON.stringify({ decision: "approved", detail: { source: "external-host-smoke" } }) });
  await verifyLongShell(access, workspace.path);
  await requestJson(`${access.baseUrl}/v1/runs/${run.run_id}/transition`, access.token, { method: "POST", body: JSON.stringify({ status: "completed" }) });

  await remote.disconnectRemoteWorkspace(workspace.id);
  workspace = await remote.connectRemoteWorkspace({ hostAlias, path: remoteRoot, trusted: true });
  const reconnectAccess = remote.getRemoteGatewayAccess(workspace.id);
  if (!reconnectAccess) throw new Error("Remote Runtime access was not restored after reconnect.");
  const persistedRun = await requestJson(`${reconnectAccess.baseUrl}/v1/runs/${run.run_id}`, reconnectAccess.token);
  const events = await requestJson(`${reconnectAccess.baseUrl}/v1/runs/${run.run_id}/events`, reconnectAccess.token);
  if (persistedRun.status !== "completed" || !events.data.some((event) => event.type === "tool.completed")) {
    throw new Error("Session/Run/Tool state did not survive Desktop reconnect.");
  }

  acceptanceEvidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    hostAlias,
    temporaryArtifactPublisher: true,
    credentialMaterialPersisted: false,
    nonRootUser: identity.user,
    operatingSystem: identity.os,
    hostKeyFingerprint: verifiedHostKeyFingerprint,
    runtimeId: runtimeIdentity.runtime_id,
    runtimeInstanceId: runtimeIdentity.instance_id,
    workspaceId: workspace.id,
    sessionId: session.session_id,
    runId: run.run_id,
    checks: ["ssh", "runtime-install", "workspace", "files", "git", "session", "run", "tool-workspace-file", "approval", "checkpoint", "shell-pty", "long-command", "reconnect"],
    cleanupVerified: true,
    passed: true,
  };
} finally {
  const cleanupFailures = [];
  try { if (workspace && remote) await remote.disconnectRemoteWorkspace(workspace.id); } catch (error) { cleanupFailures.push(`Workspace disconnect failed: ${error instanceof Error ? error.message : String(error)}`); }
  try { if (remote) remote.stopAllRemoteWorkspaces(); } catch (error) { cleanupFailures.push(`SSH tunnel shutdown failed: ${error instanceof Error ? error.message : String(error)}`); }
  if (installedAcceptanceRelease && previousRelease && remote) {
    try { await remote.installRemoteGateway({ hostAlias, action: "rollback" }); } catch (error) { cleanupFailures.push(`Runtime rollback failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (remoteRoot) {
    try { cleanupRemoteWorkspace(remoteRoot); } catch (error) { cleanupFailures.push(`Temporary remote directory cleanup failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (remote && !waitForNoSshTunnels()) cleanupFailures.push("Desktop SSH tunnel process remained after stopAllRemoteWorkspaces().");
  delete process.env.OPENDRSAI_RUNTIME_TRUST_STORE;
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
  if (cleanupFailures.length) throw new AggregateError(cleanupFailures.map((message) => new Error(message)), "External host acceptance cleanup failed; operator review is required.");
}
if (!acceptanceEvidence) throw new Error("External host acceptance ended without evidence.");
mkdirSync(resolve(evidencePath, ".."), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(acceptanceEvidence, null, 2)}\n`);
console.log(`External Remote Workspace host smoke passed. Evidence: ${evidencePath}`);

function sshBaseArgs() {
  const args = [];
  const config = String(process.env.OPENDRSAI_SSH_CONFIG || "").trim();
  if (config) args.push("-F", config);
  args.push("-o", "BatchMode=yes", "-o", "ConnectTimeout=15", hostAlias);
  return args;
}

function configureInlineSshTarget() {
  const hostName = String(process.env.OPENDRSAI_REMOTE_HOST_NAME || "").trim();
  if (!hostName) return;
  const user = String(process.env.OPENDRSAI_REMOTE_HOST_USER || "").trim();
  const port = Number(process.env.OPENDRSAI_REMOTE_HOST_PORT || 22);
  const identityFile = String(process.env.OPENDRSAI_REMOTE_HOST_IDENTITY_FILE || "").trim();
  const expectedFingerprint = String(process.env.OPENDRSAI_REMOTE_HOST_FINGERPRINT || "").trim();
  if (!/^[A-Za-z0-9_.:-]{1,255}$/.test(hostName)) throw new Error("OPENDRSAI_REMOTE_HOST_NAME is invalid.");
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(user)) throw new Error("OPENDRSAI_REMOTE_HOST_USER is invalid.");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("OPENDRSAI_REMOTE_HOST_PORT is invalid.");
  if (!identityFile || /[\r\n\0\"]/.test(identityFile) || !existsSync(identityFile)) throw new Error("OPENDRSAI_REMOTE_HOST_IDENTITY_FILE must reference an existing private key.");
  if (!/^SHA256:[A-Za-z0-9+/]{20,}={0,2}$/.test(expectedFingerprint)) throw new Error("OPENDRSAI_REMOTE_HOST_FINGERPRINT must contain the expected SHA-256 SSH host-key fingerprint.");
  const config = join(temporaryRoot, "temporary-ssh-config");
  const knownHostsNative = join(temporaryRoot, "temporary-known-hosts");
  const knownHosts = knownHostsNative.replace(/\\/g, "/");
  const normalizedIdentity = resolve(identityFile).replace(/\\/g, "/");
  const scan = spawnSync("ssh-keyscan.exe", ["-T", "10", "-p", String(port), hostName], { encoding: "utf8", windowsHide: true });
  const scannedLines = String(scan.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (!scannedLines.length) throw new Error(`Unable to scan SSH host keys for ${hostName}:${port}: ${scan.stderr || scan.error?.message || "no keys returned"}`);
  const matchedLines = [];
  const hostKeyAlgorithms = new Set();
  for (const [index, line] of scannedLines.entries()) {
    const candidate = join(temporaryRoot, `candidate-host-key-${index}`);
    writeFileSync(candidate, `${line}\n`);
    const fingerprint = spawnSync("ssh-keygen.exe", ["-lf", candidate, "-E", "sha256"], { encoding: "utf8", windowsHide: true });
    const found = String(fingerprint.stdout || "").match(/SHA256:[A-Za-z0-9+/]+={0,2}/)?.[0];
    if (fingerprint.status === 0 && found === expectedFingerprint) {
      matchedLines.push(line);
      const keyType = line.split(/\s+/)[1];
      if (keyType) hostKeyAlgorithms.add(keyType);
    }
  }
  if (!matchedLines.length) throw new Error(`SSH host-key fingerprint mismatch for ${hostName}:${port}; expected ${expectedFingerprint}.`);
  writeFileSync(knownHostsNative, `${matchedLines.join("\n")}\n`);
  verifiedHostKeyFingerprint = expectedFingerprint;
  writeFileSync(config, [
    `Host ${hostAlias}`,
    `  HostName ${hostName}`,
    `  Port ${port}`,
    `  User ${user}`,
    `  IdentityFile "${normalizedIdentity}"`,
    "  IdentitiesOnly yes",
    "  BatchMode yes",
    "  StrictHostKeyChecking yes",
    `  UserKnownHostsFile "${knownHosts}"`,
    `  HostKeyAlgorithms ${[...hostKeyAlgorithms].join(",")}`,
    "  LogLevel ERROR",
    "",
  ].join("\n"));
  process.env.OPENDRSAI_SSH_CONFIG = config;
}

function prepareRemoteWorkspace() {
  const script = `import getpass,json,os,pathlib,subprocess,tempfile\nbase=pathlib.Path.home()/".cache"/"opendrsai"/"acceptance"\nbase.mkdir(parents=True,exist_ok=True)\nroot=pathlib.Path(tempfile.mkdtemp(prefix="opendrsai-remote-acceptance-",dir=base))\n(root/"tracked.txt").write_text("initial\\n",encoding="utf-8")\nsubprocess.run(["git","init","-q",str(root)],check=True)\nsubprocess.run(["git","-C",str(root),"config","user.name","OpenDrSai Temporary Acceptance"],check=True)\nsubprocess.run(["git","-C",str(root),"config","user.email","temporary-acceptance@invalid.local"],check=True)\nsubprocess.run(["git","-C",str(root),"add","tracked.txt"],check=True)\nsubprocess.run(["git","-C",str(root),"commit","-qm","initial"],check=True)\nprint(json.dumps({"root":str(root.resolve()),"uid":os.geteuid(),"user":getpass.getuser(),"os":os.uname().sysname}))\n`;
  return JSON.parse(runCapture("ssh.exe", [...sshBaseArgs(), externalRemotePython(), "-"], script));
}

function cleanupRemoteWorkspace(path) {
  const encoded = Buffer.from(path, "utf8").toString("base64");
  const script = `import base64,pathlib,shutil\np=pathlib.Path(base64.b64decode("${encoded}").decode()).resolve()\nbase=(pathlib.Path.home()/".cache"/"opendrsai"/"acceptance").resolve()\nif p.parent!=base or not p.name.startswith("opendrsai-remote-acceptance-"): raise SystemExit("refusing unsafe cleanup")\nshutil.rmtree(p)\nprint("cleaned")\n`;
  runCapture("ssh.exe", [...sshBaseArgs(), externalRemotePython(), "-"], script);
}

function externalRemotePython() {
  const configured = String(process.env.OPENDRSAI_REMOTE_PYTHON || "").trim();
  if (!configured) return "python3";
  if (configured.length > 4096 || !configured.startsWith("/") || !/^\/[A-Za-z0-9._/+~-]+$/.test(configured) || configured.split("/").includes("..")) {
    throw new Error("OPENDRSAI_REMOTE_PYTHON must be an absolute POSIX path without shell metacharacters.");
  }
  return configured;
}

function buildWheel() {
  const wheelDir = join(temporaryRoot, "wheel");
  mkdirSync(wheelDir, { recursive: true });
  const python = process.env.OPENDRSAI_TEST_PYTHON || "C:\\Python311\\python.exe";
  run(python, ["-m", "pip", "wheel", "--no-deps", "-w", wheelDir, "cores/python/packages/drsai"], repo);
  const name = readdirSync(wheelDir).filter((value) => value.endsWith(".whl")).sort().at(-1);
  if (!name) throw new Error("Runtime wheel build did not produce an artifact.");
  return join(wheelDir, name);
}

function prepareSignedArtifact(wheel) {
  const publisher = "opendrsai-temporary-external-host-acceptance";
  const keys = generateKeyPairSync("ed25519");
  const bytes = readFileSync(wheel);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const version = `external-smoke-${Date.now()}`;
  const payload = Buffer.from(`opendrsai-runtime-artifact-v1\n${version}\n${sha256}\n`, "utf8");
  const trustStore = join(temporaryRoot, "temporary-runtime-publishers.json");
  writeFileSync(trustStore, JSON.stringify({ [publisher]: keys.publicKey.export({ type: "spki", format: "pem" }) }));
  return { publisher, sha256, signature: sign(null, payload, keys.privateKey).toString("base64"), trustStore, version };
}

function compileRemoteWorkspace() {
  run(process.execPath, ["node_modules/esbuild/bin/esbuild", "src/main/remoteWorkspace.ts", "--bundle", "--platform=node", "--format=esm", "--outfile=.cache/remoteWorkspace-external-host.mjs"], desktop);
}

async function requestJson(url, token, init = {}) {
  const response = await fetch(url, { ...init, headers: { "X-OpenDrSai-Gateway-Token": token, "Content-Type": "application/json", ...init.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(`Runtime request failed (${response.status}): ${url}: ${JSON.stringify(body)}`);
  return body;
}

function verifyLongShell(access, cwd) {
  return new Promise((resolvePromise, reject) => {
    const socket = new WebSocket(`${access.baseUrl.replace(/^http/, "ws")}/v1/pty`);
    const timer = setTimeout(() => { socket.close(); reject(new Error("Remote long shell command timed out.")); }, 20_000);
    let ptyId = "";
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "auth", token: access.token }));
      socket.send(JSON.stringify({ type: "create", workspaceId: access.workspaceId, cwd, cols: 80, rows: 24 }));
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "created") {
        ptyId = message.id;
        socket.send(JSON.stringify({ type: "write", id: ptyId, data: "sleep 3; printf OPENDRSAI_EXTERNAL_LONG_TASK_OK\\n" }));
      }
      if (message.type === "data" && String(message.data).includes("OPENDRSAI_EXTERNAL_LONG_TASK_OK")) {
        socket.send(JSON.stringify({ type: "kill", id: ptyId }));
        clearTimeout(timer);
        socket.close();
        resolvePromise();
      }
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error("Remote shell WebSocket failed.")); };
  });
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
}

function runCapture(command, args, input) {
  const result = spawnSync(command, args, { cwd: desktop, input, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout || ""}`);
  return String(result.stdout || "").trim();
}

function waitForNoSshTunnels() {
  const config = String(process.env.OPENDRSAI_SSH_CONFIG || "").trim();
  const marker = (config || hostAlias).replace(/'/g, "''");
  const query = `@((Get-CimInstance Win32_Process | Where-Object { $line=[string]$_.CommandLine; $_.Name -like 'ssh*' -and $line.Contains('-N') -and $line.Contains('${marker}') })).Count`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", query], { encoding: "utf8", windowsHide: true });
    if (!result.error && result.status === 0 && Number(String(result.stdout || "").trim()) === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  return false;
}
