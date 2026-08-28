import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const valueAfter = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
const workbookPath = resolve(valueAfter("--workbook") ?? resolve(import.meta.dirname, "../release/duplex-voice/hardware-review-workbook.json"));
const outputPath = resolve(valueAfter("--output") ?? resolve(import.meta.dirname, "../release/duplex-voice/hardware-report.json"));
const testerName = valueAfter("--tester")?.trim() ?? "";
assert.ok(process.argv.includes("--confirm-physical-review"), "Explicit --confirm-physical-review is required; automation cannot attest physical hardware work.");
assert.ok(testerName.length >= 2 && testerName.length <= 120 && !/[\r\n]/.test(testerName), "A valid named tester is required with --tester.");

const bytes = readFileSync(workbookPath); const workbook = JSON.parse(bytes.toString("utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const localAttachment = (uri, expectedDigest, label) => {
  let path; try { path = fileURLToPath(uri); } catch { throw new Error(`${label} must use a local file: URI.`); }
  const content = readFileSync(path); const actual = sha256(content);
  if (expectedDigest) assert.equal(actual, expectedDigest, `${label} changed after the workbook was prepared.`);
  return { uri: pathToFileURL(path).toString(), sha256: actual };
};
assert.equal(workbook.schemaVersion, 1); assert.equal(workbook.kind, "duplex-hardware-review-workbook"); assert.equal(workbook.mode, "duplex"); assert.equal(workbook.ok, false, "Only an unsigned pending workbook can be finalized.");
assert.equal(workbook.protocolVersion, 2); assert.equal(workbook.providerId, "zhizengzeng"); assert.equal(workbook.modelId, "gpt-realtime-2");
assert.deepEqual(workbook.privacy, { deviceLabelsPersisted: false, transcriptTextPersisted: false, rawAudioRequired: false, credentialsPersisted: false });
assert.equal(workbook.gateway?.port, workbook.environment === "development" ? 28642 : 18642, "Workbook Gateway port does not match its environment.");
for (const [name, artifact] of Object.entries(workbook.artifacts ?? {})) localAttachment(artifact?.uri, artifact?.sha256, `candidate ${name}`);

const requiredChecks = ["win10Builtin", "win11Builtin", "usbHeadset", "bluetoothHeadset", "speakerAec", "permissionDenied", "sleepResume", "deviceUnplug", "weakNetwork"];
assert.ok(Array.isArray(workbook.scenarios) && workbook.scenarios.length >= 4, "The complete physical matrix is required.");
const safeText = (value, label) => { assert.ok(typeof value === "string" && value.trim() && value.length <= 2_000 && !/[\0\r]/.test(value), `${label} is missing or invalid.`); assert.doesNotMatch(value, /(?:sk-|Bearer\s+)[A-Za-z0-9_-]{8,}|(?:api[_-]?key|authorization|token)\s*[:=]\s*\S+/i, `${label} contains credential-like material.`); return value.trim(); };
const runs = workbook.scenarios.map((scenario, scenarioIndex) => {
  assert.equal(scenario.passed, true, `Scenario ${scenario.id ?? scenarioIndex} is not explicitly passed.`);
  assert.equal(scenario.os?.platform, "win32", `Scenario ${scenario.id ?? scenarioIndex} must be performed on Windows.`);
  assert.ok(Array.isArray(scenario.deviceClasses) && scenario.deviceClasses.length > 0 && scenario.deviceClasses.every((item) => typeof item === "string" && /^[a-z0-9-]{3,80}$/.test(item)), `Scenario ${scenario.id ?? scenarioIndex} device classes are invalid.`);
  assert.ok(Array.isArray(scenario.steps) && scenario.steps.length > 0, `Scenario ${scenario.id ?? scenarioIndex} has no physical steps.`);
  const steps = scenario.steps.map((item, stepIndex) => { assert.equal(item.passed, true, `Scenario ${scenario.id ?? scenarioIndex} step ${stepIndex} is not passed.`); return { action: safeText(item.action, "Step action"), observed: safeText(item.observed, "Step observation"), passed: true }; });
  const requiredMetrics = scenario.requiredMetrics ?? []; assert.ok(requiredMetrics.length > 0 && requiredMetrics.every((key) => typeof key === "string" && Number.isFinite(scenario.metrics?.[key])), `Scenario ${scenario.id ?? scenarioIndex} is missing required numeric metrics.`);
  const metrics = Object.fromEntries(Object.entries(scenario.metrics).map(([key, value]) => { assert.ok(/^[A-Za-z][A-Za-z0-9]{1,80}$/.test(key) && typeof value === "number" && Number.isFinite(value), `Scenario ${scenario.id ?? scenarioIndex} metric is invalid.`); return [key, value]; }));
  assert.ok(Array.isArray(scenario.attachments) && scenario.attachments.length > 0, `Scenario ${scenario.id ?? scenarioIndex} has no evidence attachment.`);
  const attachments = scenario.attachments.map((item, itemIndex) => localAttachment(item?.uri, item?.sha256, `scenario ${scenario.id ?? scenarioIndex} attachment ${itemIndex}`));
  return { passed: true, checks: scenario.checks, os: scenario.os, deviceClasses: scenario.deviceClasses, steps, metrics, attachments };
});
for (const check of requiredChecks) assert.ok(runs.some((run) => run.checks?.includes(check)), `Physical matrix is missing ${check}.`);
assert.ok(new Set(runs.flatMap((run) => run.attachments.map((item) => item.sha256))).size >= 4, "At least four distinct physical evidence attachments are required.");

const payload = {
  schemaVersion: 1, kind: "hardware", mode: "duplex", ok: true, generatedAt: new Date().toISOString(),
  protocolVersion: workbook.protocolVersion, providerId: workbook.providerId, modelId: workbook.modelId,
  environment: workbook.environment, gateway: workbook.gateway, artifacts: workbook.artifacts,
  tester: { name: testerName, signedAt: new Date().toISOString(), attestation: "I personally performed and reviewed every physical Duplex hardware step in this report." },
  attachments: [{ uri: pathToFileURL(workbookPath).toString(), sha256: sha256(bytes) }], runs,
};
const report = { ...payload, integrity: { algorithm: "sha256", digest: sha256(JSON.stringify(payload)) } };
mkdirSync(dirname(outputPath), { recursive: true }); writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Signed physical Duplex hardware report written to ${outputPath} for tester ${testerName}.`);
