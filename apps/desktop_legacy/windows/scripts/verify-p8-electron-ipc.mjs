import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const desktop = resolve(import.meta.dirname, "..");
const repo = resolve(desktop, "../../..");
const electronExecutable = require("electron");
const temporary = mkdtempSync(join(tmpdir(), "opendrsai-p8-ipc-"));
const resultPath = join(temporary, "result.json");
const appHome = join(temporary, "home");
const logPath = join(temporary, "electron.log");
const log = openSync(logPath, "w");
let succeeded = false;
const gatewayPort = String(26000 + process.pid % 10000);
const child = spawnSync(electronExecutable, [desktop, `--user-data-dir=${join(temporary, "user-data")}`], {
  cwd: desktop,
  env: { ...process.env, DRSAI_HOME: appHome, DRSAI_REPO: repo, DRSAI_GATEWAY_DEV_MANAGED: "0",
    OPENDRSAI_DEV_HOME: appHome, OPENDRSAI_DEV_GATEWAY_PORT: gatewayPort,
    OPENDRSAI_GATEWAY_STARTUP: "external", OPENDRSAI_GATEWAY_INSTANCE_TOKEN: "p8-electron-ipc-test-token",
    OPENDRSAI_GATEWAY_PORT: gatewayPort, OPENDRSAI_DEV_AUTH_BYPASS: "1",
    OPENDRSAI_E2E_P8_IPC: "1", OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_E2E_TIMEOUT_MS: "60000",
    OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_DISABLE_SCHEDULED_TASK_WORKER: "1" },
  stdio: ["ignore", log, log], windowsHide: true, timeout: 75_000,
});
closeSync(log);
try {
  if (!existsSync(resultPath)) throw new Error(`P8 Electron IPC produced no result (${child.status}; ${child.error?.message || "unknown"}).\n${readFileSync(logPath, "utf8").slice(-12000)}`);
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  if (child.status !== 0 || result.ok !== true || !Object.values(result.checks || {}).every(Boolean)) {
    throw new Error(`P8 Electron IPC failed (${child.status}).\n${JSON.stringify(result, null, 2)}\n${readFileSync(logPath, "utf8").slice(-12000)}`);
  }
  const artifact = join(repo, ".artifacts", "codex-p8-electron-ipc.json");
  mkdirSync(resolve(artifact, ".."), { recursive: true });
  writeFileSync(artifact, `${JSON.stringify({ ...result, observedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  succeeded = true;
  console.log(JSON.stringify(result));
} finally {
  if (succeeded || process.env.OPENDRSAI_KEEP_FAILED_E2E !== "1") rmSync(temporary, { recursive: true, force: true });
  else console.error(`Failed E2E retained at ${temporary}`);
}
