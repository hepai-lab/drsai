import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopThreadSnapshot } from "../api/desktopApi";

const root = await mkdtemp(join(tmpdir(), "opendrsai-snapshot-storage-"));
const previousHome = process.env.DRSAI_HOME;
process.env.DRSAI_HOME = root;
const desktop = join(root, "desktop");
const legacyPath = join(desktop, "thread-snapshots.json");
const shardPath = (id: string) => join(desktop, "thread-snapshots", `${createHash("sha256").update(id).digest("hex")}.json`);
const snapshot = (threadId: string, count = 501, updatedAt = 100): DesktopThreadSnapshot => ({
  threadId,
  title: `History ${threadId}`,
  updatedAt,
  messageCount: count,
  messages: Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 ? "assistant" : "user",
    content: `Unique preserved content ${index}: 中文 🌍`,
  })),
});
const voiceAppend = (threadId: string) => ({
  threadId,
  messages: [{ id: "duplex:voice-1", role: "assistant" as const, content: "Voice tail", revision: 1, expectedRevision: 0 }],
});
const tooLarge = (error: unknown) => (error as { code?: string })?.code === "thread_snapshot_too_large";
let checks = 0;

try {
  await mkdir(desktop, { recursive: true });
  // Simulate restart: durable tombstones already exist before the module's first
  // read. Concurrent first callers must all await that read (no boolean race).
  const deletedId = "thread-deleted-before-start";
  await writeFile(join(desktop, "deleted-threads.json"), JSON.stringify([deletedId]));
  await writeFile(legacyPath, JSON.stringify({ [deletedId]: snapshot(deletedId) }));
  const threads = await import("../main/threads.ts");
  const firstCalls = await Promise.allSettled([
    threads.getThreadSnapshot(deletedId),
    threads.updateThreadSnapshot(snapshot(deletedId)),
    threads.appendDuplexVoiceHistory(voiceAppend(deletedId)),
  ]);
  assert.deepEqual(firstCalls[0], { status: "fulfilled", value: null });
  for (const outcome of firstCalls.slice(1)) {
    assert.equal(outcome.status, "rejected");
    if (outcome.status === "rejected") assert.ok(threads.isThreadDeletedError(outcome.reason));
  }
  await assert.rejects(access(shardPath(deletedId)), /ENOENT/);
  checks++;

  // Assert every message, not only length: neither the head nor the tail may be
  // evicted, including a second disk read rather than a cached return value.
  for (const count of [501, 1201]) {
    const full = snapshot(`thread-full-${count}`, count);
    assert.deepEqual(await threads.updateThreadSnapshot(full), full);
    assert.deepEqual(JSON.parse(await readFile(shardPath(full.threadId), "utf8")), full);
    assert.deepEqual(await threads.getThreadSnapshot(full.threadId), full);
    assert.deepEqual(await threads.getThreadSnapshot(full.threadId), full);
    checks++;
  }

  const newest = snapshot("thread-ordered", 601, 900);
  await threads.updateThreadSnapshot(newest);
  const bytesBefore = await readFile(shardPath(newest.threadId), "utf8");
  threads.resetThreadSnapshotIoMetrics();
  assert.deepEqual(await threads.updateThreadSnapshot(snapshot(newest.threadId, 2, 800)), newest);
  assert.equal(await readFile(shardPath(newest.threadId), "utf8"), bytesBefore);
  assert.equal(threads.getThreadSnapshotIoMetrics().shardWrites, 0, "Stale save must not write at all.");
  // All requests enter concurrently. The comparison must be inside the queue,
  // not against a shared old snapshot read before acquiring the lock.
  const times = [1000, 2000, 1500, 3000, 2500, 500];
  await Promise.all(times.map((time) => threads.updateThreadSnapshot(snapshot(newest.threadId, 602, time))));
  assert.deepEqual(await threads.getThreadSnapshot(newest.threadId), snapshot(newest.threadId, 602, 3000));
  const equalTime = snapshot(newest.threadId, 603, 3000);
  assert.deepEqual(await threads.updateThreadSnapshot(equalTime), equalTime, "Equal wall-clock values retain last-writer semantics, not strict watermarks.");
  checks++;

  // The old catalog may contain more than 2,000 conversations. Direct lookup
  // must find the requested oldest entry, without the search/list retention cap.
  const legacy = snapshot("thread-legacy-oldest", 701, 1);
  const unrelated = Object.fromEntries(Array.from({ length: 2001 }, (_, index) => {
    const value = snapshot(`thread-legacy-${index}`, 1, index + 10);
    return [value.threadId, value];
  }));
  const catalog: Record<string, unknown> = { ...unrelated, [legacy.threadId]: legacy, malformedButUnrelated: { preserveMe: true } };
  await writeFile(legacyPath, JSON.stringify(catalog));
  assert.deepEqual(await threads.updateThreadSnapshot(snapshot(legacy.threadId, 1, 0)), legacy, "Stale write must also compare against an unmigrated legacy entry.");
  await assert.rejects(access(shardPath(legacy.threadId)), /ENOENT/);
  assert.deepEqual(await threads.getThreadSnapshot(legacy.threadId), legacy);
  assert.deepEqual(JSON.parse(await readFile(shardPath(legacy.threadId), "utf8")), legacy);
  checks++;

  for (const readFirst of [true, false]) {
    const old = snapshot(`thread-migration-race-${readFirst}`, 701, 10);
    const fresh = snapshot(old.threadId, 702, 20);
    catalog[old.threadId] = old;
    await writeFile(legacyPath, JSON.stringify(catalog));
    await Promise.all(readFirst
      ? [threads.getThreadSnapshot(old.threadId), threads.updateThreadSnapshot(fresh)]
      : [threads.updateThreadSnapshot(fresh), threads.getThreadSnapshot(old.threadId)]);
    assert.deepEqual(await threads.getThreadSnapshot(old.threadId), fresh, "Legacy migration must not overwrite a concurrent newer save.");
    checks++;
  }

  const voiceLegacy = snapshot("thread-voice-legacy", 701, Date.now() + 60_000);
  catalog[voiceLegacy.threadId] = voiceLegacy;
  await writeFile(legacyPath, JSON.stringify(catalog));
  const voiceResult = await threads.appendDuplexVoiceHistory(voiceAppend(voiceLegacy.threadId));
  assert.deepEqual(voiceResult.messages.slice(0, 701), voiceLegacy.messages);
  assert.equal(voiceResult.messages.at(-1)?.id, "duplex:voice-1");
  assert.equal(voiceResult.messages.length, 702);
  assert.ok(voiceResult.updatedAt >= voiceLegacy.updatedAt, "Voice append must not move the stored clock backwards.");
  assert.deepEqual(await threads.getThreadSnapshot(voiceLegacy.threadId), voiceResult);
  checks++;

  const retained = snapshot("thread-limit-reject", 501, 10);
  await threads.updateThreadSnapshot(retained);
  const retainedBytes = await readFile(shardPath(retained.threadId), "utf8");
  await assert.rejects(threads.updateThreadSnapshot(snapshot(retained.threadId, 100_001, 20)), tooLarge);
  // UTF-8 bytes, not JS string length. Each message is inside the existing
  // 200,000-character field cap, but the aggregate exceeds 64 MiB.
  const largeContent = "中".repeat(200_000);
  const byteOversize = { ...retained, updatedAt: 30, messages: Array.from({ length: 113 }, (_, index) => ({ id: `large-${index}`, role: "assistant", content: largeContent })) };
  await assert.rejects(threads.updateThreadSnapshot(byteOversize), tooLarge);
  assert.equal(await readFile(shardPath(retained.threadId), "utf8"), retainedBytes);
  assert.deepEqual(await threads.getThreadSnapshot(retained.threadId), retained);
  checks++;

  // New write limits must not silently hide a previously valid historical file.
  // Both direct shards and the legacy migration path bypass only the new limits.
  const historical = snapshot("thread-historical-over-limit", 100_001, 5);
  await writeFile(legacyPath, JSON.stringify({ ...catalog, [historical.threadId]: historical }));
  assert.deepEqual(await threads.getThreadSnapshot(historical.threadId), historical);
  assert.deepEqual(await threads.getThreadSnapshot(historical.threadId), historical);
  await assert.rejects(threads.appendDuplexVoiceHistory(voiceAppend(historical.threadId)), tooLarge);
  assert.deepEqual(await threads.getThreadSnapshot(historical.threadId), historical);
  checks++;

  // Unreadable existing state is not "absent"; never overwrite its only copy.
  const corruptId = "thread-corrupt";
  const corruptBytes = '{"messages": [ interrupted';
  await writeFile(shardPath(corruptId), corruptBytes);
  await assert.rejects(threads.updateThreadSnapshot(snapshot(corruptId)));
  await assert.rejects(threads.getThreadSnapshot(corruptId));
  assert.equal(await readFile(shardPath(corruptId), "utf8"), corruptBytes);
  await writeFile(legacyPath, corruptBytes);
  await assert.rejects(threads.updateThreadSnapshot(snapshot("thread-corrupt-legacy")));
  assert.equal(await readFile(legacyPath, "utf8"), corruptBytes);
  await assert.rejects(access(shardPath("thread-corrupt-legacy")), /ENOENT/);
  await writeFile(legacyPath, JSON.stringify(catalog));
  checks++;

  // Deleting one conversation must not rewrite/cap/sanitize unrelated legacy
  // data (including malformed entries that could be another thread's only copy).
  await threads.deleteThread(legacy.threadId);
  const afterDelete = JSON.parse(await readFile(legacyPath, "utf8"));
  const expectedCatalog = { ...catalog };
  delete expectedCatalog[legacy.threadId];
  assert.deepEqual(afterDelete, expectedCatalog);
  assert.equal(await threads.getThreadSnapshot(legacy.threadId), null);
  checks++;

  // Both aliases and all snapshot writers participate in tombstone protection.
  const owner = await threads.createThread({ kind: "chat", title: "Delete race", workspacePath: root });
  const alias = "session-delete-race";
  await threads.updateThread({ id: owner.id, runtimeSessionId: alias });
  await threads.updateThreadSnapshot(snapshot(owner.id, 701));
  await threads.updateThreadSnapshot(snapshot(alias, 701));
  const operations = await Promise.allSettled([
    threads.updateThreadSnapshot(snapshot(owner.id, 702, 200)),
    threads.appendDuplexVoiceHistory(voiceAppend(owner.id)),
    threads.getThreadSnapshot(owner.id),
    threads.deleteThread(alias),
    threads.updateThreadSnapshot(snapshot(owner.id, 703, 300)),
  ]);
  assert.equal(operations[3]?.status, "fulfilled");
  for (const outcome of operations) {
    if (outcome.status === "rejected") assert.ok(threads.isThreadDeletedError(outcome.reason));
  }
  for (const id of [owner.id, alias]) {
    assert.equal(await threads.getThreadSnapshot(id), null);
    await assert.rejects(access(shardPath(id)), /ENOENT/);
    await assert.rejects(threads.updateThreadSnapshot(snapshot(id)), threads.isThreadDeletedError);
    await assert.rejects(threads.appendDuplexVoiceHistory(voiceAppend(id)), threads.isThreadDeletedError);
  }
  const tombstones = JSON.parse(await readFile(join(desktop, "deleted-threads.json"), "utf8"));
  assert.ok(tombstones.includes(owner.id) && tombstones.includes(alias));
  checks++;

  // A read-triggered legacy migration racing deletion must not leave a shard.
  const migratingDelete = snapshot("thread-migration-delete", 701);
  await writeFile(legacyPath, JSON.stringify({ [migratingDelete.threadId]: migratingDelete }));
  const migrationDeleteResults = await Promise.allSettled([
    threads.getThreadSnapshot(migratingDelete.threadId),
    threads.deleteThread(migratingDelete.threadId),
  ]);
  assert.equal(migrationDeleteResults[1]?.status, "fulfilled");
  assert.equal(await threads.getThreadSnapshot(migratingDelete.threadId), null);
  await assert.rejects(access(shardPath(migratingDelete.threadId)), /ENOENT/);
  checks++;

  console.log(`Thread snapshot disk storage verification passed (${checks} checks).`);
} finally {
  if (previousHome === undefined) delete process.env.DRSAI_HOME;
  else process.env.DRSAI_HOME = previousHome;
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
