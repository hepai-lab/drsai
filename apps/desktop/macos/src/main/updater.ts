import { app } from "electron";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { CancellationToken } from "builder-util-runtime";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import type { UpdateStatus } from "../../../shared/api/desktopApi";

let cancellationToken: CancellationToken | null = null;
let status: UpdateStatus = idleStatus();
let healthConfirmation: { confirmed: boolean; version: string | null; confirmedAt: string | null } = { confirmed: false, version: null, confirmedAt: null };
const execFileAsync = promisify(execFile);

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowDowngrade = false;
configureSignedUpdateLabFeed();
autoUpdater.on("checking-for-update", () => patch({ phase: "checking", checking: true, error: null, errorCode: null }));
autoUpdater.on("update-available", (info) => patchAvailable(info));
autoUpdater.on("update-not-available", () => { status = idleStatus(); });
autoUpdater.on("download-progress", (progress) => patch({ phase: "downloading", downloading: true, progress: progress.percent }));
autoUpdater.on("update-downloaded", (info) => patch({ phase: "ready", downloading: false, downloaded: true, progress: 100, version: info.version, canInstall: true, canCancel: false }));
autoUpdater.on("error", (error) => patch({ phase: "failed", checking: false, downloading: false, canCancel: false, errorCode: "macos-update-failed", error: redact(error.message) }));

export function getUpdateStatus(): UpdateStatus {
  return { ...status };
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    patch({ phase: "failed", errorCode: "development-build", error: "Update checks require a packaged macOS build." });
    return getUpdateStatus();
  }
  await autoUpdater.checkForUpdates();
  return getUpdateStatus();
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!status.available || status.downloading) return getUpdateStatus();
  cancellationToken = new CancellationToken();
  patch({ phase: "downloading", downloading: true, canDownload: false, canCancel: true, error: null, errorCode: null });
  try {
    await autoUpdater.downloadUpdate(cancellationToken);
  } catch (error) {
    if (cancellationToken.cancelled) {
      patch({ phase: "available", downloading: false, progress: null, canDownload: true, canCancel: false });
    } else {
      patch({ phase: "failed", downloading: false, canCancel: false, errorCode: "macos-update-download-failed", error: redact(error instanceof Error ? error.message : String(error)) });
    }
  } finally {
    cancellationToken = null;
  }
  return getUpdateStatus();
}

export function cancelUpdate(): UpdateStatus {
  cancellationToken?.cancel();
  return getUpdateStatus();
}

export async function installUpdate(): Promise<UpdateStatus> {
  if (!status.downloaded) return getUpdateStatus();
  const version = status.version;
  if (!version) return getUpdateStatus();
  await prepareRollback(version);
  patch({ phase: "installing", canInstall: false });
  const labDelay = process.env.OPENDRSAI_MACOS_SIGNED_UPDATE_LAB === "1" ? 1_000 : 0;
  setTimeout(() => autoUpdater.quitAndInstall(false, true), labDelay);
  return getUpdateStatus();
}

export async function markUpdateHealthy(): Promise<void> {
  const healthFile = updateHealthFile();
  await mkdir(dirname(healthFile), { recursive: true });
  await writeFile(healthFile, JSON.stringify({ version: app.getVersion(), healthyAt: new Date().toISOString() }), "utf8");
  healthConfirmation = { confirmed: true, version: app.getVersion(), confirmedAt: new Date().toISOString() };
}

export function getUpdateHealthConfirmation(): { confirmed: boolean; version: string | null; confirmedAt: string | null } {
  return { ...healthConfirmation };
}

export function scheduleUpdateHealthConfirmation(): () => void {
  healthConfirmation = { confirmed: false, version: null, confirmedAt: null };
  const acceptance = Boolean(process.env.OPENDRSAI_MACOS_PACKAGED_SCENARIO);
  const configured = Number(process.env.OPENDRSAI_UPDATE_HEALTH_DELAY_MS || "30000");
  const minimum = acceptance ? 1_000 : 30_000;
  const delayMs = Math.max(minimum, Math.min(300_000, Number.isFinite(configured) ? configured : 30_000));
  let active = true;
  const timer = setTimeout(() => {
    if (!active) return;
    void markUpdateHealthy();
  }, delayMs);
  return () => {
    active = false;
    clearTimeout(timer);
  };
}

async function prepareRollback(expectedVersion: string): Promise<void> {
  const executable = app.getPath("exe");
  const currentApp = resolve(executable, "../../..");
  const rollbackRoot = join(app.getPath("userData"), "update-rollback");
  const backupApp = join(rollbackRoot, "OpenDrSai.app");
  const healthFile = updateHealthFile();
  const watchdog = join(process.resourcesPath, "update", "update-watchdog.sh");
  await mkdir(rollbackRoot, { recursive: true });
  await rm(backupApp, { recursive: true, force: true });
  await rm(healthFile, { force: true });
  await execFileAsync("/usr/bin/ditto", [currentApp, backupApp], { timeout: 120_000 });
  const helper = spawn("/bin/sh", [watchdog, String(process.pid), currentApp, backupApp, healthFile, expectedVersion], { detached: true, stdio: "ignore" });
  helper.unref();
}

function updateHealthFile(): string {
  return join(app.getPath("userData"), "update-health.json");
}

function patchAvailable(info: UpdateInfo): void {
  patch({ phase: "available", checking: false, available: true, version: info.version, releaseNotesUrl: typeof info.releaseNotes === "string" ? info.releaseNotes : null, canDownload: true, canCancel: false });
}

function patch(value: Partial<UpdateStatus>): void {
  status = { ...status, ...value };
}

function idleStatus(): UpdateStatus {
  return {
    phase: "idle", checking: false, available: false, downloading: false, downloaded: false,
    progress: null, version: null, currentVersion: app.getVersion(), mandatory: false,
    releaseNotesUrl: null, canDownload: false, canInstall: false, canCancel: false,
    errorCode: null, error: null, recovery: null,
  };
}

function redact(message: string): string {
  return message.replace(/((?:token|password|secret|authorization))=?[^\s,;]+/gi, "$1=[redacted]").slice(0, 500);
}

function configureSignedUpdateLabFeed(): void {
  if (process.env.OPENDRSAI_MACOS_SIGNED_UPDATE_LAB !== "1" || process.env.OPENDRSAI_MACOS_PACKAGED_SCENARIO !== "online-update-lab") return;
  const raw = process.env.OPENDRSAI_MACOS_UPDATE_FEED_URL?.trim();
  const expectedHost = process.env.OPENDRSAI_MACOS_UPDATE_FEED_HOST?.trim();
  if (!raw || !expectedHost) throw new Error("Signed update lab requires an explicit HTTPS feed and expected host.");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== expectedHost || url.username || url.password) throw new Error("Signed update lab feed is not an approved HTTPS origin.");
  autoUpdater.setFeedURL({ provider: "generic", url: url.toString() });
}
