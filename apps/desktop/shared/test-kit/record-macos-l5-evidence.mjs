import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentCommit } from "./acceptanceEvidence.mjs";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("L5 evidence must be recorded on Apple Silicon macOS.");
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptRoot, "../..");
const repoRoot = resolve(desktopRoot, "../..");
const acceptance = resolve(desktopRoot, "macos/build/acceptance");
const snapshot = readJson(resolve(acceptance, "source-snapshot.json"));
const l4 = readJson(resolve(acceptance, "macos-l4-evidence.json"));
assert.equal(snapshot.clean, true, "L5 evidence requires a clean reviewed source snapshot");
assert.equal(snapshot.commit, currentCommit(repoRoot));
assert.equal(l4.passed, true);
assert.equal(l4.commit, snapshot.commit);

const testIds = ["packaged-core-journeys", "packaged-product-journeys", "restart-stability", "fault-injection"];
const receipts = testIds.map((testId) => {
  const path = resolve(acceptance, `${testId}.json`);
  const receipt = readJson(path);
  assert.equal(receipt.schemaVersion, 2);
  assert.equal(receipt.testId, testId);
  assert.equal(receipt.platform, "darwin-arm64");
  assert.equal(receipt.passed, true);
  return { path, receipt };
});
const core = receipts.find(({ receipt }) => receipt.testId === "packaged-core-journeys").receipt;
assert.ok(core.checks >= 4 && core.gatewayOrphans === 0 && core.ptyOrphans === 0);
const product = receipts.find(({ receipt }) => receipt.testId === "packaged-product-journeys").receipt;
assert.ok(product.checks >= 17 && product.unexpectedSideEffects === 0);
const stability = receipts.find(({ receipt }) => receipt.testId === "restart-stability").receipt;
assert.ok(stability.restartIterations >= 100, "L5 requires at least 100 complete App restarts");
assert.ok(stability.forcedCrashes >= 1 && stability.recoveredCrashes === stability.forcedCrashes);
assert.equal(stability.approvalRecoveredAfterCrash, true);
assert.equal(stability.recoveredApprovalRejected, true);
assert.equal(stability.rejectedApprovalCommits, 0);
assert.equal(stability.rejectedChangeRemainedStaged, true);
assert.ok(stability.stabilityDurationMs >= 7_200_000, "L5 requires a two-hour stability soak");
assert.equal(stability.unhandledErrors, 0);
const faults = receipts.find(({ receipt }) => receipt.testId === "fault-injection").receipt;
assert.deepEqual([...faults.injections].sort(), ["unregistered-workspace", "unsafe-url", "workspace-traversal"]);
assert.equal(faults.unexpectedSideEffects, 0);
const appExecutable = resolve(desktopRoot, "macos/release/mac-arm64/OpenDrSai.app/Contents/MacOS/OpenDrSai");
assert.ok(existsSync(appExecutable), "packaged App executable is missing");
const artifacts = [...receipts.map(({ path }) => artifact(path)), artifact(appExecutable)];
const featureIds = verifiedFeatureIds(receipts.map(({ receipt }) => receipt));
const evidence = {
  schemaVersion: 2,
  level: "L5",
  commit: snapshot.commit,
  sourceTree: snapshot.tree,
  sourceAggregateSha256: snapshot.aggregateSha256,
  platform: "darwin-arm64",
  passed: true,
  featureIds,
  previousLevelEvidenceSha256: sha256(Buffer.from(JSON.stringify(l4))),
  tests: receipts.map(({ receipt }) => ({ testId: receipt.testId, passed: true, featureIds: receipt.featureIds, generatedAt: receipt.generatedAt })),
  artifacts,
  generatedAt: new Date().toISOString(),
};
writeFileSync(resolve(acceptance, "macos-l5-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`macOS L5 evidence recorded: tests=${evidence.tests.length}, artifacts=${artifacts.length}.`);

function readJson(path) { assert.ok(existsSync(path), `missing evidence: ${path}`); return JSON.parse(readFileSync(path, "utf8")); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function artifact(path) {
  const bytes = readFileSync(path);
  return { path: relative(desktopRoot, path).replaceAll("\\", "/"), size: statSync(path).size, sha256: sha256(bytes) };
}
function verifiedFeatureIds(values) { const ids = [...new Set(values.flatMap((item) => item.featureIds ?? []))].sort(); assert.ok(ids.length > 0 && ids.every((id) => /^F(?:0[1-9]|1[0-2])\.[1-6]$/.test(id)), "L5 receipts require valid featureIds"); return ids; }
