import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "opendrsai-thread-test-"));
process.env.DRSAI_HOME = root;

try {
  const threads = await import("../main/threads.ts");
  const created = await threads.createThread({ kind: "agent_run", title: "Recovery run", workspacePath: root, boundAgentId: "agent-test", boundAgentName: "Test Agent" });
  assert.equal(created.status, "idle");
  const running = await threads.updateThread({ id: created.id, status: "running", lastRunId: "run-001", lastRequestId: "request-001", runtimeSessionId: "session-001", messageCount: 2 });
  assert.equal(running.lastRunId, "run-001");
  assert.equal(running.runtimeSessionId, "session-001");
  await threads.updateThreadSnapshot({
    threadId: created.id,
    title: running.title,
    messages: [
      { id: "message-user", role: "user", content: "find the recovery marker" },
      { id: "message-assistant", role: "assistant", content: "recovery marker restored" },
    ],
    updatedAt: Date.now(),
    messageCount: 2,
  });
  assert.equal((await threads.getThreadSnapshot(created.id))?.messages.length, 2);
  assert.equal((await threads.searchThreadMessages({ query: "recovery marker", threadIds: [created.id] }))[0]?.threadId, created.id);
  assert.equal((await threads.updateThread({ id: created.id, archived: true })).archived, true);
  assert.equal((await threads.listThreads()).some((thread) => thread.id === created.id), true);
  assert.equal(await threads.deleteThread(created.id), true);
  assert.equal(await threads.deleteThread(created.id), false, "Delete must be idempotent and report an absent thread.");
  assert.equal((await threads.listThreads()).some((thread) => thread.id === created.id), false);
  assert.equal(await threads.getThreadSnapshot(created.id), null, "Deleting a thread must delete its persisted snapshot.");
  assert.deepEqual(JSON.parse(await readFile(join(root, "desktop", "threads.json"), "utf8")), []);
  const shard = join(root, "desktop", "thread-snapshots", `${createHash("sha256").update(created.id).digest("hex")}.json`);
  await assert.rejects(access(shard), /ENOENT/, "Deleting a thread must remove its snapshot shard.");
  console.log("Thread lifecycle and persistence verification passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}
