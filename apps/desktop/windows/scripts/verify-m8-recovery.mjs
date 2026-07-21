import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scenarios = ["service_unavailable", "disk_full", "permission_denied", "file_busy", "model_timeout"];
const scenarioIndex = process.argv.indexOf("--scenario");
const scenario = scenarioIndex >= 0 ? process.argv[scenarioIndex + 1] : process.env.OPENDRSAI_M8_SCENARIO || "service_unavailable";
if (!scenarios.includes(scenario)) throw new Error(`Unknown M8 recovery scenario: ${scenario}`);
const runId = process.env.OPENDRSAI_M8_RUN_ID?.trim() || "latest";
if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error("OPENDRSAI_M8_RUN_ID must be alphanumeric with optional hyphens.");
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const python = resolve(process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
const parser = join(repo, "cores/python/packages/drsai/src/drsai/backend/presentation_pdf.py");
const evidenceDir = join(root, "release", "product-evidence", "m8-recovery", scenario, runId);
for (const path of [executable, sourcePdf, python, parser]) if (!existsSync(path)) throw new Error(`M8 dependency is missing: ${path}`);
const source = readFileSync(sourcePdf);
assert(source.length === 7_664_262, `CERN PDF size changed: ${source.length}`);
assert(createHash("sha256").update(source).digest("hex").toUpperCase() === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E", "CERN PDF SHA-256 changed.");

const testRoot = mkdtempSync(join(tmpdir(), `opendrsai-m8-${scenario}-`));
const appHome = join(testRoot, "中文 用户", "OpenDrSai 数据");
const workspace = join(testRoot, "中文 用户", "CERN 错误恢复");
const userData = join(testRoot, "electron user data");
const fixturePath = join(workspace, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const resultPath = join(evidenceDir, "packaged-m8-recovery-result.json");
const screenshotPath = join(evidenceDir, "packaged-m8-recovery.png");
for (const path of [appHome, workspace, userData, evidenceDir]) mkdirSync(path, { recursive: true });
copyFileSync(sourcePdf, fixturePath);

try {
  await run();
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert(result.ok === true, `M8 ${scenario} acceptance failed:\n${JSON.stringify(result, null, 2)}`);
  const checks = Object.entries(result.checks || {});
  assert(checks.length >= 16 && checks.every(([, passed]) => passed === true), `M8 ${scenario} expected at least 16 passing checks, got ${checks.filter(([, passed]) => passed).length}/${checks.length}.`);
  const outputPath = result.details?.outputPath;
  const manifestPath = result.details?.manifestPath;
  assert(typeof outputPath === "string" && existsSync(outputPath), "Recovered PPTX disappeared before evidence capture.");
  assert(typeof manifestPath === "string" && existsSync(manifestPath), "Recovered provenance disappeared before evidence capture.");
  const evidencePptx = join(evidenceDir, "recovered-cern-manager-report.pptx");
  const evidenceManifest = join(evidenceDir, "recovered-cern-manager-report.provenance.json");
  copyFileSync(outputPath, evidencePptx);
  copyFileSync(manifestPath, evidenceManifest);
  const pptx = readFileSync(evidencePptx);
  writeFileSync(join(evidenceDir, "evidence-integrity.json"), `${JSON.stringify({ scenario, runId, failureTerminalMs: result.details.failureTerminalMs, recoveryCompletedMs: result.details.recoveryCompletedMs, card: result.details.card, pptx: { sizeBytes: pptx.length, sha256: createHash("sha256").update(pptx).digest("hex").toUpperCase() }, sourcePdf: { sizeBytes: source.length, sha256: "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E" } }, null, 2)}\n`);
  console.log(`M8 ${scenario} recovery passed (${checks.length}/${checks.length}; terminal ${Number(result.details.failureTerminalMs).toFixed(1)} ms; recovered ${pptx.length} bytes).`);
} finally {
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
}

function run() {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const phase = ["disk_full", "permission_denied", "file_busy"].includes(scenario) ? "generating" : "analyzing";
    const child = spawn(executable, [`--user-data-dir=${userData}`], { cwd: root, env: { ...process.env, DRSAI_HOME: appHome, DRSAI_REPO: workspace, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_M8_RECOVERY: "1", OPENDRSAI_E2E_M8_CERN_PDF: fixturePath, OPENDRSAI_E2E_M8_FAILURE_KIND: scenario, OPENDRSAI_E2E_PRESENTATION_FAIL_ATTEMPT: "1", OPENDRSAI_E2E_PRESENTATION_FAIL_PHASE: phase, OPENDRSAI_E2E_PRESENTATION_PHASE_DELAY_MS: "150", OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_E2E_SCREENSHOT: screenshotPath, OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_E2E_TIMEOUT_MS: "90000", OPENDRSAI_PDF_PYTHON: python, OPENDRSAI_PDF_SCRIPT: parser }, stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error(`M8 ${scenario} acceptance timed out.`)); } }, 105_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`M8 ${scenario} app exited ${code}.${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : " No result JSON was written."}`)); });
  });
}

function killTree(pid) { if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
