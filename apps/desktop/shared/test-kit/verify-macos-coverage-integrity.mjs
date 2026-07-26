import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testKitRoot = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(testKitRoot, "../..");
const macosRoot = resolve(desktopRoot, "macos");
const acceptanceRoot = resolve(macosRoot, "build/acceptance");
const rawPath = resolve(acceptanceRoot, "coverage/raw/coverage-final.json");
const receiptPath = resolve(acceptanceRoot, "coverage/shared-business-summary.json");
const featureReceiptPath = resolve(acceptanceRoot, "feature-test-results.json");
const reportPath = resolve(acceptanceRoot, "macos-feature-acceptance.json");
const acceptanceVerifier = resolve(testKitRoot, "verify-macos-feature-acceptance.mjs");
const rawOriginal = readFileSync(rawPath);
const receiptOriginal = readFileSync(receiptPath);
const featureReceiptOriginal = readFileSync(featureReceiptPath);

function verifyAcceptance() {
  const result = spawnSync(process.execPath, [acceptanceVerifier], { cwd: macosRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(readFileSync(reportPath, "utf8"));
}

try {
  assert(verifyAcceptance().coverageReceipt, "fresh coverage evidence must be accepted");

  writeFileSync(rawPath, Buffer.concat([rawOriginal, Buffer.from("\n")]));
  const rawTampered = verifyAcceptance();
  assert.equal(rawTampered.coverageReceipt, null, "tampered raw c8 report must invalidate the coverage receipt");
  assert(rawTampered.features.every((feature) => feature.missingEvidence.includes("shared_business_coverage")));
  writeFileSync(rawPath, rawOriginal);

  const receipt = JSON.parse(receiptOriginal.toString("utf8"));
  receipt.scopes.sharedBusiness.sources = receipt.scopes.sharedBusiness.sources.slice(1);
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const scopeTampered = verifyAcceptance();
  assert.equal(scopeTampered.coverageReceipt, null, "a narrowed coverage scope must invalidate the coverage receipt");
  writeFileSync(receiptPath, receiptOriginal);

  const featureReceipt = JSON.parse(featureReceiptOriginal.toString("utf8"));
  featureReceipt.tests[0].aspects = ["positive", "negative", "authorization"];
  writeFileSync(featureReceiptPath, `${JSON.stringify(featureReceipt, null, 2)}\n`);
  const reboundCoverageReceipt = JSON.parse(receiptOriginal.toString("utf8"));
  reboundCoverageReceipt.integrity.featureTestReceiptSha256 = createHash("sha256").update(readFileSync(featureReceiptPath)).digest("hex");
  writeFileSync(receiptPath, `${JSON.stringify(reboundCoverageReceipt, null, 2)}\n`);
  const semanticTampered = verifyAcceptance();
  assert.equal(semanticTampered.featureTestReceipt, null, "tampered suite aspects must invalidate the feature receipt even when its outer hash is rebound");
  assert(semanticTampered.features.every((feature) => feature.testIds.includes(featureReceipt.tests[0].testId) ? feature.missingEvidence.includes(`test_result:${featureReceipt.tests[0].testId}`) : true));
} finally {
  writeFileSync(rawPath, rawOriginal);
  writeFileSync(receiptPath, receiptOriginal);
  writeFileSync(featureReceiptPath, featureReceiptOriginal);
}

assert(verifyAcceptance().coverageReceipt, "restored coverage evidence must be accepted");
console.log("macOS coverage receipt integrity passed (raw report hash, exact scope, suite semantics/source binding and fail-closed acceptance).");
