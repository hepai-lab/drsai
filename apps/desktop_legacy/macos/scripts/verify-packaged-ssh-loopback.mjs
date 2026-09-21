import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, connect as connectTcp } from "node:net";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("Packaged OpenSSH verification requires macOS.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = join(root, "release", "mac-arm64", "OpenDrSai.app", "Contents", "MacOS", "OpenDrSai");
assert.ok(existsSync(executable), "Build the unsigned packaged App before running verify:packaged-ssh-loopback.");
const temp = mkdtempSync("/private/tmp/odssh-packaged-");
const home = join(temp, "home");
const desktop = join(home, "desktop");
const hostKey = join(temp, "host_ed25519");
const clientKey = join(temp, "client_ed25519");
const authorizedKeys = join(temp, "authorized_keys");
const knownHosts = join(desktop, "ssh", "known_hosts");
const clientConfig = join(temp, "ssh_config");
const serverConfig = join(temp, "sshd_config");
const resultPath = join(temp, "result.json");
const remoteHome = join(temp, "remote-home");
const remoteWorkspace = join(remoteHome, "workspace");
const runtimeCacheHome = join(root, "build", "acceptance", ".packaged-remote-runtime");
let sshd; let app; let echoServer;
let passed = false;
try {
  mkdirSync(home, { recursive: true }); mkdirSync(runtimeCacheHome, { recursive: true });
  const runtimePython = join(runtimeCacheHome, "drsai-agent", "venv", "bin", "python");
  if (!existsSync(runtimePython)) await bootstrapRuntime(executable, runtimeCacheHome, temp);
  assert.ok(existsSync(runtimePython), "packaged Runtime bootstrap did not install Python");
  const artifactDirectory = join(temp, "artifacts"); mkdirSync(artifactDirectory, { recursive: true });
  const artifactPublisher = "opendrsai-temporary-macos-acceptance"; const artifactKeys = generateKeyPairSync("ed25519");
  const trustStore = join(artifactDirectory, "temporary-runtime-publishers.json");
  writeFileSync(trustStore, `${JSON.stringify({ [artifactPublisher]: artifactKeys.publicKey.export({ type: "spki", format: "pem" }) }, null, 2)}\n`);
  const artifactSpecs = [{ version: "9.0.1", protocol: 1 }, { version: "9.0.2", protocol: 1 }, { version: "9.9.9", protocol: 999, incompatible: true }, { version: "9.0.3", protocol: 1, cancel: true }];
  const gatewayArtifacts = artifactSpecs.map((spec) => signedArtifact(createFixtureWheel(runtimePython, artifactDirectory, spec.version, spec.protocol), artifactPublisher, artifactKeys.privateKey, spec));
  mkdirSync(remoteWorkspace, { recursive: true });
  writeFileSync(join(remoteWorkspace, "remote.txt"), "packaged remote workspace\n");
  run("/usr/bin/git", ["init", "-q", remoteWorkspace]);
  run("/usr/bin/git", ["-C", remoteWorkspace, "config", "user.name", "OpenDrSai Packaged SSH"]);
  run("/usr/bin/git", ["-C", remoteWorkspace, "config", "user.email", "packaged-ssh@localhost"]);
  run("/usr/bin/git", ["-C", remoteWorkspace, "add", "remote.txt"]);
  run("/usr/bin/git", ["-C", remoteWorkspace, "commit", "-q", "-m", "fixture"]);
  const managedRoot = join(remoteHome, ".local", "share", "opendrsai", "remote"); mkdirSync(managedRoot, { recursive: true });
  symlinkSync(join(runtimeCacheHome, "drsai-agent", "venv"), join(managedRoot, "current"), "dir");
  mkdirSync(dirname(knownHosts), { recursive: true });
  keygen(hostKey); keygen(clientKey);
  const commandWrapper = join(temp, "remote-command.sh");
  writeFileSync(commandWrapper, `#!/bin/sh\nexport HOME=${shellQuote(remoteHome)}\nexport PATH=${shellQuote(`${dirname(runtimePython)}:/usr/bin:/bin:/usr/sbin:/sbin`)}\ncd "$HOME" || exit 1\ncase "\${SSH_ORIGINAL_COMMAND-}" in\n  internal-sftp*) exec /usr/libexec/sftp-server -d "$HOME" ;;\n  "") exec /bin/sleep 86400 ;;\n  *) exec /bin/sh -c "$SSH_ORIGINAL_COMMAND" ;;\nesac\n`); chmodSync(commandWrapper, 0o700);
  const publicKey = readFileSync(`${clientKey}.pub`, "utf8").trim();
  writeFileSync(authorizedKeys, `command=${JSON.stringify(commandWrapper)},no-agent-forwarding,no-X11-forwarding ${publicKey}\n`); chmodSync(authorizedKeys, 0o600);
  writeFileSync(knownHosts, "", { mode: 0o600 });
  const sshPort = await freePort(); const echoPort = await freePort(); const remoteGatewayPort = await freePort(); const localGatewayPort = await freePort(); const username = userInfo().username;
  writeFileSync(serverConfig, [`Port ${sshPort}`, "ListenAddress 127.0.0.1", `HostKey ${hostKey}`, `AuthorizedKeysFile ${authorizedKeys}`, `PidFile ${join(temp, "sshd.pid")}`, "PasswordAuthentication no", "KbdInteractiveAuthentication no", "PubkeyAuthentication yes", "StrictModes no", "UsePAM no", "PermitRootLogin no", `AllowUsers ${username}`, "UseDNS no", "LogLevel VERBOSE", "Subsystem sftp internal-sftp", ""].join("\n"), { mode: 0o600 });
  writeFileSync(clientConfig, ["Host loopback-opendrsai", "  HostName 127.0.0.1", `  Port ${sshPort}`, `  User ${username}`, `  IdentityFile ${clientKey}`, "  IdentitiesOnly yes", "  BatchMode yes", ""].join("\n"), { mode: 0o600 });
  mkdirSync(desktop, { recursive: true });
  sshd = spawn("/usr/sbin/sshd", ["-D", "-e", "-f", serverConfig], { stdio: ["ignore", "ignore", "pipe"] });
  let sshdError = ""; sshd.stderr.on("data", (chunk) => { sshdError += chunk; });
  await waitForPort(sshPort, sshd, () => sshdError);
  echoServer = createServer((socket) => socket.pipe(socket)); await listen(echoServer, echoPort);
  const appEnvironment = { ...process.env, DRSAI_HOME: home, DRSAI_API_PORT: String(localGatewayPort), OPENDRSAI_SSH_CONFIG: clientConfig, OPENDRSAI_REMOTE_GATEWAY_PORT: String(remoteGatewayPort), OPENDRSAI_RUNTIME_TRUST_STORE: trustStore, OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_AUTH_USER_ID: "packaged-l5-user", OPENDRSAI_REMOTE_PACKAGED_CHAT_FIXTURE: "1", OPENDRSAI_PLATFORM_AGENTS_ENABLED: "0", ELECTRON_ENABLE_LOGGING: "1" };
  app = spawn(executable, [`--user-data-dir=${join(temp, "user-data")}`], { env: { ...appEnvironment, OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE: resultPath, OPENDRSAI_MACOS_PACKAGED_SCENARIO: "ssh-loopback", OPENDRSAI_MACOS_PACKAGED_SCENARIO_CONFIG: JSON.stringify({ remotePort: echoPort, remoteWorkspacePath: remoteWorkspace, gatewayArtifacts }) }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = ""; app.stdout.on("data", (chunk) => { stdout += chunk; }); app.stderr.on("data", (chunk) => { stderr += chunk; });
  const result = await waitForResult(resultPath, app, () => `${stdout}\n${stderr}`);
  assert.equal(result.ok, true, `${result.error ?? "packaged SSH scenario failed"}\n${stderr}`);
  assert.notEqual(result.beforeApproval.state, "reachable"); assert.equal(result.afterApproval.state, "reachable");
  assert.ok(result.preflight.pythonVersion); assert.ok(result.preflight.operatingSystem); assert.ok(result.preflight.architecture); assert.ok(Array.isArray(result.preflight.issues));
  assert.equal(result.preflight.gatewayInstalled, true); assert.equal(result.workspaceStatus.connected, true); assert.equal(result.workspaceStatus.gatewayReady, true);
  assert.equal(result.mobileSameRuntime, true); assert.equal(result.mobileReadiness.gateway_runtime_id, result.workspaceStatus.runtimeId);
  for (const check of ["fileTree", "filePreview", "fileConflict", "fileWrite", "gitDiff", "threadList"]) assert.equal(result[check], true, `packaged Remote Workspace missing ${check}`);
  assert.equal(result.gitStageRevertCommitApproval, true);
  assert.equal(result.remoteThreadStreamSnapshotSearch, true);
  assert.equal(result.checkpointLifecycle, true); assert.equal(result.remoteWorktreeLifecycle, true);
  assert.equal(result.gatewayInstallMatrix, true); assert.deepEqual(result.artifactResults.map((item) => item.outcome), ["installed", "installed", "rejected", "cancelled"]);
  assert.ok(result.hostKeyCount > 0); assert.equal(result.tcpRoundtrip, true); assert.equal(result.cleanup, true);
  const exit = await waitForExit(app, 20_000); assert.equal(exit, 0, stderr);
  await stopRemoteGateway(managedRoot);
  unlinkSync(join(managedRoot, "current")); symlinkSync(join(runtimeCacheHome, "drsai-agent", "venv"), join(managedRoot, "current"), "dir");
  const prepared = await runRestartPhase(executable, join(temp, "user-data"), appEnvironment, temp, "prepare", { remotePort: echoPort, remoteWorkspacePath: remoteWorkspace }); app = prepared.child;
  assert.equal(prepared.result.ok, true, `${prepared.result.error ?? "restart prepare failed"}\n${prepared.stderr}`); assert.equal(prepared.result.persistedForRestart, true); assert.equal(prepared.result.tcpRoundtrip, true);
  const restored = await runRestartPhase(executable, join(temp, "user-data"), appEnvironment, temp, "restore", { remotePort: echoPort, remoteWorkspacePath: remoteWorkspace }); app = restored.child;
  assert.equal(restored.result.ok, true, `${restored.result.error ?? "restart restore failed"}\n${restored.stderr}`); assert.equal(restored.result.restoredAfterRestart, true); assert.equal(restored.result.tcpRoundtrip, true); assert.equal(restored.result.cleanup, true);
  await stopRemoteGateway(managedRoot);
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  const processes = spawnSync("/bin/ps", ["-axo", "command="], { encoding: "utf8" }); assert.equal(processes.status, 0, processes.stderr);
  const residuals = processes.stdout.split("\n").filter((line) => line.includes(temp) && !line.includes("/usr/sbin/sshd -D"));
  assert.deepEqual(residuals, [], `packaged SSH journey left processes bound to its isolated fixture:\n${residuals.join("\n")}`);
  assert.doesNotMatch(`${stdout}\n${stderr}`, /UnhandledPromiseRejection|uncaught exception/i);
  const acceptance = join(root, "build", "acceptance"); mkdirSync(acceptance, { recursive: true });
  writeFileSync(join(acceptance, "packaged-ssh-loopback.json"), `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), featureIds: ["M2-F01"], journeys: ["host-key-reject-review-approve", "remote-gateway-preflight", "ssh-connect", "remote-workspace-handshake", "remote-mobile-pairing-same-runtime", "remote-file-tree-preview-conflict-write", "remote-git-diff-stage-revert-approved-commit", "remote-thread-stream-snapshot-search", "remote-checkpoint-create-preview-approved-restore", "remote-worktree-inherits-runtime", "port-forward-pause-resume-tcp", "gateway-install-approval", "gateway-upgrade-atomic-switch", "gateway-incompatible-failure-preserves-current", "gateway-cancel-preserves-current", "gateway-rollback", "port-forward-persist-on-graceful-exit", "controlmaster-and-forward-restore-after-app-restart", "restored-forward-tcp-and-cleanup", "graceful-cleanup"], checks: 20, appRestarts: 1, unexpectedSideEffects: 0, residualProcesses: 0 }, null, 2)}\n`);
  passed = true;
  console.log(`Packaged OpenSSH passed (Host Key, connect, Port Forward pause/resume/TCP, cleanup; ssh=${sshPort}, echo=${echoPort}).`);
} finally {
  if (app?.exitCode === null) app.kill("SIGTERM"); sshd?.kill("SIGTERM"); echoServer?.close();
  await stopRemoteGateway(join(remoteHome, ".local", "share", "opendrsai", "remote")).catch((error) => console.error(`Remote Gateway cleanup failed: ${error}`));
  await Promise.allSettled([waitForExit(app, 2_000), waitForExit(sshd, 2_000)]);
  if (passed) rmSync(temp, { recursive: true, force: true });
  else {
    const gatewayLog = join(remoteHome, ".local", "share", "opendrsai", "remote", "gateway.log");
    if (existsSync(gatewayLog)) console.error(`Remote Gateway log:\n${readFileSync(gatewayLog, "utf8").slice(-20_000)}`);
    console.error(`Preserved failed packaged SSH fixture: ${temp}`);
  }
}

function keygen(path) { const result = spawnSync("/usr/bin/ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", path], { encoding: "utf8" }); assert.equal(result.status, 0, result.stderr); }
function run(command, args) { const result = spawnSync(command, args, { encoding: "utf8" }); if (result.error) throw result.error; assert.equal(result.status, 0, result.stderr); }
function shellQuote(value) { return `'${String(value).replaceAll("'", `'"'"'`)}'`; }
function createFixtureWheel(python, outputDirectory, version, protocolVersion) { const output = join(outputDirectory, `drsai-${version}-py3-none-any.whl`); const source = resolve(root, "../windows/tests/remote-ssh/fixture_drsai"); const code = `import pathlib,sys,zipfile\nsource=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2]);version=sys.argv[3];protocol=sys.argv[4]\nwith zipfile.ZipFile(out,'w') as z:\n for p in source.rglob('*.py'):\n  data=p.read_text();data=data.replace('_REMOTE_PROTOCOL_VERSION = 1','_REMOTE_PROTOCOL_VERSION = '+protocol)\n  z.writestr(p.relative_to(source).as_posix(),data)\n info='drsai-'+version+'.dist-info'\n z.writestr(info+'/METADATA','Metadata-Version: 2.1\\nName: drsai\\nVersion: '+version+'\\n')\n z.writestr(info+'/WHEEL','Wheel-Version: 1.0\\nGenerator: opendrsai-e2e\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')\n z.writestr(info+'/RECORD','')`; run(python, ["-c", code, source, output, version, String(protocolVersion)]); return output; }
function signedArtifact(artifactPath, publisher, privateKey, spec) { const bytes = readFileSync(artifactPath); const artifactSha256 = createHash("sha256").update(bytes).digest("hex"); const payload = Buffer.from(`opendrsai-runtime-artifact-v1\n${spec.version}\n${artifactSha256}\n`, "utf8"); return { version: spec.version, artifactPath, artifactSha256, artifactPublisher: publisher, artifactSignature: sign(null, payload, privateKey).toString("base64"), ...(spec.incompatible ? { incompatible: true } : {}), ...(spec.cancel ? { cancel: true } : {}) }; }
function freePort() { return new Promise((resolvePort, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close((error) => error ? reject(error) : port ? resolvePort(port) : reject(new Error("No loopback port available."))); }); }); }
function waitForPort(port, child, stderr) { return new Promise((resolveReady, reject) => { const deadline = Date.now() + 10_000; const probe = () => { if (child.exitCode !== null) return reject(new Error(`sshd exited during startup: ${stderr()}`)); const socket = connectTcp({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolveReady(); }); socket.once("error", () => { socket.destroy(); Date.now() < deadline ? setTimeout(probe, 50) : reject(new Error(`sshd did not listen: ${stderr()}`)); }); }; probe(); }); }
function listen(server, port) { return new Promise((resolveReady, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolveReady); }); }
async function waitForResult(path, child, logs) { const deadline = Date.now() + 300_000; while (Date.now() < deadline) { if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")); if (child.exitCode !== null) throw new Error(`App exited before result (${child.exitCode}).\n${logs()}`); await new Promise((resolveWait) => setTimeout(resolveWait, 100)); } throw new Error(`Packaged SSH scenario timed out.\n${logs()}`); }
function waitForExit(child, timeout) { if (!child || child.exitCode !== null) return Promise.resolve(child?.exitCode ?? null); return new Promise((resolveExit) => { const timer = setTimeout(() => resolveExit(null), timeout); child.once("exit", (code) => { clearTimeout(timer); resolveExit(code); }); }); }

async function runRestartPhase(appExecutable, userData, environment, fixtureRoot, phase, config) {
  const output = join(fixtureRoot, `restart-${phase}.json`);
  const child = spawn(appExecutable, [`--user-data-dir=${userData}`], { env: { ...environment, OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE: output, OPENDRSAI_MACOS_PACKAGED_SCENARIO: "ssh-loopback", OPENDRSAI_MACOS_PACKAGED_SCENARIO_CONFIG: JSON.stringify({ ...config, restartPhase: phase }) }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = ""; child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
  const result = await waitForResult(output, child, () => `${stdout}\n${stderr}`); const exit = await waitForExit(child, 30_000); assert.equal(exit, result.ok ? 0 : 1, `${phase} App exit mismatch\n${stderr}`);
  return { child, result, stdout, stderr };
}

async function bootstrapRuntime(appExecutable, drsaiHome, fixtureRoot) {
  const output = join(fixtureRoot, "runtime-bootstrap.json"); const gatewayPort = await freePort();
  const child = spawn(appExecutable, [`--user-data-dir=${join(fixtureRoot, "bootstrap-user-data")}`], { env: { ...process.env, DRSAI_HOME: drsaiHome, DRSAI_API_PORT: String(gatewayPort), OPENDRSAI_RUNTIME_PERSIST: "0", OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_PLATFORM_AGENTS_ENABLED: "0", OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE: output, OPENDRSAI_MACOS_PACKAGED_SCENARIO: "smoke", ELECTRON_ENABLE_LOGGING: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk; });
  const result = await waitForResultWithTimeout(output, child, () => stderr, 900_000); assert.equal(result.ok, true, `${result.error ?? "Runtime bootstrap failed"}\n${stderr}`);
  assert.equal(await waitForExit(child, 30_000), 0, stderr);
}
async function waitForResultWithTimeout(path, child, stderr, timeout) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")); if (child.exitCode !== null) throw new Error(`App exited before result (${child.exitCode}).\n${stderr()}`); await new Promise((resolveWait) => setTimeout(resolveWait, 250)); } throw new Error(`Packaged Runtime bootstrap timed out.\n${stderr()}`); }
async function stopRemoteGateway(managedRoot) { const pidPath = join(managedRoot, "gateway.pid"); if (!existsSync(pidPath)) return; const pid = Number(readFileSync(pidPath, "utf8").trim()); if (!Number.isInteger(pid) || pid <= 1) throw new Error("Remote Gateway pidfile is invalid"); try { process.kill(pid, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; unlinkSync(pidPath); return; } for (let i = 0; i < 100; i += 1) { try { process.kill(pid, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 100)); } catch (error) { if (error?.code === "ESRCH") { unlinkSync(pidPath); return; } throw error; } } try { process.kill(pid, "SIGKILL"); } catch (error) { if (error?.code !== "ESRCH") throw error; } for (let i = 0; i < 50; i += 1) { try { process.kill(pid, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 100)); } catch (error) { if (error?.code === "ESRCH") { unlinkSync(pidPath); return; } throw error; } } throw new Error(`Remote Gateway ${pid} survived SIGKILL`); }
