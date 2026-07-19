import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const liveMode = Boolean(process.env.OPENDRSAI_VOICE_LIVE_FIXTURE);
const evidenceDir = join(root, "release", liveMode ? "voice-provider-live-evidence" : "voice-packaged-evidence");
const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-packaged-voice-"));
const resultPath = join(tempDir, "result.json");
const voiceTempPattern = /^opendrsai-voice-[0-9a-f-]+\.(webm|ogg|wav|m4a|mp3|audio)$/i;
const beforeVoiceFiles = new Set(readdirSync(tmpdir()).filter((name) => voiceTempPattern.test(name)));

assert.equal(process.platform, "win32", "Packaged voice smoke is supported only on Windows.");
assert.ok(existsSync(exePath), "Build release/win-unpacked before running packaged voice smoke.");
mkdirSync(evidenceDir, { recursive: true });

let stdout = "";
let stderr = "";
try {
  const result = await runPackagedApp();
  if (result.exitCode !== 0 && existsSync(resultPath)) {
    const failedReport = readFileSync(resultPath, "utf8");
    writeFileSync(join(evidenceDir, "failed-report.json"), failedReport, "utf8");
    stderr += `\nPackaged voice failed report: ${failedReport}`;
  }
  assert.equal(result.exitCode, 0, `Packaged voice process failed.\n${stdout}\n${stderr}`);
  assert.ok(existsSync(resultPath), "Packaged voice process did not write a result.");
  const report = JSON.parse(readFileSync(resultPath, "utf8"));
  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.ok(Object.values(report.checks).every(Boolean), JSON.stringify(report.checks, null, 2));
  const afterVoiceFiles = readdirSync(tmpdir()).filter((name) => voiceTempPattern.test(name) && !beforeVoiceFiles.has(name));
  assert.deepEqual(afterVoiceFiles, [], `Packaged voice smoke leaked temporary files: ${afterVoiceFiles.join(", ")}`);
  const combinedLogs = `${stdout}\n${stderr}`;
  assert.equal(combinedLogs.includes("Packaged voice fixture"), false, "TTS text leaked into packaged logs.");
  assert.equal(combinedLogs.includes("Fixture voice transcript"), false, "Transcript leaked into packaged logs.");
  const evidence = { ...report, checkedAt: new Date().toISOString(), exePath, liveMode, noNewVoiceTempFiles: true, noVoiceContentInLogs: true };
  writeFileSync(join(evidenceDir, "report.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`${liveMode ? "Live provider" : "Packaged fixture"} voice smoke passed with real Main/Preload IPC. Evidence: ${join(evidenceDir, "report.json")}`);
} finally {
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

function runPackagedApp() {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = spawn(exePath, [
      `--user-data-dir=${join(tempDir, "electron-user-data")}`,
      "--no-sandbox",
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--in-process-gpu",
    ], {
      cwd: root,
      env: {
        ...process.env,
        DRSAI_HOME: join(tempDir, "drsai-home"),
        OPENDRSAI_DEV_AUTH_BYPASS: "1",
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_TIMEOUT_MS: "30000",
        OPENDRSAI_E2E_VOICE: "1",
        OPENDRSAI_VOICE_RUNTIME: liveMode ? "gateway-provider" : "fixture",
        OPENDRSAI_VOICE_TTS_RUNTIME: liveMode ? "gateway-provider" : "fixture",
        PATH: [dirname(exePath), process.env.PATH || ""].join(delimiter),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child.pid);
      resolvePromise({ exitCode: 124 });
    }, 45_000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ exitCode });
    });
  });
}

function killProcessTree(pid) {
  if (!pid) return;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
}
