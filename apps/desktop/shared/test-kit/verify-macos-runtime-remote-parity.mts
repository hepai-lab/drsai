import assert from "node:assert/strict";
import type { WebContents } from "electron";
import type { DesktopThread, DesktopThreadSnapshot } from "../api/desktopApi";
import type { SessionConversationSubscription } from "../main/sessionConversationSubscription";
import { MacosThreadSnapshotController } from "../../macos/src/main/threadSnapshotController";

const thread: DesktopThread = {
  id: "thread:runtime:1",
  kind: "chat",
  title: "Runtime thread",
  workspacePath: "/workspace",
  runtimeSessionId: "session:runtime:1",
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  status: "idle",
  messageCount: 0,
};
const snapshot: DesktopThreadSnapshot = {
  threadId: thread.id,
  title: thread.title,
  messages: [{ id: "message:1", role: "assistant", content: "live", startedAt: 1, lastEventAt: 2 }],
  updatedAt: Date.parse("2026-07-28T00:01:00.000Z"),
  messageCount: 1,
};

let stopCount = 0;
let updateCount = 0;
let destroyedHandler: (() => void) | undefined;
const sent: Array<{ channel: string; event: unknown }> = [];
const target = {
  id: 42,
  isDestroyed: () => false,
  send: (channel: string, event: unknown) => { sent.push({ channel, event }); },
  once: (event: string, handler: () => void) => { if (event === "destroyed") destroyedHandler = handler; return target; },
} as unknown as WebContents;
const pending = new Promise<void>(() => undefined);
const subscription: SessionConversationSubscription = { sessionId: thread.runtimeSessionId!, cursor: 0, stop: () => { stopCount += 1; }, done: pending };

const controller = new MacosThreadSnapshotController({
  listThreads: async () => [thread],
  updateThread: async (request) => { updateCount += 1; return { ...thread, messageCount: request.messageCount, unread: request.unread, updatedAt: new Date().toISOString() }; },
  getRuntimeThreadSnapshot: async () => snapshot,
  subscribeRuntimeThreadSnapshot: async (_thread, receiver) => { receiver.send("desktop:thread-snapshot", { threadId: thread.id, runtimeSessionId: thread.runtimeSessionId!, sessionSequence: 1, snapshot }); return subscription; },
});

assert.equal(await controller.subscribe(target, thread.id), true);
await new Promise((resolve) => setTimeout(resolve, 0));
assert(sent.some((item) => item.channel === "desktop:thread-snapshot"), "subscription must publish the Runtime snapshot");
assert(sent.some((item) => item.channel === "desktop:thread-catalog"), "catalog sync must publish updated Runtime metadata");
assert.equal(updateCount, 1);
assert.equal(controller.unsubscribe(target.id, thread.id), true);
assert.equal(stopCount, 1);
assert.equal(controller.unsubscribe(target.id, thread.id), false);

assert.equal(await controller.subscribe(target, "../invalid"), false);
assert.equal(await controller.subscribe(target, "thread:missing"), false);
assert.equal(await controller.subscribe(target, thread.id), true);
destroyedHandler?.();
assert.equal(stopCount, 2, "destroying WebContents must stop its active subscription");
controller.stopAll();

console.log("macOS Runtime Thread subscribe/unsubscribe, live snapshot, catalog sync and cleanup passed.");
