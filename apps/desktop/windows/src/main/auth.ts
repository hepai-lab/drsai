/** @deprecated M3 compatibility entrypoint. Import from shared/main instead. */
import { shell } from "electron";
import { configureAuthPlatform } from "../../../shared/main/auth";
import { WINDOWS_CREDENTIAL_SERVICE } from "./platformCredentials";

configureAuthPlatform({
  credentials: WINDOWS_CREDENTIAL_SERVICE,
  openExternal: (url) => shell.openExternal(url),
});

export * from "../../../shared/main/auth";
