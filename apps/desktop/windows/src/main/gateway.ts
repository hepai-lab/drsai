import { execFile, spawn, type ChildProcess } from "child_process";
import { randomBytes } from "crypto";
import { get } from "http";
import { existsSync } from "fs";
import type { GatewayStatus } from "../shared/desktopApi";
import { DRSAI_HOME, DRSAI_PYTHON, DRSAI_REPO, getEnhancedPath } from "./paths";

const GATEWAY_HOST = "127.0.0.1";
const GATEWAY_PORT = getGatewayPort();
const GATEWAY_BASE_URL = `http://${GATEWAY_HOST}:${GATEWAY_PORT}`;
const DEV_MANAGED_EXTERNAL_GATEWAY = process.env.DRSAI_GATEWAY_DEV_MANAGED === "1";
const HOT_RELOAD_GATEWAY = process.env.DRSAI_GATEWAY_HOT_RELOAD === "1";
const GATEWAY_INSTANCE_TOKEN =
  process.env.OPENDRSAI_GATEWAY_INSTANCE_TOKEN?.trim() || randomBytes(32).toString("base64url");
export type GatewayStartupMode = "on-demand" | "eager" | "external";
let gatewayProcess: ChildProcess | null = null;
let lastGatewayLog = "";
let gatewayStopPromise: Promise<boolean> | null = null;
let gatewayStartPromise: Promise<boolean> | null = null;

export function getGatewayStartupMode(): GatewayStartupMode {
  const configured = process.env.OPENDRSAI_GATEWAY_STARTUP?.trim().toLowerCase();
  return configured === "eager" || configured === "external" ? configured : "on-demand";
}

export function getGatewayRequestHeaders(): Record<string, string> {
  return { "X-OpenDrSai-Gateway-Token": GATEWAY_INSTANCE_TOKEN };
}

export function checkGatewayReady(): Promise<boolean> {
  if (!isManagedGatewayRunning() && !DEV_MANAGED_EXTERNAL_GATEWAY) {
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
  const managed = processManaged || ((DEV_MANAGED_EXTERNAL_GATEWAY || externalMode) && externalReady);
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
    if (gatewayProcess && !gatewayProcess.killed) {
      lastGatewayLog = `${lastGatewayLog}\nA managed gateway process is already running but the ready check failed.`.slice(-12000);
      return false;
    }
    lastGatewayLog = `${lastGatewayLog}\nAn unmanaged service is already listening on ${GATEWAY_BASE_URL}. Attempting to reclaim the port.`.slice(-12000);
    const killed = await killPortOccupant(GATEWAY_PORT);
    if (killed) {
      lastGatewayLog = `${lastGatewayLog}\nReclaimed port ${GATEWAY_PORT} from the previous occupant.`.slice(-12000);
      await new Promise((resolve) => setTimeout(resolve, 500));
    } else {
      lastGatewayLog = `${lastGatewayLog}\nCould not reclaim port ${GATEWAY_PORT}. Stop the process listening on ${GATEWAY_BASE_URL} and try again.`.slice(-12000);
      return false;
    }
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

  gatewayProcess = spawn(DRSAI_PYTHON, args, {
    cwd: existsSync(DRSAI_REPO) ? DRSAI_REPO : undefined,
    env: {
      ...process.env,
      DRSAI_HOME,
      DRSAI_API_PORT: GATEWAY_PORT,
      OPENDRSAI_GATEWAY_INSTANCE_TOKEN: GATEWAY_INSTANCE_TOKEN,
      PATH: getEnhancedPath(),
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  gatewayProcess.stdout?.on("data", appendGatewayLog);
  gatewayProcess.stderr?.on("data", appendGatewayLog);
  gatewayProcess.once("exit", () => {
    gatewayProcess = null;
  });

  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await checkGatewayReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  lastGatewayLog = `${lastGatewayLog}\nGateway did not become ready within 12 seconds; stopping the spawned process tree.`.slice(-12000);
  // Do not call stopGateway() here: startGateway() still owns
  // gatewayStartPromise, and the public stop path waits for that promise.
  const failedProcess = gatewayProcess;
  if (isProcessRunning(failedProcess)) await terminateGatewayProcessTree(failedProcess);
  if (gatewayProcess === failedProcess && !isProcessRunning(failedProcess)) gatewayProcess = null;
  return false;
}

function isManagedGatewayRunning(): boolean {
  return Boolean(gatewayProcess && gatewayProcess.pid && !gatewayProcess.killed);
}

function appendGatewayLog(chunk: Buffer): void {
  lastGatewayLog = `${lastGatewayLog}${chunk.toString()}`.slice(-12000);
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
  if (!isProcessRunning(proc)) return false;

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

export async function shutdownGateway(): Promise<boolean> {
  return stopGateway();
}

function isProcessRunning(proc: ChildProcess | null): proc is ChildProcess {
  return Boolean(proc?.pid && proc.exitCode === null && proc.signalCode === null);
}

async function terminateGatewayProcessTree(proc: ChildProcess): Promise<boolean> {
  if (!isProcessRunning(proc)) return true;

  if (process.platform === "win32" && proc.pid) {
    const result = await new Promise<{ code: number | null; error?: Error }>((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(proc.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      killer.stderr?.on("data", (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-4000);
      });
      killer.once("error", (error) => resolve({ code: null, error }));
      killer.once("close", (code) => {
        if (code !== 0 && stderr.trim()) appendGatewayLog(Buffer.from(`\ntaskkill failed: ${stderr.trim()}`));
        resolve({ code });
      });
    });
    if (result.error) appendGatewayLog(Buffer.from(`\nFailed to launch taskkill: ${result.error.message}`));
    const exited = await waitForProcessExit(proc, 5000);
    if (exited) return result.code === 0 || proc.exitCode !== null;
    appendGatewayLog(Buffer.from(`\nGateway PID ${proc.pid} did not exit after taskkill; trying direct termination.`));
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
