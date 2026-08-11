import type { IpcMain, WebContents } from "electron";
import { getAgentCatalogSnapshot, getPlatformAgentStatus, listAgents, recordAgentUsage, setDefaultAgent } from "../../../../shared/main/agents";
import type { MobilePairingController } from "../../../../shared/main/mobilePairingController";
import { deleteMyDrSaiModelProvider, discoverMyDrSaiProviderModels, getMyDrSaiAgentModelPolicy, getMyDrSaiConfig, listMyDrSaiModelProviderPresets, migrateMyDrSaiAgentModelPolicy, preflightMyDrSaiModelProviderDeletion, testMyDrSaiModelDraft, testMyDrSaiModelProvider, updateMyDrSaiAgentModelPolicy, updateMyDrSaiConfig, updateMyDrSaiModelConnection } from "../../../../shared/main/myDrSaiConfig";
import { createThread, deleteThread, getThreadSnapshot, listThreads, searchThreadMessages, updateThread, updateThreadSnapshot } from "../../../../shared/main/threads";
import { getRuntimeThreadSnapshot, getRuntimeThreadSnapshotEnvelope } from "../../../../shared/main/threadRuntimeSubscription";
import { createWorkspace, deleteWorkspace, listWorkspaces, updateWorkspace } from "../../../../shared/main/workspaces";
import { remoteWorkspaceController } from "../../../../shared/main/remoteWorkspaceController";
import type { MacosServiceContainer } from "../serviceContainer";
import { macosThreadSnapshotController } from "../threadSnapshotController";

const threadSnapshotHydrations = new Map<string, AbortController>();

export interface MacosCatalogIpcDependencies {
  mobilePairingControllerFor(sender: WebContents): MobilePairingController;
}

export function registerMacosCatalogIpc(
  ipcMain: Pick<IpcMain, "handle">,
  services: Pick<MacosServiceContainer, "workspace">,
  dependencies: MacosCatalogIpcDependencies,
): void {
  ipcMain.handle("desktop:mobile-pairing-readiness", (event) => dependencies.mobilePairingControllerFor(event.sender).readiness());
  ipcMain.handle("desktop:mobile-remote-enable", (event) => dependencies.mobilePairingControllerFor(event.sender).enable());
  ipcMain.handle("desktop:mobile-remote-pause", (event) => dependencies.mobilePairingControllerFor(event.sender).pauseAccess());
  ipcMain.handle("desktop:mobile-remote-resume", (event) => dependencies.mobilePairingControllerFor(event.sender).resumeAccess());
  ipcMain.handle("desktop:mobile-pairing-create", (event, scope) => dependencies.mobilePairingControllerFor(event.sender).create(scope));
  ipcMain.handle("desktop:mobile-pairing-read", (event, grantId: string) => dependencies.mobilePairingControllerFor(event.sender).read(grantId));
  ipcMain.handle("desktop:mobile-pairing-revoke", (event, grantId: string) => dependencies.mobilePairingControllerFor(event.sender).revoke(grantId));
  ipcMain.handle("desktop:mobile-associations-list", (event) => dependencies.mobilePairingControllerFor(event.sender).associations());
  ipcMain.handle("desktop:mobile-association-revoke", (event, associationId: string) => dependencies.mobilePairingControllerFor(event.sender).revokeAssociation(associationId));
  ipcMain.handle("desktop:mobile-association-shrink", (
    event,
    associationId: string,
    permissions: Array<"read" | "send" | "approve" | "files">,
  ) => dependencies.mobilePairingControllerFor(event.sender).shrinkAssociation(associationId, permissions));
  ipcMain.handle("desktop:mobile-enrollment-revoke", (event) => dependencies.mobilePairingControllerFor(event.sender).revokeEnrollment());
  ipcMain.handle("desktop:list-threads", () => listThreads());
  ipcMain.handle("desktop:list-agents", (_event, options) => listAgents(options && typeof options === "object" ? {
    ...((options as { refresh?: unknown }).refresh === true ? { refresh: true } : {}),
    ...((options as { preferCache?: unknown }).preferCache === true ? { preferCache: true } : {}),
  } : {}));
  ipcMain.handle("desktop:get-agent-catalog-snapshot", (_event, options) => getAgentCatalogSnapshot(options && typeof options === "object" ? {
    ...((options as { refresh?: unknown }).refresh === true ? { refresh: true } : {}),
    ...((options as { preferCache?: unknown }).preferCache === true ? { preferCache: true } : {}),
  } : {}));
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
  ipcMain.handle("desktop:get-thread-snapshot-envelope", async (_event, threadId, requestId?: string, options?: { forceFresh?: boolean; minimumSequence?: number; expectedGeneration?: number; historyCursor?: string }) => {
    if (typeof threadId !== "string" || (requestId !== undefined && (typeof requestId !== "string" || requestId.length > 160))) {
      throw new Error("Thread hydration request is invalid.");
    }
    if (options && (typeof options !== "object"
      || (options.forceFresh !== undefined && typeof options.forceFresh !== "boolean")
      || (options.historyCursor !== undefined && (typeof options.historyCursor !== "string" || options.historyCursor.length > 4096))
      || [options.minimumSequence, options.expectedGeneration].some((value) => value !== undefined && (!Number.isSafeInteger(value) || Number(value) < 0)))) {
      throw new Error("Thread hydration waterline is invalid.");
    }
    const controller = new AbortController();
    if (requestId) {
      threadSnapshotHydrations.get(requestId)?.abort(new DOMException("Superseded hydration.", "AbortError"));
      threadSnapshotHydrations.set(requestId, controller);
    }
    try {
    const thread = (await listThreads()).find((item) => item.id === threadId);
    if (thread?.runtimeSessionId) {
      const envelope = await getRuntimeThreadSnapshotEnvelope(thread, controller.signal, options);
      if (envelope) return envelope;
    }
    controller.signal.throwIfAborted();
    const remote = await remoteWorkspaceController.getThreadSnapshot(threadId);
    const snapshot = remote ?? await getThreadSnapshot(threadId);
    if (!snapshot) return null;
    return { version: 1, projection: "conversation/1", threadId,
      runtimeSessionId: thread?.runtimeSessionId ?? `persisted:${threadId}`,
      sessionSequence: 0, generation: 0, source: "persisted", snapshot };
    } finally {
      if (requestId && threadSnapshotHydrations.get(requestId) === controller) threadSnapshotHydrations.delete(requestId);
    }
  });
  ipcMain.handle("desktop:cancel-thread-snapshot-hydration", (_event, requestId: string) => {
    if (typeof requestId !== "string" || requestId.length > 160) return false;
    const controller = threadSnapshotHydrations.get(requestId);
    if (!controller) return false;
    threadSnapshotHydrations.delete(requestId);
    controller.abort(new DOMException("Hydration cancelled.", "AbortError"));
    return true;
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
  ipcMain.handle("desktop:preflight-my-drsai-model-provider-deletion", (_event, provider) => preflightMyDrSaiModelProviderDeletion(provider));
  ipcMain.handle("desktop:get-my-drsai-agent-model-policy", (_event, agentId) => getMyDrSaiAgentModelPolicy(agentId));
  ipcMain.handle("desktop:update-my-drsai-agent-model-policy", (_event, agentId, policy) => updateMyDrSaiAgentModelPolicy(agentId, policy));
  ipcMain.handle("desktop:migrate-my-drsai-agent-model-policy", (_event, agentId, legacyModel, expectedRevision) => migrateMyDrSaiAgentModelPolicy(agentId, legacyModel, expectedRevision));
  ipcMain.handle("desktop:delete-my-drsai-model-provider", (_event, provider, deleteCredential) => deleteMyDrSaiModelProvider(provider, deleteCredential));
}

function mergeSearchResults<T extends { threadId: string; messageId: string; updatedAt: number }>(remote: T[], local: T[], rawLimit: number): T[] {
  const limit = Math.max(1, Math.min(100, Math.floor(rawLimit)));
  const unique = new Map<string, T>();
  for (const item of [...remote, ...local]) unique.set(`${item.threadId}:${item.messageId}`, item);
  return [...unique.values()].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, limit);
}
