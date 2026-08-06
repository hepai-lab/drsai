import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAnomalyDecision } from "../main/anomalyDecision";

const root = await mkdtemp(join(tmpdir(), "opendrsai-anomaly-"));
const sourcePath = join(root, "measurements.csv");
const source = 'name,value,is_anomaly\r\n"alpha, one",10,false\r\nbeta,99,true\r\ngamma,20,异常\r\n';
try {
  await writeFile(sourcePath, source, "utf8");
  const keep = await applyAnomalyDecision({ workspacePath: root, sourcePath, anomalyColumn: "is_anomaly", decision: "keep" });
  assert.equal(keep.totalRows, 3); assert.equal(keep.anomalyRows, 2); assert.equal(keep.outputs.length, 1); assert.equal(keep.outputs[0].rowCount, 3);
  assert.match(keep.resultSummary, /保留异常/);
  const exclude = await applyAnomalyDecision({ workspacePath: root, sourcePath, anomalyColumn: "IS_ANOMALY", decision: "exclude" });
  assert.equal(exclude.outputs[0].rowCount, 1); assert.equal(exclude.outputs[0].anomalyCount, 0);
  assert.match(exclude.resultSummary, /排除异常/);
  const both = await applyAnomalyDecision({ workspacePath: root, sourcePath, anomalyColumn: "is_anomaly", decision: "both" });
  assert.deepEqual(both.outputs.map((output) => output.role), ["kept_all", "excluded_anomalies"]);
  assert.match(both.resultSummary, /两种都做/);
  assert(both.outputs.every((output) => /^sha256:[a-f0-9]{64}$/.test(output.sha256)));
  assert.equal(await readFile(sourcePath, "utf8"), source, "source CSV must never be modified");
  assert.equal(JSON.parse(await readFile(both.receiptPath, "utf8")).sourceSha256, both.sourceSha256);
  await applyAnomalyDecision({ workspacePath: root, sourcePath, anomalyColumn: "is_anomaly", decision: "both" });
  await assert.rejects(() => applyAnomalyDecision({ workspacePath: root, sourcePath, anomalyColumn: "missing", decision: "keep" }), /not found/i);
  for (const invalid of [
    null,
    {},
    { workspacePath: "", sourcePath, anomalyColumn: "is_anomaly", decision: "keep" },
    { workspacePath: root, sourcePath: "", anomalyColumn: "is_anomaly", decision: "keep" },
    { workspacePath: root, sourcePath, anomalyColumn: "", decision: "keep" },
    { workspacePath: root, sourcePath, anomalyColumn: 4, decision: "keep" },
    { workspacePath: root, sourcePath, anomalyColumn: "x".repeat(241), decision: "keep" },
    { workspacePath: root, sourcePath, anomalyColumn: "bad\ncolumn", decision: "keep" },
    { workspacePath: root, sourcePath, anomalyColumn: "is_anomaly", decision: "delete" },
  ]) await assert.rejects(() => applyAnomalyDecision(invalid as never), /required|choose/i);
  const textSource = join(root, "measurements.txt"); await writeFile(textSource, source, "utf8");
  await assert.rejects(() => applyAnomalyDecision({ workspacePath: root, sourcePath: textSource, anomalyColumn: "is_anomaly", decision: "keep" }), /CSV source/i);
  const headerOnly = join(root, "header-only.csv"); await writeFile(headerOnly, "name,is_anomaly\n", "utf8");
  await assert.rejects(() => applyAnomalyDecision({ workspacePath: root, sourcePath: headerOnly, anomalyColumn: "is_anomaly", decision: "keep" }), /data rows/i);
  const edgeCsv = join(root, "edge.csv"); await writeFile(edgeCsv, 'name,is_anomaly\n"quoted ""name""",yes\nempty,\nblank,0', "utf8");
  const edge = await applyAnomalyDecision({ workspacePath: root, sourcePath: edgeCsv, anomalyColumn: "is_anomaly", decision: "both" });
  assert.equal(edge.totalRows, 3); assert.equal(edge.anomalyRows, 1); assert.equal(edge.normalRows, 2);
  const malformed = join(root, "malformed.csv"); await writeFile(malformed, 'name,is_anomaly\n"unterminated,true\n', "utf8");
  await assert.rejects(() => applyAnomalyDecision({ workspacePath: root, sourcePath: malformed, anomalyColumn: "is_anomaly", decision: "keep" }), /unterminated/i);
  console.log("Anomaly decision branches, CSV quoting, atomic replacement, source preservation and rejection tests passed.");
} finally { await rm(root, { recursive: true, force: true }); }
