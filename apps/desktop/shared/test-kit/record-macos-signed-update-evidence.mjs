import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Signed update evidence must be recorded on Apple Silicon macOS.");
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const root = resolve(desktopRoot, "macos");
const acceptance = resolve(root, "build/acceptance");
const rehearsal = read("signed-update-rollback-rehearsal.json");
const online = read("online-signed-update.json");
assert.equal(rehearsal.testId, "signed-update-rollback-rehearsal");
assert.equal(rehearsal.passed, true);
assert.equal(rehearsal.rollbackRestoredPrevious, true);
assert.equal(rehearsal.userDataPreserved, true);
assert.equal(rehearsal.onlineUpdateInstalled, false);
assert.equal(online.schemaVersion, 1);
assert.equal(online.testId, "online-signed-update");
assert.equal(online.platform, "darwin-arm64");
assert.equal(online.passed, true);
assert.equal(online.onlineUpdateInstalled, true);
assert.equal(online.healthConfirmed, true);
assert.equal(online.userDataPreserved, true);
assert.equal(online.fromVersion, rehearsal.previousVersion);
assert.equal(online.toVersion, rehearsal.currentVersion);
assert.match(online.feedUrl, /^https:\/\//);
const executable = resolve(root, "release/mac-arm64/OpenDrSai.app/Contents/MacOS/OpenDrSai");
assert.ok(existsSync(executable));
const appSha256 = createHash("sha256").update(readFileSync(executable)).digest("hex");
assert.equal(online.installedAppExecutableSha256, appSha256);
writeFileSync(resolve(acceptance, "signed-update-rollback.json"), `${JSON.stringify({
  schemaVersion: 2,
  testId: "signed-update-rollback",
  platform: "darwin-arm64",
  passed: true,
  featureIds: ["F12.5", "F12.6"],
  fromVersion: online.fromVersion,
  toVersion: online.toVersion,
  feedUrl: online.feedUrl,
  onlineUpdateInstalled: true,
  healthConfirmed: true,
  rollbackRestoredPrevious: true,
  userDataPreserved: true,
  installedAppExecutableSha256: appSha256,
  onlineReceiptSha256: hash(online),
  rollbackReceiptSha256: hash(rehearsal),
  generatedAt: new Date().toISOString(),
}, null, 2)}\n`, "utf8");
console.log(`macOS signed online update + rollback evidence recorded: ${online.fromVersion} -> ${online.toVersion}.`);

function read(name) { const path = resolve(acceptance, name); assert.ok(existsSync(path), `missing ${name}`); return JSON.parse(readFileSync(path, "utf8")); }
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
