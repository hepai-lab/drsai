import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveMinimumUpdaterVersion } from "./runtime-update-policy.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const runtimePath = resolve(process.env.OPENDRSAI_RUNTIME_PATH || join(root, "release", "bootstrapper", "OpenDrSaiRuntime-win-x64.zip"));
const outputPath = resolve(process.env.OPENDRSAI_UPDATE_MANIFEST_PATH || join(root, "release", "latest-windows.json"));
const version = String(packageJson.version);
const channel = String(process.env.OPENDRSAI_UPDATE_CHANNEL || "stable").toLowerCase();
const minimumUpdaterVersion = resolveMinimumUpdaterVersion(process.env.OPENDRSAI_MINIMUM_UPDATER_VERSION);
const isPrereleaseVersion = version.includes("-");
const baseUrl = String(
  process.env.OPENDRSAI_RELEASE_BASE_URL ||
  `https://github.com/hepai-lab/drsai/releases/download/v${version}`,
).replace(/\/+$/, "");

if (!/^(stable|beta|dev)$/.test(channel)) throw new Error(`Unsupported update channel: ${channel}`);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid package version: ${version}`);
if (!baseUrl.startsWith("https://")) throw new Error("OPENDRSAI_RELEASE_BASE_URL must use HTTPS.");
const stableBaseUrl = `https://github.com/hepai-lab/drsai/releases/download/v${version}`;
if (channel === "stable" && baseUrl !== stableBaseUrl) {
  throw new Error(`Stable runtime updates must use the immutable versioned URL ${stableBaseUrl}.`);
}

const runtime = readFileSync(runtimePath);
const runtimeManifest = readRuntimeManifest(runtimePath);
if (runtimeManifest.version !== version) {
  throw new Error(`Runtime archive version ${runtimeManifest.version || "<missing>"} does not match package ${version}.`);
}
if (runtimeManifest.platform !== "windows-x64" || runtimeManifest.layoutVersion !== 1) {
  throw new Error("Runtime archive platform/layout is not windows-x64 layoutVersion 1.");
}
const manifest = {
  schemaVersion: 1,
  version,
  channel,
  publishedAt: process.env.OPENDRSAI_RELEASE_PUBLISHED_AT || new Date().toISOString(),
  minimumUpdaterVersion,
  mandatory: process.env.OPENDRSAI_MANDATORY_UPDATE === "1",
  // Legacy beta builds request the stable channel from releases/latest. Keep
  // prerelease compatibility manifests unsigned until a Windows certificate is
  // available, while continuing to require signatures for every stable version.
  requireSignature: channel === "stable" && !isPrereleaseVersion || process.env.OPENDRSAI_REQUIRE_UPDATE_SIGNATURE === "1",
  runtime: {
    url: `${baseUrl}/OpenDrSaiRuntime-win-x64.zip`,
    sizeBytes: statSync(runtimePath).size,
    sha256: createHash("sha256").update(runtime).digest("hex"),
  },
  releaseNotesUrl: process.env.OPENDRSAI_RELEASE_NOTES_URL ||
    `https://github.com/hepai-lab/drsai/releases/tag/v${version}`,
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);

function readRuntimeManifest(path) {
  const command = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$z=[IO.Compression.ZipFile]::OpenRead(${quotePowerShell(path)})`,
    "try { $entries=@($z.Entries | Where-Object { $_.FullName -match '(^|/)opendrsai-runtime\\.json$' }); if($entries.Count -ne 1){throw 'Runtime ZIP must contain one manifest.'}; $r=New-Object IO.StreamReader($entries[0].Open()); try{$r.ReadToEnd()}finally{$r.Dispose()} } finally { $z.Dispose() }",
  ].join("; ");
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true }));
}

function quotePowerShell(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
