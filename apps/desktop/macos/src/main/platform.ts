import { assertDesktopPlatformDescriptor, type DesktopPlatformDescriptor } from "../../../shared/api";

export const MACOS_PLATFORM_DESCRIPTOR: DesktopPlatformDescriptor = {
  id: "macos",
  defaultTerminalShell: "zsh",
  capabilities: {
    terminal: true,
    credentials: true,
    notifications: true,
    permissions: true,
    install: true,
    update: true,
  },
};

assertDesktopPlatformDescriptor(MACOS_PLATFORM_DESCRIPTOR);
