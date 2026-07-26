import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app } from "electron";
import type { InstallProgress } from "../../../shared/api/desktopApi";
import { DRSAI_HOME, DRSAI_PYTHON, DRSAI_REPO, DRSAI_SCRIPT } from "../../../shared/main/paths";
import { assertRuntimeSymlinkStaysInsideRoot } from "./runtimeFilesystemPolicy";
import { isVirtualEnvironmentConfig, relocateRuntimeVirtualEnvironments, verifyRelocatedVirtualEnvironmentConfig } from "./runtimeVirtualEnvironment";

const execFileAsync = promisify(execFile);
const MIN_FREE_BYTES = 512 * 1024 * 1024;
const MIN_ARCHIVE_BYTES_PER_SECOND = 8 * 1024 * 1024;
const MIN_EXTRACTION_TIMEOUT_MS = 120_000;
const MAX_EXTRACTION_TIMEOUT_MS = 600_000;

interface RuntimeFile { path: string; sha256: string; size: number }
interface RuntimeManifest {
  schemaVersion: 2; platform: "darwin"; arch: "arm64"; version: string; pythonVersion: string;
  archive: string; archiveSize: number; sha256: string; root: "drsai-agent";
  python: "venv/bin/python"; launcher: "drsai"; sbom: string; provenance: string; files: RuntimeFile[];
}

let activeInstall: AbortController | null = null;

export function bundledRuntimeManifestPath(): string { return join(process.resourcesPath, "runtime", "runtime-manifest.json"); }
export function hasBundledRuntime(): boolean { return app.isPackaged && existsSync(bundledRuntimeManifestPath()); }
export function cancelBundledRuntimeInstall(): boolean {
  if (!activeInstall || activeInstall.signal.aborted) return false;
  activeInstall.abort();
  return true;
}

export async function ensureBundledRuntimeInstalled(onProgress: (progress: InstallProgress) => void = () => undefined, forceRepair = false): Promise<boolean> {
  if (activeInstall) throw new Error("Runtime installation is already running.");
  if (!forceRepair && existsSync(DRSAI_PYTHON) && existsSync(DRSAI_SCRIPT)) return true;
  if (!hasBundledRuntime()) return false;
  const controller = new AbortController(); activeInstall = controller;
  let log = "";
  const emit = (message: string): void => { log += `${message}\n`; onProgress({ phase: "running", message, log }); };
  try {
    emit("Validating bundled Runtime manifest...");
    const manifest = await readManifest();
    assertNotCancelled(controller.signal);
    if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error("Bundled Runtime platform does not match this Mac.");
    const resourceRoot = resolve(dirname(bundledRuntimeManifestPath()));
    const archive = resolveResource(resourceRoot, manifest.archive);
    const archiveStat = await stat(archive);
    if (archiveStat.size !== manifest.archiveSize) throw new Error("Bundled Runtime archive size does not match its manifest.");
    if (await sha256(archive) !== manifest.sha256) throw new Error("Bundled Runtime SHA-256 verification failed.");
    await Promise.all([stat(resolveResource(resourceRoot, manifest.sbom)), stat(resolveResource(resourceRoot, manifest.provenance))]);
    assertNotCancelled(controller.signal);
    await mkdir(DRSAI_HOME, { recursive: true });
    const free = await statfs(DRSAI_HOME);
    if (free.bavail * free.bsize < Math.max(MIN_FREE_BYTES, manifest.archiveSize * 3)) throw new Error("Not enough free disk space to install the bundled Runtime.");
    const transactionRoot = join(DRSAI_HOME, `.runtime-install-${randomUUID()}`);
    const candidate = join(transactionRoot, manifest.root);
    const backup = `${DRSAI_REPO}.previous`;
    let movedExisting = false;
    try {
      const extractionTimeoutMs = runtimeExtractionTimeoutMs(manifest.archiveSize);
      emit(`Extracting bundled Runtime (timeout ${Math.ceil(extractionTimeoutMs / 1_000)}s)...`);
      await mkdir(transactionRoot, { recursive: true });
      await execFileAsync("/usr/bin/tar", ["-xzf", archive, "-C", transactionRoot], { timeout: extractionTimeoutMs, signal: controller.signal });
      emit("Verifying extracted Runtime inventory...");
      await verifyRuntimeContents(candidate, manifest.files, controller.signal);
      emit("Relocating Runtime virtual environments...");
      await relocateRuntimeVirtualEnvironments(candidate, manifest.pythonVersion);
      const candidatePython = join(candidate, manifest.python);
      emit("Checking Runtime Python architecture and imports...");
      const importStatement = "import drsai";
      const probe = await execFileAsync(candidatePython, ["-c", `${importStatement}; import platform; print(platform.machine()); print(platform.python_version()); print(drsai.__file__)`], { timeout: 60_000, signal: controller.signal, env: { ...process.env, PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1" } });
      const [architecture, pythonVersion] = probe.stdout.trim().split(/\r?\n/);
      if (architecture !== manifest.arch || pythonVersion !== manifest.pythonVersion) throw new Error("Bundled Runtime Python architecture or version is invalid.");
      if (!existsSync(join(candidate, manifest.launcher))) throw new Error("Bundled Runtime launcher is missing.");
      await writeFile(join(candidate, ".opendrsai-runtime.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      assertNotCancelled(controller.signal);
      emit("Activating Runtime atomically...");
      await rm(backup, { recursive: true, force: true });
      if (existsSync(DRSAI_REPO)) { await rename(DRSAI_REPO, backup); movedExisting = true; }
      await rename(candidate, DRSAI_REPO);
      // The probe above needs candidate-relative metadata; activation changes
      // that absolute root, so seal the venv metadata to its final location.
      await relocateRuntimeVirtualEnvironments(DRSAI_REPO, manifest.pythonVersion);
      await rm(backup, { recursive: true, force: true });
      onProgress({ phase: "complete", message: "Runtime installation complete.", log, exitCode: 0 });
      return true;
    } catch (error) {
      if (movedExisting && !existsSync(DRSAI_REPO) && existsSync(backup)) await rename(backup, DRSAI_REPO).catch(() => undefined);
      throw error;
    } finally { await rm(transactionRoot, { recursive: true, force: true }); }
  } catch (error) {
    const message = controller.signal.aborted ? "Runtime installation cancelled." : error instanceof Error ? error.message : String(error);
    onProgress({ phase: "error", message, log, exitCode: 1 });
    throw new Error(message, { cause: error });
  } finally { activeInstall = null; }
}

export function runtimeExtractionTimeoutMs(archiveSize: number): number {
  if (!Number.isSafeInteger(archiveSize) || archiveSize <= 0) throw new Error("Runtime archive size is invalid.");
  return Math.min(MAX_EXTRACTION_TIMEOUT_MS, Math.max(MIN_EXTRACTION_TIMEOUT_MS, Math.ceil(archiveSize / MIN_ARCHIVE_BYTES_PER_SECOND) * 1_000));
}

export async function inspectInstalledRuntime(): Promise<{ version: string | null; healthy: boolean }> {
  const marker = join(DRSAI_REPO, ".opendrsai-runtime.json");
  if (!existsSync(marker) || !existsSync(DRSAI_PYTHON) || !existsSync(DRSAI_SCRIPT)) return { version: null, healthy: false };
  try {
    const manifest = validateManifest(JSON.parse(await readFile(marker, "utf8")) as Partial<RuntimeManifest>);
    await verifyRuntimeContents(DRSAI_REPO, manifest.files, new AbortController().signal, true, manifest.pythonVersion);
    return { version: manifest.version, healthy: true };
  } catch { return { version: null, healthy: false }; }
}

async function readManifest(): Promise<RuntimeManifest> {
  return validateManifest(JSON.parse(await readFile(bundledRuntimeManifestPath(), "utf8")) as Partial<RuntimeManifest>);
}

function validateManifest(parsed: Partial<RuntimeManifest>): RuntimeManifest {
  const validFiles = Array.isArray(parsed.files) && parsed.files.length > 0 && parsed.files.every((file) => file && isSafeRelativePath(file.path) && Number.isSafeInteger(file.size) && file.size >= 0 && /^[a-f0-9]{64}$/.test(file.sha256));
  if (parsed.schemaVersion !== 2 || parsed.platform !== "darwin" || parsed.arch !== "arm64" || !parsed.version || !/^3\.\d+\.\d+$/.test(parsed.pythonVersion || "") || !isSafeRelativePath(parsed.archive) || !Number.isSafeInteger(parsed.archiveSize) || (parsed.archiveSize || 0) <= 0 || !/^[a-f0-9]{64}$/.test(parsed.sha256 || "") || parsed.root !== "drsai-agent" || parsed.python !== "venv/bin/python" || parsed.launcher !== "drsai" || !isSafeRelativePath(parsed.sbom) || !isSafeRelativePath(parsed.provenance) || !validFiles) throw new Error("Bundled Runtime manifest is invalid.");
  return parsed as RuntimeManifest;
}

async function verifyRuntimeContents(root: string, expected: RuntimeFile[], signal: AbortSignal, installed = false, pythonVersion?: string): Promise<void> {
  const actual = (await listFiles(root)).filter((path) => !installed || path !== ".opendrsai-runtime.json");
  if (actual.length !== expected.length) throw new Error("Bundled Runtime file inventory is incomplete or contains unexpected files.");
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]));
  for (const path of actual) {
    assertNotCancelled(signal);
    const entry = expectedByPath.get(path); if (!entry) throw new Error(`Unexpected Runtime file: ${path}`);
    const absolute = join(root, ...path.split("/")); const info = await stat(absolute);
    if (installed && isVirtualEnvironmentConfig(path)) {
      await verifyRelocatedVirtualEnvironmentConfig(root, path, absolute, pythonVersion);
    } else if (info.size !== entry.size || await sha256(absolute) !== entry.sha256) throw new Error(`Runtime file verification failed: ${path}`);
  }
}

async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        await assertRuntimeSymlinkStaysInsideRoot(root, absolute);
      } else if (entry.isDirectory()) await visit(absolute); else if (entry.isFile()) result.push(relative(root, absolute).split(sep).join("/")); else throw new Error(`Runtime contains an unsupported entry: ${entry.name}`);
    }
  }
  await visit(root); return result.sort();
}

function resolveResource(root: string, path: string): string {
  const resolved = resolve(root, path);
  if (dirname(resolved) !== root && !resolved.startsWith(`${root}${sep}`)) throw new Error(`Runtime resource escapes its root: ${basename(path)}`);
  if (!existsSync(resolved)) throw new Error(`Bundled Runtime resource is missing: ${basename(path)}`);
  return resolved;
}
function isSafeRelativePath(value: unknown): value is string { return typeof value === "string" && value.length > 0 && !value.includes("\\") && !value.startsWith("/") && !value.split("/").includes(".."); }
function assertNotCancelled(signal: AbortSignal): void { if (signal.aborted) throw new Error("Runtime installation cancelled."); }
async function sha256(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => { const hash = createHash("sha256"); const stream = createReadStream(path); stream.on("data", (chunk) => hash.update(chunk)); stream.on("error", reject); stream.on("end", () => resolveHash(hash.digest("hex"))); });
}
