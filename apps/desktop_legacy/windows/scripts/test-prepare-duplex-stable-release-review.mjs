import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "duplex-stable-prepare-")); const output = join(directory, "workbook.json");
const script = resolve(import.meta.dirname, "prepare-duplex-stable-release-review.mjs");
execFileSync(process.execPath, [script, "--release-version", "1.5.8", "--started-at", "2026-08-01T00:00:00.000Z", "--output", output]);
const workbook = JSON.parse(readFileSync(output, "utf8"));
assert.equal(workbook.ok, false); assert.equal(workbook.published, null); assert.equal(workbook.observedFullReleaseCycle, null); assert.equal(workbook.approver, null);
assert.deepEqual(workbook.telemetry, { newStreamingConfigReferences: null, migrationFailures: null, serialRegressions: null });
assert.deepEqual(workbook.attachments, []); assert.equal(workbook.releaseChannel, "stable");
assert.deepEqual(Object.keys(workbook.candidate).sort(), ["appAsar", "executable"]);
assert.notEqual(spawnSync(process.execPath, [script, "--release-version", "future", "--started-at", "2099-01-01T00:00:00.000Z", "--output", join(directory, "future.json")]).status, 0, "Future publication dates must fail.");
console.log("Duplex stable release-cycle workbook preparation verified (candidate-bound, pending, unsigned, and no inferred telemetry). ");
