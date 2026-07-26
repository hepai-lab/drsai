import { randomUUID } from "node:crypto";
import type { IpcMain } from "electron";
import type { MacosServiceContainer } from "../serviceContainer";

export type MacosConnectionsIpcServices = Pick<MacosServiceContainer, "workspace" | "approvals">;

async function proposeChannelOutboundDraft(request: any, services: MacosConnectionsIpcServices) {
  try {
    const { createChannelOutboundDraftApproval, executeChannelOutboundDeliveryAsync } = await import("../../../../shared/main/channelAdapters");
    if (!request || typeof request !== "object") throw new Error("Channel outbound draft request must be an object.");
    if (request.workspacePath !== undefined) await services.workspace.assertPath(request.workspacePath);
    let delivery: Awaited<ReturnType<typeof executeChannelOutboundDeliveryAsync>> | undefined;
    const approvalRequest = createChannelOutboundDraftApproval(request);
    const proposal = await services.approvals.propose(approvalRequest, async (approval) => {
      delivery = await executeChannelOutboundDeliveryAsync(request, approval.id, true);
      return delivery.status === "sent" || delivery.status === "blocked";
    });
    if (!proposal.queued && !proposal.alreadyExecuted && proposal.allowed && !proposal.blocked && !delivery) {
      delivery = await executeChannelOutboundDeliveryAsync(request, `connector:approved:${randomUUID()}`, true);
    }
    return { queued: proposal.queued, ...(proposal.approval ? { approval: proposal.approval } : {}), ...(delivery ? { delivery } : {}), allowed: proposal.allowed, blocked: proposal.blocked, reason: proposal.reason, verification: "Outbound channel drafts remain approval-gated; delivery is written only to an explicitly configured Workspace-local outbox." };
  } catch (error) {
    return { queued: false, allowed: false, blocked: true, reason: error instanceof Error ? error.message : String(error), verification: "No connector proposal was queued or delivered." };
  }
}

/** Registers external connector IPC while keeping provider modules lazy-loaded. */
export function registerMacosConnectionsIpc(
  ipcMain: Pick<IpcMain, "handle">,
  services: MacosConnectionsIpcServices,
): void {
  const requireWorkspace = async (request: { workspacePath?: unknown } | undefined) => services.workspace.assertPath(request?.workspacePath);
  const optionalWorkspace = async (path: unknown) => { if (path !== undefined) await services.workspace.assertPath(path); };

  ipcMain.handle("desktop:channel-adapters-list", async (_event, workspacePath) => { await optionalWorkspace(workspacePath); return (await import("../../../../shared/main/channelAdapters")).listChannelAdapters(workspacePath); });
  ipcMain.handle("desktop:channel-adapter-configure", async (_event, request) => { await requireWorkspace(request); return (await import("../../../../shared/main/channelAdapters")).configureChannelAdapter(request); });
  ipcMain.handle("desktop:channel-adapter-auth-start", async (_event, request) => { await requireWorkspace(request); return (await import("../../../../shared/main/channelAdapters")).startChannelAdapterAuth(request); });
  ipcMain.handle("desktop:channel-adapter-auth-poll", async (_event, request) => { await requireWorkspace(request); return (await import("../../../../shared/main/channelAdapters")).pollChannelAdapterAuth(request); });
  ipcMain.handle("desktop:channel-adapter-auth-revoke", async (_event, request) => { await requireWorkspace(request); return (await import("../../../../shared/main/channelAdapters")).revokeChannelAdapterAuth(request); });
  ipcMain.handle("desktop:channel-provider-token-configure", async (_event, request) => { await requireWorkspace(request); return (await import("../../../../shared/main/channelAdapters")).configureChannelProviderToken(request); });
  ipcMain.handle("desktop:channel-context-import", async (_event, request) => { await requireWorkspace(request); return (await import("../../../../shared/main/channelAdapters")).importChannelContext(request); });
  ipcMain.handle("desktop:channel-live-sync", async (_event, request) => { await requireWorkspace(request); return (await import("../../../../shared/main/channelAdapters")).syncLiveChannelContext(request); });
  ipcMain.handle("desktop:channel-snapshot-sync", async (_event, request) => { await requireWorkspace(request); return (await import("../../../../shared/main/channelAdapters")).syncChannelSnapshots(request); });
  ipcMain.handle("desktop:channel-inbound-events", async (_event, request) => { await optionalWorkspace(request?.workspacePath); return (await import("../../../../shared/main/channelAdapters")).listChannelInboundEvents(request); });
  ipcMain.handle("desktop:channel-inbound-route", async (_event, request) => { await optionalWorkspace(request?.workspacePath); return (await import("../../../../shared/main/channelAdapters")).routeChannelInboundEvent(request); });
  ipcMain.handle("desktop:channel-outbound-draft", (_event, request) => proposeChannelOutboundDraft(request, services));
  ipcMain.handle("desktop:channel-outbound-deliveries", async (_event, request) => { await optionalWorkspace(request?.workspacePath); return (await import("../../../../shared/main/channelAdapters")).listChannelOutboundDeliveries(request); });
  ipcMain.handle("desktop:external-connection-readiness", async (_event, workspacePath) => { await optionalWorkspace(workspacePath); return (await import("../../../../shared/main/externalConnectionReadiness")).listExternalConnectionReadiness(workspacePath); });
}
