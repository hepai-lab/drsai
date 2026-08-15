import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { duplexAutomationSourceDigest } from "./duplex-automation-source-snapshot.mjs";

const root = resolve(import.meta.dirname, ".."); const workspace = resolve(root, "../../.."); const path = resolve(process.argv[2] ?? resolve(root, "release/duplex-voice/p2-automation-report.json"));
const bytes = readFileSync(path); const report = JSON.parse(bytes); const sha = (value) => createHash("sha256").update(value).digest("hex");
assert.equal(report.schemaVersion, 1); assert.equal(report.kind, "duplex-p2-automation"); assert.equal(report.passed, true);
assert.deepEqual(report.suites.map(({ script, command, passed, exitCode }) => ({ script, command, passed, exitCode })), [
  { script: "test:voice:duplex", command: "npm run test:voice:duplex", passed: true, exitCode: 0 },
  { script: "test:voice:serial", command: "npm run test:voice:serial", passed: true, exitCode: 0 },
]);
assert.ok(report.suites.every(({ startedAt, completedAt }) => Number.isFinite(Date.parse(startedAt)) && Date.parse(completedAt) >= Date.parse(startedAt)));
assert.deepEqual(report.source, duplexAutomationSourceDigest(root), "Automation report is stale for the current Duplex source tree.");
assert.equal(report.sourceIndexSha256, sha(readFileSync(resolve(workspace, "docs/voice/duplex-voice-p2-evidence-index.json"))), "Automation report uses a stale evidence index.");
assert.equal(report.packageJsonSha256, sha(readFileSync(resolve(root, "package.json"))), "Automation report uses stale package scripts.");
const log = readFileSync(fileURLToPath(report.output.uri)); assert.equal(sha(log), report.output.sha256); assert.doesNotMatch(log.toString("utf8"), /(?:sk-|Bearer\s+)[A-Za-z0-9_-]{8,}/i);
const { integrity, ...payload } = report; assert.equal(integrity?.algorithm, "sha256"); assert.equal(integrity?.digest, sha(JSON.stringify(payload)));
console.log(`Duplex P2 automation evidence passed (${report.source.fileCount} source files, Duplex + Serial).`);
