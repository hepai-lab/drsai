import { app, type WebContents } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateStatus } from "../shared/desktopApi";

let updateStatus: UpdateStatus = {
  checking: false,
  available: false,
  downloading: false,
  downloaded: false,
  progress: null,
  version: null,
  error: null,
};

let listenersRegistered = false;
const subscribers = new Set<WebContents>();

export function getUpdateStatus(): UpdateStatus {
  return updateStatus;
}

export function subscribeUpdateStatus(webContents: WebContents): void {
  subscribers.add(webContents);
  webContents.once("destroyed", () => {
    subscribers.delete(webContents);
  });
  emitStatus();
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    setStatus({
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      progress: null,
      version: null,
      error: "Updates are only checked in packaged builds.",
    });
    return updateStatus;
  }

  registerUpdateListeners();
  setStatus({ ...updateStatus, checking: true, error: null });

  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo) {
      setStatus({
        checking: false,
        available: false,
        downloading: false,
        downloaded: false,
        progress: null,
        version: null,
        error: null,
      });
    }
  } catch (error) {
    setStatus({
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      progress: null,
      version: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return updateStatus;
}

function registerUpdateListeners(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;
  autoUpdater.autoDownload = false;

  autoUpdater.on("checking-for-update", () => {
    setStatus({ ...updateStatus, checking: true, error: null });
  });
  autoUpdater.on("update-available", (info) => {
    setStatus({
      checking: false,
      available: true,
      downloading: false,
      downloaded: false,
      progress: null,
      version: info.version ?? null,
      error: null,
    });
  });
  autoUpdater.on("update-not-available", () => {
    setStatus({
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      progress: null,
      version: null,
      error: null,
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    setStatus({
      ...updateStatus,
      checking: false,
      downloading: true,
      downloaded: false,
      progress: Math.max(0, Math.min(100, progress.percent ?? 0)),
      error: null,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    setStatus({
      ...updateStatus,
      checking: false,
      available: true,
      downloading: false,
      downloaded: true,
      progress: 100,
      version: info.version ?? updateStatus.version,
      error: null,
    });
  });
  autoUpdater.on("error", (error) => {
    setStatus({
      checking: false,
      available: updateStatus.available,
      downloading: false,
      downloaded: false,
      progress: updateStatus.progress,
      version: null,
      error: error.message,
    });
  });
}

function setStatus(status: UpdateStatus): void {
  updateStatus = status;
  emitStatus();
}

function emitStatus(): void {
  for (const webContents of subscribers) {
    if (!webContents.isDestroyed()) {
      webContents.send("desktop:update-status", updateStatus);
    }
  }
}
