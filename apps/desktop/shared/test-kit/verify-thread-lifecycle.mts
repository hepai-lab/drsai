import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  const { canonicalizeSidebarThreads, runtimeSessionIdForLookup, shouldMaterializeCatalogThread } = await import("../api/threadSidebarCatalog.ts");
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

  const duplicatePrompt = (id: string, kind: "thread" | "session", updatedAt: string) => ({
    id,
    kind: "chat" as const,
    title: "请分析这张 OpenDrSai",
    workspacePath: root,
    createdAt: "2026-08-17T07:50:00.000Z",
    updatedAt,
    runtimeSessionId: kind === "session" ? id : undefined,
    status: "idle" as const,
  });
  const duplicateDesktop = [
    duplicatePrompt("thread-dup-a", "thread", "2026-08-17T07:58:00.000Z"),
    duplicatePrompt("thread-dup-b", "thread", "2026-08-17T07:57:00.000Z"),
    duplicatePrompt("thread-dup-c", "thread", "2026-08-17T07:56:00.000Z"),
  ];
  const duplicateSessions = [
    duplicatePrompt("session-dup-a", "session", "2026-08-17T07:58:01.000Z"),
    duplicatePrompt("session-dup-b", "session", "2026-08-17T07:57:01.000Z"),
    duplicatePrompt("session-dup-c", "session", "2026-08-17T07:56:01.000Z"),
  ];
  const collapsedDuplicates = canonicalizeSidebarThreads([...duplicateSessions, ...duplicateDesktop]);
  const collapsedDuplicatesReversed = canonicalizeSidebarThreads([...duplicateDesktop, ...duplicateSessions].reverse());
  assert.equal(collapsedDuplicates.length, 3, "Repeated prompts must not create a second Runtime row per Desktop chat.");
  assert.equal(collapsedDuplicatesReversed.length, 3, "Sidebar duplicate collapse must not depend on catalog arrival order.");
  assert.deepEqual(collapsedDuplicates.map((thread) => thread.id).sort(), ["thread-dup-a", "thread-dup-b", "thread-dup-c"]);

  const desktopPrompt = {
    id: "thread-title-mismatch",
    kind: "chat" as const,
    title: "请生成一张 16:9 横版科技插图，主题是“OpenDrSai Agent Runtime”。",
    workspacePath: root,
    createdAt: "2026-08-17T07:52:20.772257+00:00",
    updatedAt: "2026-08-17T07:53:35.564Z",
    runtimeSessionId: "thread-title-mismatch",
    status: "idle" as const,
    messageCount: 4,
  };
  const catalogPrompt = {
    id: "session-title-mismatch",
    kind: "chat" as const,
    title: "请生成一张 16:9 横版科技插图，主题是“OpenDrSai Agent Runtime”。\n\n画面要求：\n- 深蓝色背景；\n- 画面中央是一个发光的智能体核",
    workspacePath: root,
    createdAt: "2026-08-17T07:52:20.772257+00:00",
    updatedAt: "2026-08-17T07:57:23.394242+00:00",
    runtimeSessionId: "session-title-mismatch",
    status: "idle" as const,
    messageCount: 0,
  };
  const collapsedPrompt = canonicalizeSidebarThreads([catalogPrompt, desktopPrompt]);
  assert.equal(collapsedPrompt.length, 1, "Desktop and Runtime rows for the same send must collapse even when titles keep different newlines.");
  assert.equal(collapsedPrompt[0]?.id, "thread-title-mismatch");
  assert.equal(collapsedPrompt[0]?.runtimeSessionId, "session-title-mismatch");

  const invalidBinding = threads.migrateInvalidRuntimeSessionBinding({
    id: "thread-invalid-session",
    kind: "chat",
    title: "x",
    workspacePath: root,
    createdAt: "2026-08-17T08:00:00.000Z",
    updatedAt: "2026-08-17T08:00:00.000Z",
    runtimeSessionId: "thread-invalid-session",
    status: "idle",
  });
  assert.equal(invalidBinding.runtimeSessionId, undefined, "Desktop rows must never keep thread-* as runtimeSessionId.");

  const persistedDuplicate = await threads.upsertThreadFromRuntimeCatalog({
    id: "session-persisted-dup",
    title: "请生成一张 16:9 横版科技插图，主题是“OpenDrSai Agent Runtime”。\n\n画面要求：",
    workspacePath: root,
    runtimeSessionId: "session-persisted-dup",
    createdAt: "2026-08-17T08:01:00.000Z",
    updatedAt: "2026-08-17T08:01:00.000Z",
    archived: false,
    messageCount: 0,
  });
  assert.equal(persistedDuplicate.thread.id, "session-persisted-dup");
  const desktopOwner = await threads.createThread({
    kind: "chat",
    title: "请生成一张 16:9 横版科技插图，主题是“OpenDrSai Agent Runtime”。",
    workspacePath: root,
  });
  // Simulate the historical bad row: Desktop kept thread-* as runtimeSessionId
  // while Runtime catalog inserted a sibling session-* with the same createdAt.
  const raw = JSON.parse(await readFile(join(root, "desktop", "threads.json"), "utf8"));
  for (const row of raw) {
    if (row.id === desktopOwner.id) {
      row.createdAt = "2026-08-17T08:01:00.000Z";
      row.updatedAt = "2026-08-17T08:01:30.000Z";
      row.runtimeSessionId = desktopOwner.id;
      row.messageCount = 2;
    }
  }
  await writeFile(join(root, "desktop", "threads.json"), JSON.stringify(raw));
  const afterMigration = await threads.listThreads();
  assert.equal(
    afterMigration.filter((thread) =>
      thread.id === desktopOwner.id
      || thread.id === "session-persisted-dup"
      || thread.runtimeSessionId === "session-persisted-dup").length,
    1,
    "Reading threads.json must permanently merge Desktop/Runtime duplicates and bind the real session id.",
  );
  assert.equal(
    afterMigration.find((thread) => thread.id === desktopOwner.id)?.runtimeSessionId,
    "session-persisted-dup",
  );
  const persistedAfterMerge = JSON.parse(await readFile(join(root, "desktop", "threads.json"), "utf8"));
  assert.equal(persistedAfterMerge.filter((thread) => thread.id === "session-persisted-dup").length, 0);
  assert.equal(persistedAfterMerge.find((thread) => thread.id === desktopOwner.id)?.runtimeSessionId, "session-persisted-dup");

  assert.equal(shouldMaterializeCatalogThread({ mode: "live" }), false, "Live catalog must not invent a Desktop chat row.");
  assert.equal(shouldMaterializeCatalogThread({ mode: "live", ownerThreadId: "thread-live-e" }), true);
  assert.equal(shouldMaterializeCatalogThread({ mode: "live", sourceChannel: "wechat" }), true);
  assert.equal(shouldMaterializeCatalogThread({ mode: "bootstrap" }), true);

  assert.equal(runtimeSessionIdForLookup({ runtimeSessionId: "thread-live-e" }), undefined, "Desktop thread ids must not be used as Runtime session ids.");
  assert.equal(runtimeSessionIdForLookup({ runtimeSessionId: "session-live-orphan" }), "session-live-orphan");

  const hydration = await import("../api/threadSnapshotHydration.ts");
  const persisted = {
    threadId: "thread-w",
    title: "w",
    messages: [
      { id: "user-w", role: "user" as const, content: "w" },
      { id: "assistant-w", role: "assistant" as const, content: "hello" },
    ],
    updatedAt: 1,
    messageCount: 2,
  };
  const emptyRuntime = {
    version: 1 as const,
    projection: "oaep/1" as const,
    threadId: "thread-w",
    runtimeSessionId: "session-w",
    sessionSequence: 4,
    generation: 1,
    source: "runtime" as const,
    snapshot: { threadId: "thread-w", title: "w", messages: [], updatedAt: 2, messageCount: 0 },
  };
  const coalesced = hydration.coalesceHydrationEnvelope("thread-w", { runtimeSessionId: "session-w" }, emptyRuntime, persisted);
  assert.equal(coalesced?.source, "persisted", "Empty Runtime history must fall back to the persisted snapshot.");
  assert.equal(coalesced?.snapshot.messageCount, 2);

  const counted = await threads.createThread({ kind: "chat", title: "count-keep", workspacePath: root });
  await threads.updateThread({ id: counted.id, runtimeSessionId: "session-count-keep", messageCount: 2 });
  const catalogZero = await threads.upsertThreadFromRuntimeCatalog({
    id: "session-count-keep",
    title: "count-keep",
    workspacePath: root,
    runtimeSessionId: "session-count-keep",
    archived: false,
    messageCount: 0,
  });
  assert.equal(catalogZero.thread.messageCount, 2, "Runtime catalog 0 must not wipe a Desktop messageCount.");

  const doomed = await threads.createThread({ kind: "chat", title: "resurrect-me", workspacePath: root });
  await threads.updateThread({ id: doomed.id, runtimeSessionId: "session-resurrect-me", messageCount: 1 });
  assert.equal(await threads.deleteThread(doomed.id), true);
  const resurrect = await threads.upsertThreadFromRuntimeCatalog({
    id: "session-resurrect-me",
    title: "resurrect-me",
    workspacePath: root,
    runtimeSessionId: "session-resurrect-me",
    archived: false,
    messageCount: 4,
  });
  assert.equal(resurrect.changed, false, "Runtime catalog bootstrap must not resurrect a deleted conversation.");
  assert.equal(
    (await threads.listThreads()).some((thread) =>
      thread.id === doomed.id || thread.id === "session-resurrect-me" || thread.runtimeSessionId === "session-resurrect-me"),
    false,
    "Deleted conversations must stay out of the sidebar after Runtime catalog sync.",
  );
  const resurrectionTombstones = JSON.parse(await readFile(deletedPath, "utf8"));
  assert.ok(resurrectionTombstones.includes(doomed.id), "deleteThread must tombstone the Desktop thread id.");
  assert.ok(resurrectionTombstones.includes("session-resurrect-me"), "deleteThread must tombstone the Runtime session id.");

  const liveKeep = await threads.createThread({ kind: "chat", title: "keep-me", workspacePath: root });
  await threads.updateThread({ id: liveKeep.id, runtimeSessionId: "session-keep-me", messageCount: 2 });
  const batch = await threads.upsertThreadsFromRuntimeCatalog([
    {
      id: "session-resurrect-me",
      title: "resurrect-me",
      workspacePath: root,
      runtimeSessionId: "session-resurrect-me",
      archived: false,
      messageCount: 9,
    },
    {
      id: "session-keep-me",
      title: "keep-me",
      workspacePath: root,
      runtimeSessionId: "session-keep-me",
      archived: false,
      messageCount: 2,
    },
    {
      id: "session-fresh-import",
      title: "fresh-import",
      workspacePath: root,
      runtimeSessionId: "session-fresh-import",
      archived: false,
      messageCount: 1,
    },
  ]);
  assert.equal(batch[0]?.changed, false, "Batch Runtime bootstrap must skip a tombstoned session.");
  assert.equal(batch[1]?.thread.id, liveKeep.id, "Batch Runtime bootstrap must still bind live Desktop threads.");
  assert.equal(batch[2]?.changed, true, "Batch Runtime bootstrap must still import sessions the user did not delete.");
  const afterBatch = await threads.listThreads();
  assert.equal(afterBatch.some((thread) => thread.id === doomed.id || thread.runtimeSessionId === "session-resurrect-me"), false);
  assert.equal(afterBatch.some((thread) => thread.id === liveKeep.id), true);
  assert.equal(afterBatch.some((thread) => thread.id === "session-fresh-import"), true);

  const alreadyResurrected = await threads.upsertThreadFromRuntimeCatalog({
    id: "session-already-visible",
    title: "already-visible",
    workspacePath: root,
    runtimeSessionId: "session-already-visible",
    archived: false,
    messageCount: 1,
  });
  assert.equal(alreadyResurrected.thread.id, "session-already-visible");
  assert.equal(await threads.deleteThread("session-already-visible"), true);
  assert.equal((await threads.upsertThreadFromRuntimeCatalog({
    id: "session-already-visible",
    title: "already-visible",
    workspacePath: root,
    runtimeSessionId: "session-already-visible",
    archived: false,
    messageCount: 3,
  })).changed, false);
  assert.equal(
    (await threads.listThreads()).some((thread) => thread.id === "session-already-visible"),
    false,
    "Deleting a resurrected session-* row must keep it from coming back.",
  );

  console.log("Thread lifecycle and persistence verification passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}
