import type { DesktopDuplexVoiceError, DesktopDuplexVoiceErrorCode } from "../../../../api/desktopApi";
import type { DuplexLocalFailureCode } from "./captureController";
import type { DuplexStartupFailureCode, DuplexVoiceFailure } from "./startupFailure";
import type { DuplexVoiceInputPhase } from "./useDuplexVoiceInput";
import type { DuplexVoiceStartupStage } from "./startupTransaction";

export type DuplexHudState = "connecting" | "listening" | "speaking" | "answering" | "recovering" | "paused" | "ending" | "needs_attention";
export type DuplexRecoveryAction = "retry" | "open_agent_settings" | "switch_to_serial";
export type DuplexShortcutAction = "toggle_start" | "toggle_pause" | "stop";

export function getDuplexShortcutAction(input: { key: string; altKey: boolean; shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean; enabled: boolean; phase: DuplexVoiceInputPhase }): DuplexShortcutAction | null {
  if (!input.enabled || !input.altKey || !input.shiftKey || input.ctrlKey || input.metaKey) return null;
  const key = input.key.toLowerCase();
  if (key === "v") return "toggle_start";
  if (key === "p" && input.phase === "active") return "toggle_pause";
  if (key === "s" && ["active", "recovering"].includes(input.phase)) return "stop";
  return null;
}

export function deriveDuplexHudState(input: { phase: DuplexVoiceInputPhase; turnPhase: string; microphonePaused: boolean; speechCandidate: boolean; playbackStarted: boolean }): DuplexHudState {
  if (input.phase === "starting") return "connecting";
  if (input.phase === "recovering") return "recovering";
  if (input.phase === "stopping") return "ending";
  if (input.phase === "failed" || input.phase === "idle") return "needs_attention";
  if (input.microphonePaused) return "paused";
  if (input.turnPhase === "interrupting") return "speaking";
  if (input.playbackStarted || ["assistant_speaking", "responding"].includes(input.turnPhase)) return "answering";
  return input.speechCandidate ? "speaking" : "listening";
}

const LABELS: Record<DuplexHudState, { zh: string; en: string }> = {
  connecting: { zh: "正在连接", en: "Connecting" }, listening: { zh: "正在听", en: "Listening" }, speaking: { zh: "你正在说话", en: "You are speaking" }, answering: { zh: "OpenDrSai 正在回答", en: "OpenDrSai is answering" }, recovering: { zh: "正在恢复连接", en: "Recovering connection" }, paused: { zh: "麦克风已暂停", en: "Microphone paused" }, ending: { zh: "正在结束", en: "Ending" }, needs_attention: { zh: "需要处理", en: "Needs attention" },
};
export function duplexHudLabel(state: DuplexHudState, zh: boolean): string { return LABELS[state][zh ? "zh" : "en"]; }

const STARTUP_LABELS: Record<DuplexVoiceStartupStage, { zh: string; en: string }> = {
  checking_readiness: { zh: "正在检查实时对话配置", en: "Checking Realtime configuration" },
  awaiting_disclosure: { zh: "等待确认语音传输", en: "Waiting for voice data confirmation" },
  preparing_microphone: { zh: "正在准备麦克风", en: "Preparing microphone" },
  preparing_playback: { zh: "正在准备声音播放", en: "Preparing audio playback" },
  connecting_provider: { zh: "正在连接实时模型", en: "Connecting to the Realtime model" },
  activating_audio: { zh: "正在启动实时音频", en: "Activating Realtime audio" },
};
export function duplexStartupLabel(stage: DuplexVoiceStartupStage | null, zh: boolean): string | null { return stage ? STARTUP_LABELS[stage][zh ? "zh" : "en"] : null; }

export function getDuplexErrorRecovery(code: DesktopDuplexVoiceErrorCode | DuplexLocalFailureCode | DuplexStartupFailureCode): { primary: DuplexRecoveryAction; fallback?: DuplexRecoveryAction } {
  if (["auth", "model", "policy", "protocol"].includes(code)) return { primary: "open_agent_settings", fallback: "switch_to_serial" };
  if (["permission_denied", "device_missing", "unsupported"].includes(code)) return { primary: "open_agent_settings", fallback: "switch_to_serial" };
  if (code === "cancelled") return { primary: "switch_to_serial" };
  return { primary: "retry", fallback: "switch_to_serial" };
}

export function duplexFailureTraceId(failure: DuplexVoiceFailure): string | undefined {
  if ("traceId" in failure) return failure.traceId;
  return "requestId" in failure ? failure.requestId : undefined;
}

export function realtimeDisclosureFingerprint(providerId: string | null | undefined, modelId: string | null | undefined): string {
  return providerId && modelId ? `realtime-disclosure-v1:${providerId}:${modelId}` : "";
}
