import assert from "node:assert/strict";
import { subscribeSessionConversation } from "../../shared/main/sessionConversationSubscription.ts";
import {
  projectRuntimeThreadSnapshot,
  runtimeConversationDigest,
} from "../../shared/main/threadRuntimeProjection.ts";
import type {
  RuntimeConversationSnapshot,
  RuntimeSessionEvent,
  RuntimeSessionEventStream,
} from "../../shared/main/runtimeClient.ts";

const encoder = new TextEncoder();
const sessionId = "session-subscription-one";
const item = {
  item_id: "item-1", session_id: sessionId, run_id: null, kind: "message" as const,
  role: "user" as const, revision: 1, session_sequence: 2,
  source_client: "windows" as const, source_message_id: "windows-1",
  created_at: "2026-07-27T00:00:00Z", updated_at: "2026-07-27T00:00:00Z",
  payload: { content: "hello" },
};
const snapshots: RuntimeConversationSnapshot[] = [
  { session_id: sessionId, snapshot_sequence: 1, items: [], next_cursor: null },
  { session_id: sessionId, snapshot_sequence: 3, items: [item], next_cursor: null },
];
const event = (sequence: number): RuntimeSessionEvent => ({
  event_id: `event-${sequence}`, runtime_id: "runtime-1", workspace_id: "workspace-1",
  session_id: sessionId, run_id: null, session_sequence: sequence,
  kind: "conversation.item.upsert", timestamp: "2026-07-27T00:00:00Z",
  payload: { item_id: `item-${sequence}` },
});
const streams = [
  [event(2), event(2), event(4)], // duplicate is ignored; gap forces snapshot.
  [event(4)],
];
let snapshotCalls = 0;
const transport = {
  async getConversationSnapshot() {
    return snapshots[Math.min(snapshotCalls++, snapshots.length - 1)];
  },
  async openSessionEventStream(_id: string, _cursor: number, signal: AbortSignal): Promise<RuntimeSessionEventStream> {
    const events = streams.shift() ?? [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const value of events) {
          controller.enqueue(encoder.encode(`id: ${value.session_sequence}\nevent: session.event\ndata: ${JSON.stringify(value)}\n\n`));
        }
        controller.close();
      },
      cancel() { signal.throwIfAborted(); },
    });
    return { response: new Response(body), events: body };
  },
};
const applied: number[] = [];
const subscription = subscribeSessionConversation(transport, sessionId, {
  onSnapshot(snapshot) {
    if (snapshot.snapshot_sequence === 3) applied.push(3);
  },
  onEvent(value) {
    applied.push(value.session_sequence);
    if (value.session_sequence === 4) subscription.stop();
  },
}, { retryDelayMs: 10 });
await subscription.done;
assert.equal(snapshotCalls, 2);
assert.deepEqual(applied, [2, 3, 4]);
assert.equal(subscription.cursor, 4);
const projected = projectRuntimeThreadSnapshot({
  id: "desktop-thread-one", kind: "chat", title: "Shared conversation",
  createdAt: "2026-07-27T00:00:00Z", updatedAt: "2026-07-27T00:00:00Z",
}, [
  item,
  {
    ...item, item_id: "android-message-1", session_sequence: 3,
    source_client: "android", source_message_id: "android-1",
    payload: { content: "hello from Android" },
  },
  {
    ...item, item_id: "reasoning-1", kind: "reasoning", role: null,
    session_sequence: 4, source_client: "runtime", source_message_id: null,
    payload: { text: "thinking" },
  },
  {
    ...item, item_id: "tool-1", kind: "tool", role: "tool",
    session_sequence: 5, source_client: "runtime", source_message_id: null,
    payload: { name: "shell", status: "completed" },
  },
]);
assert.equal(projected.messages[0].content, "hello");
assert.equal(projected.messages[1].content, "hello from Android");
assert.equal(projected.messages[2].reasoningContent, "thinking");
assert.equal(projected.messages[3].statusContent, "Tool: shell · completed");
const digestFixture = [
  {
    ...item,
    item_id: "one",
    session_id: "session-one",
    run_id: "run-one",
    source_message_id: "source-one",
    session_sequence: 1,
    payload: { z: 2, a: [true, "值"] },
  },
  {
    ...item,
    item_id: "two",
    session_id: "session-one",
    run_id: "run-one",
    source_message_id: "source-two",
    session_sequence: 2,
    payload: { content: "hello" },
  },
];
assert.equal(
  runtimeConversationDigest(digestFixture),
  "ea44f0e94828575e7dffdd66a0c1512580bf338c0549d2b7b04686078feaf3c9",
);
console.log("Session Conversation subscription verification passed.");
