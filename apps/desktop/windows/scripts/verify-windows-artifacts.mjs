import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseDir = join(root, "release");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const setupName = `OpenDrSai-${packageJson.version}-setup.exe`;
const required = [
  setupName,
  `${setupName}.blockmap`,
  "latest.yml",
  "latest-windows.json",
  "release-summary.json",
  join("bootstrapper", "OpenDrSai Installer.exe"),
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

const manifestPath = join(releaseDir, "latest-windows.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const installerName = decodeURIComponent(basename(new URL(manifest.installer).pathname));
if (installerName !== setupName) {
  throw new Error(`Manifest installer ${installerName} does not match expected ${setupName}.`);
}

const setupPath = join(releaseDir, setupName);
const bytes = readFileSync(setupPath);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const sizeBytes = statSync(setupPath).size;
if (manifest.sha256 !== sha256) {
  throw new Error("latest-windows.json sha256 does not match setup exe.");
}
if (manifest.sizeBytes !== sizeBytes) {
  throw new Error("latest-windows.json sizeBytes does not match setup exe.");
}

const latestYml = readFileSync(join(releaseDir, "latest.yml"), "utf8");
const latest = parseLatestYml(latestYml);
const sha512 = createHash("sha512").update(bytes).digest("base64");
if (latest.version !== packageJson.version) {
  throw new Error(`latest.yml version ${latest.version} does not match package ${packageJson.version}.`);
}
if (latest.path !== setupName || latest.fileUrl !== setupName) {
  throw new Error("latest.yml does not reference the expected setup exe path and file url.");
}
if (latest.size !== sizeBytes) {
  throw new Error("latest.yml size does not match setup exe.");
}
if (latest.sha512 !== sha512 || latest.fileSha512 !== sha512) {
  throw new Error("latest.yml sha512 does not match setup exe.");
}

const blockmapPath = join(releaseDir, `${setupName}.blockmap`);
if (statSync(blockmapPath).size <= 0) {
  throw new Error("Setup blockmap is empty.");
}

const summary = JSON.parse(readFileSync(join(releaseDir, "release-summary.json"), "utf8"));
if (summary.version !== packageJson.version) {
  throw new Error(`release-summary.json version ${summary.version} does not match package ${packageJson.version}.`);
}
if (JSON.stringify(summary.manifest) !== JSON.stringify(manifest)) {
  throw new Error("release-summary.json manifest snapshot does not match latest-windows.json.");
}
if (!summary.distribution || summary.distribution.requiresSignedExecutables !== true) {
  throw new Error("release-summary.json is missing executable signing distribution policy.");
}
const executableSummaries = (summary.artifacts || []).filter(
  (artifact) => artifact.path?.endsWith(".exe"),
);
const unsignedExecutables = executableSummaries.filter(
  (artifact) => artifact.signatureStatus !== "Valid",
);
if (summary.distribution.publicDistributionReady !== (unsignedExecutables.length === 0)) {
  throw new Error("release-summary.json distribution readiness does not match executable signature statuses.");
}
const unsignedPaths = new Set(
  (summary.distribution.unsignedArtifacts || []).map((artifact) => artifact.path),
);
for (const artifact of unsignedExecutables) {
  if (!unsignedPaths.has(artifact.path)) {
    throw new Error(`release-summary.json distribution policy is missing unsigned executable ${artifact.path}.`);
  }
}
if (unsignedExecutables.length > 0 && !summary.distribution.note?.includes("Do not distribute")) {
  throw new Error("release-summary.json does not warn against distributing unsigned executables.");
}

const summaryArtifacts = new Set(
  (summary.artifacts || []).map((artifact) => artifact.path),
);
for (const relativePath of [
  setupName,
  `${setupName}.blockmap`,
  "latest.yml",
  "latest-windows.json",
  "bootstrapper/OpenDrSai Installer.exe",
]) {
  if (!summaryArtifacts.has(relativePath.replace(/\\/g, "/"))) {
    throw new Error(`release-summary.json is missing ${relativePath}.`);
  }
}

const summaryByPath = new Map(
  (summary.artifacts || []).map((artifact) => [artifact.path, artifact]),
);
for (const relativePath of [
  setupName,
  `${setupName}.blockmap`,
  "latest.yml",
  "latest-windows.json",
  "bootstrapper/OpenDrSai Installer.exe",
]) {
  const normalized = relativePath.replace(/\\/g, "/");
  const artifact = summaryByPath.get(normalized);
  const fullPath = join(releaseDir, relativePath);
  const artifactBytes = readFileSync(fullPath);
  const artifactSize = statSync(fullPath).size;
  const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");
  if (artifact.sizeBytes !== artifactSize) {
    throw new Error(`release-summary.json size for ${normalized} does not match the release artifact.`);
  }
  if (artifact.sha256 !== artifactSha256) {
    throw new Error(`release-summary.json sha256 for ${normalized} does not match the release artifact.`);
  }
}

console.log(`Windows release artifacts verified for ${setupName}.`);

function parseLatestYml(content) {
  const version = scalar(content, "version");
  const path = scalar(content, "path");
  const sha512 = scalar(content, "sha512");
  const fileUrl = matchRequired(content, /^\s*-\s+url:\s*(.+)$/m, "files[0].url");
  const fileSha512 = matchRequired(content, /^\s+sha512:\s*(.+)$/m, "files[0].sha512");
  const size = Number(matchRequired(content, /^\s+size:\s*(\d+)$/m, "files[0].size"));
  return { version, path, sha512, fileUrl, fileSha512, size };
}

function scalar(content, key) {
  return matchRequired(content, new RegExp(`^${key}:\\s*(.+)$`, "m"), key);
}

function matchRequired(content, pattern, label) {
  const match = content.match(pattern);
  if (!match?.[1]) throw new Error(`latest.yml is missing ${label}.`);
  return match[1].trim().replace(/^['"]|['"]$/g, "");
}
