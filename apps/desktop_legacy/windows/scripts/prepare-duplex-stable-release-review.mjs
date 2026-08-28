import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const valueAfter = (flag) => { const i = process.argv.indexOf(flag); return i < 0 ? undefined : process.argv[i + 1]; };
const releaseVersion = valueAfter("--release-version")?.trim() ?? "";
const startedAt = valueAfter("--started-at") ?? "";
assert.ok(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(releaseVersion), "--release-version is required and must be a stable release identifier.");
assert.ok(Number.isFinite(Date.parse(startedAt)), "--started-at must be a valid ISO date for the actual stable publication time.");
assert.ok(Date.parse(startedAt) <= Date.now(), "A stable release cycle cannot start in the future.");
const root = resolve(import.meta.dirname, "..");
const output = resolve(valueAfter("--output") ?? resolve(root, "release/duplex-voice/stable-release-cycle-workbook.json"));
const executable = resolve(root, "release/win-unpacked/OpenDrSai.exe");
const appAsar = resolve(root, "release/win-unpacked/resources/app.asar");
for (const path of [executable, appAsar]) assert.ok(existsSync(path), `Candidate artifact is missing: ${path}`);
const artifact = (path) => ({ uri: pathToFileURL(path).toString(), sha256: createHash("sha256").update(readFileSync(path)).digest("hex") });
const workbook = {
  schemaVersion: 1, kind: "duplex-stable-release-cycle-workbook", mode: "duplex", ok: false,
  generatedAt: new Date().toISOString(), releaseVersion, releaseChannel: "stable", startedAt,
  candidate: { executable: artifact(executable), appAsar: artifact(appAsar) },
  published: null, observedFullReleaseCycle: null,
  telemetry: { newStreamingConfigReferences: null, migrationFailures: null, serialRegressions: null },
  attachments: [], approver: null,
  instructions: [
    "Complete this workbook only after the named version was actually published to the stable channel and observed for the full release cycle.",
    "Attach at least two distinct local, SHA-256-bound records: stable publication evidence and release telemetry/change-window evidence.",
    "Set all three telemetry counters from authoritative release data; do not infer zero from an absent dashboard.",
    "Automation may verify this workbook but cannot attest publication or completion of a stable release cycle.",
  ],
};
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(workbook, null, 2)}\n`, "utf8");
console.log(`Pending stable release-cycle workbook written to ${output}; it remains ok=false and unsigned.`);
