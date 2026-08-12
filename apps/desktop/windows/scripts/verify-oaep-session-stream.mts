import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertOaepStreamTransition,
  classifyOaepStreamError,
  oaepRetryDelayMs,
  getOaepSessionOwnershipDiagnostics,
  materializeOaepDeltaShadow,
  reduceOaepEvent,
  subscribeOaepSession,
  type OaepDeltaShadow,
} from "../../shared/main/oaepSessionStream";
import {
  assertOaepEventIntegrity,
  assertOaepSnapshotIntegrity,
  oaepProjectionDigest,
} from "../../shared/main/oaepIntegrity";
import {
  createRuntimeEndpointKey,
  getRuntimeClientRegistryDiagnostics,
  invalidateRuntimeClientRegistry,
  LocalRuntimeClient,
  retainRuntimeClient,
} from "../../shared/main/runtimeClient";
import type { OaepEvent, OaepItem, OaepRun, OaepSnapshot, RuntimeClient } from "../../shared/main/runtimeClient";
import {
  isRuntimeGenerationInvalidated,
  runtimeGenerationRetryDelayMs,
} from "../../shared/main/threadRuntimeSubscription";

const sessionId = "session-v6";
const runId = "run-v6";
const itemId = "item-v6";
const source = { backend: "codex" };
const integrityItem = {
  id: "integrity-item", session_id: sessionId, run_id: runId, type: "message", status: "completed",
  sequence: 1, created_at: "2026-08-04T00:00:00Z", updated_at: "2026-08-04T00:00:01Z", source,
  content: { role: "assistant", text: "canonical", phase: "final", parts: [], citations: [] },
} as OaepItem;
const integrityDigest = oaepProjectionDigest([integrityItem]);
const integritySnapshot = {
  version: "1.0", session: { id: sessionId, workspace_id: "workspace", status: "active",
    created_at: "2026-08-04T00:00:00Z", updated_at: "2026-08-04T00:00:01Z" },
  runs: [{ id: runId, session_id: sessionId, status: "completed", created_at: "2026-08-04T00:00:00Z",
    updated_at: "2026-08-04T00:00:01Z" }], items: [integrityItem], snapshot_sequence: 4,
  checkpoint: { sequence: 4, snapshot_hash: integrityDigest, item_count: 1 },
  window: { limit: 100, has_more: false, next_cursor: null },
} as OaepSnapshot;
assert.doesNotThrow(() => assertOaepSnapshotIntegrity(integritySnapshot));
assert.throws(() => assertOaepSnapshotIntegrity({ ...integritySnapshot,
  checkpoint: { ...integritySnapshot.checkpoint, snapshot_hash: "0".repeat(64) } }),
  /oaep_snapshot_checkpoint_digest_mismatch/);
assert.throws(() => assertOaepEventIntegrity({
  version: "1.0", event_id: "scope", session_id: sessionId, run_id: runId, item_id: "outer",
  sequence: 1, type: "event.item.completed", timestamp: "2026-08-04T00:00:00Z", dedupe_key: "scope", source,
  data: { item: { ...integrityItem, id: "inner" } },
} as OaepEvent, sessionId), /oaep_event_item_scope_invalid/);
const windowFixture = JSON.parse(await readFile(resolve(
  process.cwd(), "../../../cores/protocol/oaep/snapshot-window.examples.json",
), "utf8")) as { expected_snapshot_hash: string; pages: Array<{ items: OaepItem[] }> };
assert.equal(
  oaepProjectionDigest(windowFixture.pages.flatMap((page) => page.items)),
  windowFixture.expected_snapshot_hash,
  "Desktop and Runtime must calculate the same canonical transcript hash",
);
const parityItems = new Map<string, OaepItem>();
const parityShadows = new Map<string, OaepDeltaShadow>();
const parityRuns = new Map<string, OaepRun>();
const reasoningEvents = [
  { version: "1.0", event_id: "rs1", session_id: sessionId, run_id: runId, item_id: "reasoning",
    sequence: 1, type: "event.item.delta", timestamp: "2026-08-04T00:00:00Z", dedupe_key: "r1", source,
    data: { delta: { kind: "reasoning.segment.added", segment_id: "summary-2", text: "" } } },
  { version: "1.0", event_id: "rs2", session_id: sessionId, run_id: runId, item_id: "reasoning",
    sequence: 2, type: "event.item.delta", timestamp: "2026-08-04T00:00:01Z", dedupe_key: "r2", source,
    data: { delta: { kind: "reasoning.text.append", segment_id: "summary-2", text: "details" } } },
] as OaepEvent[];
reasoningEvents.forEach((event) => reduceOaepEvent(parityItems, parityRuns, event, parityShadows));
assert.equal(parityItems.has("reasoning"), false, "delta-only content must not enter the canonical Item map");
assert.deepEqual(parityShadows.get("reasoning")?.content.segments, [{
  id: "summary-2", text: "details", kind: "summary", visibility: "user", source: "backend",
}],
  "TypeScript live reduction must preserve the same reasoning segment identity as Python replay");
reduceOaepEvent(parityItems, parityRuns, {
  version: "1.0", event_id: "rs-hidden", session_id: sessionId, run_id: runId, item_id: "hidden-reasoning",
  sequence: 3, type: "event.item.delta", timestamp: "2026-08-04T00:00:02Z", dedupe_key: "r-hidden", source,
  data: { delta: { kind: "reasoning.text.append", segment_id: "analysis-1", text: "private-canary",
    reasoning_kind: "analysis", visibility: "hidden", reasoning_source: "backend" } },
} as OaepEvent, parityShadows);
assert.deepEqual(parityShadows.get("hidden-reasoning")?.content.segments, [{
  id: "analysis-1", text: "private-canary", kind: "analysis", visibility: "hidden", source: "backend",
}], "hidden reasoning must remain in canonical reduction while presentation filters it");
const toolDelta = {
  version: "1.0", event_id: "tool1", session_id: sessionId, run_id: runId, item_id: "tool",
  sequence: 3, type: "event.item.delta", timestamp: "2026-08-04T00:00:02Z", dedupe_key: "tool-d1", source,
  data: { delta: { kind: "tool.output.append", text: "result" } },
} as OaepEvent;
reduceOaepEvent(parityItems, parityRuns, toolDelta, parityShadows);
assert.equal(parityShadows.get("tool")?.content.result, "result");
assert.equal("output" in (parityShadows.get("tool")?.content ?? {}), false,
  "tool output must update result; command output alone may use output");
const deltaMatrix = [
  ["matrix-message", "message.text.append", "text"],
  ["matrix-reasoning-marker", "reasoning.segment.added", "segments"],
  ["matrix-reasoning-text", "reasoning.text.append", "segments"],
  ["matrix-plan", "plan.text.append", "text"],
  ["matrix-command", "command.output.append", "output"],
  ["matrix-tool", "tool.output.append", "result"],
  ["matrix-subtask", "subtask.summary.append", "summary"],
] as const;
deltaMatrix.forEach(([matrixItemId, kind, field], index) => {
  reduceOaepEvent(parityItems, parityRuns, {
    version: "1.0", event_id: `matrix-${index}`, session_id: sessionId, run_id: runId, item_id: matrixItemId,
    sequence: 10 + index, type: "event.item.delta", timestamp: "2026-08-04T00:00:03Z", dedupe_key: `matrix-d-${index}`, source,
    data: { delta: { kind, text: "live", ...(kind.startsWith("reasoning.") ? { segment_id: "summary-1" } : {}) } },
  } as OaepEvent, parityShadows);
  const content = parityShadows.get(matrixItemId)?.content as unknown as Record<string, unknown>;
  if (field === "segments") assert.deepEqual(content.segments, [{
    id: "summary-1", text: "live", kind: "summary", visibility: "user", source: "backend",
  }]);
  else assert.equal(content[field], "live");
});
const terminalMatrixItem = materializeOaepDeltaShadow(parityShadows.get("matrix-message")!);
parityItems.set(terminalMatrixItem.id, { ...terminalMatrixItem, status: "completed" });
assert.throws(() => reduceOaepEvent(parityItems, parityRuns, {
  version: "1.0", event_id: "late", session_id: sessionId, run_id: runId, item_id: terminalMatrixItem.id,
  sequence: 30, type: "event.item.delta", timestamp: "2026-08-04T00:00:04Z", dedupe_key: "late", source,
  data: { delta: { kind: "message.text.append", text: "late" } },
} as OaepEvent, parityShadows), /after_terminal/);
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
  location: "local",
  streamIdentity: "runtime:test-generation-1",
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
const secondReceived: string[] = [];
const phases: string[] = [];
const subscription = await subscribeOaepSession(client, sessionId, {
  onEvent(event) { received.push(event.event_id); },
  onState(state) { phases.push(state); },
});
const sameEndpointClient = { ...client } as unknown as RuntimeClient;
const secondSubscription = await subscribeOaepSession(sameEndpointClient, sessionId, {
  onEvent(event) { secondReceived.push(event.event_id); },
});
let recoveredListenerSnapshots = 0;
const failingSubscription = await subscribeOaepSession(sameEndpointClient, sessionId, {
  onEvent() { throw new Error("test_listener_failure"); },
  onSnapshot(_state, source) { if (source === "resnapshot") recoveredListenerSnapshots += 1; },
});
assert.deepEqual(getOaepSessionOwnershipDiagnostics().map(({ endpointKey, sessionId: ownedSession, subscribers, sse }) =>
  ({ endpointKey, sessionId: ownedSession, subscribers, sse })), [
  { endpointKey: client.streamIdentity, sessionId, subscribers: 3, sse: 1 },
]);
assert.equal(getRuntimeClientRegistryDiagnostics().find((entry) => entry.endpointKey === client.streamIdentity)?.references, 1,
  "one Session Owner retains one RuntimeClient regardless of subscriber count");
for (const event of events) streamController.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
await new Promise((resolve) => setTimeout(resolve, 30));

assert.deepEqual(received, ["e1", "e2", "e3"]);
assert.deepEqual(secondReceived, ["e1", "e2", "e3"], "all consumers of one endpoint/session must receive the same ordered stream");
assert.equal(subscription.cursor, 3);
assert.equal(subscription.state.items.get(itemId)?.content.text, "Hello.", "terminal Item must authoritatively replace accumulated delta text");
assert.equal(streamOpenCount, 1, "one Session must use one SSE transport");
assert.equal(replayCount, 1, "initial replay must close the snapshot-to-stream race");
assert.equal(subscription.metrics.snapshots, 1);
assert.equal(subscription.metrics.replayEvents, 0);
assert.equal(subscription.metrics.streamEvents, 3);
assert.equal(subscription.metrics.protocolViolations, 0);
assert.deepEqual(phases.slice(0, 3), ["snapshot", "replay", "connected"]);
assert.doesNotThrow(() => assertOaepStreamTransition("retrying", "snapshot"));
assert.doesNotThrow(() => assertOaepStreamTransition("retrying", "resnapshot"));
assert.doesNotThrow(() => assertOaepStreamTransition("retrying", "degraded"));
assert.throws(() => assertOaepStreamTransition("fatal", "connected"), /transition_invalid/);
assert.equal(classifyOaepStreamError(Object.assign(new Error("EOF"), { retryable: true })), "retryable");
assert.equal(classifyOaepStreamError(Object.assign(new Error("expired"), { status: 410 })), "cursor_expired");
assert.equal(classifyOaepStreamError(new Error("oaep_snapshot_item_scope_invalid")), "fatal",
  "deterministic OAEP integrity failures must not consume the network retry window");
for (const status of [401, 403, 404, 405, 422]) {
  assert.equal(classifyOaepStreamError(Object.assign(new Error(String(status)), { status })), "fatal");
}
assert.equal(classifyOaepStreamError(Object.assign(new Error("missing"), { code: "session_missing" })), "fatal");
assert.equal(classifyOaepStreamError(new SyntaxError("bad event")), "fatal");
assert.equal(oaepRetryDelayMs(1, 0), 80);
assert.equal(oaepRetryDelayMs(1, 1), 120);
assert.equal(oaepRetryDelayMs(99, 1), 2000, "retry delay must have a hard upper bound");
assert.equal(runtimeGenerationRetryDelayMs(1, 0), 200);
assert.equal(runtimeGenerationRetryDelayMs(99, 1), 2400);
assert.equal(isRuntimeGenerationInvalidated({ code: "runtime_client_generation_invalidated" }), true);
assert.equal(isRuntimeGenerationInvalidated({ code: "network_error" }), false);
assert.equal(subscription.metrics.listenerFailures, 3, "listener failures must be isolated from the shared transport");
assert.equal(recoveredListenerSnapshots, 3, "a failed listener must receive an authoritative resnapshot");
subscription.stop();
secondSubscription.stop();
failingSubscription.stop();
await subscription.done;
assert.equal(subscription.phase, "closed");
assert.equal(getOaepSessionOwnershipDiagnostics().length, 0);
assert.equal(getRuntimeClientRegistryDiagnostics().some((entry) => entry.endpointKey === client.streamIdentity), false);

let retryNotifications = 0;
const retryingClient = {
  location: "local",
  streamIdentity: "runtime:test-retrying",
  getOaepSnapshot: client.getOaepSnapshot,
  listOaepEvents: client.listOaepEvents,
  openOaepEventStream: async () => { throw Object.assign(new Error("temporary outage"), { retryable: true }); },
} as unknown as RuntimeClient;
const retryingSubscription = await Promise.race([
  subscribeOaepSession(retryingClient, sessionId, { onConnection(state) { if (state === "retrying") retryNotifications += 1; } }),
  new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("subscription readiness waited for SSE")), 250)),
]);
await new Promise((resolve) => setTimeout(resolve, 20));
assert(retryNotifications >= 1, "a transport outage must enter retrying without blocking snapshot readiness");
retryingSubscription.stop();
await retryingSubscription.done;

const fatalError = Object.assign(new Error("unsupported stream"), { retryable: false, code: "unsupported_protocol" });
let reportedFatal: unknown;
const fatalClient = {
  location: "local",
  streamIdentity: "runtime:test-fatal",
  getOaepSnapshot: client.getOaepSnapshot,
  listOaepEvents: client.listOaepEvents,
  openOaepEventStream: async () => { throw fatalError; },
} as unknown as RuntimeClient;
const fatalSubscription = await subscribeOaepSession(fatalClient, sessionId, { onFatal(error) { reportedFatal = error; } });
await fatalSubscription.done;
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(fatalSubscription.terminalError, fatalError);
assert.equal(reportedFatal, fatalError, "fatal transport errors must have an explicit terminal callback");
assert.equal(fatalSubscription.metrics.fatalErrors, 1);
fatalSubscription.stop();

let degradedNotifications = 0;
const degradedClient = {
  ...client,
  streamIdentity: "runtime:test-degraded",
  getOaepSnapshot: client.getOaepSnapshot,
  listOaepEvents: client.listOaepEvents,
  openOaepEventStream: async () => { throw Object.assign(new Error("offline"), { code: "network_error" }); },
} as unknown as RuntimeClient;
const degradedSubscription = await subscribeOaepSession(degradedClient, sessionId, {
  onConnection(state) { if (state === "degraded") degradedNotifications += 1; },
});
await degradedSubscription.done;
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(degradedSubscription.phase, "degraded");
assert.equal((degradedSubscription.terminalError as { code?: string })?.code, "oaep_sync_degraded");
assert.equal(degradedSubscription.metrics.degradedErrors, 1);
assert.equal(degradedNotifications, 1);
degradedSubscription.stop();

let recoverySnapshotCalls = 0;
let recoveryReplayCalls = 0;
const recoveryStream = new ReadableStream<Uint8Array>({ start() {} });
const recoveryClient = {
  location: "local",
  streamIdentity: "runtime:test-gap-recovery",
  getOaepSnapshot: async () => {
    recoverySnapshotCalls += 1;
    return { version: "1.0", session: { id: sessionId }, runs: [], items: [], snapshot_sequence: 0 };
  },
  listOaepEvents: async () => {
    recoveryReplayCalls += 1;
    return recoveryReplayCalls === 1
      ? { version: "1.0", object: "list", data: [events[1]], next_sequence: 2, has_more: false }
      : { version: "1.0", object: "list", data: events.slice(0, 2), next_sequence: 2, has_more: false };
  },
  openOaepEventStream: async () => ({ response: new Response(null, { status: 200 }), events: recoveryStream }),
} as unknown as RuntimeClient;
const recoveryPhases: string[] = [];
const recoverySubscription = await Promise.race([
  subscribeOaepSession(recoveryClient, sessionId, { onState(state) { recoveryPhases.push(state); } }),
  new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("gap recovery timed out")), 750)),
]);
assert.equal(recoverySubscription.cursor, 2);
assert.equal(recoverySubscription.state.items.get(itemId)?.content.text, "Hel");
assert.equal(recoverySubscription.metrics.protocolViolations, 1);
assert.equal(recoverySnapshotCalls, 1,
  "a transient replay gap must retry from the last contiguous cursor instead of skipping Events with a snapshot");
assert.equal(recoverySubscription.metrics.resnapshots, 0);
assert(recoveryPhases.includes("retrying") && recoveryPhases.filter((phase) => phase === "replay").length >= 2);
recoverySubscription.stop();
await recoverySubscription.done;

let expiredSnapshotCalls = 0;
let expiredReplayCalls = 0;
const expiredStream = new ReadableStream<Uint8Array>({ start() {} });
const expiredClient = {
  location: "local",
  streamIdentity: "runtime:test-cursor-expired",
  getOaepSnapshot: async () => {
    expiredSnapshotCalls += 1;
    return { version: "1.0", session: { id: sessionId }, runs: [], items: [], snapshot_sequence: expiredSnapshotCalls === 1 ? 0 : 3 };
  },
  listOaepEvents: async () => {
    expiredReplayCalls += 1;
    if (expiredReplayCalls === 1) throw Object.assign(new Error("cursor compacted"), { status: 410 });
    return { version: "1.0", object: "list", data: [], next_sequence: 3, has_more: false };
  },
  openOaepEventStream: async () => ({ response: new Response(null, { status: 200 }), events: expiredStream }),
} as unknown as RuntimeClient;
const expiredSubscription = await Promise.race([
  subscribeOaepSession(expiredClient, sessionId, {}),
  new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("cursor-expired recovery timed out")), 750)),
]);
assert.equal(expiredSubscription.cursor, 3);
assert.equal(expiredSnapshotCalls, 2, "HTTP 410 must atomically resnapshot instead of becoming fatal");
assert.equal(expiredSubscription.metrics.resnapshots, 1);
assert.equal(expiredSubscription.metrics.fatalErrors, 0);
expiredSubscription.stop();
await expiredSubscription.done;

let abortOpenCalls = 0;
const abortClient = {
  location: "local",
  streamIdentity: "runtime:test-abort-retry",
  getOaepSnapshot: client.getOaepSnapshot,
  listOaepEvents: client.listOaepEvents,
  openOaepEventStream: async () => {
    abortOpenCalls += 1;
    throw Object.assign(new Error("temporary outage"), { retryable: true });
  },
} as unknown as RuntimeClient;
const abortSubscription = await subscribeOaepSession(abortClient, sessionId, {});
await new Promise((resolve) => setTimeout(resolve, 20));
abortSubscription.stop();
await Promise.race([
  abortSubscription.done,
  new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("abort left retry timer active")), 250)),
]);
const callsAtAbort = abortOpenCalls;
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(abortOpenCalls, callsAtAbort, "abort must release retry timers and prevent reconnects");

const raceEvents = [
  { ...events[0], event_id: "race-1", dedupe_key: "race-d1" },
  { ...events[1], event_id: "race-2", dedupe_key: "race-d2", data: { delta: { kind: "message.text.append", text: "Hel" } } },
  { ...events[1], event_id: "race-3", dedupe_key: "race-d3", sequence: 3,
    data: { delta: { kind: "message.text.append", text: "lo" } } },
  { ...events[2], event_id: "race-4", dedupe_key: "race-d4", sequence: 4 },
] as OaepEvent[];
let raceReplayPage = 0;
let raceStreamController!: ReadableStreamDefaultController<Uint8Array>;
const raceStream = new ReadableStream<Uint8Array>({ start(controller) { raceStreamController = controller; } });
const raceClient = {
  location: "local",
  streamIdentity: "runtime:test-snapshot-stream-race",
  getOaepSnapshot: async () => ({
    version: "1.0", session: { id: sessionId },
    runs: [{ id: runId, session_id: sessionId, status: "running", created_at: "2026-08-04T00:00:00Z",
      updated_at: "2026-08-04T00:00:01Z" }],
    items: [item("running", "")], snapshot_sequence: 1,
  }),
  listOaepEvents: async () => {
    raceReplayPage += 1;
    if (raceReplayPage === 1) return { version: "1.0", object: "list", data: raceEvents.slice(0, 2), next_sequence: 2, has_more: true };
    return { version: "1.0", object: "list", data: [raceEvents[2]], next_sequence: 3, has_more: false };
  },
  openOaepEventStream: async () => {
    raceStreamController.enqueue(encoder.encode(`data: ${JSON.stringify(raceEvents[2])}\n\ndata: ${JSON.stringify(raceEvents[3])}\n\n`));
    return { response: new Response(null, { status: 200 }), events: raceStream };
  },
} as unknown as RuntimeClient;
const raceReceived: string[] = [];
const raceSubscription = await subscribeOaepSession(raceClient, sessionId, { onEvent(event) { raceReceived.push(event.event_id); } });
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(raceSubscription.cursor, 4);
assert.deepEqual(raceReceived, ["race-2", "race-3", "race-4"],
  "snapshot/replay/SSE overlap must deduplicate all three hand-off boundaries");
assert.equal(raceSubscription.state.items.get(itemId)?.content.text, "Hello.");
raceSubscription.stop();
await raceSubscription.done;

const pressureSessionId = "session-pressure";
const pressureItemId = "item-pressure";
let pressureController!: ReadableStreamDefaultController<Uint8Array>;
const pressureStream = new ReadableStream<Uint8Array>({ start(controller) { pressureController = controller; } });
const pressureClient = {
  location: "local",
  streamIdentity: "runtime:test-backpressure",
  getOaepSnapshot: async () => ({
    version: "1.0", session: { id: pressureSessionId }, runs: [], items: [], snapshot_sequence: 0,
  }),
  listOaepEvents: async () => ({ version: "1.0", object: "list", data: [], next_sequence: 0, has_more: false }),
  openOaepEventStream: async () => ({ response: new Response(null, { status: 200 }), events: pressureStream }),
} as unknown as RuntimeClient;
let releaseSlowListener!: () => void;
const slowListenerGate = new Promise<void>((resolve) => { releaseSlowListener = resolve; });
let pressureResnapshots = 0;
const pressureSubscription = await subscribeOaepSession(pressureClient, pressureSessionId, {
  onEvent: async () => slowListenerGate,
  onSnapshot(_state, snapshotSource) { if (snapshotSource === "resnapshot") pressureResnapshots += 1; },
});
const pressureFrames: string[] = [];
for (let sequence = 1; sequence < 100_000; sequence += 1) {
  pressureFrames.push(`data: ${JSON.stringify({
    version: "1.0", event_id: `pressure-${sequence}`, session_id: pressureSessionId, sequence,
    type: "event.session.updated", timestamp: "2026-08-04T00:00:00Z", dedupe_key: `pressure-${sequence}`,
    source, data: {},
  })}\n\n`);
}
pressureFrames.push(`data: ${JSON.stringify({
  version: "1.0", event_id: "pressure-terminal", session_id: pressureSessionId, run_id: runId,
  item_id: pressureItemId, sequence: 100_000, type: "event.item.completed",
  timestamp: "2026-08-04T00:00:01Z", dedupe_key: "pressure-terminal", source,
  data: { item: { ...item("completed", "Complete"), id: pressureItemId, session_id: pressureSessionId, sequence: 100_000 } },
})}\n\n`);
pressureController.enqueue(encoder.encode(pressureFrames.join("")));
const pressureDeadline = Date.now() + 15_000;
while (pressureSubscription.cursor < 100_000 && Date.now() < pressureDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.equal(pressureSubscription.cursor, 100_000, "100k events must be ingested without an unbounded listener queue");
releaseSlowListener();
const recoveryDeadline = Date.now() + 2_000;
while (!pressureResnapshots && Date.now() < recoveryDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.equal(pressureSubscription.metrics.backpressureRecoveries, 1);
assert.equal(pressureResnapshots, 1, "overflowed listeners must recover with one authoritative snapshot");
assert.equal(pressureSubscription.state.items.get(pressureItemId)?.status, "completed");
assert.equal(pressureSubscription.state.items.get(pressureItemId)?.content.text, "Complete");
pressureSubscription.stop();
await pressureSubscription.done;

invalidateRuntimeClientRegistry();
const access = { baseUrl: "http://127.0.0.1:18642", headers: { "X-OpenDrSai-Gateway-Token": "generation-a" } };
const endpointKey = createRuntimeEndpointKey(access);
assert(Array.from({ length: 100 }, () => createRuntimeEndpointKey(access)).every((candidate) => candidate === endpointKey),
  "one Endpoint must keep the same opaque identity across 100 connections");
assert.match(endpointKey, /^runtime:[0-9a-f]{12}:[0-9a-f]{16}$/);
assert.equal(endpointKey.includes(access.baseUrl), false);
assert.equal(endpointKey.includes("generation-a"), false);
assert.equal(createRuntimeEndpointKey({ ...access, headers: {
  ...access.headers,
  "X-Diagnostic-Trace": "diagnostic-only",
} }), endpointKey, "diagnostic headers must not create a new Runtime generation");
const concurrentClients = await Promise.all(Array.from({ length: 50 }, async () =>
  LocalRuntimeClient.forAccess(access.baseUrl, access.headers)));
assert(concurrentClients.every((candidate) => candidate === concurrentClients[0]),
  "50 concurrent acquisitions of one Endpoint must construct one RuntimeClient");
const nextGeneration = LocalRuntimeClient.forAccess(access.baseUrl, { "X-OpenDrSai-Gateway-Token": "generation-b" });
assert.notEqual(nextGeneration, concurrentClients[0], "token generation changes must not reuse a stale Client");
assert.notEqual(nextGeneration.streamIdentity, concurrentClients[0].streamIdentity);
await assert.rejects(
  concurrentClients[0].getCapabilities(),
  (error: unknown) => Boolean(error && typeof error === "object"
    && (error as { code?: unknown }).code === "runtime_client_generation_invalidated"),
  "requests through the previous generation must fail with a structured reconnect error",
);
assert(Array.from({ length: 50 }, () => LocalRuntimeClient.forAccess(access.baseUrl, {
  "X-OpenDrSai-Gateway-Token": "generation-b",
})).every((candidate) => candidate === nextGeneration),
"the replacement generation must still be established exactly once");
assert.throws(() => retainRuntimeClient(concurrentClients[0]),
  (error: unknown) => Boolean(error && typeof error === "object"
    && (error as { code?: unknown }).code === "runtime_client_generation_invalidated"),
  "an invalidated generation must never be retained again");
const releaseRegistryClient = retainRuntimeClient(nextGeneration);
assert.equal(getRuntimeClientRegistryDiagnostics().find((entry) => entry.endpointKey === nextGeneration.streamIdentity)?.references, 1);
assert.equal(getRuntimeClientRegistryDiagnostics().find((entry) => entry.endpointKey === nextGeneration.streamIdentity)?.lifecycle, "active");
releaseRegistryClient();
releaseRegistryClient();
assert.equal(getRuntimeClientRegistryDiagnostics().some((entry) => entry.endpointKey === nextGeneration.streamIdentity), false,
  "last reference release must evict and close the Client exactly once");
for (let index = 0; index < 10_000; index += 1) {
  const shortClient = LocalRuntimeClient.forAccess(access.baseUrl, {
    "X-OpenDrSai-Gateway-Token": `short-generation-${index}`,
  });
  retainRuntimeClient(shortClient)();
}
assert.ok(getRuntimeClientRegistryDiagnostics().length <= 1,
  "10,000 short-lived Runtime generations must fall back to the one idle active-generation cache entry");
assert.equal(getOaepSessionOwnershipDiagnostics().length, 0,
  "completed short Runs must leave no Session Owner or SSE controller");
invalidateRuntimeClientRegistry();

const chat = await readFile(resolve(process.cwd(), "../shared/main/chat.ts"), "utf8");
const start = chat.indexOf("async function runRuntimeBackendChat(");
const end = chat.indexOf("function emitCodexOaepEvent(", start);
const runtimeChat = chat.slice(start, end);
assert(runtimeChat.includes("subscribeOaepSession("), "live Runtime chat must consume the shared OAEP stream");
assert(!runtimeChat.includes("listOaepEvents("), "live Runtime chat must not fall back to 100ms OAEP polling");
assert(!runtimeChat.includes("getConversationSnapshot("),
  "OAEP outbox completion must not cross into the legacy Conversation contract");
assert(runtimeChat.includes("sourceMessageObserved") && runtimeChat.includes("completeOutbox(runtimeSessionId, sourceMessageId)"),
  "OAEP outbox completion must require the authoritative source message and terminal Run");
const runtimeClientSource = await readFile(resolve(process.cwd(), "../shared/main/runtimeClient.ts"), "utf8");
const borrowedOperationStart = runtimeClientSource.indexOf("export async function withRuntimeClientForWorkspace");
const borrowedOperationEnd = runtimeClientSource.indexOf("connectRuntimeClientForWorkspaceIfAvailable", borrowedOperationStart);
const borrowedOperation = runtimeClientSource.slice(borrowedOperationStart, borrowedOperationEnd);
assert(borrowedOperationStart >= 0, "finite Runtime operations must expose a retained-client helper");
assert(borrowedOperation.includes("retainRuntimeClient(resolved.client)"),
  "finite Runtime operations must retain the shared client before awaiting work");
assert(borrowedOperation.includes("finally") && borrowedOperation.includes("release();"),
  "finite Runtime operations must release their client lease on success and failure");
const windowsMain = await readFile(resolve(process.cwd(), "src/main/index.ts"), "utf8");
const manifestHandlerStart = windowsMain.indexOf('secureHandle("desktop:run-manifest"');
const manifestHandlerEnd = windowsMain.indexOf('secureHandle("desktop:run-manifest-export"', manifestHandlerStart);
const manifestHandler = windowsMain.slice(manifestHandlerStart, manifestHandlerEnd);
assert(manifestHandler.includes("withRuntimeClientForWorkspace("),
  "Run manifest reads must retain the client while OAEP chat teardown runs concurrently");
assert(!manifestHandler.includes("connectRuntimeClientForWorkspace("),
  "Run manifest reads must not use an unleased shared Runtime client");
const threadSubscription = await readFile(resolve(process.cwd(), "../shared/main/threadRuntimeSubscription.ts"), "utf8");
assert(threadSubscription.includes("subscribeRuntimeThreadSnapshotOnce")
  && threadSubscription.includes("isRuntimeGenerationInvalidated(active?.terminalError)")
  && !threadSubscription.includes("setTimeout(resolve, 100)"),
"thread subscriptions must supervise only explicit generation transitions without a fixed 100ms retry loop");

console.log("Shared OAEP Session stream verification passed.");
