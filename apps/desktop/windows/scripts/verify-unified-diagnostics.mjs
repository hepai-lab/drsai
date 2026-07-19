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

const sharedPath = join(root, "src/shared/diagnostics.ts");
const shared = loadTypeScript(sharedPath, (specifier) => { throw new Error(`Unexpected shared import: ${specifier}`); });
const rootCause = loadTypeScript(join(root, "src/main/rootCauseAnalysis.ts"), (specifier) => {
  if (specifier === "../shared/diagnostics") return shared;
  return require(specifier);
});
const mainPath = join(root, "src/main/diagnostics.ts");
const main = loadTypeScript(mainPath, (specifier) => {
  if (specifier === "../shared/diagnostics") return shared;
  if (specifier === "./rootCauseAnalysis") return rootCause;
  if (specifier === "./paths") return { DRSAI_HOME: tempRoot };
  return require(specifier);
});

try {
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

  const exported = await diagnostics.serializeExport();
  assert.match(exported, /OpenDrSai Desktop/);
  assert.doesNotMatch(exported, /secret-token|secret-key|must-not-exist/);

  await new Promise((resolve) => setTimeout(resolve, 80));
  const reloaded = new main.DesktopDiagnostics();
  const restored = await reloaded.snapshot({ limit: 100 });
  assert.ok(restored.events.some((event) => event.traceId === "trace-failed"), "Persisted diagnostics must survive a service restart.");

  const removed = await diagnostics.clear();
  assert.ok(removed >= 6);
  assert.equal((await diagnostics.snapshot()).events.length, 0);

  const mainIndex = readFileSync(join(root, "src/main/index.ts"), "utf8");
  const preload = readFileSync(join(root, "src/preload/index.ts"), "utf8");
  const panel = readFileSync(join(root, "src/renderer/src/components/DebugPanel.tsx"), "utf8");
  for (const contract of [
    "desktop:diagnostics-record",
    "desktop:diagnostics-snapshot",
    "desktop:diagnostics-clear",
    "desktop:diagnostics-export",
    "classifyDiagnosticChannel(channel)",
    "renderer.process-gone",
  ]) assert.ok(mainIndex.includes(contract), `Missing main diagnostic contract: ${contract}`);
  assert.ok(preload.includes("onDiagnosticEvent"));
  for (const contract of ["DiagnosticOverview", "TraceCard", "DiagnosticErrorCard", "Current execution"]) {
    assert.ok(panel.includes(contract), `Missing diagnostic UI contract: ${contract}`);
  }

  console.log("Unified diagnostics verification passed (protocol, trace aggregation, dedupe, persistence, redaction, stack parsing, health, IPC, and F12 UI)." );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
