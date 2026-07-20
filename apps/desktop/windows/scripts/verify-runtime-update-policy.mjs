import assert from "node:assert/strict";
import { resolveMinimumUpdaterVersion, updaterPolicy } from "./runtime-update-policy.mjs";

const DIRECT_UPDATE_BASELINE = "1.4.9";

assert.equal(
  updaterPolicy.minimumSafeUpdaterVersion,
  DIRECT_UPDATE_BASELINE,
  `The direct-update baseline must remain ${DIRECT_UPDATE_BASELINE} unless a reviewed compatibility migration is provided.`,
);
assert.equal(resolveMinimumUpdaterVersion(), DIRECT_UPDATE_BASELINE);
assert.equal(resolveMinimumUpdaterVersion(DIRECT_UPDATE_BASELINE), DIRECT_UPDATE_BASELINE);
assert.throws(
  () => resolveMinimumUpdaterVersion("1.4.8"),
  /must remain at the direct-update baseline/,
  "A release must not claim compatibility with an unsafe updater.",
);
assert.throws(
  () => resolveMinimumUpdaterVersion("1.5.0"),
  /must remain at the direct-update baseline/,
  "A release must not silently strand supported 1.4.9 users.",
);

console.log(`Runtime update policy passed: OpenDrSai ${DIRECT_UPDATE_BASELINE}+ can update directly to the latest release.`);
