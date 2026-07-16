import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const python = process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";
const extractor = join(repo, "cores", "python", "packages", "drsai", "src", "drsai", "backend", "presentation_pdf.py");
const runId = process.env.OPENDRSAI_F1_RUN_ID?.trim() || "latest";
if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error("OPENDRSAI_F1_RUN_ID must be alphanumeric with optional hyphens.");
for (const path of [executable, sourcePdf, python, extractor]) if (!existsSync(path)) throw new Error(`F1 dependency is missing: ${path}`);
const source = readFileSync(sourcePdf);
const sourceHash = sha256(source);
assert(source.length === 7_664_262 && sourceHash === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E", "CERN PDF fixture changed.");

const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-f1-"));
const workspace = join(testRoot, "中文 CERN 材料", "低风险任务");
const fixturePath = join(workspace, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const evidenceDir = join(root, "release", "product-evidence", "f1-low-risk-approvals", runId);
const resultPath = join(evidenceDir, "packaged-f1-low-risk-result.json");
const appHome = join(testRoot, "应用 数据");
const userData = join(testRoot, "用户 数据");
for (const path of [workspace, evidenceDir, appHome, userData]) mkdirSync(path, { recursive: true });
copyFileSync(sourcePdf, fixturePath);

try {
  const processOutput = await runPackagedApp();
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert(result.ok === true, `F1 packaged acceptance failed:\n${JSON.stringify(result, null, 2)}`);
  const appChecks = Object.entries(result.checks || {});
  assert(appChecks.length === 27 && appChecks.every(([, passed]) => passed === true), `F1 expected 27 passing checks, got ${appChecks.length}.`);
  assert(result.details.maximumDesktopApprovalsDuringLowRisk === 0, "Low-risk tasks queued a desktop approval.");
  assert(result.details.maximumBrowserApprovalsDuringLowRisk === 0, "Low-risk tasks queued a browser approval.");
  assert(result.details.lowRiskOperations.length === 5 && result.details.lowRiskOperations.every((item) => item.approvalWaitMs === 0), "A low-risk operation recorded approval waiting time.");
  assert(!/waiting_approval/i.test(`${processOutput.stdout}\n${processOutput.stderr}`), "A technical waiting-approval state leaked into packaged logs.");
  assert(sha256(readFileSync(fixturePath)) === sourceHash, "CERN PDF changed during F1 acceptance.");
  const presentation = result.details.presentation;
  const evidencePptx = join(evidenceDir, "f1-cern-manager-draft.pptx");
  const evidenceManifest = join(evidenceDir, "f1-cern-manager-draft.provenance.json");
  copyFileSync(presentation.outputPath, evidencePptx);
  copyFileSync(presentation.manifestPath, evidenceManifest);
  const summary = {
    ok: true,
    runId,
    appChecks: appChecks.length,
    externalChecks: 5,
    totalChecks: appChecks.length + 5,
    lowRiskOperationCount: result.details.lowRiskOperations.length,
    maximumDesktopApprovalsDuringLowRisk: 0,
    maximumBrowserApprovalsDuringLowRisk: 0,
    approvalWaitMs: 0,
    criticalControl: result.details.policyControl,
    cernPdf: { sizeBytes: source.length, sha256: sourceHash },
    generatedDraft: { path: evidencePptx, sha256: sha256(readFileSync(evidencePptx)), manifestPath: evidenceManifest },
    screenshotPath: result.details.screenshotPath,
  };
  writeFileSync(join(evidenceDir, "packaged-f1-low-risk-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(evidenceDir, "evidence-integrity.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`F1 low-risk approvals passed ${summary.totalChecks}/${summary.totalChecks} checks; five low-risk operations queued zero approvals and waited 0 ms.`);
} finally {
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function runPackagedApp() {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(executable, [`--user-data-dir=${userData}`], {
      cwd: root,
      env: { ...process.env, DRSAI_HOME: appHome, DRSAI_REPO: workspace, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_PDF_PYTHON: python, OPENDRSAI_PDF_SCRIPT: extractor, OPENDRSAI_E2E_F1_LOW_RISK_APPROVALS: "1", OPENDRSAI_E2E_F1_CERN_PDF: fixturePath, OPENDRSAI_E2E_F1_EVIDENCE_DIR: evidenceDir, OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_E2E_TIMEOUT_MS: "150000" },
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error("F1 timed out.")); } }, 165_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 ? resolveRun({ stdout, stderr }) : reject(new Error(`F1 exited ${code}.\n${stdout}\n${stderr}${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : " No result JSON."}`)); });
  });
}

function killTree(pid) { if (pid) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function assert(condition, message) { if (!condition) throw new Error(message); }
