import assert from "node:assert/strict";
import { DuplexTemporaryDiagnostics } from "../../shared/renderer/src/voice/duplex/temporaryDiagnostics.ts";
import { buildDuplexSloSnapshot } from "../../shared/renderer/src/voice/duplex/sloProjection.ts";

let now = 1_000;
const diagnostics = new DuplexTemporaryDiagnostics(() => now);
assert.equal(diagnostics.record({ metrics: { ttfaMs: 10 } }), false, "diagnostics must be opt-in");
assert.throws(() => diagnostics.enable(16 * 60_000), /invalid/);
assert.equal(diagnostics.enable(1_000), 2_000);
assert.equal(diagnostics.record({ metrics: { ttfaMs: 123, healthy: true, absent: null, transcript: "CANARY_TRANSCRIPT", token: "sk-secret" }, reasonCode: "provider.timeout" }), true);
const exported = diagnostics.export();
assert.deepEqual(exported.samples[0].metrics, { ttfaMs: 123, healthy: true, absent: null });
assert.equal(exported.samples[0].reasonCode, "provider.timeout");
assert.doesNotMatch(JSON.stringify(exported), /CANARY_TRANSCRIPT|sk-secret/);
for (let index = 0; index < 510; index += 1) diagnostics.record({ metrics: { index } });
assert.equal(diagnostics.export().samples.length, 500, "temporary buffer must be bounded");
now = 2_000;
assert.deepEqual(diagnostics.export(), { schemaVersion: 1, expiresAt: 0, samples: [] }, "expiry must erase samples");

assert.deepEqual(buildDuplexSloSnapshot({ metrics: { ttfaMs: 340, reconnects: 2, inputAudioMs: 2_500, outputAudioMs: 1_500 }, stopLatencyMs: 80, interruptAttempts: 4, interruptAccepted: 3, underruns: 2.8, usage: { inputAudioMs: 3_000, outputAudioMs: 2_000, estimatedCostUsd: null } }), {
  ttfaMs: 340,
  stopLatencyMs: 80,
  interruptAccuracy: 0.75,
  underruns: 2,
  reconnects: 2,
  inputAudioSeconds: 3,
  outputAudioSeconds: 2,
  estimatedCostUsd: null,
});
const empty = buildDuplexSloSnapshot({ interruptAttempts: 0, interruptAccepted: 0, underruns: -1 });
assert.equal(empty.interruptAccuracy, null);
assert.equal(empty.estimatedCostUsd, null);
assert.equal(empty.underruns, 0);

console.log("Duplex voice observability verified (opt-in TTL diagnostics, secret/transcript filtering, bounded cleanup, and null-safe SLO projection).");
