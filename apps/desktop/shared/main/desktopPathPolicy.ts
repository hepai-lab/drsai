import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { DesktopIpcBoundaryError } from "./secureIpc";

function boundaryError(code: string, message: string): DesktopIpcBoundaryError {
  return new DesktopIpcBoundaryError(code, message);
}

export function assertAllowedExternalUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== "string" || rawUrl.length > 2_048) {
    throw boundaryError("IPC_URL_INVALID", "External URL is invalid.");
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw boundaryError("IPC_URL_INVALID", "External URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw boundaryError("IPC_URL_NOT_ALLOWED", "External URL is not allowed.");
  }
  return url.toString();
}

export function assertAllowedDesktopPath(
  rawPath: unknown,
  allowedRoots: readonly string[],
  options: { directory?: boolean } = {},
): string {
  if (typeof rawPath !== "string" || !rawPath.trim() || rawPath.length > 32_768 || !isAbsolute(rawPath)) {
    throw boundaryError("IPC_PATH_INVALID", "Desktop path is invalid.");
  }
  let target: string;
  try {
    target = realpathSync(resolve(rawPath));
  } catch {
    throw boundaryError("IPC_PATH_NOT_FOUND", "Desktop path does not exist.");
  }
  const allowed = allowedRoots.some((root) => {
    try {
      const canonicalRoot = realpathSync(resolve(root));
      const child = relative(canonicalRoot, target);
      return child === "" || (!child.startsWith("..") && !isAbsolute(child));
    } catch {
      return false;
    }
  });
  if (!allowed) throw boundaryError("IPC_PATH_OUTSIDE_ALLOWED_ROOTS", "Desktop path is outside allowed roots.");
  if (options.directory && !statSync(target).isDirectory()) {
    throw boundaryError("IPC_PATH_NOT_DIRECTORY", "Desktop path is not a directory.");
  }
  return target;
}
