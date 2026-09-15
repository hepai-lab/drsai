import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const python = resolve(process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
const parser = join(repo, "cores/python/packages/drsai/src/drsai/content/pdf/presentation.py");
const runId = process.env.OPENDRSAI_M7_RUN_ID?.trim() || "latest";
if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error("OPENDRSAI_M7_RUN_ID must be alphanumeric with optional hyphens.");
const evidenceDir = join(root, "release", "product-evidence", "m7-stability", runId);
if (!existsSync(executable)) throw new Error("Build release/win-unpacked before running M7 acceptance.");
if (!existsSync(sourcePdf)) throw new Error(`Fixed CERN PDF fixture is missing: ${sourcePdf}`);
if (!existsSync(python) || !existsSync(parser)) throw new Error("M7 presentation PDF runtime is incomplete.");
const source = readFileSync(sourcePdf);
assert(source.length === 7_664_262, `CERN PDF size changed: ${source.length}`);
assert(createHash("sha256").update(source).digest("hex").toUpperCase() === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E", "CERN PDF SHA-256 changed.");

const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-m7-stability-"));
const appHome = join(testRoot, "中文 用户", "OpenDrSai 数据");
const workspace = join(testRoot, "中文 用户", "CERN 黄金任务");
const userData = join(testRoot, "electron user data");
const fixturePath = join(workspace, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const resultPath = join(evidenceDir, "packaged-m7-stability-result.json");
const screenshotPath = join(evidenceDir, "packaged-m7-stability.png");
for (const path of [appHome, workspace, userData, evidenceDir]) mkdirSync(path, { recursive: true });
copyFileSync(sourcePdf, fixturePath);

try {
  await run();
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert(result.ok === true, `M7 packaged acceptance failed:\n${JSON.stringify(result, null, 2)}`);
  const checks = Object.entries(result.checks || {});
  assert(checks.length >= 25 && checks.every(([, passed]) => passed === true), `M7 expected at least 25 passing checks, got ${checks.filter(([, passed]) => passed).length}/${checks.length}.`);
  const outputPath = result.details?.outputPath;
  const manifestPath = result.details?.manifestPath;
  assert(typeof outputPath === "string" && existsSync(outputPath), "M7 generated PPTX disappeared before evidence capture.");
  assert(typeof manifestPath === "string" && existsSync(manifestPath), "M7 provenance manifest disappeared before evidence capture.");
  const evidencePptx = join(evidenceDir, "cern-manager-report.pptx");
  const evidenceManifest = join(evidenceDir, "cern-manager-report.provenance.json");
  copyFileSync(outputPath, evidencePptx);
  copyFileSync(manifestPath, evidenceManifest);
  const captured = readFileSync(evidencePptx);
  writeFileSync(join(evidenceDir, "evidence-integrity.json"), `${JSON.stringify({ runId, pptx: { path: evidencePptx, sizeBytes: captured.length, sha256: createHash("sha256").update(captured).digest("hex").toUpperCase() }, provenancePath: evidenceManifest, sourcePdf: { filename: "WLCG-20260715-WLCG-talk-IHEP-visit.pdf", sizeBytes: source.length, sha256: "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E" } }, null, 2)}\n`);
  console.log(`M7 packaged CERN stability acceptance passed (${checks.length}/${checks.length} checks; artifact ${captured.length} bytes).`);
} finally {
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
}

function run() {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(executable, [`--user-data-dir=${userData}`], { cwd: root, env: { ...process.env, DRSAI_HOME: appHome, DRSAI_REPO: workspace, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_M7_STABILITY: "1", OPENDRSAI_E2E_M7_CERN_PDF: fixturePath, OPENDRSAI_E2E_PRESENTATION_PHASE_DELAY_MS: "600", OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_E2E_SCREENSHOT: screenshotPath, OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_E2E_TIMEOUT_MS: "90000", OPENDRSAI_PDF_PYTHON: python, OPENDRSAI_PDF_SCRIPT: parser }, stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error("M7 packaged acceptance timed out.")); } }, 105_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`M7 packaged app exited ${code}.${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : " No result JSON was written."}`)); });
  });
}

function killTree(pid) { if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
