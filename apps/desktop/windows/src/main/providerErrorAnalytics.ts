import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type { ProviderErrorAnalyticsEvent } from "./sseParser";
import { DRSAI_HOME } from "./paths";

const PROVIDER_ERROR_ANALYTICS_FILE = join(DRSAI_HOME, "desktop", "provider-error-analytics.json");
const MAX_PROVIDER_ERROR_RECORDS = 200;
const MAX_TEXT_CHARS = 320;
const MAX_ID_CHARS = 160;

export interface ProviderErrorAnalyticsRecord extends ProviderErrorAnalyticsEvent {
  id: string;
  recordedAt: string;
  requestId: string;
  sessionId: string;
  runId: string;
}

interface ProviderErrorAnalyticsStore {
  version: 1;
  records: ProviderErrorAnalyticsRecord[];
}

export async function persistProviderErrorAnalytics(input: {
  requestId: string;
  sessionId: string;
  runId: string;
  event: ProviderErrorAnalyticsEvent;
}): Promise<ProviderErrorAnalyticsRecord | null> {
  const record = normalizeRecord(input);
  if (!record) return null;
  const store = await readProviderErrorAnalyticsStore();
  const records = [record, ...store.records]
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
    .slice(0, MAX_PROVIDER_ERROR_RECORDS);
  await writeProviderErrorAnalyticsStore({ version: 1, records });
  return record;
}

export async function listProviderErrorAnalytics(): Promise<ProviderErrorAnalyticsRecord[]> {
  return (await readProviderErrorAnalyticsStore()).records.map((record) => ({ ...record }));
}

async function readProviderErrorAnalyticsStore(): Promise<ProviderErrorAnalyticsStore> {
  try {
    const parsed = JSON.parse(await readFile(PROVIDER_ERROR_ANALYTICS_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyStore();
    const records = Array.isArray((parsed as ProviderErrorAnalyticsStore).records)
      ? (parsed as ProviderErrorAnalyticsStore).records
        .filter(isProviderErrorAnalyticsRecord)
        .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
        .slice(0, MAX_PROVIDER_ERROR_RECORDS)
      : [];
    return { version: 1, records };
  } catch {
    return emptyStore();
  }
}

async function writeProviderErrorAnalyticsStore(store: ProviderErrorAnalyticsStore): Promise<void> {
  await mkdir(dirname(PROVIDER_ERROR_ANALYTICS_FILE), { recursive: true });
  await writeFile(PROVIDER_ERROR_ANALYTICS_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function normalizeRecord(input: {
  requestId: string;
  sessionId: string;
  runId: string;
  event: ProviderErrorAnalyticsEvent;
}): ProviderErrorAnalyticsRecord | null {
  const message = normalizeText(input.event.message, MAX_TEXT_CHARS);
  const summary = normalizeText(input.event.summary, MAX_TEXT_CHARS);
  if (!message || !summary) return null;
  return {
    id: `provider-error:${randomUUID()}`,
    recordedAt: new Date().toISOString(),
    requestId: normalizeText(input.requestId, MAX_ID_CHARS) || "unknown-request",
    sessionId: normalizeText(input.sessionId, MAX_ID_CHARS) || "unknown-session",
    runId: normalizeText(input.runId, MAX_ID_CHARS) || "unknown-run",
    provider: input.event.provider,
    eventName: normalizeText(input.event.eventName, 120) || input.event.provider,
    ...(normalizeText(input.event.code, 120) ? { code: normalizeText(input.event.code, 120) } : {}),
    message,
    retryable: input.event.retryable === true,
    summary,
  };
}

function isProviderErrorAnalyticsRecord(value: unknown): value is ProviderErrorAnalyticsRecord {
  const record = value as ProviderErrorAnalyticsRecord;
  return Boolean(
    record &&
      typeof record.id === "string" &&
      record.id.startsWith("provider-error:") &&
      typeof record.recordedAt === "string" &&
      typeof record.requestId === "string" &&
      typeof record.sessionId === "string" &&
      typeof record.runId === "string" &&
      (record.provider === "openai_responses" || record.provider === "anthropic" || record.provider === "google_gemini") &&
      typeof record.eventName === "string" &&
      typeof record.message === "string" &&
      typeof record.retryable === "boolean" &&
      typeof record.summary === "string",
  );
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function emptyStore(): ProviderErrorAnalyticsStore {
  return { version: 1, records: [] };
}
