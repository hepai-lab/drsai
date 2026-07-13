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

const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-update-e2e-"));
const runtimePath = join(testRoot, "OpenDrSaiRuntime-win-x64.zip");
execFileSync("powershell.exe", [
  "-NoProfile", "-ExecutionPolicy", "Bypass",
  "-File", join(root, "scripts", "create-update-runtime-fixture.ps1"),
  "-OutPath", runtimePath,
    "-Version", "1.4.3-beta.7",
], { stdio: "inherit", windowsHide: true });
const runtime = readFileSync(runtimePath);
const runtimeHash = createHash("sha256").update(runtime).digest("hex");
let rangeRequests = 0;
let manifestRequests = 0;
let manifestHash = runtimeHash;
let manifestVersion = "1.4.3-beta.7";
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
      minimumUpdaterVersion: "1.4.2",
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
    const partial = join(installRoot, "update-cache", "1.4.3-beta.7", "OpenDrSaiRuntime-win-x64.zip.partial");
  mkdirSync(resolve(partial, ".."), { recursive: true });
  writeFileSync(partial, runtime.subarray(0, 127));
  const success = await runApp("success", installRoot);
  assert(success.exitCode === 0, `Successful update protocol smoke exited ${success.exitCode}: ${success.stderr}`);
  assert(success.result?.ok === true, `Successful update protocol smoke failed: ${JSON.stringify(success.result)}`);
  assert(rangeRequests > 0, "Runtime download did not resume from the partial file with a Range request.");
  assert(success.result.checks.updateAvailable && success.result.checks.updateReady && success.result.checks.downloadComplete, "Update protocol did not reach ready state.");
  const requestsBeforeRestore = manifestRequests;
  const restored = await runApp("restored", installRoot);
  assert(restored.exitCode === 0 && restored.result?.ok === true, `Prepared update was not restored after restart: ${JSON.stringify(restored.result)}`);
  assert(manifestRequests === requestsBeforeRestore, "Restoring a prepared update unnecessarily contacted the manifest server.");

  manifestHash = "0".repeat(64);
  const badHashRoot = join(testRoot, "bad-hash-install");
  const badHash = await runApp("bad-hash", badHashRoot);
  assert(badHash.exitCode !== 0, "Hash mismatch scenario unexpectedly succeeded.");
  assert(badHash.result?.details?.downloaded?.errorCode === "hash-mismatch", `Hash mismatch error was not preserved: ${JSON.stringify(badHash.result)}`);
    assert(!existsSync(join(badHashRoot, "update-cache", "1.4.3-beta.7", "OpenDrSaiRuntime-win-x64.zip")), "Hash mismatch left a trusted runtime archive behind.");

  manifestHash = runtimeHash;
  runtimeRoute = "/redirect-runtime";
  const redirect = await runApp("untrusted-redirect", join(testRoot, "untrusted-redirect-install"));
  assert(redirect.exitCode !== 0, "Untrusted runtime redirect unexpectedly succeeded.");
  assert(redirect.result?.details?.downloaded?.errorCode === "untrusted-host", `Untrusted redirect was not rejected before download: ${JSON.stringify(redirect.result)}`);

  runtimeRoute = "/OpenDrSaiRuntime-win-x64.zip";
  manifestVersion = "1.4.1";
  const downgrade = await runApp("downgrade", join(testRoot, "downgrade-install"));
  assert(downgrade.exitCode !== 0, "Downgrade manifest unexpectedly produced an update.");
  assert(downgrade.result?.details?.checked?.phase === "idle", `Downgrade was not ignored: ${JSON.stringify(downgrade.result)}`);

  console.log("Packaged runtime update protocol E2E passed (resume, verify, stage, restart restore, hash rejection, redirect trust, downgrade guard)." );
} finally {
  await new Promise((resolvePromise) => server.close(resolvePromise));
  rmSync(testRoot, { recursive: true, force: true });
}

function runApp(name, installRoot) {
  const resultPath = join(testRoot, `${name}-result.json`);
  const userData = join(testRoot, `${name}-user-data`);
  const manifestUrl = `http://127.0.0.1:${server.address().port}/latest-windows.json`;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [], {
      env: {
        ...process.env,
        OPENDRSAI_E2E_UPDATE_PROTOCOL: "1",
        OPENDRSAI_E2E_SMOKE: "1",
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_USER_DATA: userData,
        OPENDRSAI_UPDATE_MANIFEST_URL: manifestUrl,
        OPENDRSAI_UPDATE_CHANNEL: "dev",
        OPENDRSAI_ALLOW_INSECURE_UPDATE_URLS: "1",
        OPENDRSAI_ALLOW_UNSIGNED_UPDATES: "1",
        OPENDRSAI_UPDATE_INSTALL_ROOT: installRoot,
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
