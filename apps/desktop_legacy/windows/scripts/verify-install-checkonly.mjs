import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.log("Install check-only verification is only supported on Windows; skipped.");
  process.exit(0);
}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(root, "..", "..", "..");
const installScript = join(repoRoot, "scripts", "install.ps1");
const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-install-checkonly-"));
const drsaiHome = join(tempDir, "drsai-home");
const installDir = join(drsaiHome, "drsai-agent");

try {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    installScript,
    "-DrsaiHome",
    drsaiHome,
    "-CheckOnly",
  ];
  if (process.env.OPENDRSAI_CHECKONLY_PYTHON) {
    args.push("-Python", process.env.OPENDRSAI_CHECKONLY_PYTHON);
  }

  const result = spawnSync("powershell.exe", args, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (result.status !== 0) {
    throw new Error(`install.ps1 -CheckOnly failed with code ${result.status}.\n${output}`);
  }
  if (!output.includes("Prerequisite check complete.")) {
    throw new Error(`install.ps1 -CheckOnly did not report successful prerequisite check.\n${output}`);
  }
  if (output.includes("[2/6] Setting up repository")) {
    throw new Error(`install.ps1 -CheckOnly unexpectedly reached repository setup.\n${output}`);
  }
  if (existsSync(installDir)) {
    throw new Error(`install.ps1 -CheckOnly unexpectedly created ${installDir}.`);
  }

  console.log("Install script check-only verification passed.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
