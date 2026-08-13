import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const root = process.cwd();
const storePath = join(root, "../shared/renderer/src/debugLogStore.ts");
const storeSource = readFileSync(storePath, "utf8");
const panelSource = readFileSync(join(root, "../shared/renderer/src/components/DebugPanel.tsx"), "utf8");
const stylesSource = readFileSync(join(root, "../shared/renderer/src/styles.css"), "utf8");
const clipboardPath = join(root, "../shared/renderer/src/clipboard.ts");
const clipboardSource = readFileSync(clipboardPath, "utf8");
const workspaceSource = readFileSync(join(root, "../shared/renderer/src/components/ChatWorkspace.tsx"), "utf8");
const adapterSource = readFileSync(join(root, "../shared/renderer/src/adapters/useDesktopChatAdapter.ts"), "utf8");
const desktopApiSource = readFileSync(join(root, "../shared/api/desktopApi.ts"), "utf8");
const sensitiveDataPath = join(root, "../shared/api/sensitiveData.ts");
const sensitiveDataSource = readFileSync(sensitiveDataPath, "utf8");
const mainChatSource = readFileSync(join(root, "../shared/main/chat.ts"), "utf8");

const output = ts.transpileModule(storeSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName: storePath,
}).outputText;
const sensitiveDataOutput = ts.transpileModule(sensitiveDataSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName: sensitiveDataPath,
}).outputText;
const sensitiveDataModule = { exports: {} };
new Function("exports", "module", "require", sensitiveDataOutput)(sensitiveDataModule.exports, sensitiveDataModule, () => {
  throw new Error("sensitiveData must not have runtime imports");
});
const storeModule = { exports: {} };
new Function("exports", "module", "require", output)(storeModule.exports, storeModule, (specifier) => {
  if (specifier === "../../api/sensitiveData") return sensitiveDataModule.exports;
  throw new Error(`debugLogStore has an unexpected runtime import: ${specifier}`);
});
const store = storeModule.exports;

store.clearDebugLogs();
const baseActivity = {
  id: "activity-1",
  kind: "tool",
  turnId: "turn-1",
  timestamp: "2026-07-17T08:00:00.000Z",
  source: "gateway",
  status: "running",
  title: "Run analysis",
  toolName: "run_powershell",
  callId: "call-1",
  input: { command: "echo test" },
};
store.appendStructuredActivityLog(baseActivity);
store.appendStructuredActivityLog({
  ...baseActivity,
  timestamp: "2026-07-17T08:00:01.000Z",
  status: "completed",
  output: "ok",
  durationMs: 1000,
});
let entries = store.getDebugLogs();
assert.equal(entries.length, 1, "Activity updates must replace the existing timeline item.");
assert.equal(entries[0].activityStatus, "completed");
assert.equal(entries[0].durationMs, 1000);
assert.equal(entries[0].activity.output, "ok", "The typed activity payload must remain available to the detail view.");
assert.match(entries[0].raw, /"output": "ok"/);

store.appendStructuredProtocolLog({
  version: 2,
  type: "part.delta",
  turnId: "turn-1",
  partId: "answer",
  sequence: 3,
  dedupeKey: "turn-1:3",
  timestamp: "2026-07-17T08:00:02.000Z",
  source: "gateway",
  delta: { kind: "markdown.append", text: "Result" },
});
entries = store.getDebugLogs();
assert.equal(entries.length, 2);
assert.equal(entries[1].source, "protocol");
assert.equal(entries[1].turnId, "turn-1");
assert.equal(entries[1].partId, "answer");

store.appendRuntimeLogEvent({
  id: "runtime-log-1", timestamp: "2026-07-17T08:00:03.000Z", level: "debug", status: "running",
  protocol: "oaep/1", phase: "event", operation: "oaep.event.received", message: "event.item.delta · sequence 42",
  threadId: "thread-1", sessionId: "session-1", runId: "run-1", itemId: "item-1", eventType: "event.item.delta",
  sequence: 42, cursor: 42, source: "codex", details: { eventId: "event-42", data: { delta: { text: "hello" } } },
});
entries = store.getDebugLogs();
assert.equal(entries[2].source, "runtime");
assert.equal(entries[2].runtime.protocol, "oaep/1");
assert.equal(entries[2].runtime.sequence, 42);
assert.match(entries[2].raw, /"eventId": "event-42"/);
store.appendRuntimeLogEvent({
  id: "runtime-log-2", timestamp: "2026-07-17T08:00:03.100Z", level: "debug", status: "running",
  protocol: "oaep/1", phase: "event", operation: "oaep.event.received", message: "event.item.delta · sequence 43",
  threadId: "thread-1", sessionId: "session-1", runId: "run-1", itemId: "item-1", eventType: "event.item.delta",
  sequence: 43, cursor: 43, source: "codex", details: { eventId: "event-43", data: { delta: { text: " world" } } },
});
entries = store.getDebugLogs();
assert.equal(entries.length, 3, "Consecutive Runtime deltas must coalesce into one display record.");
assert.equal(entries[2].coalescedCount, 2);
assert.equal(entries[2].runtime.sequence, 43);

store.appendStructuredActivityLog({
  ...baseActivity,
  id: "activity-secret",
  input: { api_key: "sk-visual-secret-canary", email: "visual@example.org" },
});
entries = store.getDebugLogs();
assert.doesNotMatch(entries.at(-1).raw, /sk-visual-secret-canary|visual@example\.org/);
assert.match(entries.at(-1).raw, /REDACTED/);

store.clearDebugLogs();
assert.equal(store.getDebugLogs().length, 0, "Clear must affect only this debug store.");

const clipboardOutput = ts.transpileModule(clipboardSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName: clipboardPath,
}).outputText;

function loadClipboard({ desktopAvailable, desktopResult }) {
  const clipboardModule = { exports: {} };
  new Function("exports", "module", "require", clipboardOutput)(
    clipboardModule.exports,
    clipboardModule,
    () => ({
      desktopApi: {
        copyTextToClipboard: async () => desktopResult,
      },
      hasDesktopApi: () => desktopAvailable,
    }),
  );
  return clipboardModule.exports;
}

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
let browserCopies = 0;
let fallbackCopies = 0;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    clipboard: {
      writeText: async () => {
        browserCopies += 1;
      },
    },
  },
});
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    body: {
      appendChild: () => undefined,
    },
    createElement: () => ({
      value: "",
      style: {},
      setAttribute: () => undefined,
      select: () => undefined,
      remove: () => undefined,
    }),
    execCommand: () => {
      fallbackCopies += 1;
      return true;
    },
  },
});
try {
  assert.equal(
    await loadClipboard({ desktopAvailable: true, desktopResult: true }).copyTextSafely("desktop"),
    true,
  );
  assert.equal(browserCopies, 0, "Successful desktop clipboard writes must not invoke browser permissions.");

  assert.equal(
    await loadClipboard({ desktopAvailable: false, desktopResult: false }).copyTextSafely("browser"),
    true,
  );
  assert.equal(browserCopies, 1, "Browser clipboard fallback was not used.");

  globalThis.navigator.clipboard.writeText = async () => {
    throw new Error("permission denied");
  };
  assert.equal(
    await loadClipboard({ desktopAvailable: false, desktopResult: false }).copyTextSafely("legacy"),
    true,
  );
  assert.equal(fallbackCopies, 1, "Legacy copy fallback was not used.");
} finally {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else delete globalThis.navigator;
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else delete globalThis.document;
}

for (const contract of [
  'type DebugView = "agent" | "app-errors" | "runtime" | "overview" | "traces" | "errors" | "causes" | "interactive" | "production" | "activity" | "raw"',
  'role="tablist"',
  'view === "overview"',
  'view === "traces"',
  'view === "errors"',
  'groupActivities(visible.filter((entry) => entry.source === "activity"))',
  "copyTextSafely(body)",
  "window.openDrSai.clearDiagnostics()",
  "getActivityDetails(activity, zh)",
  "getActivityPayloads(activity, zh)",
  'open={entry.activityStatus === "error" || undefined}',
  "debug-activity-missing-error",
  "copyTextSafely(copyText)",
  'en: "Runtime Log"',
  'en: "App Errors"',
  "function AgentDiagnosticView",
  "function AppErrorView",
  "function IncidentCard",
  'snapshot?.agentRuns ?? []',
  'snapshot?.incidents ?? []',
  "function RuntimeLogEntry",
  "matchesRuntimeScope(entry, runtimeScope, activeRun)",
  'type RuntimeLogScope = "current-agent" | "all-agent" | "app" | "all"',
  "entry.coalescedCount",
]) {
  assert.ok(panelSource.includes(contract), `Missing DebugPanel contract: ${contract}`);
}
for (const contract of [".debug-activity-entry > summary", ".debug-activity-details pre", ".debug-activity-missing-error", ".debug-runtime-entry > summary", ".debug-runtime-details > section > pre", ".agent-current-state", ".diagnostic-incident-card", ".debug-advanced-tabs"]) {
  assert.ok(stylesSource.includes(contract), `Missing activity detail style: ${contract}`);
}
assert.ok(adapterSource.includes("appendStructuredProtocolLog(structuredEvent)"));
assert.ok(adapterSource.includes("appendStructuredActivityLog(structuredEvent.activity)"));
assert.ok(workspaceSource.includes("data-structured-turn-id={message.structuredTurn?.turnId}"));
assert.ok(workspaceSource.includes("structuredTurnFocus.turnId"));
assert.ok(adapterSource.includes("restoreActiveStructuredTurns(restoredMessages)"));
assert.ok(adapterSource.includes("settleInterruptedStructuredTurn("));
assert.ok(adapterSource.includes("30_000"), "Interrupted turns need a bounded recovery wait.");
assert.match(desktopApiSource, /type:\s*"start"[^;]+\|\s*"connection"\s*\|/);
assert.ok(desktopApiSource.includes('source: "gateway" | "remote-gateway" | "opendrsai-runtime" | "codex-runtime"'));
assert.ok(mainChatSource.includes('source === "remote-gateway" ? "remote-runtime"'), "Remote gateway activity must retain its diagnostic component mapping.");
assert.ok(mainChatSource.includes('"opendrsai-runtime"') && mainChatSource.includes('"codex-runtime"'));
assert.ok(adapterSource.includes('event.type === "connection" && event.connection'));
assert.ok(adapterSource.includes('kind: "retry"'));
assert.ok(adapterSource.includes('!structuredRequests.current.has(event.requestId)'), "Native V2 streams must remain authoritative during reconnects.");
assert.ok(adapterSource.includes("appendConnectionActivity(message.structuredTurn, turnId, activity)"));

console.log("Structured debug verification passed (activity upsert, raw capture, reconnect timeline, clear isolation, turn navigation)." );
