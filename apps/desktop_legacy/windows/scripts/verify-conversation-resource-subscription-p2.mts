import assert from "node:assert/strict";

import {
  ConversationResourceSubscriptionManager,
  registerConversationResourceSubscriptionIpc,
} from "../../shared/main/conversationResourceSubscriptionIpc";

const request = { workspacePath: "C:/workspace", sessionId: "session-1" };
const emitted: unknown[] = [];
let polls = 0;
const manager = new ConversationResourceSubscriptionManager(async (_request, cursor) => {
  polls += 1;
  assert.equal(cursor, 0);
  return { cursor: 7, events: [{
    workspacePath: request.workspacePath, sessionId: request.sessionId,
    sequence: 7, eventType: "resource.changed", resourceId: "resource-1",
    state: "changed", versionId: "version-2",
  }] };
}, (event) => emitted.push(event), 60_000);
const subscriptionId = await manager.start(request);
assert.match(subscriptionId, /^resource-subscription-/);
assert.equal(polls, 1);
assert.deepEqual(emitted, [{
  subscriptionId, workspacePath: request.workspacePath, sessionId: request.sessionId,
  sequence: 7, eventType: "resource.changed", resourceId: "resource-1",
  state: "changed", versionId: "version-2",
}]);
assert.equal(manager.stop(subscriptionId), true);
assert.equal(manager.stop(subscriptionId), false);
await assert.rejects(() => manager.start({ ...request, afterSequence: -1 }), /subscription_invalid/);

const failures: unknown[] = [];
const failing = new ConversationResourceSubscriptionManager(async () => { throw new Error("secret backend failure"); }, (event) => failures.push(event), 60_000);
const failedId = await failing.start(request);
assert.deepEqual(failures, [{
  subscriptionId: failedId, workspacePath: request.workspacePath, sessionId: request.sessionId,
  sequence: 0, eventType: "resource.subscription.invalidated", scopeInvalidated: true,
}], "transport failure must invalidate scope without exposing an internal exception");
failing.stopAll();

const handlers = new Map<string, (event: unknown, raw: unknown) => unknown>();
const sent: unknown[] = [];
let destroyed: (() => void) | undefined;
registerConversationResourceSubscriptionIpc(
  (channel, handler) => handlers.set(channel, handler),
  (_event, value) => sent.push(value),
  async () => ({ cursor: 1, events: [{
    workspacePath: request.workspacePath, sessionId: request.sessionId,
    sequence: 1, eventType: "resource.moved", resourceId: "resource-1", state: "moved",
  }] }),
);
const ipcEvent = { sender: { once: (name: string, callback: () => void) => { assert.equal(name, "destroyed"); destroyed = callback; } } };
const ipcId = await handlers.get("desktop:conversation-resource-subscription-start")!(ipcEvent, request);
assert.equal(typeof ipcId, "string");
assert.equal(sent.length, 1);
assert.equal(await handlers.get("desktop:conversation-resource-subscription-stop")!(ipcEvent, ipcId), true);
destroyed?.();

console.log("Conversation resource subscription main/preload event contract passed.");
