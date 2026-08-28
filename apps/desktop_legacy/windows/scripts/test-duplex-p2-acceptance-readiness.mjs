import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const output = execFileSync(process.execPath, [resolve(import.meta.dirname, "report-duplex-p2-acceptance-readiness.mjs")], { encoding: "utf8" }); const report = JSON.parse(output);
assert.equal(report.environment, "development"); assert.equal(report.gatewayPort, 28642); assert.equal(report.productionGatewayPort, 18642);
assert.equal(report.safeReadOnly, true); assert.equal(report.microphoneStarted, false); assert.equal(report.testerAttestationCreated, false);
assert.equal(report.gates.find(({ kind }) => kind === "automation").status, "complete");
assert.equal(report.gates.find(({ kind }) => kind === "packaged_named_review").status, "ready_for_tester");
assert.equal(report.gates.find(({ kind }) => kind === "live_named_listening").status, "ready_for_listener");
assert.equal(report.gates.find(({ kind }) => kind === "hardware_physical").status, "ready_for_physical_matrix");
assert.equal(report.gates.find(({ kind }) => kind === "stable_release_cycle").status, "not_started");
assert.match(report.candidate.executable.sha256, /^[a-f0-9]{64}$/); assert.match(report.candidate.appAsar.sha256, /^[a-f0-9]{64}$/);
console.log("Duplex P2 read-only acceptance readiness verified (ports, candidate, pending gates, and no microphone/attestation side effects). ");
