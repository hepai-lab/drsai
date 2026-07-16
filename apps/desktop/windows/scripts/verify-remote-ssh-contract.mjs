import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Remote SSH contract verification failed: ${message}`);
    process.exit(1);
  }
}

const packageJson = read("package.json");
const sharedApi = read("src/shared/desktopApi.ts");
const main = read("src/main/index.ts");
const remoteWorkspace = read("src/main/remoteWorkspace.ts");
const realRemoteGateway = read("scripts/verify-real-remote-gateway.mjs");
const runtimeReliability = read("src/main/runtimeReliability.ts");
const workspaces = read("src/main/workspaces.ts");
const terminal = read("src/main/terminal.ts");
const preload = read("src/preload/index.ts");
const app = read("src/renderer/src/App.tsx");
const terminalPanel = read("src/renderer/src/components/TerminalPanel.tsx");
const mock = read("src/renderer/src/mockDesktopApi.ts");
const checklist = read("docs/chatbar-capability-checklist.md");
const roadmap = read("docs/smart-chat-bar-roadmap.md");

assert(
  JSON.parse(packageJson).scripts?.["verify:remote-ssh-contract"]?.includes("scripts/verify-remote-ssh-contract.mjs"),
  "package script is not registered",
);

for (const marker of [
  "RemoteSshHost",
  "RemoteWorkspaceConnectionState",
  "RemoteSshWorkspaceDescriptor",
  "ConnectRemoteWorkspaceRequest",
  "RemoteWorkspaceStatus",
  "RemoteGatewayPreflight",
  "RemoteGatewayInstallRequest",
  "RemoteHepaiWorker",
  'type: "local" | "remote-ssh"',
  "remote?: RemoteSshWorkspaceDescriptor",
  "remoteHostAlias?: string",
]) {
  assert(sharedApi.includes(marker), `shared desktop API missing ${marker}`);
}

for (const marker of [
  "listSshHosts",
  "testSshHost",
  "listRemoteDirectories",
  "connectRemoteWorkspace",
  "disconnectRemoteWorkspace",
  "getRemoteWorkspaceStatus",
  "preflightRemoteGateway",
  "installRemoteGateway",
  "listRemoteHepaiWorkers",
]) {
  assert(sharedApi.includes(`${marker}(`), `DesktopApi missing ${marker}`);
  assert(preload.includes(`desktop:${remoteIpcName(marker)}`) || preload.includes(marker), `preload bridge missing ${marker}`);
}

for (const marker of [
  '"desktop:ssh-hosts"',
  '"desktop:ssh-test"',
  '"desktop:ssh-directories"',
  '"desktop:remote-workspace-connect"',
  '"desktop:remote-workspace-disconnect"',
  '"desktop:remote-workspace-status"',
  '"desktop:remote-workspace-threads"',
  '"desktop:remote-hepai-workers"',
  '"desktop:remote-gateway-preflight"',
  '"desktop:remote-gateway-install"',
  "getRemoteGatewayAccess(request?.workspacePath)",
  "listRemoteWorkspaceFiles(request)",
  "previewRemoteWorkspaceFile(request)",
  "getRemoteWorkspaceGitDiff(request)",
  "executeRemoteWorkspaceMutation(action, request)",
  "stopAllRemoteWorkspaces()",
]) {
  assert(main.includes(marker), `main process remote bridge missing ${marker}`);
}

for (const marker of [
  "assertAlias",
  "sshConfigArgs",
  "remotePythonCommand",
  "OPENDRSAI_REMOTE_PYTHON",
  "Remote Python path must be an absolute POSIX path without shell metacharacters.",
  "BatchMode=yes",
  "canonicalRemotePath",
  "startRemoteGateway",
  "openTunnel",
  "waitForGateway",
  "X-OpenDrSai-Gateway-Token",
  "scheduleReconnect",
  "ReconnectBackoff",
  "RuntimeInstanceTracker",
  "classifyRemoteFailure",
  "getRemoteGatewayAccess",
  "executeRemoteWorkspaceMutation",
  "listRemoteWorkspaceFiles",
  "previewRemoteWorkspaceFile",
  "listRemoteThreads",
  "listRemoteHepaiWorkers",
]) {
  assert(remoteWorkspace.includes(marker), `remote workspace implementation missing ${marker}`);
}

assert(remoteWorkspace.includes('if py<(3,11): issues.append("Python 3.11 or newer is required")'), "remote preflight does not enforce the package Python 3.11 minimum");
assert(remoteWorkspace.includes('[sys.executable,"-m","venv",str(staging)]'), "remote Runtime does not create an isolated candidate venv");
assert(!remoteWorkspace.includes('"--system-site-packages"'), "remote Runtime candidate inherits system packages");
assert(!remoteWorkspace.includes('"--no-deps",str(artifact)'), "remote Runtime skips declared dependencies in a clean environment");
assert(realRemoteGateway.includes("hasActiveStabilityRun()"), "real Gateway E2E does not protect an active formal stability container");
assert(realRemoteGateway.includes("cannot reuse its container and SSH port"), "real Gateway E2E active-stability refusal is not actionable");
const stabilityVerifier = read("scripts/verify-remote-stability-evidence.mjs");
assert(stabilityVerifier.includes("stability state is not bound to a Docker container ID"), "stability monitor does not require a bound container ID");
assert(stabilityVerifier.includes("live SSH tunnel count"), "stability monitor does not inspect the live SSH tunnel");
assert(stabilityVerifier.includes("inspectDockerContainer"), "stability monitor does not inspect the live Docker container");

for (const marker of [
  "baseDelayMs ?? 1_000",
  "maxDelayMs ?? 30_000",
  "maxWindowMs ?? 180_000",
  "RuntimeEventAccumulator",
]) {
  assert(runtimeReliability.includes(marker), `runtime reliability implementation missing ${marker}`);
}

for (const marker of [
  "createRemoteWorkspace",
  'location: "remote"',
  'transport: "ssh"',
  'type: "remote-ssh"',
  'connectionState: "disconnected"',
  'workspace.location === "remote"',
]) {
  assert(workspaces.includes(marker), `workspace persistence missing ${marker}`);
}

for (const marker of [
  "remoteHostAlias?: string",
  "getRemoteGatewayAccess",
  "new WebSocket",
  'type: "create"',
  'type: "attach"',
  "scheduleRemoteTerminalReattach",
]) {
  assert(terminal.includes(marker), `terminal remote session support missing ${marker}`);
}

for (const marker of [
  "listSshHosts",
  "testSshHost",
  "connectRemoteWorkspace",
  "listRemoteThreads",
  "disconnectRemoteWorkspace",
  "remoteHostAlias={activeWorkspace.remote?.hostAlias}",
  "Step 1 of 2: Choose a computer",
  "Step 2 of 2: Choose a directory",
  "Open remote workspace",
  "No configured remote computers were found.",
]) {
  assert(app.includes(marker), `renderer remote workspace UI missing ${marker}`);
}

assert(
  terminalPanel.includes("remoteHostAlias") &&
    terminalPanel.includes("createTerminal({") &&
    terminalPanel.includes("remoteHostAlias,"),
  "terminal panel does not pass remote host alias into terminal creation",
);

for (const marker of [
  "listSshHosts",
  "connectRemoteWorkspace",
  'type: "remote-ssh"',
  'connectionState: "connected"',
  "getRemoteWorkspaceStatus",
  "preflightRemoteGateway",
  "installRemoteGateway",
]) {
  assert(mock.includes(marker), `mock desktop API missing ${marker}`);
}

for (const marker of [
  "remote-ssh-contract-agent",
  "Remote SSH Workspace Contract Verification",
  "verify:remote-ssh-contract",
  "no SSH process, tunnel, remote gateway, package install, network call, credential lookup, provider send, or workspace mutation",
]) {
  assert(checklist.includes(marker), `checklist evidence missing ${marker}`);
}

assert(
  roadmap.includes("Remote SSH workspace contract verification") &&
    roadmap.includes("verify:remote-ssh-contract"),
  "roadmap evidence missing remote SSH contract verification",
);

console.log("Remote SSH contract verification passed.");

function remoteIpcName(apiName) {
  return {
    listSshHosts: "ssh-hosts",
    testSshHost: "ssh-test",
    listRemoteDirectories: "ssh-directories",
    connectRemoteWorkspace: "remote-workspace-connect",
    disconnectRemoteWorkspace: "remote-workspace-disconnect",
    getRemoteWorkspaceStatus: "remote-workspace-status",
    preflightRemoteGateway: "remote-gateway-preflight",
    installRemoteGateway: "remote-gateway-install",
    listRemoteHepaiWorkers: "remote-hepai-workers",
  }[apiName];
}
