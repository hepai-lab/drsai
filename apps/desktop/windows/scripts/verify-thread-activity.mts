import assert from "node:assert/strict";
import type {
  DesktopBackgroundTask,
  DesktopThread,
  DesktopThreadSnapshot,
} from "../../shared/api/desktopApi";
import {
  deriveThreadActivity,
  indexBackgroundTasksByThread,
} from "../../shared/renderer/src/threadActivity";

const thread = (overrides: Partial<DesktopThread> = {}): DesktopThread => ({
  id: "thread-a",
  kind: "chat",
  title: "Thread A",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
  status: "idle",
  ...overrides,
});

const snapshot = (
  message: DesktopThreadSnapshot["messages"][number],
): DesktopThreadSnapshot => ({
  threadId: "thread-a",
  title: "Thread A",
  messages: [message],
  updatedAt: Date.now(),
  messageCount: 1,
});

const task = (
  status: DesktopBackgroundTask["status"],
  overrides: Partial<DesktopBackgroundTask> = {},
): DesktopBackgroundTask => ({
  id: `background-task:agent_run:${status}:00000000-0000-4000-8000-000000000001`,
  kind: "agent_run",
  source: "agent",
  title: "Task",
  status,
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:01.000Z",
  message: "Task state",
  verification: "Verified",
  ...overrides,
});

assert.deepEqual(deriveThreadActivity({ thread: thread() }), { kind: "idle" });
assert.deepEqual(deriveThreadActivity({ thread: thread({ status: "running" }) }), { kind: "running" });
assert.deepEqual(deriveThreadActivity({
  thread: thread(),
  snapshot: snapshot({ id: "m1", role: "assistant", content: "", streaming: true }),
}), { kind: "running" });
assert.deepEqual(deriveThreadActivity({
  thread: thread(),
  backgroundTask: task("running"),
}), { kind: "running" });
assert.deepEqual(deriveThreadActivity({
  thread: thread({ status: "running" }),
  backgroundTask: task("waiting_approval"),
}), { kind: "attention", reason: "approval" });
assert.deepEqual(deriveThreadActivity({
  thread: thread(),
  backgroundTask: task("running", { approvalId: "approval-a" }),
}), { kind: "attention", reason: "approval" });
assert.deepEqual(deriveThreadActivity({
  thread: thread(),
  backgroundTask: task("running", { pendingDecisions: ["Review"] }),
}), { kind: "attention", reason: "approval" });
assert.deepEqual(deriveThreadActivity({
  thread: thread(),
  snapshot: snapshot({
    id: "m1",
    role: "assistant",
    content: "",
    inputRequest: { requestId: "input-a", prompt: "Approve?", inputType: "approval" },
  }),
}), { kind: "attention", reason: "approval" });
assert.deepEqual(deriveThreadActivity({
  thread: thread(),
  snapshot: snapshot({
    id: "m1",
    role: "assistant",
    content: "",
    inputRequest: { requestId: "input-a", prompt: "Choose", inputType: "choice" },
  }),
}), { kind: "attention", reason: "interaction" });
assert.deepEqual(deriveThreadActivity({
  thread: thread({ status: "error" }),
  backgroundTask: task("completed"),
}), { kind: "idle" });

const threads = [
  thread({ id: "thread-a", lastRequestId: "request-a", lastRunId: "run-a" }),
  thread({ id: "thread-b", lastRunId: "run-b" }),
];
const direct = task("running", {
  id: "background-task:agent_run:direct:00000000-0000-4000-8000-000000000002",
  threadId: "thread-a",
  targetId: "run-b",
});
const waiting = task("waiting_approval", {
  id: "background-task:agent_run:waiting:00000000-0000-4000-8000-000000000003",
  targetId: "run-a",
  updatedAt: "2026-07-29T00:00:00.000Z",
});
const newerRunning = task("running", {
  id: "background-task:agent_run:newer:00000000-0000-4000-8000-000000000004",
  targetId: "run-a",
  updatedAt: "2026-07-29T00:00:03.000Z",
});
const indexed = indexBackgroundTasksByThread(threads, [newerRunning, waiting, direct]);
assert.equal(indexed.get("thread-a"), waiting);
assert.equal(indexed.has("thread-b"), false);

process.stdout.write("Thread activity verification passed (12 checks).\n");
