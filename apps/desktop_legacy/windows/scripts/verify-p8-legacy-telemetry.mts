import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLegacyDeletionDecisionReport, LegacyProtocolTelemetry, legacyProtocolCanRetire } from "../../shared/main/legacyProtocolTelemetry.ts";

const directory = mkdtempSync(join(tmpdir(), "opendrsai-legacy-telemetry-"));
const persistencePath = join(directory, "legacy.json");
const legacyProtocolTelemetry = new LegacyProtocolTelemetry(persistencePath);
for (let index = 0; index < 10_000; index += 1) {
  legacyProtocolTelemetry.record("conversation/1", `fallback-${index} token=secret-canary`, "1.5.3");
}
const rows = legacyProtocolTelemetry.snapshot();
assert.equal(rows.length, 1, "unknown fallback reasons must collapse to a bounded non-content dimension");
assert.equal(JSON.stringify(rows).includes("secret-canary"), false, "telemetry must redact secret-shaped values");
const restored = new LegacyProtocolTelemetry(persistencePath).snapshot();
assert.deepEqual(restored, rows, "content-free aggregates must survive process restart");
const versionBound = new LegacyProtocolTelemetry();
for (let index = 0; index < 1_000; index += 1) {
  versionBound.record("conversation/1", "oaep_unavailable", `0.${index}`);
}
assert.equal(versionBound.snapshot().length, 128, "version cardinality must remain bounded");
assert.equal(legacyProtocolCanRetire([
  { version: "1.5.3", legacyUses: 0, supportedRuntimeRequiresLegacy: false },
]), true);
assert.equal(legacyProtocolCanRetire([
  { version: "1.5.2", legacyUses: 0, supportedRuntimeRequiresLegacy: false },
  { version: "1.5.3", legacyUses: 1, supportedRuntimeRequiresLegacy: false },
]), false);
const decisionRows = new LegacyProtocolTelemetry();
for (let index = 0; index < 999; index += 1) decisionRows.record("oaep", "capability_selection", "1.6.0");
decisionRows.record("conversation/1", "oaep_unavailable", "1.5.3");
const blocked = buildLegacyDeletionDecisionReport(decisionRows.snapshot(), {
  releaseCycles: 2, observationDays: 14, migrationRatio: 1, rollbackArtifactVerified: true,
});
assert.equal(blocked.totals.selections, 1000);
assert.equal(blocked.ratios.oaep, 0.999);
assert.equal(blocked.eligible, false, "legacy usage at exactly 0.1% must fail the strict below threshold");
assert.deepEqual(blocked.fallbackReasons, { capability_selection: 999, oaep_unavailable: 1 });
assert.equal(JSON.stringify(blocked).includes("secret-canary"), false);
const readyRows = new LegacyProtocolTelemetry();
for (let index = 0; index < 10_000; index += 1) readyRows.record("oaep", "capability_selection", "1.6.0");
const ready = buildLegacyDeletionDecisionReport(readyRows.snapshot(), {
  releaseCycles: 2, observationDays: 14, migrationRatio: 1, rollbackArtifactVerified: true,
});
assert.equal(ready.eligible, true);
assert.deepEqual(ready.versions, { oaep: { "1.6.0": 10_000 } });
assert.equal(legacyProtocolCanRetire([
  { version: "1.5.3", legacyUses: 0, supportedRuntimeRequiresLegacy: true },
]), false);
assert.equal(legacyProtocolCanRetire([]), false, "no supported Runtime evidence must fail closed");
rmSync(directory, { recursive: true, force: true });
console.log("P8 bounded persistent legacy telemetry and evidence-based retirement policy verified.");
