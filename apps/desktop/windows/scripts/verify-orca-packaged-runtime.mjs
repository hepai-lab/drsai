import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const resources = join(desktop, "release", "win-unpacked", "resources");
const executable = join(desktop, "release", "win-unpacked", "OpenDrSai.exe");
const appAsar = join(resources, "app.asar");
const backendZip = join(resources, "backend", "drsai-backend-source.zip");
assert.ok(existsSync(executable) && existsSync(appAsar) && existsSync(backendZip), "Packaged Desktop/Backend artifacts are missing");

const main = asar.extractFile(appAsar, "out\\main\\index.js").toString("utf8");
for (const marker of ["/worktrees", "pty.create", "codex", "connectRuntimeClientForWorkspace"]) {
  assert.ok(main.includes(marker), `Packaged main process is missing ${marker}`);
}
const backendBytes = readFileSync(backendZip);
for (const marker of ["codex_adapter/backend_client.py", "git_worktree_service.py", "terminal_state_service.py", "runtime_terminal.py"]) {
  assert.ok(backendBytes.includes(Buffer.from(marker)), `Packaged Backend source is missing ${marker}`);
}

const versionResult = spawnSync("powershell.exe", ["-NoProfile", "-Command", "codex --version"], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
assert.equal(versionResult.status, 0, versionResult.stderr || "Codex --version failed");
const initialize = await initializeCodex();
assert.equal(initialize.id, 1);
assert.ok(initialize.result, "Codex App Server initialize response is missing result");

const evidence = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), version: JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")).version,
  executable, asarSha256: createHash("sha256").update(readFileSync(appAsar)).digest("hex"),
  codexVersion: `${versionResult.stdout}${versionResult.stderr}`.trim(), codexAppServerInitialized: true,
  packagedModules: ["Codex Adapter", "Git Worktree Service", "Runtime Terminal", "Unified Runtime Client"], passed: true,
};
const evidenceDir = join(desktop, "release", "product-evidence", "orca-inspired");
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(join(evidenceDir, "orca-packaged-runtime.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`Packaged Desktop contains Codex/Worktree/Terminal Runtime paths; ${evidence.codexVersion} App Server initialized.`);

function initializeCodex() {
  return new Promise((resolveInitialize, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", "codex app-server --listen 'stdio://'"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); child.kill();
      error ? reject(error) : resolveInitialize(value);
    };
    const timer = setTimeout(() => finish(new Error(`Codex App Server initialize timed out: ${stderr}`)), 45_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const line = stdout.split(/\r?\n/).find((item) => item.trim().startsWith("{"));
      if (line) { try { finish(null, JSON.parse(line)); } catch {} }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", finish);
    child.once("exit", (code) => { if (!settled) finish(new Error(`Codex App Server exited ${code}: ${stderr}`)); });
    child.stdin.write(`${JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "OpenDrSai Packaged Acceptance", version: "1.0.0" } } })}\n`);
  });
}
