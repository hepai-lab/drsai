import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { SessionViewStore } from "../../shared/main/sessionViewStore";
import { LegacyConversationAdapter } from "../../shared/main/legacyConversationAdapter";
import { invalidateSessionHistorySync, syncSessionHistorySingleflight } from "../../shared/main/sessionHistorySync";
import { reduceOaepEvent, type OaepSessionState } from "../../shared/main/oaepSessionStream";
import { applyThreadSnapshotPatch, decodeThreadSnapshotPatchEvent } from "../../shared/renderer/src/threadSnapshotPatch";
import { ThreadSnapshotStore } from "../../shared/renderer/src/threadSnapshotStore";
import type { DesktopThread } from "../../shared/api/desktopApi";
import type { OaepEvent, OaepItem, OaepRun, RuntimeClient } from "../../shared/main/runtimeClient";

const sessionId = "session-p7";
const source = { backend: "codex" };
const thread = {
  id: "thread-p7", title: "P7", workspacePath: "C:\\workspace", runtimeSessionId: sessionId,
  updatedAt: "2026-08-04T00:00:00Z",
} as DesktopThread;
const oldRun = {
  id: "run-old", session_id: sessionId, status: "completed", sequence: 1,
  created_at: "2026-08-04T00:00:00Z", updated_at: "2026-08-04T00:00:01Z", source,
} as OaepRun;
const oldItem = {
  id: "old-answer", session_id: sessionId, run_id: oldRun.id, type: "message", status: "completed", sequence: 1,
  created_at: oldRun.created_at, updated_at: oldRun.updated_at, source,
  content: { role: "assistant", phase: "final", text: "Old answer", parts: [], citations: [] },
} as OaepItem;
const items = new Map([[oldItem.id, oldItem]]);
const runs = new Map([[oldRun.id, oldRun]]);
let cursor = 10;
const state = (): OaepSessionState => ({ sessionId, cursor, items, runs });
const store = new SessionViewStore(thread, sessionId, {
  state: "ready", source: "codex", loadedRuns: 1, totalRuns: 1, loadedItems: 1, totalItems: 1,
});
let renderer = store.reset(state());
assert.equal(renderer.messages.length, 1);

const liveRun = {
  ...oldRun, id: "run-live", status: "running", sequence: 2,
  created_at: "2026-08-04T00:01:00Z", updated_at: "2026-08-04T00:01:00Z",
} as OaepRun;
runs.set(liveRun.id, liveRun);
const runningItem = {
  ...oldItem, id: "live-answer", run_id: liveRun.id, status: "running", sequence: 11,
  created_at: liveRun.created_at, updated_at: liveRun.updated_at,
  content: { role: "assistant", phase: "final", text: "", parts: [], citations: [] },
} as OaepItem;
const started = {
  version: "1.0", event_id: "p7-e11", session_id: sessionId, run_id: liveRun.id, item_id: runningItem.id,
  sequence: 11, type: "event.item.started", timestamp: liveRun.created_at, dedupe_key: "p7-d11", source,
  data: { item: runningItem },
} as OaepEvent;
reduceOaepEvent(items, runs, started);
cursor = 11;
const firstPatch = store.apply(started, state());
assert(firstPatch);
assert.equal(firstPatch.patch.kind, "item.upsert");
assert("message" in firstPatch.patch && firstPatch.patch.message.id === "oaep:run-live:assistant",
  "live IPC patch must contain only the affected Item projection");
renderer = applyThreadSnapshotPatch(renderer, firstPatch);
assert.deepEqual(renderer, store.snapshot);

const completedItem = {
  ...runningItem, status: "completed", sequence: 12, updated_at: "2026-08-04T00:01:02Z",
  content: { role: "assistant", phase: "final", text: "Hello.", parts: [], citations: [] },
} as OaepItem;
const completed = {
  ...started, event_id: "p7-e12", sequence: 12, type: "event.item.completed",
  timestamp: completedItem.updated_at, dedupe_key: "p7-d12", data: { item: completedItem },
} as OaepEvent;
reduceOaepEvent(items, runs, completed);
cursor = 12;
const terminalPatch = store.apply(completed, state());
assert(terminalPatch);
renderer = applyThreadSnapshotPatch(renderer, terminalPatch);
assert.equal(renderer.messages.filter((message) => message.content === "Hello.").length, 1, "terminal replacement must not duplicate text");
assert.deepEqual(renderer, store.snapshot, "initial snapshot + patches must equal the authoritative main-process view");
assert.throws(() => applyThreadSnapshotPatch(renderer, { ...terminalPatch, version: 1 } as never), /incompatible/);
assert.throws(() => decodeThreadSnapshotPatchEvent({ ...terminalPatch, baseSequence: -1 }), /incompatible/);
assert.throws(() => decodeThreadSnapshotPatchEvent({ ...terminalPatch, patch: { ...terminalPatch.patch, message: {} } }), /incompatible/);
assert.throws(() => decodeThreadSnapshotPatchEvent({ ...terminalPatch, patch: { ...terminalPatch.patch, kind: "future.private" } }), /incompatible/);
const futureCompatible = decodeThreadSnapshotPatchEvent({
  ...terminalPatch,
  future_backend_extension: { capability: "future/1" },
  patch: { ...terminalPatch.patch, future_render_hint: "safe-to-ignore" },
});
assert.equal((futureCompatible as unknown as Record<string, unknown>).future_backend_extension instanceof Object, true,
  "future additive fields must survive decoding while old renderers safely ignore them");

const liveSnapshot = store.snapshot;
store.reset({ sessionId, cursor: 11, items: new Map([[runningItem.id, runningItem]]), runs: new Map([[liveRun.id, liveRun]]) });
assert.equal(store.sequence, 12, "a delayed history refresh must not move the shared Store cursor backwards");
assert.deepEqual(store.snapshot, liveSnapshot, "a delayed history refresh must not overwrite terminal live text");

const isolatedThread = { ...thread, id: "thread-isolated", title: "Isolated" };
const isolatedStore = new SessionViewStore(isolatedThread, "session-isolated", {
  state: "ready", source: "opendrsai", loadedRuns: 0, totalRuns: 0, loadedItems: 0, totalItems: 0,
});
isolatedStore.reset({ sessionId: "session-isolated", cursor: 0, items: new Map(), runs: new Map() });
assert.equal(isolatedStore.snapshot.messages.length, 0);
assert.equal(store.snapshot.messages.filter((message) => message.content === "Hello.").length, 1,
  "updating another Session Store must not mutate the first Session");

const legacy = new LegacyConversationAdapter(isolatedThread);
legacy.applySnapshot({ session_id: "legacy-session", snapshot_sequence: 1, next_cursor: null, items: [] });
const legacyView = legacy.applyEvent({
  event_id: "legacy-1", runtime_id: "runtime", workspace_id: "workspace", session_id: "legacy-session",
  run_id: "legacy-run", session_sequence: 2, kind: "conversation.item.upsert", timestamp: oldRun.updated_at,
  payload: {
    item_id: "legacy-answer", kind: "message", role: "assistant", revision: 1,
    source_client: "runtime", created_at: oldRun.created_at, updated_at: oldRun.updated_at,
    payload: { text: "Legacy answer" },
  },
});
assert.equal(legacyView.messages.some((message) => message.content === "Legacy answer"), true,
  "the minimum conversation/1 path must remain supported behind its Compatibility Adapter");

const rendererStore = new ThreadSnapshotStore({ [renderer.threadId]: renderer });
let activeNotifications = 0;
const unsubscribeActive = rendererStore.subscribe(renderer.threadId, () => { activeNotifications += 1; });
for (let index = 0; index < 1_000; index += 1) {
  rendererStore.set("unrelated-thread", { ...renderer, threadId: "unrelated-thread", updatedAt: index });
}
assert.equal(activeNotifications, 0, "1,000 unrelated body updates must not notify the active Session selector");
rendererStore.set(renderer.threadId, { ...renderer, updatedAt: renderer.updatedAt + 1 });
assert.equal(activeNotifications, 1);
assert.equal(rendererStore.diagnostics().sessions, 2);
assert.equal(rendererStore.diagnostics().subscribers, 1);
unsubscribeActive();
assert.equal(rendererStore.diagnostics().sessions, 2);
assert.equal(rendererStore.diagnostics().subscribers, 0);

let syncCalls = 0;
const syncClient = {
  location: "local", streamIdentity: "runtime:p7-singleflight",
  async syncBackendSessionHistory() {
    syncCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { session_id: sessionId, backend_id: "codex", imported: 0, total: 2 };
  },
} as unknown as RuntimeClient;
invalidateSessionHistorySync();
await Promise.all(Array.from({ length: 20 }, () => syncSessionHistorySingleflight(syncClient, sessionId)));
assert.equal(syncCalls, 1, "concurrent get/subscribe hydration must share one backend history sync");
await syncSessionHistorySingleflight(syncClient, sessionId);
assert.equal(syncCalls, 1, "recent history watermark must avoid an immediate duplicate thread/read");
invalidateSessionHistorySync(syncClient, sessionId);
await syncSessionHistorySingleflight(syncClient, sessionId);
assert.equal(syncCalls, 2, "explicit invalidation must permit one fresh history sync");

invalidateSessionHistorySync();
let underlyingCancelled = 0;
let releaseSync!: () => void;
const cancellableClient = {
  location: "local", streamIdentity: "runtime:p7-cancellable",
  syncBackendSessionHistory(_id: string, signal?: AbortSignal) {
    return new Promise((resolve, reject) => {
      releaseSync = () => resolve({ session_id: sessionId, backend_id: "codex", imported: 2, total: 2 });
      signal?.addEventListener("abort", () => { underlyingCancelled += 1; reject(signal.reason); }, { once: true });
    });
  },
} as unknown as RuntimeClient;
const firstAbort = new AbortController();
const phases: string[] = [];
const cancelledWaiter = syncSessionHistorySingleflight(cancellableClient, sessionId, { signal: firstAbort.signal });
const survivingWaiter = syncSessionHistorySingleflight(cancellableClient, sessionId, { onProgress: (phase) => phases.push(phase) });
firstAbort.abort(new DOMException("cancelled", "AbortError"));
await assert.rejects(cancelledWaiter, /cancelled/);
assert.equal(underlyingCancelled, 0, "cancelling one shared history waiter must not abort another active consumer");
releaseSync();
await survivingWaiter;
assert.deepEqual(phases, ["persisted"], "history sync must not synthesize phases that Runtime did not report");

invalidateSessionHistorySync();
const onlyAbort = new AbortController();
const abandoned = syncSessionHistorySingleflight(cancellableClient, sessionId, { signal: onlyAbort.signal });
onlyAbort.abort(new DOMException("cancelled alone", "AbortError"));
await assert.rejects(abandoned, /cancelled alone/);
assert.equal(underlyingCancelled, 1, "the Runtime request must stop when the last history-sync consumer cancels");

const performanceRows: Array<{ historySize: number; microsPerPatch: number; patchBytes: number }> = [];
for (const historySize of [60, 500, 5_000]) {
  const perfItems = new Map<string, OaepItem>();
  const perfRuns = new Map<string, OaepRun>();
  for (let index = 0; index < historySize; index += 1) {
    const id = `perf-run-${index}`;
    const run = { ...oldRun, id, sequence: index + 1 } as OaepRun;
    const value = { ...oldItem, id: `perf-item-${index}`, run_id: id, sequence: index + 1 } as OaepItem;
    perfRuns.set(id, run);
    perfItems.set(value.id, value);
  }
  const activeRunId = `perf-run-${historySize - 1}`;
  const activeItemId = `perf-item-${historySize - 1}`;
  const perfStore = new SessionViewStore(thread, sessionId, {
    state: "ready", source: "codex", loadedRuns: historySize, totalRuns: historySize,
    loadedItems: historySize, totalItems: historySize,
  });
  perfStore.reset({ sessionId, cursor: historySize, items: perfItems, runs: perfRuns });
  let patchBytes = 0;
  const startedAt = performance.now();
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const event = {
      version: "1.0", event_id: `perf-${iteration}`, session_id: sessionId, run_id: activeRunId, item_id: activeItemId,
      sequence: historySize + iteration + 1, type: "event.item.delta", timestamp: "2026-08-04T00:02:00Z",
      dedupe_key: `perf-d-${iteration}`, source, data: { delta: { kind: "message.text.append", text: "x" } },
    } as OaepEvent;
    const patch = perfStore.apply(event, {
      sessionId, cursor: event.sequence, items: perfItems, runs: perfRuns,
    });
    assert(patch);
    patchBytes = Math.max(patchBytes, Buffer.byteLength(JSON.stringify(patch)));
  }
  performanceRows.push({
    historySize,
    microsPerPatch: ((performance.now() - startedAt) * 1_000) / 200,
    patchBytes,
  });
}
const patchSizes = performanceRows.map((row) => row.patchBytes);
assert(Math.max(...patchSizes) - Math.min(...patchSizes) < 32, "incremental IPC size must be independent of history length");
assert(performanceRows.every((row) => row.microsPerPatch < 2_000), JSON.stringify(performanceRows));

const subscriptionSource = await readFile(resolve(process.cwd(), "../shared/main/threadRuntimeSubscription.ts"), "utf8");
const getSnapshotStart = subscriptionSource.indexOf("export async function getRuntimeThreadSnapshot(");
const subscribeStart = subscriptionSource.indexOf("export async function subscribeRuntimeThreadSnapshot(");
const getSnapshotSource = subscriptionSource.slice(getSnapshotStart, subscribeStart);
assert(getSnapshotSource.includes("subscribeOaepSession("),
  "one-shot history reads must join the same Session Owner as live chat and subscriptions");
assert.equal(getSnapshotSource.includes("getOaepSnapshot("), false,
  "one-shot history reads must not create an independent OAEP snapshot path");
assert(subscriptionSource.includes("new LegacyConversationAdapter(thread)"),
  "legacy conversation/1 reduction must enter through the isolated Compatibility Adapter");
assert.equal(subscriptionSource.includes('event.kind === "conversation.item.'), false,
  "the OAEP subscription owner must not contain legacy item-kind reduction branches");
const subscribeSource = subscriptionSource.slice(subscribeStart);
assert(subscribeSource.includes("generation: viewStore.generation") && subscribeSource.includes('projection: "oaep/1"'),
  "the initial OAEP view must carry an explicit schema and projection version");

for (const rendererPath of [
  "../shared/renderer/src/App.tsx",
  "src/renderer/src/App.tsx",
]) {
  const rendererSource = await readFile(resolve(process.cwd(), rendererPath), "utf8");
  assert.equal(/localStorage\.setItem\([^)]*threadSnapshot/i.test(rendererSource), false,
    `${rendererPath} must not synchronously persist complete thread history`);
}

console.log("P7 incremental Session View Store verification passed.", performanceRows);
