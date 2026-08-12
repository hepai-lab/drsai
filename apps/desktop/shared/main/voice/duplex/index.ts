/**
 * Reserved public boundary for the duplex voice route.
 *
 * Duplex state, arbitration, echo handling and session ownership must be
 * implemented here rather than added to the streaming route.
 */
export const DUPLEX_VOICE_ROUTE_IMPLEMENTED = true as const;

export const DUPLEX_VOICE_FEATURE_FLAG = "OPENDRSAI_ENABLE_DUPLEX_VOICE" as const;

export function isDuplexVoiceEnabled(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return environment[DUPLEX_VOICE_FEATURE_FLAG]?.trim() === "1";
}

export type {
  DesktopDuplexVoiceAudioChunk,
  DesktopDuplexVoiceCapabilities,
  DesktopDuplexVoiceError,
  DesktopDuplexVoiceEvent,
  DesktopDuplexVoiceSessionStartRequest,
  DesktopDuplexVoiceSessionStartResult,
} from "../../../api/desktopApi";
