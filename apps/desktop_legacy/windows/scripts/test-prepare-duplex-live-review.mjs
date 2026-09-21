import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync as run } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const directory = mkdtempSync(join(tmpdir(), "opendrsai-live-review-"));
const script = new URL("./prepare-duplex-live-review.mjs", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
const digest = (value) => createHash("sha256").update(value).digest("hex");
try {
  const audioPath = join(directory, "audio.wav");
  const sourcePath = join(directory, "source.json");
  const outputPath = join(directory, "live-report.json");
  const executablePath = join(directory, "OpenDrSai.exe"); const appAsarPath = join(directory, "app.asar"); writeFileSync(executablePath, "candidate-executable"); writeFileSync(appAsarPath, "candidate-asar");
  const audio = Buffer.from("bounded-real-audio-fixture");
  writeFileSync(audioPath, audio);
  const source = {
    schemaVersion: 1, kind: "duplex-live-provider-run", generatedAt: new Date().toISOString(), providerId: "zhizengzeng", modelId: "gpt-realtime-2",
    observed: { sessionReady: true, inputAudio: true, inputTranscript: true, outputAudio: true, outputTranscript: true, interruption: true, conversationTruncation: true, toolCall: true, toolRoundTrip: true },
    attachments: [{ uri: pathToFileURL(audioPath).toString(), sha256: digest(audio) }],
    privacy: { rawEventsPersisted: false, transcriptTextPersisted: false, credentialsPersisted: false },
  };
  writeFileSync(sourcePath, JSON.stringify(source));
  run(process.execPath, [script, sourcePath, outputPath, "--executable", executablePath, "--app-asar", appAsarPath]);
  const report = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(report.ok, false); assert.equal(report.tester, null); assert.equal(report.mode, "duplex");
  assert.equal(report.attachments.length, 2); assert.equal(report.automatedSource.conversationTruncation, true);
  assert.equal(report.protocolVersion, 2); assert.equal(report.artifacts.executable.sha256, digest("candidate-executable")); assert.equal(report.artifacts.appAsar.sha256, digest("candidate-asar"));
  assert.deepEqual(Object.values(report.reviewerChecklist), [false, false, false, false]);
  const { integrity, ...payload } = report;
  assert.equal(integrity.digest, digest(JSON.stringify(payload)));
  console.log("Duplex live review preparation verified (hash binding, privacy, anti-auto-signing, and reviewer checklist).")
} finally { rmSync(directory, { recursive: true, force: true }); }
