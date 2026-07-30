import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const release = resolve(requiredArg("--release-dir"));
const tag = requiredArg("--tag");
const repository = process.env.OPENDRSAI_RELEASE_REPOSITORY?.trim() || "hepai-lab/drsai";
const prePromotion = process.argv.includes("--pre-promotion");
const metadataOnly = process.argv.includes("--metadata-only");
const cdn = new URL(process.env.OPENDRSAI_MACOS_CDN_BASE_URL?.trim() || "https://download-opendrsai.ihep.ac.cn/");
assert.equal(cdn.protocol, "https:");
const metadataPath = join(release, "latest-mac.yml");
const metadata = readFileSync(metadataPath);
const metadataText = metadata.toString("utf8");
const version = capture(metadataText, /^version:\s*([^\s]+)\s*$/m, "version");
assert.equal(tag, `v${version}`);
const zipName = capture(metadataText, /^path:\s*(.+?)\s*$/m, "path");
const dmgName = `OpenDrSai-macOS-v${version}-arm64.dmg`;
const local = new Map([
  [zipName, await fileIdentity(join(release, zipName))],
  [dmgName, await fileIdentity(join(release, dmgName))],
  ["latest-mac.yml", await fileIdentity(metadataPath)],
]);

const metadataKey = prePromotion ? `channels/history/macos/arm64/v${version}/latest-mac.yml` : "channels/stable/macos/arm64/latest-mac.yml";
await assertRemote(new URL(metadataKey, cdn), local.get("latest-mac.yml"), true);
if (metadataOnly) {
  console.log(`macOS ${version} stable metadata promotion passed HEAD, Range and SHA-256.`);
  process.exit(0);
}
await assertRemote(new URL(`channels/stable/macos/arm64/${zipName}`, cdn), local.get(zipName), true);
await assertRemote(new URL(`releases/${tag}/macos/arm64/${zipName}`, cdn), local.get(zipName), true);
await assertRemote(new URL(`releases/${tag}/macos/arm64/${dmgName}`, cdn), local.get(dmgName), true);

const githubDir = mkdtempSync(join(tmpdir(), "opendrsai-github-update-"));
run("gh", ["release", "download", tag, "--repo", repository, "--dir", githubDir, "--pattern", zipName, "--pattern", "latest-mac.yml"]);
for (const name of [zipName, dmgName, "latest-mac.yml"]) {
  if (name === dmgName) continue;
  assert.ok(readdirSync(githubDir).includes(name), `GitHub release omits ${name}`);
  assert.deepEqual(await fileIdentity(join(githubDir, name)), local.get(name), `GitHub ${name} differs from the build candidate`);
}
console.log(`macOS ${version} CDN and GitHub draft assets are byte-identical; CDN HEAD, Range and SHA-256 passed.`);

async function assertRemote(url, expected, requireRange) {
  const head = await fetch(url, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(30_000) });
  assert.equal(head.status, 200, `HEAD ${url} returned ${head.status}`);
  assert.equal(Number(head.headers.get("content-length")), expected.size, `Content-Length differs for ${url}`);
  if (requireRange) {
    const range = await fetch(url, { headers: { Range: "bytes=0-1" }, redirect: "error", signal: AbortSignal.timeout(30_000) });
    assert.equal(range.status, 206, `Range ${url} returned ${range.status}`);
    assert.match(range.headers.get("content-range") || "", /^bytes 0-1\//);
    await range.body?.cancel();
  }
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(600_000) });
  assert.equal(response.status, 200, `GET ${url} returned ${response.status}`);
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of response.body) { hash.update(chunk); size += chunk.length; }
  assert.equal(size, expected.size, `Downloaded size differs for ${url}`);
  assert.equal(hash.digest("hex"), expected.sha256, `Downloaded SHA-256 differs for ${url}`);
}
async function fileIdentity(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { size: statSync(path).size, sha256: hash.digest("hex") };
}
function requiredArg(flag) { const index = process.argv.indexOf(flag); const value = index >= 0 ? process.argv[index + 1] : null; assert.ok(value, `${flag} is required`); return value; }
function capture(text, pattern, label) { const match = text.match(pattern); assert.ok(match, `latest-mac.yml omits ${label}`); return match[1].trim(); }
function run(command, args) { const result = spawnSync(command, args, { encoding: "utf8", timeout: 600_000 }); if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error?.message}`); }
