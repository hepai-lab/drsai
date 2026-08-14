import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const release = resolve(requiredArg("--release-dir"));
const tag = requiredArg("--tag");
const beta = process.argv.includes("--beta");
const betaChannel = process.argv.includes("--beta-channel");
const prePromotion = process.argv.includes("--pre-promotion");
const metadataOnly = process.argv.includes("--metadata-only");
assert.equal(beta && betaChannel, false, "Choose either --beta or --beta-channel.");
if (beta || betaChannel) {
  assert.equal(prePromotion || metadataOnly, false, "--beta cannot be combined with stable-channel verification flags.");
}
const cdn = new URL(process.env.OPENDRSAI_MACOS_CDN_BASE_URL?.trim() || "https://download-opendrsai.ihep.ac.cn/");
assert.equal(cdn.protocol, "https:");
const metadataPath = join(release, "latest-mac.yml");
const metadata = readFileSync(metadataPath);
const metadataText = metadata.toString("utf8");
const version = capture(metadataText, /^version:\s*([^\s]+)\s*$/m, "version");
assert.equal(tag, `v${version}`);
if (beta || betaChannel) assert.match(version, /-/, "Beta verification requires prerelease metadata.");
const zipName = capture(metadataText, /^path:\s*(.+?)\s*$/m, "path");
const dmgName = `OpenDrSai-macOS-v${version}-arm64.dmg`;
const local = new Map([
  [zipName, await fileIdentity(join(release, zipName))],
  [dmgName, await fileIdentity(join(release, dmgName))],
  ["latest-mac.yml", await fileIdentity(metadataPath)],
]);
const declaredZipSize = Number(capture(metadataText, /^\s+size:\s*(\d+)\s*$/m, "ZIP size"));
const declaredZipSha512 = capture(metadataText, /^sha512:\s*(\S+)\s*$/m, "ZIP SHA-512");
const runtimeVersion = capture(metadataText, /^opendrsaiRuntimeVersion:\s*(\S+)\s*$/m, "Runtime version");
const runtimeSha256 = capture(metadataText, /^opendrsaiRuntimeSha256:\s*([a-f0-9]{64})\s*$/m, "Runtime SHA-256");
assert.equal(declaredZipSize, local.get(zipName).size, "latest-mac.yml ZIP size differs from the local ZIP");
assert.equal(declaredZipSha512, local.get(zipName).sha512, "latest-mac.yml ZIP SHA-512 differs from the local ZIP");
assert.equal(runtimeVersion, version, "latest-mac.yml Runtime version differs from the release version");
assert.match(runtimeSha256, /^[a-f0-9]{64}$/);

const releasePrefix = `releases/${tag}/macos`;
const metadataKey = betaChannel ? "channels/beta/macos/arm64/latest-mac.yml" : beta ? `${releasePrefix}/latest-mac.yml` : prePromotion ? `channels/history/macos/arm64/v${version}/latest-mac.yml` : "channels/stable/macos/arm64/latest-mac.yml";
await assertRemote(new URL(metadataKey, cdn), local.get("latest-mac.yml"), true);
if (metadataOnly) {
  console.log(`macOS ${version} stable metadata promotion passed HEAD, Range and SHA-256.`);
  process.exit(0);
}
if (!beta && !betaChannel) await assertRemote(new URL(`channels/stable/macos/arm64/${zipName}`, cdn), local.get(zipName), true);
await assertRemote(new URL(`releases/${tag}/macos/${zipName}`, cdn), local.get(zipName), true);
await assertRemote(new URL(`releases/${tag}/macos/${dmgName}`, cdn), local.get(dmgName), true);

if (betaChannel) console.log(`macOS ${version} beta channel and immutable assets passed strict TLS, HEAD, Range, size, SHA-512, Runtime SHA-256 and full SHA-256 verification.`);
else if (beta) console.log(`macOS ${version} beta candidate is byte-identical to the build candidate; HEAD, Range and SHA-256 passed.`);
else console.log(`macOS ${version} OSS/CDN assets are byte-identical to the build candidate; HEAD, Range and SHA-256 passed.`);

async function assertRemote(url, expected, requireRange) {
  const head = curl(["--head", url.toString()]);
  assert.match(head, /(?:^|\r?\n)HTTP\/(?:1\.1|2) 200(?:\s|\r?$)/m, `HEAD ${url} did not return 200`);
  assert.equal(Number(header(head, "content-length")), expected.size, `Content-Length differs for ${url}`);
  if (requireRange) {
    const range = curl(["--range", "0-1", "--dump-header", "-", "--output", "/dev/null", url.toString()]);
    assert.match(range, /(?:^|\r?\n)HTTP\/(?:1\.1|2) 206(?:\s|\r?$)/m, `Range ${url} did not return 206`);
    assert.match(header(range, "content-range"), /^bytes 0-1\//);
  }
  const directory = mkdtempSync(join(tmpdir(), "opendrsai-cdn-verify-"));
  const output = join(directory, "asset");
  try {
    curl(["--output", output, "--max-time", "1800", url.toString()]);
    assert.deepEqual(await fileIdentity(output), expected, `Downloaded identity differs for ${url}`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
async function fileIdentity(path) {
  const sha256 = createHash("sha256");
  const sha512 = createHash("sha512");
  for await (const chunk of createReadStream(path)) { sha256.update(chunk); sha512.update(chunk); }
  return { size: statSync(path).size, sha256: sha256.digest("hex"), sha512: sha512.digest("base64") };
}
function requiredArg(flag) { const index = process.argv.indexOf(flag); const value = index >= 0 ? process.argv[index + 1] : null; assert.ok(value, `${flag} is required`); return value; }
function capture(text, pattern, label) { const match = text.match(pattern); assert.ok(match, `latest-mac.yml omits ${label}`); return match[1].trim(); }
function curl(args) { const result = spawnSync("/usr/bin/curl", ["-fsS", "--proto", "=https", "--tlsv1.2", "--max-time", "30", ...args], { encoding: "utf8", timeout: 1_810_000, maxBuffer: 8 * 1024 * 1024 }); if (result.error || result.status !== 0) throw new Error(`/usr/bin/curl failed for ${args.at(-1)}: ${result.stderr || result.error?.message}`); return result.stdout; }
function header(source, name) { const match = source.match(new RegExp(`(?:^|\\r?\\n)${name}:\\s*([^\\r\\n]+)`, "i")); return match?.[1]?.trim() || ""; }
