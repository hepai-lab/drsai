#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertOaepEventIntegrity,
  oaepProjectionDigest,
} from "../apps/desktop/shared/main/oaepIntegrity.ts";
import { reduceOaepEvent } from "../apps/desktop/shared/main/oaepSessionStream.ts";

const fixture = JSON.parse(await readFile(resolve(
  "cores/protocol/oaep/snapshot-window.examples.json"), "utf8"));
const fixtureItems = fixture.pages.flatMap((page) => page.items);
assert.equal(oaepProjectionDigest(fixtureItems), fixture.expected_snapshot_hash);

const sessionId = "p6-session";
const runId = "p6-run";
const source = { backend: "runtime", runtime_id: "runtime-one" };
const items = new Map();
const runs = new Map();
const shadows = new Map();
const event = (sequence, itemId, kind, text, extra = {}) => ({
  version: "1.0", event_id: `event-${sequence}`, session_id: sessionId, run_id: runId,
  item_id: itemId, sequence, type: "event.item.delta", timestamp: `2026-08-12T00:00:${String(sequence).padStart(2, "0")}Z`,
  dedupe_key: `event-${sequence}`, source, data: { delta: { kind, text, ...extra } },
});
[
  event(1, "model", "message.text.append", "model"),
  event(2, "reasoning", "reasoning.segment.added", "reasoning", { segment_id: "summary", visibility: "user" }),
  event(3, "tool", "tool.output.append", "tool"),
  event(4, "command", "command.output.append", "command"),
  event(5, "subtask", "subtask.summary.append", "subtask"),
].forEach((value) => reduceOaepEvent(items, runs, value, shadows));
assert.deepEqual([...shadows.keys()].sort(), ["command", "model", "reasoning", "subtask", "tool"]);
assert.equal(shadows.get("tool").content.result, "tool");
assert.equal(shadows.get("command").content.output, "command");

assert.throws(() => assertOaepEventIntegrity({
  version: "1.0", event_id: "bad", session_id: sessionId, run_id: runId, item_id: "outer",
  sequence: 6, type: "event.item.completed", timestamp: "2026-08-12T00:00:06Z", dedupe_key: "bad", source,
  data: { item: { ...fixtureItems[0], id: "inner", session_id: sessionId, run_id: runId } },
}, sessionId), /oaep_event_item_scope_invalid/);

const sources = {
  androidCodec: await readFile(resolve("apps/android/app/src/main/java/ai/drsai/remote/remote/data/OaepJsonCodec.kt"), "utf8"),
  androidStore: await readFile(resolve("apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteStore.kt"), "utf8"),
  androidView: await readFile(resolve("apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionViewModel.kt"), "utf8"),
  desktopStream: await readFile(resolve("apps/desktop/shared/main/oaepSessionStream.ts"), "utf8"),
  runtimeJournal: await readFile(resolve("cores/python/packages/drsai/src/drsai/backend/runtime/journal.py"), "utf8"),
};
for (const [sourceName, marker] of [
  ["androidCodec", "verifyCompleteSnapshot"],
  ["androidCodec", "reasoningKind ="],
  ["androidStore", "verifyOaepProjectionCheckpoint"],
  ["androidStore", "toDeltaItemEntity"],
  ["androidStore", "sourceJson"],
  ["androidView", 'optString("visibility", "user") == "user"'],
  ["desktopStream", "assertOaepEventIntegrity"],
  ["runtimeJournal", "def oaep_checkpoint"],
]) assert.ok(sources[sourceName].includes(marker), `conversation-marker:${sourceName}:${marker}`);

console.log(JSON.stringify({
  passed: true,
  canonical_hash: fixture.expected_snapshot_hash,
  realtime_item_kinds: shadows.size,
  checkpoint_clients: ["runtime", "desktop", "android"],
  cursor_policy: "snapshot-replay-sse-contiguous",
}));
