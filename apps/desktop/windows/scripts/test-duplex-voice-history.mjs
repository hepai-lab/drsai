import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const home = await mkdtemp(join(tmpdir(), "opendrsai-duplex-history-"));
process.env.DRSAI_HOME = home;
try {
  const { appendDuplexVoiceHistory, getThreadSnapshot } = await import("../../shared/main/threads.ts");
  const request = { threadId: "thread-voice-1", messages: [
    { id: "duplex:s1:user:u1", role: "user", content: "你好" },
    { id: "duplex:s1:assistant:a1", role: "assistant", content: "你好，有什么可以帮你？" },
  ] };
  const first = await appendDuplexVoiceHistory(request);
  assert.equal(first.messages.length, 2); assert.equal(first.messageCount, 2);
  const replay = await appendDuplexVoiceHistory({ threadId: request.threadId, messages: [{ ...request.messages[1], statusContent: "Heard: 你好" }] });
  assert.equal(replay.messages.length, 2, "Provider replay upserts stable IDs");
  assert.equal(replay.messages[1].statusContent, "Heard: 你好");
  const loaded = await getThreadSnapshot(request.threadId);
  assert.deepEqual(loaded?.messages.map((message) => message.id), request.messages.map((message) => message.id));
  await assert.rejects(() => appendDuplexVoiceHistory({ threadId: "../escape", messages: [] }), /invalid/i);
  await assert.rejects(() => appendDuplexVoiceHistory({ threadId: request.threadId, messages: [{ id: "unsafe", role: "user", content: "x" }] }), /invalid/i);
  console.log("Duplex Voice M7 history verified (atomic shard append, stable-ID replay upsert, persisted heard boundary, and path/input validation).")
} finally { await rm(home, { recursive: true, force: true }); }
