import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { subscribeOaepSession } from "../../shared/main/oaepSessionStream";
import type { OaepEvent, RuntimeClient } from "../../shared/main/runtimeClient";

const sessionId = "session-v6";
const runId = "run-v6";
const itemId = "item-v6";
const source = { backend: "codex" };
const item = (status: "running" | "completed", text: string) => ({
  id: itemId, session_id: sessionId, run_id: runId, type: "message", status, sequence: 1,
  created_at: "2026-08-04T00:00:00Z", updated_at: "2026-08-04T00:00:01Z", source,
  content: { role: "assistant", phase: "final", text, parts: [], citations: [] },
});
const events: OaepEvent[] = [
  { version: "1.0", event_id: "e1", session_id: sessionId, run_id: runId, item_id: itemId,
    sequence: 1, type: "event.item.started", timestamp: "2026-08-04T00:00:00Z", dedupe_key: "d1", source,
    data: { item: item("running", "") } },
  { version: "1.0", event_id: "e2", session_id: sessionId, run_id: runId, item_id: itemId,
    sequence: 2, type: "event.item.delta", timestamp: "2026-08-04T00:00:01Z", dedupe_key: "d2", source,
    data: { delta: { kind: "message.text.append", text: "Hel" } } },
  { version: "1.0", event_id: "e3", session_id: sessionId, run_id: runId, item_id: itemId,
    sequence: 3, type: "event.item.completed", timestamp: "2026-08-04T00:00:02Z", dedupe_key: "d3", source,
    data: { item: item("completed", "Hello.") } },
] as OaepEvent[];

let streamController!: ReadableStreamDefaultController<Uint8Array>;
let streamOpenCount = 0;
let replayCount = 0;
const encoder = new TextEncoder();
const stream = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
const client = {
  getOaepSnapshot: async () => ({
    version: "1.0", session: { id: sessionId }, runs: [], items: [], snapshot_sequence: 0,
  }),
  listOaepEvents: async () => {
    replayCount += 1;
    return { version: "1.0", object: "list", data: [], next_sequence: 0, has_more: false };
  },
  openOaepEventStream: async () => {
    streamOpenCount += 1;
    return { response: new Response(null, { status: 200 }), events: stream };
  },
} as unknown as RuntimeClient;

const received: string[] = [];
const subscription = await subscribeOaepSession(client, sessionId, {
  onEvent(event) { received.push(event.event_id); },
});
for (const event of events) streamController.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
await new Promise((resolve) => setTimeout(resolve, 30));

assert.deepEqual(received, ["e1", "e2", "e3"]);
assert.equal(subscription.cursor, 3);
assert.equal(subscription.state.items.get(itemId)?.content.text, "Hello.", "terminal Item must authoritatively replace accumulated delta text");
assert.equal(streamOpenCount, 1, "one Session must use one SSE transport");
assert.equal(replayCount, 1, "initial replay must close the snapshot-to-stream race");
assert.equal(subscription.metrics.snapshots, 1);
assert.equal(subscription.metrics.replayEvents, 0);
assert.equal(subscription.metrics.streamEvents, 3);
assert.equal(subscription.metrics.protocolViolations, 0);
subscription.stop();
streamController.close();

const chat = await readFile(resolve(process.cwd(), "../shared/main/chat.ts"), "utf8");
const start = chat.indexOf("async function runRuntimeBackendChat(");
const end = chat.indexOf("function emitCodexOaepEvent(", start);
const runtimeChat = chat.slice(start, end);
assert(runtimeChat.includes("subscribeOaepSession("), "live Runtime chat must consume the shared OAEP stream");
assert(!runtimeChat.includes("listOaepEvents("), "live Runtime chat must not fall back to 100ms OAEP polling");

console.log("Shared OAEP Session stream verification passed.");
