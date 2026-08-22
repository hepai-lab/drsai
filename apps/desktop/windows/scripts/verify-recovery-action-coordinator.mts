import assert from "node:assert/strict";
import { executeRecoveryActionOnce } from "../../shared/renderer/src/recoveryActionCoordinator.ts";

const active = new Set<string>();
let calls = 0;
let release!: () => void;
const operation = () => new Promise<void>((resolve) => { calls += 1; release = resolve; });
const first = executeRecoveryActionOnce(active, "message-1:resync", operation);
const duplicate = await executeRecoveryActionOnce(active, "message-1:resync", operation);
assert.equal(duplicate, false); assert.equal(calls, 1, "double click must execute one recovery command");
release(); assert.equal(await first, true); assert.equal(active.size, 0);

await assert.rejects(() => executeRecoveryActionOnce(active, "message-1:repair", async () => {
  calls += 1; throw new DOMException("cancelled", "AbortError");
}), /cancelled/);
assert.equal(active.size, 0, "cancelled recovery must become actionable again");
assert.equal(await executeRecoveryActionOnce(active, "message-1:repair", async () => { calls += 1; }), true);
assert.equal(calls, 3);
console.log("P7 recovery action idempotency and post-cancellation retry verification passed.");
