import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { DesktopCredentialService } from "../../../shared/api";

const SERVICE = "ai.drsai.desktop";
type SecurityRunner = (command: string, args: string[]) => { status: number | null; stdout?: string };

export function createMacosCredentialService(
  run: SecurityRunner = (command, args) => spawnSync(command, args, { encoding: "utf8", windowsHide: true }),
  platform = process.platform,
): DesktopCredentialService {
  return {
    available: () => platform === "darwin",
    protect(secret) {
      if (!this.available() || typeof secret !== "string" || !secret || secret.length > 64 * 1024) return undefined;
      const account = randomUUID();
      const result = run("/usr/bin/security", ["add-generic-password", "-U", "-a", account, "-s", SERVICE, "-w", secret]);
      return result.status === 0 ? `keychain:${account}` : undefined;
    },
    unprotect(reference) {
      const account = parseReference(reference);
      if (!account || !this.available()) return undefined;
      const result = run("/usr/bin/security", ["find-generic-password", "-a", account, "-s", SERVICE, "-w"]);
      return result.status === 0 && typeof result.stdout === "string" ? result.stdout.trim() : undefined;
    },
    remove(reference) {
      const account = parseReference(reference);
      if (!account || !this.available()) return false;
      return run("/usr/bin/security", ["delete-generic-password", "-a", account, "-s", SERVICE]).status === 0;
    },
  };
}

function parseReference(reference: string | undefined): string | null {
  if (!reference?.startsWith("keychain:")) return null;
  const account = reference.slice("keychain:".length);
  return /^[0-9a-f-]{36}$/.test(account) ? account : null;
}

export const MACOS_CREDENTIAL_SERVICE = createMacosCredentialService();
