import assert from "node:assert/strict";
import type {
  DesktopBackgroundTask,
  DesktopThread,
  DesktopThreadSnapshot,
} from "../../shared/api/desktopApi";
import {
  deriveThreadActivity,
  deriveThreadCatalogStatus,
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
}), { kind: "error" });
assert.deepEqual(deriveThreadActivity({
  thread: thread(),
  backgroundTask: task("failed"),
}), { kind: "error" });
assert.deepEqual(deriveThreadActivity({
  thread: thread(),
  snapshot: snapshot({ id: "m1", role: "assistant", content: "Reply incomplete", replyFailed: true }),
}), { kind: "error" });
assert.deepEqual(deriveThreadActivity({
  thread: thread(),
  snapshot: snapshot({ id: "m1", role: "assistant", content: "Model failed", error: true }),
}), { kind: "error" });
assert.deepEqual(deriveThreadActivity({
  thread: thread(),
  snapshot: snapshot({
    id: "m-runtime-notice",
    role: "assistant",
    content: "RuntimeError: Error code: 403",
    structuredTurn: {
      version: 2,
      turnId: "turn-runtime-notice",
      status: "cancelled",
      parts: [{
        id: "notice-runtime",
        kind: "notice",
        status: "error",
        level: "error",
        message: "RuntimeError: Error code: 403",
      }],
    },
  }),
}), { kind: "error" });
assert.deepEqual(deriveThreadActivity({
  thread: thread(),
  snapshot: snapshot({
    id: "m-user-abort",
    role: "assistant",
    content: "",
    structuredTurn: {
      version: 2,
      turnId: "turn-user-abort",
      status: "cancelled",
      parts: [],
    },
  }),
}), { kind: "idle" });
assert.deepEqual(deriveThreadActivity({
  thread: thread({ status: "error" }),
  snapshot: snapshot({ id: "m2", role: "assistant", content: "Recovered answer" }),
}), { kind: "idle" });
assert.deepEqual(deriveThreadActivity({
  thread: thread(),
  snapshot: snapshot({
    id: "m-terminal-interaction",
    role: "assistant",
    content: "Completed answer",
    streaming: true,
    structuredTurn: {
      version: 2,
      turnId: "turn-terminal-interaction",
      status: "completed",
      parts: [{
        id: "capability-a",
        kind: "interaction",
        status: "pending",
        requestId: "approval-a",
        interactionType: "capability_configuration",
        prompt: "Configure web search",
      }],
    },
  }),
}), { kind: "idle" });
assert.deepEqual(deriveThreadActivity({
  thread: thread(),
  snapshot: snapshot({
    id: "m-active-interaction",
    role: "assistant",
    content: "",
    structuredTurn: {
      version: 2,
      turnId: "turn-active-interaction",
      status: "pending",
      parts: [{
        id: "capability-b",
        kind: "interaction",
        status: "pending",
        requestId: "approval-b",
        interactionType: "capability_configuration",
        prompt: "Configure web search",
      }],
    },
  }),
}), { kind: "attention", reason: "interaction" });

assert.equal(deriveThreadCatalogStatus(snapshot({ id: "m1", role: "assistant", content: "", streaming: true })), "running");
assert.equal(deriveThreadCatalogStatus(snapshot({ id: "m1", role: "assistant", content: "Reply incomplete", replyFailed: true })), "error");
assert.equal(deriveThreadCatalogStatus(snapshot({ id: "m1", role: "assistant", content: "Done" })), "idle");
assert.equal(deriveThreadCatalogStatus(snapshot({
  id: "m-catalog-notice",
  role: "assistant",
  content: "RuntimeError: Error code: 403",
  structuredTurn: {
    version: 2,
    turnId: "turn-catalog-notice",
    status: "cancelled",
    parts: [{
      id: "notice-catalog",
      kind: "notice",
      status: "error",
      level: "error",
      message: "RuntimeError: Error code: 403",
    }],
  },
})), "error");

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

process.stdout.write("Thread activity verification passed (24 checks).\n");
