import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = await mkdtemp(join(tmpdir(), "opendrsai-diagnostics-"));
process.env.DRSAI_HOME = home;
try {
  const { DesktopDiagnostics } = await import("../main/diagnostics.ts");
  const diagnostics = new DesktopDiagnostics(); const published: unknown[] = [];
  diagnostics.setPublisher((event) => published.push(event)); await diagnostics.initialize();
  const recorded = await diagnostics.record({ id: "event-fixed", traceId: "trace-fixed", spanId: "span-fixed", module: "desktop", component: "test", operation: "test.record", kind: "error", level: "error", status: "failed", message: "Authorization: Bearer secret-diagnostic-token", attributes: { apiKey: "secret-api-key", safe: "visible" } });
  assert.doesNotMatch(JSON.stringify(recorded), /secret-diagnostic-token|secret-api-key/); assert.match(recorded.message, /redacted/i);
  const duplicate = await diagnostics.record({ ...recorded, message: "must not replace" }); assert.equal(duplicate.id, recorded.id);
  assert.equal(published.length, 1, "idempotent event must publish once");
  const snapshot = await diagnostics.snapshot({ traceId: "trace-fixed", limit: 10 });
  assert.equal(snapshot.events.length, 1); assert.equal(snapshot.findings.some((item) => item.eventId === recorded.id), true);
  await diagnostics.record({ traceId: "trace-other", module: "desktop", component: "test", operation: "test.other", message: "must stay isolated" });
  await diagnostics.record({ traceId: "trace-fixed", module: "desktop", component: "test", operation: "test.redacted", message: "Contact person@example.com using sk-supersecret123456", attributes: { safe: "must-not-leak" }, source: { file: "C:\\Users\\secret\\private.ts" }, stack: [{ raw: "private stack", file: "private.ts" }] });
  const safeTrace = await diagnostics.getRedactedTrace("trace-fixed");
  assert.ok(safeTrace); assert.equal(safeTrace.events.every((event) => event.traceId === "trace-fixed"), true, "trace query must be isolated");
  const safeJson = JSON.stringify(safeTrace);
  assert.doesNotMatch(safeJson, /must stay isolated|person@example\.com|sk-supersecret123456|must-not-leak|private stack|private\.ts/);
  assert.equal(safeJson.includes("attributes"), false); assert.equal(safeJson.includes("source"), false); assert.equal(safeJson.includes("stack"), false);
  await assert.rejects(() => diagnostics.getRedactedTrace("../trace-fixed"), /Invalid diagnostic traceId/);
  assert.equal(await diagnostics.getRedactedTrace("trace-missing"), null);
  const exported = await diagnostics.serializeExport(); assert.doesNotMatch(exported, /secret-diagnostic-token|secret-api-key/); assert.equal(JSON.parse(exported).schemaVersion, 1);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  const eventsFile = join(home, "desktop", "diagnostics", "events.jsonl"); assert.equal((await stat(eventsFile)).isFile(), true); assert.doesNotMatch(await readFile(eventsFile, "utf8"), /secret-diagnostic-token|secret-api-key/);
  const restarted = new DesktopDiagnostics(); await restarted.initialize(); assert.equal((await restarted.snapshot({ traceId: "trace-fixed" })).events.length, 2, "persisted events must recover after restart");
  const issue = await diagnostics.updateIssue({ action: "mark-known", clusterId: snapshot.rootCause.clusters[0]?.id ?? "cluster-test", note: "Known test failure" });
  assert.equal(typeof issue.updated, "boolean");
  assert.equal(await diagnostics.clear(), 3); assert.equal((await diagnostics.snapshot()).events.length, 0);
  console.log("Desktop diagnostic persistence, idempotency, redaction, export and clear verification passed.");
} finally { await rm(home, { recursive: true, force: true }); }
