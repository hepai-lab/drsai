import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { DesktopThreadSnapshot } from "../api/desktopApi";
import { settleSnapshotForTerminalStatus } from "../renderer/src/threadActivity";

const root = await mkdtemp(join(tmpdir(), "drsai-session-completion-"));
process.env.DRSAI_HOME = root;

// ── Renderer: a backgrounded Session's cached snapshot must settle ──────────
function streamingSnapshot(): DesktopThreadSnapshot {
  return {
    threadId: "thread-a",
    title: "Backgrounded chat",
    updatedAt: 1,
    messageCount: 2,
    messages: [
      { id: "u1", role: "user", content: "hi" },
      {
        id: "a1",
        role: "assistant",
        content: "partial",
        streaming: true,
        structuredTurn: {
          version: 2,
          turnId: "run-1",
          status: "running",
          parts: [],
        },
      },
    ],
  } as unknown as DesktopThreadSnapshot;
}

const pending = streamingSnapshot();
const settled = settleSnapshotForTerminalStatus(pending, "idle");
assert.ok(settled, "a pending snapshot must settle when the catalog says idle");
assert.equal(settled!.messages[1].streaming, false);
assert.equal(settled!.messages[1].structuredTurn?.status, "completed");

const settledError = settleSnapshotForTerminalStatus(pending, "error");
assert.equal(settledError!.messages[1].structuredTurn?.status, "error");

// An already-settled snapshot must not be rewritten (no needless re-render).
const alreadyIdle: DesktopThreadSnapshot = {
  ...pending,
  messages: pending.messages.map((message) => message.structuredTurn?.status === "running"
    ? { ...message, streaming: false, structuredTurn: { ...message.structuredTurn, status: "completed" as const } }
    : { ...message, streaming: false }),
};
assert.equal(
  settleSnapshotForTerminalStatus(alreadyIdle, "idle"),
  null,
  "a settled snapshot must not be rewritten",
);

// A pending input request (waiting for the user) still clears: the Session is
// no longer running, so it must not keep the sidebar spinning.
const awaitingInput = streamingSnapshot();
awaitingInput.messages[1] = {
  ...awaitingInput.messages[1],
  streaming: false,
  structuredTurn: undefined,
  inputRequest: { requestId: "r1", prompt: "pick", inputType: "approval" },
} as unknown as DesktopThreadSnapshot["messages"][number];
const settledInput = settleSnapshotForTerminalStatus(awaitingInput, "idle");
assert.ok(settledInput, "a pending interaction must settle when the Session stopped");
assert.equal(settledInput!.messages[1].inputRequest, undefined);

// ── Main: a backgrounded conversation raises a completion notification ──────
const service = await import("../main/completionNotifications");
class NotificationHandle extends EventEmitter {
  shown = 0;
  show(): void { this.shown += 1; }
  override once(event: "click" | "close", listener: () => void): this { return super.once(event, listener); }
}
const created: Array<{ input: { title: string; body: string }; handle: NotificationHandle }> = [];
service.configureCompletionNotifications({
  notifications: {
    supported: () => true,
    create: (input) => { const handle = new NotificationHandle(); created.push({ input, handle }); return handle; },
  },
  focusApp: () => undefined,
  publishClick: () => undefined,
  getWindowVisibility: () => "hidden",
});

await service.setCompletionNotificationPreference({ enabled: true, language: "zh" });
assert.equal(
  service.notifyConversationCompleted({ threadId: "thread-a", title: "报告 session", workspacePath: "/w", failed: false }),
  true,
);
assert.equal(
  service.notifyConversationCompleted({ threadId: "thread-a", title: "报告 session", workspacePath: "/w", failed: false }),
  false,
  "a duplicate completion for the same thread must be suppressed",
);
assert.equal(created.length, 1);
assert.match(created[0].input.body, /报告 session/);
assert.match(created[0].input.body, /完成/);

assert.equal(
  service.notifyConversationCompleted({ threadId: "thread-b", title: "Broken", failed: true }),
  true,
);
assert.equal(created[1].input.body, "您的任务：\n「Broken」\n执行失败，请点击查看详情。");

// A long first user message must be truncated in the notification body.
const longTitle = "这是一条特别特别长的用户首条消息，它不应该原封不动地被塞进系统通知里导致内容溢出";
assert.equal(
  service.notifyConversationCompleted({ threadId: "thread-d", title: longTitle, failed: false }),
  true,
);
assert.equal(created[2].input.body, `您的任务：\n「${longTitle.slice(0, 30)}…」\n已经完成，请点击查看。`);

// The latest user input of the finished turn wins over the (first-message)
// thread title, so the notification names the question that just completed.
assert.equal(
  service.notifyConversationCompleted({
    threadId: "thread-e",
    title: "最初的问题",
    prompt: "最新的问题",
    failed: false,
  }),
  true,
);
assert.equal(created[3].input.body, "您的任务：\n「最新的问题」\n已经完成，请点击查看。");

await service.setCompletionNotificationPreference({ enabled: false, language: "zh" });
assert.equal(
  service.notifyConversationCompleted({ threadId: "thread-c", failed: false }),
  false,
  "notifications must respect the disabled preference",
);

console.log("Session completion broadcast verification passed.");
