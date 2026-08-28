const { execFileSync, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, realpathSync, writeFileSync } = require("node:fs");
const { dirname, join, relative, resolve, sep } = require("node:path");

module.exports = async function afterPack(context) {
  if (process.platform !== "darwin" || process.env.CSC_IDENTITY_AUTO_DISCOVERY !== "false") return;
  const outputRoot = realpathSync(context.appOutDir);
  const app = realpathSync(join(outputRoot, `${context.packager.appInfo.productFilename}.app`));
  const relation = relative(outputRoot, app);
  if (!relation || relation.startsWith(`..${sep}`) || relation === "..") throw new Error("Unsigned development App escaped the packager output directory.");
  const entitlements = resolve(context.packager.projectDir, "build", "entitlements.mac.unsigned-development.plist");
  execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", "--options", "runtime", "--entitlements", entitlements, app], { stdio: "pipe" });
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=4", app], { stdio: "pipe" });
  const detail = spawnSync("/usr/bin/codesign", ["-d", "--verbose=4", app], { encoding: "utf8" });
  if (detail.status !== 0) throw new Error(detail.stderr || "Unable to inspect unsigned development signature.");
  const signature = `${detail.stdout}${detail.stderr}`;
  if (!/Signature=adhoc/.test(signature) || /Authority=Developer ID Application:/.test(signature) || /TeamIdentifier=(?!not set)/.test(signature)) throw new Error("Unsigned development sealing unexpectedly used a release identity.");
  const executable = join(app, "Contents", "MacOS", context.packager.appInfo.productFilename);
  const receipt = join(context.packager.projectDir, "build", "acceptance", "unsigned-development-sealing.json");
  mkdirSync(dirname(receipt), { recursive: true });
  writeFileSync(receipt, `${JSON.stringify({
    schemaVersion: 1,
    testId: "unsigned-development-sealing",
    platform: "darwin-arm64",
    passed: true,
    identity: "adhoc",
    releaseIdentity: false,
    app: relative(context.packager.projectDir, app),
    executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"),
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
};
