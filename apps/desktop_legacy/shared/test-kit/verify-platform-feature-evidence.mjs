import { strict as assert } from "node:assert";
import { assertEvidenceFeatureCoverage, featureIdsFromTests, normalizedFeatureIds } from "./platformFeatureEvidence.mjs";

assert.deepEqual(normalizedFeatureIds(["F12.2", "F04.1"]), ["F04.1", "F12.2"]);
assert.deepEqual(featureIdsFromTests([{ testId: "one", featureIds: ["F04.1"] }, { testId: "two", featureIds: ["F04.1", "F12.2"] }]), ["F04.1", "F12.2"]);
assert.deepEqual(assertEvidenceFeatureCoverage({ level: "L5", featureIds: ["F04.1", "F12.2"], tests: [{ testId: "one", featureIds: ["F04.1"] }, { testId: "two", featureIds: ["F12.2"] }] }), ["F04.1", "F12.2"]);
for (const invalid of [
  { level: "L5", featureIds: [], tests: [] },
  { level: "L5", featureIds: ["F04.1", "F04.1"], tests: [{ testId: "one", featureIds: ["F04.1"] }] },
  { level: "L5", featureIds: ["F99.1"], tests: [{ testId: "one", featureIds: ["F99.1"] }] },
  { level: "L5", featureIds: ["F04.1", "F04.2"], tests: [{ testId: "one", featureIds: ["F04.1"] }] },
]) assert.throws(() => assertEvidenceFeatureCoverage(invalid), /feature|invalid|union/i);

console.log("Per-feature macOS platform evidence schema verification passed.");
