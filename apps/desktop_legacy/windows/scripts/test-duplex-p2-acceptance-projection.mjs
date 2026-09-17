import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { candidateEvidenceMatches, projectAcceptance } from "./duplex-p2-acceptance-projection.mjs";

const features = [
  { id: "basic", feature: "basic", requiredEvidence: ["automation", "packaged_named_review"] },
  { id: "live", feature: "live", requiredEvidence: ["automation", "packaged_named_review", "live_named_listening"] },
  { id: "hardware", feature: "hardware", requiredEvidence: ["automation", "packaged_named_review", "hardware_physical"] },
  { id: "legacy", feature: "legacy", requiredEvidence: ["automation", "packaged_named_review", "stable_release_cycle"] },
];
const none = projectAcceptance(features, { automation: true });
assert.ok(none.every(({ strictAcceptance }) => strictAcceptance === "pending"), "Automation alone must accept nothing.");
const packaged = projectAcceptance(features, { automation: true, packaged_named_review: true });
assert.equal(packaged[0].strictAcceptance, "accepted"); assert.ok(packaged.slice(1).every(({ strictAcceptance }) => strictAcceptance === "pending"));
const all = projectAcceptance(features, { automation: true, packaged_named_review: true, live_named_listening: true, hardware_physical: true, stable_release_cycle: true });
assert.ok(all.every(({ strictAcceptance }) => strictAcceptance === "accepted"));
const noAutomation = projectAcceptance(features, { automation: false, packaged_named_review: true, live_named_listening: true, hardware_physical: true, stable_release_cycle: true });
assert.ok(noAutomation.every(({ strictAcceptance }) => strictAcceptance === "pending"), "External evidence cannot replace automation.");
const candidate = (executable, appAsar) => ({ artifacts: { executable: { sha256: executable }, appAsar: { sha256: appAsar } } });
assert.equal(candidateEvidenceMatches(candidate("exe", "asar"), candidate("exe", "asar")), true);
assert.equal(candidateEvidenceMatches(candidate("exe", "asar"), candidate("stale", "asar")), false, "A stale EXE must not combine with current evidence.");
assert.equal(candidateEvidenceMatches(candidate("exe", "asar"), candidate("exe", "stale")), false, "A stale app.asar must not combine with current evidence.");
const directory = mkdtempSync(join(tmpdir(), "duplex-acceptance-projection-"));
const release = join(directory, "release"); cpSync(resolve(import.meta.dirname, "../release/duplex-voice"), release, { recursive: true });
writeFileSync(join(release, "stable-release-cycle-report.json"), JSON.stringify({ schemaVersion: 1, kind: "stable-release-cycle", mode: "duplex", ok: true, releaseVersion: "test", startedAt: "2026-08-01T00:00:00Z", endedAt: "2026-08-08T00:00:00Z", approver: { name: "QA" }, telemetry: { newStreamingConfigReferences: 0, migrationFailures: 0, serialRegressions: 0 }, attachments: [], integrity: { algorithm: "sha256", digest: "0".repeat(64) } }));
const output = join(directory, "status.json");
execFileSync(process.execPath, [resolve(import.meta.dirname, "generate-duplex-p2-acceptance-status.mjs"), "--release-dir", release, "--output", output]);
assert.equal(JSON.parse(readFileSync(output, "utf8")).evidenceStatus.stable_release_cycle, false, "Malformed or unattached stable-cycle claims must fail closed.");
console.log("Duplex Voice P2 acceptance projection gates passed (automation-only, partial, complete, and missing-automation). ");
