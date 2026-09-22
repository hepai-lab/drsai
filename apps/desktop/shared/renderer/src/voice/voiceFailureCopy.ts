import type { DesktopVoiceRuntimeStatus } from "@shared/desktopApi";

export type SerialVoiceSetupAction = "consent" | "open_agent_settings" | "retry_capture";

export type SerialSttBlockReason = "unconfigured" | "auth_required" | "gateway_unavailable";

export interface SerialSttBlock {
  action: "open_agent_settings";
  message: string;
  reasonCode: SerialSttBlockReason;
}

function errorName(error: unknown): string {
  if (error && typeof error === "object" && "name" in error && typeof error.name === "string") {
    return error.name;
  }
  return "";
}

export function getVoicePermissionError(error: unknown, zh = true): string {
  const name = errorName(error);
  if (name === "NotAllowedError" || name === "SecurityError") {
    return zh ? "麦克风权限被拒绝。请在系统设置中允许 OpenDrSai 使用麦克风后再试。" : "Microphone permission was denied.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return zh ? "未找到麦克风。请连接麦克风后重试。" : "No microphone was found.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return zh ? "麦克风正被其他程序占用，或当前无法使用。" : "The microphone is already in use or unavailable.";
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return zh ? "无法开始语音录音。" : "Unable to start voice recording.";
}

export function getSerialVoiceConsentMessage(zh: boolean): string {
  return zh
    ? "录音已保留。首次使用需允许在线语音识别，允许后将继续识别，不需要重新录音。"
    : "The recording is preserved. Allow online transcription to continue without recording again.";
}

export function getSelectedMicrophoneUnavailableMessage(zh: boolean): string {
  return zh
    ? "所选麦克风已不可用，将改用系统默认麦克风。"
    : "The selected microphone is no longer available. The default microphone will be used.";
}

export function getVoiceRuntimeUnavailableMessage(zh: boolean): string {
  return zh ? "当前桌面环境无法使用语音录音。" : "Voice recording is unavailable in this desktop runtime.";
}

export function getSerialSttStatusMessage(
  runtime: Pick<DesktopVoiceRuntimeStatus, "state" | "message" | "reasonCode"> | null,
  zh: boolean,
): string {
  if (!runtime) return zh ? "正在检查语音识别服务…" : "Checking speech recognition…";
  if (runtime.state === "ready" || runtime.state === "degraded") {
    return zh ? "语音识别已就绪。停止录音后会将音频发给当前配置的识别服务。" : "Speech recognition is ready. Audio is sent to the configured transcription service after recording stops.";
  }
  return describeSerialSttBlock(runtime, zh)?.message
    ?? (zh ? "语音识别当前不可用。" : "Speech recognition is unavailable.");
}

export function describeSerialSttBlock(
  runtime: Pick<DesktopVoiceRuntimeStatus, "state" | "message" | "reasonCode"> | null,
  zh: boolean,
): SerialSttBlock | null {
  if (!runtime) return null;
  if (runtime.state === "ready" || runtime.state === "degraded") return null;
  const reasonCode = resolveSerialSttReason(runtime);
  return {
    action: "open_agent_settings",
    reasonCode,
    message: serialSttBlockMessage(reasonCode, zh),
  };
}

function resolveSerialSttReason(
  runtime: Pick<DesktopVoiceRuntimeStatus, "state" | "message" | "reasonCode">,
): SerialSttBlockReason {
  if (runtime.reasonCode === "unconfigured" || runtime.reasonCode === "auth_required" || runtime.reasonCode === "gateway_unavailable") {
    return runtime.reasonCode;
  }
  if (runtime.state === "auth_required") return "auth_required";
  if (/speech-to-text model|Assign a speech/i.test(runtime.message)) return "unconfigured";
  return "gateway_unavailable";
}

function serialSttBlockMessage(reasonCode: SerialSttBlockReason, zh: boolean): string {
  if (reasonCode === "unconfigured") {
    return zh
      ? "尚未配置语音转文字模型。请到设置 → 智能体配置中指定识别模型后再试。"
      : "No speech-to-text model is configured. Assign one in Settings → Agent configuration, then try again.";
  }
  if (reasonCode === "auth_required") {
    return zh
      ? "请先登录 HepAI，才能使用当前配置的语音识别模型。"
      : "Sign in to HepAI to use the selected transcription model.";
  }
  return zh
    ? "语音识别服务当前不可用。请确认本机网关已启动，并在智能体配置中指定识别模型。"
    : "Speech recognition is unavailable. Start the local gateway and assign a transcription model.";
}
