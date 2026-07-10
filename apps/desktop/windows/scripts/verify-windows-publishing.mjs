import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(read("package.json"));

const checks = [
  ["publishing implementation plan exists", () => exists("docs/windows-publishing-implementation-plan.md")],
  ["plan covers direct download, Store, and winget", () => {
    const plan = read("docs/windows-publishing-implementation-plan.md");
    return includesAll(plan, [
      "GitHub Release direct download",
      "Microsoft Store",
      "Windows Package Manager",
      "Partner Center",
      "privacy policy",
      "winget:manifest",
      "verify:public-release",
    ]);
  }],
  ["Store AppX template is present and explicit about Partner Center identity", () => {
    const template = read("store/electron-builder.appx.template.yml");
    return includesAll(template, [
      "target: appx",
      "__PARTNER_CENTER_APPLICATION_ID__",
      "__PARTNER_CENTER_PACKAGE_IDENTITY_NAME__",
      "__PARTNER_CENTER_PUBLISHER_SUBJECT__",
      "runFullTrust",
      "internetClient",
    ]);
  }],
  ["Store listing template covers privacy, support, screenshots, and certification notes", () => {
    const listing = read("store/store-listing.template.json");
    return includesAll(listing, [
      "__STORE_PRIVACY_POLICY_URL__",
      "__STORE_SUPPORT_URL__",
      "__PARTNER_CENTER_PUBLISHER_DISPLAY_NAME__",
      "screenshotRequirements",
      "certificationNotes",
      "dataSafetySummary",
      "Do not claim medical diagnosis",
    ]);
  }],
  ["Store templates are verified by an npm script", () => {
    const verifier = read("scripts/verify-store-listing-template.mjs");
    return Boolean(
      packageJson.scripts?.["verify:store"] === "node scripts/verify-store-listing-template.mjs" &&
        includesAll(verifier, [
          "store-listing.template.json",
          "electron-builder.appx.template.yml",
          "privacyPolicyUrl",
          "supportUrl",
          "screenshotRequirements",
          "dataSafetySummary",
        ]),
    );
  }],
  ["electron-builder uses node-pty prebuilds instead of local native rebuilds", () => {
    const builder = read("electron-builder.yml");
    return builder.includes("npmRebuild: false");
  }],
  ["winget manifest generator derives from verified release metadata", () => {
    const generator = read("scripts/create-winget-manifest.mjs");
    return includesAll(generator, [
      "latest-windows.json",
      "OPENDRSAI_RELEASE_DIR",
      "InstallerSha256",
      "InstallerSwitches",
      "Silent",
      "/S",
      "ManifestType: \"installer\"",
      "HepAI.OpenDrSai",
    ]);
  }],
  ["winget manifest verifier gates generated package metadata", () => {
    const verifier = read("scripts/verify-winget-manifest.mjs");
    const readiness = read("scripts/verify-release-readiness.mjs");
    return includesAll(verifier, [
      "latest-windows.json",
      "InstallerUrl",
      "InstallerSha256",
      "Silent: /S",
      "ManifestType: installer",
      "ReleaseNotesUrl",
    ]) && readiness.includes("verify:winget");
  }],
  ["package scripts expose publishing checks and winget manifest generation", () => {
    return Boolean(
      packageJson.scripts?.["winget:manifest"] === "node scripts/create-winget-manifest.mjs" &&
        packageJson.scripts?.["verify:winget"] === "node scripts/verify-winget-manifest.mjs" &&
        packageJson.scripts?.["verify:publishing"] === "node scripts/verify-windows-publishing.mjs",
    );
  }],
  ["release readiness runs publishing verification", () => {
    const readiness = read("scripts/verify-release-readiness.mjs");
    return readiness.includes("Windows publishing plan") && readiness.includes("verify:publishing");
  }],
  ["release checklist links Store and winget follow-up", () => {
    const checklist = read("docs/release-checklist.md");
    return includesAll(checklist, [
      "Store and Winget Follow-up",
      "windows-publishing-implementation-plan.md",
      "winget:manifest",
      "electron-builder.appx.template.yml",
    ]);
  }],
  ["CI generates and uploads winget manifests", () => {
    const workflow = read("../../../.github/workflows/windows-desktop.yml");
    return includesAll(workflow, [
      "Generate winget manifests",
      "npm run winget:manifest",
      "apps/desktop/windows/release/winget/**/*.yaml",
    ]);
  }],
  ["bootstrapper builder can reuse electron-builder cached NSIS", () => {
    const bootstrapperBuild = read("bootstrapper/build.ps1");
    return includesAll(bootstrapperBuild, [
      "electron-builder\\Cache",
      "makensis.exe",
      "run npm run build:win once",
    ]);
  }],
];

const failures = [];
for (const [name, check] of checks) {
  try {
    if (!check()) failures.push(name);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  console.error("Windows publishing verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Windows publishing implementation verified.");

function exists(relativePath) {
  return existsSync(join(root, relativePath));
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function includesAll(text, snippets) {
  return snippets.every((snippet) => text.includes(snippet));
}
