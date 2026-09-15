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
      // V2 desktop_gateway only registers the "opendrsai" backend
      // (allowed_backends=("opendrsai",) in _state.py).  The codex adapter is
      // not registered, so the feature flag must be false to prevent the
      // renderer from querying a non-existent backend (404
      // agent_backend_not_found).
      codexBackend: false,
      duplexVoice: isDuplexVoiceEnabled(),
    },
  },
};

assertDesktopPlatformDescriptor(WINDOWS_PLATFORM_DESCRIPTOR);
