import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { currentCommit } from "./acceptanceEvidence.mjs";
import { assertEvidenceFeatureCoverage } from "./platformFeatureEvidence.mjs";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptRoot, "../..");
const repoRoot = resolve(desktopRoot, "../..");
const acceptanceRoot = resolve(desktopRoot, "macos/build/acceptance");
const snapshot = JSON.parse(readFileSync(resolve(acceptanceRoot, "source-snapshot.json"), "utf8"));
assert.equal(snapshot.schemaVersion, 2);
assert.equal(snapshot.commit, currentCommit(repoRoot));
assert.match(snapshot.tree, /^[a-f0-9]{40}$/);
assert.match(snapshot.aggregateSha256, /^[a-f0-9]{64}$/);
assert.equal(snapshot.fileCount, snapshot.files.length);
assert.ok(Array.isArray(snapshot.deletedTracked));
const aggregate = createHash("sha256");
for (const file of snapshot.files) {
  assert.match(file.path, /^(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$)).+$/);
  const path = resolve(repoRoot, file.path);
  assert.ok(path.startsWith(`${repoRoot}${sep}`));
  const stat = lstatSync(path);
  const kind = stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : null;
  assert.equal(kind, file.kind, `${file.path} entry kind changed after source snapshot`);
  assert.ok(file.sourceState === "tracked" || file.sourceState === "untracked");
  const bytes = kind === "symlink" ? Buffer.from(readlinkSync(path), "utf8") : readFileSync(path);
  assert.equal(bytes.length, file.size, `${file.path} size changed after source snapshot`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha256, file.sha256, `${file.path} changed after source snapshot`);
  aggregate.update(file.path).update("\0").update(kind).update("\0").update(sha256).update("\0");
}
for (const path of snapshot.deletedTracked) {
  assert.match(path, /^(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$)).+$/);
  const deletedPath = resolve(repoRoot, path);
  assert.ok(deletedPath.startsWith(`${repoRoot}${sep}`));
  assert.equal(existsSync(deletedPath), false, `${path} is declared deleted but exists`);
  aggregate.update(path).update("\0deleted\0\0");
}
assert.equal(aggregate.digest("hex"), snapshot.aggregateSha256);

const evidencePath = resolve(acceptanceRoot, "macos-l4-evidence.json");
if (!existsSync(evidencePath)) {
  if (process.argv.includes("--require-l4")) throw new Error("macOS L4 evidence is missing");
  console.log(`macOS source evidence passed: clean=${snapshot.clean}; L4 evidence not present.`);
  process.exit(0);
}
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
assert.equal(evidence.schemaVersion, 2);
assert.equal(evidence.level, "L4");
assert.equal(evidence.commit, snapshot.commit);
assert.equal(evidence.sourceTree, snapshot.tree);
assert.equal(evidence.sourceAggregateSha256, snapshot.aggregateSha256);
assert.equal(evidence.platform, "darwin-arm64");
assert.equal(evidence.passed, true);
assertEvidenceFeatureCoverage(evidence);
assert.deepEqual(evidence.tests.map((test) => test.testId).sort(), ["packaged-smoke", "runtime-reproducibility"]);
assert.ok(evidence.tests.every((test) => test.passed === true));
assert.ok(Array.isArray(evidence.artifacts) && evidence.artifacts.length >= 2);
for (const artifact of evidence.artifacts) {
  const path = resolve(desktopRoot, artifact.path);
  assert.ok(path.startsWith(`${desktopRoot}${sep}`) && existsSync(path));
  const bytes = readFileSync(path);
  assert.equal(bytes.length, artifact.size);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
}
console.log(`macOS L4 evidence passed: commit=${evidence.commit}, source=${evidence.sourceAggregateSha256}, artifacts=${evidence.artifacts.length}.`);

let previous = evidence;
for (const [level, requiredTests] of [
  ["L5", ["packaged-core-journeys", "packaged-product-journeys", "restart-stability", "fault-injection"]],
  ["L6", ["codesign-strict", "gatekeeper", "notarization-staple", "clean-install", "signed-update-rollback", "tcc-real-device"]],
]) {
  const path = resolve(acceptanceRoot, `macos-${level.toLowerCase()}-evidence.json`);
  if (!existsSync(path)) {
    if (process.argv.includes(`--require-${level.toLowerCase()}`)) throw new Error(`macOS ${level} evidence is missing`);
    continue;
  }
  const next = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(next.schemaVersion, 2);
  assert.equal(next.level, level);
  assert.equal(next.commit, snapshot.commit);
  assert.equal(next.sourceTree, snapshot.tree);
  assert.equal(next.sourceAggregateSha256, snapshot.aggregateSha256);
  assert.equal(next.platform, "darwin-arm64");
  assert.equal(next.passed, true);
  assertEvidenceFeatureCoverage(next);
  assert.equal(next.previousLevelEvidenceSha256, createHash("sha256").update(JSON.stringify(previous)).digest("hex"));
  assert.deepEqual(next.tests.map((test) => test.testId).sort(), [...requiredTests].sort(), `${level} test set must be exact`);
  for (const testId of requiredTests) assert.ok(next.tests.some((test) => test.testId === testId && test.passed === true), `${level} missing ${testId}`);
  assert.ok(Array.isArray(next.artifacts) && next.artifacts.length > 0);
  for (const artifact of next.artifacts) {
    assert.match(artifact.path, /^(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$)).+$/);
    const artifactPath = resolve(desktopRoot, artifact.path);
    assert.ok(artifactPath.startsWith(`${desktopRoot}${sep}`) && existsSync(artifactPath));
    const bytes = readFileSync(artifactPath);
    assert.equal(bytes.length, artifact.size, `${level} artifact size changed: ${artifact.path}`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256, `${level} artifact hash changed: ${artifact.path}`);
  }
  if (level === "L5") {
    const restart = readArtifactReceipt(next, "restart-stability");
    assert.ok(restart.restartIterations >= 100);
    assert.ok(restart.stabilityDurationMs >= 7_200_000);
    assert.equal(restart.unhandledErrors, 0);
  }
  if (level === "L6") {
    const cleanInstall = readArtifactReceipt(next, "clean-install");
    assert.equal(cleanInstall.appRemoved, true);
    assert.equal(cleanInstall.userDataPreserved, true);
    const signed = readArtifactReceipt(next, "signed-update-rollback");
    assert.equal(signed.onlineUpdateInstalled, true);
    assert.equal(signed.healthConfirmed, true);
    assert.equal(signed.rollbackRestoredPrevious, true);
    assert.equal(signed.userDataPreserved, true);
    const tcc = readArtifactReceipt(next, "tcc-real-device");
    assert.ok(["granted", "denied", "restricted"].includes(tcc.microphoneState));
    assert.ok(["granted", "denied"].includes(tcc.automationState));
    assert.equal(tcc.notificationVisiblyConfirmed, true);
  }
  previous = next;
  console.log(`macOS ${level} evidence passed: tests=${next.tests.length}, artifacts=${next.artifacts.length}.`);
}

function readArtifactReceipt(evidence, testId) {
  const artifact = evidence.artifacts.find((item) => item.path.endsWith(`/build/acceptance/${testId}.json`));
  assert.ok(artifact, `${evidence.level} missing receipt artifact ${testId}`);
  const receipt = JSON.parse(readFileSync(resolve(desktopRoot, artifact.path), "utf8"));
  assert.equal(receipt.testId, testId);
  assert.equal(receipt.passed, true);
  return receipt;
}
