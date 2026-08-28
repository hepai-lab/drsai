import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "opendrsai-live-finalize-"));
const prepare = new URL("./prepare-duplex-live-review.mjs", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1"); const finalize = new URL("./finalize-duplex-live-review.mjs", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1"); const verify = new URL("./verify-duplex-release-evidence.mjs", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
const digest = (value) => createHash("sha256").update(value).digest("hex");
try {
  const audioPath = join(directory, "output.wav"); const audio = Buffer.from("real-output-attachment-fixture"); writeFileSync(audioPath, audio);
  const sourcePath = join(directory, "provider-run.json"); const source = { schemaVersion: 1, kind: "duplex-live-provider-run", generatedAt: new Date().toISOString(), providerId: "zhizengzeng", modelId: "gpt-realtime-2", observed: { sessionReady: true, inputAudio: true, inputTranscript: true, outputAudio: true, outputTranscript: true, interruption: true, conversationTruncation: true, toolCall: true, toolRoundTrip: true }, attachments: [{ uri: pathToFileURL(audioPath).toString(), sha256: digest(audio) }], privacy: { rawEventsPersisted: false, transcriptTextPersisted: false, credentialsPersisted: false } }; writeFileSync(sourcePath, JSON.stringify(source));
  const executable = join(directory, "OpenDrSai.exe"); const appAsar = join(directory, "app.asar"); writeFileSync(executable, "candidate-exe"); writeFileSync(appAsar, "candidate-asar");
  const pendingPath = join(directory, "pending.json"); execFileSync(process.execPath, [prepare, sourcePath, pendingPath, "--executable", executable, "--app-asar", appAsar]);
  const outputPath = join(directory, "signed.json"); const confirmations = ["--confirm-listened", "--confirm-intelligible", "--confirm-interruption", "--confirm-tool-round-trip", "--confirm-live-review"];
  execFileSync(process.execPath, [finalize, "--pending", pendingPath, "--output", outputPath, "--tester", "Listening QA", ...confirmations]);
  const report = JSON.parse(readFileSync(outputPath, "utf8")); assert.equal(report.ok, true); assert.deepEqual(Object.values(report.reviewerChecklist), [true, true, true, true]); assert.equal(report.tester.name, "Listening QA");
  assert.match(execFileSync(process.execPath, [verify, "live", outputPath], { encoding: "utf8" }), /release evidence passed/);
  assert.notEqual(spawnSync(process.execPath, [finalize, "--pending", pendingPath, "--output", join(directory, "unsigned.json"), "--tester", "Listening QA", ...confirmations.slice(0, -1)]).status, 0, "missing overall Live confirmation must fail");
  writeFileSync(audioPath, "changed-audio"); assert.notEqual(spawnSync(process.execPath, [finalize, "--pending", pendingPath, "--output", join(directory, "tampered.json"), "--tester", "Listening QA", ...confirmations]).status, 0, "changed listening attachment must fail");
  console.log("Duplex Live review finalizer verified (candidate/source/audio binding, four listening decisions, named confirmation, and formal gate).")
} finally { rmSync(directory, { recursive: true, force: true }); }
