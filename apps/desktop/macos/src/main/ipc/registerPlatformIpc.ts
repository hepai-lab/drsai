import { clipboard, shell, type IpcMain } from "electron";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertAllowedDesktopPath, assertAllowedExternalUrl } from "../../../../shared/main/desktopPathPolicy";
import { MACOS_PLATFORM_DESCRIPTOR } from "../platform";
import { MACOS_USER_DATA } from "../platformServices";
import { MACOS_PLATFORM_SERVICES } from "../platformServices";
import { resolveRegressionReference } from "../../../../shared/main/regressionReferences";
import { bootstrapDesktop, getHealth, getInstallStatus, installBundledRuntime } from "../desktopLifecycle";
import { cancelBundledRuntimeInstall } from "../runtimeInstaller";
import { cancelUpdate, checkForUpdates, downloadUpdate, installUpdate } from "../updater";
import { getMacosSystemPermissions, openMacosSystemPermissionSettings, requestMacosSystemPermission } from "../systemPermissions";

export interface MacosPlatformIpcOptions {
  ipcMain: Pick<IpcMain, "handle">;
  allowedDesktopRoots(): Promise<string[]>;
}

export function registerMacosPlatformIpc(options: MacosPlatformIpcOptions): void {
  const { ipcMain } = options;
  ipcMain.handle("desktop:platform-descriptor", () => MACOS_PLATFORM_DESCRIPTOR);
  ipcMain.handle("desktop:system-permissions-get", () => getMacosSystemPermissions());
  ipcMain.handle("desktop:system-permission-request", (_event, kind) => requestMacosSystemPermission(kind));
  ipcMain.handle("desktop:system-permission-settings", (_event, kind) => openMacosSystemPermissionSettings(kind));
  ipcMain.handle("desktop:bootstrap", () => bootstrapDesktop());
  ipcMain.handle("desktop:get-health", () => getHealth());
  ipcMain.handle("desktop:get-install-status", () => getInstallStatus());
  ipcMain.handle("desktop:start-install", (event) => installBundledRuntime((progress) => {
    if (!event.sender.isDestroyed()) event.sender.send("desktop:install-progress", progress);
  }));
  ipcMain.handle("desktop:cancel-install", () => cancelBundledRuntimeInstall());
  ipcMain.handle("desktop:check-for-updates", () => checkForUpdates());
  ipcMain.handle("desktop:download-update", () => downloadUpdate());
  ipcMain.handle("desktop:cancel-update", () => cancelUpdate());
  ipcMain.handle("desktop:install-update", () => installUpdate());
  ipcMain.handle("desktop:clipboard-copy-text", (_event, text) => {
    if (typeof text !== "string" || text.length > 50_000) return false;
    clipboard.writeText(text);
    return true;
  });
  ipcMain.handle("desktop:open-external", async (_event, url) => {
    await shell.openExternal(assertAllowedExternalUrl(url));
    return true;
  });
  ipcMain.handle("desktop:open-regression-reference", async (_event, uri) => {
    const path = resolveRegressionReference(MACOS_PLATFORM_SERVICES.paths.layout.home, uri);
    if (!path) return "Regression reference is unavailable or invalid.";
    return shell.openPath(path);
  });
  ipcMain.handle("desktop:open-path", async (_event, path) =>
    shell.openPath(assertAllowedDesktopPath(path, await options.allowedDesktopRoots())));
  ipcMain.handle("desktop:open-log-folder", async () => {
    const path = join(MACOS_USER_DATA, "logs");
    await mkdir(path, { recursive: true, mode: 0o700 });
    return shell.openPath(path);
  });
}
