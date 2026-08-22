import { Notification, shell, systemPreferences } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DesktopSystemPermissionKind, DesktopSystemPermissionState, DesktopSystemPermissionStatus } from "../../../shared/api/desktopApi";
import { nativeHelperExecutablePath } from "./native/nativeHelperPath";
import { invokeNativePermission } from "./native/nativePermissionService";

const KINDS: DesktopSystemPermissionKind[] = ["microphone", "notifications", "files", "automation", "accessibility", "screen-recording"];
const SETTINGS: Record<DesktopSystemPermissionKind, string> = {
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  notifications: "x-apple.systempreferences:com.apple.preference.notifications",
  files: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
  automation: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  "screen-recording": "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
};
const execFileAsync = promisify(execFile);
let automationState: DesktopSystemPermissionState = "unknown";
let latestPermissionNotificationShown = false;

export function wasLatestPermissionNotificationShownForE2e(): boolean {
  return latestPermissionNotificationShown;
}

export function getMacosSystemPermissions(): DesktopSystemPermissionStatus[] {
  return KINDS.map(getMacosSystemPermission);
}

export function getMacosSystemPermission(kind: DesktopSystemPermissionKind): DesktopSystemPermissionStatus {
  const native = invokeNativePermission(nativeHelperExecutablePath(), "permission.status", kind);
  if (native && typeof native !== "boolean") return native;
  if (kind === "microphone") return status(kind, normalizeMediaStatus(systemPreferences.getMediaAccessStatus("microphone")), true);
  if (kind === "notifications") {
    return status(kind, "unknown", Notification.isSupported());
  }
  if (kind === "automation") return status(kind, automationState, true);
  return status(kind, "unknown", false);
}

export async function requestMacosSystemPermission(value: unknown): Promise<DesktopSystemPermissionStatus> {
  const kind = assertKind(value);
  const native = invokeNativePermission(nativeHelperExecutablePath(), "permission.request", kind);
  if (native && typeof native !== "boolean" && !(kind === "automation" && native.state === "unknown")) return native;
  if (kind === "microphone") await systemPreferences.askForMediaAccess("microphone");
  else if (kind === "notifications") {
    latestPermissionNotificationShown = false;
    if (Notification.isSupported()) {
      const notification = new Notification({ title: "OpenDrSai", body: "Notifications are enabled for task completion.", silent: true });
      const shown = new Promise((resolve) => notification.once("show", () => { latestPermissionNotificationShown = true; resolve(undefined); }));
      notification.show();
      await Promise.race([shown, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }
  } else if (kind === "automation") {
    try {
      await execFileAsync("/usr/bin/osascript", ["-e", "tell application \"Finder\" to get name of startup disk"], { timeout: 30_000 });
      automationState = "granted";
    } catch {
      automationState = "denied";
    }
  } else await openMacosSystemPermissionSettings(kind);
  // A fresh Helper process cannot reliably query the prior Apple Events result
  // when TCC or Finder did not answer before its bounded request timeout. Preserve
  // the explicit request outcome instead of replacing it with a later `unknown`.
  if (kind === "automation") return status(kind, automationState, automationState === "unknown");
  return getMacosSystemPermission(kind);
}

export async function openMacosSystemPermissionSettings(value: unknown): Promise<boolean> {
  const kind = assertKind(value);
  if (invokeNativePermission(nativeHelperExecutablePath(), "permission.open-settings", kind) === true) return true;
  await shell.openExternal(SETTINGS[kind]);
  return true;
}

function normalizeMediaStatus(value: string): DesktopSystemPermissionState {
  return value === "granted" || value === "denied" || value === "restricted" || value === "not-determined" ? value : "unknown";
}
function assertKind(value: unknown): DesktopSystemPermissionKind {
  if (value === "microphone" || value === "notifications" || value === "files" || value === "automation" || value === "accessibility" || value === "screen-recording") return value;
  throw new Error("Unsupported macOS permission kind.");
}
function status(kind: DesktopSystemPermissionKind, state: DesktopSystemPermissionState, canRequest: boolean): DesktopSystemPermissionStatus {
  const message = state === "granted" ? `${kind} access is granted.`
    : state === "denied" || state === "restricted" ? `${kind} access is blocked; open System Settings to change it.`
      : state === "not-determined" ? `${kind} access has not been requested.` : `${kind} access is controlled by macOS System Settings.`;
  return { kind, state, canRequest, canOpenSettings: true, message };
}
