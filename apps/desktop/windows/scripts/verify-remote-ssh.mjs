import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const cache = join(root, ".cache");
const fixture = join(root, "tests", "remote-ssh", "fixture.ps1");
const sshConfig = join(root, "tests", "remote-ssh", "ssh_config");
mkdirSync(cache, { recursive: true });

run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Action", "Up"]);
run(process.execPath, ["node_modules/esbuild/bin/esbuild", "src/main/remoteWorkspace.ts", "--bundle", "--platform=node", "--format=esm", "--outfile=.cache/remoteWorkspace.mjs"], root);

process.env.OPENDRSAI_SSH_CONFIG = sshConfig;
process.env.DRSAI_HOME = join(cache, "remote-e2e-home");
rmSync(process.env.DRSAI_HOME, { recursive: true, force: true });

const modulePath = pathToFileURL(join(cache, "remoteWorkspace.mjs")).href;
const remote = await import(modulePath + "?t=" + Date.now());
run("docker", ["cp", resolve(root, "../../../cores/python/packages/drsai/src/drsai/backend/remote_pty.py"), "opendrsai-remote-ssh-fixture:/tmp/remote_pty.py"]);
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
assert(hosts.length === 1 && hosts[0].alias === "opendrsai-fixture" && hosts[0].port === 22222, "host discovery failed: " + JSON.stringify(hosts));
assert(await remote.testSshHost("opendrsai-fixture"), "SSH connection test failed");
const wheelOne = createFixtureWheel("1.0.0");
const wheelTwo = createFixtureWheel("1.0.1");
const incompatibleWheel = createFixtureWheel("2.0.0", 999);
const installed = await remote.installRemoteGateway({ hostAlias: "opendrsai-fixture", action: "install", version: "1.0.0", artifactPath: wheelOne });
assert(installed.gatewayVersion === "1.0.0", "Desktop-uploaded Gateway install failed");
const upgraded = await remote.installRemoteGateway({ hostAlias: "opendrsai-fixture", action: "upgrade", version: "1.0.1", artifactPath: wheelTwo });
assert(upgraded.gatewayVersion === "1.0.1" && upgraded.previousRelease === "1.0.0", "Gateway upgrade did not preserve previous release");
const cancelledUpgrade = remote.installRemoteGateway({ hostAlias: "opendrsai-fixture", action: "upgrade", version: "1.0.2", artifactPath: wheelTwo });
assert(remote.cancelRemoteGatewayOperation("opendrsai-fixture"), "active Gateway operation could not be cancelled");
await assertRejects(() => cancelledUpgrade, "cancelled Gateway upgrade unexpectedly completed");
assert((await remote.preflightRemoteGateway("opendrsai-fixture")).gatewayVersion === "1.0.1", "cancelled upgrade damaged current release");
await assertRejects(() => remote.installRemoteGateway({ hostAlias: "opendrsai-fixture", action: "upgrade", version: "2.0.0", artifactPath: incompatibleWheel }), "incompatible Gateway protocol was accepted");
assert((await remote.preflightRemoteGateway("opendrsai-fixture")).gatewayVersion === "1.0.1", "failed incompatible upgrade damaged current release");
await assertRejects(() => remote.installRemoteGateway({ hostAlias: "opendrsai-fixture", action: "upgrade", version: "2.0.1", artifactPath: wheelTwo, artifactSha256: "0".repeat(64) }), "corrupt artifact digest was accepted");
assert((await remote.preflightRemoteGateway("opendrsai-fixture")).gatewayVersion === "1.0.1", "failed digest validation damaged current release");
const rolledBack = await remote.installRemoteGateway({ hostAlias: "opendrsai-fixture", action: "rollback" });
assert(rolledBack.gatewayVersion === "1.0.0", "Gateway rollback failed");
const directories = await remote.listRemoteDirectories("opendrsai-fixture", "/home/vscode");
assert(directories.some((entry) => entry.name === "workspace"), "directory discovery failed: " + JSON.stringify(directories));
const workspace = await remote.connectRemoteWorkspace({ hostAlias: "opendrsai-fixture", path: "/home/vscode/workspace", trusted: true });
const status = await remote.getRemoteWorkspaceStatus(workspace.id);
assert(workspace.type === "remote-ssh" && status.connected && status.gatewayReady, "connect failed: " + JSON.stringify({workspace,status}));
const workspaceTwo = await remote.connectRemoteWorkspace({ hostAlias: "opendrsai-fixture", path: "/home/vscode/workspace-two", trusted: true });
const statusTwo = await remote.getRemoteWorkspaceStatus(workspaceTwo.id);
assert(statusTwo.connected && status.localPort === statusTwo.localPort, "same-host workspaces did not reuse one tunnel");
const threads = await remote.listRemoteThreads(workspace.id);
assert(Array.isArray(threads), "remote thread listing failed");
const files = await remote.listRemoteWorkspaceFiles({ workspacePath: workspace.path, maxDepth: 2 });
assert(files.nodes.some((entry) => entry.relativePath === "remote.txt"), "remote file tree failed");
const preview = await remote.previewRemoteWorkspaceFile({ workspacePath: workspace.path, path: workspace.path + "/remote.txt" });
assert(preview.content === "remote fixture\n", "remote file preview failed");
const workers = await remote.listRemoteHepaiWorkers(workspace.id);
assert(workers[0]?.id === "fixture-worker", "HepAI worker discovery failed");
run("docker", ["restart", "opendrsai-remote-ssh-fixture"]);
let recovered = false;
for (let attempt = 0; attempt < 50; attempt += 1) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  const current = await remote.getRemoteWorkspaceStatus(workspaceTwo.id);
  if (current.connected && current.gatewayReady) {
    try { await remote.listRemoteThreads(workspaceTwo.id); recovered = true; break; } catch { /* tunnel has not recovered yet */ }
  }
}
assert(recovered, "shared host connection did not recover after remote restart");
assert(await remote.disconnectRemoteWorkspace(workspace.id), "disconnect failed");
assert((await remote.getRemoteWorkspaceStatus(workspaceTwo.id)).connected, "disconnecting one workspace closed the shared host connection");
assert(await remote.disconnectRemoteWorkspace(workspaceTwo.id), "second disconnect failed");
console.log("Remote SSH E2E passed: discovery, shared host Gateway, two workspaces, remote restart recovery, registration replay, files, HepAI discovery, reference-safe disconnect.");

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(command + " failed with exit code " + result.status);
}
function assert(value, message) {
  if (!value) throw new Error(message);
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
