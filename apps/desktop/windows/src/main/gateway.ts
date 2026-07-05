import { spawn, type ChildProcess } from "child_process";
import { get } from "http";
import { existsSync } from "fs";
import type { GatewayStatus } from "../shared/desktopApi";
import { DRSAI_HOME, DRSAI_PYTHON, DRSAI_REPO, getEnhancedPath } from "./paths";

const GATEWAY_HOST = "127.0.0.1";
const GATEWAY_PORT = getGatewayPort();
const GATEWAY_BASE_URL = `http://${GATEWAY_HOST}:${GATEWAY_PORT}`;
const DEV_MANAGED_EXTERNAL_GATEWAY = process.env.DRSAI_GATEWAY_DEV_MANAGED === "1";
const HOT_RELOAD_GATEWAY = process.env.DRSAI_GATEWAY_HOT_RELOAD === "1";
let gatewayProcess: ChildProcess | null = null;
let lastGatewayLog = "";

export function checkGatewayReady(): Promise<boolean> {
  if (!isManagedGatewayRunning() && !DEV_MANAGED_EXTERNAL_GATEWAY) {
    return Promise.resolve(false);
  }
  return checkGatewayEndpoints();
}

function checkGatewayEndpoints(): Promise<boolean> {
  return Promise.all([
    requestJson(`${GATEWAY_BASE_URL}/health`),
    requestJson(`${GATEWAY_BASE_URL}/v1/models`),
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
  const managed = processManaged || (DEV_MANAGED_EXTERNAL_GATEWAY && externalReady);
  return {
    ready: managed && externalReady,
    managed,
    externalReady,
    externalConflict: externalReady && !managed,
    baseUrl: GATEWAY_BASE_URL,
    pid: gatewayProcess?.pid ?? null,
    lastLog: lastGatewayLog,
  };
}

export async function startGateway(): Promise<boolean> {
  if (await checkGatewayReady()) return true;
  if (await checkGatewayEndpoints()) {
    lastGatewayLog = `${lastGatewayLog}\nRefusing to use an unmanaged service already listening on ${GATEWAY_BASE_URL}. Stop that process and start the OpenDrSai gateway from the desktop app.`.slice(-12000);
    return false;
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
): Promise<{ ok: boolean; body: Record<string, unknown> | null }> {
  return new Promise((resolve) => {
    const req = get(url, (res) => {
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
  if (gatewayProcess && !gatewayProcess.killed) {
    killGatewayProcessTree(gatewayProcess);
    gatewayProcess = null;
    return true;
  }
  return false;
}

export function shutdownGateway(): void {
  if (!gatewayProcess || gatewayProcess.killed) return;
  killGatewayProcessTree(gatewayProcess);
  gatewayProcess = null;
}

function killGatewayProcessTree(proc: ChildProcess): void {
  if (process.platform === "win32" && proc.pid) {
    spawn("taskkill.exe", ["/PID", String(proc.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  proc.kill();
}

function getGatewayPort(): string {
  const rawPort = process.env.OPENDRSAI_GATEWAY_PORT || process.env.DRSAI_API_PORT || "8642";
  const parsed = Number(rawPort);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? String(parsed) : "8642";
}
