import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
if (!existsSync(executable)) throw new Error("Build release/win-unpacked before running the runtime update E2E test.");
const updateMainSource = readFileSync(join(root, "src", "main", "updates.ts"), "utf8");
const updaterSource = readFileSync(join(root, "resources", "update", "update-opendrsai.ps1"), "utf8");
assert(updateMainSource.includes('"https://download-opendrsai.ihep.ac.cn/channels/beta/latest-windows.json"'), "Desktop updater does not default to the OpenDrSai beta channel manifest.");
assert(updateMainSource.includes('"download-opendrsai.ihep.ac.cn"'), "Desktop updater does not trust the OpenDrSai CDN host.");
assert(updateMainSource.includes("OPENDRSAI_UPDATE_DATA_ROOT") && updateMainSource.includes('join(localAppData, "OpenDrSai", "updates")'), "Update cache is not rooted in writable LocalAppData.");
assert(updateMainSource.includes("-Verb RunAs") && updateMainSource.includes("launchElevatedUpdater"), "Program Files update apply does not request administrator approval.");
assert(updaterSource.includes('Join-Path (Split-Path -Parent $StatePath) "health-$HealthToken.ok"'), "Update health marker still depends on the protected install root.");
const currentVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const targetVersion = nextTestVersion(currentVersion);

const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-update-e2e-"));
const runtimePath = join(testRoot, "OpenDrSaiRuntime-win-x64.zip");
execFileSync("powershell.exe", [
  "-NoProfile", "-ExecutionPolicy", "Bypass",
  "-File", join(root, "scripts", "create-update-runtime-fixture.ps1"),
  "-OutPath", runtimePath,
  "-Version", targetVersion,
], { stdio: "inherit", windowsHide: true });
const runtime = readFileSync(runtimePath);
const runtimeHash = createHash("sha256").update(runtime).digest("hex");
let rangeRequests = 0;
let runtimeRequests = 0;
let manifestRequests = 0;
let manifestHash = runtimeHash;
let manifestVersion = targetVersion;
let minimumUpdaterVersion = "1.4.2";
let runtimeRoute = "/OpenDrSaiRuntime-win-x64.zip";

const server = createServer((request, response) => {
  if (request.url === "/latest-windows.json") {
    manifestRequests += 1;
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const manifest = {
      schemaVersion: 1,
      version: manifestVersion,
      channel: "dev",
      publishedAt: new Date().toISOString(),
      minimumUpdaterVersion,
      mandatory: false,
      requireSignature: false,
      runtime: { url: `${baseUrl}${runtimeRoute}`, sizeBytes: runtime.length, sha256: manifestHash },
      releaseNotesUrl: `${baseUrl}/release-notes`,
    };
    const body = Buffer.from(`${JSON.stringify(manifest)}\n`);
    response.writeHead(200, { "Content-Type": "application/json", "Content-Length": body.length });
    response.end(body);
    return;
  }
  if (request.url === "/OpenDrSaiRuntime-win-x64.zip") {
    runtimeRequests += 1;
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d+)-$/.exec(range);
      if (!match) { response.writeHead(416).end(); return; }
      const offset = Number(match[1]);
      rangeRequests += 1;
      const body = runtime.subarray(offset);
      response.writeHead(206, {
        "Content-Type": "application/zip",
        "Content-Length": body.length,
        "Content-Range": `bytes ${offset}-${runtime.length - 1}/${runtime.length}`,
        "Accept-Ranges": "bytes",
      });
      response.end(body);
      return;
    }
    response.writeHead(200, { "Content-Type": "application/zip", "Content-Length": runtime.length, "Accept-Ranges": "bytes" });
    response.end(runtime);
    return;
  }
  if (request.url === "/redirect-runtime") {
    response.writeHead(302, { Location: "https://example.com/untrusted-runtime.zip" });
    response.end();
    return;
  }
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("release notes");
});

await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
try {
  const installRoot = join(testRoot, "install");
  const partial = join(updateDataRootFor("success"), "cache", targetVersion, "OpenDrSaiRuntime-win-x64.zip.partial");
  mkdirSync(resolve(partial, ".."), { recursive: true });
  writeFileSync(partial, runtime.subarray(0, 127));
  const success = await runApp("success", installRoot);
  assert(success.exitCode === 0, `Successful update protocol smoke exited ${success.exitCode}: ${success.stderr}`);
  assert(success.result?.ok === true, `Successful update protocol smoke failed: ${JSON.stringify(success.result)}`);
  assert(rangeRequests > 0, "Runtime download did not resume from the partial file with a Range request.");
  assert(success.result.checks.updateAvailable && success.result.checks.updateReady && success.result.checks.downloadComplete, "Update protocol did not reach ready state.");
  assert(!existsSync(join(installRoot, "update-cache")) && !existsSync(join(installRoot, "update-staging")) && !existsSync(join(installRoot, "updater")) && !existsSync(join(installRoot, "update-state.json")), "Update preparation wrote mutable state inside the protected install root.");
  const requestsBeforeRestore = manifestRequests;
  const restored = await runApp("restored", installRoot, { updateDataRoot: updateDataRootFor("success") });
  assert(restored.exitCode === 0 && restored.result?.ok === true, `Prepared update was not restored after restart: ${JSON.stringify(restored.result)}`);
  assert(manifestRequests === requestsBeforeRestore, "Restoring a prepared update unnecessarily contacted the manifest server.");

  manifestHash = "0".repeat(64);
  const badHashRoot = join(testRoot, "bad-hash-install");
  const badHash = await runApp("bad-hash", badHashRoot);
  assert(badHash.exitCode !== 0, "Hash mismatch scenario unexpectedly succeeded.");
  assert(badHash.result?.details?.downloaded?.errorCode === "hash-mismatch", `Hash mismatch error was not preserved: ${JSON.stringify(badHash.result)}`);
  assert(!existsSync(join(updateDataRootFor("bad-hash"), "cache", targetVersion, "OpenDrSaiRuntime-win-x64.zip")), "Hash mismatch left a trusted runtime archive behind.");

  manifestHash = runtimeHash;
  runtimeRoute = "/redirect-runtime";
  const redirect = await runApp("untrusted-redirect", join(testRoot, "untrusted-redirect-install"));
  assert(redirect.exitCode !== 0, "Untrusted runtime redirect unexpectedly succeeded.");
  assert(redirect.result?.details?.downloaded?.errorCode === "untrusted-host", `Untrusted redirect was not rejected before download: ${JSON.stringify(redirect.result)}`);

  runtimeRoute = "/OpenDrSaiRuntime-win-x64.zip";
  minimumUpdaterVersion = targetVersion;
  const runtimeRequestsBeforeOldUpdater = runtimeRequests;
  const oldUpdater = await runApp("old-updater", join(testRoot, "old-updater-install"));
  assert(oldUpdater.exitCode !== 0, "Unsafe updater unexpectedly attempted the runtime update.");
  assert(oldUpdater.result?.details?.checked?.errorCode === "updater-too-old", `Unsafe updater did not receive the compatibility error: ${JSON.stringify(oldUpdater.result)}`);
  assert(runtimeRequests === runtimeRequestsBeforeOldUpdater, "Unsafe updater contacted the runtime download endpoint.");

  minimumUpdaterVersion = "1.4.2";
  manifestVersion = "1.4.1";
  const downgrade = await runApp("downgrade", join(testRoot, "downgrade-install"));
  assert(downgrade.exitCode !== 0, "Downgrade manifest unexpectedly produced an update.");
  assert(downgrade.result?.details?.checked?.phase === "idle", `Downgrade was not ignored: ${JSON.stringify(downgrade.result)}`);

  const rollbackRoot = join(testRoot, "rolled-back-install");
  mkdirSync(rollbackRoot, { recursive: true });
  const rollbackUpdateRoot = updateDataRootFor("rolled-back");
  mkdirSync(rollbackUpdateRoot, { recursive: true });
  writeFileSync(join(rollbackUpdateRoot, "update-state.json"), `${JSON.stringify({
    schemaVersion: 1,
    phase: "rolled-back",
    version: targetVersion,
    message: "Updated app did not confirm a healthy startup.",
    updatedAt: new Date().toISOString(),
  })}\n`);
  const rolledBack = await runApp("rolled-back", rollbackRoot, { outcomeOnly: true });
  assert(rolledBack.exitCode === 0 && rolledBack.result?.ok === true, `Packaged app did not restore the rollback outcome: ${JSON.stringify(rolledBack.result)}`);
  assert(rolledBack.result?.checks?.rollbackDetected, "Packaged app did not expose the failed update as rolled back.");
  assert(rolledBack.result?.checks?.previousRuntimeActive, "Packaged app did not report the working runtime after rollback.");
  assert(rolledBack.result?.checks?.recoveryIsAutomatic, "Packaged app did not identify the recovery as automatic.");
  const rendererSource = readFileSync(join(root, "..", "shared", "renderer", "src", "App.tsx"), "utf8");
  assert(rendererSource.includes("已自动恢复到可用版本") && rendererSource.includes("账户、任务、工作区和文件未受影响"), "Chinese user-facing rollback explanation is missing.");
  assert(rendererSource.includes("automatically restored working version") && rendererSource.includes("account, tasks, workspace, and files were not affected"), "English user-facing rollback explanation is missing.");
  const evidenceDir = join(root, "release", "product-evidence", "m2-update-rollback");
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, "packaged-update-result.json"), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    ok: true,
    currentVersion,
    targetVersion,
    checks: {
      resumedPartialDownload: rangeRequests > 0,
      verifiedAndStaged: true,
      preparedUpdateRestoredAfterRestart: true,
      corruptedDownloadRejected: true,
      untrustedRedirectRejected: true,
      unsafeUpdaterRejectedBeforeDownload: true,
      downgradeIgnored: true,
      rollbackDetectedAfterPackagedRestart: rolledBack.result.checks.rollbackDetected,
      previousRuntimeActive: rolledBack.result.checks.previousRuntimeActive,
      automaticRecoveryExposed: rolledBack.result.checks.recoveryIsAutomatic,
      failedVersionVisible: rolledBack.result.checks.failedVersionVisible,
      chineseUserExplanationPresent: true,
      englishUserExplanationPresent: true,
    },
    rollbackStatus: rolledBack.result.details.restored,
  }, null, 2)}\n`);

  console.log("Packaged runtime update protocol E2E passed (resume, verify, stage, restart restore, hash rejection, redirect trust, updater compatibility floor, downgrade guard, visible automatic rollback)." );
} finally {
  await new Promise((resolvePromise) => server.close(resolvePromise));
  rmSync(testRoot, { recursive: true, force: true });
}

function runApp(name, installRoot, options = {}) {
  const resultPath = join(testRoot, `${name}-result.json`);
  const userData = join(testRoot, `${name}-user-data`);
  const manifestUrl = `http://127.0.0.1:${server.address().port}/latest-windows.json`;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [], {
      env: {
        ...process.env,
        OPENDRSAI_E2E_UPDATE_PROTOCOL: "1",
        OPENDRSAI_E2E_UPDATE_OUTCOME_ONLY: options.outcomeOnly ? "1" : "0",
        OPENDRSAI_E2E_SMOKE: "1",
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_USER_DATA: userData,
        OPENDRSAI_UPDATE_MANIFEST_URL: manifestUrl,
        OPENDRSAI_UPDATE_CHANNEL: "dev",
        OPENDRSAI_ALLOW_INSECURE_UPDATE_URLS: "1",
        OPENDRSAI_ALLOW_UNSIGNED_UPDATES: "1",
        OPENDRSAI_UPDATE_INSTALL_ROOT: installRoot,
        OPENDRSAI_UPDATE_DATA_ROOT: options.updateDataRoot || updateDataRootFor(name),
        OPENDRSAI_UPDATE_AGENT_DIR: join(testRoot, `${name}-agent`),
        OPENDRSAI_UPDATE_HELPER_PATH: join(root, "resources", "update", "update-opendrsai.ps1"),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Update E2E ${name} timed out.`)); }, 120_000);
    child.on("exit", (exitCode) => {
      clearTimeout(timer);
      const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
      resolvePromise({ exitCode, stdout, stderr, result });
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function nextTestVersion(version) {
  const prerelease = /^(\d+\.\d+\.\d+)-([0-9A-Za-z.-]*?)(\d+)$/.exec(version);
  if (prerelease) return `${prerelease[1]}-${prerelease[2]}${Number(prerelease[3]) + 1}`;
  const stable = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!stable) throw new Error(`Update E2E requires a semantic version, got ${version}.`);
  return `${stable[1]}.${stable[2]}.${Number(stable[3]) + 1}`;
}

function updateDataRootFor(name) {
  return join(testRoot, `${name}-update-data`);
}
