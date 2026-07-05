import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseDir = join(root, "release");
const manifestPath = join(releaseDir, "latest-windows.json");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

if (!existsSync(manifestPath)) {
  throw new Error(`Missing manifest: ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const required = ["version", "channel", "installer", "sha256", "sizeBytes"];
for (const field of required) {
  if (!manifest[field]) throw new Error(`Manifest missing ${field}.`);
}

if (manifest.version !== packageJson.version) {
  throw new Error(`Manifest version ${manifest.version} does not match package ${packageJson.version}.`);
}

if (!["stable", "beta", "dev"].includes(manifest.channel)) {
  throw new Error(`Unsupported manifest channel: ${manifest.channel}`);
}

const installerName = decodeURIComponent(basename(new URL(manifest.installer).pathname));
const installerPath = join(releaseDir, installerName);
if (!existsSync(installerPath)) {
  throw new Error(`Manifest installer does not exist locally: ${installerName}`);
}

const bytes = readFileSync(installerPath);
const actualHash = createHash("sha256").update(bytes).digest("hex");
const actualSize = statSync(installerPath).size;
if (actualHash !== manifest.sha256) {
  throw new Error(`Manifest sha256 mismatch for ${installerName}.`);
}
if (actualSize !== manifest.sizeBytes) {
  throw new Error(`Manifest sizeBytes mismatch for ${installerName}.`);
}

console.log(`Manifest verified for ${installerName}.`);
