import assert from "node:assert/strict";
import { listAcceptanceScenarios } from "./acceptance/scenario-registry.mjs";
import { evaluateAcceptance, redactEvidence } from "./acceptance/evidence.mjs";

const smoke = listAcceptanceScenarios("smoke");
const release = listAcceptanceScenarios("release");
assert.ok(smoke.length >= 4);
assert.ok(release.length > smoke.length);
assert.equal(new Set(release.map((item) => item.id)).size, release.length);
assert.ok(release.some((item) => item.id === "sandbox-host-codex" && item.required));
assert.deepEqual(evaluateAcceptance([{ id: "ok", required: true, status: "passed" }]), { passed: true, failedScenarioIds: [] });
assert.equal(evaluateAcceptance([{ id: "bad", required: true, status: "blocked" }]).passed, false);
const redacted = redactEvidence({ token: "abc", nested: { password: "pw" }, path: "C:\\Users\\win11\\secret" });
assert.equal(redacted.token, "[REDACTED]");
assert.equal(redacted.nested.password, "[REDACTED]");
assert.equal(redacted.path, "C:\\Users\\[REDACTED]\\secret");
console.log("Sandbox/host Codex acceptance orchestrator verification passed.");
