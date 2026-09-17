import { strict as assert } from "node:assert";
import { MACOS_PROMOTION_SEQUENCE, validateMacosPromotionReceipt } from "./update-promotion-policy.mjs";

const event = (name) => ({ name, passed: true, completedAt: "2026-07-25T00:00:00.000Z" });
const unsigned = { schemaVersion: 1, platform: "darwin-arm64", events: [event("build-once"), event("verify-assets")] };
assert.deepEqual(validateMacosPromotionReceipt(unsigned, { allowUnsigned: true }), {
  status: "distribution-ready",
  installVerified: false,
  productionPromotionBlocked: true,
});
assert.throws(() => validateMacosPromotionReceipt({ ...unsigned, events: [...unsigned.events, event("promote-stable-metadata")] }, { allowUnsigned: true }), /requires signed L6/);
assert.throws(() => validateMacosPromotionReceipt({ ...unsigned, events: [event("verify-assets"), event("build-once")] }, { allowUnsigned: true }), /out of order/);
assert.throws(() => validateMacosPromotionReceipt({ ...unsigned, events: [event("build-once"), event("build-once")] }, { allowUnsigned: true }), /must not be repeated/);
const complete = { schemaVersion: 1, platform: "darwin-arm64", events: MACOS_PROMOTION_SEQUENCE.map(event) };
assert.deepEqual(validateMacosPromotionReceipt(complete), {
  status: "production-promoted",
  installVerified: true,
  productionPromotionBlocked: false,
});
assert.throws(() => validateMacosPromotionReceipt({ ...complete, events: complete.events.slice(0, -1) }), /incomplete/);

console.log("macOS update promotion order verification passed; unsigned stable promotion is fail-closed.");
