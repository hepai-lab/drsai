import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execute = process.argv.includes("--execute");
const assetsOnly = process.argv.includes("--assets-only");
const metadataOnly = process.argv.includes("--promote-metadata");
const snapshotStable = process.argv.includes("--snapshot-stable");
const rollbackMetadata = process.argv.includes("--rollback-metadata");
const preflight = process.argv.includes("--preflight");
assert.equal(assetsOnly && metadataOnly, false, "Choose either --assets-only or --promote-metadata.");
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const release = resolve(valueAfter("--release-dir") || join(root, "release"));
const bucket = process.env.OPENDRSAI_OSS_BUCKET?.trim() || "hepai-release";
const binary = process.env.OPENDRSAI_OSSUTIL_BIN?.trim() || "ossutil";
const metadata = join(release, "latest-mac.yml");
assert.ok(existsSync(metadata), `Missing ${metadata}`);
const source = readFileSync(metadata, "utf8");
const version = capture(source, /^version:\s*([^\s]+)\s*$/m, "version");
assert.match(version, /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/);
const zipName = capture(source, /^path:\s*(.+?)\s*$/m, "path");
assert.equal(zipName, `OpenDrSai-macOS-v${version}-arm64.zip`);
const dmgName = `OpenDrSai-macOS-v${version}-arm64.dmg`;
for (const name of [zipName, dmgName]) assert.ok(existsSync(join(release, name)), `Missing ${name}`);

const versionPrefix = `releases/v${version}/macos/arm64`;
const channelPrefix = "channels/stable/macos/arm64";
const historyKey = `channels/history/macos/arm64/v${version}/latest-mac.yml`;
const stableTarget = `oss://${bucket}/${channelPrefix}/latest-mac.yml`;
const rollbackTarget = `oss://${bucket}/channels/rollback/macos/arm64/before-v${version}/latest-mac.yml`;
const stateFile = valueAfter("--state-file");
if (preflight) {
  assert.equal(execute, true, "OSS publication preflight requires --execute.");
  const stableExists = objectExists(stableTarget);
  console.log(`OSS publication preflight passed; stable metadata currently ${stableExists ? "exists" : "does not exist"}.`);
  process.exit(0);
}
if (snapshotStable || rollbackMetadata) {
  assert.ok(stateFile, "--state-file is required for stable snapshot or rollback.");
  if (!execute) {
    console.log(JSON.stringify({ schemaVersion: 1, platform: "darwin-arm64", version, execute, phase: snapshotStable ? "snapshot-stable" : "rollback-stable", stableTarget, rollbackTarget }, null, 2));
    process.exit(0);
  }
  if (snapshotStable) snapshotStableMetadata(); else rollbackStableMetadata();
  process.exit(0);
}
const allCommands = [
  upload(join(release, dmgName), `${versionPrefix}/${dmgName}`, "public, max-age=31536000, immutable"),
  upload(join(release, zipName), `${versionPrefix}/${zipName}`, "public, max-age=31536000, immutable"),
  upload(join(release, zipName), `${channelPrefix}/${zipName}`, "public, max-age=31536000, immutable"),
  upload(metadata, historyKey, "public, max-age=31536000, immutable"),
  upload(metadata, `${channelPrefix}/latest-mac.yml`, "public, max-age=30, must-revalidate"),
];
const commands = assetsOnly ? allCommands.slice(0, -1) : metadataOnly ? allCommands.slice(-1) : allCommands;

const plan = { schemaVersion: 1, platform: "darwin-arm64", version, bucket, execute, phase: assetsOnly ? "assets" : metadataOnly ? "stable-metadata" : "complete", metadataLast: true, commands: commands.map(({ display }) => display) };
console.log(JSON.stringify(plan, null, 2));
if (!execute) process.exit(0);
for (const command of commands) run(command);
console.log(`Published macOS ${version} assets; stable metadata was uploaded last.`);

function upload(local, key, cacheControl) {
  const target = `oss://${bucket}/${key}`;
  const forbidOverwrite = key !== `${channelPrefix}/latest-mac.yml`;
  return {
    args: ["cp", local, target, "--force", "--meta", `Cache-Control:${cacheControl}`],
    display: { operation: "upload", source: basename(local), target, cacheControl, forbidOverwrite },
  };
}
function run(command) {
  if (command.display.forbidOverwrite) assertObjectAbsent(command.display.target);
  const result = spawnSync(binary, command.args, { stdio: "inherit", timeout: 600_000 });
  if (result.error || result.status !== 0) throw new Error(`${binary} failed while publishing macOS update assets.`);
}
function assertObjectAbsent(target) {
  if (objectExists(target)) throw new Error(`Immutable OSS object already exists: ${target}`);
}
function objectExists(target) {
  const result = spawnSync(binary, ["stat", target], { encoding: "utf8", timeout: 60_000 });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  const detail = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (!/(NoSuchKey|ObjectNotExist|StatusCode[=: ]+404|status code[=: ]+404|\b404\b)/i.test(detail)) {
    throw new Error(`Unable to prove immutable OSS object is absent: ${target}`);
  }
  return false;
}
function snapshotStableMetadata() {
  const previousExists = objectExists(stableTarget);
  if (previousExists) runRaw(["cp", stableTarget, rollbackTarget, "--force"]);
  writeFileSync(resolve(stateFile), `${JSON.stringify({ schemaVersion: 1, version, previousExists, stableTarget, rollbackTarget })}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(previousExists ? "Snapshotted previous stable metadata." : "No previous stable metadata exists; recorded first-release rollback state.");
}
function rollbackStableMetadata() {
  const state = JSON.parse(readFileSync(resolve(stateFile), "utf8"));
  assert.equal(state.version, version);
  assert.equal(state.stableTarget, stableTarget);
  assert.equal(state.rollbackTarget, rollbackTarget);
  if (state.previousExists) runRaw(["cp", rollbackTarget, stableTarget, "--force"]);
  else runRaw(["rm", stableTarget, "--force"]);
  console.log("Restored the previous macOS stable metadata state.");
}
function runRaw(args) {
  const result = spawnSync(binary, args, { stdio: "inherit", timeout: 600_000 });
  if (result.error || result.status !== 0) throw new Error(`${binary} failed during stable metadata recovery.`);
}
function valueAfter(flag) { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : null; }
function capture(text, pattern, label) { const match = text.match(pattern); assert.ok(match, `latest-mac.yml omits ${label}`); return match[1].trim(); }
