import assert from "node:assert/strict";
import {
  MAX_AUTOMATIC_RETRY_ATTEMPTS,
  oaepRetryDelayMs,
  subscribeOaepSession,
} from "../../shared/main/oaepSessionStream.ts";
import type {
  OaepEvent,
  OaepEventPage,
  OaepItem,
  OaepSnapshot,
  RuntimeClient,
} from "../../shared/main/runtimeClient.ts";

const timestamp = "2026-08-05T00:00:00.000Z";

function item(id: string, runId: string, type: "message" | "tool_call", sequence: number): OaepItem {
  return {
    id,
    session_id: "session-placeholder",
    run_id: runId,
    type,
    status: "completed",
    sequence,
    created_at: timestamp,
    updated_at: timestamp,
    source: { client: "runtime", message_id: `source-${id}` },
    content: type === "tool_call"
      ? { tool_kind: "tool", tool_name: "read_file", call_id: "call-1", arguments: {}, result: "ok" }
      : { role: "assistant", phase: "final", text: "preserved", parts: [], citations: [] },
  } as OaepItem;
}

function event(sessionId: string, runId: string, sequence: number, type: OaepEvent["type"], eventItem?: OaepItem): OaepEvent {
  const normalizedItem = eventItem ? { ...eventItem, session_id: sessionId } : undefined;
  return {
    version: "2026-05-01",
    event_id: `${sessionId}:event:${sequence}`,
    session_id: sessionId,
    run_id: runId,
    ...(normalizedItem ? { item_id: normalizedItem.id } : {}),
    sequence,
    type,
    timestamp,
    dedupe_key: `${sessionId}:dedupe:${sequence}`,
    source: { client: "runtime", message_id: `source-${sequence}` },
    data: normalizedItem ? { item: normalizedItem } : {},
  } as OaepEvent;
}

function sse(events: OaepEvent[], keepOpen = false): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const value of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      if (!keepOpen) controller.close();
    },
  });
}

const shortestRecoveryWindow = Array.from(
  { length: MAX_AUTOMATIC_RETRY_ATTEMPTS - 1 },
  (_, index) => oaepRetryDelayMs(index + 1, 0),
).reduce((total, delay) => total + delay, 0);
assert.ok(shortestRecoveryWindow >= 180_000, "The shortest jitter path must cover a full three-minute outage.");

let accepted = 0;
for (let round = 1; round <= 20; round += 1) {
  const sessionId = `m07-gap-session-${round}`;
  const runId = `m07-gap-run-${round}`;
  const first = event(sessionId, runId, 1, "event.item.completed", item("message-1", runId, "message", 1));
  const missing = event(sessionId, runId, 2, "event.item.completed", item("message-2", runId, "message", 2));
  const tool = event(sessionId, runId, 3, "event.item.completed", item("tool-1", runId, "tool_call", 3));
  const terminal = event(sessionId, runId, 4, "event.run.completed");
  const requestedSessions: string[] = [];
  const replayCursors: number[] = [];
  let snapshots = 0;
  let streams = 0;
  let runExecutions = 0;
  const fakeClient = {
    location: "local",
    streamIdentity: `m07-gap-runtime-${round}`,
    async getOaepSnapshot(requestedSessionId: string): Promise<OaepSnapshot> {
      requestedSessions.push(requestedSessionId);
      snapshots += 1;
      return {
        version: "2026-05-01",
        session: { id: sessionId, workspace_id: "workspace-1", title: "M07 gap", status: "active", created_at: timestamp, updated_at: timestamp },
        runs: [], items: [], snapshot_sequence: 0,
      } as OaepSnapshot;
    },
    async listOaepEvents(requestedSessionId: string, afterSequence = 0): Promise<OaepEventPage> {
      requestedSessions.push(requestedSessionId);
      replayCursors.push(afterSequence);
      const data = afterSequence === 1 ? [missing, tool] : [];
      return { version: "2026-05-01", object: "list", data, next_sequence: data.at(-1)?.sequence ?? afterSequence, has_more: false } as OaepEventPage;
    },
    async openOaepEventStream(requestedSessionId: string, afterSequence: number) {
      requestedSessions.push(requestedSessionId);
      streams += 1;
      assert.equal(afterSequence, streams === 1 ? 0 : 3);
      // Stream one deliberately skips sequence 2. Stream two repeats sequence
      // 3 before the terminal to prove exclusive-cursor deduplication.
      const values = streams === 1 ? [first, tool] : [tool, terminal];
      return { response: new Response(), events: sse(values, streams === 2) };
    },
    async executeAgentRun() {
      runExecutions += 1;
      throw new Error("OAEP recovery must never execute a Run.");
    },
  } as unknown as RuntimeClient;

  const delivered: OaepEvent[] = [];
  let resolveTerminal!: () => void;
  const terminalSeen = new Promise<void>((resolve) => { resolveTerminal = resolve; });
  const subscription = await subscribeOaepSession(fakeClient, sessionId, {
    onEvent(value) {
      delivered.push(value);
      if (value.type === "event.run.completed") resolveTerminal();
    },
  });
  await terminalSeen;
  subscription.stop();
  await subscription.done;

  assert.equal(snapshots, 1, "A recoverable sequence gap must replay, not replace state with a snapshot.");
  assert.deepEqual(replayCursors.slice(0, 2), [0, 1]);
  assert.deepEqual(delivered.map((value) => value.sequence), [1, 2, 3, 4]);
  assert.equal(new Set(delivered.map((value) => value.event_id)).size, 4);
  assert.equal(delivered.filter((value) => value.item_id === "tool-1").length, 1, "A Tool Item must not be projected twice.");
  assert.equal(delivered.filter((value) => value.type === "event.run.completed").length, 1);
  assert.ok(requestedSessions.every((value) => value === sessionId), "Recovery must remain on the same Session.");
  assert.ok(delivered.every((value) => value.run_id === runId), "Recovery must remain on the same Run.");
  assert.equal(runExecutions, 0, "Subscription recovery must not repeat Run execution or side effects.");
  assert.equal(streams, 2);
  assert.equal(subscription.metrics.protocolViolations, 1);
  assert.equal(subscription.metrics.reconnects, 1);
  assert.equal(subscription.metrics.resnapshots, 0);
  // Logical outage coverage rotates deterministically across 60..180 seconds;
  // no wall-clock sleep is required to verify the bounded retry policy.
  const logicalOutageSeconds = 60 + ((round - 1) * 120) / 19;
  assert.ok(shortestRecoveryWindow >= logicalOutageSeconds * 1_000);
  accepted += 1;
}

assert.equal(accepted, 20);
console.log(`M07-F03 OAEP same-Run gap recovery passed: ${accepted}/20 rounds; minimum recovery window ${shortestRecoveryWindow} ms.`);
