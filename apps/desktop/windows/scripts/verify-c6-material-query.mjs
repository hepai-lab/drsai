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
const runId = process.env.OPENDRSAI_C6_RUN_ID?.trim() || "latest";
if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error("OPENDRSAI_C6_RUN_ID must be alphanumeric with optional hyphens.");
for (const path of [executable, sourcePdf, python, extractor]) if (!existsSync(path)) throw new Error(`C6 dependency is missing: ${path}`);
const source = readFileSync(sourcePdf);
const sourceHash = sha256(source);
assert(source.length === 7_664_262 && sourceHash === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E", "CERN PDF fixture changed.");

const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-c6-"));
const workspace = join(testRoot, "C6 CERN natural language material query");
const evidenceDir = join(root, "release", "product-evidence", "c6-material-query", runId);
const resultPath = join(evidenceDir, "packaged-c6-material-query-result.json");
const appHome = join(testRoot, "app-home");
const userData = join(testRoot, "user-data");
for (const path of [workspace, evidenceDir, appHome, userData]) mkdirSync(path, { recursive: true });
const fixturePaths = [
  join(workspace, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf"),
  join(workspace, "methods.md"),
  join(workspace, "prior-report-2024.md"),
  join(workspace, "latest-data-2026.csv"),
];
copyFileSync(sourcePdf, fixturePaths[0]);
writeFileSync(fixturePaths[1], "# Memory study\n\nResearch method: randomized double-blind controlled experiment\n\nConclusion: spaced repetition improved recall.\n", "utf8");
writeFileSync(fixturePaths[2], "# Prior report 2024\n\nsample_size: 100\n", "utf8");
writeFileSync(fixturePaths[3], "metric,current\nsample_size,160\n", "utf8");

try {
  await runPackagedApp();
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert(result.ok === true, `C6 packaged acceptance failed:\n${JSON.stringify(result, null, 2)}`);
  const checks = Object.entries(result.checks || {});
  assert(checks.length >= 14 && checks.every(([, passed]) => passed === true), "C6 has failing packaged checks.");
  assert(result.details?.total === 11 && result.details?.accuracy >= 0.9, "C6 golden-question accuracy is below 90%.");
  assert(sha256(readFileSync(fixturePaths[0])) === sourceHash, "CERN PDF changed during C6 analysis.");
  const summary = {
    ok: true,
    runId,
    checks: checks.length,
    goldenQuestions: result.details.total,
    correctAnswers: result.details.correct,
    accuracy: result.details.accuracy,
    cernPdf: { sizeBytes: source.length, sha256: sourceHash },
    screenshotPath: result.details.screenshotPath,
  };
  writeFileSync(join(evidenceDir, "packaged-c6-material-query-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(evidenceDir, "evidence-integrity.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`C6 natural-language material query passed ${result.details.correct}/${result.details.total} golden questions (${(result.details.accuracy * 100).toFixed(1)}%) and ${checks.length}/${checks.length} packaged checks.`);
} finally {
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
}

function runPackagedApp() {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(executable, [`--user-data-dir=${userData}`], {
      cwd: root,
      env: {
        ...process.env,
        DRSAI_HOME: appHome,
        DRSAI_REPO: workspace,
        DRSAI_GATEWAY_DEV_MANAGED: "1",
        OPENDRSAI_DEV_AUTH_BYPASS: "1",
        OPENDRSAI_PDF_PYTHON: python,
        OPENDRSAI_PDF_SCRIPT: extractor,
        OPENDRSAI_E2E_C6_MATERIAL_QUERY: "1",
        OPENDRSAI_E2E_C6_IMPORT_PATHS: fixturePaths.join("|"),
        OPENDRSAI_E2E_C6_EVIDENCE_DIR: evidenceDir,
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1",
        OPENDRSAI_E2E_DISABLE_GPU: "1",
        OPENDRSAI_E2E_TIMEOUT_MS: "180000",
      },
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error("C6 timed out.")); } }, 195_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      code === 0 ? resolveRun() : reject(new Error(`C6 exited ${code}.${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : " No result JSON."}`));
    });
  });
}

function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function killTree(pid) { if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
