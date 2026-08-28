import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "opendrsai-hardware-finalize-"));
const prepare = new URL("./prepare-duplex-hardware-review.mjs", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
const finalize = new URL("./finalize-duplex-hardware-review.mjs", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
const verify = new URL("./verify-duplex-release-evidence.mjs", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
try {
  const workbookPath = join(directory, "workbook.json"); execFileSync(process.execPath, [prepare, "--output", workbookPath]);
  const workbook = JSON.parse(readFileSync(workbookPath, "utf8"));
  for (const [index, scenario] of workbook.scenarios.entries()) {
    scenario.passed = true; scenario.steps.forEach((step) => { step.observed = "Physical behavior matched the expected recovery and remained usable."; step.passed = true; });
    scenario.metrics = Object.fromEntries(scenario.requiredMetrics.map((key, metricIndex) => [key, metricIndex + 1]));
    const attachmentPath = join(directory, `physical-${index}.bin`); const content = `distinct-physical-evidence-${index}`; writeFileSync(attachmentPath, content); scenario.attachments = [{ uri: pathToFileURL(attachmentPath).toString(), sha256: createHash("sha256").update(content).digest("hex") }];
  }
  writeFileSync(workbookPath, JSON.stringify(workbook)); const reportPath = join(directory, "hardware-report.json");
  execFileSync(process.execPath, [finalize, "--workbook", workbookPath, "--output", reportPath, "--tester", "Physical QA", "--confirm-physical-review"]);
  const report = JSON.parse(readFileSync(reportPath, "utf8")); assert.equal(report.ok, true); assert.equal(report.runs.length, 4); assert.equal(report.tester.name, "Physical QA");
  assert.match(execFileSync(process.execPath, [verify, "hardware", reportPath], { encoding: "utf8" }), /release evidence passed/);
  const incomplete = structuredClone(workbook); incomplete.scenarios[0].steps[0].passed = null; const incompletePath = join(directory, "incomplete.json"); writeFileSync(incompletePath, JSON.stringify(incomplete));
  assert.notEqual(spawnSync(process.execPath, [finalize, "--workbook", incompletePath, "--output", join(directory, "invalid.json"), "--tester", "Physical QA", "--confirm-physical-review"]).status, 0, "an incomplete physical step must fail");
  assert.notEqual(spawnSync(process.execPath, [finalize, "--workbook", workbookPath, "--output", join(directory, "unsigned.json"), "--tester", "Physical QA"]).status, 0, "missing explicit physical confirmation must fail");
  const tampered = structuredClone(workbook); tampered.artifacts.executable.sha256 = "a".repeat(64); const tamperedPath = join(directory, "tampered.json"); writeFileSync(tamperedPath, JSON.stringify(tampered));
  assert.notEqual(spawnSync(process.execPath, [finalize, "--workbook", tamperedPath, "--output", join(directory, "tampered-report.json"), "--tester", "Physical QA", "--confirm-physical-review"]).status, 0, "a changed candidate artifact must fail");
  console.log("Duplex hardware review finalizer verified (explicit attestation, complete observations, artifact/attachment binding, and formal gate).")
} finally { rmSync(directory, { recursive: true, force: true }); }
