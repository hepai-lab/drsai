import { app, Menu, nativeImage, Tray, type BrowserWindow, type NativeImage } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCompletionNotificationPreference } from "../../../shared/main/completionNotifications";

export interface SystemTrayHandlers {
  /** Bring the main window back on screen (restoring it when minimized). */
  showMainWindow: () => void;
  /** Terminate the application through the normal quit lifecycle. */
  quitApp: () => void;
}

let tray: Tray | null = null;
let unreadCount = 0;
let plainTrayIcon: NativeImage | null = null;

function resolveTrayIconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "icon.png")]
    : [
        join(__dirname, "../../build/icon.png"),
        join(process.cwd(), "build", "icon.png"),
      ];

  return candidates.find((candidate) => existsSync(candidate));
}

/**
 * Compose the base icon with a red unread-count bubble. The Windows tray has
 * no native badge API, so the bubble is rasterized into the icon itself via
 * an SVG overlay; the same image doubles as the taskbar overlay icon
 * (``BrowserWindow.setOverlayIcon``), which is the Windows-native badge
 * surface.
 */
function buildBadgedIcon(count: number): NativeImage | null {
  const iconPath = resolveTrayIconPath();
  if (!iconPath) return null;
  let base64: string;
  try {
    base64 = readFileSync(iconPath).toString("base64");
  } catch {
    return null;
  }
  const label = count > 99 ? "99+" : String(count);
  const wide = label.length > 1;
  const badgeWidth = wide ? 14 : 11;
  const fontSize = wide ? 7.5 : 8.5;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">`
    + `<image href="data:image/png;base64,${base64}" width="32" height="32"/>`
    + `<rect x="${32 - badgeWidth - 1}" y="0" width="${badgeWidth}" height="11" rx="5.5" fill="#e53935"/>`
    + `<text x="${32 - badgeWidth / 2 - 1}" y="8.5" font-family="Segoe UI, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff" text-anchor="middle">${label}</text>`
    + `</svg>`;
  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`,
  );
  return icon.isEmpty() ? null : icon;
}

function trayLabels(): { tooltip: string; showMainWindow: string; quit: string; unreadSuffix: string } {
  const zh = getCompletionNotificationPreference().language !== "en";
  return {
    tooltip: "OpenDrSai",
    showMainWindow: zh ? "显示主窗口" : "Show Main Window",
    quit: zh ? "退出" : "Quit",
    unreadSuffix: zh ? `（${unreadCount} 条未读）` : ` (${unreadCount} unread)`,
  };
}

function badgeAccessibilityLabel(): string {
  const zh = getCompletionNotificationPreference().language !== "en";
  return zh ? `${unreadCount} 条未读通知` : `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`;
}

function refreshTray(window?: BrowserWindow | null): void {
  const badged = unreadCount > 0 ? buildBadgedIcon(unreadCount) : null;
  const icon = badged ?? plainTrayIcon;
  if (tray && !tray.isDestroyed()) {
    if (icon && !icon.isEmpty()) tray.setImage(icon);
    const labels = trayLabels();
    tray.setToolTip(unreadCount > 0 ? `${labels.tooltip}${labels.unreadSuffix}` : labels.tooltip);
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: labels.showMainWindow,
        click: () => {
          trayHandlers?.showMainWindow();
          clearUnreadTrayBadge();
        },
      },
      { type: "separator" },
      { label: labels.quit, click: () => trayHandlers?.quitApp() },
    ]));
  }
  // Taskbar badge bubble (Windows). Falls back to nothing on platforms
  // without overlay support.
  if (window && !window.isDestroyed()) {
    window.setOverlayIcon(unreadCount > 0 ? badged : null, unreadCount > 0 ? badgeAccessibilityLabel() : "");
  }
}

let trayHandlers: SystemTrayHandlers | null = null;
let lastWindow: BrowserWindow | null = null;

/**
 * Create the system tray icon. Follows the same icon resolution strategy as
 * the main window (packaged builds ship icon.png via extraResources next to
 * process.resourcesPath; source development loads it from windows/build).
 */
export function createSystemTray(handlers: SystemTrayHandlers): void {
  if (tray && !tray.isDestroyed()) return;
  const iconPath = resolveTrayIconPath();
  if (!iconPath) {
    console.warn("[desktop] Tray icon not found; skipping system tray creation.");
    return;
  }
  trayHandlers = handlers;
  const icon = nativeImage.createFromPath(iconPath);
  plainTrayIcon = icon.isEmpty() ? null : icon;
  tray = new Tray(plainTrayIcon ?? iconPath);
  tray.on("click", () => {
    trayHandlers?.showMainWindow();
    clearUnreadTrayBadge();
  });
  refreshTray();
}

export function destroySystemTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
  trayHandlers = null;
  plainTrayIcon = null;
}

export function getUnreadTrayBadgeCount(): number {
  return unreadCount;
}

/**
 * Record one unread background completion. Shows a numbered badge bubble on
 * the tray icon and taskbar overlay; when the main window is not focused
 * Windows also flashes its taskbar button until the user returns.
 */
export function incrementUnreadTrayBadge(window?: BrowserWindow | null): void {
  unreadCount += 1;
  if (window && !window.isDestroyed()) lastWindow = window;
  refreshTray(lastWindow);
  if (lastWindow && !lastWindow.isDestroyed() && !lastWindow.isFocused()) {
    lastWindow.flashFrame(true);
  }
}

/** Clear the unread counter, remove the badge bubbles and stop the flash. */
export function clearUnreadTrayBadge(window?: BrowserWindow | null): void {
  unreadCount = 0;
  if (window && !window.isDestroyed()) lastWindow = window;
  refreshTray(lastWindow);
  if (lastWindow && !lastWindow.isDestroyed()) {
    lastWindow.flashFrame(false);
  }
}
