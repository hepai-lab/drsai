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
  "BatchMode=yes",
  "canonicalRemotePath",
  "startRemoteGateway",
  "openTunnel",
  "waitForGateway",
  "X-OpenDrSai-Gateway-Token",
  "scheduleReconnect",
  "MAX_RECONNECT_ATTEMPTS",
  "getRemoteGatewayAccess",
  "executeRemoteWorkspaceMutation",
  "listRemoteWorkspaceFiles",
  "previewRemoteWorkspaceFile",
  "listRemoteThreads",
  "listRemoteHepaiWorkers",
]) {
  assert(remoteWorkspace.includes(marker), `remote workspace implementation missing ${marker}`);
}

for (const marker of [
  "createRemoteWorkspace",
  'type: "remote-ssh"',
  'connectionState: "disconnected"',
  'workspace.type === "remote-ssh"',
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
  "Connect Remote SSH",
  "No hosts were found in the OpenSSH config.",
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
