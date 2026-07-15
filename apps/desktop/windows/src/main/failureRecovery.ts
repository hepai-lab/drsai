import type { DesktopFailureRecovery } from "../shared/desktopApi";

export class DesktopFailureError extends Error {
  readonly recovery: DesktopFailureRecovery;
  constructor(recovery: DesktopFailureRecovery, cause?: unknown) {
    super(recovery.message, { cause });
    this.name = "DesktopFailureError";
    this.recovery = recovery;
  }
}

export function buildFailureRecovery(error: unknown, attempts: number, retryLimit: number): DesktopFailureRecovery {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const count = Math.max(1, Math.floor(attempts));
  const limit = Math.max(1, Math.floor(retryLimit));
  const exhausted = count >= limit;
  if (/EBUSY|EPERM|\bbusy\b|being used|in use|occupied|locked/i.test(raw)) return {
    kind: "file_busy", attempts: count, retryLimit: limit, retryable: true, exhausted,
    escalationLevel: exhausted ? "user_action" : "automatic",
    reason: "目标文件正被 PowerPoint 或其他程序占用。",
    suggestedAction: "关闭占用该文件的程序，然后点击“重试生成”。",
    message: `文件被占用，已尝试 ${count}/${limit} 次；任务已停止且没有覆盖现有文件。关闭占用程序后可安全重试。`,
  };
  if (/HTTP\s*(?:408|429|5\d\d)|service|provider|temporarily unavailable/i.test(raw)) return {
    kind: "external_service", attempts: count, retryLimit: limit, retryable: true, exhausted,
    escalationLevel: exhausted ? "administrator" : "automatic",
    reason: "外部服务暂时不可用或正在限流。",
    suggestedAction: exhausted ? "稍后重试；如果持续失败，请检查服务状态、账号额度或联系管理员。" : "正在按安全策略自动重试。",
    message: `外部服务连续 ${count} 次不可用。已停止自动重试并保留现有内容；稍后可安全重试，持续失败时请联系管理员。`,
  };
  if (/RecoverableStreamError|stream ended before|fetch failed|network|socket|connection|ECONN|UND_ERR|terminated|other side closed/i.test(raw)) return {
    kind: "network", attempts: count, retryLimit: limit, retryable: true, exhausted,
    escalationLevel: exhausted ? "user_action" : "automatic",
    reason: "网络连接尚未恢复。",
    suggestedAction: "检查网络或代理设置，恢复连接后点击重试。",
    message: `网络在 ${count} 次尝试后仍不可用。已有内容已保留；检查网络或代理后可安全重试。`,
  };
  return {
    kind: "unexpected", attempts: count, retryLimit: limit, retryable: true, exhausted,
    escalationLevel: exhausted ? "administrator" : "user_action",
    reason: "任务遇到未预期错误。",
    suggestedAction: exhausted ? "再次尝试；若问题持续，请携带任务时间联系管理员。" : "请重试。",
    message: exhausted ? `任务连续失败 ${count} 次，已停止运行。请重试；若问题持续，请联系管理员。` : "任务失败，现有内容已保留，可以重试。",
  };
}

export function createFailureEscalation(error: unknown, attempts: number, retryLimit: number): DesktopFailureError {
  return new DesktopFailureError(buildFailureRecovery(error, attempts, retryLimit), error);
}

export function getFailureRecovery(error: unknown): DesktopFailureRecovery | undefined {
  return error instanceof DesktopFailureError ? error.recovery : undefined;
}
