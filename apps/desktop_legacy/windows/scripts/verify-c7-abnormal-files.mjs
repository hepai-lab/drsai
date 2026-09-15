import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const python = process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";
const runId = process.env.OPENDRSAI_C7_RUN_ID?.trim() || "latest";
if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error("OPENDRSAI_C7_RUN_ID must be alphanumeric with optional hyphens.");
for (const path of [executable, sourcePdf, python]) if (!existsSync(path)) throw new Error(`C7 dependency is missing: ${path}`);
const source = readFileSync(sourcePdf);
const sourceHash = sha256(source);
assert(source.length === 7_664_262 && sourceHash === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E", "CERN PDF fixture changed.");

const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-c7-"));
const workspace = join(testRoot, "C7 abnormal files recovery");
const evidenceDir = join(root, "release", "product-evidence", "c7-abnormal-files", runId);
const resultPath = join(evidenceDir, "packaged-c7-abnormal-files-result.json");
const appHome = join(testRoot, "app-home");
const userData = join(testRoot, "user-data");
for (const path of [workspace, evidenceDir, appHome, userData]) mkdirSync(path, { recursive: true });
const fixturePaths = [
  join(workspace, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf"),
  join(workspace, "large-observations-64MiB.txt"),
  join(workspace, "corrupt-download.pdf"),
  join(workspace, "password-protected.pdf"),
  join(workspace, "unknown-material.xyz"),
];
copyFileSync(sourcePdf, fixturePaths[0]);
writeFileSync(fixturePaths[1], "OpenDrSai bounded large-file fixture.\n", "utf8");
truncateSync(fixturePaths[1], 64 * 1024 * 1024);
writeFileSync(fixturePaths[2], "This download is incomplete and is not a PDF.\n", "utf8");
writeFileSync(fixturePaths[4], "unknown format fixture\n", "utf8");
const encrypted = spawnSync(python, ["-c", "from pypdf import PdfWriter; import sys; w=PdfWriter(); w.add_blank_page(width=612,height=792); w.encrypt('opendrsai-secret'); w.write(sys.argv[1])", fixturePaths[3]], { encoding: "utf8", timeout: 30_000, windowsHide: true });
assert(encrypted.status === 0 && existsSync(fixturePaths[3]), `Could not create encrypted PDF fixture: ${encrypted.stderr || encrypted.error || "unknown error"}`);

try {
  await runPackagedApp();
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert(result.ok === true, `C7 packaged acceptance failed:\n${JSON.stringify(result, null, 2)}`);
  const checks = Object.entries(result.checks || {});
  assert(checks.length >= 16 && checks.every(([, passed]) => passed === true), "C7 has failing packaged checks.");
  assert(result.details?.importFeedbackMs < 60_000, "C7 did not report file states within 60 seconds.");
  assert(sha256(readFileSync(fixturePaths[0])) === sourceHash, "CERN PDF changed during C7 analysis.");
  const summary = { ok: true, runId, checks: checks.length, importFeedbackMs: result.details.importFeedbackMs, abnormalFiles: result.details.records, cernPdf: { sizeBytes: source.length, sha256: sourceHash }, screenshotPath: result.details.screenshotPath };
  writeFileSync(join(evidenceDir, "packaged-c7-abnormal-files-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(evidenceDir, "evidence-integrity.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`C7 abnormal-file handling passed ${checks.length}/${checks.length} packaged checks; visible feedback in ${result.details.importFeedbackMs.toFixed(1)} ms.`);
} finally {
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
}

function runPackagedApp() {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(executable, [`--user-data-dir=${userData}`], {
      cwd: root,
      env: { ...process.env, DRSAI_HOME: appHome, DRSAI_REPO: workspace, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_C7_ABNORMAL_FILES: "1", OPENDRSAI_E2E_C7_IMPORT_PATHS: fixturePaths.join("|"), OPENDRSAI_E2E_C7_EVIDENCE_DIR: evidenceDir, OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_E2E_TIMEOUT_MS: "120000" },
      stdio: "ignore", windowsHide: true,
    });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error("C7 timed out.")); } }, 135_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`C7 exited ${code}.${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : " No result JSON."}`)); });
  });
}

function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function killTree(pid) { if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
