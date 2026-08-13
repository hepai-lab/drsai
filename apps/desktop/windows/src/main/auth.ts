/** @deprecated M3 compatibility entrypoint. Import from shared/main instead. */
import { shell } from "electron";
import { configureAuthPlatform } from "../../../shared/main/auth";
import { WINDOWS_CREDENTIAL_SERVICE } from "./platformCredentials";
import { openExternalUrlWithBrowserFallback } from "./windowsExternalUrl";

configureAuthPlatform({
  credentials: WINDOWS_CREDENTIAL_SERVICE,
  openExternal: (url) => openExternalUrlWithBrowserFallback(url, (target) => shell.openExternal(target)),
});

export * from "../../../shared/main/auth";
