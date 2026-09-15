import { safeStorage } from "electron";
import type { DesktopCredentialService } from "../../../shared/api";

export const WINDOWS_CREDENTIAL_SERVICE: DesktopCredentialService = {
  available() {
    return safeStorage.isEncryptionAvailable();
  },
  protect(secret) {
    try {
      if (!this.available()) return undefined;
      return safeStorage.encryptString(secret).toString("base64");
    } catch {
      return undefined;
    }
  },
  unprotect(protectedSecret) {
    if (!protectedSecret) return undefined;
    try {
      if (!this.available()) return undefined;
      return safeStorage.decryptString(Buffer.from(protectedSecret, "base64"));
    } catch {
      return undefined;
    }
  },
};
