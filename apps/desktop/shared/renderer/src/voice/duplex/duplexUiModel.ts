import type { DesktopDuplexVoiceErrorCode } from "../../../../api/desktopApi";
import type { DuplexVoiceInputPhase } from "./useDuplexVoiceInput";

export type DuplexHudState = "connecting" | "listening" | "speaking" | "answering" | "interrupting" | "recovering" | "paused" | "ending" | "failed" | "idle";
export type DuplexRecoveryAction = "retry" | "open_agent_settings" | "switch_to_serial";
export type DuplexShortcutAction = "toggle_start" | "toggle_pause" | "stop" | "interrupt";

export function getDuplexShortcutAction(input: { key: string; altKey: boolean; shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean; enabled: boolean; phase: DuplexVoiceInputPhase }): DuplexShortcutAction | null {
  if (!input.enabled || !input.altKey || !input.shiftKey || input.ctrlKey || input.metaKey) return null;
  const key = input.key.toLowerCase();
  if (key === "v") return "toggle_start";
  if (key === "p" && input.phase === "active") return "toggle_pause";
  if (key === "s" && ["active", "recovering"].includes(input.phase)) return "stop";
  if (key === "i" && input.phase === "active") return "interrupt";
  return null;
}

export function deriveDuplexHudState(input: { phase: DuplexVoiceInputPhase; turnPhase: string; microphonePaused: boolean; speechCandidate: boolean; playbackStarted: boolean }): DuplexHudState {
  if (input.phase === "starting") return "connecting";
  if (input.phase === "recovering") return "recovering";
  if (input.phase === "stopping") return "ending";
  if (input.phase === "failed") return "failed";
  if (input.phase === "idle") return "idle";
  if (input.microphonePaused) return "paused";
  if (input.turnPhase === "interrupting") return "interrupting";
  if (input.playbackStarted || ["assistant_speaking", "responding"].includes(input.turnPhase)) return "answering";
  return input.speechCandidate ? "speaking" : "listening";
}

const LABELS: Record<DuplexHudState, { zh: string; en: string }> = {
  connecting: { zh: "正在连接", en: "Connecting" }, listening: { zh: "正在听", en: "Listening" }, speaking: { zh: "你正在说话", en: "You are speaking" }, answering: { zh: "OpenDrSai 正在回答", en: "OpenDrSai is answering" }, interrupting: { zh: "正在插话", en: "Interrupting" }, recovering: { zh: "正在恢复连接", en: "Recovering connection" }, paused: { zh: "麦克风已暂停", en: "Microphone paused" }, ending: { zh: "正在结束", en: "Ending" }, failed: { zh: "实时语音发生错误", en: "Realtime voice error" }, idle: { zh: "尚未开始", en: "Not started" },
};
export function duplexHudLabel(state: DuplexHudState, zh: boolean): string { return LABELS[state][zh ? "zh" : "en"]; }

export function getDuplexErrorRecovery(code: DesktopDuplexVoiceErrorCode): { primary: DuplexRecoveryAction; fallback?: DuplexRecoveryAction } {
  if (["auth", "model", "policy", "protocol"].includes(code)) return { primary: "open_agent_settings", fallback: "switch_to_serial" };
  if (code === "cancelled") return { primary: "switch_to_serial" };
  return { primary: "retry", fallback: "switch_to_serial" };
}

export function realtimeDisclosureFingerprint(providerId: string | null | undefined, modelId: string | null | undefined): string {
  return providerId && modelId ? `realtime-disclosure-v1:${providerId}:${modelId}` : "";
}
