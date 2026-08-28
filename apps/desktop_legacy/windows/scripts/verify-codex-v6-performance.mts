import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { OaepEvent, OaepItem, OaepRun } from "../../shared/api/oaep.generated";
import { reduceOaepEvent } from "../../shared/main/oaepSessionStream";
const sessionId = "session-v6-load";
const runId = "run-v6-load";
const itemId = "item-v6-load";
const source = { backend: "codex" };
const items = new Map<string, OaepItem>();
const runs = new Map<string, OaepRun>();
const event = (sequence: number, type: OaepEvent["type"], data: OaepEvent["data"]): OaepEvent => ({
  version: "1.0", event_id: `event-${sequence}`, session_id: sessionId, run_id: runId,
  item_id: itemId, sequence, type, timestamp: "2026-08-04T00:00:00Z",
  dedupe_key: `dedupe-${sequence}`, source, data,
});
const baseItem = {
  id: itemId, session_id: sessionId, run_id: runId, type: "message", status: "running",
  sequence: 1, created_at: "2026-08-04T00:00:00Z", updated_at: "2026-08-04T00:00:00Z",
  source, content: { role: "assistant", phase: "final", text: "", parts: [], citations: [] },
} satisfies OaepItem;

const started = performance.now();
reduceOaepEvent(items, runs, event(1, "event.item.started", { item: baseItem }));
for (let sequence = 2; sequence < 10_000; sequence += 1) {
  reduceOaepEvent(items, runs, event(sequence, "event.item.delta", {
    delta: { kind: "message.text.append", text: "x" },
  }));
}
const terminal = {
  ...baseItem,
  status: "completed",
  content: { ...baseItem.content, text: "x".repeat(9_998), parts: [{ type: "text" as const, text: "x".repeat(9_998) }] },
} satisfies OaepItem;
reduceOaepEvent(items, runs, event(10_000, "event.item.completed", { item: terminal }));
const elapsedMs = performance.now() - started;

assert.equal(items.size, 1, "10k lifecycle Events must retain one stable Item identity.");
assert.equal(items.get(itemId)?.content.text.length, 9_998);
assert.equal(items.get(itemId)?.status, "completed");
assert.ok(elapsedMs < 3_000, `10k OAEP reduction exceeded the 3s gate: ${elapsedMs.toFixed(1)}ms`);
console.log(`Codex V6 10k-event performance verification passed (${elapsedMs.toFixed(1)}ms).`);
