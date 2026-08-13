import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("Website release verification must run on Apple Silicon macOS.");
}

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const macosRoot = resolve(scriptRoot, "..");
const origin = httpsUrl(requiredArg("--origin"), "--origin");
const downloadOrigin = httpsUrl(requiredArg("--download-origin"), "--download-origin");
const version = requiredArg("--version");
const arch = requiredArg("--arch");
const releaseDir = resolve(requiredArg("--release-dir"));
const tag = `v${version}`;
assert.equal(arch, "arm64", "v1.5.7 production release only supports arm64");

const metadataUrl = new URL("channels/stable/macos/arm64/latest-mac.yml", downloadOrigin);
const metadataResponse = curlText(metadataUrl, ["--location", "--write-out", "\n%{url_effective}"]);
const splitAt = metadataResponse.lastIndexOf("\n");
const metadataText = metadataResponse.slice(0, splitAt);
const effectiveMetadataUrl = httpsUrl(metadataResponse.slice(splitAt + 1).trim(), "stable metadata effective URL");
assert.equal(effectiveMetadataUrl.host, downloadOrigin.host, "stable metadata redirected away from the trusted download host");

const publishedVersion = capture(metadataText, /^version:\s*([^\s]+)\s*$/m, "version");
const zipName = capture(metadataText, /^path:\s*(.+?)\s*$/m, "path");
const zipSize = Number(capture(metadataText, /^\s+size:\s*(\d+)\s*$/m, "files[0].size"));
const zipSha512 = capture(metadataText, /^sha512:\s*(\S+)\s*$/m, "sha512");
const runtimeVersion = capture(metadataText, /^opendrsaiRuntimeVersion:\s*(\S+)\s*$/m, "opendrsaiRuntimeVersion");
const runtimeSha256 = capture(metadataText, /^opendrsaiRuntimeSha256:\s*([a-f0-9]{64})\s*$/m, "opendrsaiRuntimeSha256");
assert.equal(publishedVersion, version, "stable metadata does not publish the requested version");
assert.equal(zipName, `OpenDrSai-macOS-v${version}-${arch}.zip`, "stable metadata path is not the immutable version/architecture filename");
assert.ok(Number.isSafeInteger(zipSize) && zipSize > 0, "stable metadata size is invalid");
assert.match(zipSha512, /^[A-Za-z0-9+/]+={0,2}$/, "stable metadata SHA-512 is invalid");
assert.ok(runtimeVersion.length > 0, "stable metadata Runtime version is empty");
assert.match(runtimeSha256, /^[a-f0-9]{64}$/);

const site = curlHeaders(origin);
assertStatus(site, 200, `site ${origin}`);
assert.equal(httpsUrl(site.effectiveUrl, "site effective URL").host, origin.host, "site redirected away from the requested host");

const zipUrl = new URL(`channels/stable/macos/arm64/${zipName}`, downloadOrigin);
const zipHead = curlHeaders(zipUrl);
assertStatus(zipHead, 200, `update ZIP ${zipUrl}`);
assert.equal(Number(header(zipHead.headers, "content-length")), zipSize, "update ZIP Content-Length differs from stable metadata");
assertRange(zipUrl, zipSize);

const dmgName = `OpenDrSai-macOS-v${version}-${arch}.dmg`;
const dmgUrl = new URL(`releases/${tag}/macos/${dmgName}`, downloadOrigin);
const dmgHead = curlHeaders(dmgUrl);
assertStatus(dmgHead, 200, `DMG ${dmgUrl}`);
assertRange(dmgUrl, Number(header(dmgHead.headers, "content-length")));

run(process.execPath, [join(scriptRoot, "verify-published-update.mjs"), "--release-dir", releaseDir, "--tag", tag]);

const localZip = join(releaseDir, zipName);
const localDmg = join(releaseDir, dmgName);
assert.ok(existsSync(localZip), `missing local update ZIP: ${localZip}`);
assert.ok(existsSync(localDmg), `missing local DMG: ${localDmg}`);
assert.equal(statSync(localZip).size, zipSize, "local update ZIP size differs from stable metadata");
assert.equal(await digest(localZip, "sha512", "base64"), zipSha512, "local update ZIP SHA-512 differs from stable metadata");

const mountRoot = mkdtempSync(join(tmpdir(), "opendrsai-release-mount-"));
const mountPoint = join(mountRoot, "volume");
mkdirSync(mountPoint);
let mounted = false;
try {
  run("/usr/bin/hdiutil", ["attach", localDmg, "-readonly", "-nobrowse", "-mountpoint", mountPoint]);
  mounted = true;
  const app = join(mountPoint, "OpenDrSai.app");
  assert.ok(existsSync(app), "DMG does not contain OpenDrSai.app");
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  run("/usr/bin/xcrun", ["stapler", "validate", app]);
  run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
  const bundleVersion = run("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", join(app, "Contents", "Info.plist")], true).trim();
  assert.equal(bundleVersion, version, "DMG App version differs from the requested version");
} finally {
  if (mounted) run("/usr/bin/hdiutil", ["detach", mountPoint], false);
  rmSync(mountRoot, { recursive: true, force: true });
}

const receipt = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  version,
  arch,
  origin: origin.toString(),
  downloadOrigin: downloadOrigin.toString(),
  metadataUrl: metadataUrl.toString(),
  siteStatus: 200,
  stable: { path: zipName, size: zipSize, sha512: zipSha512, runtimeVersion, runtimeSha256 },
  assets: {
    zip: { url: zipUrl.toString(), sha256: await digest(localZip, "sha256", "hex") },
    dmg: { url: dmgUrl.toString(), size: statSync(localDmg).size, sha256: await digest(localDmg, "sha256", "hex") },
  },
  checks: ["https", "trusted-redirects", "site-200", "stable-metadata", "head", "range", "content-length", "remote-local-byte-identity", "sha512", "codesign-strict", "staple", "gatekeeper", "bundle-version"],
};
const receiptPath = join(macosRoot, "build", "acceptance", "website-release.json");
mkdirSync(dirname(receiptPath), { recursive: true });
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log(`macOS v${version} website and OSS/CDN release verification passed: ${receiptPath}`);

function requiredArg(flag) {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : "";
  assert.ok(value, `${flag} is required`);
  return value;
}
function httpsUrl(value, label) {
  const url = new URL(value);
  assert.equal(url.protocol, "https:", `${label} must use HTTPS`);
  assert.equal(url.username, "", `${label} must not include credentials`);
  assert.equal(url.password, "", `${label} must not include credentials`);
  return url;
}
function capture(text, pattern, label) {
  const match = text.match(pattern);
  assert.ok(match, `latest-mac.yml omits ${label}`);
  return match[1].trim();
}
function curlText(url, extra = []) {
  return run("/usr/bin/curl", ["-fsS", "--proto", "=https", "--proto-redir", "=https", "--tlsv1.2", "--max-time", "60", ...extra, url.toString()], true);
}
function curlHeaders(url) {
  const marker = "__OPENDRSAI_EFFECTIVE_URL__";
  const output = curlText(url, ["--location", "--head", "--write-out", `\n${marker}%{url_effective}`]);
  const index = output.lastIndexOf(marker);
  assert.ok(index >= 0, `curl did not report the effective URL for ${url}`);
  return { headers: output.slice(0, index), effectiveUrl: output.slice(index + marker.length).trim() };
}
function assertStatus(response, status, label) {
  const statuses = [...response.headers.matchAll(/(?:^|\r?\n)HTTP\/(?:1\.1|2)\s+(\d{3})(?:\s|\r?$)/gm)].map((match) => Number(match[1]));
  assert.equal(statuses.at(-1), status, `${label} did not return HTTP ${status}`);
}
function assertRange(url, totalSize) {
  assert.ok(Number.isSafeInteger(totalSize) && totalSize > 1, `invalid Content-Length for ${url}`);
  const output = curlText(url, ["--range", "0-1", "--dump-header", "-", "--output", "/dev/null"]);
  assert.match(output, /(?:^|\r?\n)HTTP\/(?:1\.1|2) 206(?:\s|\r?$)/m, `Range ${url} did not return 206`);
  assert.equal(header(output, "content-range"), `bytes 0-1/${totalSize}`, `Range total differs for ${url}`);
}
function header(source, name) {
  const matches = [...source.matchAll(new RegExp(`(?:^|\\r?\\n)${name}:\\s*([^\\r\\n]+)`, "gi"))];
  return matches.at(-1)?.[1]?.trim() || "";
}
function run(command, args, captureOutput = false) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout: 1_800_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`${command} failed (${result.status}): ${result.stderr || ""}`);
  }
  return result.stdout || "";
}
async function digest(path, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest(encoding);
}
