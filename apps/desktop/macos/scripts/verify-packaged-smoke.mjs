import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Packaged macOS smoke must run on Apple Silicon macOS.");
const root = resolve(new URL("..", import.meta.url).pathname);
const executable = join(root, "release", "mac-arm64", "OpenDrSai.app", "Contents", "MacOS", "OpenDrSai");
assert.ok(existsSync(executable), `packaged executable missing: ${executable}`);
const temp = await mkdtemp(join(tmpdir(), "opendrsai-macos-packaged-"));
const resultPath = join(temp, "result.json");
const child = spawn(executable, [], {
  env: { ...process.env, DRSAI_HOME: join(temp, "home"), OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE: resultPath, ELECTRON_ENABLE_LOGGING: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
const exitCode = await Promise.race([
  new Promise((resolveExit) => child.once("exit", (code) => resolveExit(code))),
  new Promise((_, reject) => setTimeout(() => reject(new Error("Packaged smoke timed out.")), 45_000)),
]).finally(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
try {
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
  console.log("macOS packaged smoke passed (renderer/preload/IPC, concurrent Gateway start, zsh PTY, zero orphan processes)." );
} finally {
  await rm(temp, { recursive: true, force: true });
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
