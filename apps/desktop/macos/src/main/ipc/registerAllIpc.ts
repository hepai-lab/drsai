import type { IpcMain } from "electron";
import type { MacosServiceContainer } from "../serviceContainer";
import { registerMacosAutomationIpc } from "./registerAutomationIpc";
import { registerMacosCatalogIpc } from "./registerCatalogIpc";
import { registerMacosConnectionsIpc } from "./registerConnectionsIpc";
import { registerMacosCodexSessionsIpc } from "./registerCodexSessionsIpc";
import { registerMacosCustomizationIpc } from "./registerCustomizationIpc";
import { registerMacosDiagnosticsIpc } from "./registerDiagnosticsIpc";
import { registerMacosExecutionIpc } from "./registerExecutionIpc";
import { registerMacosGatewayResourcesIpc } from "./registerGatewayResourcesIpc";
import { registerMacosPlatformIpc } from "./registerPlatformIpc";
import { registerMacosPresentationIpc } from "./registerPresentationIpc";
import { registerMacosRemoteAccessIpc } from "./registerRemoteAccessIpc";
import { registerMacosRuntimeServicesIpc } from "./registerRuntimeServicesIpc";
import { registerMacosRunInspectionIpc } from "./registerRunInspectionIpc";
import { registerMacosSharingIpc } from "./registerSharingIpc";
import { registerMacosTerminalIpc } from "./registerTerminalIpc";
import { registerMacosTrustIpc } from "./registerTrustIpc";
import { registerMacosVoiceIpc } from "./registerVoiceIpc";
import { registerMacosWorkspaceHistoryIpc } from "./registerWorkspaceHistoryIpc";
import { registerMacosWorkspaceIpc } from "./registerWorkspaceIpc";

export interface MacosDesktopIpcDependencies {
  ipcMain: Pick<IpcMain, "handle">;
  rawIpcMain: IpcMain;
  services: MacosServiceContainer;
  allowedDesktopRoots: Parameters<typeof registerMacosPlatformIpc>[0]["allowedDesktopRoots"];
  diagnostics: Parameters<typeof registerMacosDiagnosticsIpc>[2];
  trust: Parameters<typeof registerMacosTrustIpc>[2];
  voice: Parameters<typeof registerMacosVoiceIpc>[2];
  runtimeServices: Parameters<typeof registerMacosRuntimeServicesIpc>[2];
  catalog: Parameters<typeof registerMacosCatalogIpc>[2];
}

export function registerMacosDesktopIpc(dependencies: MacosDesktopIpcDependencies): void {
  const { ipcMain, rawIpcMain, services } = dependencies;
  registerMacosPlatformIpc({ ipcMain, allowedDesktopRoots: dependencies.allowedDesktopRoots });
  registerMacosDiagnosticsIpc(ipcMain, services, dependencies.diagnostics);
  registerMacosTrustIpc(ipcMain, services, dependencies.trust);
  registerMacosTerminalIpc(ipcMain, services);
  registerMacosVoiceIpc(ipcMain, rawIpcMain, dependencies.voice);
  registerMacosRuntimeServicesIpc(ipcMain, services, dependencies.runtimeServices);
  registerMacosRunInspectionIpc(ipcMain);
  registerMacosCatalogIpc(ipcMain, services, dependencies.catalog);
  registerMacosPresentationIpc(ipcMain, services);
  registerMacosExecutionIpc(ipcMain, services);
  registerMacosGatewayResourcesIpc(ipcMain);
  registerMacosCustomizationIpc(ipcMain, services);
  registerMacosAutomationIpc(ipcMain, services);
  registerMacosConnectionsIpc(ipcMain, services);
  registerMacosCodexSessionsIpc(ipcMain);
  registerMacosWorkspaceIpc(ipcMain, services);
  registerMacosWorkspaceHistoryIpc(ipcMain, services);
  registerMacosRemoteAccessIpc(ipcMain, services);
  registerMacosSharingIpc(ipcMain);
}
