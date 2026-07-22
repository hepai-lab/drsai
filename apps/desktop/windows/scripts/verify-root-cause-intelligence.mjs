import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "opendrsai-root-cause-"));
const require = createRequire(import.meta.url);

function loadTypeScript(path, requireFn) {
  const source = readFileSync(path, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: path }).outputText;
  const loaded = { exports: {} };
  new Function("exports", "module", "require", output)(loaded.exports, loaded, requireFn);
  return loaded.exports;
}

try {
  const module = loadTypeScript(join(root, "../shared/main/rootCauseAnalysis.ts"), require);
  const engine = new module.DiagnosticRootCauseEngine(join(tempRoot, "issues.json"));
  const timestamp = new Date().toISOString();
  const events = [
    { id: "start", traceId: "trace-1", spanId: "root", timestamp, kind: "operation", level: "info", status: "started", module: "runtime", component: "runtime-engine", operation: "run.execute", message: "Run started", schemaVersion: 1 },
    { id: "network-failure-1", traceId: "trace-1", spanId: "gateway", parentSpanId: "root", timestamp, kind: "error", level: "error", status: "failed", module: "runtime", component: "gateway", operation: "gateway.connect", message: "Connection timeout request 1234", errorCode: "ETIMEDOUT", stack: [{ raw: "connect (gateway.ts:42)", file: "gateway.ts", function: "connect", line: 42, inApp: true }], schemaVersion: 1 },
    { id: "backend-failure", traceId: "trace-1", spanId: "backend", parentSpanId: "gateway", timestamp, kind: "error", level: "error", status: "failed", module: "backend", component: "codex-adapter", operation: "backend.failed", message: "Backend failed after Gateway", errorCode: "UPSTREAM_FAILED", schemaVersion: 1 },
    { id: "network-failure-2", traceId: "trace-2", spanId: "gateway-2", timestamp, kind: "error", level: "error", status: "failed", module: "runtime", component: "gateway", operation: "gateway.connect", message: "Connection timeout request 5678", errorCode: "ETIMEDOUT", stack: [{ raw: "connect (gateway.ts:42)", file: "gateway.ts", function: "connect", line: 42, inApp: true }], schemaVersion: 1 },
  ];
  const trace = { traceId: "trace-1", startedAt: timestamp, endedAt: timestamp, status: "failed", rootOperation: "run.execute", events: events.slice(0, 3), firstFailure: events[1], machineIds: ["desktop"] };
  let snapshot = await engine.analyze(events, [trace], [{ id: "gateway", module: "runtime", component: "gateway", state: "disconnected", message: "Gateway disconnected", lastHeartbeatAt: timestamp, restartCount: 0, retryCount: 2 }]);
  assert.equal(snapshot.analyses.length, 1);
  assert.equal(snapshot.analyses[0].primary.category, "timeout");
  assert.equal(snapshot.analyses[0].primary.eventId, "network-failure-1");
  assert.ok(snapshot.analyses[0].primary.confidence >= 0.8);
  assert.equal(snapshot.analyses[0].alternatives[0].eventId, "backend-failure");
  assert.ok(snapshot.analyses[0].facts.length > 0 && snapshot.analyses[0].inferences.length > 0);
  const networkCluster = snapshot.clusters.find((cluster) => cluster.eventIds.includes("network-failure-1"));
  assert.ok(networkCluster);
  assert.equal(networkCluster.count, 2, "Normalized dynamic request numbers should remain in one cluster.");
  assert.equal(networkCluster.trend, "new");

  await engine.update({ action: "mark-known", clusterId: networkCluster.id, note: "Known proxy issue token=must-not-persist" });
  snapshot = await engine.analyze(events, [trace], []);
  const known = snapshot.clusters.find((cluster) => cluster.id === networkCluster.id);
  assert.equal(known.state, "known");
  assert.doesNotMatch(known.knownIssueNote, /must-not-persist/);

  await engine.update({ action: "split", clusterId: networkCluster.id, eventIds: ["network-failure-2"] });
  snapshot = await engine.analyze(events, [trace], []);
  assert.equal(snapshot.clusters.filter((cluster) => cluster.eventIds.some((id) => id.startsWith("network-failure"))).length, 2);
  const split = snapshot.clusters.find((cluster) => cluster.eventIds.includes("network-failure-2"));
  await engine.update({ action: "merge", clusterId: split.id, targetClusterId: networkCluster.id });
  snapshot = await engine.analyze(events, [trace], []);
  assert.equal(snapshot.clusters.filter((cluster) => cluster.eventIds.some((id) => id.startsWith("network-failure"))).length, 1);

  const mainIndex = readFileSync(join(root, "src/main/index.ts"), "utf8");
  const preload = readFileSync(join(root, "../shared/main/preload.ts"), "utf8");
  const panel = readFileSync(join(root, "../shared/renderer/src/components/DebugPanel.tsx"), "utf8");
  assert.ok(mainIndex.includes("desktop:diagnostics-issue-update"));
  assert.ok(preload.includes("updateDiagnosticIssue"));
  for (const contract of ["RootCauseView", "Root cause analysis", "Facts and inference", "Error clusters and trends", "Mark known", "Resolve", "Reopen", "Copy AI analysis brief", "FACTS:", "INFERENCES:", "UNCERTAINTIES:"]) assert.ok(panel.includes(contract), `Missing root-cause UI contract: ${contract}`);
  console.log("Root-cause intelligence verification passed (classification, ranking, evidence, propagation, clustering, trends, known issues, split/merge, redaction, IPC, and UI).");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
