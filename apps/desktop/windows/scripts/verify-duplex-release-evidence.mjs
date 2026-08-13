import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const kind = process.argv[2];
assert.ok(["packaged", "live", "hardware"].includes(kind), "Usage: verify-duplex-release-evidence.mjs packaged|live|hardware [report.json]");
const defaultPath = resolve(import.meta.dirname, `../release/duplex-voice/${kind}-report.json`);
const path = resolve(process.argv[3] ?? defaultPath);
let report; try { report = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error(`Required ${kind} Duplex evidence is missing or invalid: ${path}`); }
assert.equal(report.schemaVersion, 1); assert.equal(report.kind, kind); assert.equal(report.mode, "duplex", "Evidence must prove Duplex mode; serial/streaming fallback is forbidden."); assert.equal(report.ok, true, `${kind} Duplex evidence is pending or failed.`);
assert.ok(report.tester?.name && report.tester?.signedAt && report.tester?.attestation, "Named tester attestation is required.");
assert.ok(Array.isArray(report.attachments) && report.attachments.length > 0 && report.attachments.every((item) => typeof item === "string" && item.trim()), "At least one evidence attachment reference is required.");
if (kind === "packaged") {
  assert.equal(report.packagedApp, true); assert.equal(report.featureFlag, "OPENDRSAI_ENABLE_DUPLEX_VOICE=1");
  assert.ok(report.observed?.uplinkAudioFrames > 0 && report.observed?.downlinkAudioDeltas > 0); assert.ok(report.observed?.interrupts > 0); assert.equal(report.observed?.terminalCount, 1);
}
if (kind === "live") {
  assert.equal(report.providerId, "zhizengzeng"); assert.equal(report.modelId, "gpt-realtime-2");
  for (const check of ["sessionReady", "inputAudio", "inputTranscript", "outputAudio", "outputTranscript", "interruption", "toolRoundTrip"]) assert.equal(report.observed?.[check], true, `Live evidence missing ${check}.`);
  assert.equal(JSON.stringify(report).match(/(?:sk-|Bearer )[A-Za-z0-9_-]{8,}/), null, "Live report contains credential-like material.");
}
if (kind === "hardware") {
  const required = ["win10Builtin", "win11Builtin", "usbHeadset", "bluetoothHeadset", "speakerAec", "permissionDenied", "sleepResume", "deviceUnplug", "weakNetwork"];
  assert.ok(Array.isArray(report.runs) && report.runs.length >= 4);
  for (const check of required) assert.ok(report.runs.some((run) => run.passed === true && run.checks?.includes(check) && run.attachments?.length), `Hardware matrix missing ${check}.`);
}
const { integrity, ...payload } = report; assert.equal(integrity?.algorithm, "sha256"); assert.equal(integrity?.digest, createHash("sha256").update(JSON.stringify(payload)).digest("hex"), "Evidence digest mismatch.");
console.log(`${kind} Duplex release evidence passed (strict mode, observations, attachments, attestation, and integrity).`);
