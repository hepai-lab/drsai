import type { OaepItem } from "./oaep.generated";
import type {
  RunInspection,
  RunInspectionTimelineItem,
  RunReproductionManifest,
  SessionRunList,
} from "./runInspection";

const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|api[_-]?(?:key|token)|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|credential|private[_-]?key|system[_-]?prompt|prompt[_-]?(?:content|body)|input[_-]?text|data[_-]?url|content[_-]?base64|b64[_-]?json)/i;
const PRIVATE_REASONING_KEY = /(?:chain[_-]?of[_-]?thought|raw[_-]?(?:reasoning|analysis|thought)|private[_-]?(?:reasoning|analysis|thought)|internal[_-]?(?:reasoning|analysis|thought)|reasoning[_-]?(?:content|tokens|trace)|thinking|scratchpad|hidden[_-]?(?:reasoning|analysis))/i;
const SECRET_ASSIGNMENT = /\b(?:token|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|credential|private[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const COOKIE = /\b(?:Set-)?Cookie\s*:\s*[^\r\n]+/gi;
const PEM = /-----BEGIN [^-]*(?:PRIVATE KEY|CREDENTIAL)[^-]*-----[\s\S]*?-----END [^-]*(?:PRIVATE KEY|CREDENTIAL)[^-]*-----/gi;
const URL_SECRET = /([?&](?:code|token|access_token|refresh_token|id_token|client_secret|api_key|key|password)=)[^&#\s]+/gi;
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi;
const WINDOWS_PRIVATE_PATH = /(?:[A-Za-z]:[\\/](?:[^\s<>:"|?*\\/]+[\\/])+[^\s<>:"|?*\\/]*)|(?:\\\\[^\s\\/]+[\\/][^\s<>:"|?*]+(?:[\\/][^\s<>:"|?*]+)*)/g;
const POSIX_PRIVATE_PATH = /\/(?:Users|home|root|private|var\/folders|tmp)(?:\/[^\s<>'"`]+)+/g;

export function redactRunInspectionText(value: string): string {
  return value
    .replace(PEM, "[REDACTED CREDENTIAL]")
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(COOKIE, "Cookie: [REDACTED]")
    .replace(SECRET_ASSIGNMENT, "credential=[REDACTED]")
    .replace(URL_SECRET, "$1[REDACTED]")
    .replace(URL_USERINFO, "$1[REDACTED]@")
    .replace(WINDOWS_PRIVATE_PATH, "[REDACTED PRIVATE PATH]")
    .replace(POSIX_PRIVATE_PATH, "[REDACTED PRIVATE PATH]");
}

export function sanitizeRunInspectionValue(value: unknown, key = "", depth = 0): unknown {
  if (depth >= 10) return "[TRUNCATED: depth limit]";
  if (SENSITIVE_KEY.test(key) || PRIVATE_REASONING_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return bound(redactRunInspectionText(value), 4_096);
  if (Array.isArray(value)) {
    const rows = value.slice(0, 100).map((entry) => sanitizeRunInspectionValue(entry, key, depth + 1));
    if (value.length > 100) rows.push({ _truncated_items: value.length - 100 });
    return rows;
  }
  if (value && typeof value === "object") {
    const rows = Object.entries(value as Record<string, unknown>).slice(0, 100);
    const result = Object.fromEntries(rows.map(([child, entry]) => [child, sanitizeRunInspectionValue(entry, child, depth + 1)]));
    if (Object.keys(value as object).length > 100) result._truncated_fields = Object.keys(value as object).length - 100;
    return result;
  }
  return value;
}

export function sanitizeRunInspection(input: RunInspection): RunInspection {
  const run = input.run;
  return {
    schema_version: input.schema_version,
    run: {
      run_id: safeIdentifier(run.run_id),
      session_id: safeIdentifier(run.session_id),
      workspace_id: safeIdentifier(run.workspace_id),
      backend_id: safeLabel(run.backend_id),
      agent_definition: safeLabel(run.agent_definition),
      status: safeLabel(run.status),
      created_at: safeLabel(run.created_at),
      ...(run.started_at ? { started_at: safeLabel(String(run.started_at)) } : {}),
      ...(run.completed_at ? { completed_at: safeLabel(String(run.completed_at)) } : {}),
    },
    summary: {
      duration_ms: finiteOrNull(input.summary.duration_ms),
      counts_by_item_type: safeCounts(input.summary.counts_by_item_type),
      counts_by_status: safeCounts(input.summary.counts_by_status),
      error: input.summary.error ? {
        code: safeLabel(input.summary.error.code),
        message: bound(redactRunInspectionText(input.summary.error.message), 500),
        retryable: input.summary.error.retryable === true,
      } : null,
      usage: {
        input_tokens: nonnegative(input.summary.usage.input_tokens),
        output_tokens: nonnegative(input.summary.usage.output_tokens),
        total_tokens: nonnegative(input.summary.usage.total_tokens),
      },
      artifact_count: nonnegative(input.summary.artifact_count),
      warning_count: nonnegative(input.summary.warning_count),
    },
    timeline: input.timeline.slice(0, 500).map(sanitizeTimelineItem),
    manifest: sanitizeRunReproductionManifest(input.manifest),
    page: {
      next_cursor: input.page.next_cursor ? safeIdentifier(input.page.next_cursor) : null,
      has_more: input.page.has_more === true,
    },
  };
}

export function sanitizeRunReproductionManifest(input: RunReproductionManifest): RunReproductionManifest {
  const manifest = sanitizeRunInspectionValue(input.manifest) as Record<string, unknown>;
  const prompt = input.manifest.prompt && typeof input.manifest.prompt === "object"
    ? input.manifest.prompt as Record<string, unknown> : {};
  const evidenceInput = input.manifest.input && typeof input.manifest.input === "object"
    ? input.manifest.input as Record<string, unknown> : {};
  manifest.prompt = allowKeys(prompt, ["id", "version", "digest", "template_digest"]);
  manifest.input = allowKeys(evidenceInput, ["sha256", "length", "resource_digest"]);
  return {
    schema_version: safeLabel(input.schema_version),
    run_id: safeIdentifier(input.run_id),
    manifest,
    manifest_digest: safeDigest(input.manifest_digest),
    safe_manifest_digest: safeDigest(input.safe_manifest_digest),
    reproducibility_level: input.reproducibility_level,
    missing_evidence: input.missing_evidence.slice(0, 100).map((item) => bound(redactRunInspectionText(String(item)), 240)),
    created_at: safeLabel(input.created_at),
    finalized_at: input.finalized_at ? safeLabel(input.finalized_at) : null,
    ...(input.exported_at ? { exported_at: safeLabel(input.exported_at) } : {}),
    ...(input.privacy_notice ? { privacy_notice: bound(redactRunInspectionText(input.privacy_notice), 1_000) } : {}),
    ...(input.integrity ? { integrity: {
      algorithm: "sha256",
      digest_scope: "safe_manifest",
      digest: safeDigest(input.integrity.digest),
    } } : {}),
  };
}

export function sanitizeSessionRunList(input: SessionRunList): SessionRunList {
  return {
    schema_version: input.schema_version,
    object: "list",
    data: input.data.slice(0, 500).map((row) => ({
      ...(sanitizeRunInspectionValue(row) as Record<string, unknown>),
      run_id: safeIdentifier(row.run_id),
      relation_type: ["root", "subagent", "experiment_replay", "retry"].includes(String(row.relation_type))
        ? row.relation_type : "unknown",
      manifest: sanitizeRunReproductionManifest(row.manifest),
    })),
    next_cursor: input.next_cursor ? safeIdentifier(input.next_cursor) : null,
    has_more: input.has_more === true,
  };
}

function sanitizeTimelineItem(item: RunInspectionTimelineItem): RunInspectionTimelineItem {
  const safe = sanitizeRunInspectionValue(item) as unknown as RunInspectionTimelineItem;
  if (item.type === "reasoning") {
    const content = item.content as unknown as Record<string, unknown>;
    const publicSummary = typeof content.public_summary === "string" ? content.public_summary
      : typeof content.summary === "string" ? content.summary : undefined;
    safe.content = {
      segments: [],
      ...(publicSummary ? { summary: bound(redactRunInspectionText(publicSummary), 2_000) } : {}),
    } as OaepItem["content"];
  }
  safe.event_refs = item.event_refs.slice(0, 100).map((ref) => ({
    event_id: safeIdentifier(ref.event_id),
    sequence: nonnegative(ref.sequence),
  }));
  return safe;
}

function allowKeys(value: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, sanitizeRunInspectionValue(value[key], key)]));
}

function safeCounts(value: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, count]) => [safeLabel(key), nonnegative(count)]));
}

function safeIdentifier(value: unknown): string { return bound(redactRunInspectionText(String(value ?? "")).replace(/[^a-zA-Z0-9:._~-]/g, "-"), 320); }
function safeLabel(value: unknown): string { return bound(redactRunInspectionText(String(value ?? "")), 320); }
function safeDigest(value: unknown): string { const text = String(value ?? ""); return /^(?:sha256:)?[a-f0-9]{64}$/i.test(text) ? text : "[INVALID DIGEST]"; }
function nonnegative(value: unknown): number { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; }
function finiteOrNull(value: unknown): number | null { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }
function bound(value: string, maximum: number): string { return value.length <= maximum ? value : `${value.slice(0, maximum)}…[truncated]`; }
