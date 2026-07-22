import { app } from "electron";
import { homedir } from "node:os";
import type { DesktopPlatformServices } from "../../../shared/api";
import { createDesktopPathService } from "../../../shared/main/desktopPaths";
import { MACOS_CREDENTIAL_SERVICE } from "./platformCredentials";
import { MACOS_NOTIFICATION_SERVICE } from "./platformNotifications";
import { MACOS_PROCESS_SERVICE } from "./platformProcesses";
import { MACOS_TERMINAL_SERVICE } from "./platformTerminals";

export const MACOS_PLATFORM_SERVICES: DesktopPlatformServices = {
  platform: "macos",
  paths: createDesktopPathService({
    platform: "macos",
    userHome: homedir(),
    resourcesPath: process.resourcesPath,
    defaultApp: process.defaultApp,
    environment: process.env,
  }),
  terminal: MACOS_TERMINAL_SERVICE,
  credentials: MACOS_CREDENTIAL_SERVICE,
  notifications: MACOS_NOTIFICATION_SERVICE,
  processes: MACOS_PROCESS_SERVICE,
};

export const MACOS_USER_DATA = app.getPath("userData");
