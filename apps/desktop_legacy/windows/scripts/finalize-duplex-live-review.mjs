import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const valueAfter = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
const pendingPath = resolve(valueAfter("--pending") ?? resolve(import.meta.dirname, "../release/duplex-voice/live-report.json"));
const outputPath = resolve(valueAfter("--output") ?? resolve(import.meta.dirname, "../release/duplex-voice/live-report-signed.json"));
const testerName = valueAfter("--tester")?.trim() ?? "";
const confirmations = ["--confirm-listened", "--confirm-intelligible", "--confirm-interruption", "--confirm-tool-round-trip", "--confirm-live-review"];
for (const flag of confirmations) assert.ok(process.argv.includes(flag), `${flag} is required; automated observations cannot replace named listening review.`);
assert.ok(testerName.length >= 2 && testerName.length <= 120 && !/[\r\n]/.test(testerName), "A valid named tester is required with --tester.");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const pendingBytes = readFileSync(pendingPath); const pending = JSON.parse(pendingBytes.toString("utf8"));
const localAttachment = (item, label) => { let path; try { path = fileURLToPath(item?.uri); } catch { throw new Error(`${label} must use a local file: URI.`); } const bytes = readFileSync(path); assert.equal(sha256(bytes), item?.sha256, `${label} digest mismatch.`); return { uri: pathToFileURL(path).toString(), sha256: item.sha256 }; };
assert.equal(pending.schemaVersion, 1); assert.equal(pending.kind, "live"); assert.equal(pending.mode, "duplex"); assert.equal(pending.ok, false); assert.equal(pending.tester, null);
assert.equal(pending.providerId, "zhizengzeng"); assert.equal(pending.modelId, "gpt-realtime-2"); assert.equal(pending.protocolVersion, 2);
for (const check of ["sessionReady", "inputAudio", "inputTranscript", "outputAudio", "outputTranscript", "interruption", "toolRoundTrip"]) assert.equal(pending.observed?.[check], true, `Pending Live review is missing ${check}.`);
assert.deepEqual(pending.automatedSource?.privacy, { rawEventsPersisted: false, transcriptTextPersisted: false, credentialsPersisted: false });
const { integrity, ...pendingPayload } = pending; assert.equal(integrity?.algorithm, "sha256"); assert.equal(integrity?.digest, sha256(JSON.stringify(pendingPayload)), "Pending Live review integrity mismatch.");
const attachments = pending.attachments.map((item, index) => localAttachment(item, `Live attachment ${index}`));
for (const [name, item] of Object.entries(pending.artifacts ?? {})) localAttachment(item, `candidate ${name}`);
assert.ok(attachments.some((item) => item.sha256 === pending.automatedSource.reportSha256), "The hash-bound automated Provider report attachment is missing.");
const payload = {
  ...pendingPayload,
  ok: true,
  generatedAt: new Date().toISOString(),
  tester: { name: testerName, signedAt: new Date().toISOString(), attestation: "I personally listened to and reviewed the attached real Duplex Provider run." },
  reviewerChecklist: { listenedToOutputAttachment: true, speechIsIntelligible: true, interruptionBehaviorAccepted: true, toolRoundTripReviewed: true },
  attachments: [...attachments, { uri: pathToFileURL(pendingPath).toString(), sha256: sha256(pendingBytes) }],
};
const report = { ...payload, integrity: { algorithm: "sha256", digest: sha256(JSON.stringify(payload)) } };
mkdirSync(dirname(outputPath), { recursive: true }); writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Signed Duplex Live review written to ${outputPath} for tester ${testerName}.`);
