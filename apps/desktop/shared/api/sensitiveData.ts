export type SensitiveDataKind = "api_key" | "user_secret" | "bearer_token" | "email" | "phone";

export interface SensitiveDataMatch {
  kind: SensitiveDataKind;
  severity: "high" | "personal";
  start: number;
  end: number;
  value: string;
}

interface PatternDefinition {
  kind: SensitiveDataKind;
  severity: SensitiveDataMatch["severity"];
  source: string;
  flags: string;
  captureGroup?: number;
}

const PATTERNS: PatternDefinition[] = [
  { kind: "api_key", severity: "high", source: String.raw`\b(?:api[_ -]?key)\b\s*[:=]\s*["']?([A-Za-z0-9._~+\/-]{8,})`, flags: "gi", captureGroup: 1 },
  { kind: "user_secret", severity: "high", source: String.raw`\b(?:user[_ -]?secret|token|secret|password)\b\s*[:=]\s*["']?([A-Za-z0-9._~+\/-]{8,})`, flags: "gi", captureGroup: 1 },
  { kind: "bearer_token", severity: "high", source: String.raw`\bBearer\s+([A-Za-z0-9._~+\/-]{8,})`, flags: "gi", captureGroup: 1 },
  { kind: "api_key", severity: "high", source: String.raw`\bsk-[A-Za-z0-9_-]{12,}\b`, flags: "g" },
  { kind: "email", severity: "personal", source: String.raw`\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b`, flags: "gi" },
  { kind: "phone", severity: "personal", source: String.raw`(?<!\d)1[3-9]\d{9}(?!\d)`, flags: "g" },
];

const SECRET_FIELD = /^(?:authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|registration[_-]?token|password|secret)$/i;
const BINARY_FIELD = /^(?:b64_json|content_base64|data_url|image_base64)$/i;

export function scanSensitiveData(text: string): SensitiveDataMatch[] {
  const matches: SensitiveDataMatch[] = [];
  for (const pattern of PATTERNS) {
    const expression = new RegExp(pattern.source, pattern.flags);
    let result: RegExpExecArray | null;
    while ((result = expression.exec(text)) !== null) {
      const value = pattern.captureGroup ? result[pattern.captureGroup] : result[0];
      if (!value) continue;
      const offset = pattern.captureGroup ? result[0].indexOf(value) : 0;
      const start = result.index + Math.max(0, offset);
      const end = start + value.length;
      if (matches.some((item) => start < item.end && end > item.start)) continue;
      matches.push({ kind: pattern.kind, severity: pattern.severity, start, end, value });
    }
  }
  return matches.sort((left, right) => left.start - right.start);
}

export function redactSensitiveData(text: string, options: { includePersonal?: boolean } = {}): string {
  const includePersonal = options.includePersonal !== false;
  let redacted = text;
  for (const match of scanSensitiveData(text).filter((item) => includePersonal || item.severity === "high").sort((left, right) => right.start - left.start)) {
    redacted = `${redacted.slice(0, match.start)}${redactionLabel(match.kind)}${redacted.slice(match.end)}`;
  }
  return redacted;
}

export function sanitizeSensitiveValue<T>(value: T, options: { includePersonal?: boolean } = {}): T {
  if (typeof value === "string") return redactSensitiveData(value, options) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeSensitiveValue(item, options)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (SECRET_FIELD.test(key)) return [key, "[REDACTED SECRET]"];
      if (BINARY_FIELD.test(key)) return [key, "[REDACTED BINARY]"];
      return [key, sanitizeSensitiveValue(item, options)];
    })) as T;
  }
  return value;
}

function redactionLabel(kind: SensitiveDataKind): string {
  if (kind === "email") return "[REDACTED EMAIL]";
  if (kind === "phone") return "[REDACTED PHONE]";
  if (kind === "bearer_token") return "[REDACTED TOKEN]";
  if (kind === "api_key") return "[REDACTED API KEY]";
  return "[REDACTED SECRET]";
}
