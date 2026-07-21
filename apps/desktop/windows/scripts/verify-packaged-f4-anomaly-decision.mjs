import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const timeoutMs = Number(process.env.OPENDRSAI_E2E_TIMEOUT_MS || "50000");
const evidenceRoot = resolve(process.env.OPENDRSAI_F4_EVIDENCE_DIR || join(root, "release", "f4-anomaly-decision-evidence", timestamp(new Date())));
const tempRoot = mkdtempSync(join(tmpdir(), "opendrsai-f4-"));
const source = readFileSync(sourcePdf);
const sourceHash = sha256(source);
if (process.platform !== "win32") process.exit(0);
if (!existsSync(exePath) || source.length !== 7_664_262 || sourceHash !== "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E") throw new Error("F4 packaged dependencies or fixed CERN PDF are invalid.");
mkdirSync(evidenceRoot, { recursive: true });

const branches = ["keep", "exclude", "both"];
const branchSummaries = [];
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
      env: { ...process.env, PATH: systemPath, DRSAI_HOME: context.drsaiHome, DRSAI_REPO: context.workspace, OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_F4_ANOMALY_DECISION: "1", OPENDRSAI_E2E_F4_BRANCH: context.branch, OPENDRSAI_E2E_F4_CERN_PDF: context.fixturePath, OPENDRSAI_E2E_F4_CSV: context.csvPath, OPENDRSAI_E2E_F4_EVIDENCE_DIR: context.evidenceDir, OPENDRSAI_E2E_RESULT: context.resultPath, OPENDRSAI_E2E_TIMEOUT_MS: String(timeoutMs) },
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
