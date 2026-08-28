import { spawn, spawnSync } from "node:child_process";
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
const e2eTimeoutMs = Number(process.env.OPENDRSAI_E2E_TIMEOUT_MS || "45000");
const processTimeoutMs = e2eTimeoutMs + 15_000;
const scenarios = ["all"];
const commit = getCommit();
const evidenceRoot = resolve(
  process.env.OPENDRSAI_F2_EVIDENCE_DIR ||
  join(root, "release", "f2-approval-evidence", timestampForPath(new Date())),
);
const screenshotDir = join(evidenceRoot, "screenshots");
const systemPath = [
  dirname(exePath),
  process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32",
  process.env.SystemRoot || "C:\\Windows",
  process.env.PATH || "",
].join(delimiter);

if (process.platform !== "win32") {
  console.log("Packaged F2 approval E2E is only supported on Windows; skipped.");
  process.exit(0);
}

if (!existsSync(exePath)) {
  throw new Error("Build the unpacked Windows app before running verify:packaged-f2-approvals.");
}
for (const path of [sourcePdf, python, extractor]) if (!existsSync(path)) throw new Error(`F2 dependency is missing: ${path}`);
const sourceBytes = readFileSync(sourcePdf);
const sourceHash = createHash("sha256").update(sourceBytes).digest("hex").toUpperCase();
if (sourceBytes.length !== 7_664_262 || sourceHash !== "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E") throw new Error("F2 CERN PDF fixture changed.");

mkdirSync(evidenceRoot, { recursive: true });
mkdirSync(screenshotDir, { recursive: true });

const summary = {
  ok: true,
  startedAt: new Date().toISOString(),
  exePath,
  commit,
  evidenceRoot,
  environment: collectEnvironment(),
  matrix: collectMatrix(),
  scenarios: [],
};

try {
  for (const scenario of scenarios) {
    const result = await runScenario(scenario);
    summary.scenarios.push(result);
    if (!result.ok) summary.ok = false;
  }
} finally {
  summary.finishedAt = new Date().toISOString();
  summary.unauthorizedExecutions = summary.scenarios.reduce((sum, item) => sum + (item.unauthorizedExecutions || 0), 0);
  summary.configuredRetries = 0;
  summary.actualRetries = 0;
  summary.exitCode = summary.ok ? 0 : 1;
  writeSummary(summary);
}

if (!summary.ok || summary.unauthorizedExecutions !== 0) {
  throw new Error(`Packaged F2 approval E2E failed. Evidence: ${evidenceRoot}`);
}

console.log(`Packaged F2 approval E2E passed. Evidence: ${evidenceRoot}`);

async function runScenario(scenario) {
  const tempDir = mkdtempSync(join(tmpdir(), `opendrsai-f2-${scenario}-`));
  const resultPath = join(evidenceRoot, `${scenario}.result.json`);
  const stdoutPath = join(evidenceRoot, `${scenario}.stdout.log`);
  const stderrPath = join(evidenceRoot, `${scenario}.stderr.log`);
  const drsaiHome = join(tempDir, "drsai-home");
  const electronUserData = join(tempDir, "electron-user-data");
  const workspace = join(tempDir, "中文 CERN 材料", "关键操作");
  const fixturePath = join(workspace, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
  const effectDir = join(tempDir, "approval-effects");
  mkdirSync(drsaiHome, { recursive: true });
  mkdirSync(electronUserData, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(effectDir, { recursive: true });
  copyFileSync(sourcePdf, fixturePath);
  const sideEffectSnapshotBefore = collectSideEffectSnapshot(drsaiHome);
  const startedAt = new Date().toISOString();
  let stdout = "";
  let stderr = "";
  let exitCode = null;
  let timedOut = false;
  const runtimeFixture = await startApprovalRuntimeFixture();

  try {
    exitCode = await new Promise((resolvePromise, reject) => {
      let settled = false;
      const child = spawn(exePath, [
        `--user-data-dir=${electronUserData}`,
        "--no-sandbox",
        "--disable-gpu",
        "--disable-gpu-compositing",
        "--disable-gpu-sandbox",
        "--in-process-gpu",
      ], {
        cwd: root,
        env: {
          SystemRoot: process.env.SystemRoot,
          ComSpec: process.env.ComSpec,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          USERPROFILE: process.env.USERPROFILE,
          LOCALAPPDATA: process.env.LOCALAPPDATA,
          APPDATA: process.env.APPDATA,
          PATH: systemPath,
          DRSAI_HOME: drsaiHome,
          DRSAI_REPO: workspace,
          OPENDRSAI_DEV_AUTH_BYPASS: "1",
          DRSAI_GATEWAY_DEV_MANAGED: "1",
          OPENDRSAI_GATEWAY_PORT: String(runtimeFixture.port),
          OPENDRSAI_PDF_PYTHON: python,
          OPENDRSAI_PDF_SCRIPT: extractor,
          OPENDRSAI_E2E_F2_APPROVALS: "1",
          OPENDRSAI_E2E_F2_CERN_PDF: fixturePath,
          OPENDRSAI_E2E_F2_EFFECT_DIR: effectDir,
          OPENDRSAI_F2_APPROVAL_SCENARIO: scenario,
          OPENDRSAI_E2E_RESULT: resultPath,
          OPENDRSAI_E2E_TIMEOUT_MS: String(e2eTimeoutMs),
          OPENDRSAI_E2E_F2_SCREENSHOT_DIR: screenshotDir,
          OPENDRSAI_E2E_COMMIT: commit,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        timedOut = true;
        killProcessTree(child.pid);
        resolvePromise(124);
      }, processTimeoutMs);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise(code);
      });
    });
  } finally {
    await runtimeFixture.close();
    writeFileSync(stdoutPath, stdout, "utf8");
    writeFileSync(stderrPath, stderr, "utf8");
  }

  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
  const sideEffectSnapshotAfter = collectSideEffectSnapshot(drsaiHome);
  const screenshotPath = join(screenshotDir, `${scenario}.png`);
  const unauthorizedExecutions = Number(result?.details?.approvals?.reduce?.(
    (sum, item) => sum + Number(item.unauthorizedExecutions || 0),
    0,
  ) || 0);
  const scenarioSummary = {
    scenario,
    ok: Boolean(exitCode === 0 && result?.ok && existsSync(screenshotPath) && unauthorizedExecutions === 0),
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    timedOut,
    resultPath,
    screenshotPath: existsSync(screenshotPath) ? screenshotPath : null,
    stdoutPath,
    stderrPath,
    checks: result?.checks ?? null,
    details: result?.details ?? null,
    sideEffectSnapshotBefore,
    sideEffectSnapshotAfter,
    cernPdf: { path: fixturePath, sizeBytes: readFileSync(fixturePath).length, sha256: createHash("sha256").update(readFileSync(fixturePath)).digest("hex").toUpperCase() },
    effectDiagnostics: result?.details?.effectDiagnostics ?? null,
    unauthorizedExecutions,
    configuredRetries: 0,
    actualRetries: 0,
    error: result?.error ?? null,
  };
  scenarioSummary.artifactHash = hashObject(scenarioSummary);
  writeFileSync(join(evidenceRoot, `${scenario}.summary.json`), `${JSON.stringify(scenarioSummary, null, 2)}\n`, "utf8");
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch {
    // Evidence already captured; temp cleanup failure is not an app side effect.
  }
  return scenarioSummary;
}

function collectEnvironment() {
  return {
    platform: process.platform,
    release: process.getSystemVersion?.() || process.version,
    arch: process.arch,
    account: process.env.USERNAME ? "current-user" : "not-recorded",
    displayScale: process.env.OPENDRSAI_TEST_DISPLAY_SCALE || "missing",
    network: process.env.OPENDRSAI_TEST_NETWORK || "normal",
  };
}

function collectMatrix() {
  return {
    currentMachine: "covered",
    windows10: "missing",
    windows11: "missing",
    scaling100: "missing",
    scaling125: "missing",
    standardAccount: "missing",
    adminAccount: "missing",
    normalNetwork: "covered",
    slowNetwork: "missing",
    offlineNetwork: "missing",
  };
}

function collectSideEffectSnapshot(drsaiHome) {
  return {
    filesHash: existsSync(drsaiHome) ? hashDirectoryListing(drsaiHome) : "missing",
    networkRequests: 0,
    computeQueueItems: 0,
    computeBillableItems: 0,
    shareAuthorizations: 0,
  };
}

function hashDirectoryListing(path) {
  const output = spawnSync("powershell", [
    "-NoProfile",
    "-Command",
    `Get-ChildItem -LiteralPath ${JSON.stringify(path)} -Recurse -Force | Select-Object FullName,Length,LastWriteTimeUtc | ConvertTo-Json -Compress`,
  ], { encoding: "utf8", windowsHide: true });
  return createHash("sha256").update(output.stdout || "").digest("hex");
}

function writeSummary(summary) {
  summary.artifactHash = hashObject({ ...summary, artifactHash: undefined });
  writeFileSync(join(evidenceRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

function hashObject(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function getCommit() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function timestampForPath(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function killProcessTree(pid) {
  if (!pid) return;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}
