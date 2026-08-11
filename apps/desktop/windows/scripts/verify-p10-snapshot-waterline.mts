import assert from "node:assert/strict";
import { assertSnapshotWaterline, canUseSnapshotCache } from "../../shared/main/threadRuntimeSubscription";
import type { DesktopThreadSnapshotEnvelope } from "../../shared/api/desktopApi";
import { ThreadSnapshotCoordinator } from "../../shared/renderer/src/threadSnapshotCoordinator";
import { ThreadSyncMetrics } from "../../shared/renderer/src/threadSyncMetrics";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const envelope = {
  version: 1, projection: "oaep/1", threadId: "thread-1", runtimeSessionId: "session-1",
  sessionSequence: 12, generation: 3,
  snapshot: { threadId: "thread-1", messages: [], updatedAt: 1, messageCount: 0 },
} satisfies DesktopThreadSnapshotEnvelope;

assert.equal(canUseSnapshotCache(envelope, false, "session-1", {}), true);
assert.equal(canUseSnapshotCache(envelope, true, "session-1", {}), false, "a patch must stale the full snapshot cache");
assert.equal(canUseSnapshotCache(envelope, false, "session-1", { forceFresh: true }), false);
assert.equal(canUseSnapshotCache(envelope, false, "session-1", { minimumSequence: 13 }), false);
assert.equal(canUseSnapshotCache(envelope, false, "session-1", { expectedGeneration: 4 }), false);
assert.equal(canUseSnapshotCache(envelope, false, "another-session", {}), false);
assert.equal(assertSnapshotWaterline(envelope, { minimumSequence: 12, expectedGeneration: 3 }), envelope);
assert.throws(() => assertSnapshotWaterline(envelope, { minimumSequence: 13 }), (error: unknown) => (error as { code?: string }).code === "snapshot_sequence_stale");
assert.throws(() => assertSnapshotWaterline(envelope, { expectedGeneration: 4 }), (error: unknown) => (error as { code?: string }).code === "snapshot_generation_stale");
const coordinator = new ThreadSnapshotCoordinator();
assert.equal(coordinator.noteResyncFailure("thread-1").actionRequired, false);
assert.equal(coordinator.noteResyncFailure("thread-1").actionRequired, false);
assert.equal(coordinator.noteResyncFailure("thread-1").actionRequired, true);
assert.equal(coordinator.canResync("thread-1"), false);
coordinator.acceptEnvelope(envelope);
assert.equal(coordinator.canResync("thread-1"), true, "a fresh authoritative envelope clears action-required state");
const app = await readFile(resolve(process.cwd(), "../shared/renderer/src/App.tsx"), "utf8");
assert.ok(app.includes("attempt < 3"), "automatic resync must have a three-attempt ceiling");
assert.ok(app.includes("cancelThreadSnapshotHydration(hydration.requestId)"), "switching tasks must cancel irrelevant hydration");
assert.ok(app.includes("forceFresh: true"), "gap recovery must bypass the snapshot cache");
assert.ok(app.includes("historyCursor: activeThreadSnapshot.history?.nextCursor"), "older history must continue from the authoritative cursor");
const chatWorkspace = await readFile(resolve(process.cwd(), "../shared/renderer/src/components/ChatWorkspace.tsx"), "utf8");
assert.ok(chatWorkspace.includes("加载更早内容") && chatWorkspace.includes("onLoadEarlierHistory"), "truncated history must expose an explicit load-earlier action");
const metrics = new ThreadSyncMetrics(true, 3);
for (const value of [1, 2, 3, 4]) metrics.observe("apply", value);
metrics.observe("transport", Number.NaN);
assert.deepEqual(metrics.snapshot().apply, { count: 3, p95Ms: 4, maximumMs: 4 });
assert.equal(metrics.snapshot().transport.count, 0);
const disabledMetrics = new ThreadSyncMetrics(false);
disabledMetrics.observe("render", 10);
assert.equal(disabledMetrics.snapshot().render.count, 0, "disabled metrics must retain no samples");
console.log("P10 snapshot freshness and waterline verification passed.");
