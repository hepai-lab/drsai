import { SessionViewStore } from "../main/sessionViewStore";
import { oaepProjectionDigest } from "../main/oaepIntegrity";
import assert from "node:assert/strict";
import {
  consumeSse, subscribeOaepSession, getOaepSessionOwnershipDiagnostics,
  MAX_OAEP_LISTENER_PENDING, MAX_OAEP_LISTENER_BYTES, MAX_OAEP_SSE_FRAME_BYTES,
} from "../main/oaepSessionStream";

const encoder = new TextEncoder();
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const wait = async (predicate) => {
  for (let i = 0; i < 400 && !predicate(); i++) await tick();
  assert.ok(predicate(), "condition must settle without deadlock");
};
const deadline = async (promise) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("deadlock timeout")), 4000);
  })]); } finally { clearTimeout(timer); }
};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const event = (sequence, text = "", terminal = false) => ({
  version: "1.0", event_id: `e${sequence}`, dedupe_key: `e${sequence}`, session_id: "s",
  run_id: "r", sequence, timestamp: "2026-09-21T00:00:00Z", source: { backend: "test" },
  type: terminal ? "event.run.completed" : "event.item.delta", ...(terminal ? {} : { item_id: "i" }),
  data: terminal ? {} : { delta: { kind: "message.text.append", text } },
});
const frame = e => encoder.encode(`data: ${JSON.stringify(e)}\n\n`);
function chunks(values) {
  return new ReadableStream({ start(c) { values.forEach(v => c.enqueue(v)); c.close(); } });
}

// Every byte boundary, including UTF-8, CRLF and JSON/data line delimiters.
const unicode = event(1, "中文🦉");
const source = encoder.encode(`: comment\r\ndata: ${JSON.stringify(unicode)}\r\n\r\ndata: ${JSON.stringify(event(2, "", true))}\r\r`);
const delivered = [];
await consumeSse(chunks([...source].map(b => Uint8Array.of(b))), new AbortController().signal, async e => { delivered.push(e); });
assert.deepEqual(delivered, [unicode, event(2, "", true)]);
const incomplete = [];
await consumeSse(chunks([encoder.encode('data: {"unfinished":')]), new AbortController().signal, async e => { incomplete.push(e); });
assert.equal(incomplete.length, 0);
await assert.rejects(consumeSse(chunks([encoder.encode('data: nope\n\n')]), new AbortController().signal, async () => {}), SyntaxError);
for (const split of [false, true]) {
  const oversized = new Uint8Array(MAX_OAEP_SSE_FRAME_BYTES + 1).fill(120);
  await assert.rejects(consumeSse(chunks(split
    ? Array.from({ length: Math.ceil(oversized.length / 65536) }, (_, i) => oversized.subarray(i * 65536, (i + 1) * 65536))
    : [oversized]), new AbortController().signal, async () => {}), /oaep_sse_frame_too_large/);
}
// Total chunk size may exceed the frame limit if each individual frame is small.
let many = 0;
const small = encoder.encode('data: {}\n\n');
const aggregate = new Uint8Array(small.length * (Math.floor(MAX_OAEP_SSE_FRAME_BYTES / small.length) + 1));
for (let i = 0; i < aggregate.length; i += small.length) aggregate.set(small, i);
await consumeSse(chunks([aggregate]), new AbortController().signal, async () => { many++; });
assert.equal(many, aggregate.length / small.length);
const abort = new AbortController();
let cancelled = 0;
const reading = consumeSse(new ReadableStream({ cancel() { cancelled++; } }), abort.signal, async () => {});
abort.abort();
await deadline(reading);
assert.equal(cancelled, 1);
const callbackGate = deferred(); let callbackCount = 0;
const paused = consumeSse(chunks([frame(event(1)), frame(event(2))]), new AbortController().signal, async () => {
  callbackCount++; if (callbackCount === 1) await callbackGate.promise;
});
await wait(() => callbackCount === 1); await tick(); assert.equal(callbackCount, 1);
callbackGate.resolve(); await paused; assert.equal(callbackCount, 2);

let identity = 0;
function fixture(replay = []) {
  let stream; let cancels = 0;
  const client = {
    streamIdentity: `oaep-backpressure-${++identity}`, location: "local", close() {},
    async getOaepSnapshot() { return { version: "1.0", session: { id: "s" }, snapshot_sequence: 0,
      runs: [{ id: "r", session_id: "s", status: "running" }], items: [{
        id: "i", session_id: "s", run_id: "r", sequence: 1, type: "message", status: "running",
        source: { backend: "test" }, content: { role: "assistant", text: "" },
      }] }; },
    async listOaepEvents() { return { data: replay, has_more: false }; },
    async openOaepEventStream() { return { events: new ReadableStream({
      start(c) { stream = c; }, cancel() { cancels++; },
    }) }; },
  };
  return { client, send: e => stream.enqueue(frame(e)), get stream() { return stream; }, get cancels() { return cancels; } };
}

for (const bytesMode of [false, true]) {
  const f = fixture(); const gate = deferred(); const seen = []; const otherSeen = [];
  let snapshots = 0;
  const sub = await subscribeOaepSession(f.client, "s", {
    onSnapshot() { snapshots++; },
    async onEvent(e) { seen.push(e.sequence); if (e.sequence === 1) await gate.promise; },
  });
  const other = await subscribeOaepSession(f.client, "s", { onEvent(e) { otherSeen.push(e.sequence); } });
  await wait(() => f.stream);
  const count = bytesMode ? 25 : 900;
  const payload = bytesMode ? "x".repeat(700_000) : "x";
  for (let i = 1; i <= count; i++) f.send(event(i, payload, i === count));
  await wait(() => sub.metrics.listenerBackpressureWaits > 0);
  const cursor = sub.cursor;
  await tick(); await tick(); assert.equal(sub.cursor, cursor, "producer pauses at listener capacity");
  assert.ok(cursor < count);
  assert.ok(sub.metrics.listenerPeakPending <= MAX_OAEP_LISTENER_PENDING);
  assert.ok(sub.metrics.listenerPeakBytes <= MAX_OAEP_LISTENER_BYTES);
  if (bytesMode) assert.ok(sub.metrics.listenerPeakPending < MAX_OAEP_LISTENER_PENDING, "byte bound activates independently");
  else assert.equal(sub.metrics.listenerPeakPending, MAX_OAEP_LISTENER_PENDING);
  gate.resolve();
  await wait(() => seen.length === count && otherSeen.length === count);
  assert.deepEqual(seen, Array.from({ length: count }, (_, i) => i + 1));
  assert.deepEqual(otherSeen, seen);
  assert.equal(snapshots, 1, "backpressure never substitutes a snapshot for events");
  assert.equal(sub.metrics.backpressureRecoveries, 0);
  sub.stop(); other.stop(); await deadline(sub.done); assert.equal(f.cancels, 1);
}

// Removing the stalled listener releases admission for the remaining owner.
{
  const f = fixture(); const gate = deferred(); const seen = [];
  const slow = await subscribeOaepSession(f.client, "s", { onEvent: () => gate.promise });
  const fast = await subscribeOaepSession(f.client, "s", { onEvent: e => { seen.push(e.sequence); } });
  await wait(() => f.stream);
  for (let i = 1; i <= 700; i++) f.send(event(i, "", i === 700));
  await wait(() => slow.metrics.listenerBackpressureWaits > 0);
  slow.stop(); await wait(() => seen.length === 700);
  assert.deepEqual(seen, Array.from({ length: 700 }, (_, i) => i + 1));
  fast.stop(); await deadline(fast.done); gate.resolve();
}
// Last stop must complete the producer even if user code never settles.
{
  const f = fixture(); const gate = deferred();
  const sub = await subscribeOaepSession(f.client, "s", { onEvent: () => gate.promise });
  await wait(() => f.stream);
  for (let i = 1; i <= 700; i++) f.send(event(i));
  await wait(() => sub.metrics.listenerBackpressureWaits > 0);
  sub.stop(); await deadline(sub.done); assert.equal(f.cancels, 1); gate.resolve();
}
// Async-context guards apply even after an await; terminal stop+done is safe.
{
  const f = fixture(); const seen = []; const finished = deferred();
  const sub = await subscribeOaepSession(f.client, "s", { async onEvent(e) {
    await tick();
    await assert.rejects(sub.loadEarlier("unused"), /oaep_listener_reentrant_history/);
    seen.push(e.sequence);
    if (e.type === "event.run.completed") { sub.stop(); await sub.done; finished.resolve(); }
  } });
  await wait(() => f.stream); f.send(event(1)); f.send(event(2, "", true));
  await deadline(finished.promise); assert.deepEqual(seen, [1, 2]);
}
// Initial replay can be cancelled before ready returns; callback resubscribe
// fails explicitly rather than extending a dependency on its own replay queue.
{
  const f = fixture(Array.from({ length: 700 }, (_, i) => event(i + 1)));
  const abort = new AbortController(); const gate = deferred(); let entered = false;
  const pending = subscribeOaepSession(f.client, "s", { async onEvent() {
    await assert.rejects(subscribeOaepSession(f.client, "s", {}), /oaep_listener_reentrant_subscribe/);
    entered = true; await gate.promise;
  } }, { signal: abort.signal });
  await wait(() => entered); await tick(); abort.abort(new Error("test_initial_cancel"));
  await assert.rejects(deadline(pending), /test_initial_cancel/);
  gate.resolve(); await tick();
}
// Initial replay itself stops at capacity and resumes without control loss.
{
  const f = fixture(Array.from({ length: 700 }, (_, i) => event(i + 1, "", i === 699)));
  const gate = deferred(); const seen = [];
  const pending = subscribeOaepSession(f.client, "s", { async onEvent(e) {
    seen.push(e.sequence); if (e.sequence === 1) await gate.promise;
  } });
  const owned = () => getOaepSessionOwnershipDiagnostics().find(e => e.endpointKey === f.client.streamIdentity);
  await wait(() => (owned()?.cursor ?? 0) >= MAX_OAEP_LISTENER_PENDING);
  const cursor = owned().cursor; await tick(); await tick(); assert.equal(owned().cursor, cursor);
  assert.ok(cursor < 700); gate.resolve();
  const sub = await deadline(pending);
  await wait(() => seen.length === 700);
  assert.deepEqual(seen, Array.from({ length: 700 }, (_, i) => i + 1));
  assert.ok(sub.metrics.listenerPeakPending <= MAX_OAEP_LISTENER_PENDING);
  sub.stop(); await deadline(sub.done);
}
// A slow consumer cannot turn a sequence gap into a snapshot cursor jump.
{
  const f = fixture(); const gate = deferred(); const seen = []; const connections = [];
  const replayCursors = []; let opens = 0;
  f.client.listOaepEvents = async (_, cursor) => {
    replayCursors.push(cursor);
    return { data: cursor === 1 ? [event(2), event(3, "", true)] : [], has_more: false };
  };
  const originalOpen = f.client.openOaepEventStream;
  f.client.openOaepEventStream = async (...args) => {
    opens++;
    if (opens === 1) return { events: chunks([frame(event(1)), frame(event(3, "", true))]) };
    return originalOpen(...args);
  };
  const terminal = deferred();
  const sub = await subscribeOaepSession(f.client, "s", {
    onConnection(state, attempt) { connections.push(state); if (state === "connected") assert.equal(attempt, 1); },
    async onEvent(e, state) {
      seen.push(e.sequence);
      if (e.sequence === 1) await gate.promise;
      assert.equal(state.cursor, e.sequence, "reconnect preserves event-time cursor after await");
      if (e.sequence === 3) { assert.ok(connections.includes("connected")); sub.stop(); terminal.resolve(); }
    },
  });
  await wait(() => sub.cursor === 3); gate.resolve(); await deadline(terminal.promise); await deadline(sub.done);
  assert.deepEqual(seen, [1, 2, 3]); assert.deepEqual(replayCursors.slice(0, 2), [0, 1]);
  assert.equal(sub.metrics.resnapshots, 0); assert.equal(sub.metrics.protocolViolations, 1);
}
// Oversized live frame is fatal and does not masquerade as checkpoint recovery.
{
  const f = fixture(); let fatal;
  const sub = await subscribeOaepSession(f.client, "s", { onFatal(e) { fatal = e; } });
  await wait(() => f.stream); f.stream.enqueue(new Uint8Array(MAX_OAEP_SSE_FRAME_BYTES + 1).fill(120));
  await deadline(sub.done); await wait(() => fatal);
  assert.match(fatal.message, /oaep_sse_frame_too_large/);
  assert.equal(sub.cursor, 0); assert.equal(sub.metrics.resnapshots, 0); assert.equal(sub.metrics.reconnects, 0);
  sub.stop();
}
// Replay has the same event budget: a single over-budget object fails explicitly.
{
  const f = fixture([event(1, "x".repeat(MAX_OAEP_LISTENER_BYTES))]);
  await assert.rejects(subscribeOaepSession(f.client, "s", {}), /oaep_listener_event_too_large/);
  assert.equal(getOaepSessionOwnershipDiagnostics().some(e => e.endpointKey === f.client.streamIdentity), false,
    "failed initial replay must release the listener whose handle cannot be returned");
}
// Snapshot callbacks have the same async stability contract as Events.
{
  const f = fixture(); const gate = deferred(); const checked = deferred(); const cursors = [];
  const sub = await subscribeOaepSession(f.client, "s", {
    async onSnapshot(s) {
      await gate.promise;
      assert.equal(s.cursor, 0); assert.equal(s.items.get("i").content.text, "");
      checked.resolve();
    },
    onEvent(e, s) { cursors.push(s.cursor); assert.equal(s.cursor, e.sequence); },
  });
  await wait(() => f.stream); f.send(event(1, "ahead")); await wait(() => sub.cursor === 1);
  gate.resolve(); await deadline(checked.promise); await wait(() => cursors.length === 1);
  sub.stop(); await deadline(sub.done);
}

// Callback state is a listener-local sequential view, not producer look-ahead.
// Tool/approval/terminal visibility must agree with the triggering Event even
// after an await. A throwing callback recovers at that same FIFO position.
{
  const f = fixture(); const gate = deferred(); const seen = []; const fastSeen = [];
  const recovered = []; let firstMap; const mapIdentities = [];
  const view = new SessionViewStore({ id: "thread", title: "test", updatedAt: "2026-09-21T00:00:00Z" }, "s", {});
  const patches = [];
  const events = [event(1, "A"), event(2, "B")];
  const itemEvent = (sequence, id, type, status, content) => ({ ...event(sequence),
    item_id: id, type: status === "completed" ? "event.item.completed" : "event.item.created",
    data: { item: { id, session_id: "s", run_id: "r", sequence: id === "tool" ? 2 : 3,
      type, status, source: { backend: "test" }, content } } });
  events.push(itemEvent(3, "tool", "tool_call", "running", { tool_name: "test", result: "" }));
  events.push(itemEvent(4, "approval", "interaction", "waiting", { interaction_type: "approval", approval_id: "approve-1", prompt: "Allow?" }));
  events.push({ ...event(5), item_id: undefined, type: "event.run.waiting",
    data: { run: { id: "r", session_id: "s", status: "waiting" } } });
  events.push(itemEvent(6, "tool", "tool_call", "completed", { tool_name: "test", result: "ok" }));
  events.push({ ...event(7, "", true), data: { run: { id: "r", session_id: "s", status: "completed" } } });
  const observe = (e, s) => ({ sequence: e.sequence, cursor: s.cursor, text: s.items.get("i").content.text,
    tool: s.items.get("tool")?.status, approval: s.items.get("approval")?.status, run: s.runs.get("r").status });
  const sub = await subscribeOaepSession(f.client, "s", {
    onSnapshot(s, source) {
      view.reset(s);
      if (source === "resnapshot") recovered.push({ cursor: s.cursor, run: s.runs.get("r").status });
    },
    async onEvent(e, s) {
      if (e.sequence === 1) { firstMap = s.items; await gate.promise; }
      mapIdentities.push(s.items === firstMap);
      seen.push(observe(e, s));
      patches.push(view.apply(e, s));
      if (e.sequence === 4) throw new Error("test listener failure");
    },
  });
  const fast = await subscribeOaepSession(f.client, "s", { onEvent(e, s) { fastSeen.push(observe(e, s)); } });
  await wait(() => f.stream); events.forEach(f.send);
  await wait(() => fastSeen.length === 7); assert.equal(seen.length, 0);
  assert.equal(sub.state.runs.get("r").status, "completed", "producer can be ahead of slow listener");
  gate.resolve(); await wait(() => seen.length === 7);
  assert.deepEqual(seen, fastSeen);
  assert.deepEqual(seen.map(v => v.cursor), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(seen[0].text, "A"); assert.equal(seen[0].tool, undefined);
  assert.equal(seen[2].tool, "running"); assert.equal(seen[2].approval, undefined);
  assert.equal(seen[3].approval, "waiting"); assert.equal(seen[3].run, "running");
  assert.equal(seen[4].run, "waiting"); assert.equal(seen[5].tool, "completed");
  assert.equal(seen[6].run, "completed"); assert.ok(mapIdentities.every(Boolean));
  assert.equal(patches[2].patch.kind, "item.upsert");
  assert.ok(!JSON.stringify(patches[2]).includes("Allow?"), "whole-Run projection must not leak a future approval");
  assert.ok(JSON.stringify(patches[3]).includes("approve-1"));
  assert.equal(patches[6].patch.kind, "run.state");
  assert.deepEqual(patches.map(p => p.sessionSequence), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(recovered, [{ cursor: 4, run: "running" }]);
  assert.equal(sub.metrics.listenerFailures, 1);
  assert.ok(sub.metrics.listenerMaxTerminalDelayMs > 0);
  await wait(() => sub.metrics.listenerPending === 0); assert.equal(sub.metrics.listenerBytes, 0);
  assert.ok(Object.values(sub.metrics).every(v => typeof v === "number"), "metrics have no event bodies");
  sub.stop(); fast.stop(); await deadline(sub.done);
}

// History response completes while Event admission is full. Its snapshot must
// not overtake the blocked Event for another listener, or expose future items
// inside the callback currently awaiting user work.
{
  const f = fixture(); const gate = deferred(); const observed = []; const fastObserved = [];
  const initial = await f.client.getOaepSnapshot();
  const older = { ...initial.items[0], id: "older", sequence: 2, content: { role: "assistant", text: "old" } };
  const allItems = [...initial.items, older];
  const checkpoint = { sequence: 0, item_count: 2, snapshot_hash: oaepProjectionDigest(allItems) };
  let pageReads = 0;
  f.client.getOaepSnapshot = async (_, options) => {
    if (options?.cursor) pageReads++;
    return { ...initial, checkpoint, items: options?.cursor ? [older] : initial.items,
      window: { limit: 100, has_more: !options?.cursor, next_cursor: options?.cursor ? null : "older-page" } };
  };
  const listener = (out, slow) => ({
    onSnapshot(s) { out.push({ kind: "snapshot", cursor: s.cursor, older: s.items.has("older") }); },
    async onEvent(e, s) {
      if (slow && e.sequence === 1) await gate.promise;
      out.push({ kind: "event", cursor: s.cursor, older: s.items.has("older") });
    },
  });
  const sub = await subscribeOaepSession(f.client, "s", listener(observed, true));
  const fast = await subscribeOaepSession(f.client, "s", listener(fastObserved, false));
  await wait(() => f.stream);
  for (let i = 1; i <= 300; i++) f.send(event(i, "x"));
  await wait(() => sub.metrics.listenerBackpressureWaits > 0);
  const loading = sub.loadEarlier("older-page");
  await wait(() => pageReads === 1); await tick(); gate.resolve();
  await deadline(loading); await wait(() => observed.filter(v => v.kind === "event").length === 300);
  assert.equal(observed[1].cursor, 1); assert.equal(observed[1].older, false);
  assert.deepEqual(observed, fastObserved);
  const snapshotIndex = observed.findIndex(v => v.kind === "snapshot" && v.older);
  assert.ok(snapshotIndex > 1);
  assert.equal(observed[snapshotIndex - 1].cursor, observed[snapshotIndex].cursor);
  assert.ok(observed.slice(snapshotIndex + 1).every(v => v.older));
  assert.ok(sub.metrics.listenerWaitMs > 0); assert.ok(sub.metrics.listenerMaxWaitMs > 0);
  sub.stop(); fast.stop(); await deadline(sub.done);
  assert.equal(sub.metrics.listenerPending, 0); assert.equal(sub.metrics.listenerBytes, 0);
}

// Stopping while history is waiting behind a stalled callback wakes both the
// publication admission and its drain, without requiring callback completion.
{
  const f = fixture(); const gate = deferred();
  const initial = await f.client.getOaepSnapshot();
  const older = { ...initial.items[0], id: "older", sequence: 2 };
  const checkpoint = { sequence: 0, item_count: 2, snapshot_hash: oaepProjectionDigest([...initial.items, older]) };
  f.client.getOaepSnapshot = async (_, options) => ({ ...initial, checkpoint,
    items: options?.cursor ? [older] : initial.items,
    window: { limit: 100, has_more: !options?.cursor, next_cursor: options?.cursor ? null : "next" } });
  const sub = await subscribeOaepSession(f.client, "s", { onEvent: () => gate.promise });
  await wait(() => f.stream); for (let i = 1; i <= 300; i++) f.send(event(i));
  await wait(() => sub.metrics.listenerBackpressureWaits > 0);
  const loading = sub.loadEarlier("next").then(() => "completed", () => "aborted");
  await tick(); sub.stop(); await deadline(sub.done); await deadline(loading);
  assert.equal(sub.metrics.listenerPending, 0); assert.equal(sub.metrics.listenerBytes, 0);
  gate.resolve(); await tick(); assert.equal(sub.metrics.listenerPending, 0);
}

assert.equal(getOaepSessionOwnershipDiagnostics().length, 0, "all test subscriptions must release ownership");
console.log("OAEP_STREAM_BACKPRESSURE_OK (count/bytes, FIFO, multiple listeners, cancellation, reentrancy, terminal, split UTF-8/CRLF, bounded SSE, event-time tool/approval/Run projection, history publication, metrics)");
