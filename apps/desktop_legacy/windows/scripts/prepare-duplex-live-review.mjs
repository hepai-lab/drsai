import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const sourcePath = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../release/duplex-voice/live-provider-run.json"));
const outputPath = resolve(process.argv[3] ?? resolve(import.meta.dirname, "../release/duplex-voice/live-report.json"));
const valueAfter = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
const executablePath = resolve(valueAfter("--executable") ?? resolve(import.meta.dirname, "../release/win-unpacked/OpenDrSai.exe"));
const appAsarPath = resolve(valueAfter("--app-asar") ?? resolve(import.meta.dirname, "../release/win-unpacked/resources/app.asar"));
const sourceBytes = readFileSync(sourcePath);
const source = JSON.parse(sourceBytes.toString("utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

assert.equal(source.schemaVersion, 1);
assert.equal(source.kind, "duplex-live-provider-run");
assert.equal(source.providerId, "zhizengzeng");
assert.equal(source.modelId, "gpt-realtime-2");
for (const check of ["sessionReady", "inputAudio", "inputTranscript", "outputAudio", "outputTranscript", "interruption", "toolRoundTrip"]) {
  assert.equal(source.observed?.[check], true, `Automated live run is missing ${check}.`);
}
assert.deepEqual(source.privacy, { rawEventsPersisted: false, transcriptTextPersisted: false, credentialsPersisted: false });
assert.ok(Array.isArray(source.attachments) && source.attachments.length > 0);

const verifiedAttachments = source.attachments.map((attachment) => {
  assert.equal(typeof attachment?.uri, "string");
  assert.match(attachment.sha256 ?? "", /^[a-f0-9]{64}$/);
  const path = fileURLToPath(attachment.uri);
  const actual = sha256(readFileSync(path));
  assert.equal(actual, attachment.sha256, `Automated live attachment digest mismatch: ${attachment.uri}`);
  return { uri: attachment.uri, sha256: actual };
});
verifiedAttachments.push({ uri: pathToFileURL(sourcePath).toString(), sha256: sha256(sourceBytes) });

const payload = {
  schemaVersion: 1,
  kind: "live",
  mode: "duplex",
  ok: false,
  generatedAt: new Date().toISOString(),
  tester: null,
  providerId: source.providerId,
  modelId: source.modelId,
  protocolVersion: 2,
  artifacts: {
    executable: { uri: pathToFileURL(executablePath).toString(), sha256: sha256(readFileSync(executablePath)) },
    appAsar: { uri: pathToFileURL(appAsarPath).toString(), sha256: sha256(readFileSync(appAsarPath)) },
  },
  observed: {
    sessionReady: true,
    inputAudio: true,
    inputTranscript: true,
    outputAudio: true,
    outputTranscript: true,
    interruption: true,
    toolRoundTrip: true,
  },
  attachments: verifiedAttachments,
  automatedSource: {
    kind: source.kind,
    generatedAt: source.generatedAt,
    reportSha256: sha256(sourceBytes),
    conversationTruncation: source.observed?.conversationTruncation === true,
    privacy: source.privacy,
  },
  reviewerChecklist: {
    listenedToOutputAttachment: false,
    speechIsIntelligible: false,
    interruptionBehaviorAccepted: false,
    toolRoundTripReviewed: false,
  },
};
const report = { ...payload, integrity: { algorithm: "sha256", digest: sha256(JSON.stringify(payload)) } };
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Pending live review written to ${outputPath}. Automated observations are hash-bound; ok remains false until a named tester reviews and signs.`);
