import { describeUserFacingError } from "./userFacingErrors";

const INTERNAL_PRIMARY_COPY = /(?:^\s*[\[{]|\b(?:OAEP|JSON-RPC|HTTPException|ValueError|TypeError|Traceback|runtime_side_effects|approval_id|idempotency_key|correlation_id|operation_id|call_id)\b|\b(?:tool|audit|runtime|session|run)\.[a-z0-9_.-]+\b|\bat\s+[A-Za-z0-9_$.]+\s*\([^\n]+:\d+(?::\d+)?\))/i;

export function userFacingBusinessText(value: unknown, fallback: string, maxLength = 320): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (!normalized || INTERNAL_PRIMARY_COPY.test(normalized)) return fallback;
  return normalized.slice(0, maxLength);
}

export function userFacingFailureMessage(
  error: unknown,
  language: "zh" | "en",
  context: "approval" | "connection" | "operation" = "operation",
): string {
  const friendly = describeUserFacingError(error, language);
  const prefix = language === "zh"
    ? { approval: "审批未完成", connection: "连接操作未完成", operation: "操作未完成" }[context]
    : { approval: "Approval did not complete", connection: "Connection action did not complete", operation: "Operation did not complete" }[context];
  return language === "zh"
    ? `${prefix}：${friendly.title}${friendly.action}`
    : `${prefix}: ${friendly.title} ${friendly.action}`;
}

export function userFacingExecutionSource(value: unknown, language: "zh" | "en"): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.includes("opendrsai")) return "OpenDrSai";
  if (normalized.includes("windows") || normalized.includes("desktop")) return language === "zh" ? "本机应用" : "Desktop app";
  if (normalized.includes("android") || normalized.includes("mobile") || normalized.includes("remote")) return language === "zh" ? "已连接设备" : "Connected device";
  return language === "zh" ? "已记录的执行来源" : "Recorded execution source";
}
