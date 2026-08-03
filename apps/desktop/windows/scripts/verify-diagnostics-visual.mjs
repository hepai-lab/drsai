import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const distDir = join(root, "out", "renderer");
const evidenceDir = join(root, "out", "verification", "diagnostics-visual");
const browserCandidates = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
].filter(Boolean);
const chromePath = browserCandidates.find((candidate) => existsSync(candidate));
assert.ok(existsSync(join(distDir, "index.html")), "Build the renderer before diagnostics visual verification.");
assert.ok(chromePath, "Chrome or Edge is required for diagnostics visual verification.");
mkdirSync(evidenceDir, { recursive: true });

const mimeTypes = new Map([[".css", "text/css"], [".html", "text/html"], [".js", "text/javascript"], [".png", "image/png"], [".ttf", "font/ttf"]]);
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  const relativePath = pathname === "/" ? "index.html" : normalize(pathname.replace(/^\/+/, ""));
  let filePath = resolve(distDir, relativePath);
  if (!filePath.startsWith(resolve(distDir)) || !existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(distDir, "index.html");
  response.writeHead(200, { "Content-Type": mimeTypes.get(extname(filePath)) || "application/octet-stream" });
  response.end(readFileSync(filePath));
});

await new Promise((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address === "object");
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

try {
  await page.goto(`http://127.0.0.1:${address.port}?structuredVisualFixture=1`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.setItem("opendrsai.rightSidebarComponents", JSON.stringify({ files: true, browser: true, terminal: true, debug: true })));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /进入开发者工作区|Enter developer workspace/ }).click();
  await page.locator("textarea").last().waitFor({ state: "visible" });
  await page.evaluate(async () => {
    await window.openDrSai.startChat({
      requestId: "activity-visual-request",
      runId: "activity-visual-turn",
      messages: [{ role: "user", content: "__STRUCTURED_VISUAL_FIXTURE__" }],
    });
  });
  await page.evaluate(async () => {
    const timestamp = new Date(Date.now() - 15_000).toISOString();
    const root = { schemaVersion: 1, id: "event-root", traceId: "trace-visual", spanId: "span-root", timestamp, kind: "operation", level: "info", status: "started", module: "runtime", component: "runtime-engine", operation: "chat.run", message: "Chat run started" };
    const waiting = { schemaVersion: 1, id: "event-wait", traceId: "trace-visual", spanId: "span-gateway", parentSpanId: "span-root", timestamp, kind: "snapshot", level: "warn", status: "waiting", module: "runtime", component: "gateway", operation: "chat.connection", message: "Waiting for Gateway response" };
    const failed = { schemaVersion: 1, id: "event-failed", traceId: "trace-error", spanId: "span-error", timestamp, kind: "error", level: "error", status: "failed", module: "backend", component: "codex-adapter", operation: "runtime.agent.failed", message: "Agent execution failed", errorCode: "AGENT_EXECUTION_FAILED", source: { file: "$HOME/drsai/backend/runtime/agent.py", function: "execute", line: 614, language: "python" }, stack: [{ raw: "execute ($HOME/drsai/backend/runtime/agent.py:614)", file: "$HOME/drsai/backend/runtime/agent.py", function: "execute", line: 614, language: "python", inApp: true }] };
    const snapshot = {
      generatedAt: new Date().toISOString(), events: [root, waiting, failed],
      traces: [
        { traceId: "trace-visual", startedAt: timestamp, status: "waiting", rootOperation: "chat.run", events: [root, waiting], activeEvent: waiting },
        { traceId: "trace-error", startedAt: timestamp, endedAt: timestamp, durationMs: 35, status: "failed", rootOperation: "runtime.agent.failed", events: [failed], firstFailure: failed },
      ],
      health: [{ id: "runtime:gateway", module: "runtime", component: "gateway", state: "waiting", message: "Waiting for Gateway response", lastHeartbeatAt: timestamp, restartCount: 0, retryCount: 1, lastTraceId: "trace-visual" }],
      findings: [{ id: "failure:event-failed", severity: "error", title: "Failure in codex-adapter", message: "Agent execution failed", module: "backend", component: "codex-adapter", traceId: "trace-error", eventId: "event-failed", suggestedAction: "Inspect the reported source location and preceding trace events." }],
      deepTracing: { performance: [{ key: "runtime:gateway:chat.connection", module: "runtime", component: "gateway", operation: "chat.connection", count: 3, failureCount: 1, totalDurationMs: 1200, averageDurationMs: 400, p95DurationMs: 800, maxDurationMs: 800 }], resources: [{ timestamp, machineId: "desktop", processId: 4242, rssBytes: 134217728, heapUsedBytes: 67108864, heapTotalBytes: 100663296, externalBytes: 1024, cpuUserMicros: 1000, cpuSystemMicros: 500, eventLoopDelayMs: 1 }], activeCheckpoints: [{ traceId: "trace-visual", rootOperation: "chat.run", status: "waiting", lastEventAt: timestamp, eventCount: 2, machineIds: ["desktop"], recovered: false }], clockOffsets: [] },
      rootCause: { analyses: [{ traceId: "trace-error", primary: { id: "cause-event-failed", traceId: "trace-error", eventId: "event-failed", category: "source-code", severity: "error", confidence: 0.92, recoverable: false, title: "source code failure in codex-adapter", explanation: "runtime.agent.failed is the first failure candidate.", evidenceEventIds: [], propagatedEventIds: [], suggestedActions: ["Open the reported source location and inspect the preceding trace events."] }, alternatives: [], facts: ["One failure event was observed."], inferences: [{ text: "The first in-app frame is the likely cause.", confidence: 0.92 }], uncertainties: [], summary: "The first in-app stack frame is the likely root cause." }], clusters: [{ id: "cluster-visual", fingerprint: "visual", title: "source code in codex-adapter", category: "source-code", state: "open", count: 1, traceIds: ["trace-error"], eventIds: ["event-failed"], firstSeenAt: timestamp, lastSeenAt: timestamp, trend: "new" }], generatedAt: new Date().toISOString() },
      agentRuns: [{ traceId: "trace-error", runId: "activity-visual-turn", sessionId: "session-visual", backendId: "codex-adapter", model: "gpt-5", phase: "failed", status: "failed", action: "Agent execution failed", startedAt: timestamp, phaseStartedAt: timestamp, updatedAt: timestamp, endedAt: timestamp, elapsedMs: 15000, phaseElapsedMs: 15000, connectionState: "disconnected", firstFailure: failed, recentEvents: [{ ...failed, domain: "agent", visibility: "milestone", agentPhase: "failed" }] }],
      incidents: [
        { id: "incident-agent", fingerprint: "agent-visual", domain: "agent", severity: "error", title: "Agent execution failed", message: "Agent execution failed", component: "codex-adapter", operation: "runtime.agent.failed", traceId: "trace-error", runId: "activity-visual-turn", agentPhase: "failed", errorCode: "AGENT_EXECUTION_FAILED", source: failed.source, stack: failed.stack, impact: "The current Agent run stopped before producing a response.", suggestedActions: ["Inspect the source and retry the run."], count: 1, firstSeenAt: timestamp, lastSeenAt: timestamp, contextBefore: [], contextAfter: [] },
        { id: "incident-app", fingerprint: "app-visual", domain: "app", severity: "error", title: "Storage update failed", message: "EPERM while replacing threads.json", component: "thread-store", operation: "workspace.save", errorCode: "EPERM", stack: [], impact: "Thread history could not be persisted.", suggestedActions: ["Check file permissions and retry."], count: 3, firstSeenAt: timestamp, lastSeenAt: timestamp, contextBefore: [], contextAfter: [] },
      ],
      droppedEvents: 0, storage: { eventCount: 3, maxEvents: 5000, persisted: true },
    };
    window.openDrSai.getDiagnosticSnapshot = async () => snapshot;
    await window.openDrSai.recordDiagnostic({ module: "desktop", component: "renderer", operation: "fixture.refresh", message: "Refresh diagnostics", status: "completed" });
  });
  await page.getByRole("button", { name: /显示右侧栏|Show right panel/ }).click();
  await page.getByRole("button", { name: /调试|Debug/ }).click();
  await page.getByText(/运行诊断|Diagnostics/, { exact: true }).waitFor({ state: "visible" });
  await page.getByText(/当前 Agent 状态|Current Agent state/).waitFor({ state: "visible" });
  await page.getByText("Agent execution failed", { exact: true }).first().waitFor({ state: "visible" });
  const agentScreenshot = await page.screenshot({ path: join(evidenceDir, "diagnostics-agent-state.png") });
  assert.ok(agentScreenshot.length > 20_000, "Agent diagnostics screenshot is unexpectedly small.");
  await page.getByRole("tab", { name: /App 错误|App Errors/ }).click();
  await page.getByText("Storage update failed", { exact: true }).waitFor({ state: "visible" });
  const appErrorScreenshot = await page.screenshot({ path: join(evidenceDir, "diagnostics-app-errors.png") });
  assert.ok(appErrorScreenshot.length > 20_000, "App error diagnostics screenshot is unexpectedly small.");
  await page.getByRole("button", { name: /高级|Advanced/ }).click();
  await page.getByRole("tab", { name: /概览|Overview/ }).click();
  await page.getByText(/当前运行位置|Current execution/).waitFor({ state: "visible" });
  assert.equal(await page.getByText("Waiting for Gateway response").count() > 0, true);
  assert.equal(await page.getByText("Failure in codex-adapter").count() > 0, true);

  await page.getByRole("tab", { name: /链路|Traces/ }).click();
  assert.equal(await page.getByText("chat.run", { exact: true }).count() > 0, true);
  await page.getByRole("tab", { name: /全部错误|All Errors/ }).click();
  await page.getByText("Agent execution failed", { exact: true }).first().waitFor({ state: "visible" });
  assert.equal(await page.getByText(/agent\.py:614/).count() > 0, true);
  await page.getByRole("button", { name: /查看代码位置|View source/ }).click();
  await page.getByRole("complementary", { name: /源码查看器|Source inspector/ }).waitFor({ state: "visible" });
  assert.equal(await page.getByText(/源码位置|Source location/, { exact: true }).count() > 0, true);
  assert.equal(await page.locator(".diagnostic-source-code .highlight").count(), 1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert.equal(overflow, false, "Diagnostics UI must not create document-level horizontal overflow.");
  const screenshot = await page.screenshot({ path: join(evidenceDir, "diagnostics-errors.png") });
  const sourceScreenshot = await page.screenshot({ path: join(evidenceDir, "diagnostics-source-navigation.png") });
  assert.ok(screenshot.length > 20_000, "Diagnostics screenshot is unexpectedly small.");
  assert.ok(sourceScreenshot.length > 20_000, "Source navigation screenshot is unexpectedly small.");
  await page.getByRole("button", { name: /关闭源码|Close source/ }).click();
  await page.getByRole("tab", { name: /根因|Causes/ }).click();
  await page.getByText(/根因分析|Root cause analysis/, { exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.getByText(/92%/).count() > 0, true);
  assert.equal(await page.getByText(/错误聚类与趋势|Error clusters and trends/).count() > 0, true);
  const rootCauseScreenshot = await page.screenshot({ path: join(evidenceDir, "diagnostics-root-cause.png") });
  assert.ok(rootCauseScreenshot.length > 20_000, "Root cause screenshot is unexpectedly small.");
  await page.getByRole("tab", { name: /调试|Debug/ }).click();
  await page.getByRole("button", { name: /启动调试|Start debugging/ }).click();
  await page.getByRole("button", { name: /^(暂停|Pause)$/ }).click();
  await page.getByText("mockSource", { exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: /mockSource/ }).click();
  await page.getByText("answer", { exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.getByText("[REDACTED]", { exact: true }).count() > 0, true);
  assert.equal(await page.getByText(/只读求值|Read-only evaluate/, { exact: true }).count() > 0, true);
  const interactiveScreenshot = await page.screenshot({ path: join(evidenceDir, "diagnostics-interactive-debug.png") });
  assert.ok(interactiveScreenshot.length > 20_000, "Interactive debugging screenshot is unexpectedly small.");
  await page.getByRole("tab", { name: /治理|Governance/ }).click();
  await page.getByText(/生产诊断治理|Production diagnostics governance/, { exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: /预览|Preview/ }).click();
  await page.getByText("SHA-256", { exact: true }).waitFor({ state: "visible" });
  const productionScreenshot = await page.screenshot({ path: join(evidenceDir, "diagnostics-production-governance.png") });
  assert.ok(productionScreenshot.length > 20_000, "Production diagnostics screenshot is unexpectedly small.");
  await page.getByRole("tab", { name: /活动|Activity/ }).click();
  await page.getByText("Reflector response", { exact: true }).waitFor({ state: "visible" });
  await page.getByText(/错误详情|Error details/, { exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.getByText("REFLECTOR_TIMEOUT", { exact: false }).count() > 0, true);
  assert.equal(await page.getByText(/调用 ID|Call ID/, { exact: true }).count() > 0, true);
  const activityScreenshot = await page.screenshot({ path: join(evidenceDir, "diagnostics-activity-details.png") });
  assert.ok(activityScreenshot.length > 20_000, "Activity detail screenshot is unexpectedly small.");
  await page.getByRole("tab", { name: /运行日志|Runtime Log/ }).click();
  assert.equal(await page.getByText("Runtime selected OAEP v1 for this session.", { exact: true }).count(), 0, "Current-task scope must hide unrelated Runtime sessions.");
  await page.getByRole("button", { name: /全部 Agent|All Agents/ }).click();
  await page.getByText("Runtime selected OAEP v1 for this session.", { exact: true }).waitFor({ state: "visible" });
  await page.getByText("OAEP event stream connected after cursor 41.", { exact: true }).waitFor({ state: "visible" });
  const oaepEventLog = page.locator(".debug-runtime-entry").filter({ hasText: "event.item.delta · sequence 42" });
  await oaepEventLog.locator(":scope > summary").click();
  await oaepEventLog.getByText(/协议数据|Protocol data/, { exact: true }).waitFor({ state: "visible" });
  assert.equal(await oaepEventLog.getByText(/oaep-event-42/).count() > 0, true);
  assert.equal(await oaepEventLog.getByText(/\[REDACTED\]/).count() > 0, true);
  const runtimeScreenshot = await page.screenshot({ path: join(evidenceDir, "diagnostics-runtime-log-oaep.png") });
  assert.ok(runtimeScreenshot.length > 20_000, "Runtime log screenshot is unexpectedly small.");
  console.log(`Diagnostics visual verification passed (screenshot: ${join(evidenceDir, "diagnostics-errors.png")}).`);
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
