import type { DesktopPlatformServices } from "../../../shared/api";
import { WINDOWS_CREDENTIAL_SERVICE } from "./platformCredentials";
import { WINDOWS_NOTIFICATION_SERVICE } from "./platformNotifications";
import { WINDOWS_PROCESS_SERVICE } from "./platformProcesses";
import { WINDOWS_TERMINAL_SERVICE } from "./platformTerminals";
import { WINDOWS_PATH_SERVICE } from "./paths";

export const WINDOWS_PLATFORM_SERVICES: DesktopPlatformServices = {
  platform: "windows",
  paths: WINDOWS_PATH_SERVICE,
  terminal: WINDOWS_TERMINAL_SERVICE,
  credentials: WINDOWS_CREDENTIAL_SERVICE,
  notifications: WINDOWS_NOTIFICATION_SERVICE,
  processes: WINDOWS_PROCESS_SERVICE,
};
