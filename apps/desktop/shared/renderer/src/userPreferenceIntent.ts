import type {
  DesktopUserPreference,
  DesktopUserPreferenceCategory,
  DesktopUserPreferenceUpsertRequest,
  DesktopUserPreferenceValue,
} from "@shared/desktopApi";
import { redactSensitiveData, scanSensitiveData, type SensitiveDataKind } from "../../api/sensitiveData";

const EXPLICIT_MEMORY_MARKER = /(?:以后|今后|将来).{0,10}(?:默认|都|一直)|(?:请|帮我)?记住|remember|from now on|always default/i;
const TASK_MARKER = /(?:分析|生成|制作|创建|总结|调研|研究|修改|翻译|发送|运行|打开|比较|检查|analy[sz]e|generate|create|summari[sz]e|research|edit|translate|send|run|open|compare|check)/i;
const TEMPORARY_MARKER = /(?:这次|本次|当前(?:任务|会话)|临时|仅(?:限)?这一次|一次性|不要用于下次|only (?:for )?this (?:time|task|session)|just this once|temporary|for this request)/i;
const SENSITIVE_PATTERNS = {
  api_key: /(?:\bsk-[A-Za-z0-9_-]{12,}\b|\b(?:api[ _-]?key|apikey)\s*(?:是|为|:|=)\s*["']?[A-Za-z0-9_./+=-]{8,})/ig,
  token: /(?:\b(?:gh[pousr]_[A-Za-z0-9]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,})\b|\b(?:access[ _-]?token|refresh[ _-]?token|令牌|token)\s*(?:是|为|:|=)\s*["']?[A-Za-z0-9_./+=-]{8,})/ig,
  temporary_path: /(?:\b[A-Za-z]:\\(?:Users\\[^\\\s]+\\AppData\\Local\\Temp|Windows\\Temp)\\[^\s"']+|%TEMP%\\[^\s"']+|\/tmp\/[^\s"']+)/ig,
} as const;

export type MemorySafetyKind = SensitiveDataKind | keyof typeof SENSITIVE_PATTERNS;

export interface MemorySafetyIntent {
  explicitMemoryRequest: boolean;
  temporary: boolean;
  sensitiveKinds: MemorySafetyKind[];
  hasSensitiveContent: boolean;
}

export function analyzeMemorySafetyIntent(text: string): MemorySafetyIntent {
  const sensitiveKinds = [...new Set<MemorySafetyKind>([
    ...scanSensitiveData(text).map((match) => match.kind),
    ...(Object.entries(SENSITIVE_PATTERNS) as [keyof typeof SENSITIVE_PATTERNS, RegExp][])
    .filter(([, pattern]) => resetAndTest(pattern, text))
    .map(([kind]) => kind),
  ])];
  return {
    explicitMemoryRequest: EXPLICIT_MEMORY_MARKER.test(text),
    temporary: TEMPORARY_MARKER.test(text),
    sensitiveKinds,
    hasSensitiveContent: sensitiveKinds.length > 0,
  };
}

export function parseExplicitUserPreferenceIntent(text: string): DesktopUserPreferenceUpsertRequest[] {
  const normalized = text.trim();
  if (!normalized || !EXPLICIT_MEMORY_MARKER.test(normalized) || TEMPORARY_MARKER.test(normalized)) return [];
  const found: DesktopUserPreferenceUpsertRequest[] = [];
  if (/(?:默认|一直|都|用|输出).{0,8}中文|Chinese(?:\s+(?:by default|output))?/i.test(normalized)) add(found, "output_language", "zh");
  else if (/(?:默认|一直|都|用|输出).{0,8}英文|English(?:\s+(?:by default|output))?/i.test(normalized)) add(found, "output_language", "en");

  if (/(?:图表|图形|chart).{0,12}(?:不要|不显示|隐藏|去掉|without|hide|no).{0,5}(?:网格线|gridlines?|grid)/i.test(normalized)) add(found, "chart_gridlines", "hidden");
  else if (/(?:图表|图形|chart).{0,12}(?:显示|保留|要|with|show).{0,5}(?:网格线|gridlines?|grid)/i.test(normalized)) add(found, "chart_gridlines", "visible");

  if (/(?:默认|报告|格式).{0,10}(?:PPT|演示文稿|幻灯片|presentation|slides?)/i.test(normalized)) add(found, "report_format", "presentation");
  else if (/(?:默认|报告|格式).{0,10}(?:一页摘要|摘要|summary)/i.test(normalized)) add(found, "report_format", "summary");
  else if (/(?:默认|格式).{0,10}(?:完整报告|书面报告|full report|written report)/i.test(normalized)) add(found, "report_format", "report");

  if (/(?:默认|受众|面向).{0,10}(?:管理者|管理层|领导|manager|executive)/i.test(normalized)) add(found, "audience", "manager");
  else if (/(?:默认|受众|面向).{0,10}(?:技术专家|专家|technical expert|expert)/i.test(normalized)) add(found, "audience", "expert");
  else if (/(?:默认|受众|面向).{0,10}(?:普通读者|通用|general audience|general)/i.test(normalized)) add(found, "audience", "general");
  return found;
}

export function isPreferenceOnlyRequest(text: string): boolean {
  return EXPLICIT_MEMORY_MARKER.test(text) && !TASK_MARKER.test(text);
}

export function canHandleMemoryRequestLocally(text: string): boolean {
  const safety = analyzeMemorySafetyIntent(text);
  return safety.hasSensitiveContent
    || (safety.explicitMemoryRequest && safety.temporary && isPreferenceOnlyRequest(text))
    || (isPreferenceOnlyRequest(text) && parseExplicitUserPreferenceIntent(text).length > 0);
}

export function redactSensitiveMemoryText(text: string): string {
  let redacted = redactSensitiveData(text);
  const labels: Record<MemorySafetyKind, string> = {
    api_key: "[API Key 已隐藏]",
    token: "[令牌已隐藏]",
    user_secret: "[秘密已隐藏]",
    bearer_token: "[令牌已隐藏]",
    email: "[邮箱已隐藏]",
    phone: "[手机号已隐藏]",
    temporary_path: "[临时路径已隐藏]",
  };
  for (const [kind, pattern] of Object.entries(SENSITIVE_PATTERNS) as [MemorySafetyKind, RegExp][]) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, labels[kind]);
  }
  return redacted;
}

export function formatMemorySafetyNotice(
  safety: MemorySafetyIntent,
  language: "zh" | "en",
): string {
  const notices: string[] = [];
  if (safety.hasSensitiveContent) {
    notices.push(language === "zh"
      ? "为保护隐私，我没有保存或发送检测到的 API Key、令牌、个人信息或临时路径；这些内容不会进入模型或后续会话上下文。请通过受保护的凭据设置提供任务所需秘密。"
      : "For your privacy, I did not save or send the detected API key, token, personal information, or temporary path. It will not enter the model or later conversation context; use protected credential settings when a task needs a secret.");
  }
  if (safety.temporary) {
    notices.push(language === "zh"
      ? "这被视为一次性要求：不会保存为长期偏好，也不会影响下一次任务。"
      : "This is treated as a one-time instruction: it will not be saved as a long-term preference or affect the next task.");
  }
  return notices.join("\n\n");
}

export function formatPreferenceConfirmation(
  preferences: DesktopUserPreference[],
  language: "zh" | "en",
): string {
  const values = preferences.map((item) => preferenceLabel(item, language));
  return language === "zh"
    ? `已记住 ${values.length} 项偏好：${values.join("；")}。新建会话后会自动应用，不需要再次说明。`
    : `Remembered ${values.length} preference${values.length === 1 ? "" : "s"}: ${values.join("; ")}. They will be applied automatically in new conversations.`;
}

export function formatAppliedPreferenceNotice(
  preferences: DesktopUserPreference[],
  language: "zh" | "en",
): string {
  if (!preferences.length) return "";
  const values = preferences.map((item) => preferenceLabel(item, language));
  return language === "zh"
    ? `本会话已自动应用你记住的偏好：${values.join("；")}。`
    : `Applied your remembered preferences to this conversation: ${values.join("; ")}.`;
}

export function buildUserPreferenceSystemSection(preferences: DesktopUserPreference[]): string {
  if (!preferences.length) return "";
  return [
    "Explicit user preferences. Apply these defaults unless the current request explicitly overrides them:",
    ...preferences.map((item) => `- ${item.category}: ${item.value}`),
  ].join("\n");
}

function add(
  preferences: DesktopUserPreferenceUpsertRequest[],
  category: DesktopUserPreferenceCategory,
  value: DesktopUserPreferenceValue,
): void {
  preferences.push({ category, value, source: "explicit_user_request" });
}

function preferenceLabel(preference: Pick<DesktopUserPreference, "category" | "value">, language: "zh" | "en"): string {
  const labels: Record<DesktopUserPreferenceCategory, Record<string, { zh: string; en: string }>> = {
    output_language: {
      zh: { zh: "默认输出语言：中文", en: "output language: Chinese" },
      en: { zh: "默认输出语言：英文", en: "output language: English" },
    },
    chart_gridlines: {
      hidden: { zh: "图表网格线：不显示", en: "chart gridlines: hidden" },
      visible: { zh: "图表网格线：显示", en: "chart gridlines: visible" },
    },
    report_format: {
      presentation: { zh: "默认报告格式：演示文稿", en: "report format: presentation" },
      report: { zh: "默认报告格式：完整报告", en: "report format: full report" },
      summary: { zh: "默认报告格式：摘要", en: "report format: summary" },
    },
    audience: {
      manager: { zh: "默认受众：管理者", en: "audience: managers" },
      expert: { zh: "默认受众：技术专家", en: "audience: technical experts" },
      general: { zh: "默认受众：普通读者", en: "audience: general readers" },
    },
  };
  return labels[preference.category][preference.value]?.[language] ?? `${preference.category}: ${preference.value}`;
}

function resetAndTest(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}
