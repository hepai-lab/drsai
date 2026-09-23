import assert from "node:assert/strict";
import { earlierHistoryRequest } from "../renderer/src/threadHistoryRequest";
import { threadSnapshotHydrationConsultsRuntime } from "../api/threadSnapshotHydration";
import type { DesktopThreadHistoryState } from "../api/desktopApi";

const history = { nextCursor: "backend", oaepNextCursor: "opaque-oaep" } as DesktopThreadHistoryState;
assert.deepEqual(earlierHistoryRequest(history), { forceFresh: true, oaepHistoryCursor: "opaque-oaep" });
assert.deepEqual(earlierHistoryRequest({ ...history, oaepNextCursor: null }), { forceFresh: true, historyCursor: "backend" });
assert.equal(earlierHistoryRequest({ ...history, nextCursor: null, oaepNextCursor: null }), undefined);
assert.equal(earlierHistoryRequest(undefined), undefined);
assert.equal(threadSnapshotHydrationConsultsRuntime({ hasRuntimeBinding: true, request: { oaepHistoryCursor: "opaque-oaep" } }), true);
console.log("THREAD_HISTORY_REQUEST_OK");
