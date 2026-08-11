import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { isIP } from "node:net";
import { requireAuthContext, refreshAuthContextAfterUnauthorized } from "../../../../shared/main/auth";
import { classifyMobileRemoteDiagnostics } from "../../../../shared/main/mobileRemoteDiagnostics";
import type { IpcMain } from "electron";
import { portForwardRegistry } from "../../../../shared/main/portForwards";
import { remoteGatewayInstaller, validateRemoteGatewayInstallRequest } from "../../../../shared/main/remoteGatewayInstaller";
import { remoteWorkspaceController } from "../../../../shared/main/remoteWorkspaceController";
import { sshHostService } from "../../../../shared/main/sshHosts";
import { findWorkspaceById } from "../../../../shared/main/workspaces";
import { LocalRuntimeClient } from "../../../../shared/main/runtimeClient";
import type { MacosServiceContainer } from "../serviceContainer";

export type MacosRemoteAccessIpcServices = Pick<MacosServiceContainer, "approvals">;

/** Registers SSH, Remote Gateway, Remote Workspace and Port Forward operations. */
export function registerMacosRemoteAccessIpc(
  ipcMain: Pick<IpcMain, "handle">,
  services: MacosRemoteAccessIpcServices,
): void {
  ipcMain.handle("desktop:ssh-hosts", () => sshHostService.listHosts());
  ipcMain.handle("desktop:ssh-diagnose", (_event, hostAlias) => sshHostService.diagnose(hostAlias));
  ipcMain.handle("desktop:ssh-host-keys", (_event, hostAlias) => sshHostService.inspectHostKeys(hostAlias));
  ipcMain.handle("desktop:ssh-test", (_event, hostAlias) => sshHostService.test(hostAlias));
  ipcMain.handle("desktop:ssh-approve-host-key", (_event, hostAlias) => sshHostService.approveHostKey(hostAlias));
  ipcMain.handle("desktop:ssh-host-connect", async (_event, hostAlias) => ({ hostAlias, action: "connect", changed: await sshHostService.connect(hostAlias) }));
  ipcMain.handle("desktop:ssh-host-disconnect", async (_event, hostAlias) => { await portForwardRegistry.suspendHost(hostAlias); return { hostAlias, action: "disconnect", changed: sshHostService.disconnect(hostAlias) }; });
  ipcMain.handle("desktop:ssh-host-reconnect", async (_event, hostAlias) => { const changed = await sshHostService.reconnect(hostAlias); await portForwardRegistry.resumeHost(hostAlias); return { hostAlias, action: "reconnect", changed }; });
  ipcMain.handle("desktop:ssh-host-remove", async (_event, hostAlias) => {
    if ((await portForwardRegistry.list({ hostAlias })).length) throw new Error("Remove or pause this host's Port Forwards before deleting the SSH profile.");
    return { hostAlias, action: "remove", changed: await sshHostService.remove(hostAlias) };
  });
  ipcMain.handle("desktop:remote-gateway-preflight", (_event, hostAlias) => remoteGatewayInstaller.preflight(hostAlias));
  ipcMain.handle("desktop:remote-gateway-install", () => { throw new Error("Remote Gateway installation requires Approval Center authorization."); });
  ipcMain.handle("desktop:remote-gateway-install-approval", async (_event, request) => {
    const normalized = validateRemoteGatewayInstallRequest(request);
    const stable = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    return services.approvals.propose({ source: "connector", actionKind: "external.service", title: `Remote Gateway ${normalized.action}`, detail: `Approve a verified, cancellable Remote Gateway transaction.\nHost: ${normalized.hostAlias}\nVersion: ${normalized.version ?? "rollback"}`, target: normalized.hostAlias, risk: "high", idempotencyKey: `remote-gateway:${stable}` }, async () => { await remoteGatewayInstaller.install(normalized); return true; });
  });
  ipcMain.handle("desktop:remote-gateway-cancel", (_event, hostAlias) => remoteGatewayInstaller.cancel(hostAlias));
  ipcMain.handle("desktop:remote-workspace-connect", (_event, request) => remoteWorkspaceController.connect(request));
  ipcMain.handle("desktop:remote-workspace-disconnect", (_event, workspaceId) => remoteWorkspaceController.disconnect(workspaceId));
  ipcMain.handle("desktop:remote-workspace-status", (_event, workspaceId) => remoteWorkspaceController.status(workspaceId));
  ipcMain.handle("desktop:remote-workspace-threads", (_event, workspaceId) => remoteWorkspaceController.listThreads(workspaceId));
  ipcMain.handle("desktop:remote-hepai-workers", (_event, workspaceId) => remoteWorkspaceController.listWorkers(workspaceId));
  ipcMain.handle("desktop:remote-hepai-worker-state", (_event, workspaceId, workerId, enabled) => remoteWorkspaceController.setWorkerState(workspaceId, workerId, enabled));
  ipcMain.handle("desktop:ssh-directories", (_event, hostAlias, path) => remoteWorkspaceController.listDirectories(hostAlias, path));
  ipcMain.handle("desktop:port-forward-list", (_event, filter) => portForwardRegistry.list(filter));
  ipcMain.handle("desktop:port-forward-create", async (_event, request) => {
    const workspaceId = request && typeof request === "object" ? (request as { workspaceId?: unknown }).workspaceId : undefined;
    if (typeof workspaceId !== "string") throw new Error("Port Forward owner Workspace is invalid.");
    const workspace = await findWorkspaceById(workspaceId);
    const hostAlias = request && typeof request === "object" ? (request as { hostAlias?: unknown }).hostAlias : undefined;
    if (!workspace?.remote || workspace.remote.hostAlias !== hostAlias) throw new Error("Port Forward must belong to a matching remote Workspace.");
    return portForwardRegistry.create(request);
  });
  ipcMain.handle("desktop:port-forward-pause", (_event, id) => portForwardRegistry.pause(id));
  ipcMain.handle("desktop:port-forward-resume", (_event, id) => portForwardRegistry.resume(id));
  ipcMain.handle("desktop:port-forward-remove", (_event, id) => portForwardRegistry.remove(id));
  ipcMain.handle("desktop:mobile-remote-diagnose", async () => {
    try {
      const runtime = await (await LocalRuntimeClient.connect()).getMobileRemoteDiagnostics();
      const auth = await requireAuthContext().catch(() => null);
      return classifyMobileRemoteDiagnostics({ ...runtime.checks, oidc: auth?.authMode === "oidc" && auth.accessToken ? "ok" : "failed" });
    } catch {
      return classifyMobileRemoteDiagnostics({ runtime: "failed", relay: "unknown", oidc: "unknown", wss: "unknown", heartbeat: "unknown", protocol: "unknown" });
    }
  });
  ipcMain.handle("desktop:mobile-runtime-rename", async (_event, displayName) => {
    const safeName = typeof displayName === "string" ? displayName.trim().replace(/\s+/g, " ") : "";
    if (!safeName || safeName.length > 64 || /[\\/\0]/.test(safeName) || safeName.includes("://") || isAbsolute(safeName) || isIP(safeName.replace(/^\[|\]$/g, "")) !== 0) throw new Error("runtime_display_name_invalid");
    const readiness = await (await LocalRuntimeClient.connect()).getMobilePairingReadiness();
    if (!readiness.runtime_id) throw new Error("mobile_pairing_runtime_not_registered");
    let auth = await requireAuthContext();
    const relayUrl = trustedRelayUrl(auth.issuer, readiness.runtime_id);
    const send = (token: string) => fetch(relayUrl, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ display_name: safeName }), redirect: "error" });
    if (auth.authMode !== "oidc" || !auth.accessToken) throw new Error("mobile_pairing_oidc_login_required");
    let response = await send(auth.accessToken);
    if (response.status === 401) { auth = await refreshAuthContextAfterUnauthorized(); if (auth.authMode !== "oidc" || !auth.accessToken) throw new Error("mobile_pairing_oidc_login_required"); response = await send(auth.accessToken); }
    if (!response.ok) throw new Error(`mobile_runtime_rename_failed:${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    if (body.runtime_id !== readiness.runtime_id || body.display_name !== safeName) throw new Error("mobile_runtime_rename_response_invalid");
    return { runtime_id: readiness.runtime_id, display_name: safeName };
  });
}

function trustedRelayUrl(issuer: string | undefined, runtimeId: string): string {
  const configured = process.env.OPENDRSAI_RUNTIME_RELAY_BASE_URL?.trim().replace(/\/+$/, "");
  const origin = issuer ? new URL(issuer).origin : (process.env.OPENDRSAI_DESKTOP_DEV === "1" ? "https://ai-dev.ihep.ac.cn" : "https://ai.ihep.ac.cn");
  const base = new URL(configured || `${origin}/api/runtime-relay`);
  if (base.protocol !== "https:" || base.port || !["ai.ihep.ac.cn", "ai-dev.ihep.ac.cn"].includes(base.hostname) || base.pathname.replace(/\/+$/, "") !== "/api/runtime-relay" || base.username || base.password || base.search || base.hash) throw new Error("mobile_pairing_relay_url_not_trusted");
  return `${base.origin}/api/runtime-relay/v1/runtimes/${encodeURIComponent(runtimeId)}`;
}
