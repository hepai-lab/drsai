import { app, dialog, shell } from "electron";
import { join } from "node:path";
import type { DesktopPlatformServices } from "../../../../shared/api";
import { configureAuthPlatform } from "../../../../shared/main/auth";
import { configureChatRemoteRouting } from "../../../../shared/main/chat";
import { configureRuntimeWorkspaceRouting } from "../../../../shared/main/runtimeClient";
import { configureWorkspaceFileDialogs } from "../../../../shared/main/workspaceFileMutations";
import { configureMacosRemoteTerminalResolver } from "../terminal";

interface RemoteWorkspaceBindings {
  getAccess(workspacePath?: string, workspaceId?: string): { baseUrl: string; token: string; workspaceId: string } | null;
  resolveTarget(workspacePath?: string, workspaceId?: string): Promise<"remote_online" | "remote_offline" | "local_or_unknown">;
  bindThread(threadId: string, workspaceId: string, runtimeSessionId?: string): void;
}

export interface MacosPlatformBindingDependencies {
  platformServices: DesktopPlatformServices;
  remoteWorkspaces: RemoteWorkspaceBindings;
  findWorkspaceById: typeof import("../../../../shared/main/workspaces").findWorkspaceById;
  remoteTerminalCommand: Parameters<typeof configureMacosRemoteTerminalResolver>[0];
}

export async function configureMacosPlatformBindings(dependencies: MacosPlatformBindingDependencies): Promise<void> {
  configureMacosRemoteTerminalResolver(dependencies.remoteTerminalCommand);
  configureAuthPlatform({ credentials: dependencies.platformServices.credentials, openExternal: (url) => shell.openExternal(url) });
  configureRuntimeWorkspaceRouting({
    getRemoteGatewayAccess: (workspacePath, workspaceId) => dependencies.remoteWorkspaces.getAccess(workspacePath, workspaceId) ?? undefined,
    findWorkspaceById: dependencies.findWorkspaceById,
    bindRemoteThread: (threadId, workspaceId, runtimeSessionId) => dependencies.remoteWorkspaces.bindThread(threadId, workspaceId, runtimeSessionId),
  });
  const { configureChannelProviderAuth } = await import("../../../../shared/main/channelAdapters");
  configureChannelProviderAuth({ credentials: dependencies.platformServices.credentials });
  configureChatRemoteRouting({
    resolveTarget: (workspacePath, workspaceId) => dependencies.remoteWorkspaces.resolveTarget(workspacePath, workspaceId),
    getGatewayAccess: (workspacePath, workspaceId) => dependencies.remoteWorkspaces.getAccess(workspacePath, workspaceId),
    bindThread: (threadId, workspaceId, runtimeSessionId) => dependencies.remoteWorkspaces.bindThread(threadId, workspaceId, runtimeSessionId),
  });
  configureWorkspaceFileDialogs({
    selectSavePath: async ({ title, suggestedName, extension }) => {
      const result = await dialog.showSaveDialog({
        title,
        defaultPath: join(app.getPath("downloads"), suggestedName),
        ...(extension ? { filters: [{ name: `${extension.slice(1).toUpperCase()} file`, extensions: [extension.slice(1)] }] } : {}),
      });
      return result.canceled ? null : result.filePath || null;
    },
  });
}
