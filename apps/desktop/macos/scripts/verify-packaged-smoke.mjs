import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  assert.equal(child.exitCode, 0, "application did not exit cleanly after PTY cleanup");
  console.log("macOS packaged smoke passed (renderer/preload/IPC, zsh PTY roundtrip, kill, clean app exit)." );
} finally {
  await rm(temp, { recursive: true, force: true });
}
