import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, ".."); const workspaceRoot = resolve(root, "../../..");
const statusPath = resolve(process.argv[2] ?? resolve(root, "release/duplex-voice/p2-acceptance-status.json"));
const indexPath = resolve(process.argv[3] ?? resolve(workspaceRoot, "docs/voice/duplex-voice-p2-evidence-index.json"));
const indexBytes = readFileSync(indexPath); const status = JSON.parse(readFileSync(statusPath, "utf8"));
const { integrity, ...payload } = status; assert.equal(integrity?.algorithm, "sha256"); assert.equal(integrity?.digest, createHash("sha256").update(JSON.stringify(payload)).digest("hex"), "Acceptance status integrity mismatch.");
assert.equal(status.schemaVersion, 1); assert.equal(status.sourceIndexSha256, createHash("sha256").update(indexBytes).digest("hex"), "Acceptance status was generated from a stale evidence index.");
assert.deepEqual(status.counts, { total: 52, implemented: 52, strictAccepted: 52 }, "All 52 P2 features must be strictly accepted.");
assert.deepEqual(status.evidenceStatus, { automation: true, packaged_named_review: true, live_named_listening: true, hardware_physical: true, stable_release_cycle: true });
assert.equal(status.evidenceProvenance?.automation?.sourceIndexSha256, status.sourceIndexSha256);
assert.match(status.evidenceProvenance?.automation?.reportSha256 ?? "", /^[a-f0-9]{64}$/); assert.ok(status.evidenceProvenance?.automation?.reportPath && Number.isFinite(Date.parse(status.evidenceProvenance?.automation?.completedAt)) && status.evidenceProvenance?.automation?.source?.fileCount > 0);
for (const kind of ["packaged_named_review", "live_named_listening", "hardware_physical", "stable_release_cycle"]) {
  const source = status.evidenceProvenance?.[kind]; assert.match(source?.reportSha256 ?? "", /^[a-f0-9]{64}$/); assert.ok(source?.reportPath && source?.signer?.trim()?.length >= 2 && Number.isFinite(Date.parse(source?.signedAt)));
}
assert.equal(status.features.length, 52); assert.equal(new Set(status.features.map(({ id }) => id)).size, 52);
for (const feature of status.features) { assert.equal(feature.strictAcceptance, "accepted", `${feature.id} remains pending.`); assert.deepEqual(feature.missingEvidence, []); assert.ok(Object.values(feature.evidence).every(Boolean)); assert.ok(Object.values(feature.evidenceSources).every(Boolean)); }
console.log("Duplex Voice P2 strict acceptance passed (52/52, all evidence classes complete). ");
