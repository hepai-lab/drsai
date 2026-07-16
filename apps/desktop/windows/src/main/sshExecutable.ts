import { existsSync } from "fs";
import { delimiter, join } from "path";

function findOnPath(command: string): string | null {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function configuredExecutable(): string | null {
  const value = process.env.OPENDRSAI_SSH_EXECUTABLE?.trim();
  if (!value) return null;
  if (value.length > 4096 || /[\r\n\0]/.test(value)) {
    throw new Error("SSH executable path is invalid.");
  }
  return value;
}

/**
 * Resolve the OpenSSH client shipped in the installed Runtime before falling
 * back to the operating system. A clean Windows Sandbox does not necessarily
 * include the optional Windows OpenSSH capability.
 */
export function resolveSshExecutable(): string {
  const configured = configuredExecutable();
  if (configured) return configured;
  return resolveOpenSshExecutable("ssh.exe");
}

export function resolveSshKeyscanExecutable(): string {
  return resolveOpenSshExecutable("ssh-keyscan.exe");
}

export function resolveScpExecutable(): string {
  return resolveOpenSshExecutable("scp.exe");
}

function resolveOpenSshExecutable(name: "ssh.exe" | "ssh-keyscan.exe" | "scp.exe"): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const bundled = resourcesPath ? join(resourcesPath, "tools", "openssh", name) : null;
  const candidates = [bundled, findOnPath(name), name].filter(Boolean) as string[];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[candidates.length - 1];
}
