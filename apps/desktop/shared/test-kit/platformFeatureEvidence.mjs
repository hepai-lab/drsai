import { strict as assert } from "node:assert";
import { macosFeatureModules } from "./macosFeatureCatalog.mjs";

const FEATURE_ID = /^F(?:0[1-9]|1[0-2])\.[1-6]$/;

export function normalizedFeatureIds(value, label = "platform evidence") {
  assert.ok(Array.isArray(value) && value.length > 0, `${label} featureIds are missing`);
  assert.equal(new Set(value).size, value.length, `${label} featureIds contain duplicates`);
  for (const id of value) assert.match(id, FEATURE_ID, `${label} contains an invalid feature id`);
  return [...value].sort();
}

export function featureIdsFromTests(tests, label = "platform evidence") {
  assert.ok(Array.isArray(tests) && tests.length > 0, `${label} tests are missing`);
  return [...new Set(tests.flatMap((test) => normalizedFeatureIds(test.featureIds, `${label}/${test.testId ?? "unknown"}`)))].sort();
}

export function assertEvidenceFeatureCoverage(evidence) {
  const declared = normalizedFeatureIds(evidence.featureIds, evidence.level ?? "platform evidence");
  const observed = featureIdsFromTests(evidence.tests, evidence.level ?? "platform evidence");
  assert.deepEqual(declared, observed, `${evidence.level ?? "platform evidence"} feature coverage must equal its test receipt union`);
  return declared;
}

export function catalogLevelReceipt(level, featureTestReport) {
  assert.equal(featureTestReport?.schemaVersion, 1, `${level} requires feature test evidence`);
  assert.equal(featureTestReport.passed, true, `${level} requires passing feature tests`);
  const passed = new Set(featureTestReport.tests?.filter((test) => test.passed === true && test.skipped === false).map((test) => test.testId));
  const featureIds = [];
  for (let moduleIndex = 0; moduleIndex < macosFeatureModules.length; moduleIndex += 1) {
    const module = macosFeatureModules[moduleIndex];
    if (!module.requiredLevels.includes(level)) continue;
    for (let featureIndex = 0; featureIndex < module.features.length; featureIndex += 1) {
      const feature = module.features[featureIndex];
      assert.ok(feature.testIds.every((testId) => passed.has(testId)), `${level} feature catalog tests are incomplete`);
      featureIds.push(`F${String(moduleIndex + 1).padStart(2, "0")}.${featureIndex + 1}`);
    }
  }
  return { testId: `catalog-${level.toLowerCase()}-feature-suites`, passed: true, featureIds: featureIds.sort(), generatedAt: featureTestReport.generatedAt };
}
