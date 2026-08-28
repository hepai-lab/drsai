import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const home = await mkdtemp(join(tmpdir(), "opendrsai-fork-queue-"));
process.env.DRSAI_HOME = home;

try {
  const repo = join(home, "repo");
  const worktreeA = join(home, "worktree-a");
  const worktreeB = join(home, "worktree-b");
  await mkdir(worktreeA); await mkdir(worktreeB);
  await exec("git", ["init", repo]);
  await exec("git", ["-C", repo, "config", "user.email", "desktop-test@example.invalid"]);
  await exec("git", ["-C", repo, "config", "user.name", "Desktop Test"]);
  await writeFile(join(repo, "conflict.txt"), "base\n");
  await exec("git", ["-C", repo, "add", "conflict.txt"]); await exec("git", ["-C", repo, "commit", "-m", "base"]);
  const canonicalRepo = await realpath(repo);

  const threads = await import("../main/threads.ts");
  const queue = await import("../main/forkQueue.ts");
  const { PersistentApprovalStore } = await import("../main/approvalStore.ts");
  const context = await import("../main/workspaceContext.ts");
  const createdAt = new Date().toISOString();
  const first = await threads.createThread({ kind: "agent_run", title: "First subtask", workspacePath: worktreeA, fork: { sourceWorkspacePath: repo, repoRoot: repo, worktreePath: worktreeA, branch: "drsai/fork/a", baseRef: "HEAD", createdAt, sourceHasChanges: false, lifecycleStatus: "active", queueGroupId: "queue-1", queueIndex: 1, queueSize: 2, queueStatus: "queued" } });
  const second = await threads.createThread({ kind: "agent_run", title: "Second subtask", workspacePath: worktreeB, fork: { sourceWorkspacePath: repo, repoRoot: repo, worktreePath: worktreeB, branch: "drsai/fork/b", baseRef: "HEAD", createdAt, sourceHasChanges: false, lifecycleStatus: "active", queueGroupId: "queue-1", queueIndex: 2, queueSize: 2, queueStatus: "queued" } });

  for (const invalid of [null, "bad", {}, { threadIds: [] }, { threadIds: "bad" }, { threadIds: [42] }, { threadIds: ["x".repeat(161)] }]) {
    assert.equal(queue.normalizeForkQueueStartRequest(invalid), null);
  }
  assert.equal(queue.normalizeForkQueueStartRequest({ threadIds: [first.id, first.id] }), null, "duplicate queue ids must be rejected");
  assert.equal(queue.normalizeForkQueueStartRequest({ threadIds: Array.from({ length: 13 }, (_, index) => `thread-${index}`) }), null, "oversized queues must be rejected");
  assert.equal(queue.normalizeForkQueueDispatchRequest(null), null);
  const normalizedAssignments = queue.normalizeForkQueueDispatchRequest({ threadIds: idsFor(first.id), selectedAgentId: " a\n", selectedAgentName: 4, model: "m".repeat(200), threadAgentAssignments: { unknown: { agentId: "ignored" }, [first.id]: null } });
  assert.equal(normalizedAssignments?.selectedAgentId, "a"); assert.equal(normalizedAssignments?.selectedAgentName, undefined); assert.equal(normalizedAssignments?.model?.length, 160); assert.equal(normalizedAssignments?.threadAgentAssignments, undefined);
  const approvalStore = new PersistentApprovalStore(join(home, "approvals.json"));
  const ids = [first.id, second.id];
  assert.equal((await queue.dispatchForkQueue(null, { assertWorkspaceAllowed: async () => undefined, startRun: async () => ({ requestId: "x", runId: "x" }) })).startedRuns.length, 0);
  const missingDispatch = await queue.dispatchForkQueue({ threadIds: [first.id, "thread:missing"] }, { assertWorkspaceAllowed: async () => undefined, startRun: async () => ({ requestId: "x", runId: "x" }) });
  assert.deepEqual(missingDispatch.blockedThreadIds, [first.id, "thread:missing"]);
  const rejected = await approvalStore.propose({ source: "fork", actionKind: "fork.queue_start", title: "Queue", detail: "Review two isolated fork subtasks.", target: repo, risk: "high", idempotencyKey: "fork-queue-reject-test" }, async () => { await queue.updateForkQueueThreads(ids, "ready", "ready"); return true; }, async (approved) => { if (!approved) await queue.updateForkQueueThreads(ids, "blocked", "rejected"); });
  assert.equal(await approvalStore.decide({ id: rejected.approval!.id, approved: false, reason: "reject" }), true);
  assert.deepEqual((await threads.listThreads()).filter((item) => ids.includes(item.id)).map((item) => item.fork?.queueStatus), ["blocked", "blocked"]);

  await queue.updateForkQueueThreads(ids, "ready", "approved");
  const starts: Array<Record<string, unknown>> = [];
  const validatedForks: string[] = [];
  const dispatched = await queue.dispatchForkQueue({ threadIds: ids, selectedAgentName: "Default", threadAgentAssignments: { [second.id]: { agentId: "reviewer", agentName: "Reviewer" } }, model: "test-model" }, {
    assertWorkspaceAllowed: async (path) => { assert.equal(path, repo); },
    assertForkAllowed: async (thread) => { validatedForks.push(thread.id); },
    startRun: async (request) => { starts.push(request); return { requestId: `request-${starts.length}`, runId: String(request.runId) }; },
    now: () => new Date("2026-07-22T00:00:00.000Z"),
  });
  assert.equal(dispatched.startedRuns.length, 2); assert.deepEqual(dispatched.blockedThreadIds, []);
  assert.deepEqual(validatedForks, ids, "every dispatched fork must pass its managed-worktree ownership boundary");
  assert.equal((starts[1]!.metadata as Record<string, unknown>).selected_agent_id, "reviewer");
  assert.match(String(starts[1]!.task), /Assigned agent: Reviewer/);

  const unapproved = await threads.createThread({ kind: "agent_run", title: "Not ready", workspacePath: worktreeA, fork: { sourceWorkspacePath: repo, repoRoot: repo, worktreePath: worktreeA, branch: "drsai/fork/not-ready", baseRef: "HEAD", createdAt, sourceHasChanges: false, lifecycleStatus: "active", queueStatus: "queued", queueAgentHint: "security reviewer" } });
  const blocked = await queue.dispatchForkQueue({ threadIds: [unapproved.id] }, { assertWorkspaceAllowed: async () => undefined, startRun: async () => ({ requestId: "never", runId: "never" }) });
  assert.deepEqual(blocked.blockedThreadIds, [unapproved.id]); assert.equal(blocked.threads[0]?.fork?.queueStatus, "blocked");
  await queue.updateForkQueueThreads([unapproved.id], "ready", "approved");
  const failed = await queue.dispatchForkQueue({ threadIds: [unapproved.id], threadAgentAssignments: { [unapproved.id]: { agentName: "", agentId: "fallback-agent" } } }, {
    assertWorkspaceAllowed: async () => undefined,
    startRun: async () => { throw new Error("cannot start\nsecret detail"); },
  });
  assert.deepEqual(failed.blockedThreadIds, [unapproved.id]); assert.match(failed.reason, /No fork queue/); assert.equal(failed.threads.length, 1); assert.equal(failed.threads[0]?.fork?.queueStatus, "blocked"); assert.match(failed.threads[0]?.fork?.queueMessage ?? "", /cannot start secret detail/);
  assert.deepEqual(await queue.updateForkQueueThreads(["thread:absent"], "ready", "ignored", { approvalId: "approval:x", now: new Date(dueDate()) }), []);

  await writeFile(join(repo, "conflict.txt"), "ours\n");
  const conflictThread = await threads.createThread({ kind: "agent_run", title: "Conflict recovery", workspacePath: worktreeA, fork: { sourceWorkspacePath: repo, repoRoot: repo, worktreePath: worktreeA, branch: "drsai/fork/conflict", baseRef: "HEAD", createdAt, sourceHasChanges: false, lifecycleStatus: "merge_pending" } });
  const reviewedDiff = await context.getWorkspaceGitDiff({ workspacePath: repo, path: "conflict.txt" });
  for (const invalid of [null, {}, { threadId: conflictThread.id, workspacePath: repo, path: "conflict.txt", draft: 3, expectedDiffHash: reviewedDiff.diffHash }, { threadId: conflictThread.id, workspacePath: repo, path: "conflict.txt", draft: "x\0", expectedDiffHash: reviewedDiff.diffHash }, { threadId: conflictThread.id, workspacePath: repo, path: "conflict.txt", draft: "x".repeat(500_001), expectedDiffHash: reviewedDiff.diffHash }, { threadId: conflictThread.id, workspacePath: repo, path: "conflict.txt", draft: "x", expectedDiffHash: "bad" }]) {
    assert.throws(() => queue.normalizeForkConflictDraftRequest(invalid), /invalid|incomplete|large|null|hash/i);
  }
  const request = await queue.validateForkConflictDraft({ threadId: conflictThread.id, workspacePath: repo, path: "conflict.txt", draft: "resolved\n", expectedDiffHash: reviewedDiff.diffHash }, async (path) => { assert.equal(path, canonicalRepo); });
  await assert.rejects(() => queue.validateForkConflictDraft({ ...request, threadId: "thread:missing" }, async () => undefined), /no longer exists/i);
  await assert.rejects(() => queue.validateForkConflictDraft({ ...request, threadId: first.id }, async () => undefined), /merge recovery/i);
  await assert.rejects(() => queue.validateForkConflictDraft({ ...request, workspacePath: worktreeA }, async () => undefined), /does not match/i);
  await assert.rejects(() => queue.validateForkConflictDraft({ ...request, path: "missing.txt" }, async () => undefined), /existing source file/i);
  await assert.rejects(() => queue.validateForkConflictDraft({ ...request, path: "../outside.txt" }, async () => undefined), /existing|escapes/i);
  await writeFile(join(repo, "conflict.txt"), "changed-after-review\n");
  await assert.rejects(() => queue.executeForkConflictDraftWrite(request), /changed since approval/);
  const refreshed = await context.getWorkspaceGitDiff({ workspacePath: repo, path: "conflict.txt" });
  const valid = await queue.validateForkConflictDraft({ ...request, expectedDiffHash: refreshed.diffHash }, async () => undefined);
  const written = await queue.executeForkConflictDraftWrite(valid);
  assert.equal(written.written, true); assert.equal(await readFile(join(repo, "conflict.txt"), "utf8"), "resolved\n");
  await approvalStore.shutdown();
  console.log("Fork queue approval/dispatch and conflict draft atomic write verification passed.");
} finally {
  await rm(home, { recursive: true, force: true });
}

function idsFor(id: string): string[] { return [id]; }
function dueDate(): string { return "2026-07-22T00:00:00.000Z"; }
