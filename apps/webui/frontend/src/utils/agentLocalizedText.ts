import type { AgentExample, LocalizedExample } from "@/types/common";

export type AgentTextFormat = "empty" | "plain" | "localized";

export function isLocalizedText(value: unknown): value is LocalizedExample {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const o = value as Record<string, unknown>;
  return typeof o.en === "string" || typeof o.zh === "string";
}

export function pickLocalizedText(
  item: LocalizedExample,
  lang: "zh" | "en"
): string {
  const text = lang === "zh" ? item.zh ?? item.en : item.en ?? item.zh;
  return (text ?? "").trim();
}

/** Single field: plain `string` vs `{ en, zh }` (also as JSON string). */
export function detectAgentTextFormat(raw: unknown): AgentTextFormat {
  if (raw == null) return "empty";
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return "empty";
    if (s.startsWith("{") && s.endsWith("}")) {
      try {
        const parsed = JSON.parse(s);
        if (isLocalizedText(parsed)) return "localized";
      } catch {
        // not valid JSON — treat as plain
      }
    }
    return "plain";
  }
  if (isLocalizedText(raw)) return "localized";
  return "empty";
}

function tryParseJSON(text: string): unknown {
  if (text.trim().startsWith("{") && text.trim().endsWith("}")) {
    try { return JSON.parse(text); } catch { /* ignore */ }
  }
  return text;
}

export function parseAgentText(raw: unknown, lang: "zh" | "en"): string {
  const format = detectAgentTextFormat(raw);
  if (format === "empty") return "";
  if (typeof raw === "string") {
    const parsed = tryParseJSON(raw);
    if (format === "localized" && isLocalizedText(parsed)) {
      return pickLocalizedText(parsed, lang);
    }
    return (parsed as string).trim();
  }
  if (format === "localized" && isLocalizedText(raw)) {
    return pickLocalizedText(raw, lang);
  }
  return "";
}

/** Array field: `string[]` vs `{ en, zh }[]`. */
export function detectAgentExamplesFormat(raw: unknown): AgentTextFormat {
  if (raw == null) return "empty";
  if (typeof raw === "string") return raw.trim() ? "plain" : "empty";
  if (!Array.isArray(raw) || raw.length === 0) return "empty";

  let sawString = false;
  let sawLocalized = false;
  for (const item of raw) {
    if (item == null) continue;
    if (typeof item === "string") {
      sawString = true;
      continue;
    }
    if (isLocalizedText(item)) {
      sawLocalized = true;
    }
  }

  if (sawLocalized) return "localized";
  if (sawString) return "plain";
  return "empty";
}

function resolveExampleItem(
  item: AgentExample,
  format: AgentTextFormat,
  lang: "zh" | "en"
): string {
  if (typeof item === "string") {
    const parsed = tryParseJSON(item);
    if (format === "localized" && isLocalizedText(parsed)) {
      return pickLocalizedText(parsed, lang);
    }
    return (parsed as string).trim();
  }
  if (format === "localized" && isLocalizedText(item)) {
    return pickLocalizedText(item, lang);
  }
  return "";
}

export function parseAgentExamples(
  raw: unknown,
  lang: "zh" | "en"
): string[] {
  const format = detectAgentExamplesFormat(raw);
  if (format === "empty") return [];
  if (typeof raw === "string") {
    const s = raw.trim();
    return s ? [s] : [];
  }
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => resolveExampleItem(item as AgentExample, format, lang))
    .filter((s) => s.length > 0);
}
