// Vendors the DrSai backend source snapshot into the Windows desktop payload.
//
// The packaged app ships a source archive of the backend so that the local
// Runtime can be rebuilt/repaired without network access. `install.ts` reads
// `resources/backend/backend-source.json` to learn (a) which archive to hand to
// the installer and (b) the version it should expect afterwards; a mismatch
// between that version and the installed Runtime surfaces in the UI as
// `runtime-version-mismatch`. The manifest must therefore be regenerated
// whenever the backend version changes — a stale manifest makes the app report
// a version conflict and makes "repair" reinstall an outdated backend.
//
// Usage:
//   node scripts/create-backend-source-archive.mjs                  # regenerate
//   node scripts/create-backend-source-archive.mjs --check          # verify only
//   node scripts/create-backend-source-archive.mjs --sync-unpacked  # also refresh
//                                                                  # release/win-unpacked
//
// The archive is written deterministically (entries sorted by path, stored
// uncompressed) so that regenerating an unchanged tree yields identical bytes.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(appRoot, "..", "..", "..");
const resourceDir = join(appRoot, "resources", "backend");
const archiveName = "drsai-backend-source.zip";
const manifestName = "backend-source.json";
const archivePath = join(resourceDir, archiveName);
const manifestPath = join(resourceDir, manifestName);
const packageJson = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8"));
const syncUnpacked = process.argv.includes("--sync-unpacked");
const checkOnly = process.argv.includes("--check");
const SOURCE_ROOTS = [
  "cores/python/packages/drsai/pyproject.toml",
  "cores/python/packages/drsai/build_hook.py",
  "cores/python/packages/drsai/README.md",
  "cores/python/packages/drsai/src",
  "cores/protocol/owop",
  "cores/protocol/relay",
  "skills/skills",
  "eval/regression",
];
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});
let trackedFiles = null;

if (checkOnly) {
  verifyExisting();
} else {
  const archiveEntries = collectBackendSourceEntries();
  mkdirSync(resourceDir, { recursive: true });
  writeFileSync(archivePath, createZip(archiveEntries));
  const sha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  writeFileSync(
    manifestPath,
    `${JSON.stringify({
      archive: archiveName,
      sha256,
      version: packageJson.version,
      source: "local-backend-source",
      contents: SOURCE_ROOTS,
    }, null, 2)}\n`,
    "utf8",
  );

  if (syncUnpacked) {
    syncToUnpackedApp();
  }

  console.log(`Bundled backend source prepared: ${relative(appRoot, manifestPath)} (${archiveEntries.length} files).`);
}

/**
 * Fails when the vendored manifest no longer matches `package.json` or the
 * archive beside it. `install.ts` treats the manifest version as the backend
 * version the installer must produce, so a stale value breaks Runtime repair.
 */
function verifyExisting() {
  if (!existsSync(manifestPath) || !existsSync(archivePath)) {
    throw new Error(
      `Bundled backend source is missing. Run: node scripts/${relative(appRoot, fileURLToPath(import.meta.url))}`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const version = String(packageJson.version);
  if (manifest.version !== version) {
    throw new Error(
      `backend-source.json version ${manifest.version} does not match package ${version}. ` +
      "Regenerate it: node scripts/create-backend-source-archive.mjs",
    );
  }
  const sha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  if (manifest.sha256 !== sha256) {
    throw new Error(
      `backend-source.json sha256 does not match ${archiveName}. ` +
      "Regenerate it: node scripts/create-backend-source-archive.mjs",
    );
  }
  const missing = SOURCE_ROOTS.filter((root) => !existsSync(join(repoRoot, root)));
  if (missing.length > 0) {
    console.warn(`Warning: backend source path(s) no longer present: ${missing.join(", ")}`);
  }
  console.log(`Bundled backend source verified (version ${version}, ${manifest.contents?.length ?? 0} roots).`);
}

function collectBackendSourceEntries() {
  const files = [];
  for (const root of SOURCE_ROOTS) {
    const absolute = join(repoRoot, root);
    if (!existsSync(absolute)) {
      throw new Error(`Required backend source path is missing: ${root}`);
    }
    collectFiles(absolute, files);
  }
  const tracked = trackedFileSet();
  const untrackedRoots = new Set();
  const entries = [];
  for (const absolute of files) {
    const name = relative(repoRoot, absolute).split(sep).join("/");
    if (!tracked.has(name)) {
      untrackedRoots.add(name.split("/").slice(0, -1).join("/"));
      continue;
    }
    entries.push({ name, data: readFileSync(absolute) });
  }
  if (entries.length === 0) {
    throw new Error("No tracked backend source files were found; refusing to write an empty archive.");
  }
  if (untrackedRoots.size > 0) {
    console.log(`Skipped ${files.length - entries.length} untracked file(s) under: ${[...untrackedRoots].slice(0, 3).join(", ")}${untrackedRoots.size > 3 ? ", …" : ""}`);
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

// `skills/**` vendors some dependencies under `node_modules` (the `@oai`
// packages) while leaving others to a normal install. Committing them to git is
// exactly the signal that distinguishes the two, so membership in the index —
// not a directory-name blocklist — decides what belongs in the archive. Without
// this, `skills/skills/presentations/node_modules` alone adds ~113 MB of
// reinstalable build output.
function trackedFileSet() {
  if (trackedFiles) return trackedFiles;
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  trackedFiles = new Set(output.split("\0").filter(Boolean));
  if (trackedFiles.size === 0) {
    throw new Error(
      `git ls-files returned nothing at ${repoRoot}; the backend source archive needs a git work tree to distinguish vendored files from build output.`,
    );
  }
  return trackedFiles;
}

function collectFiles(path, files) {
  const stats = statSync(path);
  if (stats.isFile()) {
    files.push(path);
    return;
  }
  if (!stats.isDirectory()) return;
  const base = path.toLowerCase();
  if (base.endsWith(`${sep}__pycache__`) || base.includes(`${sep}.pytest_cache${sep}`)) return;
  for (const entry of readdirSync(path)) {
    if (entry === "__pycache__" || entry === ".pytest_cache") continue;
    collectFiles(join(path, entry), files);
  }
}

function syncToUnpackedApp() {
  const targets = [
    join(appRoot, "release", "win-unpacked", "resources", "backend"),
    join(appRoot, "release", "win-unpacked", "resources", "app.asar.unpacked", "resources", "backend"),
  ];
  for (const target of targets) {
    mkdirSync(target, { recursive: true });
    copyFileSync(manifestPath, join(target, manifestName));
    copyFileSync(archivePath, join(target, archiveName));
  }
}

function createZip(entries) {
  const fileRecords = [];
  const chunks = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x5b21, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    chunks.push(localHeader, name, data);
    fileRecords.push({ entry, name, crc, offset });
    offset += localHeader.length + name.length + data.length;
  }

  const centralDirectoryOffset = offset;
  for (const record of fileRecords) {
    const data = record.entry.data;
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5b21, 14);
    centralHeader.writeUInt32LE(record.crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(record.name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(record.offset, 42);
    chunks.push(centralHeader, record.name);
    offset += centralHeader.length + record.name.length;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  const endHeader = Buffer.alloc(22);
  endHeader.writeUInt32LE(0x06054b50, 0);
  endHeader.writeUInt16LE(0, 4);
  endHeader.writeUInt16LE(0, 6);
  endHeader.writeUInt16LE(fileRecords.length, 8);
  endHeader.writeUInt16LE(fileRecords.length, 10);
  endHeader.writeUInt32LE(centralDirectorySize, 12);
  endHeader.writeUInt32LE(centralDirectoryOffset, 16);
  endHeader.writeUInt16LE(0, 20);
  chunks.push(endHeader);
  return Buffer.concat(chunks);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
