import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { HostProfileStore } from "../main/hostConnectionManager.ts";
import { SshHostService } from "../main/sshHosts.ts";

const root = await mkdtemp(join(tmpdir(), "drsai-ssh-hosts-"));
try {
  const ssh = join(root, ".ssh"); const config = join(ssh, "config"); const included = join(ssh, "team.conf");
  const knownHosts = join(root, "state", "known_hosts"); const profiles = join(root, "state", "profiles.json");
  await mkdir(ssh, { recursive: true });
  await writeFile(config, "Include team.conf\nHost alpha\n  HostName alpha.example.test\n", "utf8");
  await writeFile(included, "Host beta\n  HostName beta.example.test\n", "utf8");
  const encodedA = Buffer.from("host-key-a").toString("base64"); const encodedB = Buffer.from("host-key-b").toString("base64");
  let scan = encodedA; const calls: Array<{ command: string; args: string[] }> = [];
  const run = async (command: string, args: string[]) => {
    calls.push({ command, args });
    if (command === "/fake/keyscan") return `alpha.example.test ssh-ed25519 ${scan}`;
    if (args.includes("-G")) { const alias = args.at(-1); return `hostname ${alias}.example.test\nuser tester\nport 2222\nidentityfile ~/.ssh/id_ed25519\nproxyjump none`; }
    if (args.includes("StrictHostKeyChecking=yes")) return "opendrsai-ok";
    throw new Error("unexpected command");
  };
  const service = new SshHostService({ configPath: config, knownHostsPath: knownHosts, sshExecutable: "/fake/ssh", keyscanExecutable: "/fake/keyscan", run, profileStore: new HostProfileStore(profiles) });
  const hosts = await service.listHosts();
  assert.deepEqual(hosts.map((host) => host.alias), ["alpha", "beta"]);
  assert.equal(hosts[0].hostname, "alpha.example.test"); assert.equal(hosts[0].port, 2222);
  await assert.rejects(() => service.approveHostKey("alpha"), /inspect/i);
  const keys = await service.inspectHostKeys("alpha"); assert.equal(keys[0].algorithm, "ssh-ed25519"); assert.match(keys[0].fingerprint, /^SHA256:/);
  scan = encodedB; await assert.rejects(() => service.approveHostKey("alpha"), /changed after review/i);

  scan = encodedA; await service.inspectHostKeys("alpha"); assert.equal(await service.approveHostKey("alpha"), true);
  const saved = await readFile(knownHosts, "utf8"); assert.match(saved, /ssh-ed25519/); assert(!saved.includes("password"));
  if (process.platform !== "win32") assert.equal((await stat(knownHosts)).mode & 0o777, 0o600);
  assert.equal((await service.diagnose("alpha")).state, "reachable");
  const diagnosticCall = calls.find((call) => call.args.includes("StrictHostKeyChecking=yes"));
  assert(diagnosticCall?.args.some((arg) => arg === `UserKnownHostsFile=${knownHosts}`));
  await assert.rejects(() => service.inspectHostKeys("../../bad"), /alias is invalid/i);

  const failing = new SshHostService({ configPath: config, knownHostsPath: knownHosts, run: async () => { throw new Error("Permission denied password=top-secret-token-12345678901234567890"); } });
  const failure = await failing.diagnose("alpha"); assert.equal(failure.state, "authentication_failed"); assert(!failure.message?.includes("top-secret"));
  const persistedProfiles = await readFile(profiles, "utf8"); assert(!/password|passphrase|private.?key/i.test(persistedProfiles));

  class FakeChild extends EventEmitter {
    killed = false;
    kill(): boolean { if (this.killed) return false; this.killed = true; queueMicrotask(() => this.emit("exit", 0, "SIGTERM")); return true; }
  }
  const children: FakeChild[] = []; const spawnArgs: string[][] = [];
  const lifecycle = new SshHostService({
    configPath: config, knownHostsPath: knownHosts, controlDirectory: join(root, "state", "control"),
    sshExecutable: "/fake/ssh", keyscanExecutable: "/fake/keyscan", run,
    profileStore: new HostProfileStore(profiles),
    spawn: (_command, args) => { spawnArgs.push(args); const child = new FakeChild(); children.push(child); return child as unknown as ChildProcess; },
  });
  const [firstConnect, concurrentConnect] = await Promise.all([lifecycle.connect("alpha"), lifecycle.connect("alpha")]);
  assert.equal(firstConnect, true); assert.equal(concurrentConnect, true); assert.equal(children.length, 1); assert(lifecycle.isConnected("alpha"));
  const remoteTerminal = lifecycle.remoteTerminalCommand("alpha", "/srv/project's worktree"); assert.equal(remoteTerminal.file, "/fake/ssh"); assert(remoteTerminal.args.includes("-tt")); assert(remoteTerminal.args.includes("StrictHostKeyChecking=yes")); assert(remoteTerminal.args.at(-1)?.includes(`'/srv/project'"'"'s worktree'`));
  await assert.rejects(async () => lifecycle.remoteTerminalCommand("alpha", "bad\npath"), /cwd is invalid/i);
  assert(spawnArgs[0].includes("-N") && spawnArgs[0].includes("-M") && spawnArgs[0].includes("-S"));
  assert(spawnArgs[0].includes("StrictHostKeyChecking=yes") && spawnArgs[0].includes("BatchMode=yes"));
  await assert.rejects(() => lifecycle.remove("alpha"), /active connection/i);
  assert.equal(lifecycle.disconnect("alpha"), true); assert.equal(lifecycle.disconnect("alpha"), false);
  assert.equal(await lifecycle.reconnect("alpha"), true); assert.equal(children.length, 2);
  children[1].emit("exit", 255, null); await new Promise((resolve) => setTimeout(resolve, 0)); assert(!lifecycle.isConnected("alpha"));
  assert.equal(await lifecycle.connect("alpha"), true); lifecycle.shutdown(); assert.equal(children[2].killed, true);
  assert.equal(await lifecycle.remove("alpha"), true);
  console.log("SSH host inventory, bounded config, stable host-key approval, private known_hosts and diagnostics passed.");
} finally { await rm(root, { recursive: true, force: true }); }
