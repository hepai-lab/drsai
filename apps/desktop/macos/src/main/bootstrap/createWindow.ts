import { BrowserWindow, shell, type RenderProcessGoneDetails, type WebContents } from "electron";
import { assertAllowedExternalUrl } from "../../../../shared/main/desktopPathPolicy";
import { isAllowedRendererNavigation } from "../rendererNavigationPolicy";

export interface MacosMainWindowOptions {
  preloadPath: string;
  rendererHtmlPath: string;
  rendererUrl?: string;
  onDidFinishLoad(window: BrowserWindow): () => void;
  onRendererGone(window: BrowserWindow, details: RenderProcessGoneDetails): void;
  onWebContentsDestroyed(window: BrowserWindow, webContents: WebContents, ownerId: number): void;
  onClosed(window: BrowserWindow): void;
}

export function createMacosMainWindow(options: MacosMainWindowOptions): BrowserWindow {
  let cancelUpdateHealthConfirmation: () => void = () => undefined;
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.once("did-finish-load", () => {
    cancelUpdateHealthConfirmation();
    cancelUpdateHealthConfirmation = options.onDidFinishLoad(window);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    cancelUpdateHealthConfirmation();
    options.onRendererGone(window, details);
  });

  let unresponsiveTimer: ReturnType<typeof setTimeout> | null = null;
  window.on("unresponsive", () => {
    cancelUpdateHealthConfirmation();
    if (unresponsiveTimer) return;
    unresponsiveTimer = setTimeout(() => {
      unresponsiveTimer = null;
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.reload();
    }, 15_000);
  });
  window.on("responsive", () => {
    if (unresponsiveTimer) clearTimeout(unresponsiveTimer);
    unresponsiveTimer = null;
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try { void shell.openExternal(assertAllowedExternalUrl(url)); } catch { /* Invalid popup URLs remain denied. */ }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedRendererNavigation(url, options.rendererHtmlPath, options.rendererUrl)) event.preventDefault();
  });

  const webContents = window.webContents;
  const ownerId = webContents.id;
  webContents.once("destroyed", () => {
    cancelUpdateHealthConfirmation();
    options.onWebContentsDestroyed(window, webContents, ownerId);
  });
  window.once("closed", () => options.onClosed(window));

  if (options.rendererUrl) void window.loadURL(options.rendererUrl);
  else void window.loadFile(options.rendererHtmlPath);
  return window;
}
