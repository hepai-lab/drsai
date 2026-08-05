import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "opendrsai-diagnostics-"));
const require = createRequire(import.meta.url);

function loadTypeScript(path, requireFn) {
  const source = readFileSync(path, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: path,
  }).outputText;
  const loaded = { exports: {} };
  new Function("exports", "module", "require", output)(loaded.exports, loaded, requireFn);
  return loaded.exports;
}

const sharedPath = join(root, "../shared/api/diagnostics.ts");
const shared = loadTypeScript(sharedPath, (specifier) => { throw new Error(`Unexpected shared import: ${specifier}`); });
const rootCause = loadTypeScript(join(root, "../shared/main/rootCauseAnalysis.ts"), (specifier) => {
  if (specifier === "../api/diagnostics") return shared;
  return require(specifier);
});
const classifier = loadTypeScript(join(root, "../shared/main/diagnosticClassifier.ts"), (specifier) => {
  if (specifier === "../api/diagnostics") return shared;
  return require(specifier);
});
const agentProjector = loadTypeScript(join(root, "../shared/main/agentDiagnosticProjector.ts"), (specifier) => {
  if (specifier === "../api/diagnostics") return shared;
  return require(specifier);
});
const incidentProjector = loadTypeScript(join(root, "../shared/main/diagnosticIncidentProjector.ts"), (specifier) => {
  if (specifier === "../api/diagnostics") return shared;
  return require(specifier);
});
const mainPath = join(root, "../shared/main/diagnostics.ts");
const main = loadTypeScript(mainPath, (specifier) => {
  if (specifier === "../api/diagnostics") return shared;
  if (specifier === "./rootCauseAnalysis") return rootCause;
  if (specifier === "./diagnosticClassifier") return classifier;
  if (specifier === "./agentDiagnosticProjector") return agentProjector;
  if (specifier === "./diagnosticIncidentProjector") return incidentProjector;
  if (specifier === "./paths") return { DRSAI_HOME: tempRoot };
  return require(specifier);
});

try {
  const agentClassification = classifier.classifyDiagnosticEvent({
    module: "runtime", component: "runtime-engine", operation: "chat.run", message: "Waiting for model backend", status: "waiting", runId: "run-one",
  });
  assert.equal(agentClassification.domain, "agent");
  assert.equal(agentClassification.agentPhase, "waiting_model");
  assert.equal(agentClassification.visibility, "milestone");
  const protocolClassification = classifier.classifyDiagnosticEvent({
    module: "runtime", component: "oaep/1", operation: "oaep.event.received", message: "event.item.delta", status: "running",
  });
  assert.equal(protocolClassification.domain, "protocol");
  assert.equal(protocolClassification.visibility, "raw");
  const appClassification = classifier.classifyDiagnosticEvent({
    module: "desktop", component: "renderer", operation: "window.error", message: "Renderer failed", status: "failed", errorCode: "RENDERER_FAILED",
  });
  assert.equal(appClassification.domain, "app");
  assert.equal(appClassification.visibility, "milestone");
  assert.equal(appClassification.fingerprint, classifier.classifyDiagnosticEvent({
    module: "desktop", component: "renderer", operation: "window.error", message: "Renderer failed", status: "failed", errorCode: "RENDERER_FAILED",
  }).fingerprint, "Equivalent failures must have a stable fingerprint.");

  const diagnostics = new main.DesktopDiagnostics();
  const operation = await diagnostics.start({
    traceId: "trace-test",
    spanId: "span-root",
    module: "runtime",
    component: "gateway",
    operation: "chat.start",
    message: "Bearer secret-token api_key=secret-key",
  });
  await operation.wait("Waiting for backend", { password: "must-not-exist", attempt: 1 });
  await operation.complete("Chat completed", { result: "ok" });

  const child = await diagnostics.record({
    traceId: "trace-test",
    spanId: "span-child",
    parentSpanId: "span-root",
    module: "backend",
    component: "codex-adapter",
    operation: "codex.request",
    message: "Codex request completed",
    status: "completed",
  });
  await diagnostics.record({ ...child });

  const failure = new Error("backend failed");
  failure.stack = "Error: backend failed\n    at startChat (C:\\repo\\src\\chat.ts:42:7)\n  File \"/srv/drsai/runtime.py\", line 18, in run";
  const failed = await diagnostics.start({
    traceId: "trace-failed",
    module: "runtime",
    component: "runtime-engine",
    operation: "run.execute",
    message: "Run started",
  });
  await failed.fail(failure, "BACKEND_FAILED");
  await diagnostics.record({ traceId: "trace-ssh", spanId: "span-ssh", module: "workspace", component: "ssh-transport", operation: "ssh.retry", message: "Connection retry 1", status: "waiting" });
  await diagnostics.record({ traceId: "trace-ssh", spanId: "span-ssh", module: "workspace", component: "ssh-transport", operation: "ssh.restored", message: "Connection restored", status: "completed" });
  const oldTimestamp = new Date(Date.now() - 20_000).toISOString();
  await diagnostics.record({ traceId: "trace-stuck", spanId: "span-stuck-child", parentSpanId: "span-stuck-root", timestamp: new Date(Date.now() - 19_000).toISOString(), module: "tool", component: "terminal", operation: "terminal.wait", message: "Terminal is still running", status: "waiting" });
  await diagnostics.record({ traceId: "trace-stuck", spanId: "span-stuck-root", timestamp: oldTimestamp, module: "workspace", component: "workspace-operation", operation: "workspace.task", message: "Workspace task started", status: "started" });
  await diagnostics.record({ traceId: "trace-renderer-one", module: "desktop", component: "renderer", operation: "window.error", message: "Renderer fixture failed", status: "failed", level: "error", errorCode: "RENDERER_FIXTURE" });
  await diagnostics.record({ traceId: "trace-renderer-two", module: "desktop", component: "renderer", operation: "window.error", message: "Renderer fixture failed", status: "failed", level: "error", errorCode: "RENDERER_FIXTURE" });
  await diagnostics.record({ traceId: "trace-agent-failed", module: "backend", component: "opendrsai-backend", operation: "runtime.agent.failed", message: "Agent fixture failed", status: "failed", level: "error", runId: "run-agent-failed", backendId: "opendrsai", source: { file: "C:\\repo\\agent.py", line: 12, language: "python" } });

  const snapshot = await diagnostics.snapshot({ limit: 100 });
  assert.equal(snapshot.events.filter((event) => event.id === child.id).length, 1, "Duplicate event ids must be ignored.");
  assert.equal(snapshot.traces.find((trace) => trace.traceId === "trace-test")?.status, "completed");
  assert.equal(snapshot.traces.find((trace) => trace.traceId === "trace-failed")?.status, "failed");
  assert.equal(snapshot.traces.find((trace) => trace.traceId === "trace-failed")?.firstFailure?.source?.line, 42);
  assert.ok(snapshot.health.some((item) => item.component === "codex-adapter"));
  assert.equal(snapshot.health.find((item) => item.component === "ssh-transport")?.retryCount, 1);
  assert.ok(snapshot.findings.some((finding) => finding.severity === "error" && finding.component === "runtime-engine"));
  assert.ok(snapshot.findings.some((finding) => finding.severity === "warning" && finding.component === "terminal"));
  assert.equal(snapshot.traces.find((trace) => trace.traceId === "trace-stuck")?.events[0].spanId, "span-stuck-root", "Out-of-order events must be sorted by timestamp.");
  assert.ok(snapshot.events.every((event) => !JSON.stringify(event).includes("secret-token")));
  assert.ok(snapshot.events.every((event) => !JSON.stringify(event).includes("secret-key")));
  assert.ok(snapshot.events.every((event) => !JSON.stringify(event).includes("must-not-exist")));
  assert.equal(snapshot.events.find((event) => event.traceId === "trace-failed")?.domain, "app");
  assert.ok(snapshot.events.some((event) => event.domain === "agent" && event.traceId === "trace-test"));
  assert.ok((await diagnostics.snapshot({ domain: "agent", limit: 100 })).events.every((event) => event.domain === "agent"));
  const projectedRun = snapshot.agentRuns.find((run) => run.traceId === "trace-test");
  assert.equal(projectedRun?.phase, "completed");
  assert.equal(projectedRun?.status, "completed");
  assert.ok((projectedRun?.recentEvents.length ?? 0) >= 3);
  const appIncident = snapshot.incidents.find((incident) => incident.errorCode === "RENDERER_FIXTURE");
  assert.equal(appIncident?.domain, "app");
  assert.equal(appIncident?.count, 2);
  const agentIncident = snapshot.incidents.find((incident) => incident.runId === "run-agent-failed");
  assert.equal(agentIncident?.domain, "agent");
  assert.equal(agentIncident?.agentPhase, "failed");
  assert.equal(agentIncident?.source?.line, 12);

  const exported = await diagnostics.serializeExport();
  assert.match(exported, /OpenDrSai Desktop/);
  assert.doesNotMatch(exported, /secret-token|secret-key|must-not-exist/);

  await new Promise((resolve) => setTimeout(resolve, 80));
  const reloaded = new main.DesktopDiagnostics();
  const restored = await reloaded.snapshot({ limit: 100 });
  assert.ok(restored.events.some((event) => event.traceId === "trace-failed"), "Persisted diagnostics must survive a service restart.");
  assert.equal(restored.health.some((item) => item.component === "runtime-engine" && item.state === "failed"), false, "Historical failures must not be presented as current component health after restart.");
  assert.equal(restored.findings.some((item) => item.component === "runtime-engine" && item.severity === "error"), false, "Historical failures remain in the error timeline but must not appear as new-session findings.");

  const removed = await diagnostics.clear();
  assert.ok(removed >= 6);
  assert.equal((await diagnostics.snapshot()).events.length, 0);

  const mainIndex = readFileSync(join(root, "src/main/index.ts"), "utf8");
  const preload = readFileSync(join(root, "../shared/main/preload.ts"), "utf8");
  const panel = readFileSync(join(root, "../shared/renderer/src/components/DebugPanel.tsx"), "utf8");
  const debugStore = readFileSync(join(root, "../shared/renderer/src/debugLogStore.ts"), "utf8");
  for (const contract of [
    "desktop:diagnostics-record",
    "desktop:diagnostics-snapshot",
    "desktop:diagnostics-clear",
    "desktop:diagnostics-export",
    "classifyDiagnosticChannel(channel)",
    "renderer.process-gone",
  ]) assert.ok(mainIndex.includes(contract), `Missing main diagnostic contract: ${contract}`);
  assert.ok(preload.includes("onDiagnosticEvent"));
  assert.ok(debugStore.includes("isBenignResizeObserverError(message)"), "ResizeObserver browser warnings must be classified before recording a renderer failure.");
  assert.ok(debugStore.includes('operation: "resize-observer.warning"') && debugStore.includes('status: "completed"'), "ResizeObserver warnings must not degrade renderer health.");
  for (const contract of ["AgentDiagnosticView", "AppErrorView", "IncidentCard", "DiagnosticOverview", "TraceCard", "DiagnosticErrorCard", "Current execution"]) {
    assert.ok(panel.includes(contract), `Missing diagnostic UI contract: ${contract}`);
  }

  console.log("Unified diagnostics verification passed (protocol, trace aggregation, dedupe, persistence, redaction, stack parsing, health, IPC, and F12 UI)." );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
