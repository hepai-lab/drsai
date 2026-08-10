import { execFile, spawn, type ChildProcess } from "child_process";
import { randomBytes } from "crypto";
import { get } from "http";
import { connect as connectTcp } from "net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { GatewayEndpointStatus, GatewayStatus } from "../api/desktopApi";
import type { DesktopProcessService } from "../api";
import { DRSAI_HOME, DRSAI_PYTHON, DRSAI_REPO, getEnhancedPath } from "./paths";
import { collectMigrationAliases, getCliConfigUserId, rememberUserIdAlias, setCliConfigUserId } from "./userIdentity";
import { managedProcessRegistry, type ManagedProcessRegistration } from "./managedProcessRegistry";
import { redactDesktopSecrets } from "./secretRedaction";
import { redactSensitiveData } from "../api/sensitiveData";
import {
  registerGatewayIdentitySynchronizer,
  requireCoordinatedAuthContext,
} from "./authGatewayCoordination";
import { resolveGatewayPort } from "./gatewayEnvironment";

let processService: DesktopProcessService | null = null;
let desktopAppRuntime = {
  isPackaged: false,
  getAppPath: () => process.cwd(),
};

export function configureGatewayPlatform(input: {
  processes: DesktopProcessService;
  appRuntime?: { isPackaged: boolean; getAppPath(): string };
}): void {
  processService = input.processes;
  if (input.appRuntime) desktopAppRuntime = input.appRuntime;
}

const GATEWAY_HOST = "127.0.0.1";
const GATEWAY_PORT = resolveGatewayPort();
const GATEWAY_BASE_URL = `http://${GATEWAY_HOST}:${GATEWAY_PORT}`;
const DEV_MANAGED_EXTERNAL_GATEWAY = process.env.DRSAI_GATEWAY_DEV_MANAGED === "1";
const HOT_RELOAD_GATEWAY = process.env.DRSAI_GATEWAY_HOT_RELOAD === "1";
const GATEWAY_TOKEN_PATH = join(DRSAI_HOME, "runtime", "instance-token");
const GATEWAY_INSTANCE_TOKEN = loadGatewayInstanceToken();
const PERSIST_RUNTIME = !HOT_RELOAD_GATEWAY && process.env.OPENDRSAI_RUNTIME_PERSIST !== "0";
const GATEWAY_START_TIMEOUT_MS = Math.max(5_000, Math.min(120_000,
  Number(process.env.OPENDRSAI_GATEWAY_START_TIMEOUT_MS || "30000") || 30_000));
const GATEWAY_PROBE_TIMEOUT_MS = Math.max(500, Math.min(15_000,
  Number(process.env.OPENDRSAI_GATEWAY_PROBE_TIMEOUT_MS || "2500") || 2_500));
const GATEWAY_PROBE_CACHE_MS = Math.max(0, Math.min(5_000,
  Number(process.env.OPENDRSAI_GATEWAY_PROBE_CACHE_MS || "750") || 750));
const GATEWAY_READY_POLL_MS = 10_000;
let lastSyncedGatewayUserId: string | null = null;
let lastCanonicalizedUserId: string | null = null;
const NODE_PTY_MODULE = (() => {
  try {
    return dirname(dirname(require.resolve("node-pty")));
  } catch {
    return process.env.OPENDRSAI_NODE_PTY_MODULE?.trim() || "";
  }
})();
export type GatewayStartupMode = "on-demand" | "eager" | "external";
let gatewayProcess: ChildProcess | null = null;
let lastGatewayLog = "";
let gatewayStopPromise: Promise<boolean> | null = null;
let gatewayStartPromise: Promise<boolean> | null = null;
let adoptedPersistentRuntime = false;
let gatewaySpawnError: Error | null = null;
let gatewayRegistration: ManagedProcessRegistration | null = null;
let gatewayProbePromise: Promise<GatewayProbe> | null = null;
let gatewayProbeCache: { probe: GatewayProbe; expiresAt: number } | null = null;

interface GatewayEndpointProbe extends GatewayEndpointStatus {
  error?: string;
}

interface GatewayProbe {
  ready: boolean;
  reachable: boolean;
  portOpen: boolean;
  unauthorized: boolean;
  health: GatewayEndpointProbe;
  models: GatewayEndpointProbe;
  diagnosticCode: string;
  diagnosticMessage: string;
}

export type GatewayModelDiscoveryResult =
  | { state: "ready"; models: Array<{ id: string; name: string }> }
  | { state: "auth_expired"; diagnosticCode: string; message: string }
  | { state: "auth_required"; diagnosticCode: string; message: string }
  | { state: "forbidden"; diagnosticCode: string; message: string }
  | { state: "unavailable"; diagnosticCode: string; message: string; retryAfterMs?: number };

function loadGatewayInstanceToken(): string {
  const configured = process.env.OPENDRSAI_GATEWAY_INSTANCE_TOKEN?.trim();
  if (configured) return configured;
  try {
    const existing = readFileSync(GATEWAY_TOKEN_PATH, "utf8").trim();
    if (/^[A-Za-z0-9_-]{32,128}$/.test(existing)) return existing;
  } catch { /* create below */ }
  const generated = randomBytes(32).toString("base64url");
  mkdirSync(dirname(GATEWAY_TOKEN_PATH), { recursive: true });
  writeFileSync(GATEWAY_TOKEN_PATH, generated, { encoding: "utf8", mode: 0o600 });
  return generated;
}

export function getGatewayStartupMode(): GatewayStartupMode {
  const configured = process.env.OPENDRSAI_GATEWAY_STARTUP?.trim().toLowerCase();
  return configured === "eager" || configured === "external" ? configured : "on-demand";
}

export function getGatewayRequestHeaders(): Record<string, string> {
  return { "X-OpenDrSai-Gateway-Token": GATEWAY_INSTANCE_TOKEN };
}

export function checkGatewayReady(): Promise<boolean> {
  if (!isManagedGatewayRunning() && !DEV_MANAGED_EXTERNAL_GATEWAY && !adoptedPersistentRuntime) {
    return Promise.resolve(false);
  }
  return checkGatewayEndpoints();
}

async function checkGatewayEndpoints(): Promise<boolean> {
  return (await probeGatewayEndpoints()).ready;
}

export async function getGatewayStatus(): Promise<GatewayStatus> {
  const probe = await probeGatewayEndpoints();
  // Ownership and health are deliberately independent. A managed Runtime that
  // misses one probe deadline is degraded, not a foreign port occupant.
  const managed = isGatewayOwnershipKnown();
  const externalMode = getGatewayStartupMode() === "external";
  const diagnosticMessage = managed && probe.diagnosticCode === "gateway_probe_timeout"
    ? "The managed OpenDrSai Runtime is busy and did not answer before the probe deadline. Desktop will retry without starting a competing process."
    : probe.diagnosticMessage;
  return {
    ready: managed && probe.ready,
    managed,
    externalReady: probe.ready,
    externalConflict: probe.portOpen && !managed && !externalMode,
    baseUrl: GATEWAY_BASE_URL,
    pid: gatewayProcess?.pid ?? null,
    lastLog: lastGatewayLog,
    portOpen: probe.portOpen,
    diagnosticCode: probe.diagnosticCode,
    diagnosticMessage,
    endpoints: {
      health: publicEndpointStatus(probe.health),
      models: publicEndpointStatus(probe.models),
    },
  };
}

export async function startGateway(): Promise<boolean> {
  if (gatewayStartPromise) return gatewayStartPromise;
  gatewayStartPromise = startGatewayOnce().finally(() => {
    gatewayStartPromise = null;
  });
  return gatewayStartPromise;
}

/**
 * Persist the authenticated Desktop user into cli_config and push it into the
 * local Gateway default identity (env + /v1/config/user-name). Agent runs that
 * omit user_id otherwise fall back to the OS username.
 *
 * Important: PUT /v1/config/cli/user_id evicts live agent sessions. Only call
 * that endpoint when the identity actually changes, never on token refresh.
 */
export async function syncAuthIdentityToGateway(explicitUserId?: string): Promise<string | null> {
  const userId = normalizeDesktopUserId(explicitUserId)
    ?? await resolveAuthenticatedUserId()
    ?? getCliConfigUserId()
    ?? null;
  if (!userId) return null;

  const previousCliUserId = getCliConfigUserId() ?? null;
  const identityChanged = previousCliUserId !== userId || lastSyncedGatewayUserId !== userId;

  try {
    setCliConfigUserId(userId);
  } catch {
    // cli_config write is best-effort; Gateway env/API sync can still help.
  }
  process.env.DRSAI_DESKTOP_USER = userId;
  process.env.DRSAI_USER_ID = userId;

  // Runtime override does not evict agents; safe to refresh on adopt/start.
  await putGatewayJson("/v1/config/user-name", { user_name: userId });

  // cli_config PUT evicts the user's agent pool — only when the id changes.
  if (identityChanged && previousCliUserId !== userId) {
    if (previousCliUserId) rememberUserIdAlias(previousCliUserId, userId);
    await putGatewayJson("/v1/config/cli/user_id", { value: userId });
  }

  lastSyncedGatewayUserId = userId;
  if (identityChanged || lastCanonicalizedUserId !== userId) {
    await canonicalizeHistoricalUserIds(userId, previousCliUserId);
  }
  return userId;
}

registerGatewayIdentitySynchronizer(syncAuthIdentityToGateway);

async function canonicalizeHistoricalUserIds(
  canonicalUserId: string,
  previousCliUserId: string | null,
): Promise<void> {
  let email: string | null = null;
  try {
    email = (await requireCoordinatedAuthContext()).session.user?.email ?? null;
  } catch {
    email = null;
  }
  const aliases = collectMigrationAliases({
    canonicalUserId,
    email,
    previousCliUserId,
  });
  await putGatewayJson("/v1/identity/canonicalize", {
    canonical_user_id: canonicalUserId,
    aliases,
  }, "POST");
  lastCanonicalizedUserId = canonicalUserId;
}

export function getGatewaySnapshot(): GatewayStatus {
  const managed = isGatewayOwnershipKnown();
  const probe = gatewayProbeCache && gatewayProbeCache.expiresAt > Date.now()
    ? gatewayProbeCache.probe
    : undefined;
  const ready = Boolean(managed && probe?.ready);
  return {
    ready,
    managed,
    externalReady: Boolean(probe?.ready),
    externalConflict: Boolean(probe?.portOpen && !managed && getGatewayStartupMode() !== "external"),
    baseUrl: GATEWAY_BASE_URL,
    pid: gatewayProcess?.pid ?? null,
    lastLog: lastGatewayLog,
    portOpen: Boolean(probe?.portOpen),
    diagnosticCode: probe?.diagnosticCode ?? "gateway_not_checked",
    diagnosticMessage: probe?.diagnosticMessage ?? "Gateway has not completed endpoint probing yet.",
    endpoints: probe ? {
      health: publicEndpointStatus(probe.health),
      models: publicEndpointStatus(probe.models),
    } : undefined,
  };
}

async function killPortOccupant(port: string): Promise<boolean> {
  if (process.platform !== "win32") {
    try {
      const result = await new Promise<string>((resolve, reject) => {
        execFile("lsof", ["-ti", `:${port}`], { timeout: 5000 }, (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout.trim());
        });
      });
      const pids = result.split(/\s+/).filter((pid) => pid && /^\d+$/.test(pid));
      if (!pids.length) return false;
      await new Promise<void>((resolve, reject) => {
        execFile("kill", ["-9", ...pids], { timeout: 5000 }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      return true;
    } catch {
      return false;
    }
  }

  try {
    const result = await new Promise<string>((resolve, reject) => {
      execFile(
        "netstat.exe",
        ["-ano", "-p", "TCP"],
        { timeout: 10000, windowsHide: true },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        },
      );
    });
    const lines = result.split(/\r?\n/);
    const portPattern = new RegExp(`:${port}\\s`);
    const killedPids = new Set<string>();
    for (const line of lines) {
      if (!portPattern.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (!pid || !/^\d+$/.test(pid) || pid === "0" || killedPids.has(pid)) continue;
      killedPids.add(pid);
      try {
        await new Promise<void>((resolve, reject) => {
          execFile(
            "taskkill.exe",
            ["/PID", pid, "/F"],
            { timeout: 10000, windowsHide: true },
            (error) => {
              if (error) reject(error);
              else resolve();
            },
          );
        });
      } catch (killError) {
        appendGatewayLog(
          Buffer.from(
            `\nFailed to kill PID ${pid} on port ${port}: ${killError instanceof Error ? killError.message : String(killError)}`,
          ),
        );
      }
    }
    return killedPids.size > 0;
  } catch {
    return false;
  }
}

async function pollGatewayReady(process: ChildProcess | null, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkGatewayReady()) return true;
    if (process && (!isProcessRunning(process) || gatewaySpawnError)) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function startGatewayOnce(): Promise<boolean> {
  if (!managedProcessRegistry.accepting) return false;
  // Ownership can disappear before the short-lived health cache expires when
  // a Runtime is force-terminated. Never adopt a cached response from the
  // dead instance as an external Runtime; startup preflight must observe the
  // port and authenticated health endpoint again.
  gatewayProbeCache = null;
  const desktopUserId = await resolveDesktopUserIdForGateway();
  if (await checkGatewayReady()) {
    if (desktopUserId) await syncAuthIdentityToGateway(desktopUserId);
    return true;
  }
  const preflight = await probeGatewayEndpoints();
  if (getGatewayStartupMode() === "external") {
    if (preflight.ready && desktopUserId) await syncAuthIdentityToGateway(desktopUserId);
    return preflight.ready;
  }
  if (preflight.ready) {
    adoptedPersistentRuntime = true;
    if (desktopUserId) await syncAuthIdentityToGateway(desktopUserId);
    return true;
  }
  if (preflight.portOpen && !isManagedGatewayRunning()) {
    const message = isGatewayOwnershipKnown() && preflight.diagnosticCode === "gateway_probe_timeout"
      ? "The managed OpenDrSai Runtime is busy; Desktop will not start a competing process."
      : preflight.diagnosticMessage;
    appendGatewayLog(Buffer.from(
      `\nGateway port ${GATEWAY_PORT} is occupied but not usable: ${preflight.diagnosticCode}. ${message}`,
    ));
    // Dev bootstrap (DRSAI_GATEWAY_DEV_MANAGED=1) owns the port. A single flaky
    // probe must not abort startup — poll briefly, then adopt when ready.
    if (DEV_MANAGED_EXTERNAL_GATEWAY) {
      const ready = await pollGatewayReady(null, GATEWAY_READY_POLL_MS);
      if (ready) {
        adoptedPersistentRuntime = true;
        if (desktopUserId) await syncAuthIdentityToGateway(desktopUserId);
        return true;
      }
      return false;
    }
    if (getGatewayStartupMode() === "external") return false;
    // Packaged / self-managed Desktop can clear a stale local leftover and respawn.
    const killed = await killPortOccupant(GATEWAY_PORT);
    appendGatewayLog(Buffer.from(
      killed
        ? `\nCleared unusable Gateway occupant on port ${GATEWAY_PORT}; restarting managed Runtime.`
        : `\nFailed to clear Gateway occupant on port ${GATEWAY_PORT}.`,
    ));
    if (!killed) return false;
  }
  if (gatewayProcess && !gatewayProcess.killed) {
    const ready = await pollGatewayReady(gatewayProcess, GATEWAY_READY_POLL_MS);
    if (ready && desktopUserId) await syncAuthIdentityToGateway(desktopUserId);
    return ready;
  }
  if (!existsSync(DRSAI_PYTHON)) return false;

  // uvicorn's Windows reload worker uses a SelectorEventLoop and cannot
  // reliably launch the subprocess-backed Agent backends. Keep the Desktop
  // fallback consistent with scripts/dev.ps1: Windows reloads by restarting
  // the dev command, while other platforms retain source hot reload.
  const args = HOT_RELOAD_GATEWAY && process.platform !== "win32"
    ? [
        "-m",
        "uvicorn",
        "drsai.backend.gateway:app",
        "--host",
        GATEWAY_HOST,
        "--port",
        GATEWAY_PORT,
        "--reload",
      ]
    : ["-m", "drsai.backend.gateway"];

  const localCodexEnv = await getLocalCodexDevelopmentEnv();
  const identityEnv = desktopUserId
    ? { DRSAI_DESKTOP_USER: desktopUserId, DRSAI_USER_ID: desktopUserId }
    : {};

  gatewaySpawnError = null;
  gatewayProcess = spawn(DRSAI_PYTHON, args, {
    cwd: existsSync(DRSAI_REPO) ? DRSAI_REPO : undefined,
    env: {
      ...process.env,
      DRSAI_HOME,
      DRSAI_API_PORT: GATEWAY_PORT,
      PYTHONDONTWRITEBYTECODE: "1",
      OPENDRSAI_GATEWAY_INSTANCE_TOKEN: GATEWAY_INSTANCE_TOKEN,
      ...(NODE_PTY_MODULE ? { OPENDRSAI_NODE_PTY_MODULE: NODE_PTY_MODULE } : {}),
      ...localCodexEnv,
      ...identityEnv,
      PATH: getEnhancedPath(),
    },
    windowsHide: true,
    detached: PERSIST_RUNTIME,
    stdio: PERSIST_RUNTIME ? "ignore" : ["ignore", "pipe", "pipe"],
  });
  if (gatewayProcess.pid) {
    const registeredProcess = gatewayProcess;
    gatewayRegistration = managedProcessRegistry.register({
      id: "gateway:local", kind: "gateway", owner: "desktop-runtime", pid: gatewayProcess.pid, detached: PERSIST_RUNTIME,
      stop: async () => { await terminateGatewayProcessTree(registeredProcess); },
      forceStop: () => { if (!registeredProcess.killed) registeredProcess.kill("SIGKILL"); },
      alive: () => isProcessRunning(registeredProcess),
    });
    if (!PERSIST_RUNTIME) gatewayRegistration.transition("running");
  }
  gatewayProcess.stdout?.on("data", appendGatewayLog);
  gatewayProcess.stderr?.on("data", appendGatewayLog);
  gatewayProcess.once("error", (error) => {
    gatewaySpawnError = error;
    appendGatewayLog(Buffer.from(`\nGateway process failed to start: ${error.message}`));
  });
  gatewayProcess.once("exit", (code, signal) => {
    if (code === 0 || signal === "SIGTERM") gatewayRegistration?.exited(code, signal);
    else gatewayRegistration?.crashed(code, signal);
    gatewayRegistration = null;
    gatewayProcess = null;
    adoptedPersistentRuntime = false;
    gatewayProbeCache = null;
  });
  if (PERSIST_RUNTIME) gatewayProcess.unref();

  const ready = await pollGatewayReady(gatewayProcess, GATEWAY_START_TIMEOUT_MS);
  if (ready) {
    if (desktopUserId) await syncAuthIdentityToGateway(desktopUserId);
    return true;
  }
  if (!gatewaySpawnError && isProcessRunning(gatewayProcess)) {
    lastGatewayLog = `${lastGatewayLog}\nGateway did not become ready within ${GATEWAY_START_TIMEOUT_MS} ms; stopping the spawned process tree.`.slice(-12000);
  }
  const failedProcess = gatewayProcess;
  if (isProcessRunning(failedProcess)) await terminateGatewayProcessTree(failedProcess);
  if (gatewayProcess === failedProcess && !isProcessRunning(failedProcess)) gatewayProcess = null;
  return false;
}

function normalizeDesktopUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || /[\r\n\0]/.test(trimmed) || trimmed.toLowerCase() === "anonymous") {
    return null;
  }
  return trimmed;
}

async function resolveAuthenticatedUserId(): Promise<string | null> {
  try {
    return normalizeDesktopUserId((await requireCoordinatedAuthContext()).userId);
  } catch {
    return null;
  }
}

async function resolveDesktopUserIdForGateway(): Promise<string | null> {
  return normalizeDesktopUserId(process.env.DRSAI_DESKTOP_USER)
    ?? normalizeDesktopUserId(process.env.DRSAI_USER_ID)
    ?? await resolveAuthenticatedUserId()
    ?? getCliConfigUserId()
    ?? null;
}

async function putGatewayJson(
  path: string,
  body: Record<string, unknown>,
  method: "PUT" | "POST" = "PUT",
): Promise<void> {
  try {
    const payload = JSON.stringify(body);
    const response = await fetch(`${GATEWAY_BASE_URL}${path}`, {
      method,
      headers: {
        ...getGatewayRequestHeaders(),
        "Content-Type": "application/json",
      },
      body: payload,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      appendGatewayLog(Buffer.from(`\nGateway identity sync failed for ${path}: HTTP ${response.status}`));
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    appendGatewayLog(Buffer.from(`\nGateway identity sync failed for ${path}: ${detail}`));
  }
}

/**
 * Development Desktop builds reuse the user's local Codex installation. A
 * packaged release continues to use the signed managed artifact installed by
 * the Runtime package, so this discovery cannot weaken the release trust path.
 */
async function getLocalCodexDevelopmentEnv(): Promise<Record<string, string>> {
  if (desktopAppRuntime.isPackaged || process.env.DRSAI_CODEX_DEVELOPMENT === "0") return {};
  const configured = process.env.CODEX_BIN?.trim();
  const projectBinary = process.platform === "win32"
    ? join(desktopAppRuntime.getAppPath(), "node_modules", ".bin", "codex.cmd")
    : join(desktopAppRuntime.getAppPath(), "node_modules", ".bin", "codex");
  const binary = configured || (existsSync(projectBinary) ? projectBinary : await findCommandOnPath("codex"));
  if (!binary) return {};
  return { DRSAI_CODEX_DEVELOPMENT: "1", CODEX_BIN: binary };
}

function findCommandOnPath(command: string): Promise<string | null> {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  return new Promise((resolve) => {
    execFile(locator, [command], {
      env: { ...process.env, PATH: getEnhancedPath() },
      timeout: 5000,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const candidates = stdout.toString().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      // Windows Store application-package members may be listed by `where`
      // while remaining inaccessible to an external Runtime process. Never
      // advertise those aliases as an operational Backend executable.
      const accessible = candidates.filter((candidate) => !/\\WindowsApps\\/i.test(candidate));
      const selected = accessible.find((candidate) => process.platform !== "win32" || /\.(?:exe|cmd)$/i.test(candidate))
        ?? accessible[0];
      resolve(selected && existsSync(selected) ? selected : null);
    });
  });
}
function isManagedGatewayRunning(): boolean {
  return Boolean(gatewayProcess && gatewayProcess.pid && !gatewayProcess.killed);
}

function isGatewayOwnershipKnown(): boolean {
  return isManagedGatewayRunning()
    || adoptedPersistentRuntime
    || DEV_MANAGED_EXTERNAL_GATEWAY
    || getGatewayStartupMode() === "external";
}

function appendGatewayLog(chunk: Buffer): void {
  lastGatewayLog = redactSensitiveData(redactDesktopSecrets(`${lastGatewayLog}${chunk.toString()}`)).slice(-12000);
}

async function probeGatewayEndpoints(): Promise<GatewayProbe> {
  const now = Date.now();
  if (gatewayProbeCache && gatewayProbeCache.expiresAt > now) return gatewayProbeCache.probe;
  if (gatewayProbePromise) return gatewayProbePromise;
  gatewayProbePromise = probeGatewayEndpointsOnce().then((probe) => {
    gatewayProbeCache = { probe, expiresAt: Date.now() + GATEWAY_PROBE_CACHE_MS };
    return probe;
  }).finally(() => {
    gatewayProbePromise = null;
  });
  return gatewayProbePromise;
}

async function probeGatewayEndpointsOnce(): Promise<GatewayProbe> {
  // Liveness must stay independent from model discovery. The model endpoint
  // may initialize providers or contact remote services, while /health is a
  // cheap process-readiness contract.
  const health = await requestJson(`${GATEWAY_BASE_URL}/health`, getGatewayRequestHeaders());
  const models: GatewayEndpointProbe = { ok: false, statusCode: null, state: "not_checked" };
  const ready = Boolean(health.ok && health.body?.status === "ok");
  const reachable = health.statusCode !== null;
  const portOpen = reachable || await isTcpPortOpen(GATEWAY_HOST, Number(GATEWAY_PORT));
  const unauthorized = health.state === "unauthorized";
  const authenticatedResponse = !unauthorized && health.statusCode !== null;
  if (authenticatedResponse && !DEV_MANAGED_EXTERNAL_GATEWAY && getGatewayStartupMode() !== "external") {
    // A response accepted the installation-scoped instance token. Preserve
    // that ownership across later busy/timeout probes for persistent Runtime.
    adoptedPersistentRuntime = true;
  }
  const diagnosticCode = ready ? "gateway_ready"
    : unauthorized ? "gateway_unauthorized"
    : health.state === "timeout" ? "gateway_probe_timeout"
    : !reachable && portOpen ? "gateway_port_occupied"
    : !reachable ? "gateway_unreachable"
    : !health.ok ? `gateway_health_${health.state}`
    : health.body?.status !== "ok" ? "gateway_health_invalid_response"
    : "gateway_unavailable";
  const diagnosticMessage = ready ? "Gateway health endpoint is ready; model availability is checked separately."
    : unauthorized ? "A process is listening on the Gateway port, but it rejected this Desktop instance token."
    : !reachable && portOpen ? "A non-OpenDrSai process is listening on the Gateway port."
    : !reachable ? "No process responded on the Gateway port."
    : `Gateway /health is not ready (${health.state}${health.statusCode ? ` ${health.statusCode}` : ""}).`;
  return { ready, reachable, portOpen, unauthorized, health, models, diagnosticCode, diagnosticMessage };
}

function isTcpPortOpen(host: string, port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = connectTcp({ host, port });
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(300, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function publicEndpointStatus(endpoint: GatewayEndpointProbe): GatewayEndpointStatus {
  return { ok: endpoint.ok, statusCode: endpoint.statusCode, state: endpoint.state };
}

function requestJson(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = GATEWAY_PROBE_TIMEOUT_MS,
): Promise<GatewayEndpointProbe & { body: Record<string, unknown> | null }> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const finish = (result: GatewayEndpointProbe & { body: Record<string, unknown> | null }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const req = get(url, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body = `${body}${chunk}`.slice(0, 64 * 1024);
      });
      res.on("end", () => {
        const statusCode = res.statusCode ?? null;
        let parsedBody: Record<string, unknown> | null = null;
        try {
          const parsed = JSON.parse(body);
          parsedBody = typeof parsed === "object" && parsed !== null ? parsed : null;
        } catch { /* Preserve the HTTP status even if the error body is not JSON. */ }
        if (res.statusCode !== 200) {
          finish({
            ok: false,
            body: parsedBody,
            statusCode,
            state: statusCode === 401 || statusCode === 403 ? "unauthorized" : "http_error",
          });
          return;
        }
        if (parsedBody) {
          finish({ ok: true, body: parsedBody, statusCode, state: "ok" });
        } else {
          finish({ ok: false, body: null, statusCode, state: "invalid_response" });
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      timedOut = true;
      req.destroy();
      finish({ ok: false, body: null, statusCode: null, state: "timeout" });
    });
    req.on("error", (error) => finish({
      ok: false,
      body: null,
      statusCode: null,
      state: timedOut ? "timeout" : "unreachable",
      error: error.message,
    }));
  });
}

export async function stopGateway(): Promise<boolean> {
  if (gatewayStartPromise) await gatewayStartPromise.catch(() => false);
  if (gatewayStopPromise) return gatewayStopPromise;
  const proc = gatewayProcess;
  if (!isProcessRunning(proc)) {
    if (adoptedPersistentRuntime && await checkGatewayEndpoints().then((value) => value)) {
      const stopped = await requestRuntimeShutdown();
      if (stopped) {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline && await checkGatewayEndpoints()) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      const killed = !(await checkGatewayEndpoints()) || await killPortOccupant(GATEWAY_PORT);
      if (killed) adoptedPersistentRuntime = false;
      return killed;
    }
    return false;
  }

  gatewayStopPromise = terminateGatewayProcessTree(proc).finally(() => {
    if (gatewayProcess === proc && !isProcessRunning(proc)) gatewayProcess = null;
    gatewayStopPromise = null;
  });
  return gatewayStopPromise;
}

export async function discoverGatewayModels(
  accessToken: string,
): Promise<GatewayModelDiscoveryResult> {
  const response = await requestJson(`${GATEWAY_BASE_URL}/v1/models`, {
    ...getGatewayRequestHeaders(),
    Authorization: `Bearer ${accessToken}`,
    "X-OpenDrSai-Auth-Mode": "oidc",
  }, 5_000);
  if (!response.ok) {
    const error = readGatewayError(response.body);
    if (response.statusCode === 401) {
      return {
        state: error.code === "token_expired" ? "auth_expired" : "auth_required",
        diagnosticCode: error.code || "model_catalog_unauthorized",
        message: error.message || "The HepAI authentication context is not valid.",
      };
    }
    if (response.statusCode === 403) {
      return {
        state: "forbidden",
        diagnosticCode: error.code || "model_catalog_forbidden",
        message: error.message || "This HepAI account cannot use the model service.",
      };
    }
    return {
      state: "unavailable",
      diagnosticCode: error.code || `model_catalog_${response.state}`,
      message: error.message || "The HepAI model catalog is temporarily unavailable.",
    };
  }
  if (!Array.isArray(response.body?.data)) {
    return {
      state: "unavailable",
      diagnosticCode: "model_catalog_invalid_response",
      message: "The HepAI model catalog returned an invalid response.",
    };
  }
  const models = response.body.data.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id.trim()) return [];
    const id = row.id.trim();
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : id;
    return [{ id, name }];
  });
  return { state: "ready", models };
}

export async function getGatewayModels(
  accessToken: string,
): Promise<Array<{ id: string; name: string }>> {
  const result = await discoverGatewayModels(accessToken);
  return result.state === "ready" ? result.models : [];
}

function readGatewayError(body: Record<string, unknown> | null): { code: string; message: string } {
  const raw = body?.error ?? body?.detail;
  if (!raw || typeof raw !== "object") return { code: "", message: "" };
  const error = raw as Record<string, unknown>;
  return {
    code: typeof error.code === "string" ? error.code.slice(0, 120) : "",
    message: typeof error.message === "string" ? error.message.slice(0, 500) : "",
  };
}

export async function shutdownGateway(preserveRuntime = false): Promise<boolean> {
  if (preserveRuntime && PERSIST_RUNTIME && (isManagedGatewayRunning() || adoptedPersistentRuntime)) {
    gatewayProcess?.unref();
    gatewayProcess = null;
    adoptedPersistentRuntime = true;
    return true;
  }
  return stopGateway();
}

async function requestRuntimeShutdown(): Promise<boolean> {
  try {
    const response = await fetch(`${GATEWAY_BASE_URL}/v1/runtime/shutdown`, {
      method: "POST", headers: getGatewayRequestHeaders(), signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch { return false; }
}

function isProcessRunning(proc: ChildProcess | null): proc is ChildProcess {
  return Boolean(proc?.pid && proc.exitCode === null && proc.signalCode === null);
}

async function terminateGatewayProcessTree(proc: ChildProcess): Promise<boolean> {
  if (!isProcessRunning(proc)) return true;

  if (processService && proc.pid) {
    let treeTerminationSucceeded = true;
    await processService.terminateTree(proc.pid).catch((error: unknown) => {
      treeTerminationSucceeded = false;
      appendGatewayLog(Buffer.from(`\nFailed to terminate Gateway process tree: ${error instanceof Error ? error.message : String(error)}`));
    });
    const exited = await waitForProcessExit(proc, 5000);
    if (exited) return treeTerminationSucceeded || proc.exitCode !== null;
    appendGatewayLog(Buffer.from(`\nGateway PID ${proc.pid} did not exit after platform tree termination; trying direct termination.`));
    proc.kill();
    if (await waitForProcessExit(proc, 2000)) return true;
    appendGatewayLog(Buffer.from(`\nGateway PID ${proc.pid} is still running after all termination attempts.`));
    return false;
  }

  proc.kill("SIGTERM");
  if (await waitForProcessExit(proc, 5000)) return true;
  proc.kill("SIGKILL");
  return waitForProcessExit(proc, 2000);
}

function waitForProcessExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (!isProcessRunning(proc)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(!isProcessRunning(proc)), timeoutMs);
    proc.once("exit", onExit);
  });
}
