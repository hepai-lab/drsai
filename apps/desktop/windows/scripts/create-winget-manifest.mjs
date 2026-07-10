import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseDir = resolve(process.env.OPENDRSAI_RELEASE_DIR || join(root, "release"));
const packageJson = readJson(join(root, "package.json"));
const packageIdentifier = process.env.WINGET_PACKAGE_IDENTIFIER || "HepAI.OpenDrSai";
const defaultLocale = process.env.WINGET_DEFAULT_LOCALE || "en-US";
const publisher = process.env.WINGET_PUBLISHER || "HepAI Team";
const publisherUrl = process.env.WINGET_PUBLISHER_URL || "https://github.com/hepai-lab";
const packageUrl = process.env.WINGET_PACKAGE_URL || "https://github.com/hepai-lab/drsai";
const license = process.env.WINGET_LICENSE || "See project license";
const copyright = process.env.WINGET_COPYRIGHT || "Copyright (c) HepAI Team";
const installerType = process.env.WINGET_INSTALLER_TYPE || "nullsoft";
const manifestVersion = process.env.WINGET_MANIFEST_VERSION || "1.6.0";
const outputRoot = resolve(process.env.WINGET_OUTPUT_DIR || join(releaseDir, "winget"));

const manifestPath = join(releaseDir, "latest-windows.json");
if (!existsSync(manifestPath)) {
  throw new Error("Run npm run manifest:win before generating the winget manifest.");
}

const releaseManifest = readJson(manifestPath);
if (releaseManifest.version !== packageJson.version) {
  throw new Error(
    `latest-windows.json version ${releaseManifest.version} does not match package.json ${packageJson.version}.`,
  );
}

const installerUrl = new URL(releaseManifest.installer);
const installerName = decodeURIComponent(basename(installerUrl.pathname));
const installerPath = join(releaseDir, installerName);
if (!existsSync(installerPath)) {
  throw new Error(`Release installer is missing locally: ${installerName}`);
}

const installerBytes = readFileSync(installerPath);
const installerSha256 = createHash("sha256").update(installerBytes).digest("hex").toUpperCase();
if (installerSha256.toLowerCase() !== releaseManifest.sha256.toLowerCase()) {
  throw new Error("Release installer sha256 does not match latest-windows.json.");
}
if (statSync(installerPath).size !== releaseManifest.sizeBytes) {
  throw new Error("Release installer size does not match latest-windows.json.");
}

const versionDir = join(outputRoot, packageIdentifier, packageJson.version);
mkdirSync(versionDir, { recursive: true });

const versionManifest = yaml({
  PackageIdentifier: packageIdentifier,
  PackageVersion: packageJson.version,
  DefaultLocale: defaultLocale,
  ManifestType: "version",
  ManifestVersion: manifestVersion,
});

const installerManifest = yaml({
  PackageIdentifier: packageIdentifier,
  PackageVersion: packageJson.version,
  InstallerType: installerType,
  Scope: "user",
  InstallModes: ["silent"],
  UpgradeBehavior: "install",
  ReleaseDate: releaseDate(),
  Installers: [
    {
      Architecture: "x64",
      InstallerUrl: releaseManifest.installer,
      InstallerSha256: installerSha256,
      InstallerSwitches: {
        Silent: "/S",
        SilentWithProgress: "/S",
      },
      AppsAndFeaturesEntries: [
        {
          DisplayName: "OpenDrSai",
          Publisher: publisher,
        },
      ],
    },
  ],
  ManifestType: "installer",
  ManifestVersion: manifestVersion,
});

const localeManifest = yaml({
  PackageIdentifier: packageIdentifier,
  PackageVersion: packageJson.version,
  PackageLocale: defaultLocale,
  Publisher: publisher,
  PublisherUrl: publisherUrl,
  PackageName: "OpenDrSai",
  PackageUrl: packageUrl,
  License: license,
  Copyright: copyright,
  ShortDescription: "OpenDrSai Windows desktop shell and installer host.",
  Description:
    "OpenDrSai is a Windows desktop shell for the DrSai AI assistant, including local backend install and repair workflows.",
  Tags: ["ai", "assistant", "desktop", "windows"],
  ReleaseNotesUrl: `${packageUrl}/releases/tag/v${packageJson.version}`,
  ManifestType: "defaultLocale",
  ManifestVersion: manifestVersion,
});

const files = [
  [`${packageIdentifier}.yaml`, versionManifest],
  [`${packageIdentifier}.installer.yaml`, installerManifest],
  [`${packageIdentifier}.locale.${defaultLocale}.yaml`, localeManifest],
];

for (const [name, content] of files) {
  writeFileSync(join(versionDir, name), content);
}

console.log(`Wrote winget manifests to ${versionDir}`);

function releaseDate() {
  return process.env.WINGET_RELEASE_DATE || new Date().toISOString().slice(0, 10);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function yaml(value, indent = 0) {
  const lines = [];
  for (const [key, item] of Object.entries(value)) {
    lines.push(...yamlEntry(key, item, indent));
  }
  return `${lines.join("\n")}\n`;
}

function yamlEntry(key, value, indent) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}${key}: []`];
    const lines = [`${pad}${key}:`];
    const itemPad = " ".repeat(indent + 2);
    for (const item of value) {
      if (typeof item === "object" && item !== null) {
        const entries = Object.entries(item);
        const [firstKey, firstValue] = entries[0];
        lines.push(`${itemPad}- ${firstKey}: ${scalar(firstValue)}`);
        for (const [childKey, childValue] of entries.slice(1)) {
          lines.push(...yamlEntry(childKey, childValue, indent + 4));
        }
      } else {
        lines.push(`${itemPad}- ${scalar(item)}`);
      }
    }
    return lines;
  }
  if (typeof value === "object" && value !== null) {
    const lines = [`${pad}${key}:`];
    for (const [childKey, childValue] of Object.entries(value)) {
      lines.push(...yamlEntry(childKey, childValue, indent + 2));
    }
    return lines;
  }
  return [`${pad}${key}: ${scalar(value)}`];
}

function scalar(value) {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "null";
  const text = String(value);
  if (/^[A-Za-z0-9._:/?=&%+#@ -]+$/.test(text) && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}
