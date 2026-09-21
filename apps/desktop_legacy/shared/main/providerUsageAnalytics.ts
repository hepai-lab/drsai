import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type { ProviderUsageAnalyticsEvent } from "./sseParser";
import { DRSAI_HOME } from "./paths";

const PROVIDER_USAGE_ANALYTICS_FILE = join(DRSAI_HOME, "desktop", "provider-usage-analytics.json");
const MAX_PROVIDER_USAGE_RECORDS = 200;
const MAX_SUMMARY_CHARS = 320;
const MAX_ID_CHARS = 160;

export interface ProviderUsageAnalyticsRecord extends ProviderUsageAnalyticsEvent {
  id: string;
  recordedAt: string;
  requestId: string;
  sessionId: string;
  runId: string;
}

interface ProviderUsageAnalyticsStore {
  version: 1;
  records: ProviderUsageAnalyticsRecord[];
}

export async function persistProviderUsageAnalytics(input: {
  requestId: string;
  sessionId: string;
  runId: string;
  event: ProviderUsageAnalyticsEvent;
}): Promise<ProviderUsageAnalyticsRecord | null> {
  const record = normalizeRecord(input);
  if (!record) return null;
  const store = await readProviderUsageAnalyticsStore();
  const records = [record, ...store.records]
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
    .slice(0, MAX_PROVIDER_USAGE_RECORDS);
  await writeProviderUsageAnalyticsStore({ version: 1, records });
  return record;
}

export async function listProviderUsageAnalytics(): Promise<ProviderUsageAnalyticsRecord[]> {
  return (await readProviderUsageAnalyticsStore()).records.map((record) => ({ ...record }));
}

async function readProviderUsageAnalyticsStore(): Promise<ProviderUsageAnalyticsStore> {
  try {
    const parsed = JSON.parse(await readFile(PROVIDER_USAGE_ANALYTICS_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyStore();
    const records = Array.isArray((parsed as ProviderUsageAnalyticsStore).records)
      ? (parsed as ProviderUsageAnalyticsStore).records
        .filter(isProviderUsageAnalyticsRecord)
        .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
        .slice(0, MAX_PROVIDER_USAGE_RECORDS)
      : [];
    return { version: 1, records };
  } catch {
    return emptyStore();
  }
}

async function writeProviderUsageAnalyticsStore(store: ProviderUsageAnalyticsStore): Promise<void> {
  await mkdir(dirname(PROVIDER_USAGE_ANALYTICS_FILE), { recursive: true });
  await writeFile(PROVIDER_USAGE_ANALYTICS_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function normalizeRecord(input: {
  requestId: string;
  sessionId: string;
  runId: string;
  event: ProviderUsageAnalyticsEvent;
}): ProviderUsageAnalyticsRecord | null {
  const usage = normalizeUsage(input.event.usage);
  const hasUsage = Object.values(usage).some((value) => typeof value === "number");
  const summary = normalizeText(input.event.summary, MAX_SUMMARY_CHARS);
  if (!summary || !hasUsage) return null;
  return {
    id: `provider-usage:${randomUUID()}`,
    recordedAt: new Date().toISOString(),
    requestId: normalizeText(input.requestId, MAX_ID_CHARS) || "unknown-request",
    sessionId: normalizeText(input.sessionId, MAX_ID_CHARS) || "unknown-session",
    runId: normalizeText(input.runId, MAX_ID_CHARS) || "unknown-run",
    provider: input.event.provider,
    eventName: normalizeText(input.event.eventName, 120) || input.event.provider,
    ...(normalizeText(input.event.status, 80) ? { status: normalizeText(input.event.status, 80) } : {}),
    ...(normalizeText(input.event.stopReason, 80) ? { stopReason: normalizeText(input.event.stopReason, 80) } : {}),
    summary,
    usage,
  };
}

function normalizeUsage(usage: ProviderUsageAnalyticsEvent["usage"]): ProviderUsageAnalyticsRecord["usage"] {
  return {
    ...normalizeUsageNumber(usage.inputTokens, "inputTokens"),
    ...normalizeUsageNumber(usage.outputTokens, "outputTokens"),
    ...normalizeUsageNumber(usage.totalTokens, "totalTokens"),
  };
}

function normalizeUsageNumber(
  value: unknown,
  key: keyof ProviderUsageAnalyticsRecord["usage"],
): ProviderUsageAnalyticsRecord["usage"] {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { [key]: Math.trunc(value) }
    : {};
}

function isProviderUsageAnalyticsRecord(value: unknown): value is ProviderUsageAnalyticsRecord {
  const record = value as ProviderUsageAnalyticsRecord;
  return Boolean(
    record &&
      typeof record.id === "string" &&
      record.id.startsWith("provider-usage:") &&
      typeof record.recordedAt === "string" &&
      typeof record.requestId === "string" &&
      typeof record.sessionId === "string" &&
      typeof record.runId === "string" &&
      (record.provider === "openai_responses" || record.provider === "anthropic" || record.provider === "google_gemini") &&
      typeof record.eventName === "string" &&
      typeof record.summary === "string" &&
      record.usage &&
      typeof record.usage === "object",
  );
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function emptyStore(): ProviderUsageAnalyticsStore {
  return { version: 1, records: [] };
}
