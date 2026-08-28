import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "duplex-stable-release-")); const sha = (value) => createHash("sha256").update(value).digest("hex");
const local = (name, content) => { const path = join(directory, name); writeFileSync(path, content); return { uri: pathToFileURL(path).toString(), sha256: sha(content) }; };
const workbook = {
  schemaVersion: 1, kind: "duplex-stable-release-cycle-workbook", mode: "duplex", ok: false,
  releaseVersion: "1.5.8", releaseChannel: "stable", startedAt: "2026-08-01T00:00:00.000Z",
  candidate: { executable: local("OpenDrSai.exe", "released-exe"), appAsar: local("app.asar", "released-asar") },
  published: true, observedFullReleaseCycle: true,
  telemetry: { newStreamingConfigReferences: 0, migrationFailures: 0, serialRegressions: 0 },
  attachments: [local("publication.json", "stable publication record"), local("telemetry.json", "authoritative release telemetry")], approver: null,
};
const workbookPath = join(directory, "workbook.json"); writeFileSync(workbookPath, JSON.stringify(workbook));
const finalizer = resolve(import.meta.dirname, "finalize-duplex-stable-release-review.mjs"); const verifier = resolve(import.meta.dirname, "verify-duplex-stable-release-cycle.mjs");
const flags = ["--workbook", workbookPath, "--output", join(directory, "report.json"), "--ended-at", "2026-08-14T00:00:00.000Z", "--approver", "Release Owner", "--confirm-stable-publication", "--confirm-full-release-cycle", "--confirm-authoritative-telemetry"];
execFileSync(process.execPath, [finalizer, ...flags]); execFileSync(process.execPath, [verifier, join(directory, "report.json")]);
assert.notEqual(spawnSync(process.execPath, [finalizer, ...flags.filter((value) => value !== "--confirm-full-release-cycle"), "--output", join(directory, "unconfirmed.json")]).status, 0, "Missing explicit full-cycle confirmation must fail.");
const regression = structuredClone(workbook); regression.telemetry.serialRegressions = 1; const regressionPath = join(directory, "regression.json"); writeFileSync(regressionPath, JSON.stringify(regression));
assert.notEqual(spawnSync(process.execPath, [finalizer, ...flags.map((value, i) => flags[i - 1] === "--workbook" ? regressionPath : value), "--output", join(directory, "regression-report.json")]).status, 0, "A Serial regression must fail stable-cycle evidence.");
const tampered = JSON.parse(readFileSync(join(directory, "report.json"), "utf8")); tampered.candidate.executable.sha256 = "0".repeat(64); const tamperedPath = join(directory, "tampered.json"); writeFileSync(tamperedPath, JSON.stringify(tampered));
assert.notEqual(spawnSync(process.execPath, [verifier, tamperedPath]).status, 0, "Candidate or integrity tampering must fail.");
console.log("Duplex stable release-cycle finalizer verified (publication, full cycle, telemetry, candidate, attachments, attestation, and tamper gates). ");
