import type { DesktopAgent } from "@shared/desktopApi";
import type { AppLanguage } from "./navigation";

const MAX_AGENT_EXAMPLES = 4;
const MAX_EXAMPLE_LENGTH = 500;

const FALLBACK_EXAMPLES = {
  zh: [
    "探索并理解当前工作区",
    "构建新功能、应用或工具",
    "审查现有内容并提出改进建议",
    "定位并修复问题或失败",
  ],
  en: [
    "Explore and understand this workspace",
    "Build a new feature, app, or tool",
    "Review the current work and suggest improvements",
    "Find and fix a problem or failure",
  ],
} as const;

export function parseCatalogAgentExamples(
  raw: DesktopAgent["examples"] | undefined,
  language: AppLanguage,
): string[] {
  if (!raw) return [];
  const values = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  const prompts = values
    .map((item) => {
      if (typeof item !== "string") return pickLocalizedExample(item, language);
      const parsed = parseJsonIfObject(item);
      return isLocalizedExample(parsed)
        ? pickLocalizedExample(parsed, language)
        : sanitizeExample(item);
    })
    .filter((item): item is string => Boolean(item));
  return [...new Set(prompts)].slice(0, MAX_AGENT_EXAMPLES);
}

export function getAgentEmptyChatPrompts(agentPrompts: string[], language: AppLanguage): string[] {
  const dedicated = [...new Set(agentPrompts.map(sanitizeExample).filter((item): item is string => Boolean(item)))]
    .slice(0, MAX_AGENT_EXAMPLES);
  if (dedicated.length > 0) return dedicated;
  return [...FALLBACK_EXAMPLES[language]];
}

function sanitizeExample(value: string | undefined): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_EXAMPLE_LENGTH) : "";
}

function parseJsonIfObject(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function isLocalizedExample(value: unknown): value is { en?: string; zh?: string } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (typeof (value as { en?: unknown }).en === "string" || typeof (value as { zh?: unknown }).zh === "string")
  );
}

function pickLocalizedExample(value: { en?: string; zh?: string }, language: AppLanguage): string {
  return sanitizeExample(language === "zh" ? value.zh || value.en : value.en || value.zh);
}
