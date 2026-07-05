import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = join(root, "resources", "backend", "backend-source.json");
const archivePath = join(root, "resources", "backend", "opendrsai-backend-source.zip");
const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-backend-bundle-"));
const deterministicDir = mkdtempSync(join(tmpdir(), "opendrsai-backend-deterministic-"));

try {
  if (!existsSync(manifestPath)) throw new Error(`Missing ${manifestPath}.`);
  if (!existsSync(archivePath)) throw new Error(`Missing ${archivePath}.`);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.archive !== "opendrsai-backend-source.zip") {
    throw new Error(`Unexpected backend archive name: ${manifest.archive}`);
  }
  if (!/^[a-f0-9]{64}$/.test(String(manifest.sha256))) {
    throw new Error("Backend archive manifest sha256 is invalid.");
  }
  const actualHash = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  if (actualHash !== manifest.sha256) {
    throw new Error(`Backend archive sha256 mismatch. Expected ${manifest.sha256}, got ${actualHash}.`);
  }

  run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(tempDir)} -Force`,
  ]);

  const pyproject = join(tempDir, "cores", "python", "packages", "drsai", "pyproject.toml");
  if (!existsSync(pyproject)) {
    throw new Error("Backend archive does not contain cores/python/packages/drsai/pyproject.toml.");
  }
  verifyDeterministicGeneration();

  console.log(`Bundled backend source verified (${manifest.sha256}).`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(deterministicDir, { recursive: true, force: true });
}

function verifyDeterministicGeneration() {
  const first = join(deterministicDir, "first");
  const second = join(deterministicDir, "second");
  run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(root, "scripts", "create-backend-source-archive.ps1"),
    "-OutDir",
    first,
  ]);
  run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(root, "scripts", "create-backend-source-archive.ps1"),
    "-OutDir",
    second,
  ]);
  const firstManifest = JSON.parse(readFileSync(join(first, "backend-source.json"), "utf8"));
  const secondManifest = JSON.parse(readFileSync(join(second, "backend-source.json"), "utf8"));
  const firstHash = createHash("sha256")
    .update(readFileSync(join(first, "opendrsai-backend-source.zip")))
    .digest("hex");
  const secondHash = createHash("sha256")
    .update(readFileSync(join(second, "opendrsai-backend-source.zip")))
    .digest("hex");
  if (firstHash !== secondHash || firstManifest.sha256 !== secondManifest.sha256 || firstHash !== firstManifest.sha256) {
    throw new Error(
      `Backend archive generation is not deterministic. First ${firstHash}, second ${secondHash}.`,
    );
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} failed with code ${result.status}.\n${output}`);
  }
}
