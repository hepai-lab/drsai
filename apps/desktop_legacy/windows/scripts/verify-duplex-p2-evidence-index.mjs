import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : resolve(process.argv[index + 1]);
};
const planPath = option("--plan", resolve(workspaceRoot, "docs/voice/duplex-voice-p2-development-plan.md"));
const indexPath = option("--index", resolve(workspaceRoot, "docs/voice/duplex-voice-p2-evidence-index.json"));
const releaseDir = option("--release-dir", resolve(import.meta.dirname, "../release/duplex-voice"));
const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const [plan, evidence, packageJson, packaged, live, workbook] = await Promise.all([
  readFile(planPath, "utf8"), readJson(indexPath), readJson(resolve(import.meta.dirname, "../package.json")),
  readJson(resolve(releaseDir, "packaged-report.json")), readJson(resolve(releaseDir, "live-report.json")), readJson(resolve(releaseDir, "hardware-review-workbook.json")),
]);
const expectedIds = [...new Set(plan.match(/\bM\d+-F\d+\b/g) ?? [])];
const planRows = new Map([...plan.matchAll(/^\| (M\d+-F\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)].map((row) => [row[1], row.slice(2).map((value) => value.trim())]));
assert.equal(expectedIds.length, 52, "P2 plan must contain exactly 52 feature IDs.");
assert.equal(evidence.features.length, 52, "Evidence index must contain exactly 52 feature rows.");
const ids = evidence.features.map(({ id }) => id);
assert.equal(new Set(ids).size, 52, "Evidence index contains duplicate feature IDs.");
assert.deepEqual([...ids].sort(), [...expectedIds].sort(), "Evidence index IDs do not match the plan.");
assert.deepEqual(evidence.counts, { total: 52, implemented: 52, strictAccepted: 0 });
assert.equal(evidence.policy.automationDoesNotEqualStrictAcceptance, true);
assert.equal(evidence.policy.pendingOrUnsignedReportsDoNotCount, true);
assert.equal(evidence.policy.fixturesDoNotCountAsExternalEvidence, true);
for (const feature of evidence.features) {
  const [name, solution, testPlan, acceptanceCriteria] = planRows.get(feature.id) ?? [];
  assert.deepEqual([feature.feature, feature.solution, feature.testPlan, feature.acceptanceCriteria], [name, solution, testPlan, acceptanceCriteria], `${feature.id} plan semantics drifted.`);
  assert.equal(feature.implementation, "implemented", `${feature.id} implementation status is stale.`);
  assert.ok(typeof feature.implementationEvidence === "string" && feature.implementationEvidence.trim() && feature.implementationEvidence !== "—", `${feature.id} lacks concrete implementation evidence.`);
  assert.equal(feature.automation.status, "passed", `${feature.id} automation is not passed.`);
  assert.ok(Array.isArray(feature.automation.suites) && feature.automation.suites.length > 0, `${feature.id} has no automation suite.`);
  for (const suite of feature.automation.suites) assert.equal(typeof packageJson.scripts?.[suite], "string", `${feature.id} references missing package script ${suite}.`);
  assert.ok(feature.requiredEvidence.includes("automation") && feature.requiredEvidence.includes("packaged_named_review"));
  assert.equal(feature.strictAcceptance, "pending", `${feature.id} must remain pending without signed external evidence.`);
}
assert.ok(evidence.features.find(({ id }) => id === "M10-F3").requiredEvidence.includes("stable_release_cycle"));

for (const [name, report] of [["packaged", packaged], ["live", live], ["hardware workbook", workbook]]) {
  assert.equal(report.ok, false, `${name} pending source must not claim success.`);
  assert.equal(report.tester, null, `${name} pending source must remain unsigned.`);
  assert.equal(report.mode, "duplex");
  assert.equal(report.protocolVersion, 2);
  assert.equal(report.providerId, "zhizengzeng");
  assert.equal(report.modelId, "gpt-realtime-2");
}
const candidateHashes = [packaged, live, workbook].map((report) => [report.artifacts.executable.sha256, report.artifacts.appAsar.sha256]);
assert.deepEqual(candidateHashes[1], candidateHashes[0], "Live pending report is bound to a different candidate.");
assert.deepEqual(candidateHashes[2], candidateHashes[0], "Hardware workbook is bound to a different candidate.");
for (const artifact of Object.values(packaged.artifacts)) {
  assert.equal(await digest(fileURLToPath(artifact.uri)), artifact.sha256, `Candidate artifact hash is stale: ${artifact.uri}`);
}
for (const attachment of packaged.attachments) {
  assert.equal(await digest(fileURLToPath(attachment.uri)), attachment.sha256, `Packaged attachment hash is stale: ${attachment.uri}`);
}
console.log("Duplex Voice P2 evidence index verified (52/52 implemented, 0/52 strictly accepted; pending evidence is fail-closed).");
