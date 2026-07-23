import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("L6 release verification must run on Apple Silicon macOS.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const release = join(root, "release");
const acceptance = join(root, "build", "acceptance");
const app = join(release, "mac-arm64", "OpenDrSai.app");
const dmg = singleArtifact(".dmg");
const zip = singleArtifact(".zip");
const latest = join(release, "latest-mac.yml");
for (const path of [app, dmg, zip, latest]) assert.ok(existsSync(path), `missing release artifact: ${path}`);
mkdirSync(acceptance, { recursive: true });

const codesign = run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=4", app]);
const signature = run("/usr/bin/codesign", ["-d", "--verbose=4", app]);
assert.match(signature, /Authority=Developer ID Application:/);
assert.match(signature, /TeamIdentifier=[A-Z0-9]+/);
receipt("codesign-strict", { featureIds: ["F12.2"], appSha256: sha256(app), verification: codesign.trim() || "codesign --strict passed", identity: signatureLines(signature) });

const gatekeeper = run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", app]);
assert.match(gatekeeper, /accepted/i);
receipt("gatekeeper", { featureIds: ["F12.3"], appSha256: sha256(app), assessment: gatekeeper.trim() });

const appStaple = run("/usr/bin/xcrun", ["stapler", "validate", app]);
const dmgStaple = run("/usr/bin/xcrun", ["stapler", "validate", dmg]);
assert.match(`${appStaple}\n${dmgStaple}`, /worked|valid/i);
receipt("notarization-staple", { featureIds: ["F12.3"], appSha256: sha256(app), dmgSha256: sha256(dmg), appStaple: appStaple.trim(), dmgStaple: dmgStaple.trim() });

const clean = await verifyCleanInstall();
receipt("clean-install", { featureIds: ["F12.4"], ...clean });

const previousApp = process.env.OPENDRSAI_MACOS_L6_PREVIOUS_APP?.trim();
if (!previousApp) throw new Error("OPENDRSAI_MACOS_L6_PREVIOUS_APP is required for signed rollback rehearsal.");
const rollback = verifySignedRollback(resolve(previousApp));
receipt("signed-update-rollback-rehearsal", rollback);
console.log(`macOS automated L6 release checks passed: ${basename(dmg)}, ${rollback.previousVersion} -> ${rollback.currentVersion}.`);

async function verifyCleanInstall() {
  const temp = mkdtempSync(join(tmpdir(), "opendrsai-clean-install-"));
  const mount = join(temp, "mount");
  const installRoot = join(temp, "Applications");
  const cleanHome = join(temp, "home");
  mkdirSync(mount, { recursive: true });
  mkdirSync(installRoot, { recursive: true });
  let attached = false;
  try {
    run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, dmg]);
    attached = true;
    const mountedApp = join(mount, "OpenDrSai.app");
    assert.ok(existsSync(mountedApp), "DMG does not contain OpenDrSai.app");
    const installedApp = join(installRoot, "OpenDrSai.app");
    run("/usr/bin/ditto", [mountedApp, installedApp]);
    run("/usr/bin/codesign", ["--verify", "--deep", "--strict", installedApp]);
    const resultPath = join(temp, "clean-install.json");
    const port = await freePort();
    const child = spawn(join(installedApp, "Contents", "MacOS", "OpenDrSai"), [], {
      env: { ...process.env, DRSAI_HOME: cleanHome, DRSAI_API_PORT: String(port), OPENDRSAI_RUNTIME_PERSIST: "0", OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE: resultPath, OPENDRSAI_MACOS_PACKAGED_SCENARIO: "smoke", OPENDRSAI_UPDATE_HEALTH_DELAY_MS: "1000" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const result = await waitForJson(resultPath, child, 150_000, () => stderr);
    const exit = await waitForExit(child, 30_000);
    assert.equal(exit, 0, stderr);
    assert.equal(result.ok, true);
    assert.equal(result.install.installed, true);
    assert.equal(isAlive(result.gateway.pid), false);
    assert.equal(isAlive(result.terminal.pid), false);
    const installedAppSha256 = sha256(join(installedApp, "Contents", "MacOS", "OpenDrSai"));
    const userDataSentinel = join(cleanHome, "uninstall-user-data.txt");
    writeFileSync(userDataSentinel, "preserve-after-app-removal\n", "utf8");
    rmSync(installedApp, { recursive: true, force: true });
    assert.equal(existsSync(installedApp), false, "clean uninstall did not remove the copied App bundle");
    assert.equal(readFileSync(userDataSentinel, "utf8"), "preserve-after-app-removal\n", "App removal unexpectedly deleted user data");
    return { dmgSha256: sha256(dmg), installedAppSha256, runtimeInstalled: true, rendererPreloadIpc: true, gatewayOrphans: 0, ptyOrphans: 0, appRemoved: true, userDataPreserved: true };
  } finally {
    if (attached) try { run("/usr/bin/hdiutil", ["detach", mount, "-force"]); } catch { /* cleanup continues */ }
    rmSync(temp, { recursive: true, force: true });
  }
}

function verifySignedRollback(previous) {
  assert.ok(existsSync(previous), `previous signed App missing: ${previous}`);
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", previous]);
  const previousVersion = bundleVersion(previous);
  const currentVersion = bundleVersion(app);
  assert.notEqual(previousVersion, currentVersion, "previous and current release versions must differ");
  verifyUpdateMetadata(currentVersion);
  const temp = mkdtempSync(join(tmpdir(), "opendrsai-update-rollback-"));
  try {
    const current = join(temp, "Applications", "OpenDrSai.app");
    const backup = join(temp, "user-data", "update-rollback", "OpenDrSai.app");
    const health = join(temp, "user-data", "update-health.json");
    const sentinel = join(temp, "user-data", "user-data-preserved.txt");
    mkdirSync(dirname(current), { recursive: true });
    mkdirSync(dirname(backup), { recursive: true });
    writeFileSync(sentinel, "preserve-me\n", "utf8");

    run("/usr/bin/ditto", [app, current]);
    run("/usr/bin/ditto", [previous, backup]);
    writeFileSync(health, JSON.stringify({ version: currentVersion, healthyAt: new Date().toISOString() }), "utf8");
    run("/bin/sh", [join(root, "resources", "update", "update-watchdog.sh"), "999999999", current, backup, health, currentVersion, "1"]);
    assert.equal(bundleVersion(current), currentVersion);
    assert.equal(existsSync(backup), false, "healthy update backup was not retired");

    rmSync(health, { force: true });
    mkdirSync(dirname(backup), { recursive: true });
    run("/usr/bin/ditto", [previous, backup]);
    run("/bin/sh", [join(root, "resources", "update", "update-watchdog.sh"), "999999999", current, backup, health, currentVersion, "1"]);
    assert.equal(bundleVersion(current), previousVersion, "unhealthy update did not restore previous signed version");
    run("/usr/bin/codesign", ["--verify", "--deep", "--strict", current]);
    assert.equal(readFileSync(sentinel, "utf8"), "preserve-me\n");
    return { previousVersion, currentVersion, previousAppSha256: sha256(join(previous, "Contents", "MacOS", "OpenDrSai")), currentAppSha256: sha256(join(app, "Contents", "MacOS", "OpenDrSai")), updateMetadataVerified: true, healthyUpdateCommitted: true, rollbackRestoredPrevious: true, userDataPreserved: true, onlineUpdateInstalled: false };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

function verifyUpdateMetadata(version) {
  const text = readFileSync(latest, "utf8");
  assert.match(text, new RegExp(`^version:\\s*[\"']?${escapeRegex(version)}[\"']?\\s*$`, "m"));
  const expected = createHash("sha512").update(readFileSync(zip)).digest("base64");
  assert.ok(text.includes(expected), "latest-mac.yml does not contain the ZIP SHA-512");
}

function receipt(testId, detail) { writeFileSync(join(acceptance, `${testId}.json`), `${JSON.stringify({ schemaVersion: 2, testId, platform: "darwin-arm64", passed: true, ...detail, generatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8"); }
function run(command, args) { const result = spawnSync(command, args, { encoding: "utf8", timeout: 180_000, stdio: ["ignore", "pipe", "pipe"] }); const output = `${result.stdout || ""}\n${result.stderr || ""}`; if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? result.error?.message})\n${output}`); return output; }
function singleArtifact(extension) { const matches = readdirSync(release).filter((name) => name.endsWith(extension)); assert.equal(matches.length, 1, `expected one ${extension} artifact, found ${matches.length}`); return join(release, matches[0]); }
function bundleVersion(path) { return run("/usr/bin/defaults", ["read", join(path, "Contents", "Info.plist"), "CFBundleShortVersionString"]).trim(); }
function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function signatureLines(text) { return text.split(/\r?\n/).filter((line) => /^(Authority|TeamIdentifier|Identifier)=/.test(line)); }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function isAlive(pid) { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch { return false; } }
function waitForExit(child, timeout) { if (child.exitCode !== null) return Promise.resolve(child.exitCode); return new Promise((resolveExit, reject) => { const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("App did not exit after clean-install smoke")); }, timeout); child.once("exit", (code) => { clearTimeout(timer); resolveExit(code); }); }); }
async function waitForJson(path, child, timeout, stderr) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { /* wait */ } if (child.exitCode !== null) throw new Error(`App exited before result (${child.exitCode})\n${stderr()}`); await new Promise((resolveDelay) => setTimeout(resolveDelay, 100)); } child.kill("SIGKILL"); throw new Error(`clean install timed out\n${stderr()}`); }
function freePort() { return new Promise((resolvePort, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close((error) => error ? reject(error) : resolvePort(port)); }); }); }
