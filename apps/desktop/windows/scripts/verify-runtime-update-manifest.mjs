import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = resolve(process.env.OPENDRSAI_UPDATE_MANIFEST_PATH || join(root, "release", "latest-windows.json"));
const runtimePath = resolve(process.env.OPENDRSAI_RUNTIME_PATH || join(root, "release", "bootstrapper", "OpenDrSaiRuntime-win-x64.zip"));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const runtimeManifest = readRuntimeManifest(runtimePath);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(manifest.schemaVersion === 1, "Update manifest schemaVersion must be 1.");
assert(manifest.version === packageJson.version, "Update manifest version must match package.json.");
assert(runtimeManifest.version === packageJson.version, "Runtime archive version must match package.json.");
assert(runtimeManifest.platform === "windows-x64" && runtimeManifest.layoutVersion === 1, "Runtime archive layout is invalid.");
assert(["stable", "beta", "dev"].includes(manifest.channel), "Update manifest channel is invalid.");
assert(Number.isFinite(Date.parse(manifest.publishedAt)), "Update manifest publishedAt is invalid.");
assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.minimumUpdaterVersion), "minimumUpdaterVersion is invalid.");
assert(typeof manifest.mandatory === "boolean", "mandatory must be boolean.");
assert(typeof manifest.requireSignature === "boolean", "requireSignature must be boolean.");
assert(manifest.channel !== "stable" || manifest.requireSignature === true, "Stable updates must require signatures.");
assert(/^https:\/\//.test(manifest.runtime?.url || ""), "Runtime URL must use HTTPS.");
if (manifest.channel === "stable") {
  assert(
    manifest.runtime.url === `https://github.com/hepai-lab/drsai/releases/download/v${packageJson.version}/OpenDrSaiRuntime-win-x64.zip`,
    "Stable runtime URL must be the immutable versioned GitHub Release asset.",
  );
}
assert(manifest.runtime.sizeBytes === statSync(runtimePath).size, "Runtime size does not match the manifest.");
const hash = createHash("sha256").update(readFileSync(runtimePath)).digest("hex");
assert(manifest.runtime.sha256 === hash, "Runtime SHA-256 does not match the manifest.");
assert(/^https:\/\//.test(manifest.releaseNotesUrl || ""), "Release notes URL must use HTTPS.");
console.log("Runtime update manifest verification passed.");

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
