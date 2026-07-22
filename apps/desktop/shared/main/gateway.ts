import { execFile, spawn, type ChildProcess } from "child_process";
import { randomBytes } from "crypto";
import { get } from "http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { GatewayStatus } from "../api/desktopApi";
import type { DesktopProcessService } from "../api";
import { DRSAI_HOME, DRSAI_PYTHON, DRSAI_REPO, getEnhancedPath } from "./paths";
import { redactDesktopSecrets } from "./secretRedaction";

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
const GATEWAY_PORT = getGatewayPort();
const GATEWAY_BASE_URL = `http://${GATEWAY_HOST}:${GATEWAY_PORT}`;
const DEV_MANAGED_EXTERNAL_GATEWAY = process.env.DRSAI_GATEWAY_DEV_MANAGED === "1";
const HOT_RELOAD_GATEWAY = process.env.DRSAI_GATEWAY_HOT_RELOAD === "1";
const GATEWAY_TOKEN_PATH = join(DRSAI_HOME, "runtime", "instance-token");
const GATEWAY_INSTANCE_TOKEN = loadGatewayInstanceToken();
const PERSIST_RUNTIME = !HOT_RELOAD_GATEWAY && process.env.OPENDRSAI_RUNTIME_PERSIST !== "0";
const GATEWAY_START_TIMEOUT_MS = Math.max(5_000, Math.min(120_000,
  Number(process.env.OPENDRSAI_GATEWAY_START_TIMEOUT_MS || "30000") || 30_000));
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

function checkGatewayEndpoints(): Promise<boolean> {
  return Promise.all([
    requestJson(`${GATEWAY_BASE_URL}/health`, getGatewayRequestHeaders()),
    requestJson(`${GATEWAY_BASE_URL}/v1/models`, getGatewayRequestHeaders()),
  ]).then(([health, models]) =>
    Boolean(
      health.ok &&
        models.ok &&
        models.body &&
        models.body.object === "list" &&
        Array.isArray(models.body.data),
    ),
  );
}

export async function getGatewayStatus(): Promise<GatewayStatus> {
  const externalReady = await checkGatewayEndpoints();
  const processManaged = isManagedGatewayRunning();
  const externalMode = getGatewayStartupMode() === "external";
  const managed = processManaged || adoptedPersistentRuntime || ((DEV_MANAGED_EXTERNAL_GATEWAY || externalMode) && externalReady);
  return {
    ready: managed && externalReady,
    managed,
    externalReady,
    externalConflict: externalReady && !managed && !externalMode,
    baseUrl: GATEWAY_BASE_URL,
    pid: gatewayProcess?.pid ?? null,
    lastLog: lastGatewayLog,
  };
}

export async function startGateway(): Promise<boolean> {
  if (gatewayStartPromise) return gatewayStartPromise;
  gatewayStartPromise = startGatewayOnce().finally(() => {
    gatewayStartPromise = null;
  });
  return gatewayStartPromise;
}

export function getGatewaySnapshot(): GatewayStatus {
  const processManaged = isManagedGatewayRunning();
  return {
    ready: false,
    managed: processManaged,
    externalReady: false,
    externalConflict: false,
    baseUrl: GATEWAY_BASE_URL,
    pid: gatewayProcess?.pid ?? null,
    lastLog: lastGatewayLog,
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

async function startGatewayOnce(): Promise<boolean> {
  if (await checkGatewayReady()) return true;
  const externalReady = await checkGatewayEndpoints();
  if (getGatewayStartupMode() === "external") {
    return externalReady;
  }
  if (externalReady) {
    adoptedPersistentRuntime = true;
    return true;
  }
  if (gatewayProcess && !gatewayProcess.killed) return false;
  if (!existsSync(DRSAI_PYTHON)) return false;

  const args = HOT_RELOAD_GATEWAY
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

  gatewaySpawnError = null;
  gatewayProcess = spawn(DRSAI_PYTHON, args, {
    cwd: existsSync(DRSAI_REPO) ? DRSAI_REPO : undefined,
    env: {
      ...process.env,
      DRSAI_HOME,
      DRSAI_API_PORT: GATEWAY_PORT,
      OPENDRSAI_GATEWAY_INSTANCE_TOKEN: GATEWAY_INSTANCE_TOKEN,
      ...(NODE_PTY_MODULE ? { OPENDRSAI_NODE_PTY_MODULE: NODE_PTY_MODULE } : {}),
      ...localCodexEnv,
      PATH: getEnhancedPath(),
    },
    windowsHide: true,
    detached: PERSIST_RUNTIME,
    stdio: PERSIST_RUNTIME ? "ignore" : ["ignore", "pipe", "pipe"],
  });
  gatewayProcess.stdout?.on("data", appendGatewayLog);
  gatewayProcess.stderr?.on("data", appendGatewayLog);
  gatewayProcess.once("error", (error) => {
    gatewaySpawnError = error;
    appendGatewayLog(Buffer.from(`\nGateway process failed to start: ${error.message}`));
  });
  gatewayProcess.once("exit", () => {
    gatewayProcess = null;
    adoptedPersistentRuntime = false;
  });
  if (PERSIST_RUNTIME) gatewayProcess.unref();

  const deadline = Date.now() + GATEWAY_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await checkGatewayReady()) return true;
    if (gatewaySpawnError || !isProcessRunning(gatewayProcess)) {
      appendGatewayLog(Buffer.from("\nGateway exited before its health checks became ready."));
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  lastGatewayLog = `${lastGatewayLog}\nGateway did not become ready within ${GATEWAY_START_TIMEOUT_MS} ms; stopping the spawned process tree.`.slice(-12000);
  // Do not call stopGateway() here: startGateway() still owns
  // gatewayStartPromise, and the public stop path waits for that promise.
  const failedProcess = gatewayProcess;
  if (isProcessRunning(failedProcess)) await terminateGatewayProcessTree(failedProcess);
  if (gatewayProcess === failedProcess && !isProcessRunning(failedProcess)) gatewayProcess = null;
  return false;
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

function appendGatewayLog(chunk: Buffer): void {
  lastGatewayLog = redactDesktopSecrets(`${lastGatewayLog}${chunk.toString()}`).slice(-12000);
}

function requestJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; body: Record<string, unknown> | null }> {
  return new Promise((resolve) => {
    const req = get(url, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body = `${body}${chunk}`.slice(0, 64 * 1024);
      });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          resolve({ ok: false, body: null });
          return;
        }
        try {
          const parsed = JSON.parse(body);
          resolve({
            ok: true,
            body: typeof parsed === "object" && parsed !== null ? parsed : null,
          });
        } catch {
          resolve({ ok: false, body: null });
        }
      });
    });
    req.setTimeout(1200, () => {
      req.destroy();
      resolve({ ok: false, body: null });
    });
    req.on("error", () => resolve({ ok: false, body: null }));
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

export async function getGatewayModels(
  accessToken: string,
): Promise<Array<{ id: string; name: string }>> {
  const response = await requestJson(`${GATEWAY_BASE_URL}/v1/models`, {
    ...getGatewayRequestHeaders(),
    Authorization: `Bearer ${accessToken}`,
    "X-OpenDrSai-Auth-Mode": "oidc",
  });
  if (!response.ok || !Array.isArray(response.body?.data)) return [];
  return response.body.data.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id.trim()) return [];
    const id = row.id.trim();
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : id;
    return [{ id, name }];
  });
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

function getGatewayPort(): string {
  const rawPort = process.env.OPENDRSAI_GATEWAY_PORT || process.env.DRSAI_API_PORT || "18642";
  const parsed = Number(rawPort);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? String(parsed) : "18642";
}
