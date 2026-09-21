import type { DesktopDuplexVoiceReadinessReasonCode } from "@shared/desktopApi";

export type DuplexVoiceReadinessActionId = "open_agent_settings" | "retry" | "switch_to_serial";

export interface DuplexVoiceReadinessActions {
  primary: DuplexVoiceReadinessActionId;
  fallback: DuplexVoiceReadinessActionId | null;
}

export function getDuplexVoiceReadinessActions(
  reasonCode: DesktopDuplexVoiceReadinessReasonCode,
): DuplexVoiceReadinessActions {
  switch (reasonCode) {
    case "model_unconfigured":
    case "provider_unsupported":
    case "model_unsupported":
    case "capability_unverified":
      return { primary: "open_agent_settings", fallback: "switch_to_serial" };
    case "gateway_unavailable":
    case "credential_unavailable":
    case "internal":
      return { primary: "retry", fallback: "switch_to_serial" };
    case "rollout_disabled":
    case "audio_worklet_unavailable":
    case "media_devices_unavailable":
      return { primary: "switch_to_serial", fallback: null };
    case "ready":
      return { primary: "retry", fallback: null };
  }
}
