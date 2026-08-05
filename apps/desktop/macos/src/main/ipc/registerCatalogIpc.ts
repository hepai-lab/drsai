import type { IpcMain, WebContents } from "electron";
import type { DesktopMobilePairingTarget } from "../../../../shared/api/desktopApi";
import { getPlatformAgentStatus, listAgents, recordAgentUsage, setDefaultAgent } from "../../../../shared/main/agents";
import type { MobilePairingController } from "../../../../shared/main/mobilePairingController";
import { deleteMyDrSaiModelProvider, discoverMyDrSaiProviderModels, getMyDrSaiConfig, listMyDrSaiModelProviderPresets, testMyDrSaiModelDraft, testMyDrSaiModelProvider, updateMyDrSaiConfig, updateMyDrSaiModelConnection } from "../../../../shared/main/myDrSaiConfig";
import { createThread, deleteThread, getThreadSnapshot, listThreads, searchThreadMessages, updateThread, updateThreadSnapshot } from "../../../../shared/main/threads";
import { getRuntimeThreadSnapshot } from "../../../../shared/main/threadRuntimeSubscription";
import { createWorkspace, deleteWorkspace, listWorkspaces, updateWorkspace } from "../../../../shared/main/workspaces";
import { remoteWorkspaceController } from "../../../../shared/main/remoteWorkspaceController";
import type { MacosServiceContainer } from "../serviceContainer";
import { macosThreadSnapshotController } from "../threadSnapshotController";

export interface MacosCatalogIpcDependencies {
  mobilePairingControllerFor(sender: WebContents, target?: DesktopMobilePairingTarget): MobilePairingController;
}

export function registerMacosCatalogIpc(
  ipcMain: Pick<IpcMain, "handle">,
  services: Pick<MacosServiceContainer, "workspace">,
  dependencies: MacosCatalogIpcDependencies,
): void {
  ipcMain.handle("desktop:mobile-pairing-readiness", async (event, target) => {
    const readiness = await dependencies.mobilePairingControllerFor(event.sender, target).readiness();
    if (!target) return readiness;
    const status = await remoteWorkspaceController.status(target.workspaceId);
    if (!status.connected || !status.gatewayReady || !status.runtimeId) throw new Error("Mobile pairing target Remote Workspace is offline.");
    return { ...readiness, gateway_runtime_id: status.runtimeId };
  });
  ipcMain.handle("desktop:mobile-pairing-create", (event, target) => dependencies.mobilePairingControllerFor(event.sender, target).create());
  ipcMain.handle("desktop:mobile-pairing-read", (event, grantId: string, target) => dependencies.mobilePairingControllerFor(event.sender, target).read(grantId));
  ipcMain.handle("desktop:mobile-pairing-revoke", (event, grantId: string, target) => dependencies.mobilePairingControllerFor(event.sender, target).revoke(grantId));
  ipcMain.handle("desktop:mobile-associations-list", (event, target) => dependencies.mobilePairingControllerFor(event.sender, target).associations());
  ipcMain.handle("desktop:mobile-association-revoke", (event, associationId: string, target) => dependencies.mobilePairingControllerFor(event.sender, target).revokeAssociation(associationId));
  ipcMain.handle("desktop:mobile-enrollment-revoke", (event, target) => dependencies.mobilePairingControllerFor(event.sender, target).revokeEnrollment());
  ipcMain.handle("desktop:list-threads", () => listThreads());
  ipcMain.handle("desktop:list-agents", (_event, options) => listAgents(options && typeof options === "object" && (options as { refresh?: unknown }).refresh === true ? { refresh: true } : {}));
  ipcMain.handle("desktop:get-platform-agent-status", () => getPlatformAgentStatus());
  ipcMain.handle("desktop:set-default-agent", (_event, agentId) => setDefaultAgent(typeof agentId === "string" ? agentId : ""));
  ipcMain.handle("desktop:record-agent-usage", (_event, agentId) => recordAgentUsage(typeof agentId === "string" ? agentId : ""));
  ipcMain.handle("desktop:create-thread", (_event, request) => createThread(request));
  ipcMain.handle("desktop:update-thread", (_event, request) => updateThread(request));
  ipcMain.handle("desktop:delete-thread", (_event, threadId) => deleteThread(threadId));
  ipcMain.handle("desktop:set-thread-archived", (_event, request: { threadId: string; archived: boolean }) => updateThread({ id: request.threadId, archived: request.archived }));
  ipcMain.handle("desktop:get-thread-snapshot", async (_event, threadId) => {
    const remote = await remoteWorkspaceController.getThreadSnapshot(threadId);
    if (remote) return remote;
    const thread = (await listThreads()).find((item) => item.id === threadId);
    return (thread ? await getRuntimeThreadSnapshot(thread).catch(() => null) : null) || getThreadSnapshot(threadId);
  });
  ipcMain.handle("desktop:subscribe-thread-snapshot", (event, threadId) => macosThreadSnapshotController.subscribe(event.sender, threadId));
  ipcMain.handle("desktop:unsubscribe-thread-snapshot", (event, threadId) => macosThreadSnapshotController.unsubscribe(event.sender.id, threadId));
  ipcMain.handle("desktop:search-thread-messages", async (_event, request) => {
    const remote = await remoteWorkspaceController.searchThreadMessages(request);
    const local = await searchThreadMessages(request);
    return mergeSearchResults(remote, local, typeof request?.limit === "number" ? request.limit : 24);
  });
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
  ipcMain.handle("desktop:update-my-drsai-model-connection", (_event, request) => updateMyDrSaiModelConnection(request));
  ipcMain.handle("desktop:test-my-drsai-model-provider", (_event, provider, model) => testMyDrSaiModelProvider(provider, model));
  ipcMain.handle("desktop:test-my-drsai-model-draft", (_event, request, mode) => testMyDrSaiModelDraft(request, mode));
  ipcMain.handle("desktop:list-my-drsai-model-provider-presets", () => listMyDrSaiModelProviderPresets());
  ipcMain.handle("desktop:discover-my-drsai-provider-models", (_event, provider, refresh) => discoverMyDrSaiProviderModels(provider, refresh));
  ipcMain.handle("desktop:delete-my-drsai-model-provider", (_event, provider, deleteCredential) => deleteMyDrSaiModelProvider(provider, deleteCredential));
}

function mergeSearchResults<T extends { threadId: string; messageId: string; updatedAt: number }>(remote: T[], local: T[], rawLimit: number): T[] {
  const limit = Math.max(1, Math.min(100, Math.floor(rawLimit)));
  const unique = new Map<string, T>();
  for (const item of [...remote, ...local]) unique.set(`${item.threadId}:${item.messageId}`, item);
  return [...unique.values()].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, limit);
}
