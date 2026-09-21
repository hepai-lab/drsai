export const MACOS_PROMOTION_SEQUENCE = [
  "build-once",
  "verify-assets",
  "signed-l6",
  "upload-oss-versioned-assets",
  "verify-cdn-assets",
  "stage-temporary-feed",
  "verify-online-update",
  "promote-stable-metadata",
  "verify-production-assets",
];

export function validateMacosPromotionReceipt(receipt, { allowUnsigned = false } = {}) {
  if (!receipt || receipt.schemaVersion !== 1 || receipt.platform !== "darwin-arm64") throw new Error("Invalid macOS promotion receipt.");
  const events = Array.isArray(receipt.events) ? receipt.events : [];
  const names = events.map((event) => event.name);
  if (new Set(names).size !== names.length) throw new Error("Promotion events must not be repeated.");
  let previous = -1;
  for (const name of names) {
    const index = MACOS_PROMOTION_SEQUENCE.indexOf(name);
    if (index < 0) throw new Error(`Unknown promotion event: ${name}`);
    if (index <= previous) throw new Error(`Promotion event is out of order: ${name}`);
    previous = index;
  }
  for (const event of events) if (event.passed !== true) throw new Error(`Promotion event did not pass: ${event.name}`);
  const stableIndex = names.indexOf("promote-stable-metadata");
  const signedIndex = names.indexOf("signed-l6");
  if (stableIndex >= 0 && signedIndex < 0) throw new Error("Stable metadata promotion requires signed L6 evidence.");
  if (stableIndex >= 0) {
    for (const required of MACOS_PROMOTION_SEQUENCE.slice(0, stableIndex)) {
      if (!names.includes(required)) throw new Error(`Stable metadata promotion is missing prerequisite: ${required}`);
    }
  }
  if (allowUnsigned) {
    if (signedIndex >= 0 || stableIndex >= 0) throw new Error("Unsigned verification must not claim signed L6 or stable promotion.");
    return { status: "distribution-ready", installVerified: false, productionPromotionBlocked: true };
  }
  if (names.length !== MACOS_PROMOTION_SEQUENCE.length) throw new Error("Production promotion receipt is incomplete.");
  return { status: "production-promoted", installVerified: true, productionPromotionBlocked: false };
}
