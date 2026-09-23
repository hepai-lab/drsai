import assert from "node:assert/strict";
import { subscribeOaepSession, MAX_PENDING_OAEP_DELTAS, MAX_PENDING_OAEP_DELTA_BYTES } from "../main/oaepSessionStream";
import { oaepProjectionDigest } from "../main/oaepIntegrity";
import { SessionViewStore } from "../main/sessionViewStore";
import { canUseSnapshotCache, withOaepHistory } from "../main/threadRuntimeSubscription";
import { RemoteRuntimeClient } from "../main/runtimeClient";

const session = "history-session";
const time = "2026-09-01T00:00:00Z";
const item = (id, sequence) => ({ id, session_id: session, run_id: `r-${id}`, sequence,
  type: "message", status: "running", content: { role: "assistant", text: id },
  created_at: time, updated_at: time, source: { backend: "test" } });
const items = [item("old", 1), item("middle", 1), item("latest", 1)];
const runs = items.map(i => ({ id: i.run_id, session_id: session, status: "running", created_at: time, updated_at: time }));
const checkpoint = { sequence: 10, item_count: 3, snapshot_hash: oaepProjectionDigest(items) };
const page = (values, next) => ({ version: "1.0", session: { id: session }, snapshot_sequence: 10,
  items: values, runs: runs.filter(run => values.some(item => item.run_id === run.id)), checkpoint, window: { limit: 100, has_more: Boolean(next), next_cursor: next } });
let finish;
let stream;
let badLast = false;
const calls = [];
const client = {
  streamIdentity: "history-regression", location: "local", close() {},
  async getOaepSnapshot(_, options) {
    calls.push(options?.cursor ?? null);
    if (!options?.cursor) return page([items[2]], "opaque +/middle");
    if (options.cursor === "opaque +/middle") return await new Promise(resolve => { finish = resolve; });
    return page(badLast ? [] : [items[0]], null);
  },
  async listOaepEvents() { return { data: [], has_more: false }; },
  async openOaepEventStream() { return { events: new ReadableStream({ start(c) { stream = c; } }) }; },
};
const thread = { id: "thread", title: "history", updatedAt: time };
const history = { state: "ready", source: "opendrsai", loadedRuns: 0, totalRuns: 0, loadedItems: 0,
  totalItems: 0, correctedItems: 0, warningCount: 0, nextCursor: "backend-import" };
const store = new SessionViewStore(thread, session, history);
let snapshots = 0;
const subscription = await subscribeOaepSession(client, session, {
  onSnapshot(state) { Object.assign(history, withOaepHistory(history, state)); store.reset(state); snapshots++; },
  onEvent(event, state) { store.apply(event, state); },
});
const second = await subscribeOaepSession(client, session, {});
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const wait = async predicate => { for(let i=0;i<100 && !predicate();i++) await tick(); assert.ok(predicate()); };
try {
  await wait(() => Boolean(stream));
  assert.deepEqual(calls, [null], "initial load never fetches older windows automatically");
  const pending = subscription.loadEarlier("opaque +/middle");
  const same = second.loadEarlier("opaque +/middle");
  await wait(() => Boolean(finish));
  assert.equal(calls.length, 2, "same-page concurrent readers share the request");
  let sequence = 10;
  const delta = (id, text) => {
    sequence++;
    stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ version: "1.0", event_id: `e${sequence}`,
      dedupe_key: `e${sequence}`, session_id: session, run_id: `r-${id}`, item_id: id, sequence,
      timestamp: time, source: { backend: "test" }, type: "event.item.delta", data: { delta: { kind: "message.text.append", text } } })}\n\n`));
  };
  delta("latest", " LIVE");
  delta("middle", " SHADOW");
  await wait(() => subscription.cursor === 12);
  const historicalPage = page([items[1], items[2]], "last");
  historicalPage.runs = historicalPage.runs.map(run => run.id === "r-middle" ? { ...run, status: "completed" } : run);
  finish(historicalPage); // overlap must not regress live text
  await Promise.all([pending, same]);
  assert.equal(subscription.cursor, 12);
  assert.equal(subscription.state.items.get("latest").content.text, "latest LIVE");
  assert.equal(subscription.state.items.get("middle").content.text, "middle SHADOW");
  assert.equal(subscription.state.items.get("middle").sequence, 1, "Run-local sequence is not Event revision");
  assert.equal(subscription.state.deltaShadows.size, 0);
  assert.ok(snapshots >= 2, "active listener sees history merge");
  assert.equal(store.snapshot.messageCount, store.snapshot.messages.length);
  assert.equal(store.snapshot.messageCount, 2);
  assert.equal(store.snapshot.history.oaepNextCursor, "last");
  assert.equal(store.snapshot.history.nextCursor, "backend-import");
  assert.equal(calls.length, 2, "no automatic next-page fetch");
  await assert.rejects(subscription.loadEarlier("backend-import"), { code: "oaep_history_cursor_stale" });
  // Run summaries are current-time values, unlike checkpoint Items. Seeing
  // the same terminal later in the journal is not a duplicate terminal event.
  sequence++;
  stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ version: "1.0", event_id: `e${sequence}`,
    dedupe_key: `e${sequence}`, session_id: session, run_id: "r-middle", sequence,
    timestamp: time, source: { backend: "test" }, type: "event.run.completed",
    data: { run: { ...runs[1], status: "completed" } } })}\n\n`));
  await wait(() => subscription.cursor === 13);
  assert.equal(subscription.terminalError, undefined);
  badLast = true;
  await assert.rejects(subscription.loadEarlier("last"), /checkpoint_digest_mismatch/);
  assert.equal(subscription.state.items.size, 2, "failed completeness check is atomic");
  assert.equal(subscription.state.history.nextCursor, "last");
  badLast = false;
  await subscription.loadEarlier("last");
  assert.equal(subscription.state.items.size, 3);
  assert.equal(subscription.state.history.hasMore, false);
  assert.equal(store.snapshot.messageCount, 3);
  assert.equal(store.snapshot.messageCount, store.snapshot.messages.length);
  const cached = { runtimeSessionId: session, generation: 2, sessionSequence: 12 };
  assert.equal(canUseSnapshotCache(cached, false, session, { historyCursor: "backend" }), false);
  assert.equal(canUseSnapshotCache(cached, false, session, { oaepHistoryCursor: "oaep" }), false);
} finally { second.stop(); subscription.stop(); await subscription.done; }

// Recovery must discard historical projections (including shadows and Run
// summaries) rather than republish values from before a missing journal span.
for (const recovery of ["expired-history", "expired-stream", "delta-count", "delta-bytes"]) {
  let currentStream;
  let snapshotCalls = 0;
  let expired = false;
  let releaseOldPage;
  let sequence = 10;
  const old = items[0];
  const latest = items[2];
  const replacement = { ...latest, content: { ...latest.content, text: "authoritative latest" } };
  const newCheckpointItems = [old, items[1], replacement];
  const newPage = (values, next) => ({ ...page(values, next), snapshot_sequence: sequence,
    checkpoint: { sequence, item_count: 3, snapshot_hash: oaepProjectionDigest(newCheckpointItems) } });
  const recoveryClient = {
    streamIdentity: `history-recovery-${recovery}`, location: "local", close() {},
    async getOaepSnapshot(_, options) {
      if (!options?.cursor) {
        snapshotCalls++;
        return snapshotCalls === 1 ? page([old, latest], "old-cursor") : newPage([replacement], "new-cursor");
      }
      if (options.cursor === "new-cursor") return newPage([old, items[1]], null);
      if (recovery === "expired-history") throw Object.assign(new Error("Gone"), { status: 410 });
      return await new Promise(resolve => { releaseOldPage = resolve; });
    },
    async listOaepEvents() {
      if (expired) { expired = false; throw Object.assign(new Error("Gone"), { code: "cursor_expired" }); }
      return { data: [], has_more: false };
    },
    async openOaepEventStream() { return { events: new ReadableStream({ start(c) { currentStream = c; } }) }; },
  };
  const publications = [];
  const accepted = [];
  const sub = await subscribeOaepSession(recoveryClient, session, {
    onSnapshot(state) { publications.push({ ids: [...state.items.keys()], shadows: state.deltaShadows.size,
      history: withOaepHistory(history, state) }); },
    onEvent(event) { accepted.push(event.sequence); },
  });
  const sendDelta = text => {
    sequence++;
    const event = { version: "1.0", event_id: `re${sequence}`, dedupe_key: `re${sequence}`,
      session_id: session, run_id: "r-unloaded", item_id: "unloaded", sequence, timestamp: time,
      source: { backend: "test" }, type: "event.item.delta", data: { delta: { kind: "message.text.append", text } } };
    currentStream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
  };
  try {
    await wait(() => Boolean(currentStream));
    sendDelta("stale shadow");
    await wait(() => sub.cursor === 11);
    let oldRequest;
    if (recovery === "expired-history") {
      await assert.rejects(sub.loadEarlier("old-cursor"), error =>
        error.code === "oaep_history_cursor_stale" && error.message.includes("oaep_history_cursor_stale"));
    } else if (recovery === "expired-stream") {
      oldRequest = assert.rejects(sub.loadEarlier("old-cursor"), { code: "oaep_history_cursor_stale" });
      await wait(() => Boolean(releaseOldPage));
      sequence = 20; // Simulate the skipped interval represented by the new snapshot.
      expired = true;
      currentStream.close();
    } else if (recovery === "delta-count") {
      for (let i = 0; i < MAX_PENDING_OAEP_DELTAS; i++) sendDelta("x");
    } else {
      sendDelta("x".repeat(MAX_PENDING_OAEP_DELTA_BYTES));
    }
    await wait(() => sub.metrics.resnapshots === 1 && publications.length >= 2);
    assert.deepEqual([...sub.state.items.keys()], ["latest"], recovery);
    assert.equal(sub.state.items.get("latest").content.text, "authoritative latest");
    assert.equal(sub.state.deltaShadows.size, 0, "unknown old shadows are not canonical");
    assert.deepEqual([...sub.state.runs.keys()], ["r-latest"]);
    assert.equal(sub.state.history.nextCursor, "new-cursor");
    assert.equal(sub.state.history.reloadRequired, true);
    assert.match(publications.at(-1).history.message, /Reload earlier messages/);
    await assert.rejects(sub.loadEarlier("old-cursor"), { code: "oaep_history_cursor_stale" });
    if (releaseOldPage) {
      // The invalid old request must not block the new window or later overwrite it.
      await sub.loadEarlier("new-cursor");
      releaseOldPage(page([items[1]], null));
      await oldRequest;
    } else await sub.loadEarlier("new-cursor");
    assert.equal(sub.state.items.size, 3);
    assert.equal(sub.state.history.hasMore, false);
    assert.equal(sub.state.history.reloadRequired, false);
    if (recovery.startsWith("delta-")) {
      assert.equal(accepted.length, recovery === "delta-count" ? MAX_PENDING_OAEP_DELTAS : 1,
        "overflow Event is not accepted/advanced before canonical recovery");
      assert.equal(sub.cursor, sequence, "fresh checkpoint covers the overflow Event");
    }
    assert.equal(sub.terminalError, undefined);
  } finally { sub.stop(); await sub.done; }
}

// Real HTTP URL serialization preserves opaque tokens and clamps the page limit.
const originalFetch = globalThis.fetch;
let requested;
const http = new RemoteRuntimeClient("http://127.0.0.1:12345", "test-token");
globalThis.fetch = async (url) => { requested = new URL(String(url)); return new Response(JSON.stringify(page([items[2]], "next")), { status: 200 }); };
try {
  await http.getOaepSnapshot(session, { cursor: "opaque +/=?", limit: 999 });
  assert.equal(requested.searchParams.get("cursor"), "opaque +/=?");
  assert.equal(requested.searchParams.get("limit"), "500");
} finally { globalThis.fetch = originalFetch; http.close(); }
console.log("OAEP_HISTORY_PAGINATION_OK (single-page, live/shadow rebase, shared broadcast, atomic digest, counts, independent cursors, expired checkpoint reset, bounded delta recovery)");
