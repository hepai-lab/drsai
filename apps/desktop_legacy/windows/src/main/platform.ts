import {
  assertDesktopPlatformDescriptor,
  FULL_DESKTOP_FEATURE_CAPABILITIES,
  type DesktopPlatformDescriptor,
} from "../../../shared/api/platform";
import { isDuplexVoiceEnabled } from "../../../shared/main/voice/duplex";

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
    features: {
      ...FULL_DESKTOP_FEATURE_CAPABILITIES,
      duplexVoice: isDuplexVoiceEnabled(),
    },
  },
};

assertDesktopPlatformDescriptor(WINDOWS_PLATFORM_DESCRIPTOR);
