import type { DesktopVoiceError, DesktopVoiceErrorCode } from "../../shared/desktopApi";

const SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|authorization|token|secret)\s*[:=]\s*[^\s,;]+)/gi;
const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s]+/gi;

export function normalizeStreamingVoiceError(error: unknown, requestId: string): DesktopVoiceError {
  const source = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  const status = typeof source.status === "number" ? source.status : undefined;
  const rawCode = typeof source.code === "string" ? source.code : "";
  const rawMessage = error instanceof Error ? error.message : typeof error === "string" ? error : "Streaming voice failed.";
  let code: DesktopVoiceErrorCode = "provider_error";
  let retryable = false;
  if (rawCode === "ABORT_ERR" || /cancel/i.test(rawMessage)) code = "cancelled";
  else if (status === 401 || status === 403 || /auth|credential/i.test(rawCode)) code = "auth_required";
  else if (status === 429 || /rate.?limit/i.test(rawCode)) { code = "rate_limited"; retryable = true; }
  else if (rawCode === "ETIMEDOUT" || /timeout/i.test(rawCode) || /timeout/i.test(rawMessage)) { code = "timeout"; retryable = true; }
  else if ((status !== undefined && status >= 500) || /ECONN|network|socket/i.test(`${rawCode} ${rawMessage}`)) { code = "network_error"; retryable = true; }
  else if (/format|encoding|sample rate/i.test(rawMessage)) code = "unsupported_format";
  else if (/too large|byte limit/i.test(rawMessage)) code = "audio_too_large";
  else if (/duration|total timeout/i.test(rawMessage)) code = "duration_exceeded";
  return { code, message: redactStreamingVoiceError(rawMessage), retryable, requestId };
}

export function redactStreamingVoiceError(message: string): string {
  const cleaned = message.replace(SECRET_PATTERN, "[REDACTED]").replace(URL_PATTERN, "[provider endpoint]").replace(/[\r\n\t]+/g, " ").trim();
  return cleaned.slice(0, 500) || "Streaming voice failed.";
}
