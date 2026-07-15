import { createHash } from "crypto";
import type {
  DesktopShareSensitiveAction,
  DesktopShareSensitiveFinding,
  DesktopShareSensitiveFindingKind,
  DesktopShareSensitiveResolution,
} from "../shared/desktopApi";

export interface SensitiveMatch {
  findingId: string;
  artifactId: string;
  artifactLabel: string;
  kind: DesktopShareSensitiveFindingKind;
  severity: "high" | "personal";
  start: number;
  end: number;
  value: string;
}

interface PatternDefinition {
  kind: DesktopShareSensitiveFindingKind;
  severity: SensitiveMatch["severity"];
  expression: RegExp;
  captureGroup?: number;
}

const PATTERNS: PatternDefinition[] = [
  { kind: "api_key", severity: "high", expression: /\b(?:api[_ -]?key)\b\s*[:=]\s*["']?([A-Za-z0-9._~+\/-]{8,})/gi, captureGroup: 1 },
  { kind: "user_secret", severity: "high", expression: /\b(?:user[_ -]?secret|token|secret|password)\b\s*[:=]\s*["']?([A-Za-z0-9._~+\/-]{8,})/gi, captureGroup: 1 },
  { kind: "bearer_token", severity: "high", expression: /\bBearer\s+([A-Za-z0-9._~-]{12,})/gi, captureGroup: 1 },
  { kind: "api_key", severity: "high", expression: /\bsk-[A-Za-z0-9_-]{12,}\b/g },
  { kind: "email", severity: "personal", expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { kind: "phone", severity: "personal", expression: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
];

export function scanSensitiveText(text: string, artifactId: string, artifactLabel: string): SensitiveMatch[] {
  const matches: SensitiveMatch[] = [];
  for (const pattern of PATTERNS) {
    pattern.expression.lastIndex = 0;
    let result: RegExpExecArray | null;
    while ((result = pattern.expression.exec(text)) !== null) {
      const value = pattern.captureGroup ? result[pattern.captureGroup] : result[0];
      if (!value) continue;
      const offset = pattern.captureGroup ? result[0].indexOf(value) : 0;
      const start = result.index + Math.max(0, offset);
      const end = start + value.length;
      if (matches.some((item) => start < item.end && end > item.start)) continue;
      matches.push({
        findingId: findingId(artifactId, pattern.kind, value), artifactId, artifactLabel,
        kind: pattern.kind, severity: pattern.severity, start, end, value,
      });
    }
  }
  return matches.sort((left, right) => left.start - right.start);
}

export function publicSensitiveFindings(matches: SensitiveMatch[]): DesktopShareSensitiveFinding[] {
  const grouped = new Map<string, DesktopShareSensitiveFinding>();
  for (const match of matches) {
    const existing = grouped.get(match.findingId);
    if (existing) existing.occurrences += 1;
    else grouped.set(match.findingId, {
      id: match.findingId,
      artifactId: match.artifactId,
      artifactLabel: match.artifactLabel,
      kind: match.kind,
      severity: match.severity,
      occurrences: 1,
      maskedPreview: maskedPreview(match.kind),
      supportedActions: ["redact", "remove"],
    });
  }
  return [...grouped.values()];
}

export function sanitizeSensitiveText(
  text: string,
  matches: SensitiveMatch[],
  resolutions: DesktopShareSensitiveResolution[],
): string {
  const actions = new Map(resolutions.map((item) => [item.findingId, item.action]));
  let sanitized = text;
  for (const match of [...matches].sort((left, right) => right.start - left.start)) {
    const action = actions.get(match.findingId);
    if (!action) throw new Error("Sensitive information review is required before sharing.");
    const replacement = action === "remove" ? "" : redactionLabel(match.kind);
    sanitized = `${sanitized.slice(0, match.start)}${replacement}${sanitized.slice(match.end)}`;
  }
  return sanitized;
}

export function validateSensitiveResolutions(
  findings: DesktopShareSensitiveFinding[],
  resolutions: DesktopShareSensitiveResolution[],
): void {
  const actions = new Map<string, DesktopShareSensitiveAction>();
  for (const resolution of resolutions) {
    if (resolution.action !== "redact" && resolution.action !== "remove") throw new Error("Sensitive information resolution is invalid.");
    actions.set(resolution.findingId, resolution.action);
  }
  if (findings.some((finding) => !actions.has(finding.id))) {
    throw new Error("Sensitive information review is required before sharing.");
  }
}

function findingId(artifactId: string, kind: DesktopShareSensitiveFindingKind, value: string): string {
  return `sensitive:${createHash("sha256").update(`${artifactId}\0${kind}\0${value}`).digest("hex").slice(0, 20)}`;
}

function maskedPreview(kind: DesktopShareSensitiveFindingKind): string {
  if (kind === "email") return "[邮箱已隐藏]";
  if (kind === "phone") return "1••••••••••";
  if (kind === "bearer_token") return "Bearer ••••";
  if (kind === "api_key") return "sk-••••";
  return "[用户秘密已隐藏]";
}

function redactionLabel(kind: DesktopShareSensitiveFindingKind): string {
  if (kind === "email") return "[已遮蔽邮箱]";
  if (kind === "phone") return "[已遮蔽手机号]";
  return "[已遮蔽秘密]";
}
