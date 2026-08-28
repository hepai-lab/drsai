import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DesktopThread } from "../api/desktopApi";
import type { SessionConversationSubscription } from "../main/sessionConversationSubscription";
import { MacosThreadSnapshotController } from "../../macos/src/main/threadSnapshotController";

const thread: DesktopThread = {
  id: "macos-oaep-thread",
  kind: "chat",
  title: "macOS OAEP",
  workspacePath: "/tmp/macos-oaep-workspace",
  runtimeSessionId: "macos-oaep-session",
  createdAt: "2026-08-09T00:00:00.000Z",
  updatedAt: "2026-08-09T00:00:00.000Z",
  status: "idle",
  messageCount: 0,
};

const subscriptions: Array<{ stopped: boolean; resolve(): void }> = [];
const targetListeners = new Map<string, () => void>();
const target = {
  id: 71,
  isDestroyed: () => false,
  once: (event: string, listener: () => void) => { targetListeners.set(event, listener); },
  send: () => undefined,
};
const controller = new MacosThreadSnapshotController({
  listThreads: async () => [thread],
  updateThread: async () => thread,
  getRuntimeThreadSnapshot: async () => null,
  subscribeRuntimeThreadSnapshot: async () => {
    let settle!: () => void;
    const done = new Promise<void>((resolveDone) => { settle = resolveDone; });
    const state = { stopped: false, resolve: settle };
    subscriptions.push(state);
    return {
      sessionId: thread.runtimeSessionId!,
      cursor: 0,
      phase: "connected",
      stop() { state.stopped = true; settle(); },
      done,
    } as SessionConversationSubscription;
  },
});

assert.equal(await controller.subscribe(target as never, thread.id), true);
assert.equal(subscriptions.length, 1);
assert.equal(await controller.subscribe(target as never, thread.id), true);
assert.equal(subscriptions.length, 2);
assert.equal(subscriptions[0]?.stopped, true, "re-subscribe must stop the previous Session owner");
assert.equal(controller.unsubscribe(target.id, thread.id), true);
assert.equal(subscriptions[1]?.stopped, true);
assert.equal(controller.unsubscribe(target.id, thread.id), false, "unsubscribe must be idempotent");
assert.equal(await controller.subscribe(target as never, "../cross-session"), false);
assert.equal(await controller.subscribe(target as never, thread.id), true);
targetListeners.get("destroyed")?.();
assert.equal(subscriptions[2]?.stopped, true, "destroyed renderer must release its subscription");
controller.stopAll();

const macosCatalog = await readFile(resolve(process.cwd(), "src/main/ipc/registerCatalogIpc.ts"), "utf8");
assert.match(macosCatalog, /macosThreadSnapshotController\.subscribe\(event\.sender, threadId\)/);
assert.match(macosCatalog, /macosThreadSnapshotController\.unsubscribe\(event\.sender\.id, threadId\)/);
for (const channel of [
  "desktop:preview-my-drsai-model-connection",
  "desktop:diagnose-my-drsai-model-connection",
  "desktop:restore-my-drsai-model-connection",
  "desktop:save-my-drsai-model-provider",
  "desktop:get-my-drsai-runtime-model-catalog",
  "desktop:get-my-drsai-agent-model-capability-status",
]) {
  assert.ok(macosCatalog.includes(`ipcMain.handle("${channel}"`), `macOS model-policy composition is missing ${channel}`);
}
assert.match(macosCatalog, /discoverMyDrSaiProviderModels\(provider, refresh, draft\)/);
const chat = await readFile(resolve(process.cwd(), "../shared/main/chat.ts"), "utf8");
assert.match(chat, /selectRuntimeConversationProtocolResult\(await client\.getCapabilities\(\)/);
assert.match(chat, /code: "oaep_runtime_required"/);
assert.match(chat, /subscribeOaepSession\(client as RuntimeClient, runtimeSessionId/);
const runtimeSubscription = await readFile(resolve(process.cwd(), "../shared/main/threadRuntimeSubscription.ts"), "utf8");
for (const field of ["runtimeId", "instanceId", "runtimeVersion", "protocolVersion", "schemaHash"]) {
  assert.ok(runtimeSubscription.includes(field), `macOS Runtime handshake evidence is missing ${field}`);
}

console.log("macOS OAEP composition verification passed (IPC ownership, renderer cleanup, strict Chat negotiation).\n");
