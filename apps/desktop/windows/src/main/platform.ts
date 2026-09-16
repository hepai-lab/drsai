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
      // V2 desktop_gateway routes/audio.py registers transcription only
      // (POST /v1/audio/transcriptions); there is no POST /v1/audio/speech, so
      // provider-backed speech synthesis fails with 404.  Keep the capability
      // false and let the renderer disable the online reading paths instead of
      // failing at request time.  Windows system speech stays available.
      remoteSpeechSynthesis: false,
      // Android remote access is served by the Runtime's /v1/mobile-pairing
      // management routes (status, enrollment, associations, diagnostics).
      // The V2 desktop_gateway registers none of them, so every device-list
      // refresh and the enable/pause switch would fail with 404.  Keep the
      // capability false and let the renderer mark the Android card as
      // unavailable instead of failing at request time.
      mobilePairing: false,
    },
  },
};

assertDesktopPlatformDescriptor(WINDOWS_PLATFORM_DESCRIPTOR);
