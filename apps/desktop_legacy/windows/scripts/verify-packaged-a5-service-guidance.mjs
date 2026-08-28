import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const e2eTimeoutMs = Number(process.env.OPENDRSAI_E2E_TIMEOUT_MS || "30000");
const processTimeoutMs = e2eTimeoutMs + 15_000;
const scenarios = [
  "auth_required",
  "service_unavailable",
  "runtime_missing",
  "permission_denied",
];
const commit = getCommit();
const evidenceRoot = resolve(
  process.env.OPENDRSAI_A5_EVIDENCE_DIR ||
  join(root, "release", "a5-service-guidance-evidence", timestampForPath(new Date())),
);
const screenshotDir = join(evidenceRoot, "screenshots");
const systemPath = [
  dirname(exePath),
  process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32",
  process.env.SystemRoot || "C:\\Windows",
  process.env.PATH || "",
].join(delimiter);

if (process.platform !== "win32") {
  console.log("Packaged A5 service guidance E2E is only supported on Windows; skipped.");
  process.exit(0);
}

if (!existsSync(exePath)) {
  throw new Error("Build the unpacked Windows app before running verify:packaged-a5-service-guidance.");
}

mkdirSync(evidenceRoot, { recursive: true });
mkdirSync(screenshotDir, { recursive: true });

const summary = {
  ok: true,
  startedAt: new Date().toISOString(),
  exePath,
  commit,
  evidenceRoot,
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
  summary.exitCode = summary.ok ? 0 : 1;
  writeFileSync(join(evidenceRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

if (!summary.ok) {
  throw new Error(`Packaged A5 service guidance E2E failed. Evidence: ${evidenceRoot}`);
}

console.log(`Packaged A5 service guidance E2E passed. Evidence: ${evidenceRoot}`);

async function runScenario(scenario) {
  const tempDir = mkdtempSync(join(tmpdir(), `opendrsai-a5-${scenario}-`));
  const resultPath = join(evidenceRoot, `${scenario}.result.json`);
  const stdoutPath = join(evidenceRoot, `${scenario}.stdout.log`);
  const stderrPath = join(evidenceRoot, `${scenario}.stderr.log`);
  const drsaiHome = join(tempDir, "drsai-home");
  const electronUserData = join(tempDir, "electron-user-data");
  mkdirSync(drsaiHome, { recursive: true });
  mkdirSync(electronUserData, { recursive: true });

  const startedAt = new Date().toISOString();
  let stdout = "";
  let stderr = "";
  let exitCode = null;
  let timedOut = false;

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
          OPENDRSAI_E2E_A5_SERVICE_GUIDANCE: "1",
          OPENDRSAI_A5_SERVICE_GUIDANCE_SCENARIO: scenario,
          OPENDRSAI_E2E_RESULT: resultPath,
          OPENDRSAI_E2E_TIMEOUT_MS: String(e2eTimeoutMs),
          OPENDRSAI_E2E_A5_SCREENSHOT_DIR: screenshotDir,
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
    writeFileSync(stdoutPath, stdout, "utf8");
    writeFileSync(stderrPath, stderr, "utf8");
    try {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch (error) {
      stderr += `\nCould not remove ${tempDir}: ${error instanceof Error ? error.message : String(error)}`;
      writeFileSync(stderrPath, stderr, "utf8");
    }
  }

  const result = existsSync(resultPath)
    ? JSON.parse(readFileSync(resultPath, "utf8"))
    : null;
  const screenshotPath = join(screenshotDir, `${scenario}.png`);
  const scenarioSummary = {
    scenario,
    ok: Boolean(exitCode === 0 && result?.ok && existsSync(screenshotPath)),
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    timedOut,
    resultPath,
    screenshotPath: existsSync(screenshotPath) ? screenshotPath : null,
    stdoutPath,
    stderrPath,
    appVersion: result?.details?.appVersion ?? null,
    commit,
    checks: result?.checks ?? null,
    error: result?.error ?? null,
  };

  writeFileSync(join(evidenceRoot, `${scenario}.summary.json`), `${JSON.stringify(scenarioSummary, null, 2)}\n`, "utf8");
  return scenarioSummary;
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
