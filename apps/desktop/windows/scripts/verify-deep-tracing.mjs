import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "opendrsai-deep-tracing-"));
const require = createRequire(import.meta.url);

function loadTypeScript(path, requireFn) {
  const source = readFileSync(path, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: path }).outputText;
  const loaded = { exports: {} };
  new Function("exports", "module", "require", output)(loaded.exports, loaded, requireFn);
  return loaded.exports;
}

try {
  const shared = loadTypeScript(join(root, "src/shared/diagnostics.ts"), require);
  const rootCause = loadTypeScript(join(root, "src/main/rootCauseAnalysis.ts"), (specifier) => {
    if (specifier === "../shared/diagnostics") return shared;
    return require(specifier);
  });
  const diagnosticsModule = loadTypeScript(join(root, "src/main/diagnostics.ts"), (specifier) => {
    if (specifier === "../shared/diagnostics") return shared;
    if (specifier === "./rootCauseAnalysis") return rootCause;
    if (specifier === "./paths") return { DRSAI_HOME: tempRoot };
    return require(specifier);
  });
  const contextModule = loadTypeScript(join(root, "src/main/diagnosticContext.ts"), require);
  const diagnostics = new diagnosticsModule.DesktopDiagnostics();
  const rootOperation = await diagnostics.start({ traceId: "deep-trace", spanId: "root-span", module: "runtime", component: "runtime-engine", operation: "run.execute", message: "Run started" });
  const child = await diagnostics.start({ traceId: "deep-trace", spanId: "child-span", parentSpanId: rootOperation.spanId, module: "tool", component: "browser", operation: "browser.click", message: "Browser click started" });
  await child.complete("Browser click completed", { queueMs: 12 });
  await diagnostics.record({ traceId: "deep-trace", spanId: "remote-span", parentSpanId: rootOperation.spanId, module: "runtime", component: "remote-runtime", operation: "runtime.request.accepted", message: "Remote accepted", status: "completed", durationMs: 0, machineId: "remote-machine", sequence: 5, attributes: { clockOffsetMs: 37, remote: true } });
  await rootOperation.complete("Run completed");
  await diagnostics.record({ traceId: "active-trace", spanId: "active-root", module: "workspace", component: "terminal", operation: "terminal.command", message: "Terminal command running", status: "waiting" });
  await diagnostics.record({ traceId: "slow-trace", spanId: "slow-span", parentSpanId: "missing-parent", module: "tool", component: "mcp", operation: "mcp.retry", message: "MCP retry 1", status: "completed", durationMs: 11_000 });
  await diagnostics.record({ traceId: "slow-trace", spanId: "retry-2", module: "tool", component: "mcp", operation: "mcp.retry", message: "MCP retry 2", status: "completed", durationMs: 2 });
  await diagnostics.record({ traceId: "slow-trace", spanId: "retry-3", module: "tool", component: "mcp", operation: "mcp.retry", message: "MCP retry 3", status: "completed", durationMs: 2 });

  const snapshot = await diagnostics.snapshot({ limit: 100 });
  const trace = snapshot.traces.find((item) => item.traceId === "deep-trace");
  assert.ok(trace);
  assert.equal(trace.status, "completed");
  assert.ok((trace.criticalPathMs ?? -1) >= 0);
  assert.ok((trace.machineIds?.length ?? 0) >= 2);
  assert.ok(snapshot.deepTracing.performance.some((item) => item.operation === "run.execute" && item.count === 1));
  assert.ok(snapshot.deepTracing.performance.some((item) => item.operation === "browser.click"));
  assert.equal(snapshot.deepTracing.clockOffsets.find((item) => item.machineId === "remote-machine")?.offsetMs, 37);
  assert.ok(snapshot.deepTracing.activeCheckpoints.some((item) => item.traceId === "active-trace"));
  assert.ok(snapshot.deepTracing.resources.at(-1)?.rssBytes > 0);
  assert.ok(snapshot.findings.some((item) => item.id.startsWith("orphan:")));
  assert.ok(snapshot.findings.some((item) => item.id.startsWith("slow:")));
  assert.ok(snapshot.findings.some((item) => item.id.startsWith("retries:")));

  const propagated = await contextModule.runWithDiagnosticContext({ traceId: "trace-context", spanId: "span-context", workspaceId: "workspace-1" }, async () => contextModule.getDiagnosticPropagationHeaders());
  assert.match(propagated.traceparent, /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  assert.equal(propagated["X-OpenDrSai-Trace-ID"], "trace-context");
  assert.equal(propagated["X-OpenDrSai-Workspace-ID"], "workspace-1");
  assert.ok(Number(propagated["X-OpenDrSai-Sent-At"]) > 0);

  await new Promise((resolve) => setTimeout(resolve, 80));
  const restored = new diagnosticsModule.DesktopDiagnostics();
  const restoredSnapshot = await restored.snapshot({ limit: 100 });
  assert.equal(restoredSnapshot.traces.find((item) => item.traceId === "active-trace")?.recovered, true);
  assert.ok(restoredSnapshot.deepTracing.activeCheckpoints.some((item) => item.traceId === "active-trace" && item.recovered));

  const mainIndex = readFileSync(join(root, "src/main/index.ts"), "utf8");
  const runtimeClient = readFileSync(join(root, "src/main/runtimeClient.ts"), "utf8");
  const gateway = readFileSync(join(root, "../../../cores/python/packages/drsai/src/drsai/backend/gateway.py"), "utf8");
  const panel = readFileSync(join(root, "src/renderer/src/components/DebugPanel.tsx"), "utf8");
  for (const contract of ["runWithDiagnosticContext", "recordBrowserTaskDiagnostic", "diagnostic.trace.recovered"]) assert.ok(mainIndex.includes(contract) || readFileSync(join(root, "src/main/diagnostics.ts"), "utf8").includes(contract), `Missing deep tracing contract: ${contract}`);
  assert.ok(runtimeClient.includes("getDiagnosticPropagationHeaders"));
  for (const contract of ["diagnostic_trace_id", "diagnostic_clock_offset_ms", "trace.request.accepted"]) assert.ok(gateway.includes(contract), `Missing Gateway trace contract: ${contract}`);
  for (const contract of ["Performance hotspots", "diagnostic-waterfall", "critical", "active checkpoints"]) assert.ok(panel.includes(contract), `Missing deep tracing UI contract: ${contract}`);

  console.log("Deep tracing verification passed (business spans, propagation, clock offsets, recovery, performance, resources, browser events, and waterfall UI).");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
