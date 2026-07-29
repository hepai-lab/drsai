import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentCommit } from "./acceptanceEvidence.mjs";
import { catalogLevelReceipt } from "./platformFeatureEvidence.mjs";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("L6 evidence must be recorded on Apple Silicon macOS.");
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(desktopRoot, "../..");
const acceptance = resolve(desktopRoot, "macos/build/acceptance");
const snapshot = readJson("source-snapshot.json");
const l5 = readJson("macos-l5-evidence.json");
assert.equal(snapshot.clean, true);
assert.equal(snapshot.commit, currentCommit(repoRoot));
assert.equal(l5.level, "L5");
assert.equal(l5.passed, true);
assert.equal(l5.commit, snapshot.commit);
const testIds = ["codesign-strict", "gatekeeper", "notarization-staple", "clean-install", "signed-update-rollback", "tcc-real-device"];
const receipts = testIds.map((testId) => {
  const path = resolve(acceptance, `${testId}.json`);
  const receipt = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(receipt.schemaVersion, 2);
  assert.equal(receipt.testId, testId);
  assert.equal(receipt.platform, "darwin-arm64");
  assert.equal(receipt.passed, true);
  return { path, receipt };
});
const catalog = catalogLevelReceipt("L6", readJson("feature-test-results.json"));
const signed = receipts.find(({ receipt }) => receipt.testId === "signed-update-rollback").receipt;
assert.equal(signed.onlineUpdateInstalled, true);
assert.equal(signed.healthConfirmed, true);
assert.equal(signed.rollbackRestoredPrevious, true);
assert.equal(signed.userDataPreserved, true);
const cleanInstall = receipts.find(({ receipt }) => receipt.testId === "clean-install").receipt;
assert.equal(cleanInstall.runtimeInstalled, true);
assert.equal(cleanInstall.appRemoved, true);
assert.equal(cleanInstall.userDataPreserved, true);
const tcc = receipts.find(({ receipt }) => receipt.testId === "tcc-real-device").receipt;
assert.ok(["granted", "denied", "restricted"].includes(tcc.microphoneState));
assert.ok(["granted", "denied"].includes(tcc.automationState));
assert.equal(tcc.notificationVisiblyConfirmed, true);
assert.equal(tcc.filesSettingsOpened, true);
const evidence = {
  schemaVersion: 2,
  level: "L6",
  commit: snapshot.commit,
  sourceTree: snapshot.tree,
  sourceAggregateSha256: snapshot.aggregateSha256,
  platform: "darwin-arm64",
  passed: true,
  featureIds: verifiedFeatureIds([...receipts.map(({ receipt }) => receipt), catalog]),
  previousLevelEvidenceSha256: hash(l5),
  tests: [...receipts.map(({ receipt }) => ({ testId: receipt.testId, passed: true, featureIds: receipt.featureIds, generatedAt: receipt.generatedAt })), catalog],
  artifacts: receipts.map(({ path }) => artifact(path)),
  generatedAt: new Date().toISOString(),
};
writeFileSync(resolve(acceptance, "macos-l6-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`macOS L6 evidence recorded: tests=${evidence.tests.length}, artifacts=${evidence.artifacts.length}.`);

function readJson(name) { const path = resolve(acceptance, name); assert.ok(existsSync(path), `missing ${name}`); return JSON.parse(readFileSync(path, "utf8")); }
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function artifact(path) { const bytes = readFileSync(path); return { path: relative(desktopRoot, path).replaceAll("\\", "/"), size: statSync(path).size, sha256: createHash("sha256").update(bytes).digest("hex") }; }
function verifiedFeatureIds(values) { const ids = [...new Set(values.flatMap((item) => item.featureIds ?? []))].sort(); assert.ok(ids.length > 0 && ids.every((id) => /^F(?:0[1-9]|1[0-2])\.[1-6]$/.test(id)), "L6 receipts require valid featureIds"); return ids; }
