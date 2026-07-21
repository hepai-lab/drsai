import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const root = process.cwd();
const storePath = join(root, "../shared/renderer/src/debugLogStore.ts");
const storeSource = readFileSync(storePath, "utf8");
const panelSource = readFileSync(join(root, "../shared/renderer/src/components/DebugPanel.tsx"), "utf8");
const workspaceSource = readFileSync(join(root, "../shared/renderer/src/components/ChatWorkspace.tsx"), "utf8");
const adapterSource = readFileSync(join(root, "../shared/renderer/src/adapters/useDesktopChatAdapter.ts"), "utf8");
const desktopApiSource = readFileSync(join(root, "../shared/api/desktopApi.ts"), "utf8");
const mainChatSource = readFileSync(join(root, "../shared/main/chat.ts"), "utf8");

const output = ts.transpileModule(storeSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName: storePath,
}).outputText;
const storeModule = { exports: {} };
new Function("exports", "module", "require", output)(storeModule.exports, storeModule, () => {
  throw new Error("debugLogStore must not have runtime imports");
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

store.clearDebugLogs();
assert.equal(store.getDebugLogs().length, 0, "Clear must affect only this debug store.");

for (const contract of [
  'type DebugView = "overview" | "traces" | "errors" | "causes" | "interactive" | "production" | "activity" | "raw"',
  'role="tablist"',
  'view === "overview"',
  'view === "traces"',
  'view === "errors"',
  "groupActivities(filtered)",
  "navigator.clipboard.writeText(body)",
  "window.openDrSai.clearDiagnostics()",
  "onSelectTurn?.(entry.turnId)",
]) {
  assert.ok(panelSource.includes(contract), `Missing DebugPanel contract: ${contract}`);
}
assert.ok(adapterSource.includes("appendStructuredProtocolLog(structuredEvent)"));
assert.ok(adapterSource.includes("appendStructuredActivityLog(structuredEvent.activity)"));
assert.ok(workspaceSource.includes("data-structured-turn-id={message.structuredTurn?.turnId}"));
assert.ok(workspaceSource.includes("structuredTurnFocus.turnId"));
assert.ok(adapterSource.includes("restoreActiveStructuredTurns(restoredMessages)"));
assert.ok(adapterSource.includes("settleInterruptedStructuredTurn("));
assert.ok(adapterSource.includes("30_000"), "Interrupted turns need a bounded recovery wait.");
assert.match(desktopApiSource, /type:\s*"start"[^;]+\|\s*"connection"\s*\|/);
assert.ok(desktopApiSource.includes('source: "gateway" | "remote-gateway" | "codex-runtime"'));
assert.ok(mainChatSource.includes('source: remoteGateway ? "remote-gateway" : "gateway"'));
assert.ok(mainChatSource.includes('source: "codex-runtime"'));
assert.ok(adapterSource.includes('event.type === "connection" && event.connection'));
assert.ok(adapterSource.includes('kind: "retry"'));
assert.ok(adapterSource.includes('!structuredRequests.current.has(event.requestId)'), "Native V2 streams must remain authoritative during reconnects.");
assert.ok(adapterSource.includes("appendConnectionActivity(message.structuredTurn, turnId, activity)"));

console.log("Structured debug verification passed (activity upsert, raw capture, reconnect timeline, clear isolation, turn navigation)." );
