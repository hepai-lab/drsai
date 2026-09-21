import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const release = resolve(valueAfter("--release-dir") || join(root, "release"));
const allowMissingDmg = process.argv.includes("--allow-missing-dmg");
const metadataPath = join(release, "latest-mac.yml");
assert.ok(existsSync(metadataPath), `Missing ${metadataPath}`);
const metadata = readFileSync(metadataPath, "utf8");
const version = capture(metadata, /^version:\s*([^\s]+)\s*$/m, "version");
const path = capture(metadata, /^path:\s*(.+?)\s*$/m, "path");
const declaredSha512 = capture(metadata, /^sha512:\s*(.+?)\s*$/m, "sha512");
const runtimeVersion = capture(metadata, /^opendrsaiRuntimeVersion:\s*(.+?)\s*$/m, "opendrsaiRuntimeVersion");
const runtimeSha256 = capture(metadata, /^opendrsaiRuntimeSha256:\s*([a-f0-9]{64})\s*$/m, "opendrsaiRuntimeSha256");
assert.match(runtimeVersion, /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/);
const zipPath = join(release, path);
assert.equal(basename(path), `OpenDrSai-macOS-v${version}-arm64.zip`, "latest-mac.yml path must use the stable arm64 artifact name");
assert.ok(existsSync(zipPath), `Missing update ZIP ${zipPath}`);
const zipSize = statSync(zipPath).size;
assert.ok(zipSize < 2 * 1024 * 1024 * 1024, "The update ZIP must stay below GitHub's 2 GiB per-asset limit");
const actualSha512 = await digest(zipPath, "sha512", "base64");
assert.equal(actualSha512, declaredSha512, "latest-mac.yml sha512 does not match the ZIP");
const fileBlock = metadata.match(new RegExp(`- url:\\s*${escapeRegExp(path)}[\\s\\S]*?size:\\s*(\\d+)`));
assert.ok(fileBlock, "latest-mac.yml files entry must declare the update ZIP size");
assert.equal(Number(fileBlock[1]), zipSize, "latest-mac.yml size does not match the ZIP");
const dmgs = readdirSync(release).filter((name) => name === `OpenDrSai-macOS-v${version}-arm64.dmg`);
assert.ok(allowMissingDmg ? dmgs.length <= 1 : dmgs.length === 1, "The release must contain exactly one stable-named arm64 DMG");
const receipt = {
  schemaVersion: 1,
  testId: "macos-update-assets",
  platform: "darwin-arm64",
  passed: true,
  version,
  runtime: { version: runtimeVersion, sha256: runtimeSha256 },
  metadata: basename(metadataPath),
  zip: { name: path, size: zipSize, sha256: await digest(zipPath, "sha256"), sha512: actualSha512 },
  dmg: dmgs[0] ? { name: dmgs[0], size: statSync(join(release, dmgs[0])).size, sha256: await digest(join(release, dmgs[0]), "sha256") } : null,
  installVerified: false,
  generatedAt: new Date().toISOString(),
};
const output = resolve(valueAfter("--output") || join(root, "build", "acceptance", "macos-update-assets.json"));
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(`macOS update assets verified for ${version}; installation remains a signed L6 gate.`);

function valueAfter(flag) { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : null; }
function capture(text, pattern, label) { const match = text.match(pattern); assert.ok(match, `latest-mac.yml omits ${label}`); return match[1].trim(); }
function digest(path, algorithm, encoding = "hex") {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveDigest(hash.digest(encoding)));
  });
}
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
