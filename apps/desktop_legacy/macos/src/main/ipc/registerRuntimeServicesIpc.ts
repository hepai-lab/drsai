import { app, BrowserWindow, session as electronSession, shell, type IpcMain } from "electron";
import { hasActiveAgentRuns } from "../../../../shared/main/agentRuns";
import { getA5ServiceGuidanceScenario } from "../../../../shared/main/a5ServiceGuidanceScenario";
import {
  cancelOidcLogin,
  getAuthSession,
  login,
  logout,
  refreshAuthSession,
  startOidcLogin,
} from "../../../../shared/main/auth";
import type { BrowserTaskService } from "../../../../shared/main/browser/browserTaskService";
import { hasActiveChats } from "../../../../shared/main/chat";
import { presentCodexBackendStatus } from "../../../../shared/main/codexBackendStatus";
import { clearLocalData, previewLocalDataCleanup } from "../../../../shared/main/dataCleanup";
import { assertAllowedExternalUrl } from "../../../../shared/main/desktopPathPolicy";
import { desktopDiagnostics } from "../../../../shared/main/diagnostics";
import { listProviderErrorAnalytics } from "../../../../shared/main/providerErrorAnalytics";
import { listProviderUsageAnalytics } from "../../../../shared/main/providerUsageAnalytics";
import { remoteWorkspaceController } from "../../../../shared/main/remoteWorkspaceController";
import { LocalRuntimeClient } from "../../../../shared/main/runtimeClient";
import { saveApiKeyAndSync } from "../../../../shared/main/settings";
import { getGatewayStatus, startGateway, stopGateway } from "../gateway";
import type { MacosServiceContainer } from "../serviceContainer";

export interface MacosRuntimeServicesIpcDependencies {
  browserTaskService: BrowserTaskService;
}

export function registerMacosRuntimeServicesIpc(
  ipcMain: Pick<IpcMain, "handle">,
  services: Pick<MacosServiceContainer, "workspace">,
  dependencies: MacosRuntimeServicesIpcDependencies,
): void {
  const browser = dependencies.browserTaskService;
  ipcMain.handle("desktop:get-auth-session", () => getAuthSession());
  ipcMain.handle("desktop:restart-application", () => {
    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, 100).unref();
    return true;
  });
  ipcMain.handle("desktop:e2e-a5-service-guidance-scenario", () => getA5ServiceGuidanceScenario());
  ipcMain.handle("desktop:login", (_event, request) => login(request));
  ipcMain.handle("desktop:start-oidc-login", async (event, request) => {
    const result = await startOidcLogin(
      request,
      (debugEvent) => event.sender.send("desktop:oidc-login-debug", debugEvent),
    );
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
    return result;
  });
  ipcMain.handle("desktop:cancel-oidc-login", () => cancelOidcLogin());
  ipcMain.handle("desktop:refresh-auth-session", () => refreshAuthSession());
  ipcMain.handle("desktop:logout", (_event, options) => logout(options));
  ipcMain.handle("desktop:local-data-cleanup-preview", (_event, scope) => previewLocalDataCleanup(scope));
  ipcMain.handle("desktop:local-data-cleanup", async (_event, request) => {
    if (hasActiveChats() || hasActiveAgentRuns()) throw new Error("Stop active tasks before clearing local data.");
    await stopGateway(); const result = await clearLocalData(request);
    if (result.scope === "all_local_data") { await desktopDiagnostics.clear(); await logout({ clearLocalData: true }); await electronSession.defaultSession.clearCache(); await electronSession.defaultSession.clearStorageData(); }
    return result;
  });
  ipcMain.handle("desktop:browser-check-url", (_event, url) => browser.checkUrl(url));
  ipcMain.handle("desktop:browser-action-request", (_event, request) => browser.requestAction(request));
  ipcMain.handle("desktop:browser-task-start", async (_event, request) => { if (request?.workspacePath) await services.workspace.assertPath(request.workspacePath); return browser.start(request); });
  ipcMain.handle("desktop:browser-task-stop", (_event, request) => browser.stop(request));
  ipcMain.handle("desktop:browser-task-pending-approvals", () => browser.pendingApprovals());
  ipcMain.handle("desktop:browser-task-approve", (_event, request) => browser.approve(request));
  ipcMain.handle("desktop:get-codex-backend-status", async (_event, refresh) => { const client = await LocalRuntimeClient.connect(); let capability = (await client.getCapabilities()).agent_backends?.codex; if (capability?.available) { await client.getBackendModels("codex", refresh === true); capability = (await client.getCapabilities()).agent_backends?.codex; } return !capability?.available ? presentCodexBackendStatus(capability) : presentCodexBackendStatus(capability, await client.getBackendAccount("codex", refresh === true)); });
  ipcMain.handle("desktop:start-codex-backend-login", async (_event, rawType) => { const type = rawType === "chatgptDeviceCode" ? "chatgptDeviceCode" : "chatgpt"; const result = await (await LocalRuntimeClient.connect()).startBackendLogin("codex", type); const externalUrl = result.authUrl ?? result.verificationUrl; if (externalUrl) await shell.openExternal(assertAllowedExternalUrl(externalUrl)); return { type: result.type, loginId: result.loginId, verificationUrl: result.verificationUrl, userCode: result.userCode }; });
  ipcMain.handle("desktop:cancel-codex-backend-login", async (_event, loginId) => { if (typeof loginId !== "string" || !loginId.trim()) return false; await (await LocalRuntimeClient.connect()).cancelBackendLogin("codex", loginId.trim()); return true; });
  ipcMain.handle("desktop:logout-codex-backend", async () => { await (await LocalRuntimeClient.connect()).logoutBackend("codex"); return true; });
  ipcMain.handle("desktop:get-gateway-status", () => getGatewayStatus());
  ipcMain.handle("desktop:start-gateway", () => startGateway());
  ipcMain.handle("desktop:stop-gateway", () => stopGateway());
  ipcMain.handle("desktop:provider-usage-analytics-list", () => listProviderUsageAnalytics());
  ipcMain.handle("desktop:provider-error-analytics-list", () => listProviderErrorAnalytics());
  ipcMain.handle("desktop:remote-ssh-diagnostics", () => remoteWorkspaceController.diagnostics());
  ipcMain.handle("desktop:save-api-key", (_event, apiKey: string) => app.isPackaged ? { ok: false, message: "This build receives service authorization through HepAI OIDC." } : saveApiKeyAndSync(apiKey));
}
