import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { DesktopSystemPermissionKind, DesktopSystemPermissionStatus } from "../../../../shared/api/desktopApi";
import { encodeNativeHelperRequest, parseNativeHelperResponse } from "./nativeProtocol";

export function invokeNativePermission(helper: string, operation: "permission.status" | "permission.request" | "permission.open-settings", kind: DesktopSystemPermissionKind): DesktopSystemPermissionStatus | boolean | null {
  if (!existsSync(helper)) return null;
  const requestId = randomUUID();
  const parameters: Record<string, string> = operation === "permission.request" ? { kind, userInitiated: "true" } : { kind };
  const child = spawnSync(helper, [], { input: `${encodeNativeHelperRequest(requestId, operation, parameters)}${encodeNativeHelperRequest(randomUUID(), "shutdown")}`, encoding: "utf8", timeout: 35_000, maxBuffer: 256 * 1024, shell: false, env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" } });
  if (child.error || child.status !== 0 || !child.stdout) return null;
  try {
    const response = parseNativeHelperResponse(child.stdout.split("\n").find(Boolean) || ""); if (response.requestId !== requestId || response.status !== "ok") return null;
    if (operation === "permission.open-settings") return response.result?.opened === true;
    const state = response.result?.state; if (state !== "granted" && state !== "denied" && state !== "restricted" && state !== "not-determined" && state !== "unknown") return null;
    return { kind, state, canRequest: response.result?.canRequest === true, canOpenSettings: response.result?.canOpenSettings === true, source: "native-helper", message: message(kind, state) };
  } catch { return null; }
}
function message(kind: DesktopSystemPermissionKind, state: DesktopSystemPermissionStatus["state"]): string { return state === "granted" ? `${kind} access is granted.` : state === "denied" || state === "restricted" ? `${kind} access is blocked; open System Settings to change it.` : state === "not-determined" ? `${kind} access has not been requested.` : `${kind} access is controlled by macOS System Settings.`; }
