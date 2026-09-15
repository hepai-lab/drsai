import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, connect as connectTcp } from "node:net";
import { userInfo } from "node:os";
import { join } from "node:path";

if (process.platform !== "darwin") throw new Error("Loopback OpenSSH verification requires macOS.");
const temp = mkdtempSync("/private/tmp/odssh-");
const hostKey = join(temp, "host_ed25519");
const clientKey = join(temp, "client_ed25519");
const authorizedKeys = join(temp, "authorized_keys");
const knownHosts = join(temp, "known_hosts");
const clientConfig = join(temp, "ssh_config");
const serverConfig = join(temp, "sshd_config");
const controlPath = join(temp, "control");
let sshd;
let master;
let forward;
let echoServer;
try {
  keygen(hostKey); keygen(clientKey);
  writeFileSync(authorizedKeys, readFileSync(`${clientKey}.pub`)); chmodSync(authorizedKeys, 0o600);
  writeFileSync(knownHosts, "", { mode: 0o600 });
  const sshPort = await freePort();
  const username = userInfo().username;
  writeFileSync(serverConfig, [
    `Port ${sshPort}`, "ListenAddress 127.0.0.1", `HostKey ${hostKey}`, `AuthorizedKeysFile ${authorizedKeys}`,
    `PidFile ${join(temp, "sshd.pid")}`, "PasswordAuthentication no", "KbdInteractiveAuthentication no",
    "PubkeyAuthentication yes", "StrictModes no", "UsePAM no", "PermitRootLogin no", `AllowUsers ${username}`,
    "UseDNS no", "LogLevel VERBOSE", "Subsystem sftp internal-sftp", "",
  ].join("\n"), { mode: 0o600 });
  writeFileSync(clientConfig, [
    "Host loopback-opendrsai", "  HostName 127.0.0.1", `  Port ${sshPort}`, `  User ${username}`,
    `  IdentityFile ${clientKey}`, "  IdentitiesOnly yes", "  BatchMode yes", `  UserKnownHostsFile ${knownHosts}`,
    "  StrictHostKeyChecking yes", "",].join("\n"), { mode: 0o600 });

  sshd = spawn("/usr/sbin/sshd", ["-D", "-e", "-f", serverConfig], { stdio: ["ignore", "ignore", "pipe"] });
  let sshdError = ""; sshd.stderr.on("data", (chunk) => { sshdError += chunk; });
  await waitForPort(sshPort, sshd, () => sshdError);

  const rejected = ssh(["-F", clientConfig, "loopback-opendrsai", "printf", "unexpected"]);
  assert.notEqual(rejected.status, 0, "Unapproved loopback Host Key must be rejected.");
  assert.match(`${rejected.stderr}`, /host key verification failed/i);
  const scan = spawnSync("/usr/bin/ssh-keyscan", ["-T", "5", "-p", String(sshPort), "127.0.0.1"], { encoding: "utf8" });
  assert.equal(scan.status, 0, scan.stderr); assert.match(scan.stdout, /ssh-ed25519/);
  writeFileSync(knownHosts, scan.stdout, { mode: 0o600 });
  const approved = ssh(["-F", clientConfig, "loopback-opendrsai", "printf", "opendrsai-ok"]);
  assert.equal(approved.status, 0, approved.stderr); assert.equal(approved.stdout, "opendrsai-ok");

  master = spawn("/usr/bin/ssh", ["-F", clientConfig, "-N", "-M", "-S", controlPath, "loopback-opendrsai"], { stdio: ["ignore", "ignore", "pipe"] });
  await waitForChild(master, 300, "SSH ControlMaster");
  const echoPort = await freePort();
  echoServer = createServer((socket) => socket.pipe(socket));
  await listen(echoServer, echoPort);
  const localPort = await freePort();
  forward = spawn("/usr/bin/ssh", ["-F", clientConfig, "-S", "none", "-N", "-o", "ExitOnForwardFailure=yes", "-L", `127.0.0.1:${localPort}:127.0.0.1:${echoPort}`, "loopback-opendrsai"], { stdio: ["ignore", "ignore", "pipe"] });
  await waitForChild(forward, 300, "SSH Port Forward");
  assert.equal(await roundtrip(localPort, "loopback-forward-ok"), "loopback-forward-ok");
  console.log(`Loopback OpenSSH passed (host-key rejection/approval, ControlMaster, TCP forward; port=${sshPort}).`);
} finally {
  forward?.kill("SIGTERM"); master?.kill("SIGTERM"); sshd?.kill("SIGTERM"); echoServer?.close();
  await Promise.allSettled([waitForExit(forward), waitForExit(master), waitForExit(sshd)]);
  rmSync(temp, { recursive: true, force: true });
}

function keygen(path) { const result = spawnSync("/usr/bin/ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", path], { encoding: "utf8" }); assert.equal(result.status, 0, result.stderr); }
function ssh(args) { return spawnSync("/usr/bin/ssh", args, { encoding: "utf8", timeout: 10_000 }); }
function freePort() { return new Promise((resolvePort, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close((error) => error ? reject(error) : port ? resolvePort(port) : reject(new Error("No loopback port available."))); }); }); }
function waitForPort(port, child, stderr) { return new Promise((resolveReady, reject) => { const deadline = Date.now() + 10_000; const probe = () => { if (child.exitCode !== null) return reject(new Error(`sshd exited during startup: ${stderr()}`)); const socket = connectTcp({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolveReady(); }); socket.once("error", () => { socket.destroy(); Date.now() < deadline ? setTimeout(probe, 50) : reject(new Error(`sshd did not listen: ${stderr()}`)); }); }; probe(); }); }
function waitForChild(child, delay, label) { return new Promise((resolveReady, reject) => { const timer = setTimeout(() => { cleanup(); resolveReady(); }, delay); const failed = (value) => { cleanup(); reject(new Error(`${label} exited during startup: ${value instanceof Error ? value.message : value}`)); }; const cleanup = () => { clearTimeout(timer); child.removeListener("error", failed); child.removeListener("exit", failed); }; child.once("error", failed); child.once("exit", failed); }); }
function listen(server, port) { return new Promise((resolveReady, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolveReady); }); }
function roundtrip(port, value) { return new Promise((resolveValue, reject) => { const socket = connectTcp({ host: "127.0.0.1", port }); let output = ""; socket.setEncoding("utf8"); socket.once("error", reject); socket.on("data", (chunk) => { output += chunk; if (output.length >= value.length) { socket.end(); resolveValue(output); } }); socket.once("connect", () => socket.write(value)); }); }
function waitForExit(child) { if (!child || child.exitCode !== null) return Promise.resolve(); return new Promise((resolveExit) => { const timer = setTimeout(() => resolveExit(), 2_000); child.once("exit", () => { clearTimeout(timer); resolveExit(); }); }); }
