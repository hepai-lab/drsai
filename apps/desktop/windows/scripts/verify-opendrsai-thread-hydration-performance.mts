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
const threads = Array.from({ length: 1_000 }, (_, index) => ({
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
  messageCount: index === 999 ? 500 : 2,
}));
await writeFile(threadsPath, `${JSON.stringify(threads)}\n`, "utf8");

const threadModule = await import("../../shared/main/threads.ts");
const selected = threads[999];
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
  assert.equal(directory.length, 1_000, "the active session directory must retain 1,000 metadata entries");
  assert.equal(directory[0].id, "thread-0000", "directory ordering must remain deterministic");
}
const afterDirectoryReads = threadModule.getThreadSnapshotIoMetrics();
assert.deepEqual(afterDirectoryReads, {
  shardReads: 0,
  shardWrites: 0,
  legacyCatalogReads: 0,
  shardDirectoryScans: 0,
}, "directory reads must not scan, read, or rewrite conversation bodies");
assert.equal((await stat(threadsPath)).size, directoryBytesBefore, "idle directory refresh must not grow persistent data");

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
assert(p95Ms < 200, `1,000-entry directory P95 exceeded the 200ms feedback budget: ${p95Ms.toFixed(1)}ms`);

await rm(fixtureRoot, { recursive: true, force: true });
console.log("OpenDrSai thread hydration performance verification passed.", {
  sessions: threads.length,
  directoryP95Ms: Number(p95Ms.toFixed(1)),
  firstPaintBodyReads: afterDirectoryReads.shardReads,
  selectedBodyReads: afterHydration.shardReads,
  idleDirectoryGrowthBytes: 0,
  rendererCache: diagnostics,
});
