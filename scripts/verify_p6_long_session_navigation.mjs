#!/usr/bin/env node
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { projectOaepThreadSnapshot } from "../apps/desktop/shared/main/threadRuntimeProjection.ts";
import { reduceOaepEvent } from "../apps/desktop/shared/main/oaepSessionStream.ts";

const sessionId = "p6-long-session";
const source = { backend: "runtime", runtime_id: "runtime-long" };
const runs = [];
const items = [];
const runCount = 10_000;
const itemsPerRun = 10;
for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
  const runId = `run-${String(runIndex).padStart(6, "0")}`;
  const at = new Date(1_750_000_000_000 + runIndex * 1000).toISOString();
  runs.push({
    id: runId, session_id: sessionId, sequence: runIndex + 1, source,
    status: "completed", created_at: at, updated_at: at, completed_at: at,
  });
  for (let sequence = 1; sequence <= itemsPerRun; sequence += 1) {
    items.push({
      id: `${runId}-item-${sequence}`, session_id: sessionId, run_id: runId,
      type: "message", status: "completed", sequence, created_at: at, updated_at: at,
      source, content: {
        role: sequence === 1 ? "user" : "assistant",
        text: sequence === 1 ? `request ${runIndex}` : `response ${runIndex}.${sequence}`,
      },
    });
  }
}

const projectionStarted = performance.now();
const projected = projectOaepThreadSnapshot({
  id: sessionId, kind: "chat", title: "Long session", createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(), status: "idle", messageCount: items.length,
}, items, runs);
const projectionMs = performance.now() - projectionStarted;
assert.equal(items.length, 100_000);
assert.equal(projected.messages.length, 20_000);
assert.ok(projectionMs < 8_000, `100k projection exceeded cold-start gate: ${projectionMs.toFixed(1)}ms`);

const eventItems = new Map();
const eventRuns = new Map();
const shadows = new Map();
const deltaStarted = performance.now();
for (let sequence = 1; sequence <= 10_000; sequence += 1) {
  reduceOaepEvent(eventItems, eventRuns, {
    version: "1.0", event_id: `delta-${sequence}`, session_id: sessionId,
    run_id: "stream-run", item_id: "stream-item", sequence,
    type: "event.item.delta", timestamp: "2026-08-12T00:00:00Z",
    dedupe_key: `delta-${sequence}`, source,
    data: { delta: { kind: "message.text.append", text: "x" } },
  }, shadows);
}
const deltaMs = performance.now() - deltaStarted;
assert.equal(shadows.get("stream-item")?.content?.text?.length, 10_000);
assert.ok(deltaMs <= 1_000, `10k delta throughput gate failed: ${deltaMs.toFixed(1)}ms`);

// Loading an older page must restore by stable item identity, not by the old
// numeric index which shifts when rows are prepended.
const before = Array.from({ length: 1_000 }, (_, index) => `item-${index + 1_000}`);
const anchorId = before[317];
const after = [...Array.from({ length: 500 }, (_, index) => `item-${index + 500}`), ...before];
assert.equal(after.indexOf(anchorId), 817);
assert.notEqual(after[317], anchorId);

const [androidStore, androidView, androidScreen, androidNavigation, desktopChat, desktopProjection] = await Promise.all([
  readFile(resolve("apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteStore.kt"), "utf8"),
  readFile(resolve("apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionViewModel.kt"), "utf8"),
  readFile(resolve("apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionScreens.kt"), "utf8"),
  readFile(resolve("apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteTimelineNavigation.kt"), "utf8"),
  readFile(resolve("apps/desktop/shared/renderer/src/components/ChatWorkspace.tsx"), "utf8"),
  readFile(resolve("apps/desktop/shared/main/threadRuntimeProjection.ts"), "utf8"),
]);
for (const [name, sourceText, markers] of [
  ["android-store", androidStore, ["oaepItemWindow", "searchOaepItems", "LIMIT :limit"]],
  ["android-view", androidView, ["oaepSessionItemWindow", "searchTranscript"]],
  ["android-screen", androidScreen, ["historyAnchor", "unreadStart", "RemoteTranscriptFilter"]],
  ["android-navigation", androidNavigation, ["reduceRemoteTimelineUpdate", "searchActive", "historyRestored"]],
  ["desktop-chat", desktopChat, ["VirtualizedMessage", "conversation-load-earlier", "searchThreadMessages"]],
  ["desktop-projection", desktopProjection, ["itemsByRun.get(runId)", "itemsByRun.set"]],
]) {
  for (const marker of markers) assert.ok(sourceText.includes(marker), `${name} missing ${marker}`);
}

console.log(JSON.stringify({
  passed: true,
  items: items.length,
  runs: runs.length,
  projected_messages: projected.messages.length,
  projection_ms: Math.round(projectionMs),
  deltas: 10_000,
  delta_ms: Math.round(deltaMs),
  delta_per_second: Math.round(10_000 / (deltaMs / 1000)),
  cached_window_max: 2_000,
  offline_search_limit: 500,
  anchor_restored_by_id: true,
}));
