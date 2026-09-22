import assert from "node:assert/strict";
import type { DesktopThreadSnapshot, DesktopThreadSnapshotEnvelope } from "../api/desktopApi";
import { ThreadSnapshotEnvelopeCache } from "../main/threadSnapshotEnvelopeCache";
import { ThreadSnapshotStore } from "../renderer/src/threadSnapshotStore";

const snapshot = (threadId: string, content = "body"): DesktopThreadSnapshot => ({
  threadId, title: threadId, updatedAt: 1, messageCount: 1, messages: [{ id: threadId, role: "assistant", content }],
});
const envelope = (value: DesktopThreadSnapshot): DesktopThreadSnapshotEnvelope => ({
  version: 1, projection: "oaep/1", threadId: value.threadId, runtimeSessionId: value.threadId,
  sessionSequence: 1, generation: 1, source: "runtime", snapshot: value,
});

const factories = {
  main(maximumEntries = 10, maximumBytes = 1_000_000, ttlMs = 100) {
    const cache = new ThreadSnapshotEnvelopeCache(maximumEntries, maximumBytes, ttlMs);
    return {
      set: (id: string, body?: string) => cache.set(id, envelope(snapshot(id, body))),
      get: (id: string) => cache.get(id)?.snapshot,
      pin: (id: string) => { cache.pin(id); return () => cache.unpin(id); },
      count: () => cache.diagnostics().entries,
      bytes: () => cache.diagnostics().bytes,
    };
  },
  renderer(maximumEntries = 10, maximumBytes = 1_000_000, ttlMs = 100) {
    const cache = new ThreadSnapshotStore({}, maximumEntries, maximumBytes, ttlMs);
    return {
      set: (id: string, body?: string) => cache.set(id, snapshot(id, body)),
      get: (id: string) => cache.get(id),
      pin: (id: string) => cache.subscribe(id, () => undefined),
      count: () => cache.diagnostics().sessions,
      bytes: () => cache.diagnostics().bytes,
    };
  },
};

const failures: string[] = [];
const realNow = Date.now;
let now = 0;
Date.now = () => now;
try {
  for (const [name, create] of Object.entries(factories)) {
    const check = (label: string, test: () => void) => {
      now = 0;
      try { test(); } catch (error) { failures.push(`${name}: ${label}: ${error}`); }
    };
    check("writes refresh LRU order", () => {
      const cache = create(2);
      cache.set("a"); now = 1; cache.set("b"); now = 2;
      cache.set("a", "updated"); now = 3; cache.set("c");
      assert.equal(cache.get("a")?.messages[0]?.content, "updated");
      assert.ok(!cache.get("b")); assert.ok(cache.get("c"));
      assert.equal(cache.count(), 2);
    });
    check("pinned head cannot hide expired entries", () => {
      const cache = create();
      const release = cache.pin("active");
      cache.set("active"); cache.set("expired");
      now = 101; cache.set("fresh");
      // Inspect count before get(): reading expired itself would mask a failed sweep.
      assert.equal(cache.count(), 2);
      assert.ok(cache.get("active")); assert.ok(cache.get("fresh"));
      release();
    });
    check("repeated writes cannot hide expired entries", () => {
      const cache = create();
      cache.set("a"); cache.set("b"); now = 90; cache.set("a");
      now = 101; cache.set("c");
      assert.equal(cache.count(), 2);
      assert.ok(cache.get("a")); assert.ok(cache.get("c"));
    });
    check("read recency and byte accounting", () => {
      const cache = create(2);
      cache.set("a"); const initialBytes = cache.bytes();
      cache.set("a", "bodybody"); assert.equal(cache.bytes(), initialBytes + 4);
      cache.set("a"); assert.equal(cache.bytes(), initialBytes);
      cache.set("b"); cache.get("a"); cache.set("c");
      assert.ok(cache.get("a")); assert.ok(!cache.get("b"));
    });
    check("active oversized body is intact, release enforces budget", () => {
      const cache = create(2, 1_000);
      const release = cache.pin("active");
      const body = "完整正文".repeat(2_000);
      cache.set("active", body); cache.set("inactive");
      assert.equal(cache.get("active")?.messages[0]?.content, body);
      assert.equal(cache.count(), 1); assert.ok(cache.bytes() > 1_000);
      release(); assert.equal(cache.count(), 0); assert.equal(cache.bytes(), 0);
    });
  }
} finally { Date.now = realNow; }
assert.deepEqual(failures, []);
console.log("SNAPSHOT_CACHE_EVICTION_OK (main/renderer LRU, TTL past pins, byte accounting, intact active bodies)");
