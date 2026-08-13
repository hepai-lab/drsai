import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const windowsRoot = resolve(scriptDir, "..");
const repoRoot = resolve(windowsRoot, "..", "..", "..");
const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));

if (command === "seal-runtime") sealRuntime();
else if (command === "verify-directory") verifyDirectory();
else if (command === "record-archive") recordArchive();
else throw new Error("Usage: runtime-build-trust.mjs <seal-runtime|verify-directory|record-archive> [options]");

function sealRuntime() {
  const payload = requiredDirectory("payload");
  const version = required("version");
  const channel = required("channel");
  const identity = createBuildIdentity(version, channel, payload);
  const identityPath = join(payload, "build-identity.json");
  const agentIdentityPath = join(payload, "drsai-agent", "build-identity.json");
  writeJson(identityPath, identity);
  writeJson(agentIdentityPath, identity);
  const manifest = createRuntimeManifest(payload);
  writeJson(join(payload, "runtime-files.sha256.json"), {
    schemaVersion: 1,
    buildId: identity.buildId,
    generatedAt: identity.builtAt,
    files: manifest,
  });
  console.log(`Sealed Runtime ${identity.buildId} with ${manifest.length} files.`);
}

function verifyDirectory() {
  const payload = requiredDirectory("payload");
  const identity = readJson(join(payload, "build-identity.json"));
  const agentIdentity = readJson(join(payload, "drsai-agent", "build-identity.json"));
  const manifest = readJson(join(payload, "runtime-files.sha256.json"));
  assert(identity.buildId && identity.buildId === agentIdentity.buildId, "Runtime and Python build identities differ");
  assert(manifest.buildId === identity.buildId, "Runtime manifest buildId differs from Runtime identity");
  const actual = new Map(createRuntimeManifest(payload).map((item) => [item.path, item]));
  const expected = new Map(manifest.files.map((item) => [item.path, item]));
  const failures = [];
  for (const [path, item] of expected) {
    const found = actual.get(path);
    if (!found) failures.push(`missing ${path}`);
    else if (found.sha256 !== item.sha256 || found.size !== item.size) failures.push(`changed ${path}`);
  }
  for (const path of actual.keys()) if (!expected.has(path)) failures.push(`unexpected ${path}`);
  assert(failures.length === 0, `Runtime file manifest mismatch: ${failures.slice(0, 12).join("; ")}`);
  const python = join(payload, "drsai-agent", "venv", "Scripts", "python.exe");
  if (!args["skip-python-import"]) {
    assert(existsSync(python), `Packaged Python is missing: ${python}`);
    const probe = spawnSync(python, ["-I", "-c", "import json,drsai; print(json.dumps({'file':drsai.__file__}))"], {
      cwd: payload,
      encoding: "utf8",
      windowsHide: true,
    });
    assert(probe.status === 0, `Packaged Python import failed: ${(probe.stderr || probe.stdout).trim()}`);
    const imported = JSON.parse(probe.stdout.trim()).file.replaceAll("/", "\\").toLowerCase();
    const controlled = join(payload, "drsai-agent", "venv", "Lib", "site-packages", "drsai").toLowerCase();
    assert(imported.startsWith(controlled + "\\"), `Packaged Python imported drsai outside the Runtime: ${imported}`);
  }
  console.log(`Verified Runtime directory ${identity.buildId} (${expected.size} files).`);
}

function recordArchive() {
  const archive = requiredFile("archive");
  const payload = requiredDirectory("payload");
  const identity = readJson(join(payload, "build-identity.json"));
  const manifestPath = join(payload, "runtime-files.sha256.json");
  const receiptPath = args.receipt ? resolve(args.receipt) : `${archive}.receipt.json`;
  const payloadFiles = collectFiles(payload);
  writeJson(receiptPath, {
    schemaVersion: 2,
    status: "staged",
    buildId: identity.buildId,
    version: identity.version,
    channel: identity.channel,
    stagedAt: new Date().toISOString(),
    artifact: {
      file: basename(archive),
      size: statSync(archive).size,
      sha256: sha256File(archive),
    },
    payload: {
      fileCount: payloadFiles.length,
      expandedSizeBytes: payloadFiles.reduce((total, path) => total + statSync(path).size, 0),
    },
    runtimeManifestSha256: sha256File(manifestPath),
    sourceTreeSha256: identity.sourceTreeSha256,
    verification: {
      status: "pending",
      mode: "full-extraction",
    },
  });
  console.log(`Recorded staged artifact receipt: ${receiptPath}`);
}

function createBuildIdentity(version, channel, payload) {
  const sourceRoots = [
    "cores/python/packages/drsai/src",
    "cores/python/packages/drsai/pyproject.toml",
    "apps/desktop/shared",
    "apps/desktop/windows/src",
    "apps/desktop/windows/package-lock.json",
    "skills/skills",
    "cores/protocol",
  ];
  const sourceFiles = collectPaths(sourceRoots.map((path) => join(repoRoot, path)));
  const sourceTreeSha256 = hashFileSet(sourceFiles, repoRoot);
  const sitePackages = join(payload, "drsai-agent", "venv", "Lib", "site-packages");
  const dependencyRecords = collectFiles(sitePackages).filter((path) => {
    const normalized = relative(sitePackages, path).split(sep).join("/").toLowerCase();
    return normalized.endsWith(".dist-info/metadata") || normalized.endsWith(".dist-info/record");
  });
  const runtimeDependencySha256 = hashFileSet(dependencyRecords, sitePackages);
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
  const commit = git.status === 0 ? git.stdout.trim() : "unknown";
  const dirty = status.status !== 0 || status.stdout.trim().length > 0;
  const buildDigest = createHash("sha256").update(sourceTreeSha256).update(runtimeDependencySha256).digest("hex");
  const buildId = `${version}+${buildDigest.slice(0, 16)}`;
  return {
    schemaVersion: 1,
    buildId,
    version,
    channel,
    gitCommit: commit,
    dirty,
    sourceTreeSha256: `sha256:${sourceTreeSha256}`,
    runtimeDependencySha256: `sha256:${runtimeDependencySha256}`,
    builtAt: new Date().toISOString(),
  };
}

function createRuntimeManifest(payload) {
  return collectFiles(payload)
    .filter((path) => !["build-identity.json", "runtime-files.sha256.json", join("drsai-agent", "build-identity.json")]
      .includes(relative(payload, path)))
    .map((path) => ({
      path: relative(payload, path).split(sep).join("/"),
      size: statSync(path).size,
      sha256: sha256File(path),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function collectPaths(paths) {
  const files = [];
  for (const path of paths) {
    assert(existsSync(path), `Build identity input is missing: ${path}`);
    if (statSync(path).isFile()) files.push(path);
    else files.push(...collectFiles(path));
  }
  return files;
}

function collectFiles(root) {
  const files = [];
  walk(root, files);
  return files;
}

function walk(path, files) {
  const stats = statSync(path);
  if (stats.isFile()) { files.push(path); return; }
  for (const entry of readdirSync(path).sort()) {
    if (["node_modules", "release", ".tmp", "__pycache__", ".pytest_cache"].includes(entry)) continue;
    walk(join(path, entry), files);
  }
}

function hashFileSet(files, base) {
  const hash = createHash("sha256");
  for (const path of [...files].sort()) {
    hash.update(relative(base, path).split(sep).join("/"));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function sha256File(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function readJson(path) { assert(existsSync(path), `Required trust file is missing: ${path}`); return JSON.parse(readFileSync(path, "utf8")); }
function writeJson(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function required(name) { assert(args[name], `Missing --${name}`); return args[name]; }
function requiredFile(name) { const path = resolve(required(name)); assert(existsSync(path) && statSync(path).isFile(), `File not found: ${path}`); return path; }
function requiredDirectory(name) { const path = resolve(required(name)); assert(existsSync(path) && statSync(path).isDirectory(), `Directory not found: ${path}`); return path; }
function parseArgs(values) { const result = {}; for (let i = 0; i < values.length; i += 1) { const key = values[i]; assert(key.startsWith("--"), `Unexpected argument: ${key}`); const next = values[i + 1]; if (!next || next.startsWith("--")) result[key.slice(2)] = true; else { result[key.slice(2)] = next; i += 1; } } return result; }
function assert(condition, message) { if (!condition) throw new Error(message); }
