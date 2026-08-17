import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "opendrsai-thread-test-"));
process.env.DRSAI_HOME = root;

try {
  const threads = await import("../main/threads.ts");
  const created = await threads.createThread({ kind: "agent_run", title: "Recovery run", workspacePath: root, boundAgentId: "agent-test", boundAgentName: "Test Agent" });
  assert.equal(created.status, "idle");
  const running = await threads.updateThread({ id: created.id, status: "running", lastRunId: "run-001", lastRequestId: "request-001", runtimeSessionId: "session-001", messageCount: 2 });
  assert.equal(running.lastRunId, "run-001");
  assert.equal(running.runtimeSessionId, "session-001");
  await threads.updateThreadSnapshot({
    threadId: created.id,
    title: running.title,
    messages: [
      { id: "message-user", role: "user", content: "find the recovery marker" },
      { id: "message-assistant", role: "assistant", content: "recovery marker restored" },
    ],
    updatedAt: Date.now(),
    messageCount: 2,
  });
  assert.equal((await threads.getThreadSnapshot(created.id))?.messages.length, 2);
  assert.equal((await threads.searchThreadMessages({ query: "recovery marker", threadIds: [created.id] }))[0]?.threadId, created.id);
  assert.equal((await threads.updateThread({ id: created.id, archived: true })).archived, true);
  assert.equal((await threads.listThreads()).some((thread) => thread.id === created.id), true);
  assert.equal(await threads.deleteThread(created.id), true);
  assert.equal(await threads.deleteThread(created.id), false, "Delete must be idempotent and report an absent thread.");
  assert.equal((await threads.listThreads()).some((thread) => thread.id === created.id), false);
  assert.equal(await threads.getThreadSnapshot(created.id), null, "Deleting a thread must delete its persisted snapshot.");
  assert.deepEqual(JSON.parse(await readFile(join(root, "desktop", "threads.json"), "utf8")), []);
  const shard = join(root, "desktop", "thread-snapshots", `${createHash("sha256").update(created.id).digest("hex")}.json`);
  await assert.rejects(access(shard), /ENOENT/, "Deleting a thread must remove its snapshot shard.");
  const legacySnapshotsPath = join(root, "desktop", "thread-snapshots.json");
  try {
    assert.deepEqual(JSON.parse(await readFile(legacySnapshotsPath, "utf8")), {});
  } catch (error) {
    assert.equal((error as NodeJS.ErrnoException).code, "ENOENT", "Legacy snapshot catalog may be absent when only sharded snapshots existed.");
  }

  // Late upserts that passed an outer tombstone check must not recreate the row
  // after deleteThread has removed it from threads.json.
  const raceTarget = await threads.createThread({ kind: "chat", title: "Race delete", workspacePath: root });
  const deleteStarted = threads.deleteThread(raceTarget.id);
  await Promise.resolve();
  await assert.rejects(
    () => threads.updateThread({ id: raceTarget.id, status: "idle", messageCount: 1 }),
    (error: unknown) => threads.isThreadDeletedError(error),
  );
  assert.equal(await deleteStarted, true);
  assert.equal((await threads.listThreads()).some((thread) => thread.id === raceTarget.id), false);
  assert.deepEqual(JSON.parse(await readFile(join(root, "desktop", "threads.json"), "utf8")), []);
  const softUpsert = await threads.upsertThreadFromRun({ id: raceTarget.id, kind: "chat", status: "error" });
  assert.equal(softUpsert.id, raceTarget.id);
  assert.equal((await threads.listThreads()).some((thread) => thread.id === raceTarget.id), false, "upsertThreadFromRun must not resurrect a deleted thread.");

  // Durable tombstones must survive process-local Set loss (simulated by reading the file).
  const deletedPath = join(root, "desktop", "deleted-threads.json");
  const tombstones = JSON.parse(await readFile(deletedPath, "utf8"));
  assert.ok(tombstones.includes(raceTarget.id), "deleteThread must persist a durable tombstone.");

  const desktopOwned = await threads.createThread({ kind: "chat", title: "hi", workspacePath: root });
  await threads.updateThread({ id: desktopOwned.id, runtimeSessionId: "session-dup-001", title: "hi", messageCount: 2 });
  const catalogMerge = await threads.upsertThreadFromRuntimeCatalog({
    id: "session-dup-001",
    title: "hi",
    workspacePath: root,
    runtimeSessionId: "session-dup-001",
    archived: false,
    messageCount: 3,
  });
  assert.equal(catalogMerge.thread.id, desktopOwned.id, "Runtime catalog must reuse the Desktop thread-* row.");
  const afterCatalog = await threads.listThreads();
  assert.equal(
    afterCatalog.filter((thread) => thread.runtimeSessionId === "session-dup-001" || thread.id === "session-dup-001").length,
    1,
    "A bound Desktop thread must not keep a session_id sidebar orphan.",
  );

  const pendingOwner = await threads.createThread({ kind: "chat", title: "e", workspacePath: root });
  threads.expectRuntimeSessionBind({ threadId: pendingOwner.id, workspacePath: root, title: "e" });
  const liveCatalog = await threads.upsertThreadFromRuntimeCatalog({
    id: "session-live-e",
    title: "e",
    workspacePath: root,
    runtimeSessionId: "session-live-e",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archived: false,
    messageCount: 1,
  });
  assert.equal(liveCatalog.thread.id, pendingOwner.id, "A catalog event during createSession must reuse the pending Desktop thread.");
  assert.equal(liveCatalog.thread.runtimeSessionId, "session-live-e");
  assert.equal(
    (await threads.listThreads()).filter((thread) => thread.title === "e" || thread.id === "session-live-e").length,
    1,
    "Pending Desktop binds must not materialize a second sidebar row.",
  );

  const staleOwner = await threads.createThread({ kind: "chat", title: "stale-title", workspacePath: root });
  threads.expectRuntimeSessionBind({ threadId: staleOwner.id, workspacePath: root, title: "stale-title" });
  const staleCatalog = await threads.upsertThreadFromRuntimeCatalog({
    id: "session-stale-title",
    title: "stale-title",
    workspacePath: root,
    runtimeSessionId: "session-stale-title",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    archived: false,
    messageCount: 1,
  });
  assert.equal(staleCatalog.thread.id, "session-stale-title", "Historical catalog rows must not steal a pending live bind.");

  const { canonicalizeSidebarThreads, shouldMaterializeCatalogThread } = await import("../api/threadSidebarCatalog.ts");
  const desktopRow = {
    id: "thread-live-e",
    kind: "chat" as const,
    title: "a",
    workspacePath: root,
    createdAt: "2026-08-17T01:52:38.485330+00:00",
    updatedAt: "2026-08-17T01:52:44.812Z",
    runtimeSessionId: "thread-live-e",
    status: "idle" as const,
  };
  const catalogRow = {
    id: "session-live-orphan",
    kind: "chat" as const,
    title: "a",
    workspacePath: root,
    createdAt: "2026-08-17T01:52:38.485330+00:00",
    updatedAt: "2026-08-17T01:52:38.608730+00:00",
    runtimeSessionId: "session-live-orphan",
    status: "idle" as const,
  };
  const collapsed = canonicalizeSidebarThreads([desktopRow, catalogRow]);
  assert.equal(collapsed.length, 1, "Sidebar canonicalization must keep one row for a Desktop chat and its Runtime session.");
  assert.equal(collapsed[0]?.id, "thread-live-e");
  assert.equal(collapsed[0]?.runtimeSessionId, "session-live-orphan");
  assert.equal(shouldMaterializeCatalogThread({ mode: "live" }), false, "Live catalog must not invent a Desktop chat row.");
  assert.equal(shouldMaterializeCatalogThread({ mode: "live", ownerThreadId: "thread-live-e" }), true);
  assert.equal(shouldMaterializeCatalogThread({ mode: "live", sourceChannel: "wechat" }), true);
  assert.equal(shouldMaterializeCatalogThread({ mode: "bootstrap" }), true);

  console.log("Thread lifecycle and persistence verification passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}
