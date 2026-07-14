import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(root, "..", "..", "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifestPath = resolve(process.env.OPENDRSAI_UPDATE_MANIFEST_PATH || join(root, "release", "latest-windows.json"));
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
const workflow = readFileSync(join(repoRoot, ".github", "workflows", "windows-desktop.yml"), "utf8");
const runtimeBuilder = readFileSync(join(root, "..", "installers", "windows", "create-opendrsai-runtime.ps1"), "utf8");

assert(packageJson.version.includes("-"), "Legacy beta compatibility check requires a prerelease package.");
assert(compareSemver(packageJson.version, "1.4.3-beta.1") > 0, "beta.1 would not recognize this package as newer.");
assert(/draft:\s*false/.test(workflow), "The tag workflow must publish rather than leave a draft invisible to beta.1.");
assert(/prerelease:\s*false/.test(workflow), "The compatibility Release must participate in GitHub releases/latest.");
assert(/make_latest:\s*true/.test(workflow), "The compatibility Release must advance GitHub releases/latest.");
assert(
  /Copy-DirectoryContents \(Join-Path \$drsaiAgentDir "venv"\)/.test(runtimeBuilder),
  "Runtime packaging must copy only the managed agent venv.",
);

if (manifest) {
  assert(manifest.version === packageJson.version, "Compatibility manifest version must match the package.");
  assert(manifest.channel === "stable", "beta.1 requests the stable channel and would reject this manifest.");
  assert(manifest.requireSignature === false, "Unsigned beta compatibility manifest must not request Authenticode verification.");
  assert(
    manifest.runtime.url === `https://github.com/hepai-lab/drsai/releases/download/v${packageJson.version}/OpenDrSaiRuntime-win-x64.zip`,
    "Compatibility manifest must retain an immutable versioned runtime URL.",
  );
  console.log(`Legacy beta update contract passed: 1.4.3-beta.1 -> ${manifest.version} via releases/latest.`);
} else {
  console.log(`Legacy beta static release contract passed for ${packageJson.version}; generated manifest check deferred.`);
}

function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  const count = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) > Number(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) throw new Error(`Invalid semantic version: ${value}`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
