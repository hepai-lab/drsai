import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "opendrsai-chat-recovery-"));
process.env.DRSAI_HOME = root;
try {
  const [threads, journal, chat] = await Promise.all([
    import("../main/threads.ts"), import("../main/chatRunJournal.ts"), import("../main/chat.ts"),
  ]);
  journal.recordChatRunEvent({ requestId: "ignored", sessionId: "ignored", type: "chunk" });
  assert.deepEqual(await journal.listRecordedChatRunEvents("missing-run"), []);
  const journalPath = join(root, "desktop", "chat-run-events.json");
  await mkdir(join(root, "desktop"), { recursive: true });
  await writeFile(journalPath, "[]");
  assert.deepEqual(await journal.listRecordedChatRunEvents("array-journal"), []);
  await writeFile(journalPath, "not-json");
  journal.recordChatRunEvent({ requestId: "reasoning-request", sessionId: "reasoning-session", runId: "reasoning-run", type: "reasoning", seq: 1 });
  journal.recordChatRunEvent({ requestId: "reasoning-request", sessionId: "reasoning-session", runId: "reasoning-run", type: "reasoning", seq: 2 });
  journal.recordChatRunEvent({ requestId: "other-request", sessionId: "reasoning-session", runId: "reasoning-run", type: "reasoning", content: "separate", seq: 3 });
  await journal.shutdownChatRunJournal();
  const reasoning = await journal.listRecordedChatRunEvents("reasoning-run");
  assert.equal(reasoning.length, 2); assert.equal(reasoning[0]?.content, "");
  const thread = await threads.createThread({ kind: "chat", title: "Recover chat", workspacePath: root });
  await threads.updateThread({ id: thread.id, status: "running", lastRunId: "chat-run-001", lastRequestId: "chat-request-001" });
  journal.recordChatRunEvent({ requestId: "chat-request-001", sessionId: thread.id, runId: "chat-run-001", type: "start", seq: 1 });
  journal.recordChatRunEvent({ requestId: "chat-request-001", sessionId: thread.id, runId: "chat-run-001", type: "chunk", content: "hello ", seq: 2 });
  journal.recordChatRunEvent({ requestId: "chat-request-001", sessionId: thread.id, runId: "chat-run-001", type: "chunk", content: "again", seq: 3 });
  await journal.shutdownChatRunJournal();
  assert.equal((await journal.listRecordedChatRunEvents("chat-run-001"))[1]?.content, "hello again");
  const recovered = await chat.recoverChatRun({ requestId: "chat-request-001", sessionId: thread.id });
  assert.deepEqual(recovered.map((event) => event.seq), [1, 2, 3]);
  assert.equal(recovered[1]?.content, "hello again");
  assert.equal(recovered[2]?.type, "error", "A run lost during application restart must fail closed without duplicate execution.");
  assert.equal((await threads.listThreads()).find((item) => item.id === thread.id)?.status, "error");
  const cancelledThread = await threads.createThread({ kind: "chat", title: "Recover fast cancel", workspacePath: root });
  await threads.updateThread({ id: cancelledThread.id, status: "running", lastRunId: "chat-run-cancelled", lastRequestId: "chat-request-cancelled" });
  journal.recordChatRunEvent({ requestId: "chat-request-cancelled", sessionId: cancelledThread.id, runId: "chat-run-cancelled", type: "aborted", seq: 1 });
  await journal.shutdownChatRunJournal();
  const recoveredCancellation = await chat.recoverChatRun({ requestId: "chat-request-cancelled", sessionId: cancelledThread.id });
  assert.deepEqual(recoveredCancellation.map((event) => event.type), ["aborted"], "A durable terminal journal event must win over a lagging Thread status write.");
  console.log("Chat journal, coalescing and restart recovery verification passed.");
} finally { await rm(root, { recursive: true, force: true }); }
