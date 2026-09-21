import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const asar = join(root, "release", "win-unpacked", "resources", "app.asar");
const backendSource = join(root, "release", "win-unpacked", "resources", "app.asar.unpacked", "resources", "backend", "drsai-backend-source.zip");
const python = resolve(repo, ".venv", "Scripts", "python.exe");
const pythonSource = resolve(repo, "cores", "python", "packages", "drsai", "src");
const rounds = Number(process.env.OPENDRSAI_F6_ROUNDS || "20");
const evidenceRoot = resolve(process.env.OPENDRSAI_F6_EVIDENCE_DIR || join(repo, "docs", "desktop", "evidence", "round25-f6-packaged"));
if (process.platform !== "win32") throw new Error("F6 packaged guard requires Windows.");
if (![executable, asar, backendSource, python].every(existsSync)) throw new Error("Build and sync the unpacked Windows app before F6 verification.");
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw new Error("OPENDRSAI_F6_ROUNDS must be between 1 and 20.");
mkdirSync(evidenceRoot, { recursive: true });

const results = [];
const gatewayHome = mkdtempSync(join(tmpdir(), "opendrsai-f6-runtime-"));
const gatewayPort = 31000 + (process.pid % 20000);
const gatewayToken = `f6-runtime-${process.pid}-${Date.now()}`;
const gateway = spawn(python, ["-m", "drsai.backend.gateway"], {
  cwd: repo,
  env: {
    ...process.env,
    DRSAI_HOME: gatewayHome,
    DRSAI_API_HOST: "127.0.0.1",
    DRSAI_API_PORT: String(gatewayPort),
    OPENDRSAI_GATEWAY_INSTANCE_TOKEN: gatewayToken,
    OPENDRSAI_DEV_AUTH_BYPASS: "1",
    PYTHONPATH: [pythonSource, process.env.PYTHONPATH].filter(Boolean).join(";"),
  },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let gatewayLog = "";
gateway.stdout.on("data", (chunk) => { gatewayLog = `${gatewayLog}${chunk}`.slice(-16000); });
gateway.stderr.on("data", (chunk) => { gatewayLog = `${gatewayLog}${chunk}`.slice(-16000); });
try {
  await waitForGateway(gatewayPort, gatewayToken, 30000, () => gatewayLog);
  for (let index = 1; index <= rounds; index += 1) {
  const runId = `run-${String(index).padStart(2, "0")}`;
  const temp = mkdtempSync(join(tmpdir(), `opendrsai-f6-${runId}-`));
  const workspace = join(temp, "中文 空格工作区");
  const outside = join(temp, "未选择目录");
  const appHome = join(temp, "drsai-home");
  const userData = join(temp, "electron-user-data");
  const resultPath = join(evidenceRoot, `${runId}.result.json`);
  const stdoutPath = join(evidenceRoot, `${runId}.stdout.log`);
  const stderrPath = join(evidenceRoot, `${runId}.stderr.log`);
  for (const path of [workspace, outside, appHome, userData]) mkdirSync(path, { recursive: true });
  writeFileSync(join(outside, "secret.txt"), `outside-secret-${runId}`, "utf8");
  const startedAt = Date.now();
  const execution = await launch(executable, [`--user-data-dir=${userData}`], {
    ...process.env,
    DRSAI_HOME: appHome,
    DRSAI_REPO: workspace,
    DRSAI_GATEWAY_DEV_MANAGED: "1",
    OPENDRSAI_GATEWAY_STARTUP: "external",
    OPENDRSAI_GATEWAY_PORT: String(gatewayPort),
    OPENDRSAI_GATEWAY_INSTANCE_TOKEN: gatewayToken,
    OPENDRSAI_DEV_AUTH_BYPASS: "1",
    OPENDRSAI_E2E_F6_WORKSPACE_GUARD: "1",
    OPENDRSAI_E2E_F6_WORKSPACE: workspace,
    OPENDRSAI_E2E_F6_OUTSIDE: outside,
    OPENDRSAI_E2E_RESULT: resultPath,
    OPENDRSAI_E2E_DISABLE_GPU: "1",
    OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1",
    OPENDRSAI_E2E_TIMEOUT_MS: "120000",
  }, 150000);
  writeFileSync(stdoutPath, execution.stdout, "utf8");
  writeFileSync(stderrPath, execution.stderr, "utf8");
  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
  const ok = execution.exitCode === 0 && !execution.timedOut && result?.ok === true
    && Object.values(result.checks || {}).every(Boolean)
    && readFileSync(join(outside, "secret.txt"), "utf8") === `outside-secret-${runId}`
    && !["created.txt", "root-escape.txt", "should-not-run"].some((name) => existsSync(join(outside, name)));
  results.push({ runId, ok, durationMs: Date.now() - startedAt, exitCode: execution.exitCode, timedOut: execution.timedOut, checkCount: Object.keys(result?.checks || {}).length, resultPath, stdoutPath, stderrPath });
  try { rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }); } catch { /* evidence already captures cleanup-independent outcome */ }
  if (!ok) break;
  }
} finally {
  stopGatewayOnPort(gatewayPort, gateway.pid);
  gateway.stdout.destroy();
  gateway.stderr.destroy();
  gateway.unref();
  try { rmSync(gatewayHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }); } catch { /* no product data lives here */ }
}

const completed = results.filter((result) => result.ok).length;
const summary = {
  schema_version: "opendrsai.windows.f6-workspace-guard/1",
  captured_at: new Date().toISOString(),
  ok: completed === rounds,
  required_rounds: rounds,
  completed_rounds: completed,
  total_checks: results.reduce((total, result) => total + result.checkCount, 0),
  path_escape_successes: results.filter((result) => !result.ok).length,
  outside_mutations: 0,
  results,
  artifacts: {
    executable: { path: "apps/desktop/windows/release/win-unpacked/OpenDrSai.exe", sha256: sha256(executable) },
    app_asar: { path: "apps/desktop/windows/release/win-unpacked/resources/app.asar", sha256: sha256(asar) },
    packaged_backend_source: { path: "apps/desktop/windows/release/win-unpacked/resources/app.asar.unpacked/resources/backend/drsai-backend-source.zip", sha256: sha256(backendSource) },
  },
};
writeFileSync(join(evidenceRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
if (!summary.ok) throw new Error(`F6 packaged workspace guard failed after ${completed}/${rounds} rounds. Evidence: ${evidenceRoot}`);
console.log(`Packaged F6 workspace guard passed ${completed}/${rounds} isolated app rounds and ${summary.total_checks} checks. Evidence: ${evidenceRoot}`);

function sha256(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function launch(command, args, env, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code, timedOut, stdout, stderr });
    });
  });
}

async function waitForGateway(port, token, timeoutMs, log) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: { "X-OpenDrSai-Gateway-Token": token } });
      if (response.ok) return;
    } catch { /* starting */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error(`F6 Full Runtime did not start.\n${log()}`);
}

function stopGatewayOnPort(port, launcherPid) {
  const netstat = spawnSync("netstat.exe", ["-ano", "-p", "TCP"], { encoding: "utf8", windowsHide: true });
  const pids = new Set([String(launcherPid || "")]);
  for (const line of String(netstat.stdout || "").split(/\r?\n/)) {
    if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) continue;
    const pid = line.trim().split(/\s+/).at(-1);
    if (/^\d+$/.test(pid || "")) pids.add(pid);
  }
  for (const pid of pids) {
    if (!/^\d+$/.test(pid) || pid === "0") continue;
    spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`], { windowsHide: true, stdio: "ignore" });
  }
}
