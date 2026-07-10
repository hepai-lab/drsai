import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.log("Install source archive verification is only supported on Windows; skipped.");
  process.exit(0);
}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(root, "..", "..", "..");
const installScript = join(repoRoot, "scripts", "install.ps1");
const manifestPath = join(root, "resources", "backend", "backend-source.json");
const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-install-source-"));
const drsaiHome = join(tempDir, "drsai-home");
const installDir = join(drsaiHome, "drsai-agent");
const pythonPath = resolvePythonPath();
const powershellPath = join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const noGitPath = [
  process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32",
  process.env.SystemRoot || "C:\\Windows",
].join(";");

try {
  if (!existsSync(manifestPath)) {
    throw new Error("Run npm run bundle:backend before verifying source archive install mode.");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const archivePath = join(root, "resources", "backend", manifest.archive);
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    installScript,
    "-DrsaiHome",
    drsaiHome,
    "-SourceArchive",
    archivePath,
    "-SourceArchiveSha256",
    manifest.sha256,
    "-SourceArchiveCheckOnly",
    "-Python",
    pythonPath,
  ];

  const result = spawnSync(powershellPath, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: noGitPath,
      Path: noGitPath,
    },
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (result.error) {
    throw new Error(`Could not start PowerShell for source archive verification: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`install.ps1 -SourceArchiveCheckOnly failed with code ${result.status}.\n${output}`);
  }
  for (const forbidden of [
    "git is required",
    "Cloning ",
    "Creating virtual environment",
    "Installing DrSai package",
  ]) {
    if (output.includes(forbidden)) {
      throw new Error(`Source archive check unexpectedly reached ${forbidden}.\n${output}`);
    }
  }
  if (!output.includes("Source archive check complete.")) {
    throw new Error(`Source archive check did not complete.\n${output}`);
  }
  if (!output.includes("git: not required (using source archive)")) {
    throw new Error(`Source archive check did not prove git-free mode.\n${output}`);
  }
  if (!existsSync(join(installDir, "cores", "python", "packages", "drsai", "pyproject.toml"))) {
    throw new Error("Source archive check did not extract the DrSai package.");
  }

  console.log("Install script source archive verification passed.");
} finally {
  cleanupTempDir(tempDir);
}
process.exit(process.exitCode ?? 0);

function cleanupTempDir(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (error) {
    console.warn(`Could not remove temporary directory ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolvePythonPath() {
  if (process.env.OPENDRSAI_CHECKONLY_PYTHON) {
    return process.env.OPENDRSAI_CHECKONLY_PYTHON;
  }
  for (const candidate of [
    "C:\\Python311\\python.exe",
    "C:\\Program Files\\Python311\\python.exe",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  for (const candidate of [
    ["py", ["-3.11", "-c", "import sys; print(sys.executable)"]],
    ["python", ["-c", "import sys; print(sys.executable)"]],
    ["python3", ["-c", "import sys; print(sys.executable)"]],
  ]) {
    const result = spawnSync(candidate[0], candidate[1], {
      encoding: "utf8",
      windowsHide: true,
    });
    const output = result.stdout?.trim();
    if (result.status === 0 && output && existsSync(output)) {
      return output;
    }
  }
  throw new Error("Could not resolve a Python executable for source archive verification.");
}
