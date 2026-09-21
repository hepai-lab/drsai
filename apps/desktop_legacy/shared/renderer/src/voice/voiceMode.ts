import type { DesktopDuplexVoiceCapabilities, DesktopVoiceInteractionMode, DesktopVoiceRuntimeStatus } from "@shared/desktopApi";
import type { VoiceTurnPhase } from "./voiceTurnReducer";

export interface VoiceModeCapabilities {
  audioWorklet: boolean;
  serialStt: boolean;
  serialTts: boolean;
  duplex: boolean;
}

export interface VoiceModeAvailability {
  available: boolean;
  reason: string | null;
}

export const DEFAULT_VOICE_MODE: DesktopVoiceInteractionMode = "serial";

export function normalizeVoiceInteractionMode(value: unknown): DesktopVoiceInteractionMode {
  return value === "duplex" ? value : DEFAULT_VOICE_MODE;
}

export function deriveVoiceModeCapabilities(
  runtime: DesktopVoiceRuntimeStatus | null,
  options: {
    audioWorklet?: boolean;
    serialTts?: boolean;
    duplexCapabilities?: DesktopDuplexVoiceCapabilities | null;
    duplexEnabled?: boolean;
  } = {},
): VoiceModeCapabilities {
  const runtimeReady = runtime?.state === "ready" || runtime?.state === "degraded";
  return {
    audioWorklet: options.audioWorklet === true,
    serialStt: Boolean(runtimeReady),
    serialTts: options.serialTts !== false,
    duplex: Boolean(options.duplexEnabled && options.audioWorklet && options.duplexCapabilities),
  };
}

export function getVoiceModeAvailability(
  mode: DesktopVoiceInteractionMode,
  capabilities: VoiceModeCapabilities,
): VoiceModeAvailability {
  if (mode === "serial") {
    return capabilities.serialStt && capabilities.serialTts
      ? { available: true, reason: null }
      : { available: false, reason: "Serial voice requires transcription and speech playback." };
  }
  if (mode === "duplex") {
    if (!capabilities.audioWorklet) return { available: false, reason: "Realtime voice requires AudioWorklet support." };
    return capabilities.duplex
      ? { available: true, reason: null }
      : { available: false, reason: "Realtime voice is disabled or no compatible realtime model is configured." };
  }
  return { available: false, reason: "Unsupported voice mode." };
}

export function canSwitchVoiceMode(phase: VoiceTurnPhase): boolean {
  return phase === "idle" || phase === "completed" || phase === "failed";
}

export function resolveVoiceModeSelection(
  requested: DesktopVoiceInteractionMode,
  current: DesktopVoiceInteractionMode,
  phase: VoiceTurnPhase,
  capabilities: VoiceModeCapabilities,
): { accepted: boolean; mode: DesktopVoiceInteractionMode; reason: string | null } {
  if (requested === current) return { accepted: true, mode: current, reason: null };
  if (!canSwitchVoiceMode(phase)) {
    return {
      accepted: false,
      mode: current,
      reason: "Finish or cancel the active voice turn before switching modes.",
    };
  }
  const availability = getVoiceModeAvailability(requested, capabilities);
  return availability.available
    ? { accepted: true, mode: requested, reason: null }
    : { accepted: false, mode: current, reason: availability.reason };
}
