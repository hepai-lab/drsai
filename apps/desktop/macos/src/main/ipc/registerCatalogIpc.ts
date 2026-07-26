import type { IpcMain, WebContents } from "electron";
import { getPlatformAgentStatus, listAgents, recordAgentUsage, setDefaultAgent } from "../../../../shared/main/agents";
import type { MobilePairingController } from "../../../../shared/main/mobilePairingController";
import { getMyDrSaiConfig, updateMyDrSaiConfig } from "../../../../shared/main/myDrSaiConfig";
import { createThread, deleteThread, getThreadSnapshot, listThreads, searchThreadMessages, updateThread, updateThreadSnapshot } from "../../../../shared/main/threads";
import { createWorkspace, deleteWorkspace, listWorkspaces, updateWorkspace } from "../../../../shared/main/workspaces";
import type { MacosServiceContainer } from "../serviceContainer";

export interface MacosCatalogIpcDependencies {
  mobilePairingControllerFor(sender: WebContents): MobilePairingController;
}

export function registerMacosCatalogIpc(
  ipcMain: Pick<IpcMain, "handle">,
  services: Pick<MacosServiceContainer, "workspace">,
  dependencies: MacosCatalogIpcDependencies,
): void {
  ipcMain.handle("desktop:mobile-pairing-readiness", (event) => dependencies.mobilePairingControllerFor(event.sender).readiness());
  ipcMain.handle("desktop:mobile-pairing-create", (event) => dependencies.mobilePairingControllerFor(event.sender).create());
  ipcMain.handle("desktop:mobile-pairing-read", (event, grantId: string) => dependencies.mobilePairingControllerFor(event.sender).read(grantId));
  ipcMain.handle("desktop:mobile-pairing-revoke", (event, grantId: string) => dependencies.mobilePairingControllerFor(event.sender).revoke(grantId));
  ipcMain.handle("desktop:mobile-associations-list", (event) => dependencies.mobilePairingControllerFor(event.sender).associations());
  ipcMain.handle("desktop:mobile-association-revoke", (event, associationId: string) => dependencies.mobilePairingControllerFor(event.sender).revokeAssociation(associationId));
  ipcMain.handle("desktop:mobile-enrollment-revoke", (event) => dependencies.mobilePairingControllerFor(event.sender).revokeEnrollment());
  ipcMain.handle("desktop:list-threads", () => listThreads());
  ipcMain.handle("desktop:list-agents", (_event, options) => listAgents(options && typeof options === "object" && (options as { refresh?: unknown }).refresh === true ? { refresh: true } : {}));
  ipcMain.handle("desktop:get-platform-agent-status", () => getPlatformAgentStatus());
  ipcMain.handle("desktop:set-default-agent", (_event, agentId) => setDefaultAgent(typeof agentId === "string" ? agentId : ""));
  ipcMain.handle("desktop:record-agent-usage", (_event, agentId) => recordAgentUsage(typeof agentId === "string" ? agentId : ""));
  ipcMain.handle("desktop:create-thread", (_event, request) => createThread(request));
  ipcMain.handle("desktop:update-thread", (_event, request) => updateThread(request));
  ipcMain.handle("desktop:delete-thread", (_event, threadId) => deleteThread(threadId));
  ipcMain.handle("desktop:set-thread-archived", (_event, request: { threadId: string; archived: boolean }) => updateThread({ id: request.threadId, archived: request.archived }));
  ipcMain.handle("desktop:get-thread-snapshot", (_event, threadId) => getThreadSnapshot(threadId));
  ipcMain.handle("desktop:search-thread-messages", (_event, request) => searchThreadMessages(request));
  ipcMain.handle("desktop:update-thread-snapshot", (_event, request) => updateThreadSnapshot(request));
  ipcMain.handle("desktop:list-workspaces", () => listWorkspaces());
  ipcMain.handle("desktop:create-workspace", (_event, request) => createWorkspace(request));
  ipcMain.handle("desktop:update-workspace", (_event, request) => updateWorkspace(request));
  ipcMain.handle("desktop:delete-workspace", (_event, id) => deleteWorkspace(id));
  ipcMain.handle("desktop:get-my-drsai-config", async (_event, workspacePath) => {
    if (workspacePath === undefined) return getMyDrSaiConfig();
    const path = await services.workspace.assertPath(workspacePath);
    const workspace = await services.workspace.findByPath(path);
    return getMyDrSaiConfig(workspace?.location === "remote" ? undefined : path);
  });
  ipcMain.handle("desktop:update-my-drsai-config", (_event, request) => updateMyDrSaiConfig(request));
}
