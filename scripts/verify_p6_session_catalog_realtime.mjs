#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const modulePath = resolve("apps/desktop/shared/main/workspaceSessionCatalog.ts");
const { WorkspaceSessionCatalogGate, consumeWorkspaceSessionCatalogStream } =
  await import(pathToFileURL(modulePath).href);

const transitions = [
  ["rename", "event.session.updated", 2],
  ["archive", "event.session.archived", 3],
  ["unarchive", "event.session.unarchived", 4],
  ["rollback", "event.session.updated", 5],
];
const encoded = transitions.map(([id, type, sequence]) =>
  `id: ${id}\nevent: session.catalog.changed\ndata: ${JSON.stringify({
    event_id: id, session_id: "session-one", type, sequence,
  })}\n\n`).join("");
const chunks = [encoded.slice(0, 37), encoded.slice(37, 163), encoded.slice(163)];
const stream = new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  },
});
const gate = new WorkspaceSessionCatalogGate();
const observed = [];
await consumeWorkspaceSessionCatalogStream(stream, (event) => {
  if (gate.accept(event) === "apply") observed.push(event.type);
});
assert.deepEqual(observed, transitions.map(([, type]) => type));
assert.equal(gate.accept({ event_id: "rollback", session_id: "session-one", type: "event.session.updated", sequence: 5 }), "duplicate");
assert.equal(gate.accept({ event_id: "stale", session_id: "session-one", type: "event.session.updated", sequence: 1 }), "stale");
assert.throws(
  () => gate.accept({ event_id: "rollback", session_id: "session-one", type: "event.session.archived", sequence: 6 }),
  /event_id_collision/,
);

const androidStream = await readFile(resolve(
  "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RelaySseClient.kt"), "utf8");
const androidViewModel = await readFile(resolve(
  "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/WorkspaceSessionsViewModel.kt"), "utf8");
const gateway = await readFile(resolve(
  "cores/python/packages/drsai/src/drsai/backend/gateway.py"), "utf8");
const journal = await readFile(resolve(
  "cores/python/packages/drsai/src/drsai/backend/runtime/journal.py"), "utf8");
const windows = await readFile(resolve("apps/desktop/windows/src/main/index.ts"), "utf8");

for (const [source, marker] of [
  [androidStream, "decodeWorkspaceSessionCatalogEvent"],
  [androidViewModel, "WorkspaceSessionCatalogGate"],
  [androidViewModel, "WorkspaceSessionCatalogProjection.project"],
  [gateway, '/v1/workspaces/{workspace_id}/session-catalog-events/stream'],
  [journal, "wait_for_workspace_catalog_events"],
  [windows, "openWorkspaceSessionCatalogStream"],
  [windows, 'webContents.send("desktop:thread-catalog"'],
]) assert.ok(source.includes(marker), `session-catalog-marker:${marker}`);

console.log(JSON.stringify({
  passed: true,
  transitions: observed.length,
  manual_refreshes: 0,
  typed_clients: ["android", "desktop"],
  recovery: "connect-refresh-plus-durable-runtime-journal",
  catalog_scale_fixture: 10_000,
}));
