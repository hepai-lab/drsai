import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Unsigned development sealing requires Apple Silicon macOS.");
const root = resolve(import.meta.dirname, "..");
const releaseRoot = realpathSync(resolve(root, "release", "mac-arm64"));
const app = realpathSync(resolve(releaseRoot, "OpenDrSai.app"));
const relation = relative(releaseRoot, app);
if (!relation || relation === ".." || relation.startsWith(`..${sep}`)) throw new Error("Unsigned development App escaped the release directory.");
const entitlements = resolve(root, "build", "entitlements.mac.unsigned-development.plist");
run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", "--options", "runtime", "--entitlements", entitlements, app]);
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=4", app]);
const signature = run("/usr/bin/codesign", ["-d", "--verbose=4", app]);
if (!/Signature=adhoc/.test(signature) || /Authority=Developer ID Application:/.test(signature) || /TeamIdentifier=(?!not set)/.test(signature)) throw new Error("Unsigned development sealing unexpectedly used a release identity.");
const bundleId = run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", resolve(app, "Contents", "Info.plist")]).trim();
if (bundleId !== "com.hepai.opendrsai.macos.development") throw new Error(`Unexpected unsigned Bundle ID: ${bundleId}`);
const executable = resolve(app, "Contents", "MacOS", "OpenDrSai");
const receipt = resolve(root, "build", "acceptance", "unsigned-development-sealing.json");
mkdirSync(dirname(receipt), { recursive: true });
writeFileSync(receipt, `${JSON.stringify({ schemaVersion: 2, testId: "unsigned-development-sealing", platform: "darwin-arm64", passed: true, identity: "adhoc", releaseIdentity: false, bundleId, app: relative(root, app), executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"), generatedAt: new Date().toISOString() }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(`Unsigned development App sealed: ${bundleId}.`);

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.error?.message})\n${output}`);
  return output;
}
