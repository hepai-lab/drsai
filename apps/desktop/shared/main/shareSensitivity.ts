import { createHash } from "crypto";
import type {
  DesktopShareSensitiveAction,
  DesktopShareSensitiveFinding,
  DesktopShareSensitiveFindingKind,
  DesktopShareSensitiveResolution,
} from "../api/desktopApi";
import { scanSensitiveData } from "../api/sensitiveData";

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

export function scanSensitiveText(text: string, artifactId: string, artifactLabel: string): SensitiveMatch[] {
  return scanSensitiveData(text).map((match) => ({
    findingId: findingId(artifactId, match.kind as DesktopShareSensitiveFindingKind, match.value),
    artifactId,
    artifactLabel,
    kind: match.kind as DesktopShareSensitiveFindingKind,
    severity: match.severity,
    start: match.start,
    end: match.end,
    value: match.value,
  }));
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
  const findingIds = new Set(findings.map((finding) => finding.id));
  for (const resolution of resolutions) {
    if (resolution.action !== "redact" && resolution.action !== "remove") throw new Error("Sensitive information resolution is invalid.");
    if (!findingIds.has(resolution.findingId) || actions.has(resolution.findingId)) throw new Error("Sensitive information resolution does not match exactly one current finding.");
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
