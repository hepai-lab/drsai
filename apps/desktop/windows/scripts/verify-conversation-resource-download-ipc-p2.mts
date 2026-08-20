import assert from "node:assert/strict";
import { registerConversationResourceDownloadIpc } from "../../shared/main/conversationResourceDownloadIpc";
import type { ConversationResourceDownloadProgressEvent } from "../../shared/api/desktopApi";

type Handler = (event: unknown, request: never) => unknown;
const handlers = new Map<string, Handler>();
const events: ConversationResourceDownloadProgressEvent[] = [];
let saveStarted: (() => void) | undefined;

registerConversationResourceDownloadIpc(
  (channel, handler) => handlers.set(channel, handler),
  async (name) => `C:\\safe-downloads\\${name}`,
  (_event, progress) => events.push(progress),
  {
    prepare: async () => ({ name: "report.bin", workspaceId: "workspace-a" }),
    save: async (request, _destination, _workspace, signal, onProgress) => {
      onProgress?.(0, 100);
      if (request.operationId === "operation-cancel") {
        saveStarted?.();
        await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true }));
      }
      if (request.operationId === "operation-failure") throw new Error("conversation_resource_download_chunk_integrity_mismatch");
      onProgress?.(50, 100);
      onProgress?.(100, 100);
      return { name: "report.bin", size: 100, digest: "sha256:" + "a".repeat(64) };
    },
  },
);

function invoke<T>(channel: string, request: unknown): Promise<T> {
  return handlers.get(channel)!({ sender: {} }, request as never) as Promise<T>;
}

const completed = await invoke<{ canceled: boolean; destinationPath?: string }>("desktop:conversation-resource-download", {
  workspacePath: "C:\\workspace", sessionId: "session-a", associationId: "association-a", operationId: "operation-success",
});
assert.equal(completed.canceled, false);
assert.equal(completed.destinationPath, "C:\\safe-downloads\\report.bin");
assert.deepEqual(events.filter((event) => event.operationId === "operation-success").map((event) => event.phase), [
  "preparing", "downloading", "downloading", "downloading", "completed",
]);
assert.deepEqual(events.filter((event) => event.operationId === "operation-success" && event.phase === "downloading").map((event) => event.percent), [0, 50, 100]);

const started = new Promise<void>((resolve) => { saveStarted = resolve; });
const cancelling = invoke<{ canceled: boolean }>("desktop:conversation-resource-download", {
  workspacePath: "C:\\workspace", sessionId: "session-a", associationId: "association-a", operationId: "operation-cancel",
});
await started;
assert.equal(await invoke<boolean>("desktop:conversation-resource-download-cancel", "operation-cancel"), true);
assert.equal((await cancelling).canceled, true);
assert.equal(events.at(-1)?.phase, "cancelled");
assert.equal(await invoke<boolean>("desktop:conversation-resource-download-cancel", "operation-cancel"), false, "Completed operations must leave no cancellable controller.");

await assert.rejects(invoke("desktop:conversation-resource-download", {
  workspacePath: "C:\\workspace", sessionId: "session-a", associationId: "association-a", operationId: "operation-failure",
}), /integrity_mismatch/);
const failure = events.findLast((event) => event.operationId === "operation-failure");
assert.equal(failure?.phase, "failed");
assert.equal(failure?.errorCode, "conversation_resource_download_chunk_integrity_mismatch");

await assert.rejects(
  invoke("desktop:conversation-resource-download", { workspacePath: "C:\\workspace", operationId: "../bad" }),
  /operation_invalid/,
);

console.log("Desktop shared P2 download progress and cancellation IPC passed.");
