import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { subscribeSessionConversation } from "../../shared/main/sessionConversationSubscription.ts";
import { selectRuntimeConversationProtocol, selectRuntimeConversationProtocolResult } from "../../shared/main/runtimeProtocolSelection.ts";
import { OAEP_SCHEMA_SHA256 } from "../../shared/api/oaep.generated.ts";
import { oaepArtifactMetadataRequest } from "../../shared/main/oaepOwopResources.ts";
import {
  projectOaepThreadSnapshot,
  projectRuntimeThreadSnapshot,
  runtimeConversationDigest,
} from "../../shared/main/threadRuntimeProjection.ts";
import type {
  OaepItem,
  OaepRun,
  RuntimeConversationSnapshot,
  RuntimeSessionEvent,
  RuntimeSessionEventStream,
} from "../../shared/main/runtimeClient.ts";

const subscriptionSource = readFileSync(
  new URL("../../shared/main/threadRuntimeSubscription.ts", import.meta.url),
  "utf8",
);
const windowsMainSource = readFileSync(
  new URL("../src/main/index.ts", import.meta.url),
  "utf8",
);
assert.match(subscriptionSource, /isDestroyed\?\.\(\)/);
assert.equal(subscriptionSource.includes("/destroyed/i"), true);
assert.match(windowsMainSource, /subscription\.stop\(\)/);
assert.match(windowsMainSource, /catch\s*\{/);
assert.match(windowsMainSource, /function ensureRuntimeThreadCleanup\(/);
const snapshotSubscriptionHandler = windowsMainSource.slice(
  windowsMainSource.indexOf('secureHandle("desktop:subscribe-thread-snapshot"'),
  windowsMainSource.indexOf('secureHandle("desktop:unsubscribe-thread-snapshot"'),
);
assert.match(snapshotSubscriptionHandler, /ensureRuntimeThreadCleanup\(event\.sender\)/);
assert.equal(snapshotSubscriptionHandler.includes('event.sender.once("destroyed"'), false,
  "Thread re-subscription must not add another WebContents destroyed listener");

const encoder = new TextEncoder();
const sessionId = "session-subscription-one";
const item = {
  item_id: "item-1", session_id: sessionId, run_id: null, kind: "message" as const,
  role: "user" as const, revision: 1, session_sequence: 2,
  source_client: "windows" as const, source_message_id: "windows-1",
  created_at: "2026-07-27T00:00:00Z", updated_at: "2026-07-27T00:00:00Z",
  payload: { content: "hello" },
};
const snapshots: RuntimeConversationSnapshot[] = [
  { session_id: sessionId, snapshot_sequence: 1, items: [], next_cursor: null },
  { session_id: sessionId, snapshot_sequence: 3, items: [item], next_cursor: null },
];
const event = (sequence: number): RuntimeSessionEvent => ({
  event_id: `event-${sequence}`, runtime_id: "runtime-1", workspace_id: "workspace-1",
  session_id: sessionId, run_id: null, session_sequence: sequence,
  kind: "conversation.item.upsert", timestamp: "2026-07-27T00:00:00Z",
  payload: { item_id: `item-${sequence}` },
});
const streams = [
  [event(2), event(2), event(4)], // duplicate is ignored; gap forces snapshot.
  [event(4)],
];
let snapshotCalls = 0;
const transport = {
  async getConversationSnapshot() {
    return snapshots[Math.min(snapshotCalls++, snapshots.length - 1)];
  },
  async openSessionEventStream(_id: string, _cursor: number, signal: AbortSignal): Promise<RuntimeSessionEventStream> {
    const events = streams.shift() ?? [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const value of events) {
          controller.enqueue(encoder.encode(`id: ${value.session_sequence}\nevent: session.event\ndata: ${JSON.stringify(value)}\n\n`));
        }
        controller.close();
      },
      cancel() { signal.throwIfAborted(); },
    });
    return { response: new Response(body), events: body };
  },
};
const applied: number[] = [];
const subscription = subscribeSessionConversation(transport, sessionId, {
  onSnapshot(snapshot) {
    if (snapshot.snapshot_sequence === 3) applied.push(3);
  },
  onEvent(value) {
    applied.push(value.session_sequence);
    if (value.session_sequence === 4) subscription.stop();
  },
}, { retryDelayMs: 10 });
await subscription.done;
assert.equal(snapshotCalls, 2);
assert.deepEqual(applied, [2, 3, 4]);
assert.equal(subscription.cursor, 4);
const projected = projectRuntimeThreadSnapshot({
  id: "desktop-thread-one", kind: "chat", title: "Shared conversation",
  createdAt: "2026-07-27T00:00:00Z", updatedAt: "2026-07-27T00:00:00Z",
}, [
  item,
  {
    ...item, item_id: "android-message-1", session_sequence: 3,
    source_client: "android", source_message_id: "android-1",
    payload: { content: "hello from Android" },
  },
  {
    ...item, item_id: "reasoning-1", kind: "reasoning", role: null,
    session_sequence: 4, source_client: "runtime", source_message_id: null,
    payload: { text: "thinking" },
  },
  {
    ...item, item_id: "tool-1", kind: "tool", role: "tool",
    session_sequence: 5, source_client: "runtime", source_message_id: null,
    payload: { name: "shell", status: "completed" },
  },
]);
assert.equal(projected.messages[0].content, "hello");
assert.equal(projected.messages[1].content, "hello from Android");
assert.equal(projected.messages[2].reasoningContent, "thinking");
assert.equal(projected.messages[3].statusContent, "Tool: shell · completed");
const oaepProjected = projectOaepThreadSnapshot({
  id: "desktop-thread-oaep", kind: "chat", title: "OAEP conversation",
  createdAt: "2026-07-27T00:00:00Z", updatedAt: "2026-07-27T00:00:00Z",
}, [
  {
    id: "oaep-user-1", session_id: sessionId, run_id: "run-1", type: "message",
    status: "completed", sequence: 1, created_at: "2026-07-27T00:00:00Z",
    updated_at: "2026-07-27T00:00:00Z", source: { backend: "runtime" },
    content: { role: "user", phase: "final", text: "[{'text':'hello oaep'}]", citations: [],
      parts: [{ type: "text", text: "hello oaep" }, { type: "image", name: "proof.png" }] },
  },
  {
    id: "oaep-assistant-1", session_id: sessionId, run_id: "run-1", type: "message",
    status: "running", sequence: 2, created_at: "2026-07-27T00:00:01Z",
    updated_at: "2026-07-27T00:00:02Z", source: { backend: "opendrsai" },
    content: { role: "assistant", phase: "final", text: "streaming", citations: [] },
  },
  {
    id: "oaep-command-1", session_id: sessionId, run_id: "run-1", type: "command_execution",
    status: "completed", sequence: 3, created_at: "2026-07-27T00:00:03Z",
    updated_at: "2026-07-27T00:00:04Z", source: { backend: "codex" },
    content: { display_command: "npm test", output: "passed", command: ["npm", "test"], cwd: "." },
  },
], [], {
  state: "ready", source: "codex", syncedAt: "2026-07-27T00:00:05Z",
  loadedRuns: 1, totalRuns: 1, loadedItems: 3, totalItems: 3, correctedItems: 1,
});
assert.equal(oaepProjected.messages[0].content, "hello oaep");
assert.equal(oaepProjected.history?.source, "codex");
assert.equal(oaepProjected.history?.correctedItems, 1);
assert.equal(oaepProjected.messages[0].attachments?.[0]?.name, "proof.png");
assert.equal(oaepProjected.messages[0].attachments?.[0]?.blockedReason,
  "Media content is available only from its source Codex runtime.");
assert.equal(oaepProjected.messages.length, 2);
assert.equal(oaepProjected.messages[1].content, "streaming");
assert.equal(oaepProjected.messages[1].streaming, true);
assert.equal(oaepProjected.messages[1].structuredTurn?.turnId, "run-1");
assert.equal(oaepProjected.messages[1].structuredTurn?.activities[0]?.kind, "tool");
assert.equal(oaepProjected.messages[1].structuredTurn?.activities[0]?.title, "npm test");
assert.equal(oaepProjected.messages[1].structuredTurn?.meta?.backend, "opendrsai");
assert.equal(oaepProjected.messages[1].structuredTurn?.meta?.durationMs, 3000);
const oaepFixture = JSON.parse(readFileSync("../../../cores/protocol/oaep/examples.json", "utf-8")) as { items: OaepItem[] };
const fixtureProjection = projectOaepThreadSnapshot({
  id: "desktop-thread-oaep-fixture", kind: "chat", title: "OAEP fixture conversation",
  createdAt: "2026-08-02T10:00:00Z", updatedAt: "2026-08-02T10:00:12Z",
}, oaepFixture.items);
assert.equal(fixtureProjection.messages.length, 2);
const fixtureTurn = fixtureProjection.messages[1].structuredTurn!;
assert.equal(fixtureTurn.turnId, "run-1");
assert.ok(fixtureTurn.parts.some((part) => part.kind === "reasoning"));
assert.ok(fixtureTurn.parts.some((part) => part.kind === "interaction"));
assert.ok(fixtureTurn.parts.some((part) => part.kind === "artifact"));
assert.ok(fixtureTurn.parts.some((part) => part.kind === "subtask"));
assert.ok(fixtureTurn.activities.some((activity) => activity.kind === "tool"));
assert.ok(fixtureTurn.activities.some((activity) => activity.kind === "file_change"));

// Item sequences are scoped to a run. A global item sort would group all user
// messages first, which is the historical-order regression this fixture guards.
const orderedRuns: OaepRun[] = [
  { id: "run-2", session_id: sessionId, parent_run_id: null, status: "completed", sequence: 2,
    created_at: "2026-07-27T00:01:00Z", updated_at: "2026-07-27T00:01:02Z", completed_at: "2026-07-27T00:01:02Z" },
  { id: "run-1", session_id: sessionId, parent_run_id: null, status: "completed", sequence: 1,
    created_at: "2026-07-27T00:00:00Z", updated_at: "2026-07-27T00:00:02Z", completed_at: "2026-07-27T00:00:02Z" },
];
const orderedItems: OaepItem[] = [
  { id: "u2", session_id: sessionId, run_id: "run-2", type: "message", status: "completed", sequence: 1,
    created_at: "2026-07-27T00:01:00Z", updated_at: "2026-07-27T00:01:00Z", source: { backend: "codex" },
    content: { role: "user", phase: "final", text: "user two", citations: [] } },
  { id: "u1", session_id: sessionId, run_id: "run-1", type: "message", status: "completed", sequence: 1,
    created_at: "2026-07-27T00:00:00Z", updated_at: "2026-07-27T00:00:00Z", source: { backend: "codex" },
    content: { role: "user", phase: "final", text: "user one", citations: [] } },
  { id: "a2", session_id: sessionId, run_id: "run-2", type: "message", status: "completed", sequence: 2,
    created_at: "2026-07-27T00:01:01Z", updated_at: "2026-07-27T00:01:02Z", source: { backend: "codex" },
    content: { role: "assistant", phase: "final", text: "answer two", citations: [] } },
  { id: "a1", session_id: sessionId, run_id: "run-1", type: "message", status: "completed", sequence: 2,
    created_at: "2026-07-27T00:00:01Z", updated_at: "2026-07-27T00:00:02Z", source: { backend: "codex" },
    content: { role: "assistant", phase: "final", text: "answer one", citations: [] } },
];
const orderedProjection = projectOaepThreadSnapshot({
  id: "ordered-thread", kind: "chat", title: "Ordered", createdAt: orderedRuns[1].created_at,
  updatedAt: orderedRuns[0].updated_at,
}, orderedItems, orderedRuns);
assert.deepEqual(orderedProjection.messages.map((message) => message.content),
  ["user one", "answer one", "user two", "answer two"]);
assert.equal(orderedProjection.messages[1].structuredTurn?.meta?.durationMs, 2000,
  "Historical duration must use the OAEP Run lifecycle, not a single final message timestamp.");
const fallbackOrderedProjection = projectOaepThreadSnapshot({
  id: "fallback-order-thread", kind: "chat", title: "Fallback order",
  createdAt: orderedRuns[1].created_at, updatedAt: orderedRuns[1].updated_at,
}, [
  orderedItems[1],
  { ...orderedItems[3], sequence: 1 },
], [orderedRuns[1]], {
  state: "ready", source: "codex", loadedRuns: 1, totalRuns: 1, loadedItems: 2, totalItems: 2,
});
assert.equal(fallbackOrderedProjection.history?.state, "partial");
assert.equal(fallbackOrderedProjection.history?.warningCount, 1);
const steeredProjection = projectOaepThreadSnapshot({
  id: "steered-thread", kind: "chat", title: "Steered", createdAt: orderedRuns[1].created_at,
  updatedAt: orderedRuns[1].updated_at,
}, [
  orderedItems[1], orderedItems[3],
  { ...orderedItems[1], id: "u1-steer", sequence: 3, content: { ...orderedItems[1].content, text: "steer" } },
  { ...orderedItems[3], id: "a1-after-steer", sequence: 4, content: { ...orderedItems[3].content, text: "after steer" } },
], [orderedRuns[1]]);
assert.deepEqual(steeredProjection.messages.map((message) => message.content),
  ["user one", "answer one", "steer", "after steer"]);
assert.equal(steeredProjection.messages[3].structuredTurn?.turnId, "run-1:segment:2");
const duplicateBackendProjection = projectOaepThreadSnapshot({
  id: "migration-thread", kind: "chat", title: "Migration", createdAt: orderedRuns[1].created_at,
  updatedAt: orderedRuns[1].updated_at,
}, [
  { ...orderedItems[1], id: "legacy-user", run_id: "legacy-run", content: { ...orderedItems[1].content, text: "[{'text':'user one'}]" } },
  { ...orderedItems[3], id: "legacy-answer", run_id: "legacy-run" },
  { ...orderedItems[1], id: "mapped-user", run_id: "mapped-run", source: { backend: "codex", mapping_version: "oaep-codex/1.4" } },
  { ...orderedItems[3], id: "mapped-answer", run_id: "mapped-run", source: { backend: "codex", mapping_version: "oaep-codex/1.4" } },
], [
  { ...orderedRuns[1], id: "legacy-run", source: { backend: "codex", backend_run_id: "backend-turn-1" } },
  { ...orderedRuns[1], id: "mapped-run", source: { backend: "codex", backend_run_id: "backend-turn-1", backend_run_index: 0 } },
]);
assert.deepEqual(duplicateBackendProjection.messages.map((message) => message.content), ["user one", "answer one"]);
const artifactRequest = oaepArtifactMetadataRequest(oaepFixture.items.find((item) => item.type === "artifact")!);
assert.deepEqual(artifactRequest, {
  workspaceId: "workspace-1",
  operation: "artifact.metadata",
  params: { artifact_id: "artifact-1" },
});
assert.equal("path" in artifactRequest.params, false);
const digestFixture = [
  {
    ...item,
    item_id: "one",
    session_id: "session-one",
    run_id: "run-one",
    source_message_id: "source-one",
    session_sequence: 1,
    payload: { z: 2, a: [true, "值"] },
  },
  {
    ...item,
    item_id: "two",
    session_id: "session-one",
    run_id: "run-one",
    source_message_id: "source-two",
    session_sequence: 2,
    payload: { content: "hello" },
  },
];
assert.equal(
  runtimeConversationDigest(digestFixture),
  "ea44f0e94828575e7dffdd66a0c1512580bf338c0549d2b7b04686078feaf3c9",
);
const oaepCapabilities = [
  "oaep.v1", "oaep.session.snapshot", "oaep.session.events",
  "oaep.session.events.stream", "event.cursor_expired",
];
assert.equal(selectRuntimeConversationProtocol({
  protocol_version: 1,
  capabilities: oaepCapabilities,
  capability_versions: Object.fromEntries(oaepCapabilities.map((name) => [name, 1])),
  protocols: { oaep: { version: "1.0", profiles: ["oaep.session-stream/1"], schema_sha256: OAEP_SCHEMA_SHA256 } },
}), "oaep");
assert.deepEqual(selectRuntimeConversationProtocolResult({
  protocol_version: 1,
  capabilities: oaepCapabilities,
  capability_versions: Object.fromEntries(oaepCapabilities.map((name) => [name, 1])),
  protocols: { oaep: { version: "1.0", profiles: ["oaep.session-stream/1"], schema_sha256: OAEP_SCHEMA_SHA256 } },
}), {
  selected: "oaep", version: "1.0", schemaHash: OAEP_SCHEMA_SHA256,
  fallbackReason: null, upgradeAction: null,
});
assert.throws(() => selectRuntimeConversationProtocol({
  protocol_version: 1,
  capabilities: ["oaep.v1"],
  capability_versions: { "oaep.v1": 1 },
  protocols: { oaep: { version: "1.0", profiles: [] } },
}), /oaep_capability_partial/);
const legacyCapabilities = [
  "conversation.snapshot", "session.event.resume", "session.event.stream",
  "session.event.cursor_expired",
];
assert.equal(selectRuntimeConversationProtocol({
  protocol_version: 1,
  capabilities: legacyCapabilities,
  capability_versions: Object.fromEntries(legacyCapabilities.map((name) => [name, 1])),
}), "legacy");
assert.deepEqual(selectRuntimeConversationProtocolResult({
  protocol_version: 1,
  capabilities: legacyCapabilities,
  capability_versions: Object.fromEntries(legacyCapabilities.map((name) => [name, 1])),
}), {
  selected: "legacy", version: "1", schemaHash: null,
  fallbackReason: "oaep_unavailable", upgradeAction: "upgrade_runtime",
});
const versionMatrix = JSON.parse(readFileSync(
  "../../../cores/protocol/relay/oaep-version-matrix.json", "utf-8",
)) as { cases: Array<{ name: string; capabilities: string[]; protocols: Record<string, unknown>; expected: string }> };
for (const testCase of versionMatrix.cases) {
  const input = {
    protocol_version: 1,
    capabilities: testCase.capabilities,
    capability_versions: Object.fromEntries(testCase.capabilities.map((name) => [name, 1])),
    protocols: testCase.protocols,
  } as Parameters<typeof selectRuntimeConversationProtocol>[0];
  if (testCase.expected === "reject") {
    assert.throws(() => selectRuntimeConversationProtocol(input), /oaep_capability_partial/, testCase.name);
  } else {
    assert.equal(selectRuntimeConversationProtocol(input), testCase.expected, testCase.name);
  }
}
console.log("Session Conversation subscription verification passed.");
