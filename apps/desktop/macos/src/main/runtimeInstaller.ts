import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app } from "electron";
import { DRSAI_HOME, DRSAI_PYTHON, DRSAI_REPO, DRSAI_SCRIPT } from "../../../shared/main/paths";

const execFileAsync = promisify(execFile);

interface RuntimeManifest {
  schemaVersion: 1;
  platform: "darwin";
  arch: "arm64";
  version: string;
  archive: string;
  sha256: string;
  root: "drsai-agent";
  python: "venv/bin/python";
  launcher: "drsai";
}

export function bundledRuntimeManifestPath(): string {
  return join(process.resourcesPath, "runtime", "runtime-manifest.json");
}

export function hasBundledRuntime(): boolean {
  return app.isPackaged && existsSync(bundledRuntimeManifestPath());
}

export async function ensureBundledRuntimeInstalled(): Promise<boolean> {
  if (existsSync(DRSAI_PYTHON) && existsSync(DRSAI_SCRIPT)) return true;
  if (!hasBundledRuntime()) return false;
  const manifest = await readManifest();
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error("Bundled Runtime platform does not match this Mac.");
  const archive = resolve(dirname(bundledRuntimeManifestPath()), manifest.archive);
  if (!archive.startsWith(`${resolve(dirname(bundledRuntimeManifestPath()))}/`) || !existsSync(archive)) throw new Error("Bundled Runtime archive is missing or outside resources.");
  if (await sha256(archive) !== manifest.sha256) throw new Error("Bundled Runtime SHA-256 verification failed.");

  await mkdir(DRSAI_HOME, { recursive: true });
  const transactionRoot = join(DRSAI_HOME, `.runtime-install-${randomUUID()}`);
  const candidate = join(transactionRoot, manifest.root);
  const backup = `${DRSAI_REPO}.previous`;
  let movedExisting = false;
  try {
    await mkdir(transactionRoot, { recursive: true });
    await execFileAsync("/usr/bin/tar", ["-xzf", archive, "-C", transactionRoot], { timeout: 120_000 });
    const candidatePython = join(candidate, manifest.python);
    const candidateLauncher = join(candidate, manifest.launcher);
    if (!existsSync(candidatePython) || !existsSync(candidateLauncher)) throw new Error("Bundled Runtime is incomplete after extraction.");
    await execFileAsync(candidatePython, ["-c", "import drsai"], { timeout: 60_000, env: { ...process.env, PYTHONNOUSERSITE: "1" } });
    await rm(backup, { recursive: true, force: true });
    if (existsSync(DRSAI_REPO)) {
      await rename(DRSAI_REPO, backup);
      movedExisting = true;
    }
    await rename(candidate, DRSAI_REPO);
    await rm(backup, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (movedExisting && !existsSync(DRSAI_REPO) && existsSync(backup)) await rename(backup, DRSAI_REPO).catch(() => undefined);
    throw error;
  } finally {
    await rm(transactionRoot, { recursive: true, force: true });
  }
}

async function readManifest(): Promise<RuntimeManifest> {
  const parsed = JSON.parse(await readFile(bundledRuntimeManifestPath(), "utf8")) as Partial<RuntimeManifest>;
  if (parsed.schemaVersion !== 1 || parsed.platform !== "darwin" || parsed.arch !== "arm64" || typeof parsed.version !== "string" || typeof parsed.archive !== "string" || !/^[a-f0-9]{64}$/.test(parsed.sha256 || "") || parsed.root !== "drsai-agent" || parsed.python !== "venv/bin/python" || parsed.launcher !== "drsai") throw new Error("Bundled Runtime manifest is invalid.");
  return parsed as RuntimeManifest;
}

async function sha256(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}
