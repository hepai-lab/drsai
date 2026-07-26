import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Signed online update lab requires Apple Silicon macOS.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidate = join(root, "release", "mac-arm64", "OpenDrSai.app");
const previous = resolve(required("OPENDRSAI_MACOS_L6_PREVIOUS_APP"));
const feedUrl = required("OPENDRSAI_MACOS_UPDATE_FEED_URL");
const feed = new URL(feedUrl);
assert.equal(feed.protocol, "https:");
for (const path of [candidate, previous]) { assert.ok(existsSync(path)); run("/usr/bin/codesign", ["--verify", "--deep", "--strict", path]); }
const fromVersion = version(previous);
const toVersion = version(candidate);
assert.notEqual(fromVersion, toVersion);
const temp = mkdtempSync(join(tmpdir(), "opendrsai-online-update-"));
const installed = join(temp, "Applications", "OpenDrSai.app");
const home = join(temp, "home");
const output = join(temp, "online-update.json");
const drsaiHome = join(home, ".drsai");
const sentinel = join(drsaiHome, "user-data-sentinel.txt");
mkdirSync(dirname(installed), { recursive: true });
mkdirSync(drsaiHome, { recursive: true });
writeFileSync(sentinel, "preserved-online-update\n", "utf8");
run("/usr/bin/ditto", [previous, installed]);
try {
  const child = spawn(join(installed, "Contents", "MacOS", "OpenDrSai"), [], {
    env: { ...process.env, HOME: home, DRSAI_HOME: drsaiHome, OPENDRSAI_MACOS_SIGNED_UPDATE_LAB: "1", OPENDRSAI_MACOS_UPDATE_FEED_URL: feed.toString(), OPENDRSAI_MACOS_UPDATE_FEED_HOST: feed.hostname, OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE: output, OPENDRSAI_MACOS_PACKAGED_SCENARIO: "online-update-lab", OPENDRSAI_MACOS_PACKAGED_SCENARIO_CONFIG: JSON.stringify({ targetVersion: toVersion }), OPENDRSAI_UPDATE_HEALTH_DELAY_MS: "1000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const first = await waitForResult(output, (value) => value.updateInstallRequested === true, 600_000, () => stderr);
  assert.equal(first.fromVersion, fromVersion);
  await waitForExit(child, 120_000);
  const final = await waitForResult(output, (value) => value.postUpdateHealthy === true, 600_000, () => stderr);
  assert.equal(final.currentVersion, toVersion);
  assert.equal(final.updateHealth.confirmed, true);
  assert.equal(final.updateHealth.version, toVersion);
  assert.equal(version(installed), toVersion);
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", installed]);
  assert.equal(readFileSync(sentinel, "utf8"), "preserved-online-update\n");
  const installedHash = sha256(join(installed, "Contents", "MacOS", "OpenDrSai"));
  assert.equal(installedHash, sha256(join(candidate, "Contents", "MacOS", "OpenDrSai")));
  const acceptance = join(root, "build", "acceptance");
  mkdirSync(acceptance, { recursive: true });
  writeFileSync(join(acceptance, "online-signed-update.json"), `${JSON.stringify({ schemaVersion: 1, testId: "online-signed-update", platform: "darwin-arm64", passed: true, fromVersion, toVersion, feedUrl: feed.toString(), onlineUpdateInstalled: true, healthConfirmed: true, userDataPreserved: true, installedAppExecutableSha256: installedHash, generatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  console.log(`macOS signed online update passed: ${fromVersion} -> ${toVersion}.`);
} finally { rmSync(temp, { recursive: true, force: true }); }

function required(name) { const value = process.env[name]?.trim(); assert.ok(value, `${name} is required`); return value; }
function run(command, args) { const result = spawnSync(command, args, { encoding: "utf8", timeout: 180_000 }); if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error?.message}`); return result.stdout; }
function version(app) { return run("/usr/bin/defaults", ["read", join(app, "Contents", "Info.plist"), "CFBundleShortVersionString"]).trim(); }
function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
async function waitForResult(path, predicate, timeout, stderr) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { try { const value = JSON.parse(readFileSync(path, "utf8")); if (predicate(value)) return value; } catch { /* update in progress */ } await new Promise((resolveDelay) => setTimeout(resolveDelay, 200)); } throw new Error(`online update timed out\n${stderr()}`); }
function waitForExit(child, timeout) { if (child.exitCode !== null) return Promise.resolve(child.exitCode); return new Promise((resolveExit, reject) => { const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("old App did not exit for update")); }, timeout); child.once("exit", (code) => { clearTimeout(timer); resolveExit(code); }); }); }
