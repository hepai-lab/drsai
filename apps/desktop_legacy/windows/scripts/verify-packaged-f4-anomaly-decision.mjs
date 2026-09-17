import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const python = resolve(repo, ".venv", "Scripts", "python.exe");
const pythonSource = resolve(repo, "cores", "python", "packages", "drsai", "src");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const timeoutMs = Number(process.env.OPENDRSAI_E2E_TIMEOUT_MS || "50000");
const evidenceRoot = resolve(process.env.OPENDRSAI_F4_EVIDENCE_DIR || join(root, "release", "f4-anomaly-decision-evidence", timestamp(new Date())));
const tempRoot = mkdtempSync(join(tmpdir(), "opendrsai-f4-"));
const source = readFileSync(sourcePdf);
const sourceHash = sha256(source);
if (process.platform !== "win32") process.exit(0);
if (!existsSync(exePath) || !existsSync(python) || source.length !== 7_664_262 || sourceHash !== "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E") throw new Error("F4 packaged dependencies or fixed CERN PDF are invalid.");
mkdirSync(evidenceRoot, { recursive: true });

const branches = ["keep", "exclude", "both"];
const branchSummaries = [];
const gatewayHome = mkdtempSync(join(tmpdir(), "opendrsai-f4-runtime-"));
// A PID-derived port can be reused by consecutive zero-retry stability rounds on
// Windows. A delayed teardown from the prior round can then stop the next
// gateway after it has started. Ask the OS for a fresh free loopback port for
// each verifier process instead.
const gatewayPort = await findAvailablePort();
const gatewayToken = `f4-runtime-${process.pid}-${Date.now()}`;
const gateway = spawn(python, ["-m", "drsai.backend.gateway"], {
  cwd: repo, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, DRSAI_HOME: gatewayHome, DRSAI_API_HOST: "127.0.0.1", DRSAI_API_PORT: String(gatewayPort), OPENDRSAI_GATEWAY_INSTANCE_TOKEN: gatewayToken, OPENDRSAI_DEV_AUTH_BYPASS: "1", PYTHONPATH: [pythonSource, process.env.PYTHONPATH].filter(Boolean).join(delimiter) },
});
let gatewayLog = "";
gateway.stdout.on("data", (chunk) => { gatewayLog = `${gatewayLog}${chunk}`.slice(-16000); });
gateway.stderr.on("data", (chunk) => { gatewayLog = `${gatewayLog}${chunk}`.slice(-16000); });
try {
await waitForGateway(gatewayPort, gatewayToken, 30_000, () => gatewayLog);
for (const branch of branches) {
  const workspace = join(tempRoot, branch, "中文 CERN 异常数据");
  const userData = join(tempRoot, branch, "electron-user-data");
  const drsaiHome = join(tempRoot, branch, "drsai-home");
  const evidenceDir = join(evidenceRoot, branch);
  const fixturePath = join(workspace, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
  const csvPath = join(workspace, "cern-wlcg-capacity-test.csv");
  const chartPath = join(workspace, "cern-wlcg-capacity-chart.svg");
  const resultPath = join(evidenceDir, "result.json");
  for (const path of [workspace, userData, drsaiHome, evidenceDir]) mkdirSync(path, { recursive: true });
  copyFileSync(sourcePdf, fixturePath);
  writeFileSync(csvPath, "year,throughput_tbps,anomaly\r\n2025,4.8,false\r\n2026,5.2,false\r\n2027,9.6,true\r\n2028,6.0,false\r\n2029,9.6,true\r\n", "utf8");
  writeFileSync(chartPath, "<svg xmlns=\"http://www.w3.org/2000/svg\"><text>CERN WLCG capacity test</text></svg>\n", "utf8");
  const run = await runPackaged({ branch, workspace, userData, drsaiHome, evidenceDir, fixturePath, csvPath, resultPath });
  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
  const checks = result?.checks || {};
  branchSummaries.push({ branch, ...run, ok: Boolean(run.exitCode === 0 && result?.ok && Object.keys(checks).length >= 20 && Object.values(checks).every(Boolean)), checkCount: Object.keys(checks).length, passedChecks: Object.values(checks).filter(Boolean).length, checks, details: result?.details || null });
}
} finally {
  stopGatewayOnPort(gatewayPort, gateway.pid);
  gateway.stdout.destroy(); gateway.stderr.destroy(); gateway.unref();
  try { rmSync(gatewayHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }); } catch {}
}

const summary = {
  ok: branchSummaries.every((item) => item.ok),
  finishedAt: new Date().toISOString(),
  exePath,
  evidenceRoot,
  configuredRetries: 0,
  actualRetries: 0,
  scenarios: branchSummaries.length,
  checkCount: branchSummaries.reduce((sum, item) => sum + item.checkCount, 0),
  passedChecks: branchSummaries.reduce((sum, item) => sum + item.passedChecks, 0),
  cernPdf: { path: sourcePdf, sizeBytes: source.length, sha256: sourceHash },
  branches: branchSummaries,
};
summary.artifactHash = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
writeFileSync(join(evidenceRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
try { rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch {}
if (!summary.ok) throw new Error(`Packaged F4 anomaly-decision E2E failed. Evidence: ${evidenceRoot}`);
console.log(`Packaged F4 anomaly-decision passed ${summary.scenarios}/3 branches, ${summary.passedChecks}/${summary.checkCount} checks. Evidence: ${evidenceRoot}`);

async function runPackaged(context) {
  const stdoutPath = join(context.evidenceDir, "stdout.log");
  const stderrPath = join(context.evidenceDir, "stderr.log");
  const systemPath = [dirname(exePath), process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32", process.env.SystemRoot || "C:\\Windows", process.env.PATH || ""].join(delimiter);
  let stdout = ""; let stderr = ""; let timedOut = false;
  const exitCode = await new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = spawn(exePath, [`--user-data-dir=${context.userData}`, "--no-sandbox", "--disable-gpu", "--disable-gpu-compositing", "--disable-gpu-sandbox", "--in-process-gpu"], {
      cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: systemPath, DRSAI_HOME: context.drsaiHome, DRSAI_REPO: context.workspace, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_GATEWAY_STARTUP: "external", OPENDRSAI_GATEWAY_PORT: String(gatewayPort), OPENDRSAI_GATEWAY_INSTANCE_TOKEN: gatewayToken, OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_F4_ANOMALY_DECISION: "1", OPENDRSAI_E2E_F4_BRANCH: context.branch, OPENDRSAI_E2E_F4_CERN_PDF: context.fixturePath, OPENDRSAI_E2E_F4_CSV: context.csvPath, OPENDRSAI_E2E_F4_EVIDENCE_DIR: context.evidenceDir, OPENDRSAI_E2E_RESULT: context.resultPath, OPENDRSAI_E2E_TIMEOUT_MS: String(timeoutMs) },
    });
    const timer = setTimeout(() => { if (!settled) { settled = true; timedOut = true; spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }); resolvePromise(124); } }, timeoutMs + 15_000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (!settled) { settled = true; clearTimeout(timer); resolvePromise(code); } });
  });
  writeFileSync(stdoutPath, stdout, "utf8"); writeFileSync(stderrPath, stderr, "utf8");
  return { exitCode, timedOut, stdoutPath, stderrPath };
}

function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function timestamp(date) { return date.toISOString().replace(/[:.]/g, "-"); }

function findAvailablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve an F4 Full Runtime port.")));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForGateway(port, token, timeoutMs, log) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: { "X-OpenDrSai-Gateway-Token": token } });
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error(`F4 Full Runtime did not start.\n${log()}`);
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
