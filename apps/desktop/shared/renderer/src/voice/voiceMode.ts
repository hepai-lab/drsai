import type { DesktopStreamingVoiceCapabilities, DesktopVoiceInteractionMode, DesktopVoiceRuntimeStatus } from "@shared/desktopApi";
import type { VoiceTurnPhase } from "./voiceTurnReducer";

export interface VoiceModeCapabilities {
  audioWorklet: boolean;
  serialStt: boolean;
  serialTts: boolean;
  streamingStt: boolean;
  streamingTts: boolean;
}

export interface VoiceModeAvailability {
  available: boolean;
  reason: string | null;
}

export const DEFAULT_VOICE_MODE: DesktopVoiceInteractionMode = "serial";

export function normalizeVoiceInteractionMode(value: unknown): DesktopVoiceInteractionMode {
  return value === "streaming" ? "streaming" : DEFAULT_VOICE_MODE;
}

export function deriveVoiceModeCapabilities(
  runtime: DesktopVoiceRuntimeStatus | null,
  options: {
    audioWorklet?: boolean;
    serialTts?: boolean;
    streamingTts?: boolean;
    streamingCapabilities?: DesktopStreamingVoiceCapabilities | null;
  } = {},
): VoiceModeCapabilities {
  const runtimeReady = runtime?.state === "ready" || runtime?.state === "degraded";
  const negotiated = options.streamingCapabilities;
  return {
    audioWorklet: options.audioWorklet === true,
    serialStt: negotiated?.serialStt ?? Boolean(runtimeReady),
    serialTts: negotiated?.serialTts ?? options.serialTts !== false,
    streamingStt: Boolean(options.audioWorklet && (negotiated?.streamingStt ?? (runtimeReady && runtime?.supportsPartial))),
    streamingTts: negotiated?.streamingTts ?? options.streamingTts === true,
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
  if (!capabilities.audioWorklet) {
    return { available: false, reason: "Streaming voice requires AudioWorklet support." };
  }
  if (!capabilities.streamingStt) {
    return { available: false, reason: "The current transcription runtime does not support streaming results." };
  }
  return { available: true, reason: null };
}

export function getStreamingVoiceOutputAvailability(capabilities: VoiceModeCapabilities): VoiceModeAvailability {
  return capabilities.streamingTts
    ? { available: true, reason: null }
    : { available: false, reason: "Replies use completed speech playback until streaming synthesis is available." };
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
