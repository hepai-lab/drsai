import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const ledgerPath = resolve(repoRoot, "docs/desktop/evidence/agent-runtime-traceability-phase4-acceptance-ledger.json");
const visualPath = resolve(repoRoot, "docs/desktop/evidence/agent-runtime-traceability-phase4-windows-e2e-result.json");
const livePath = resolve(repoRoot, "docs/desktop/evidence/agent-runtime-traceability-phase3-live-model-result.json");
const allowExternalPending = process.argv.includes("--allow-external-pending");
const expected = [
  ...Array.from({ length: 4 }, (_, index) => `M40-0${index + 1}`),
  ...Array.from({ length: 4 }, (_, index) => `M41-0${index + 1}`),
  ...Array.from({ length: 4 }, (_, index) => `M42-0${index + 1}`),
  ...Array.from({ length: 4 }, (_, index) => `M43-0${index + 1}`),
  ...Array.from({ length: 4 }, (_, index) => `M44-0${index + 1}`),
];

assert(existsSync(ledgerPath), "Phase 4 acceptance ledger is missing.");
assert(existsSync(visualPath), "Phase 4 GUI evidence is missing.");
assert(existsSync(livePath), "Phase 3/P4 live-model evidence is missing.");
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const visual = JSON.parse(readFileSync(visualPath, "utf8"));
const live = JSON.parse(readFileSync(livePath, "utf8"));
assert.equal(ledger.schema_version, "opendrsai.agent-runtime-phase4-acceptance-ledger/1");
assert.equal(ledger.total, 20);
assert.deepEqual(ledger.features.map((feature) => feature.id).sort(), expected.sort());
assert.equal(new Set(ledger.features.map((feature) => feature.id)).size, 20);
for (const feature of ledger.features) {
  assert(["passed", "external_pending"].includes(feature.status), `${feature.id}: invalid status`);
  assert(Array.isArray(feature.evidence) && feature.evidence.length, `${feature.id}: evidence is missing`);
}
assert.equal(visual.schema_version, "opendrsai.agent-runtime-phase4-windows-e2e-result/1");
assert.equal(visual.passed, true);
assert(visual.checks.includes("append_only_evaluation_revision"));
assert(visual.checks.includes("focused_evidence_navigation"));
assert(visual.checks.includes("executed_comparison_recovery"));
assert(visual.checks.includes("draft_discard_lifecycle"));

const accepted = ledger.features.filter((feature) => feature.status === "passed").length;
assert.equal(ledger.accepted, accepted);
assert.equal(ledger.progress_percent, accepted * 5);
const livePassed = live.schema_version === "opendrsai.agent-runtime-phase3-live-model-result/1"
  && Array.isArray(live.cases) && live.cases.length === 5;
if (!allowExternalPending) {
  assert.equal(accepted, 20, `Phase 4 release is ${accepted}/20; external live-model acceptance is still pending.`);
  assert.equal(livePassed, true, "Five-case real OIDC/model evidence is not valid.");
  assert.equal(ledger.release_ready, true);
} else {
  assert(accepted >= 19, `Phase 4 implementation acceptance regressed to ${accepted}/20.`);
  if (!livePassed) assert.equal(ledger.features.find((feature) => feature.id === "M44-04")?.status, "external_pending");
}

console.log(`Phase 4 acceptance ledger validated: ${accepted}/20 (${accepted * 5}%), live=${livePassed ? "passed" : "external_pending"}.`);
