import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { DesktopCredentialService } from "../../../shared/api";

const SERVICE = "ai.drsai.desktop";

export const MACOS_CREDENTIAL_SERVICE: DesktopCredentialService = {
  available() {
    return process.platform === "darwin";
  },
  protect(secret) {
    if (!this.available()) return undefined;
    const account = randomUUID();
    const result = spawnSync("/usr/bin/security", ["add-generic-password", "-U", "-a", account, "-s", SERVICE, "-w", secret], {
      encoding: "utf8",
      windowsHide: true,
    });
    return result.status === 0 ? `keychain:${account}` : undefined;
  },
  unprotect(reference) {
    if (!reference?.startsWith("keychain:") || !this.available()) return undefined;
    const account = reference.slice("keychain:".length);
    const result = spawnSync("/usr/bin/security", ["find-generic-password", "-a", account, "-s", SERVICE, "-w"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return result.status === 0 ? result.stdout.trim() : undefined;
  },
};
