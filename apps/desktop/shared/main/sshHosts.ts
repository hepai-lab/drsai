import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { chmod, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { RemoteSshConnectivityResult, RemoteSshHost, RemoteSshHostKey } from "../api/desktopApi";
import { replaceFileSafely } from "./atomicFileReplace";
import { HostProfileStore, makeHostProfile, redactSshDiagnostic } from "./hostConnectionManager";
import { DRSAI_HOME } from "./paths";

const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_CONFIG_FILES = 64;
const MAX_HOSTS = 256;
const SCAN_TTL_MS = 2 * 60_000;
type CommandRunner = (command: string, args: string[], timeoutMs: number) => Promise<string>;
type SpawnRunner = (command: string, args: string[]) => ChildProcess;
type Scan = { createdAt: number; lines: string[]; keys: RemoteSshHostKey[] };
type Connection = { alias: string; child: ChildProcess; controlPath: string; connectedAt: string; intentionalClose: boolean };

export interface SshHostServiceOptions {
  configPath?: string;
  knownHostsPath?: string;
  controlDirectory?: string;
  sshExecutable?: string;
  keyscanExecutable?: string;
  run?: CommandRunner;
  spawn?: SpawnRunner;
  profileStore?: HostProfileStore;
  clock?: () => number;
}

export class SshHostService {
  readonly #configPath: string;
  readonly #knownHostsPath: string;
  readonly #ssh: string;
  readonly #controlDirectory: string;
  readonly #keyscan: string;
  readonly #run: CommandRunner;
  readonly #spawn: SpawnRunner;
  readonly #profiles: HostProfileStore;
  readonly #clock: () => number;
  readonly #scans = new Map<string, Scan>();
  readonly #connections = new Map<string, Connection>();
  readonly #connectionFlights = new Map<string, Promise<boolean>>();

  constructor(options: SshHostServiceOptions = {}) {
    this.#configPath = resolve(options.configPath ?? process.env.OPENDRSAI_SSH_CONFIG?.trim() ?? join(homedir(), ".ssh", "config"));
    this.#knownHostsPath = resolve(options.knownHostsPath ?? join(DRSAI_HOME, "desktop", "ssh", "known_hosts"));
    this.#controlDirectory = resolve(options.controlDirectory ?? join(DRSAI_HOME, "desktop", "ssh", "control"));
    this.#ssh = options.sshExecutable ?? process.env.OPENDRSAI_SSH_EXECUTABLE?.trim() ?? (process.platform === "darwin" ? "/usr/bin/ssh" : "ssh");
    this.#keyscan = options.keyscanExecutable ?? (process.platform === "darwin" ? "/usr/bin/ssh-keyscan" : "ssh-keyscan");
    this.#run = options.run ?? runCommand;
    this.#spawn = options.spawn ?? ((command, args) => spawn(command, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }));
    this.#profiles = options.profileStore ?? new HostProfileStore();
    this.#clock = options.clock ?? Date.now;
  }

  async listHosts(): Promise<RemoteSshHost[]> {
    const sources = await readConfigSources(this.#configPath);
    const aliases = new Set<string>();
    for (const source of sources) for (const line of source.text.split(/\r?\n/)) {
      const match = /^\s*Host\s+(.+)$/i.exec(line);
      if (!match) continue;
      for (const alias of match[1].trim().split(/\s+/)) if (/^[A-Za-z0-9_.@-]{1,128}$/.test(alias)) aliases.add(alias);
    }
    const hosts: RemoteSshHost[] = [];
    for (const alias of [...aliases].slice(0, MAX_HOSTS)) {
      try {
        const output = await this.#run(this.#ssh, [...this.#configArgs(), "-G", alias], 5_000);
        const host = parseResolvedHost(alias, output);
        hosts.push(host);
        await this.#profiles.upsert(makeHostProfile({ ...host, configSource: this.#configPath, authPreference: host.identityFiles.length ? "identity_file" : "system_config" }));
      } catch { hosts.push({ alias, hostname: alias, port: 22, identityFiles: [] }); }
    }
    return hosts.sort((a, b) => a.alias.localeCompare(b.alias));
  }

  async inspectHostKeys(rawAlias: unknown): Promise<RemoteSshHostKey[]> {
    const alias = assertAlias(rawAlias);
    const host = parseResolvedHost(alias, await this.#run(this.#ssh, [...this.#configArgs(), "-G", alias], 5_000));
    const output = await this.#run(this.#keyscan, ["-T", "5", "-p", String(host.port), host.hostname], 8_000);
    const lines = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    const keys = lines.map((line) => toHostKey(alias, host.hostname, host.port, line)).filter((key): key is RemoteSshHostKey => Boolean(key));
    if (!keys.length) throw new Error("Remote computer did not provide a valid host key.");
    this.#scans.set(alias, { createdAt: this.#clock(), lines, keys });
    return keys;
  }

  async approveHostKey(rawAlias: unknown): Promise<boolean> {
    const alias = assertAlias(rawAlias);
    const reviewed = this.#scans.get(alias);
    if (!reviewed || this.#clock() - reviewed.createdAt > SCAN_TTL_MS) throw new Error("SSH host-key review expired; inspect the host keys again.");
    const rescanned = await this.inspectHostKeys(alias);
    if (fingerprintSet(reviewed.keys) !== fingerprintSet(rescanned)) throw new Error("SSH host key changed after review; approval was blocked.");
    const current = await readBoundedFile(this.#knownHostsPath).catch(() => "");
    const additions = this.#scans.get(alias)!.lines.filter((line) => !current.split(/\r?\n/).includes(line));
    if (additions.length) await writePrivateAtomic(this.#knownHostsPath, `${current.replace(/\s*$/, "")}${current.trim() ? "\n" : ""}${additions.join("\n")}\n`);
    const host = (await this.listHosts()).find((item) => item.alias === alias);
    if (host) await this.#profiles.upsert(makeHostProfile({ ...host, configSource: this.#configPath, authPreference: host.identityFiles.length ? "identity_file" : "system_config", knownHostFingerprint: rescanned[0].fingerprint }));
    return true;
  }

  async diagnose(rawAlias: unknown, timeoutMs = 12_000): Promise<RemoteSshConnectivityResult> {
    const alias = assertAlias(rawAlias); const startedAt = this.#clock();
    try {
      await this.#run(this.#ssh, [...this.#configArgs(), "-o", `UserKnownHostsFile=${this.#knownHostsPath}`, "-o", "StrictHostKeyChecking=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", alias, "printf", "opendrsai-ok"], clampTimeout(timeoutMs));
      return { hostAlias: alias, state: "reachable", elapsedMs: this.#clock() - startedAt };
    } catch (error) {
      const message = redactSshDiagnostic(error instanceof Error ? error.message : String(error));
      return { hostAlias: alias, state: classifyFailure(message, this.#clock() - startedAt, timeoutMs), elapsedMs: this.#clock() - startedAt, message, ...( /permission denied|authentication/i.test(message) ? { remediation: "Load the identity into ssh-agent or unlock the key in macOS Keychain, then retry." } : {}) };
    }
  }

  async test(rawAlias: unknown): Promise<boolean> { return (await this.diagnose(rawAlias)).state === "reachable"; }
  async connect(rawAlias: unknown): Promise<boolean> {
    const alias = assertAlias(rawAlias);
    if (this.#connections.has(alias)) return false;
    const existing = this.#connectionFlights.get(alias); if (existing) return existing;
    const flight = this.#connect(alias).finally(() => this.#connectionFlights.delete(alias));
    this.#connectionFlights.set(alias, flight); return flight;
  }
  disconnect(rawAlias: unknown): boolean {
    const alias = assertAlias(rawAlias); const connection = this.#connections.get(alias); if (!connection) return false;
    connection.intentionalClose = true; this.#connections.delete(alias);
    if (!connection.child.killed) connection.child.kill("SIGTERM");
    void rm(connection.controlPath, { force: true });
    return true;
  }
  async reconnect(rawAlias: unknown): Promise<boolean> {
    const alias = assertAlias(rawAlias); this.disconnect(alias); return this.connect(alias);
  }
  async remove(rawAlias: unknown): Promise<boolean> {
    const alias = assertAlias(rawAlias);
    if (this.#connections.has(alias) || this.#connectionFlights.has(alias)) throw new Error("SSH host has an active connection and cannot be removed.");
    const profile = (await this.#profiles.list()).find((item) => item.alias === alias);
    return profile ? this.#profiles.remove(profile.profileId, { workspaces: 0, ptys: 0, portForwards: 0 }) : false;
  }
  shutdown(): void { for (const alias of [...this.#connections.keys()]) this.disconnect(alias); }
  isConnected(rawAlias: unknown): boolean { return this.#connections.has(assertAlias(rawAlias)); }
  controlPath(rawAlias: unknown): string | null { return this.#connections.get(assertAlias(rawAlias))?.controlPath ?? null; }
  remoteTerminalCommand(rawAlias: unknown, rawCwd: unknown): { file: string; args: string[]; cwd: string } {
    const alias = assertAlias(rawAlias); const controlPath = this.#connections.get(alias)?.controlPath; if (!controlPath) throw new Error("SSH host is not connected.");
    if (typeof rawCwd !== "string" || !rawCwd.trim() || rawCwd.length > 4096 || /[\r\n\0]/.test(rawCwd)) throw new Error("Remote terminal cwd is invalid.");
    const cwd = rawCwd.trim(); const command = `cd -- ${quotePosix(cwd)} && exec \"\${SHELL:-/bin/sh}\" -l`;
    return { file: this.#ssh, args: [...this.#configArgs(), "-S", controlPath, "-o", `UserKnownHostsFile=${this.#knownHostsPath}`, "-o", "StrictHostKeyChecking=yes", "-tt", alias, command], cwd };
  }
  get knownHostsPath(): string { return this.#knownHostsPath; }
  #configArgs(): string[] { return ["-F", this.#configPath]; }
  async #connect(alias: string): Promise<boolean> {
    if (!(await this.listHosts()).some((host) => host.alias === alias)) throw new Error("SSH host is not present in the configured inventory.");
    await readBoundedFile(this.#knownHostsPath).catch(() => { throw new Error("SSH host key has not been approved."); });
    await mkdir(this.#controlDirectory, { recursive: true, mode: 0o700 });
    const controlPath = join(this.#controlDirectory, createHash("sha256").update(alias).digest("hex").slice(0, 24));
    await rm(controlPath, { force: true });
    const child = this.#spawn(this.#ssh, [...this.#configArgs(), "-N", "-M", "-S", controlPath, "-o", `UserKnownHostsFile=${this.#knownHostsPath}`, "-o", "StrictHostKeyChecking=yes", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", alias]);
    const connection: Connection = { alias, child, controlPath, connectedAt: new Date(this.#clock()).toISOString(), intentionalClose: false };
    await waitForSpawn(child, 100);
    this.#connections.set(alias, connection);
    child.once("exit", () => { if (this.#connections.get(alias)?.child === child) this.#connections.delete(alias); void rm(controlPath, { force: true }); });
    child.once("error", () => { if (this.#connections.get(alias)?.child === child) this.#connections.delete(alias); void rm(controlPath, { force: true }); });
    return true;
  }
}

async function readConfigSources(rootPath: string): Promise<Array<{ path: string; text: string }>> {
  const queue = [rootPath]; const seen = new Set<string>(); const result: Array<{ path: string; text: string }> = [];
  while (queue.length && seen.size < MAX_CONFIG_FILES) {
    const path = resolve(queue.shift()!); if (seen.has(path)) continue; seen.add(path);
    try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CONFIG_BYTES) continue; } catch { continue; }
    const text = await readFile(path, "utf8"); result.push({ path, text });
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*Include\s+(.+)$/i.exec(line); if (!match) continue;
      for (const token of match[1].trim().split(/\s+/)) {
        if (/\0|\r|\n/.test(token)) continue;
        const expanded = token.replace(/^~(?=[/\\])/, homedir()); const candidate = isAbsolute(expanded) ? expanded : resolve(dirname(path), expanded);
        if (!/[?*]/.test(candidate)) { queue.push(candidate); continue; }
        const folder = dirname(candidate); const pattern = new RegExp(`^${basename(candidate).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
        try { for (const name of await readdir(folder)) if (pattern.test(name)) queue.push(join(folder, name)); } catch { /* inaccessible include */ }
      }
    }
  }
  return result;
}

function parseResolvedHost(alias: string, output: string): RemoteSshHost {
  const lines = output.split(/\r?\n/); const values = new Map<string, string>();
  for (const line of lines) { const index = line.indexOf(" "); if (index > 0) values.set(line.slice(0, index).toLowerCase(), line.slice(index + 1)); }
  const port = Number(values.get("port") ?? 22);
  return { alias, hostname: values.get("hostname") || alias, ...(values.get("user") ? { user: values.get("user") } : {}), port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 22, identityFiles: lines.filter((line) => line.startsWith("identityfile ")).map((line) => line.slice(13)).slice(0, 32), ...(values.get("proxyjump") && values.get("proxyjump") !== "none" ? { proxyJump: values.get("proxyjump") } : {}) };
}

function toHostKey(alias: string, hostname: string, port: number, line: string): RemoteSshHostKey | null {
  const parts = line.split(/\s+/); if (parts.length < 3 || !/^ssh-|^ecdsa-/.test(parts[1])) return null;
  let bytes: Buffer; try { bytes = Buffer.from(parts[2], "base64"); } catch { return null; }
  if (!bytes.length) return null;
  return { hostAlias: alias, hostname, port, algorithm: parts[1], fingerprint: `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}` };
}
function fingerprintSet(keys: RemoteSshHostKey[]): string { return keys.map((key) => `${key.algorithm}:${key.fingerprint}`).sort().join("|"); }
function assertAlias(value: unknown): string { if (typeof value !== "string" || !/^[A-Za-z0-9_.@-]{1,128}$/.test(value)) throw new Error("SSH host alias is invalid."); return value; }
function quotePosix(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }
function clampTimeout(value: number): number { return Number.isFinite(value) ? Math.max(500, Math.min(30_000, Math.floor(value))) : 12_000; }
function classifyFailure(message: string, elapsed: number, timeout: number): RemoteSshConnectivityResult["state"] { const text = message.toLowerCase(); return /host key verification failed|identification has changed|no .* host key/.test(text) ? "host_key_failed" : /permission denied|authentication failed|no supported authentication/.test(text) ? "authentication_failed" : /could not resolve hostname|name or service not known|name resolution/.test(text) ? "dns_failed" : /timed out|etimeout|connection timeout/.test(text) || elapsed >= clampTimeout(timeout) - 100 ? "timeout" : /connection refused|no route to host|network is unreachable/.test(text) ? "unreachable" : "failed"; }
async function readBoundedFile(path: string): Promise<string> { const info = await stat(path); if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error("known_hosts is invalid or too large."); return readFile(path, "utf8"); }
async function writePrivateAtomic(path: string, content: string): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`; try { await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await replaceFileSafely(temporary, path); await chmod(path, 0o600).catch(() => undefined); } finally { await rm(temporary, { force: true }); } }
function runCommand(command: string, args: string[], timeoutMs: number): Promise<string> { return new Promise((resolvePromise, reject) => execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => error ? reject(new Error(String(stderr || error.message).trim())) : resolvePromise(String(stdout).trim()))); }
function waitForSpawn(child: ChildProcess, graceMs: number): Promise<void> { return new Promise((resolvePromise, reject) => { let settled = false; const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); child.removeListener("error", onError); child.removeListener("exit", onExit); error ? reject(error) : resolvePromise(); }; const onError = (error: Error) => finish(error); const onExit = (code: number | null) => finish(new Error(`SSH control connection exited during startup (${code ?? "signal"}).`)); const timer = setTimeout(() => finish(), graceMs); child.once("error", onError); child.once("exit", onExit); }); }

export const sshHostService = new SshHostService();
