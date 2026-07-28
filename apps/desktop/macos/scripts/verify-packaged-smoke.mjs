import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Packaged macOS smoke must run on Apple Silicon macOS.");
const root = resolve(new URL("..", import.meta.url).pathname);
const executable = join(root, "release", "mac-arm64", "OpenDrSai.app", "Contents", "MacOS", "OpenDrSai");
assert.ok(existsSync(executable), `packaged executable missing: ${executable}`);
const runtimeRoot = join(root, "release", "mac-arm64", "OpenDrSai.app", "Contents", "Resources", "runtime");
const runtimeManifest = JSON.parse(await readFile(join(runtimeRoot, "runtime-manifest.json"), "utf8"));
const runtimeArchive = await stat(join(runtimeRoot, runtimeManifest.archive));
const runtimeGiB = Math.ceil(runtimeArchive.size / (1024 ** 3));
const timeoutMs = Math.min(360_000, 45_000 + runtimeGiB * 45_000);
const temp = await mkdtemp(join(tmpdir(), "opendrsai-macos-packaged-"));
const resultPath = join(temp, "result.json");
const gatewayPort = await freePort();
const child = spawn(executable, [], {
  env: { ...process.env, DRSAI_HOME: join(temp, "home"), DRSAI_API_PORT: String(gatewayPort), OPENDRSAI_RUNTIME_PERSIST: "0", OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE: resultPath, ELECTRON_ENABLE_LOGGING: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
try {
  const exitCode = await waitForCleanClose(child, timeoutMs, runtimeArchive.size);
  assert.equal(exitCode, 0, stderr);
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  assert.equal(result.ok, true);
  assert.equal(result.descriptor.id, "macos");
  assert.equal(result.install.installed, true);
  assert.match(result.install.pythonPath, /venv\/bin\/python$/);
  assert.equal(result.terminal.shellProfile, "zsh");
  assert.match(result.terminalOutput, /OPENDRSAI_MACOS_PTY_OK/);
  assert.deepEqual(result.gatewayStarts, [true, true]);
  assert.equal(result.gateway.ready, true);
  assert.equal(child.exitCode, 0, "application did not exit cleanly after process cleanup");
  assert.equal(isProcessAlive(result.terminal.pid), false, `PTY PID ${result.terminal.pid} survived app exit`);
  assert.equal(isProcessAlive(result.gateway.pid), false, `Gateway PID ${result.gateway.pid} survived app exit`);
  const evidencePath = process.env.OPENDRSAI_MACOS_PACKAGED_EVIDENCE_FILE || join(root, "build", "acceptance", "packaged-smoke.json");
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify({
    schemaVersion: 2,
    testId: "packaged-smoke",
    platform: "darwin-arm64",
    passed: true,
    featureIds: ["F01.6", "F03.1", "F03.4", "F04.4", "F04.6", "F07.6", "F12.1"],
    checks: {
      rendererPreloadIpc: true,
      runtimeInstalled: true,
      concurrentGatewaySingleFlight: true,
      zshPtyRoundtrip: true,
      gatewayOrphans: 0,
      ptyOrphans: 0
    },
    generatedAt: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
  console.log(`macOS packaged smoke passed (renderer/preload/IPC, ${runtimeGiB}GiB Runtime budget, concurrent Gateway start, zsh PTY, zero orphan processes).`);
} catch (error) {
  const failureLog = join(root, "build", "acceptance", "packaged-smoke-failure.log");
  await mkdir(dirname(failureLog), { recursive: true });
  const scenarioResult = await readFile(resultPath, "utf8").catch(() => "<packaged scenario did not write a result>\n");
  await writeFile(failureLog, `Scenario result:\n${scenarioResult}\nCaptured stderr:\n${stderr}`, "utf8");
  if (stderr.trim()) console.error(stderr.trim());
  throw error;
} finally {
  await rm(temp, { recursive: true, force: true });
}

function waitForCleanClose(process, timeout, runtimeBytes) {
  return new Promise((resolveClose, reject) => {
    const timer = setTimeout(() => {
      process.kill("SIGKILL");
      reject(new Error(`Packaged smoke timed out after ${timeout}ms while installing a ${runtimeBytes}-byte Runtime.`));
    }, timeout);
    process.once("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) reject(new Error(`Packaged smoke App exited from signal ${signal}.`));
      else resolveClose(code);
    });
  });
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : port ? resolvePort(port) : reject(new Error("Could not reserve a Gateway port.")));
    });
  });
}
