import type { DesktopDuplexVoiceError, DesktopDuplexVoiceErrorCode } from "../../../../api/desktopApi";
import type { DuplexLocalFailure } from "./captureController";
import { DuplexStartupError, type DuplexVoiceStartupStage } from "./startupTransaction";

export type DuplexStartupFailureCode = "readiness_unavailable" | "stage_failed" | "stage_timeout" | "provider_unavailable" | "activation_failed";
export interface DuplexStartupFailure {
  domain: "startup";
  stage: DuplexVoiceStartupStage;
  code: DuplexStartupFailureCode;
  retryable: boolean;
  traceId: string;
  message: string;
  technicalDetail?: string;
}
export type DuplexVoiceFailure = DesktopDuplexVoiceError | DuplexLocalFailure | DuplexStartupFailure;

const STAGE_LABELS: Record<DuplexVoiceStartupStage, string> = {
  checking_readiness: "检查实时对话配置",
  awaiting_disclosure: "确认语音传输",
  preparing_microphone: "准备麦克风",
  preparing_playback: "准备声音播放",
  connecting_provider: "连接实时模型",
  activating_audio: "启动实时音频",
};

export function classifyDuplexStartupFailure(stage: DuplexVoiceStartupStage, error: unknown, traceId: string): DuplexStartupFailure {
  const actualStage = error instanceof DuplexStartupError ? error.stage : stage;
  const code: DuplexStartupFailureCode = error instanceof DuplexStartupError && error.code === "stage_timeout"
    ? "stage_timeout"
    : actualStage === "checking_readiness"
      ? "readiness_unavailable"
      : actualStage === "connecting_provider"
        ? "provider_unavailable"
        : actualStage === "activating_audio"
          ? "activation_failed"
          : "stage_failed";
  const detail = error instanceof Error ? error.message : String(error);
  return {
    domain: "startup",
    stage: actualStage,
    code,
    retryable: true,
    traceId,
    message: `实时对话在“${STAGE_LABELS[actualStage]}”阶段失败。`,
    ...(detail ? { technicalDetail: detail } : {}),
  };
}

export function isDuplexVoiceFailure(value: unknown): value is DuplexVoiceFailure {
  return Boolean(value && typeof value === "object" && ("code" in value) && ("message" in value));
}

export function duplexFailureCode(failure: DuplexVoiceFailure): DesktopDuplexVoiceErrorCode | DuplexLocalFailure["code"] | DuplexStartupFailureCode {
  return failure.code;
}
