export interface UserFacingError {
  title: string;
  action: string;
  retryable: boolean;
  diagnosticCode: string;
}

export function describeUserFacingError(error: unknown, language: "zh" | "en"): UserFacingError {
  const raw = error instanceof Error ? error.message : String(error || "");
  const code = extractCode(raw);
  const zh = language === "zh";
  if (/local_runtime_unavailable|Local Runtime|Runtime port|Gateway port|gateway_unauthorized|gateway_health|gateway_models|gateway_unreachable/i.test(raw)) return {
    title: zh ? "本地 Runtime 暂时不可用。" : "Local Runtime is unavailable.",
    action: zh ? "请重启 OpenDrSai Runtime；如果仍失败，关闭占用端口的旧 OpenDrSai 进程后再试。" : "Restart the OpenDrSai Runtime. If it still fails, stop the old OpenDrSai process using the Runtime port and retry.",
    retryable: true, diagnosticCode: code,
  };
  if (/unauthor|not_logged_in|authentication|token_expired/i.test(raw)) return {
    title: zh ? "Codex 需要重新登录。" : "Codex needs you to sign in again.",
    action: zh ? "请在设置中登录，然后重试。" : "Sign in from Settings, then retry.",
    retryable: true, diagnosticCode: code,
  };
  if (/incompatible|version|schema/i.test(raw)) return {
    title: zh ? "Codex 版本与当前 OpenDrSai 不兼容。" : "This Codex version is not compatible with OpenDrSai.",
    action: zh ? "请在设置中运行 Codex 修复。" : "Run Codex repair from Settings.",
    retryable: false, diagnosticCode: code,
  };
  if (/connection|eof|timeout|network|gateway|app.?server/i.test(raw)) return {
    title: zh ? "暂时无法连接 Codex。" : "OpenDrSai cannot connect to Codex right now.",
    action: zh ? "已保留现有内容，请检查连接后重试。" : "Existing content is safe. Check the connection and retry.",
    retryable: true, diagnosticCode: code,
  };
  if (/not.?found|missing|unknown session|unknown thread|resume_required/i.test(raw)) return {
    title: zh ? "找不到原 Codex 任务。" : "The original Codex task could not be found.",
    action: zh ? "请重新同步工作区；如需继续，可明确新建任务。" : "Sync the workspace again, or explicitly start a new task.",
    retryable: true, diagnosticCode: code,
  };
  return {
    title: zh ? "操作没有完成。" : "The operation did not complete.",
    action: zh ? "请重试；如果问题仍然存在，可导出脱敏诊断。" : "Retry, or export redacted diagnostics if the problem continues.",
    retryable: true, diagnosticCode: code,
  };
}

function extractCode(raw: string): string {
  const match = raw.match(/\b[a-z][a-z0-9]*(?:[_-][a-z0-9]+){1,8}\b/i);
  return match?.[0]?.slice(0, 120) || "unexpected_error";
}
