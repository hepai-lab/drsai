import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Release preflight requires Apple Silicon macOS.");
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "build/acceptance/release-preflight.json");
const identities = run("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"]);
const developerIds = [...identities.matchAll(/\"(Developer ID Application:[^\"]+)\"/g)].map((match) => match[1]);
const credentials = {
  signingIdentity: developerIds.length === 1,
  notarization: Boolean(process.env.APPLE_API_KEY?.trim() && process.env.APPLE_API_KEY_ID?.trim() && process.env.APPLE_API_ISSUER?.trim()),
};
const signingGraph = [
  "Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
  "Contents/Resources/native/libOpenDrSaiNativeProtocol.dylib",
  "Contents/Resources/native/OpenDrSaiNativeHelper",
  "Contents/Frameworks/**/*.framework/Versions/A/*",
  "Contents/Frameworks/**/*.app",
  "Contents/Frameworks/**/*.framework",
  "Contents/Frameworks/**/*.dylib",
  "Contents/Frameworks/**/*.xpc",
  "Contents/MacOS/OpenDrSai",
  "OpenDrSai.app",
];
const status = credentials.signingIdentity && credentials.notarization ? "ready-to-build-signed-rc" : "blocked-on-signing";
const receipt = { schemaVersion: 1, testId: "release-preflight", platform: "darwin-arm64", passed: true, status, credentials, developerIdCount: developerIds.length, signingGraph, signingOrder: "inside-out", generatedAt: new Date().toISOString() };
mkdirSync(resolve(root, "build/acceptance"), { recursive: true });
writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(`macOS release preflight: ${status}; Developer ID identities=${developerIds.length}; notarization credentials=${credentials.notarization}.`);

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw result.error;
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}
