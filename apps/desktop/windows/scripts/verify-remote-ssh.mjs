import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const cache = join(root, ".cache");
const fixture = join(root, "tests", "remote-ssh", "fixture.ps1");
const sshConfig = join(root, "tests", "remote-ssh", "ssh_config");
let cleanupStarted = false;
process.on("exit", () => {
  if (cleanupStarted) return;
  cleanupStarted = true;
  spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Action", "Down"], { cwd: root, windowsHide: true });
});
process.on("SIGINT", () => process.exit(130));
mkdirSync(cache, { recursive: true });
const artifactPublisher = "opendrsai-temporary-acceptance";
const artifactKeys = generateKeyPairSync("ed25519");
const trustStore = join(cache, "temporary-runtime-publishers.json");
writeFileSync(trustStore, JSON.stringify({ [artifactPublisher]: artifactKeys.publicKey.export({ type: "spki", format: "pem" }) }));
process.env.OPENDRSAI_RUNTIME_TRUST_STORE = trustStore;

run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Action", "Up"]);
run(process.execPath, ["node_modules/esbuild/bin/esbuild", "src/main/remoteWorkspace.ts", "--bundle", "--platform=node", "--format=esm", "--outfile=.cache/remoteWorkspace.mjs"], root);

process.env.OPENDRSAI_SSH_CONFIG = sshConfig;
process.env.DRSAI_HOME = join(cache, "remote-e2e-home");
process.env.OPENDRSAI_REMOTE_HOST_IDLE_MS = "250";
rmSync(process.env.DRSAI_HOME, { recursive: true, force: true });
const occupiedPort = createServer();
await new Promise((resolveListen, rejectListen) => occupiedPort.once("error", rejectListen).listen(18643, "127.0.0.1", resolveListen));
occupiedPort.unref();

const modulePath = pathToFileURL(join(cache, "remoteWorkspace.mjs")).href;
const remote = await import(modulePath + "?t=" + Date.now());
const remotePeer = await import(modulePath + "?peer=" + Date.now());
run("docker", ["cp", resolve(root, "../../../cores/python/packages/drsai/src/drsai/backend/remote_ssh/pty.py"), "opendrsai-remote-ssh-fixture:/tmp/remote_pty.py"]);
const ptyProbe = `import asyncio,importlib.util,pathlib,sys
s=importlib.util.spec_from_file_location("rp","/tmp/remote_pty.py")
m=importlib.util.module_from_spec(s);sys.modules["rp"]=m;s.loader.exec_module(m)
async def test():
 x=m.manager.create("w",pathlib.Path("/home/vscode/workspace"),pathlib.Path("/home/vscode/workspace"),80,24)
 m.manager.write(x.id,"printf PTY_OK\\nexit\\n")
 for _ in range(50):
  if b"PTY_OK" in x.buffer:return
  await asyncio.sleep(.1)
 raise RuntimeError("PTY output missing")
asyncio.run(test())`;
run("docker", ["exec", "opendrsai-remote-ssh-fixture", "python3", "-c", ptyProbe]);
const hosts = await remote.listSshHosts();
const fixtureHost = hosts.find((host) => host.alias === "opendrsai-fixture");
const fixtureHostTwo = hosts.find((host) => host.alias === "opendrsai-fixture-two");
const metadataHost = hosts.find((host) => host.alias === "opendrsai-metadata");
assert(hosts.length === 8 && !hosts.some((host) => host.alias.includes("*")), "Include discovery or wildcard Host filtering failed: " + JSON.stringify(hosts));
assert(fixtureHost?.hostname === "127.0.0.1" && fixtureHost.user === "vscode" && fixtureHost.port === 22222 && fixtureHost.identityFiles.some((path) => path.includes("fixture_key")), "ssh -G fixture resolution failed: " + JSON.stringify(fixtureHost));
assert(fixtureHostTwo?.hostname === "127.0.0.1" && fixtureHostTwo.user === "vscode" && fixtureHostTwo.port === 22223, "second SSH fixture resolution failed: " + JSON.stringify(fixtureHostTwo));
assert(metadataHost?.hostname === "remote.metadata.example" && metadataHost.user === "metadata-user" && metadataHost.port === 2200 && metadataHost.proxyJump === "jump.example" && metadataHost.identityFiles.some((path) => path.includes("fixture_key")), "ssh -G metadata resolution failed: " + JSON.stringify(metadataHost));
assert(await remote.testSshHost("opendrsai-fixture"), "SSH connection test failed");
assert((await remote.diagnoseSshHost("opendrsai-fixture")).state === "reachable", "reachable SSH diagnostic failed");
const authFailure = await remote.diagnoseSshHost("opendrsai-auth-failure", 3000);
assert(authFailure.state === "authentication_failed", "authentication failure was not classified");
assert(/system ssh-agent|hardware security key|interactively/.test(authFailure.remediation || ""), "interactive authentication failure lacks actionable remediation");
assert((await remote.diagnoseSshHost("opendrsai-hostkey-failure", 3000)).state === "host_key_failed", "host-key failure was not classified");
const scannedHostKeys = await remote.inspectSshHostKeys("opendrsai-hostkey-failure");
assert(scannedHostKeys.length > 0 && scannedHostKeys.every((key) => key.fingerprint.startsWith("SHA256:") && key.hostname === "127.0.0.1" && key.port === 22222), "host-key fingerprints were not produced");
assert(await remote.approveSshHostKey("opendrsai-hostkey-failure"), "approved new host key was not written through OpenSSH");
assert((await remote.diagnoseSshHost("opendrsai-hostkey-failure", 3000)).state === "reachable", "approved host key was not reused from known_hosts");
assert((await remote.diagnoseSshHost("opendrsai-refused", 3000)).state === "unreachable", "connection refusal was not classified");
assert((await remote.diagnoseSshHost("opendrsai-dns-failure", 3000)).state === "dns_failed", "DNS failure was not classified");
assert((await remote.diagnoseSshHost("opendrsai-timeout", 750)).state === "timeout", "connection timeout was not classified");
const wheelOne = createFixtureWheel("1.0.0");
const wheelTwo = createFixtureWheel("1.0.1");
const incompatibleWheel = createFixtureWheel("2.0.0", 999);
const preflight = await remote.preflightRemoteGateway("opendrsai-fixture");
assert(preflight.operatingSystem === "Linux" && preflight.architecture && preflight.compatible && preflight.issues.length === 0 && /^3\./.test(preflight.pythonVersion), "Remote Runtime compatibility preflight failed: " + JSON.stringify(preflight));
const installed = await remote.installRemoteGateway(signedArtifactRequest({ hostAlias: "opendrsai-fixture", action: "install", version: "1.0.0", artifactPath: wheelOne }));
assert(installed.gatewayVersion === "1.0.0", "Desktop-uploaded Gateway install failed");
const installedTwo = await remote.installRemoteGateway(signedArtifactRequest({ hostAlias: "opendrsai-fixture-two", action: "install", version: "1.0.0", artifactPath: wheelOne }));
assert(installedTwo.gatewayVersion === "1.0.0", "second host Gateway install failed");
const upgraded = await remote.installRemoteGateway(signedArtifactRequest({ hostAlias: "opendrsai-fixture", action: "upgrade", version: "1.0.1", artifactPath: wheelTwo }));
assert(upgraded.gatewayVersion === "1.0.1" && upgraded.previousRelease === "1.0.0", "Gateway upgrade did not preserve previous release");
run("ssh.exe", ["-F", sshConfig, "opendrsai-fixture", "test -x ~/.local/share/opendrsai/remote/releases/1.0.0/bin/python -a -x ~/.local/share/opendrsai/remote/releases/1.0.1/bin/python"]);
const cancelledUpgrade = remote.installRemoteGateway(signedArtifactRequest({ hostAlias: "opendrsai-fixture", action: "upgrade", version: "1.0.2", artifactPath: wheelTwo }));
assert(remote.cancelRemoteGatewayOperation("opendrsai-fixture"), "active Gateway operation could not be cancelled");
await assertRejects(() => cancelledUpgrade, "cancelled Gateway upgrade unexpectedly completed");
assert((await remote.preflightRemoteGateway("opendrsai-fixture")).gatewayVersion === "1.0.1", "cancelled upgrade damaged current release");
await assertRejects(() => remote.installRemoteGateway(signedArtifactRequest({ hostAlias: "opendrsai-fixture", action: "upgrade", version: "2.0.0", artifactPath: incompatibleWheel })), "incompatible Gateway protocol was accepted");
assert((await remote.preflightRemoteGateway("opendrsai-fixture")).gatewayVersion === "1.0.1", "failed incompatible upgrade damaged current release");
await assertRejects(() => remote.installRemoteGateway(signedArtifactRequest({ hostAlias: "opendrsai-fixture", action: "upgrade", version: "2.0.1", artifactPath: wheelTwo, artifactSha256: "0".repeat(64) })), "corrupt artifact digest was accepted");
assert((await remote.preflightRemoteGateway("opendrsai-fixture")).gatewayVersion === "1.0.1", "failed digest validation damaged current release");
const rolledBack = await remote.installRemoteGateway({ hostAlias: "opendrsai-fixture", action: "rollback" });
assert(rolledBack.gatewayVersion === "1.0.0", "Gateway rollback failed");
const concurrentWheelA = createFixtureWheel("1.0.3");
const concurrentWheelB = createFixtureWheel("1.0.4");
const concurrent = await Promise.allSettled([
  remote.installRemoteGateway(signedArtifactRequest({ hostAlias: "opendrsai-fixture", action: "upgrade", version: "1.0.3", artifactPath: concurrentWheelA })),
  remotePeer.installRemoteGateway(signedArtifactRequest({ hostAlias: "opendrsai-fixture", action: "upgrade", version: "1.0.4", artifactPath: concurrentWheelB })),
]);
assert(concurrent.filter((result) => result.status === "fulfilled").length === 1, "concurrent Runtime install lock allowed zero or multiple transactions");
const concurrentPreflight = await remote.preflightRemoteGateway("opendrsai-fixture");
assert(["1.0.3", "1.0.4"].includes(concurrentPreflight.currentRelease), "concurrent Runtime install left an invalid current release");
const directories = await remote.listRemoteDirectories("opendrsai-fixture", "/home/vscode");
assert(directories.some((entry) => entry.name === "workspace"), "directory discovery failed: " + JSON.stringify(directories));
const symlinkDirectories = await remote.listRemoteDirectories("opendrsai-fixture", "/home/vscode/workspace-link");
assert(symlinkDirectories.some((entry) => entry.name === "nested" && entry.path === "/home/vscode/workspace/nested"), "symlink directory was not canonicalized: " + JSON.stringify(symlinkDirectories));
await assertRejects(() => remote.listRemoteDirectories("opendrsai-fixture", "/home/vscode/workspace/remote.txt"), "file path was accepted as a directory");
await assertRejects(() => remote.listRemoteDirectories("opendrsai-fixture", "/home/vscode/missing"), "missing directory was accepted");
await assertRejects(() => remote.listRemoteDirectories("opendrsai-fixture", "/home/vscode/restricted"), "unreadable directory was accepted");
const [workspace, coalescedWorkspace] = await Promise.all([
  remote.connectRemoteWorkspace({ hostAlias: "opendrsai-fixture", path: "/home/vscode/workspace", trusted: true }),
  remote.connectRemoteWorkspace({ hostAlias: "opendrsai-fixture", path: "/home/vscode/workspace", trusted: true }),
]);
assert(coalescedWorkspace.id === workspace.id, "concurrent connection requests for one canonical workspace were not coalesced");
const status = await remote.getRemoteWorkspaceStatus(workspace.id);
assert(workspace.type === "remote-ssh" && status.connected && status.gatewayReady, "connect failed: " + JSON.stringify({workspace,status}));
assert(status.localPort !== 18643, "SSH tunnel reused an occupied local port");
await new Promise((resolveClose) => occupiedPort.close(resolveClose));
const initialAccess = remote.getRemoteGatewayAccess(workspace.path);
assert(initialAccess, "Runtime access was not created");
const wrongToken = await fetch(`${initialAccess.baseUrl}/health`, { headers: { "X-OpenDrSai-Gateway-Token": "wrong-temporary-token" } });
assert(wrongToken.status === 401, "Runtime accepted an invalid instance token");
const loopbackProbe = "import pathlib; rows=pathlib.Path('/proc/net/tcp').read_text().splitlines()[1:]; assert any(r.split()[1].endswith(':48D2') and r.split()[1].startswith('0100007F:') for r in rows); assert not any(r.split()[1]=='00000000:48D2' for r in rows)";
run("ssh.exe", ["-F", sshConfig, "opendrsai-fixture", `python3 -c ${JSON.stringify(loopbackProbe)}`]);
const workspaceTwo = await remote.connectRemoteWorkspace({ hostAlias: "opendrsai-fixture", path: "/home/vscode/workspace-two", trusted: true });
const statusTwo = await remote.getRemoteWorkspaceStatus(workspaceTwo.id);
assert(statusTwo.connected && status.localPort === statusTwo.localPort, "same-host workspaces did not reuse one tunnel");
const reusePaths = Array.from({ length: 8 }, (_, index) => `/home/vscode/workspace-reuse-${index + 3}`);
run("ssh.exe", ["-F", sshConfig, "opendrsai-fixture", "mkdir", "-p", ...reusePaths]);
const reusedWorkspaces = [];
for (const path of reusePaths) {
  const reused = await remote.connectRemoteWorkspace({ hostAlias: "opendrsai-fixture", path, trusted: true });
  const reusedStatus = await remote.getRemoteWorkspaceStatus(reused.id);
  assert(reusedStatus.connected && reusedStatus.localPort === status.localPort, `10-Workspace Host tunnel reuse failed for ${path}`);
  reusedWorkspaces.push(reused);
}
assert(new Set([workspace.id, workspaceTwo.id, ...reusedWorkspaces.map((item) => item.id)]).size === 10, "10 same-Host Workspaces did not retain independent Workspace IDs");
run("docker", ["exec", "-d", "opendrsai-remote-ssh-fixture", "python3", "-m", "http.server", "18081", "--bind", "127.0.0.1", "--directory", "/home/vscode/workspace"]);
const forwardAuthorization = { permissionGranted: true, approvalId: "approval-forward-e2e", correlationId: "corr-forward-e2e", operationId: "operation-forward-e2e" };
await assertRejects(() => remote.createPortForward({ hostAlias: "opendrsai-fixture", workspaceId: workspace.id, remotePort: 18081, bindAddress: "0.0.0.0", authorization: forwardAuthorization }), "non-loopback Port Forward bypassed explicit approval");
const forward = await remote.createPortForward({ hostAlias: "opendrsai-fixture", workspaceId: workspace.id, remotePort: 18081, authorization: forwardAuthorization });
assert(forward.bindAddress === "127.0.0.1" && forward.status === "active", "Port Forward was not loopback-active");
assert((await waitHttp(`http://127.0.0.1:${forward.localPort}/remote.txt`)).includes("remote fixture"), "real TCP Port Forward did not reach the remote HTTP service");
assert((await remote.pausePortForward(forward.portForwardId)).status === "paused", "Port Forward pause failed");
assert((await remote.resumePortForward(forward.portForwardId)).status === "active", "Port Forward resume failed");
run("ssh.exe", ["-F", sshConfig, "opendrsai-fixture", "python3 -c \"import os,pathlib; os.kill(int((pathlib.Path.home()/'.local/share/opendrsai/remote/gateway.pid').read_text()),15)\""]);
let runtimeFailureSeen = false; let runtimeRecovered = false;
for (let attempt = 0; attempt < 100; attempt += 1) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  const current = await remote.getRemoteWorkspaceStatus(workspace.id);
  runtimeFailureSeen ||= current.failureKind === "runtime";
  if (runtimeFailureSeen && current.connected && current.gatewayReady) { runtimeRecovered = true; break; }
}
assert(runtimeFailureSeen && runtimeRecovered, "Runtime-only failure was not distinguished from SSH or did not recover");
assert((await remote.getRemoteWorkspaceStatus(workspaceTwo.id)).connected, "Runtime recovery did not restore every Workspace association");
const threads = await remote.listRemoteThreads(workspace.id);
assert(Array.isArray(threads), "remote thread listing failed");
const files = await remote.listRemoteWorkspaceFiles({ workspacePath: workspace.path, maxDepth: 2 });
assert(files.nodes.some((entry) => entry.relativePath === "remote.txt"), "remote file tree failed");
const preview = await remote.previewRemoteWorkspaceFile({ workspacePath: workspace.path, path: workspace.path + "/remote.txt" });
assert(preview.content === "remote fixture\n", "remote file preview failed");
run("ssh.exe", ["-F", sshConfig, "opendrsai-fixture-two", "printf 'second host fixture\\n' > /home/vscode/workspace/remote.txt"]);
const crossHostWorkspace = await remote.connectRemoteWorkspace({ hostAlias: "opendrsai-fixture-two", path: "/home/vscode/workspace", trusted: true });
const crossHostStatus = await remote.getRemoteWorkspaceStatus(crossHostWorkspace.id);
assert(crossHostStatus.connected && crossHostStatus.runtimeId !== status.runtimeId && crossHostStatus.localPort !== status.localPort && crossHostWorkspace.id !== workspace.id, "same-path workspaces on two hosts did not retain independent Runtime/Workspace/tunnel identities");
assert(remote.getRemoteGatewayAccess(workspace.path) === null, "ambiguous cross-host path silently selected a Runtime instead of failing closed");
const primaryById = await remote.previewRemoteWorkspaceFile({ workspacePath: workspace.path, workspaceId: workspace.id, path: workspace.path + "/remote.txt" });
const secondaryById = await remote.previewRemoteWorkspaceFile({ workspacePath: crossHostWorkspace.path, workspaceId: crossHostWorkspace.id, path: crossHostWorkspace.path + "/remote.txt" });
assert(primaryById.content === "remote fixture\n" && secondaryById.content === "second host fixture\n", "authoritative workspace_id routing crossed two hosts with the same canonical path");
const workers = await remote.listRemoteHepaiWorkers(workspace.id);
assert(workers[0]?.id === "fixture-worker", "HepAI worker discovery failed");
run("docker", ["restart", "opendrsai-remote-ssh-fixture"]);
let recovered = false; let sshFailureSeen = false;
for (let attempt = 0; attempt < 50; attempt += 1) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  const current = await remote.getRemoteWorkspaceStatus(workspaceTwo.id);
  sshFailureSeen ||= current.failureKind === "ssh";
  if (current.connected && current.gatewayReady) {
    try { await remote.listRemoteThreads(workspaceTwo.id); recovered = true; break; } catch { /* tunnel has not recovered yet */ }
  }
}
assert(sshFailureSeen && recovered, "SSH failure was not distinguished or shared host connection did not recover after remote restart");
run("docker", ["exec", "-d", "opendrsai-remote-ssh-fixture", "python3", "-m", "http.server", "18081", "--bind", "127.0.0.1", "--directory", "/home/vscode/workspace"]);
const recoveredForward = (await remote.listPortForwards({ workspaceId: workspace.id })).find((item) => item.portForwardId === forward.portForwardId);
assert(recoveredForward?.status === "active", "Port Forward Registry did not restore after SSH reconnect");
assert((await waitHttp(`http://127.0.0.1:${recoveredForward.localPort}/remote.txt`)).includes("remote fixture"), "restored Port Forward did not reach the restarted remote service");
assert(await remote.removePortForward(forward.portForwardId), "Port Forward remove failed");
assert(remote.getRemoteSshDiagnosticReport().hosts[0]?.events.some((event) => event.phase === "runtime.instance-changed"), "Runtime instance restart was not detected and recorded");
const recoveredAccess = remote.getRemoteGatewayAccess(workspace.id);
assert(recoveredAccess && recoveredAccess.token !== initialAccess.token, "Runtime restart did not rotate its temporary instance token");
assert((await remote.getRemoteWorkspaceStatus(crossHostWorkspace.id)).connected, "restarting the first host affected the independent second host");
assert(await remote.disconnectRemoteWorkspace(workspace.id), "disconnect failed");
assert((await remote.getRemoteWorkspaceStatus(workspaceTwo.id)).connected, "disconnecting one workspace closed the shared host connection");
for (const reused of reusedWorkspaces) assert(await remote.disconnectRemoteWorkspace(reused.id), `reused Workspace disconnect failed: ${reused.id}`);
assert(await remote.disconnectRemoteWorkspace(workspaceTwo.id), "second disconnect failed");
const fastReconnect = await remote.connectRemoteWorkspace({ hostAlias: "opendrsai-fixture", path: "/home/vscode/workspace", trusted: true });
assert(fastReconnect.remote?.localPort === Number(new URL(recoveredAccess.baseUrl).port), "idle HostConnection was not reused for an immediate Workspace reconnect");
assert(await remote.disconnectRemoteWorkspace(fastReconnect.id), "fast reconnect disconnect failed");
assert(await remote.disconnectRemoteWorkspace(crossHostWorkspace.id), "cross-host workspace disconnect failed");
await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
assert(remote.getRemoteGatewayAccess(workspace.path) === null && remote.getRemoteGatewayAccess(workspaceTwo.path) === null, "last Workspace close retained Runtime access or token references");
assert(remote.getRemoteSshDiagnosticReport().hosts.length === 0, "last Workspace close retained HostConnection timers or state");
const tunnelProcesses = capture("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'ssh*' -and $_.CommandLine -like '*127.0.0.1:${status.localPort}:127.0.0.1*' }).Count`]).trim();
assert(tunnelProcesses === "0", "last Workspace close left an orphan SSH tunnel process");
run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Action", "Down"]);
cleanupStarted = true;
assert(!existsSync(join(root, "tests", "remote-ssh", "fixture_key")) && !existsSync(join(root, "tests", "remote-ssh", "authorized_keys")) && !existsSync(join(root, "tests", "remote-ssh", "known_hosts_fixture")), "temporary SSH credentials or host records were not deleted");
console.log("Remote SSH E2E passed: discovery, shared host Gateway, same-path cross-host isolation, remote restart recovery, registration replay, files, HepAI discovery, reference-safe disconnect.");

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(command + " failed with exit code " + result.status);
}
function capture(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(command + " failed with exit code " + result.status + ": " + result.stderr);
  return result.stdout;
}
function assert(value, message) {
  if (!value) throw new Error(message);
}
async function waitHttp(url) {
  let last;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response.text();
      last = new Error(`HTTP ${response.status}`);
    } catch (error) { last = error; }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw last || new Error("HTTP Port Forward did not become ready");
}
async function assertRejects(operation, message) {
  try { await operation(); } catch { return; }
  throw new Error(message);
}
function createFixtureWheel(version, protocolVersion = 1) {
  const output = join(cache, `drsai-${version}-py3-none-any.whl`);
  const source = join(root, "tests", "remote-ssh", "fixture_drsai");
  const code = `import pathlib,sys,zipfile\nsource=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2]);version=sys.argv[3];protocol=sys.argv[4]\nwith zipfile.ZipFile(out,'w') as z:\n for p in source.rglob('*.py'):\n  data=p.read_text();data=data.replace('_REMOTE_PROTOCOL_VERSION = 1','_REMOTE_PROTOCOL_VERSION = '+protocol)\n  z.writestr(p.relative_to(source).as_posix(),data)\n info='drsai-'+version+'.dist-info'\n z.writestr(info+'/METADATA','Metadata-Version: 2.1\\nName: drsai\\nVersion: '+version+'\\n')\n z.writestr(info+'/WHEEL','Wheel-Version: 1.0\\nGenerator: opendrsai-e2e\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')\n z.writestr(info+'/RECORD','')`;
  run("python", ["-c", code, source, output, version, String(protocolVersion)]);
  return output;
}
function signedArtifactRequest(request) {
  const artifact = readFileSync(request.artifactPath);
  const sha256 = createHash("sha256").update(artifact).digest("hex");
  const payload = Buffer.from(`opendrsai-runtime-artifact-v1\n${request.version}\n${sha256}\n`, "utf8");
  return { ...request, artifactPublisher, artifactSignature: sign(null, payload, artifactKeys.privateKey).toString("base64") };
}
