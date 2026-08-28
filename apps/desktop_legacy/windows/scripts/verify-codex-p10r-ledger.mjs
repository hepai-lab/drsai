import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const ledger = JSON.parse(readFileSync(resolve(root, "docs/remote_workespace/codex-adapter-p10r-feature-ledger.json"), "utf8"));
const evidencePath = resolve(root, ".artifacts/codex-p10r/acceptance.json");
assert.equal(ledger.total, 48);
assert.equal(Object.keys(ledger.features).length, 48);
assert(existsSync(evidencePath));
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
assert.equal(evidence.executed, true);
assert.equal(evidence.status, 0);
for (const [id, row] of Object.entries(ledger.features)) {
  assert.match(id, /^M0[1-8]-F0[1-6]$/);
  assert.equal(row.status, "passed");
  assert(evidence.assertions.some((assertion) => assertion.feature === id && assertion.passed === true));
}
assert.equal(ledger.sourceDigest, evidence.sourceDigest);
const oldLedger = JSON.parse(readFileSync(resolve(root, "docs/remote_workespace/codex-adapter-p10-feature-ledger.json"), "utf8"));
assert.equal(oldLedger.status, "historical_superseded");
console.log(JSON.stringify({ passed: true, total: 48, sourceDigest: ledger.sourceDigest, evidenceDigest: createHash("sha256").update(readFileSync(evidencePath)).digest("hex") }));
