import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startApprovalRuntimeFixture } from "./lib/opendrsai-approval-runtime-fixture.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const python = process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";
const extractor = join(repo, "cores", "python", "packages", "drsai", "src", "drsai", "content", "pdf", "presentation.py");
const timeoutMs = Number(process.env.OPENDRSAI_E2E_TIMEOUT_MS || "50000");
const evidenceRoot = resolve(process.env.OPENDRSAI_F3_EVIDENCE_DIR || join(root, "release", "f3-approval-evidence", timestamp(new Date())));
const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-f3-"));
const workspace = join(tempDir, "中文 CERN 材料", "审批业务说明");
const fixturePath = join(workspace, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const effectDir = join(tempDir, "approval-effects");
const userData = join(tempDir, "electron-user-data");
const drsaiHome = join(tempDir, "drsai-home");
const resultPath = join(evidenceRoot, "result.json");
const stdoutPath = join(evidenceRoot, "stdout.log");
const stderrPath = join(evidenceRoot, "stderr.log");
const commit = getCommit();

if (process.platform !== "win32") process.exit(0);
for (const path of [exePath, sourcePdf, python, extractor]) if (!existsSync(path)) throw new Error(`F3 dependency missing: ${path}`);
const source = readFileSync(sourcePdf);
const sourceHash = sha256(source);
if (source.length !== 7_664_262 || sourceHash !== "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E") throw new Error("F3 CERN PDF fixture changed.");
for (const path of [evidenceRoot, workspace, effectDir, userData, drsaiHome]) mkdirSync(path, { recursive: true });
copyFileSync(sourcePdf, fixturePath);

const systemPath = [dirname(exePath), process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32", process.env.SystemRoot || "C:\\Windows", process.env.PATH || ""].join(delimiter);
let stdout = "";
let stderr = "";
let timedOut = false;
let exitCode = null;
const runtimeFixture = await startApprovalRuntimeFixture();
try {
  exitCode = await new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = spawn(exePath, [`--user-data-dir=${userData}`, "--no-sandbox", "--disable-gpu", "--disable-gpu-compositing", "--disable-gpu-sandbox", "--in-process-gpu"], {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: systemPath,
        DRSAI_HOME: drsaiHome,
        DRSAI_REPO: workspace,
        OPENDRSAI_DEV_AUTH_BYPASS: "1",
        DRSAI_GATEWAY_DEV_MANAGED: "1",
        OPENDRSAI_GATEWAY_PORT: String(runtimeFixture.port),
        OPENDRSAI_PDF_PYTHON: python,
        OPENDRSAI_PDF_SCRIPT: extractor,
        OPENDRSAI_E2E_F3_APPROVALS: "1",
        OPENDRSAI_E2E_F3_CERN_PDF: fixturePath,
        OPENDRSAI_E2E_F3_EFFECT_DIR: effectDir,
        OPENDRSAI_E2E_F3_EVIDENCE_DIR: evidenceRoot,
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_TIMEOUT_MS: String(timeoutMs),
        OPENDRSAI_E2E_COMMIT: commit,
      },
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      timedOut = true;
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      resolvePromise(124);
    }, timeoutMs + 15_000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (!settled) { settled = true; clearTimeout(timer); resolvePromise(code); } });
  });
} finally {
  await runtimeFixture.close();
  writeFileSync(stdoutPath, stdout, "utf8");
  writeFileSync(stderrPath, stderr, "utf8");
}

const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
const checks = result?.checks || {};
const checkCount = Object.keys(checks).length;
const passedChecks = Object.values(checks).filter(Boolean).length;
const effects = result?.details?.effectDiagnostics || [];
const unauthorizedExecutions = effects.reduce((sum, item) => sum + Number(item.rejectedExecutions || 0), 0);
const authorizedExecutions = effects.reduce((sum, item) => sum + Number(item.authorizedExecutions || 0), 0);
const fixture = readFileSync(fixturePath);
const summary = {
  ok: Boolean(exitCode === 0 && result?.ok && checkCount === 71 && passedChecks === 71 && effects.length === 5 && unauthorizedExecutions === 0 && authorizedExecutions === 5 && fixture.length === source.length && sha256(fixture) === sourceHash),
  startedAt: result?.details?.capturedAt || null,
  finishedAt: new Date().toISOString(),
  exePath,
  commit,
  evidenceRoot,
  exitCode,
  timedOut,
  checkCount,
  passedChecks,
  unauthorizedExecutions,
  authorizedExecutions,
  configuredRetries: 0,
  actualRetries: 0,
  cernPdf: { path: fixturePath, sizeBytes: fixture.length, sha256: sha256(fixture) },
  resultPath,
  stdoutPath,
  stderrPath,
  screenshotPath: result?.details?.screenshotPath || null,
  accessibilityTreePath: result?.details?.accessibilityTreePath || null,
  effectDiagnostics: effects,
  checks,
};
summary.artifactHash = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
writeFileSync(join(evidenceRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch {}
if (!summary.ok) throw new Error(`Packaged F3 approval E2E failed. Evidence: ${evidenceRoot}`);
console.log(`Packaged F3 approval E2E passed 71/71 checks. Evidence: ${evidenceRoot}`);

function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function timestamp(date) { return date.toISOString().replace(/[:.]/g, "-"); }
function getCommit() {
  try { return process.env.OPENDRSAI_E2E_COMMIT || "working-tree"; } catch { return "unknown"; }
}
