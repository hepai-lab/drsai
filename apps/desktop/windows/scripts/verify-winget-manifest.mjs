import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseDir = resolve(process.env.OPENDRSAI_RELEASE_DIR || join(root, "release"));
const packageJson = readJson(join(root, "package.json"));
const releaseManifest = readJson(join(releaseDir, "latest-windows.json"));
const packageIdentifier = process.env.WINGET_PACKAGE_IDENTIFIER || "HepAI.OpenDrSai";
const locale = process.env.WINGET_DEFAULT_LOCALE || "en-US";
const versionDir = join(releaseDir, "winget", packageIdentifier, packageJson.version);

const files = {
  version: join(versionDir, `${packageIdentifier}.yaml`),
  installer: join(versionDir, `${packageIdentifier}.installer.yaml`),
  locale: join(versionDir, `${packageIdentifier}.locale.${locale}.yaml`),
};

for (const [name, path] of Object.entries(files)) {
  if (!existsSync(path)) {
    throw new Error(`Missing winget ${name} manifest: ${path}`);
  }
  if (statSync(path).size === 0) {
    throw new Error(`Winget ${name} manifest is empty: ${path}`);
  }
}

if (releaseManifest.version !== packageJson.version) {
  throw new Error(`latest-windows.json version ${releaseManifest.version} does not match package ${packageJson.version}.`);
}

const installerUrl = new URL(releaseManifest.installer);
const setupPath = join(releaseDir, decodeURIComponent(basename(installerUrl.pathname)));
if (!existsSync(setupPath)) {
  throw new Error(`Release installer referenced by latest-windows.json is missing: ${setupPath}`);
}

const versionManifest = read(files.version);
const installerManifest = read(files.installer);
const localeManifest = read(files.locale);
const expectedSha = releaseManifest.sha256.toUpperCase();

assertIncludes(versionManifest, [
  `PackageIdentifier: ${packageIdentifier}`,
  `PackageVersion: ${packageJson.version}`,
  "ManifestType: version",
  "ManifestVersion:",
]);

assertIncludes(installerManifest, [
  `PackageIdentifier: ${packageIdentifier}`,
  `PackageVersion: ${packageJson.version}`,
  "InstallerType: nullsoft",
  "Scope: user",
  "InstallModes:",
  "- silent",
  `InstallerUrl: ${releaseManifest.installer}`,
  `InstallerSha256: ${expectedSha}`,
  "Silent: /S",
  "SilentWithProgress: /S",
  "Architecture: x64",
  "ManifestType: installer",
]);

assertIncludes(localeManifest, [
  `PackageIdentifier: ${packageIdentifier}`,
  `PackageVersion: ${packageJson.version}`,
  `PackageLocale: ${locale}`,
  "PackageName: OpenDrSai",
  "ShortDescription:",
  `ReleaseNotesUrl: https://github.com/hepai-lab/drsai/releases/tag/v${packageJson.version}`,
  "ManifestType: defaultLocale",
]);

for (const [name, content] of Object.entries({ versionManifest, installerManifest, localeManifest })) {
  if (content.includes("__") || content.includes("<") || content.includes(">")) {
    throw new Error(`Winget ${name} appears to contain a placeholder.`);
  }
}

console.log(`Winget manifests verified for ${packageIdentifier} ${packageJson.version}.`);

function readJson(path) {
  return JSON.parse(read(path).replace(/^\uFEFF/, ""));
}

function read(path) {
  return readFileSync(path, "utf8");
}

function assertIncludes(text, snippets) {
  for (const snippet of snippets) {
    if (!text.includes(snippet)) {
      throw new Error(`Winget manifest is missing: ${snippet}`);
    }
  }
}
