import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const verifyAttachment = (item, label) => {
  assert.equal(typeof item?.uri, "string", `${label} attachment URI is required.`);
  assert.match(item?.sha256 ?? "", /^[a-f0-9]{64}$/, `${label} attachment SHA-256 is invalid.`);
  let attachmentPath;
  try { attachmentPath = fileURLToPath(item.uri); } catch { throw new Error(`${label} attachment must use a local file: URI.`); }
  let bytes;
  try { bytes = readFileSync(attachmentPath); } catch { throw new Error(`${label} attachment is missing or unreadable: ${item.uri}`); }
  assert.equal(digest(bytes), item.sha256, `${label} attachment digest mismatch: ${item.uri}`);
};
const validDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

const kind = process.argv[2];
assert.ok(["packaged", "live", "hardware"].includes(kind), "Usage: verify-duplex-release-evidence.mjs packaged|live|hardware [report.json]");
const defaultPath = resolve(import.meta.dirname, `../release/duplex-voice/${kind}-report.json`);
const path = resolve(process.argv[3] ?? defaultPath);
let report; try { report = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error(`Required ${kind} Duplex evidence is missing or invalid: ${path}`); }
assert.equal(report.schemaVersion, 1); assert.equal(report.kind, kind); assert.equal(report.mode, "duplex", "Evidence must prove Duplex mode; serial/streaming fallback is forbidden."); assert.equal(report.ok, true, `${kind} Duplex evidence is pending or failed.`);
assert.ok(typeof report.tester?.name === "string" && report.tester.name.trim().length >= 2 && validDate(report.tester?.signedAt) && typeof report.tester?.attestation === "string" && report.tester.attestation.trim().length >= 20, "Named tester attestation is required.");
assert.ok(validDate(report.generatedAt), "Evidence generation time is invalid.");
assert.ok(Array.isArray(report.attachments) && report.attachments.length > 0, "At least one SHA-256-bound evidence attachment is required.");
report.attachments.forEach((item, index) => verifyAttachment(item, `report[${index}]`));
if (kind === "packaged") {
  assert.equal(report.packagedApp, true); assert.equal(report.featureFlag, "OPENDRSAI_ENABLE_DUPLEX_VOICE=1");
  assert.equal(report.protocolVersion, 2); assert.equal(report.providerId, "zhizengzeng"); assert.equal(report.modelId, "gpt-realtime-2");
  assert.deepEqual(report.reviewerChecklist, { launchedHashBoundCandidate: true, duplexModeVisible: true, realtimeControlsOperable: true, noSerialFallbackObserved: true }, "Packaged evidence requires explicit named product-entry review.");
  assert.deepEqual(report.automatedSource?.privacy, { credentialsPersisted: false, transcriptTextPersisted: false, deviceLabelsPersisted: false });
  assert.ok(report.attachments.some((item) => item.sha256 === report.automatedSource?.reportSha256), "Packaged Provider source report is not attached.");
  for (const [name, item] of Object.entries(report.artifacts ?? {})) verifyAttachment(item, `candidate ${name}`);
  assert.deepEqual(Object.keys(report.artifacts ?? {}).sort(), ["appAsar", "executable"], "Packaged evidence must bind the candidate executable and app.asar.");
  assert.deepEqual({ passed: report.serialRegression?.passed, suite: report.serialRegression?.suite }, { passed: true, suite: "npm run test:voice:serial" }, "Packaged evidence must include the exact Serial zero-regression suite.");
  assert.match(report.serialRegression?.reportSha256 ?? "", /^[a-f0-9]{64}$/, "Serial regression report must be hash-bound.");
  assert.match(report.serialRegression?.outputSha256 ?? "", /^[a-f0-9]{64}$/, "Serial regression output must be hash-bound.");
  assert.ok(report.attachments.some((item) => item.sha256 === report.serialRegression.reportSha256) && report.attachments.some((item) => item.sha256 === report.serialRegression.outputSha256), "Serial report and output must both be attached.");
  assert.ok(report.observed?.uplinkAudioFrames > 0 && report.observed?.downlinkAudioDeltas > 0); assert.ok(report.observed?.interrupts > 0); assert.equal(report.observed?.terminalCount, 1);
}
if (kind === "live") {
  assert.equal(report.providerId, "zhizengzeng"); assert.equal(report.modelId, "gpt-realtime-2");
  assert.equal(report.protocolVersion, 2);
  for (const check of ["sessionReady", "inputAudio", "inputTranscript", "outputAudio", "outputTranscript", "interruption", "toolRoundTrip"]) assert.equal(report.observed?.[check], true, `Live evidence missing ${check}.`);
  assert.deepEqual(report.reviewerChecklist, { listenedToOutputAttachment: true, speechIsIntelligible: true, interruptionBehaviorAccepted: true, toolRoundTripReviewed: true }, "Live evidence requires explicit named listening review.");
  assert.deepEqual(report.automatedSource?.privacy, { rawEventsPersisted: false, transcriptTextPersisted: false, credentialsPersisted: false });
  assert.match(report.automatedSource?.reportSha256 ?? "", /^[a-f0-9]{64}$/, "Live automated source digest is missing.");
  assert.ok(report.attachments.some((item) => item.sha256 === report.automatedSource.reportSha256), "Live automated source is not attached.");
  for (const [name, item] of Object.entries(report.artifacts ?? {})) verifyAttachment(item, `candidate ${name}`);
  assert.deepEqual(Object.keys(report.artifacts ?? {}).sort(), ["appAsar", "executable"], "Live evidence must bind the candidate executable and app.asar.");
  assert.equal(JSON.stringify(report).match(/(?:sk-|Bearer )[A-Za-z0-9_-]{8,}/), null, "Live report contains credential-like material.");
}
if (kind === "hardware") {
  assert.equal(report.protocolVersion, 2); assert.equal(report.providerId, "zhizengzeng"); assert.equal(report.modelId, "gpt-realtime-2");
  assert.equal(report.gateway?.port, report.environment === "development" ? 28642 : 18642, "Hardware evidence Gateway port does not match its environment.");
  for (const [name, item] of Object.entries(report.artifacts ?? {})) verifyAttachment(item, `candidate ${name}`);
  assert.deepEqual(Object.keys(report.artifacts ?? {}).sort(), ["appAsar", "executable"], "Hardware evidence must bind the candidate executable and app.asar.");
  const required = ["win10Builtin", "win11Builtin", "usbHeadset", "bluetoothHeadset", "speakerAec", "permissionDenied", "sleepResume", "deviceUnplug", "weakNetwork"];
  assert.ok(Array.isArray(report.runs) && report.runs.length >= 4);
  const attachmentDigests = new Set();
  report.runs.forEach((run, runIndex) => {
    assert.equal(run?.passed, true, `Hardware run ${runIndex} is not passed.`);
    assert.equal(run?.os?.platform, "win32", `Hardware run ${runIndex} must identify Windows.`);
    assert.ok(typeof run?.os?.release === "string" && run.os.release.trim() && typeof run?.os?.build === "string" && run.os.build.trim(), `Hardware run ${runIndex} OS release/build is required.`);
    assert.ok(Array.isArray(run?.deviceClasses) && run.deviceClasses.length > 0 && run.deviceClasses.every((value) => typeof value === "string" && value.trim()), `Hardware run ${runIndex} device classes are required.`);
    assert.ok(Array.isArray(run?.steps) && run.steps.length > 0 && run.steps.every((step) => typeof step?.action === "string" && step.action.trim() && typeof step?.observed === "string" && step.observed.trim() && step.passed === true), `Hardware run ${runIndex} requires passed action/observation steps.`);
    assert.ok(run?.metrics && Object.keys(run.metrics).length > 0 && Object.values(run.metrics).every((value) => typeof value === "number" && Number.isFinite(value)), `Hardware run ${runIndex} requires finite numeric metrics.`);
    assert.ok(Array.isArray(run?.attachments) && run.attachments.length > 0, `Hardware run ${runIndex} requires attachments.`);
    run.attachments.forEach((item, itemIndex) => { verifyAttachment(item, `hardware run ${runIndex}[${itemIndex}]`); attachmentDigests.add(item.sha256); });
  });
  assert.ok(attachmentDigests.size >= 4, "Hardware matrix requires at least four distinct attachment digests.");
  for (const check of required) assert.ok(report.runs.some((run) => run.checks?.includes(check)), `Hardware matrix missing ${check}.`);
}
const { integrity, ...payload } = report; assert.equal(integrity?.algorithm, "sha256"); assert.equal(integrity?.digest, digest(JSON.stringify(payload)), "Evidence digest mismatch.");
console.log(`${kind} Duplex release evidence passed (strict mode, observations, attachments, attestation, and integrity).`);
