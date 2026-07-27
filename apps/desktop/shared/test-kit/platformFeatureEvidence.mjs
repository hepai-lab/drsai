import { strict as assert } from "node:assert";

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
