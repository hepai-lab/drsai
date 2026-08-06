import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyStructuredConversationEvent, createStructuredTurnState } from "../../shared/api/structuredConversation";

let state = createStructuredTurnState("run-queued");
state = applyStructuredConversationEvent(state, { version: 2, turnId: "run-queued", sequence: 1,
  dedupeKey: "start", timestamp: new Date().toISOString(), source: "codex", type: "turn.started" });
state = applyStructuredConversationEvent(state, { version: 2, turnId: "run-queued", sequence: 2,
  dedupeKey: "wait", timestamp: new Date().toISOString(), source: "codex", type: "turn.waiting",
  reason: "turn_queue", queuePosition: 3 });
assert.equal(state.status, "pending"); assert.equal(state.meta?.queuePosition, 3);
state = applyStructuredConversationEvent(state, { version: 2, turnId: "run-queued", sequence: 3,
  dedupeKey: "resume", timestamp: new Date().toISOString(), source: "codex", type: "turn.resumed" });
assert.equal(state.status, "running"); assert.equal(state.meta?.queuePosition, undefined);

const chat = await readFile(resolve(process.cwd(), "../shared/renderer/src/components/ChatWorkspace.tsx"), "utf8");
assert(chat.includes("排队发送") && chat.includes("停止并替换") && chat.includes("取消排队"));
const adapter = await readFile(resolve(process.cwd(), "../shared/renderer/src/adapters/useDesktopChatAdapter.ts"), "utf8");
assert.equal(adapter.includes("!text || activeRequestId || activeRequestIdRef.current"), false);
console.log("P10 Turn queue and explicit replace UX verification passed.");
