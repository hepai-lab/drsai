import { existsSync, realpathSync } from "fs";
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { isAbsolute, join, relative, resolve } from "path";
import { is } from "@electron-toolkit/utils";
import { cancelInstall, startInstall } from "./install";
import { getGatewayStatus, shutdownGateway, startGateway, stopGateway } from "./gateway";
import { getDesktopHealth, getInstallStatus } from "./status";
import { DRSAI_HOME } from "./paths";
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  subscribeUpdateStatus,
} from "./updates";
import { abortChat, startChat } from "./chat";
import { abortAgentRun, startAgentRun } from "./agentRuns";
import { createThread, listThreads, updateThread } from "./threads";
import { saveApiKey } from "./settings";
import {
  cancelDesktopSsoLogin,
  getAuthSession,
  login,
  logout,
  pollDesktopSsoLogin,
  refreshAuthSession,
  startDesktopSsoLogin,
  startWechatDesktopLogin,
} from "./auth";
import { maybeRunE2eSmoke } from "./e2eSmoke";

let mainWindow: BrowserWindow | null = null;

const rendererHtmlPath = join(__dirname, "../renderer/index.html");
const TRUSTED_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function createWindow(): void {
  const windowIcon = getWindowIconPath();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    title: "OpenDrSai",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#fafafe",
      symbolColor: "#5f5870",
      height: 34,
    },
    backgroundColor: "#fafafe",
    show: false,
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  maybeRunE2eSmoke(mainWindow);

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    if (!isAllowedDevRendererUrl(process.env.ELECTRON_RENDERER_URL)) {
      throw new Error("ELECTRON_RENDERER_URL must point at localhost in development.");
    }
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(rendererHtmlPath);
  }
}

function getWindowIconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "icon.png")]
    : [
        join(__dirname, "../../build/icon.png"),
        join(process.cwd(), "build", "icon.png"),
      ];

  return candidates.find((candidate) => existsSync(candidate));
}

function isAllowedExternalUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== "string") return false;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isAllowedDevRendererUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "http:" &&
      TRUSTED_DEV_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  const frameUrl = event.senderFrame?.url;
  if (!frameUrl) return false;
  if (frameUrl === mainWindow.webContents.getURL()) return true;
  if (is.dev) return isAllowedDevRendererUrl(frameUrl);
  return false;
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedSender(event)) {
    throw new Error("Blocked untrusted desktop IPC caller.");
  }
}

function secureHandle<T extends unknown[]>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: T) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args: T) => {
    assertTrustedSender(event);
    return handler(event, ...args);
  });
}

function isAllowedLocalPath(rawPath: unknown): boolean {
  if (typeof rawPath !== "string" || !rawPath) return false;
  if (!existsSync(rawPath)) return false;
  const root = realpathSync.native(resolve(DRSAI_HOME));
  const target = realpathSync.native(resolve(rawPath));
  const localRelative = relative(root, target);
  return (
    localRelative === "" ||
    (!localRelative.startsWith("..") && !isAbsolute(localRelative))
  );
}

function registerIpc(): void {
  secureHandle("desktop:get-auth-session", () => getAuthSession());
  secureHandle("desktop:login", (_event, request) => login(request));
  secureHandle("desktop:start-desktop-sso-login", () => startDesktopSsoLogin());
  secureHandle("desktop:start-wechat-desktop-login", () => startWechatDesktopLogin());
  secureHandle("desktop:poll-desktop-sso-login", (_event, deviceCode: string) =>
    pollDesktopSsoLogin(deviceCode),
  );
  secureHandle("desktop:cancel-desktop-sso-login", (_event, deviceCode: string) =>
    cancelDesktopSsoLogin(deviceCode),
  );
  secureHandle("desktop:logout", (_event, options) => {
    stopGateway();
    return logout(options);
  });
  secureHandle("desktop:refresh-auth-session", () => refreshAuthSession());
  secureHandle("desktop:get-health", () => getDesktopHealth());
  secureHandle("desktop:get-install-status", () => getInstallStatus());
  secureHandle("desktop:get-gateway-status", () => getGatewayStatus());
  secureHandle("desktop:check-for-updates", (event) => {
    subscribeUpdateStatus(event.sender);
    return checkForUpdates();
  });
  secureHandle("desktop:download-update", (event) => {
    subscribeUpdateStatus(event.sender);
    return downloadUpdate();
  });
  secureHandle("desktop:install-update", () => installUpdate());

  secureHandle("desktop:open-external", async (_event, rawUrl: string) => {
    if (!isAllowedExternalUrl(rawUrl)) return;
    await shell.openExternal(rawUrl);
  });

  secureHandle("desktop:open-path", async (_event, rawPath: string) => {
    if (!isAllowedLocalPath(rawPath)) {
      return "Path is outside DrSai home.";
    }
    return shell.openPath(rawPath);
  });

  secureHandle("desktop:start-install", async (event, options) => {
    await startInstall(event.sender, options ?? {});
  });
  secureHandle("desktop:cancel-install", () => cancelInstall());

  secureHandle("desktop:start-gateway", () => startGateway());
  secureHandle("desktop:stop-gateway", () => stopGateway());
  secureHandle("desktop:list-threads", () => listThreads());
  secureHandle("desktop:create-thread", (_event, request) => createThread(request));
  secureHandle("desktop:update-thread", (_event, request) => updateThread(request));
  secureHandle("desktop:start-chat", (event, request) =>
    startChat(event.sender, request),
  );
  secureHandle("desktop:abort-chat", (_event, requestId: string) =>
    abortChat(requestId),
  );
  secureHandle("desktop:start-agent-run", (event, request) =>
    startAgentRun(event.sender, request),
  );
  secureHandle("desktop:abort-agent-run", (_event, requestId: string) =>
    abortAgentRun(requestId),
  );
  secureHandle("desktop:save-api-key", (_event, apiKey: string) =>
    saveApiKey(apiKey),
  );
  secureHandle("desktop:pick-files", async () => {
    if (!mainWindow) return { canceled: true, paths: [] };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Add files",
      properties: ["openFile", "multiSelections"],
    });
    return { canceled: result.canceled, paths: result.filePaths };
  });
  secureHandle("desktop:pick-folder", async () => {
    if (!mainWindow) return { canceled: true, paths: [] };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Add folder",
      properties: ["openDirectory"],
    });
    return { canceled: result.canceled, paths: result.filePaths };
  });
}

async function autoStartGatewayWhenInstalled(): Promise<void> {
  try {
    const install = await getInstallStatus();
    if (!install.installed) return;
    await startGateway();
  } catch (error) {
    console.warn(
      "[desktop] Gateway autostart skipped:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  void autoStartGatewayWhenInstalled();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      void autoStartGatewayWhenInstalled();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  shutdownGateway();
});
