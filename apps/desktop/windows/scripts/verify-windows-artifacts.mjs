import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseDir = join(root, "release");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const required = [
  join("bootstrapper", "OpenDrSaiSetup-win-x64.msi"),
  join("bootstrapper", "OpenDrSaiRuntime-win-x64.zip"),
  "latest-windows.json",
  "release-summary.json",
];

for (const relativePath of required) {
  const fullPath = join(releaseDir, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Missing release artifact: ${relativePath}`);
  }
  if (statSync(fullPath).size <= 0) {
    throw new Error(`Release artifact is empty: ${relativePath}`);
  }
}

const runtimeZip = join(releaseDir, "bootstrapper", "OpenDrSaiRuntime-win-x64.zip");
const runtimeBytes = readFileSync(runtimeZip);
if (!runtimeBytes.length) {
  throw new Error("OpenDrSaiRuntime-win-x64.zip is empty.");
}

const summary = JSON.parse(readFileSync(join(releaseDir, "release-summary.json"), "utf8"));
if (summary.version !== packageJson.version) {
  throw new Error(`release-summary.json version ${summary.version} does not match package ${packageJson.version}.`);
}
if (!summary.distribution || summary.distribution.requiresSignedInstallers !== true) {
  throw new Error("release-summary.json is missing installer signing distribution policy.");
}

const summaryArtifacts = new Map(
  (summary.artifacts || []).map((artifact) => [artifact.path, artifact]),
);
for (const relativePath of required.slice(0, 3)) {
  const normalized = relativePath.replace(/\\/g, "/");
  const artifact = summaryArtifacts.get(normalized);
  if (!artifact) {
    throw new Error(`release-summary.json is missing ${normalized}.`);
  }
  const fullPath = join(releaseDir, relativePath);
  const bytes = readFileSync(fullPath);
  const sizeBytes = statSync(fullPath).size;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (artifact.sizeBytes !== sizeBytes) {
    throw new Error(`release-summary.json size for ${normalized} does not match the release artifact.`);
  }
  if (artifact.sha256 !== sha256) {
    throw new Error(`release-summary.json sha256 for ${normalized} does not match the release artifact.`);
  }
}

console.log("Windows release artifacts verified for MSI, runtime ZIP, and update manifest.");
