import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "opendrsai-agent-recovery-"));
process.env.DRSAI_HOME = root;
try {
  const [{ createThread, listThreads, updateThread }, journal, { recoverAgentRun }] = await Promise.all([
    import("../main/threads.ts"), import("../main/agentRunJournal.ts"), import("../main/agentRuns.ts"),
  ]);
  assert.deepEqual(await journal.listRecordedAgentRunEvents("missing-run"), []);
  const journalPath = join(root, "desktop", "agent-run-events.json");
  await mkdir(join(root, "desktop"), { recursive: true });
  await writeFile(journalPath, "[]");
  assert.deepEqual(await journal.listRecordedAgentRunEvents("array-journal"), []);
  await writeFile(journalPath, "not-json");
  journal.recordAgentRunEvent({ requestId: "request-empty", sessionId: "session-empty", runId: "run-empty", type: "chunk" });
  journal.recordAgentRunEvent({ requestId: "request-empty", sessionId: "session-empty", runId: "run-empty", type: "chunk" });
  await journal.shutdownAgentRunJournal();
  assert.equal((await journal.listRecordedAgentRunEvents("run-empty")).length, 1);
  const thread = await createThread({ kind: "agent_run", title: "Recover me", workspacePath: root });
  await updateThread({ id: thread.id, status: "running", lastRunId: "run-recovery-001", lastRequestId: "request-recovery-001" });
  journal.recordAgentRunEvent({ requestId: "request-recovery-001", sessionId: thread.id, runId: "run-recovery-001", type: "start" });
  journal.recordAgentRunEvent({ requestId: "request-recovery-001", sessionId: thread.id, runId: "run-recovery-001", type: "chunk", content: "first " });
  journal.recordAgentRunEvent({ requestId: "request-recovery-001", sessionId: thread.id, runId: "run-recovery-001", type: "chunk", content: "second" });
  journal.recordAgentRunEvent({ requestId: "request-recovery-002", sessionId: thread.id, runId: "run-recovery-001", type: "chunk", content: "different request" });
  await journal.shutdownAgentRunJournal();
  const recorded = await journal.listRecordedAgentRunEvents("run-recovery-001");
  assert.equal(recorded.length, 3, "Only adjacent chunks from the same request may be coalesced in the bounded journal.");
  assert.equal(recorded[1]?.content, "first second");
  const recovered = await recoverAgentRun(thread.id);
  assert.equal(recovered.at(-1)?.type, "error");
  assert.match(recovered.at(-1)?.error ?? "", /application restart/i);
  assert.equal((await listThreads()).find((item) => item.id === thread.id)?.status, "error");
  console.log("Agent run restart recovery verification passed.");
} finally { await rm(root, { recursive: true, force: true }); }
