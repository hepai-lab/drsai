import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const valueAfter = (flag) => { const i = process.argv.indexOf(flag); return i < 0 ? undefined : process.argv[i + 1]; };
const workbookPath = resolve(valueAfter("--workbook") ?? resolve(import.meta.dirname, "../release/duplex-voice/stable-release-cycle-workbook.json"));
const output = resolve(valueAfter("--output") ?? resolve(import.meta.dirname, "../release/duplex-voice/stable-release-cycle-report.json"));
const endedAt = valueAfter("--ended-at") ?? ""; const approver = valueAfter("--approver")?.trim() ?? "";
assert.ok(process.argv.includes("--confirm-stable-publication") && process.argv.includes("--confirm-full-release-cycle") && process.argv.includes("--confirm-authoritative-telemetry"), "All three explicit stable-release confirmations are required.");
assert.ok(approver.length >= 2 && approver.length <= 120 && !/[\r\n]/.test(approver), "A valid named --approver is required.");
assert.ok(Number.isFinite(Date.parse(endedAt)), "--ended-at must be a valid ISO date.");
const workbookBytes = readFileSync(workbookPath); const workbook = JSON.parse(workbookBytes.toString("utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const attachment = (item, label) => { let path; try { path = fileURLToPath(item?.uri); } catch { throw new Error(`${label} must use a local file: URI.`); } const bytes = readFileSync(path); assert.equal(sha256(bytes), item.sha256, `${label} digest mismatch.`); return { uri: pathToFileURL(path).toString(), sha256: item.sha256 }; };
assert.equal(workbook.schemaVersion, 1); assert.equal(workbook.kind, "duplex-stable-release-cycle-workbook"); assert.equal(workbook.mode, "duplex"); assert.equal(workbook.ok, false);
assert.equal(workbook.releaseChannel, "stable"); assert.ok(typeof workbook.releaseVersion === "string" && workbook.releaseVersion.trim());
assert.ok(Date.parse(endedAt) > Date.parse(workbook.startedAt), "The release cycle must end after stable publication.");
assert.equal(workbook.published, true, "The workbook must explicitly confirm stable publication.");
assert.equal(workbook.observedFullReleaseCycle, true, "The workbook must explicitly confirm a full release cycle.");
assert.deepEqual(workbook.telemetry, { newStreamingConfigReferences: 0, migrationFailures: 0, serialRegressions: 0 }, "Stable-cycle telemetry must prove all three zero-regression conditions.");
const candidate = Object.fromEntries(Object.entries(workbook.candidate ?? {}).map(([name, item]) => [name, attachment(item, `candidate ${name}`)]));
assert.deepEqual(Object.keys(candidate).sort(), ["appAsar", "executable"]);
assert.ok(Array.isArray(workbook.attachments) && workbook.attachments.length >= 2, "Publication and telemetry evidence attachments are both required.");
const attachments = workbook.attachments.map((item, i) => attachment(item, `release evidence ${i}`));
assert.ok(new Set(attachments.map(({ sha256 }) => sha256)).size >= 2, "Stable release evidence requires at least two distinct attachments.");
const payload = {
  schemaVersion: 1, kind: "stable-release-cycle", mode: "duplex", ok: true, generatedAt: new Date().toISOString(),
  releaseVersion: workbook.releaseVersion, releaseChannel: "stable", startedAt: workbook.startedAt, endedAt,
  published: true, observedFullReleaseCycle: true, telemetry: workbook.telemetry, candidate,
  approver: { name: approver, signedAt: new Date().toISOString(), attestation: "I personally verified stable publication, the full release cycle, and the attached authoritative telemetry." },
  attachments: [...attachments, { uri: pathToFileURL(workbookPath).toString(), sha256: sha256(workbookBytes) }],
};
const report = { ...payload, integrity: { algorithm: "sha256", digest: sha256(JSON.stringify(payload)) } };
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Signed stable release-cycle report written to ${output} for ${workbook.releaseVersion}.`);
