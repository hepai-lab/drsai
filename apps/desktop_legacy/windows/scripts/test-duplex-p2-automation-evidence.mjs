import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { duplexAutomationSourceDigest } from "./duplex-automation-source-snapshot.mjs";

const root = resolve(import.meta.dirname, ".."); const workspace = resolve(root, "../../.."); const directory = mkdtempSync(join(tmpdir(), "duplex-automation-evidence-")); const sha = (value) => createHash("sha256").update(value).digest("hex");
const logPath = join(directory, "output.log"); writeFileSync(logPath, "Duplex and Serial suites passed without transcript material.\n"); const now = new Date().toISOString();
const payload = { schemaVersion: 1, kind: "duplex-p2-automation", passed: true, startedAt: now, completedAt: now, suites: ["test:voice:duplex", "test:voice:serial"].map((script) => ({ script, command: `npm run ${script}`, startedAt: now, completedAt: now, exitCode: 0, signal: null, passed: true })), source: duplexAutomationSourceDigest(root), sourceIndexSha256: sha(readFileSync(resolve(workspace, "docs/voice/duplex-voice-p2-evidence-index.json"))), packageJsonSha256: sha(readFileSync(resolve(root, "package.json"))), output: { uri: pathToFileURL(logPath).toString(), sha256: sha(readFileSync(logPath)) }, privacy: { credentialsPersisted: false, transcriptTextPersisted: false } };
const seal = (body) => ({ ...body, integrity: { algorithm: "sha256", digest: sha(JSON.stringify(body)) } }); const reportPath = join(directory, "report.json"); const verifier = resolve(import.meta.dirname, "verify-duplex-p2-automation.mjs");
writeFileSync(reportPath, JSON.stringify(seal(payload))); assert.equal(spawnSync(process.execPath, [verifier, reportPath]).status, 0);
const stale = structuredClone(payload); stale.source.sha256 = "0".repeat(64); writeFileSync(reportPath, JSON.stringify(seal(stale))); assert.notEqual(spawnSync(process.execPath, [verifier, reportPath]).status, 0, "Stale source must fail.");
writeFileSync(reportPath, JSON.stringify(seal(payload))); writeFileSync(logPath, "tampered"); assert.notEqual(spawnSync(process.execPath, [verifier, reportPath]).status, 0, "Tampered output must fail.");
console.log("Duplex P2 automation evidence gates passed (current source, stale source, and tampered output). ");
