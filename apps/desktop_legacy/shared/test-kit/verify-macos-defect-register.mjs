import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentCommit, worktreeFingerprint } from "./acceptanceEvidence.mjs";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptRoot, "../..");
const repoRoot = resolve(desktopRoot, "../..");
const registerPath = resolve(desktopRoot, "macos/docs/macos-defect-register.json");
const outputPath = resolve(desktopRoot, "macos/build/acceptance/p0-p1-defects.json");
const register = JSON.parse(readFileSync(registerPath, "utf8"));
const packageJson = JSON.parse(readFileSync(resolve(desktopRoot, "macos/package.json"), "utf8"));

assert.equal(register.schemaVersion, 1);
assert.equal(register.product, "opendrsai-macos-desktop");
assert.match(register.owner, /^[a-z][a-z-]+$/);
assert.ok(!Number.isNaN(Date.parse(register.reviewedAt)), "defect register reviewedAt is invalid");
assert.deepEqual(register.policy.releaseBlockingSeverities, ["P0", "P1"]);
assert.ok(Array.isArray(register.defects));
assert.ok(Array.isArray(register.exceptions));
const ids = new Set();
const blocking = [];
for (const defect of register.defects) {
  assert.match(defect.id, /^MAC-DESKTOP-P[0-3]-\d{3}$/);
  assert.ok(!ids.has(defect.id), `duplicate defect id: ${defect.id}`);
  ids.add(defect.id);
  assert.ok(["P0", "P1", "P2", "P3"].includes(defect.severity));
  assert.ok(register.policy.allowedStatuses.includes(defect.status));
  assert.ok(defect.title && defect.owner && !Number.isNaN(Date.parse(defect.discoveredAt)));
  assert.ok(Array.isArray(defect.featureIds) && defect.featureIds.length > 0);
  for (const featureId of defect.featureIds) assert.match(featureId, /^F(?:0[1-9]|1[0-2])\.[1-6]$/);
  if (["resolved", "verified"].includes(defect.status)) {
    assert.ok(defect.resolution && !Number.isNaN(Date.parse(defect.resolvedAt)), `${defect.id} lacks resolution evidence`);
    assert.ok(Array.isArray(defect.verificationTestIds) && defect.verificationTestIds.length > 0);
    for (const testId of defect.verificationTestIds) assert.ok(packageJson.scripts[testId], `${defect.id} references missing test ${testId}`);
  }
  if (defect.status === "wont_fix") {
    assert.ok(register.exceptions.some((entry) => entry.defectId === defect.id), `${defect.id} requires a reviewed exception`);
  }
  if (["P0", "P1"].includes(defect.severity) && !["resolved", "verified"].includes(defect.status)) blocking.push(defect.id);
}
for (const exception of register.exceptions) {
  assert.ok(ids.has(exception.defectId), `exception references unknown defect ${exception.defectId}`);
  assert.ok(exception.approvedBy && exception.rationale && !Number.isNaN(Date.parse(exception.expiresAt)));
  assert.ok(Date.parse(exception.expiresAt) > Date.now(), `exception expired for ${exception.defectId}`);
}

const report = {
  schemaVersion: 1,
  commit: currentCommit(repoRoot),
  worktreeFingerprint: worktreeFingerprint(repoRoot),
  generatedAt: new Date().toISOString(),
  registerReviewedAt: register.reviewedAt,
  totalDefects: register.defects.length,
  openP0P1: blocking.length,
  blockingDefectIds: blocking,
  verifiedDefectIds: register.defects.filter((defect) => defect.status === "verified").map((defect) => defect.id),
  passed: blocking.length === 0,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
assert.equal(blocking.length, 0, `open P0/P1 defects block acceptance: ${blocking.join(", ")}`);
console.log(`macOS defect register passed: total=${register.defects.length}, open P0/P1=${blocking.length}, verified=${report.verifiedDefectIds.length}.`);
console.log(`Defect evidence written: ${outputPath}`);
