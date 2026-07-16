import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const axePath = join(root, "node_modules", "axe-core", "axe.min.js");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const requestedRunId = process.env.OPENDRSAI_M5_RUN_ID?.trim();
if (requestedRunId && !/^[a-z0-9-]+$/i.test(requestedRunId)) throw new Error("OPENDRSAI_M5_RUN_ID must be alphanumeric with optional hyphens.");
const evidenceDir = join(root, "release", "product-evidence", "m5-accessibility", requestedRunId || "latest");
if (!existsSync(executable)) throw new Error("Build release/win-unpacked before running M5 acceptance.");
if (!existsSync(axePath)) throw new Error("Install axe-core before running M5 acceptance.");
if (!existsSync(sourcePdf)) throw new Error(`Fixed CERN PDF fixture is missing: ${sourcePdf}`);
const source = readFileSync(sourcePdf);
assert(source.length === 7_664_262, `CERN PDF size changed: ${source.length}`);
assert(createHash("sha256").update(source).digest("hex").toUpperCase() === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E", "CERN PDF SHA-256 changed.");

const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-m5-accessibility-"));
const appHome = join(testRoot, "中文 用户", "OpenDrSai 数据");
const workspace = join(testRoot, "中文 用户", "CERN 无障碍工作区");
const userData = join(testRoot, "electron user data");
const fixturePath = join(workspace, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const chartPath = join(workspace, "cern-wlcg-capacity-chart.svg");
const resultPath = join(evidenceDir, "packaged-m5-accessibility-result.json");
for (const path of [appHome, workspace, userData, evidenceDir]) mkdirSync(path, { recursive: true });
copyFileSync(sourcePdf, fixturePath);
writeFileSync(chartPath, `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480" viewBox="0 0 800 480"><rect width="800" height="480" fill="white"/><text x="400" y="36" text-anchor="middle" font-size="24">WLCG planned capacity</text><line x1="80" y1="400" x2="740" y2="400" stroke="black"/><line x1="80" y1="400" x2="80" y2="70" stroke="black"/><polyline points="120,330 400,240 690,120" fill="none" stroke="#5b3fc4" stroke-width="8"/><text x="400" y="455" text-anchor="middle">year</text><text x="24" y="235" transform="rotate(-90 24 235)" text-anchor="middle">throughput (Tbps)</text></svg>`, "utf8");
rmSync(resultPath, { force: true });

try {
  await run();
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert(result.ok === true, `M5 packaged acceptance failed:\n${JSON.stringify(result, null, 2)}`);
  const checks = Object.entries(result.checks || {});
  assert(checks.length >= 30 && checks.every(([, passed]) => passed === true), `M5 expected at least 30 passing checks, got ${checks.filter(([, passed]) => passed).length}/${checks.length}.`);
  assert(result.details?.pages?.length === 4, "M5 must audit exactly four product pages.");
  console.log(`M5 packaged accessibility acceptance passed (${checks.length}/${checks.length} checks; 4 axe scans + 4 accessibility trees).`);
} finally {
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

function run() {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(executable, [`--user-data-dir=${userData}`], {
      cwd: root,
      env: { ...process.env, DRSAI_HOME: appHome, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_M5_ACCESSIBILITY: "1", OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_E2E_M5_CERN_PDF: fixturePath, OPENDRSAI_E2E_M5_CERN_CHART: chartPath, OPENDRSAI_E2E_M5_AXE_PATH: axePath, OPENDRSAI_E2E_M5_EVIDENCE_DIR: evidenceDir, OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_TIMEOUT_MS: "120000" },
      stdio: "ignore", windowsHide: true,
    });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error("M5 packaged acceptance timed out.")); } }, 135_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`M5 packaged app exited ${code}.${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : " No result JSON was written."}`)); });
  });
}

function killTree(pid) { if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
