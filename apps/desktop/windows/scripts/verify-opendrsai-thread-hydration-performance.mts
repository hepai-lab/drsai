import assert from "node:assert/strict";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { join, resolve } from "node:path";
import { ThreadSnapshotStore } from "../../shared/renderer/src/threadSnapshotStore.ts";

const root = process.cwd();
const fixtureRoot = resolve(root, "out", "verification", "opendrsai-thread-hydration-performance");
const desktopDirectory = join(fixtureRoot, "desktop");
const threadsPath = join(desktopDirectory, "threads.json");

await rm(fixtureRoot, { recursive: true, force: true });
await mkdir(desktopDirectory, { recursive: true });
process.env.DRSAI_HOME = fixtureRoot;

const now = Date.now();
const threads = Array.from({ length: 10_000 }, (_, index) => ({
  id: `thread-${String(index).padStart(4, "0")}`,
  kind: "chat" as const,
  title: `OpenDrSai session ${index + 1}`,
  workspacePath: "C:\\OpenDrSai\\workspace",
  boundAgentId: "my-drsai",
  boundAgentName: "OpenDrSai",
  runtimeSessionId: `runtime-session-${index}`,
  createdAt: new Date(now - index * 1_000).toISOString(),
  updatedAt: new Date(now - index * 1_000).toISOString(),
  status: "idle" as const,
  messageCount: index === 9_999 ? 500 : 2,
  ...(index === 9_999 ? { pinned: true } : {}),
  ...(index === 9_998 ? { status: "running" as const } : {}),
  ...(index >= 8_000 && index < 9_000 ? { archived: true } : {}),
}));
await writeFile(threadsPath, `${JSON.stringify(threads)}\n`, "utf8");

const threadModule = await import("../../shared/main/threads.ts");
const selected = threads[9_999];
const longBody = "OpenDrSai long-history body ".repeat(4_000);
await threadModule.updateThreadSnapshot({
  threadId: selected.id,
  title: selected.title,
  messages: Array.from({ length: 500 }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `${index}: ${longBody}`,
  })),
  updatedAt: now,
  messageCount: 500,
});

threadModule.resetThreadSnapshotIoMetrics();
const directoryBytesBefore = (await stat(threadsPath)).size;
const samples: number[] = [];
for (let run = 0; run < 20; run += 1) {
  const started = performance.now();
  const directory = await threadModule.listThreads();
  samples.push(performance.now() - started);
  assert.equal(directory.length, 2_000, "the retained directory must contain 1,000 active and 1,000 archived metadata entries");
  assert.equal(directory[0].id, "thread-9999", "pinned directory ordering must remain deterministic");
}
const afterDirectoryReads = threadModule.getThreadSnapshotIoMetrics();
assert.deepEqual(afterDirectoryReads, {
  shardReads: 0,
  shardWrites: 0,
  legacyCatalogReads: 0,
  shardDirectoryScans: 0,
}, "directory reads must not scan, read, or rewrite conversation bodies");
assert.equal((await stat(threadsPath)).size, directoryBytesBefore, "idle directory refresh must not grow persistent data");

threadModule.resetThreadSnapshotIoMetrics();
const recent = await threadModule.listThreads({
  workspacePath: "C:\\OpenDrSai\\workspace",
  limit: 50,
  requiredThreadIds: [threads[997].id],
});
assert.equal(recent.length, 53, "50 recent entries plus current, pinned, and running entries must be retained");
assert(recent.some((thread) => thread.id === threads[997].id), "the current entry must survive the recent window");
assert(recent.some((thread) => thread.id === threads[9_998].id), "a running entry must survive the recent window");
assert(recent.some((thread) => thread.id === threads[9_999].id), "a pinned entry must survive the recent window");
assert(recent.every((thread) => !thread.archived), "archived entries must stay out of the startup catalog");
const nextRecentPage = await threadModule.listThreads({
  workspacePath: "C:\\OpenDrSai\\workspace",
  limit: 50,
  offset: 50,
  requiredThreadIds: [threads[997].id],
});
assert.equal(nextRecentPage.length, 50, "the second metadata page must stay bounded");
assert.equal(new Set([...recent, ...nextRecentPage].map((thread) => thread.id)).size, 103,
  "protected entries must not reappear in later pages or displace ordinary entries");
const recentWithArchived = await threadModule.listThreads({
  workspacePath: "C:\\OpenDrSai\\workspace",
  limit: 50,
  includeArchived: true,
  requiredThreadIds: [threads[997].id],
});
assert.equal(recentWithArchived.filter((thread) => thread.archived).length, 50,
  "archived metadata must remain bounded when explicitly requested");
const nextArchivedPage = await threadModule.listThreads({
  workspacePath: "C:\\OpenDrSai\\workspace",
  limit: 50,
  offset: 50,
  includeArchived: true,
});
assert.equal(nextArchivedPage.filter((thread) => thread.archived).length, 50,
  "archived metadata must support an independent second page");
assert.equal(new Set([
  ...recentWithArchived.filter((thread) => thread.archived),
  ...nextArchivedPage.filter((thread) => thread.archived),
].map((thread) => thread.id)).size, 100, "archived pages must not overlap");
assert.deepEqual(threadModule.getThreadSnapshotIoMetrics(), {
  shardReads: 0,
  shardWrites: 0,
  legacyCatalogReads: 0,
  shardDirectoryScans: 0,
}, "bounded directory reads must not hydrate conversation bodies");

const batchEntries = Array.from({ length: 50 }, (_, index) => ({
  id: `session-bootstrap-${index}`,
  title: `Bootstrap ${index}`,
  workspacePath: "C:\\OpenDrSai\\workspace",
  runtimeSessionId: `session-bootstrap-${index}`,
  createdAt: `2028-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
  updatedAt: `2028-01-02T00:${String(index).padStart(2, "0")}:00.000Z`,
  archived: false,
  messageCount: index,
}));
const batchUpsert = await threadModule.upsertThreadsFromRuntimeCatalog(batchEntries);
assert.equal(batchUpsert.length, 50);
assert(batchUpsert.every((result) => result.changed), "the first bootstrap batch must persist every new entry");
const batchFileAfterWrite = await stat(threadsPath);
await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
const batchReplay = await threadModule.upsertThreadsFromRuntimeCatalog(batchEntries);
assert(batchReplay.every((result) => !result.changed), "an identical bootstrap page must be a batch no-op");
assert.equal((await stat(threadsPath)).mtimeMs, batchFileAfterWrite.mtimeMs,
  "an identical bootstrap page must not rewrite the directory file");

const authoritativeUpdatedAt = "2029-01-02T03:04:05.000Z";
const catalogUpsert = await threadModule.upsertThreadFromRuntimeCatalog({
  id: "session-runtime-catalog",
  title: "Runtime catalog entry",
  workspacePath: "C:\\OpenDrSai\\workspace",
  runtimeSessionId: "session-runtime-catalog",
  createdAt: "2029-01-01T03:04:05.000Z",
  updatedAt: authoritativeUpdatedAt,
  archived: false,
  messageCount: 4,
});
assert.equal(catalogUpsert.changed, true);
assert.equal(catalogUpsert.thread.updatedAt, authoritativeUpdatedAt,
  "catalog replay must preserve the Runtime activity timestamp");
const catalogFileAfterWrite = await stat(threadsPath);
await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
const catalogReplay = await threadModule.upsertThreadFromRuntimeCatalog({
  id: "session-runtime-catalog",
  title: "Runtime catalog entry",
  workspacePath: "C:\\OpenDrSai\\workspace",
  runtimeSessionId: "session-runtime-catalog",
  createdAt: "2029-01-01T03:04:05.000Z",
  updatedAt: authoritativeUpdatedAt,
  archived: false,
  messageCount: 4,
});
const catalogFileAfterReplay = await stat(threadsPath);
assert.equal(catalogReplay.changed, false, "an identical catalog event must be a no-op");
assert.equal(catalogFileAfterReplay.mtimeMs, catalogFileAfterWrite.mtimeMs,
  "an identical catalog event must not rewrite the directory file");

const hydrated = await threadModule.getThreadSnapshot(selected.id);
assert.equal(hydrated?.messageCount, 500);
assert.equal(hydrated?.messages.length, 500);
const afterHydration = threadModule.getThreadSnapshotIoMetrics();
assert.equal(afterHydration.shardReads, 1, "opening one session must read exactly one body shard");
assert.equal(afterHydration.legacyCatalogReads, 0, "a sharded body must not fall back to the legacy all-body catalog");

const store = new ThreadSnapshotStore({}, 128, 64 * 1024 * 1024, 60_000);
let activeNotifications = 0;
const unsubscribe = store.subscribe(selected.id, () => { activeNotifications += 1; });
store.set(selected.id, hydrated!);
for (let index = 0; index < 1_000; index += 1) {
  store.set(`inactive-${index}`, {
    threadId: `inactive-${index}`,
    title: `Inactive ${index}`,
    messages: [{ id: `inactive-message-${index}`, role: "assistant", content: "x".repeat(8_192) }],
    updatedAt: now + index,
    messageCount: 1,
  });
}
const diagnostics = store.diagnostics();
assert(store.get(selected.id), "the subscribed active body must survive inactive-session churn");
assert(diagnostics.sessions <= diagnostics.maximumSessions, JSON.stringify(diagnostics));
assert(diagnostics.bytes <= diagnostics.maximumBytes, JSON.stringify(diagnostics));
assert.equal(activeNotifications, 1, "inactive body churn must not notify the active session selector");
unsubscribe();

const appSource = await readFile(resolve(root, "../shared/renderer/src/App.tsx"), "utf8");
const selectStart = appSource.indexOf("function handleThreadSelect(threadId: string)");
const selectEnd = appSource.indexOf("async function handleNewAgentTask", selectStart);
const selectSource = appSource.slice(selectStart, selectEnd);
assert(selectStart >= 0 && selectEnd > selectStart, "thread selection implementation is missing");
assert(selectSource.indexOf("setActiveThreadId(threadId)") < selectSource.indexOf("hydrateThreadSnapshot(threadId)"),
  "selection feedback must commit before asynchronous body hydration starts");

const ordered = [...samples].sort((left, right) => left - right);
const p95Ms = ordered[Math.ceil(ordered.length * 0.95) - 1] ?? 0;
assert(p95Ms < 200, `10,000-source-entry directory P95 exceeded the 200ms feedback budget: ${p95Ms.toFixed(1)}ms`);

await rm(fixtureRoot, { recursive: true, force: true });
console.log("OpenDrSai thread hydration performance verification passed.", {
  sessions: threads.length,
  directoryP95Ms: Number(p95Ms.toFixed(1)),
  firstPaintBodyReads: afterDirectoryReads.shardReads,
  selectedBodyReads: afterHydration.shardReads,
  idleDirectoryGrowthBytes: 0,
  rendererCache: diagnostics,
});
