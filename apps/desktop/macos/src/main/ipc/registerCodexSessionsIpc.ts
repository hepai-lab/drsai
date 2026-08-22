import type { IpcMain } from "electron";
import { presentCodexBackendStatus } from "../../../../shared/main/codexBackendStatus";
import { LocalRuntimeClient } from "../../../../shared/main/runtimeClient";
import { updateThread, upsertThreadFromRun } from "../../../../shared/main/threads";

const syncControllers = new Map<string, AbortController>();
const identityPattern = /^[A-Za-z0-9_.:-]{1,200}$/;

export function registerMacosCodexSessionsIpc(ipcMain: Pick<IpcMain, "handle">): void {
  ipcMain.handle("desktop:restart-codex-backend", async () => {
    const client = await LocalRuntimeClient.connect();
    await client.restartBackend("codex");
    const capability = (await client.getCapabilities()).agent_backends?.codex;
    return presentCodexBackendStatus(capability, await client.getBackendAccount("codex", true));
  });
  ipcMain.handle("desktop:sync-codex-workspace-sessions", async (event, workspaceId, workspacePath, requestId) => {
    if (!identityPattern.test(workspaceId) || !identityPattern.test(requestId) || typeof workspacePath !== "string" || workspacePath.length > 2048 || /[\r\n\0]/.test(workspacePath)) throw new Error("Workspace identity for Codex Session sync is invalid.");
    if (syncControllers.has(requestId)) throw new Error("Codex workspace sync request is already active.");
    const controller = new AbortController();
    syncControllers.set(requestId, controller);
    const emit = (phase: "discovered" | "read" | "projected" | "persisted" | "cancelled", completed: number, total: number) => {
      if (!event.sender.isDestroyed()) event.sender.send("desktop:codex-workspace-session-sync-progress", { requestId, phase, completed, total });
    };
    try {
      emit("discovered", 0, 0);
      const result = await (await LocalRuntimeClient.connect()).syncBackendSessions(workspaceId, "codex", controller.signal);
      controller.signal.throwIfAborted();
      emit("read", result.sessions.length, result.sessions.length);
      const threads: Awaited<ReturnType<typeof updateThread>>[] = [];
      for (const [index, session] of result.sessions.entries()) {
        controller.signal.throwIfAborted();
        emit("projected", index, result.sessions.length);
        const thread = await upsertThreadFromRun({ id: session.session_id, kind: "chat", title: session.title, workspacePath, boundAgentId: "my-codex", boundAgentName: "Codex", runtimeSessionId: session.session_id, status: "idle", messageCount: session.message_count ?? 0 });
        threads.push(await updateThread({ id: thread.id, archived: session.archived === true, archiveSource: session.archived === true ? "codex" : undefined }));
        emit("persisted", index + 1, result.sessions.length);
      }
      if (!result.sessions.length) { emit("projected", 0, 0); emit("persisted", 0, 0); }
      return { workspaceId, discovered: result.discovered, active: result.active, archived: result.archived, created: result.created, updated: result.updated, skipped: result.skipped, conflicts: result.conflicts, threads };
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      emit("cancelled", 0, 0);
      return { workspaceId, cancelled: true, discovered: 0, active: 0, archived: 0, created: 0, updated: 0, skipped: 0, conflicts: 0, threads: [] };
    } finally {
      syncControllers.delete(requestId);
    }
  });
  ipcMain.handle("desktop:cancel-codex-workspace-session-sync", (_event, requestId) => {
    if (!identityPattern.test(requestId)) return false;
    const controller = syncControllers.get(requestId);
    if (!controller) return false;
    controller.abort(new DOMException("Codex workspace sync cancelled.", "AbortError"));
    return true;
  });
}
