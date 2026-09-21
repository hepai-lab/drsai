// Vendors the pinned ripgrep binary into the Windows desktop payload.
//
// The agent's `grep` tool is dramatically faster with ripgrep than with any
// Windows-native alternative, but Windows ships nothing equivalent, so the
// binary is version-pinned, digest-verified and committed under
// `resources/tools/ripgrep` (mirroring `resources/backend`).
//
// Usage:
//   node scripts/fetch-ripgrep.mjs                 # download, verify, vendor
//   node scripts/fetch-ripgrep.mjs --from <path>   # vendor from a local .zip
//                                                  # or an already-extracted dir
//   node scripts/fetch-ripgrep.mjs --check         # verify the vendored copy only
//
// ripgrep is distributed under the Unlicense OR the MIT license (see the
// LICENSE-MIT / UNLICENSE / COPYING files vendored next to the binary). It is
// not Authenticode-signed, so integrity is enforced by the SHA-256 digest below.
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const RIPGREP_VERSION = "15.2.0";
export const RIPGREP_TARGET = "x86_64-pc-windows-msvc";
export const RIPGREP_RG_SHA256 =
  "14231169855ec5205cf5a1b6f1db358ff4aed4247c86b69ce8aae647c77f6680";
export const RIPGREP_RG_SIZE = 4218880;

const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const windowsRoot = resolve(scriptDir, "..");
export const BUNDLE_DIR = join(windowsRoot, "resources", "tools", "ripgrep");
export const BUNDLE_RG = join(BUNDLE_DIR, "rg.exe");
export const ARCHIVE_NAME = `ripgrep-${RIPGREP_VERSION}-${RIPGREP_TARGET}.zip`;
export const DOWNLOAD_URL =
  `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${ARCHIVE_NAME}`;

// LICENSE-MIT / UNLICENSE / COPYING are vendored verbatim from the release
// archive so the redistribution notice travels with the binary.
const LICENSE_FILES = ["LICENSE-MIT", "UNLICENSE", "COPYING"];

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function describeBundleProblem() {
  if (!existsSync(BUNDLE_RG)) {
    return `vendored ripgrep is missing: ${BUNDLE_RG}`;
  }
  const size = statSync(BUNDLE_RG).size;
  if (size !== RIPGREP_RG_SIZE) {
    return `vendored ripgrep has size ${size}, expected ${RIPGREP_RG_SIZE}`;
  }
  const digest = sha256File(BUNDLE_RG);
  if (digest !== RIPGREP_RG_SHA256) {
    return `vendored ripgrep SHA-256 is ${digest}, expected ${RIPGREP_RG_SHA256}`;
  }
  for (const name of LICENSE_FILES) {
    if (!existsSync(join(BUNDLE_DIR, name))) {
      return `vendored ripgrep is missing license file ${name}`;
    }
  }
  if (!existsSync(join(BUNDLE_DIR, "README.md"))) {
    return "vendored ripgrep is missing README.md (provenance record)";
  }
  return null;
}

function assertBundleHealthy() {
  const problem = describeBundleProblem();
  if (problem) throw new Error(`Bundled ripgrep check failed: ${problem}`);
}

async function downloadArchive(destination) {
  const response = await fetch(DOWNLOAD_URL, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to download ${DOWNLOAD_URL}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error(`Downloaded archive is empty: ${DOWNLOAD_URL}`);
  mkdirSync(resolve(destination, ".."), { recursive: true });
  writeFileSync(destination, bytes);
  return bytes.length;
}

function expandArchive(archivePath, destination) {
  // Expand-Archive keeps this script dependency-free; the Windows desktop
  // workspace only ever runs it on Windows (it drives electron-builder).
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath ${quote(archivePath)} -DestinationPath ${quote(destination)} -Force`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(
      `Expand-Archive failed for ${archivePath}: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
}

// Release archives nest their payload one level deep
// (`ripgrep-<version>-<target>/rg.exe`); a hand-extracted or repacked archive
// may not. Accept either shape instead of hard-coding the layout.
function resolveExtractedReleaseRoot(extractRoot) {
  const candidateDirs = [
    extractRoot,
    join(extractRoot, `ripgrep-${RIPGREP_VERSION}-${RIPGREP_TARGET}`),
  ];
  for (const dir of candidateDirs) {
    if (existsSync(join(dir, "rg.exe"))) return dir;
  }
  const entries = readdirSync(extractRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(extractRoot, entry.name);
    if (existsSync(join(dir, "rg.exe"))) return dir;
  }
  throw new Error(
    `rg.exe was not found inside the extracted ripgrep archive: ${extractRoot} ` +
      `(entries: ${entries.map((entry) => entry.name).join(", ") || "none"})`,
  );
}

function vendorFrom(fileSystemSource) {
  const rgSource = join(fileSystemSource, "rg.exe");
  if (!existsSync(rgSource)) {
    throw new Error(`rg.exe was not found in ${fileSystemSource}`);
  }
  const size = statSync(rgSource).size;
  if (size !== RIPGREP_RG_SIZE) {
    throw new Error(`refusing to vendor rg.exe of size ${size}, expected ${RIPGREP_RG_SIZE}`);
  }
  const digest = sha256File(rgSource);
  if (digest !== RIPGREP_RG_SHA256) {
    throw new Error(
      `refusing to vendor rg.exe with SHA-256 ${digest}, expected ${RIPGREP_RG_SHA256}`,
    );
  }
  mkdirSync(BUNDLE_DIR, { recursive: true });
  copyFileSync(rgSource, BUNDLE_RG);
  for (const name of LICENSE_FILES) {
    const licenseSource = join(fileSystemSource, name);
    if (!existsSync(licenseSource)) {
      throw new Error(`ripgrep release is missing license file ${name}: ${licenseSource}`);
    }
    copyFileSync(licenseSource, join(BUNDLE_DIR, name));
  }
}

async function fetchAndVendor() {
  const workRoot = join(tmpdir(), `opendrsai-ripgrep-${process.pid}`);
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(workRoot, { recursive: true });
  try {
    const archivePath = join(workRoot, ARCHIVE_NAME);
    const bytes = await downloadArchive(archivePath);
    console.log(`Downloaded ${ARCHIVE_NAME} (${bytes} bytes) from ${DOWNLOAD_URL}`);
    const extractRoot = join(workRoot, "extracted");
    mkdirSync(extractRoot, { recursive: true });
    expandArchive(archivePath, extractRoot);
    vendorFrom(resolveExtractedReleaseRoot(extractRoot));
    assertBundleHealthy();
    console.log(
      `Vendored ripgrep ${RIPGREP_VERSION} → ${BUNDLE_DIR} (sha256 ${RIPGREP_RG_SHA256})`,
    );
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const fromIndex = args.indexOf("--from");
  if (args.includes("--check")) {
    const problem = describeBundleProblem();
    if (problem) {
      console.error(`❌ fetch-ripgrep --check: ${problem}`);
      process.exitCode = 1;
      return;
    }
    console.log(`✅ fetch-ripgrep --check: rg ${RIPGREP_VERSION} verified (${RIPGREP_RG_SHA256})`);
    return;
  }
  if (fromIndex !== -1) {
    const source = resolve(args[fromIndex + 1] ?? "");
    if (!source || !existsSync(source)) {
      throw new Error(`--from expects a path to a ripgrep .zip or extracted directory: ${source}`);
    }
    if (statSync(source).isDirectory()) {
      vendorFrom(source);
    } else {
      const extractRoot = join(tmpdir(), `opendrsai-ripgrep-offline-${process.pid}`);
      rmSync(extractRoot, { recursive: true, force: true });
      mkdirSync(extractRoot, { recursive: true });
      try {
        expandArchive(source, extractRoot);
        vendorFrom(resolveExtractedReleaseRoot(extractRoot));
      } finally {
        rmSync(extractRoot, { recursive: true, force: true });
      }
    }
    assertBundleHealthy();
    console.log(`Vendored ripgrep ${RIPGREP_VERSION} from ${source} → ${BUNDLE_DIR}`);
    return;
  }
  await fetchAndVendor();
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  await main();
}
