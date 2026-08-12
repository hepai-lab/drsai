import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  applyStructuredConversationEvent,
  createStructuredTurnState,
} from "../../shared/api/structuredConversation";
import {
  createOaepPresentationProjection,
  projectOaepEventForPresentation,
} from "../../shared/main/oaepPresentationProjector";
import type { OaepEvent } from "../../shared/main/runtimeClient";

const sessionId = "session-queue";
const runId = "run-queue";
const projection = createOaepPresentationProjection(runId, "workspace");
const event = (sequence: number, type: OaepEvent["type"], data: OaepEvent["data"]): OaepEvent => ({
  version: "1.0",
  event_id: `queue-${sequence}`,
  session_id: sessionId,
  run_id: runId,
  sequence,
  type,
  timestamp: `2026-08-12T00:00:0${sequence}Z`,
  dedupe_key: `queue-${sequence}`,
  source: { backend: "codex" },
  data,
});

let state = createStructuredTurnState(runId);
for (const projected of projectOaepEventForPresentation(
  event(1, "event.run.waiting", { reason: "turn_queue", queue_position: 2 }), projection,
)) state = applyStructuredConversationEvent(state, projected);
assert.equal(state.status, "pending");
assert.equal(state.meta?.queuePosition, 2);
assert.equal(state.meta?.waitingReason, "turn_queue");

for (const projected of projectOaepEventForPresentation(
  event(2, "event.run.resumed", { reason: "turn_queue_ready" }), projection,
)) state = applyStructuredConversationEvent(state, projected);
assert.equal(state.status, "running");
assert.equal(state.meta?.queuePosition, undefined);
assert.equal(state.meta?.waitingReason, undefined);

const renderer = await readFile(
  resolve(process.cwd(), "../shared/renderer/src/components/StructuredMessageParts.tsx"),
  "utf8",
);
assert(renderer.includes('turn.status === "pending"'));
assert(renderer.includes('"Queued"'), "queued Turns must have a visible status label");

console.log("Codex P10 Turn queue presentation verification passed.");
