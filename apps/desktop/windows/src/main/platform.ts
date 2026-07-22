import {
  assertDesktopPlatformDescriptor,
  type DesktopPlatformDescriptor,
} from "../../../shared/api/platform";

export const WINDOWS_PLATFORM_DESCRIPTOR: DesktopPlatformDescriptor = {
  id: "windows",
  defaultTerminalShell: "powershell",
  capabilities: {
    terminal: true,
    credentials: true,
    notifications: true,
    permissions: true,
    install: true,
    update: true,
  },
};

assertDesktopPlatformDescriptor(WINDOWS_PLATFORM_DESCRIPTOR);
