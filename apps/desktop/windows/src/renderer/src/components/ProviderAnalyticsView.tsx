import { useEffect, useMemo, useState } from "react";
import { BarChart3, ChevronDown, ChevronRight, Copy, Download, FileSpreadsheet, RefreshCw, Search } from "lucide-react";
import type {
  DesktopProviderErrorAnalyticsRecord,
  DesktopProviderUsageAnalyticsRecord,
} from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";

type AnalyticsKind = "all" | "usage" | "error";
type ProviderFilter = "all" | "openai_responses" | "anthropic";

interface AnalyticsRow {
  id: string;
  kind: Exclude<AnalyticsKind, "all">;
  recordedAt: string;
  provider: ProviderFilter;
  eventName: string;
  requestId: string;
  sessionId: string;
  runId: string;
  summary: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  code?: string;
  retryable?: boolean;
}

interface AnalyticsChartItem {
  id: string;
  label: string;
  value: number;
  detail: string;
  tone: "usage" | "error" | "neutral";
}

interface AnalyticsTrendBucket {
  id: string;
  label: string;
  usageRecords: number;
  errorRecords: number;
  totalTokens: number;
}

export function ProviderAnalyticsView({
  language,
}: {
  language: AppLanguage;
}): React.JSX.Element {
  const zh = language === "zh";
  const [usageRecords, setUsageRecords] = useState<DesktopProviderUsageAnalyticsRecord[]>([]);
  const [errorRecords, setErrorRecords] = useState<DesktopProviderErrorAnalyticsRecord[]>([]);
  const [kind, setKind] = useState<AnalyticsKind>("all");
  const [provider, setProvider] = useState<ProviderFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [usage, errors] = await Promise.all([
        desktopApi.listProviderUsageAnalytics(),
        desktopApi.listProviderErrorAnalytics(),
      ]);
      setUsageRecords(usage);
      setErrorRecords(errors);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const rows = useMemo(() => {
    const usageRows: AnalyticsRow[] = usageRecords.map((record) => ({
      id: record.id,
      kind: "usage",
      recordedAt: record.recordedAt,
      provider: record.provider,
      eventName: record.eventName,
      requestId: record.requestId,
      sessionId: record.sessionId,
      runId: record.runId,
      summary: record.summary,
      inputTokens: record.usage.inputTokens,
      outputTokens: record.usage.outputTokens,
      totalTokens: record.usage.totalTokens,
    }));
    const errorRows: AnalyticsRow[] = errorRecords.map((record) => ({
      id: record.id,
      kind: "error",
      recordedAt: record.recordedAt,
      provider: record.provider,
      eventName: record.eventName,
      requestId: record.requestId,
      sessionId: record.sessionId,
      runId: record.runId,
      summary: record.summary,
      code: record.code,
      retryable: record.retryable,
    }));

    const normalizedQuery = query.trim().toLowerCase();
    return [...usageRows, ...errorRows]
      .filter((row) => kind === "all" || row.kind === kind)
      .filter((row) => provider === "all" || row.provider === provider)
      .filter((row) => {
        if (!normalizedQuery) return true;
        return [
          row.id,
          row.provider,
          row.eventName,
          row.requestId,
          row.sessionId,
          row.runId,
          row.summary,
          row.code ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
  }, [errorRecords, kind, provider, query, usageRecords]);

  const totalTokens = usageRecords.reduce(
    (total, record) => total + (record.usage.totalTokens ?? 0),
    0,
  );
  const retryableErrors = errorRecords.filter((record) => record.retryable).length;
  const chartGroups = useMemo(() => {
    const providerCounts = new Map<string, number>();
    const tokenCounts = new Map<string, number>();
    let nonRetryableErrors = 0;
    let filteredRetryableErrors = 0;

    for (const row of rows) {
      providerCounts.set(formatProvider(row.provider), (providerCounts.get(formatProvider(row.provider)) ?? 0) + 1);
      if (row.kind === "usage") {
        tokenCounts.set(formatProvider(row.provider), (tokenCounts.get(formatProvider(row.provider)) ?? 0) + (row.totalTokens ?? 0));
      } else if (row.retryable) {
        filteredRetryableErrors += 1;
      } else {
        nonRetryableErrors += 1;
      }
    }

    const providerItems = [...providerCounts.entries()].map(([label, value]) => ({
      id: `provider-${label}`,
      label,
      value,
      detail: zh ? `${value} records` : `${value} records`,
      tone: "neutral" as const,
    }));
    const tokenItems = [...tokenCounts.entries()].map(([label, value]) => ({
      id: `tokens-${label}`,
      label,
      value,
      detail: zh ? `${value} tokens` : `${value} tokens`,
      tone: "usage" as const,
    }));
    const errorItems: AnalyticsChartItem[] = [
      {
        id: "retryable-errors",
        label: zh ? "Retryable" : "Retryable",
        value: filteredRetryableErrors,
        detail: zh ? `${filteredRetryableErrors} errors` : `${filteredRetryableErrors} errors`,
        tone: "error",
      },
      {
        id: "non-retryable-errors",
        label: zh ? "Non-retryable" : "Non-retryable",
        value: nonRetryableErrors,
        detail: zh ? `${nonRetryableErrors} errors` : `${nonRetryableErrors} errors`,
        tone: "error",
      },
    ];

    return [
      {
        id: "provider-mix",
        title: zh ? "Provider mix" : "Provider mix",
        items: providerItems,
      },
      {
        id: "token-volume",
        title: zh ? "Token volume" : "Token volume",
        items: tokenItems,
      },
      {
        id: "error-retryability",
        title: zh ? "Error retryability" : "Error retryability",
        items: errorItems,
      },
    ];
  }, [rows, zh]);
  const trendBuckets = useMemo(() => {
    const buckets = new Map<string, AnalyticsTrendBucket>();

    for (const row of rows) {
      const dayKey = toTrendDayKey(row.recordedAt);
      const current =
        buckets.get(dayKey) ??
        {
          id: `trend-${dayKey}`,
          label: dayKey,
          usageRecords: 0,
          errorRecords: 0,
          totalTokens: 0,
        };

      if (row.kind === "usage") {
        current.usageRecords += 1;
        current.totalTokens += row.totalTokens ?? 0;
      } else {
        current.errorRecords += 1;
      }
      buckets.set(dayKey, current);
    }

    return [...buckets.values()].sort((left, right) => left.label.localeCompare(right.label)).slice(-8);
  }, [rows]);
  const trendPeak = Math.max(
    1,
    ...trendBuckets.map((bucket) => bucket.totalTokens + bucket.usageRecords + bucket.errorRecords),
  );

  async function copyFilteredJson(): Promise<void> {
    const payload = buildFilteredJson(rows);
    try {
      await navigator.clipboard.writeText(payload);
      setCopyMessage(zh ? "已复制筛选后的分析记录。" : "Filtered analytics copied.");
    } catch {
      setCopyMessage(zh ? "复制失败，请重试。" : "Copy failed.");
    }
  }

  async function copyFilteredCsv(): Promise<void> {
    const payload = buildFilteredCsv(rows);
    try {
      await navigator.clipboard.writeText(payload);
      setCopyMessage(zh ? "Filtered analytics CSV copied." : "Filtered analytics CSV copied.");
    } catch {
      setCopyMessage(zh ? "Copy failed." : "Copy failed.");
    }
  }

  function downloadFilteredFile(format: "json" | "csv"): void {
    const payload = format === "json" ? buildFilteredJson(rows) : buildFilteredCsv(rows);
    const mime = format === "json" ? "application/json" : "text/csv";
    const href = URL.createObjectURL(new Blob([payload], { type: `${mime};charset=utf-8` }));
    const link = document.createElement("a");
    link.href = href;
    link.download = `opendrsai-provider-analytics-${toExportTimestamp()}.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
    setCopyMessage(zh ? `Filtered analytics ${format.toUpperCase()} saved.` : `Filtered analytics ${format.toUpperCase()} saved.`);
  }

  return (
    <div className="provider-analytics-view">
      <header className="provider-analytics-header">
        <div>
          <span>{zh ? "Provider telemetry" : "Provider telemetry"}</span>
          <h2>{zh ? "Usage Analytics" : "Usage Analytics"}</h2>
        </div>
        <div className="provider-analytics-actions">
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={16} />
            {zh ? "Refresh" : "Refresh"}
          </button>
          <button type="button" onClick={() => void copyFilteredJson()} disabled={!rows.length}>
            <Copy size={16} />
            {zh ? "Copy JSON" : "Copy JSON"}
          </button>
          <button type="button" onClick={() => void copyFilteredCsv()} disabled={!rows.length}>
            <FileSpreadsheet size={16} />
            {zh ? "Copy CSV" : "Copy CSV"}
          </button>
          <button type="button" onClick={() => downloadFilteredFile("json")} disabled={!rows.length}>
            <Download size={16} />
            {zh ? "Save JSON" : "Save JSON"}
          </button>
          <button type="button" onClick={() => downloadFilteredFile("csv")} disabled={!rows.length}>
            <Download size={16} />
            {zh ? "Save CSV" : "Save CSV"}
          </button>
        </div>
      </header>

      <dl className="provider-analytics-summary-grid">
        <div>
          <dt>{zh ? "Usage records" : "Usage records"}</dt>
          <dd>{usageRecords.length}</dd>
        </div>
        <div>
          <dt>{zh ? "Error records" : "Error records"}</dt>
          <dd>{errorRecords.length}</dd>
        </div>
        <div>
          <dt>{zh ? "Total tokens" : "Total tokens"}</dt>
          <dd>{totalTokens}</dd>
        </div>
        <div>
          <dt>{zh ? "Retryable errors" : "Retryable errors"}</dt>
          <dd>{retryableErrors}</dd>
        </div>
      </dl>

      <section className="provider-analytics-chart-grid" aria-label={zh ? "Provider analytics charts" : "Provider analytics charts"}>
        {chartGroups.map((group) => (
          <article className="provider-analytics-chart-card" key={group.id}>
            <header>
              <BarChart3 size={16} />
              <h3>{group.title}</h3>
            </header>
            <div className="provider-analytics-bars">
              {group.items.length === 0 || group.items.every((item) => item.value === 0) ? (
                <div className="provider-analytics-chart-empty">{zh ? "No matching records" : "No matching records"}</div>
              ) : (
                group.items.map((item) => (
                  <div className={`provider-analytics-bar-row ${item.tone}`} key={item.id}>
                    <span>{item.label}</span>
                    <div className="provider-analytics-bar-track" aria-hidden="true">
                      <div style={{ width: `${chartBarWidth(item.value, group.items)}%` }} />
                    </div>
                    <strong>{item.detail}</strong>
                  </div>
                ))
              )}
            </div>
          </article>
        ))}
      </section>

      <section className="provider-analytics-trend-card" aria-label={zh ? "Provider analytics local trend" : "Provider analytics local trend"}>
        <header>
          <BarChart3 size={16} />
          <h3>{zh ? "Local trend" : "Local trend"}</h3>
        </header>
        {trendBuckets.length === 0 ? (
          <div className="provider-analytics-chart-empty">{zh ? "No matching records" : "No matching records"}</div>
        ) : (
          <div className="provider-analytics-trend-bars">
            {trendBuckets.map((bucket) => (
              <div className="provider-analytics-trend-item" key={bucket.id}>
                <div className="provider-analytics-trend-stack" aria-hidden="true">
                  <span
                    className="usage"
                    style={{ height: `${chartBarHeight(bucket.totalTokens + bucket.usageRecords, trendPeak)}%` }}
                  />
                  <span
                    className="error"
                    style={{ height: `${chartBarHeight(bucket.errorRecords, trendPeak)}%` }}
                  />
                </div>
                <strong>{bucket.label}</strong>
                <span>
                  {bucket.totalTokens} tokens / {bucket.errorRecords} errors
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="provider-analytics-controls">
        <label className="provider-analytics-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={zh ? "Search provider, event, request, code" : "Search provider, event, request, code"}
          />
        </label>
        <select value={kind} onChange={(event) => setKind(event.target.value as AnalyticsKind)}>
          <option value="all">{zh ? "All records" : "All records"}</option>
          <option value="usage">{zh ? "Usage only" : "Usage only"}</option>
          <option value="error">{zh ? "Errors only" : "Errors only"}</option>
        </select>
        <select value={provider} onChange={(event) => setProvider(event.target.value as ProviderFilter)}>
          <option value="all">{zh ? "All providers" : "All providers"}</option>
          <option value="openai_responses">OpenAI Responses</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </section>

      {copyMessage && <div className="provider-analytics-message">{copyMessage}</div>}
      {error && <div className="provider-analytics-error">{error}</div>}
      {loading ? (
        <div className="provider-analytics-empty">{zh ? "Loading analytics..." : "Loading analytics..."}</div>
      ) : rows.length === 0 ? (
        <div className="provider-analytics-empty">
          {zh ? "No provider analytics records match the current filters." : "No provider analytics records match the current filters."}
        </div>
      ) : (
        <div className="provider-analytics-table" role="table" aria-label={zh ? "Provider analytics records" : "Provider analytics records"}>
          <div className="provider-analytics-table-head" role="row">
            <span>{zh ? "Type" : "Type"}</span>
            <span>{zh ? "Provider" : "Provider"}</span>
            <span>{zh ? "Event" : "Event"}</span>
            <span>{zh ? "Evidence" : "Evidence"}</span>
            <span>{zh ? "Recorded" : "Recorded"}</span>
          </div>
          {rows.map((row) => (
            <article className={`provider-analytics-row ${row.kind}`} role="row" key={row.id}>
              <span className="provider-analytics-kind">{row.kind}</span>
              <span>{formatProvider(row.provider)}</span>
              <span>{row.eventName}</span>
              <div>
                <strong>{formatEvidence(row)}</strong>
                <p>{row.summary}</p>
                <code>{row.requestId}</code>
                <button
                  className="provider-analytics-detail-toggle"
                  type="button"
                  onClick={() => setExpandedRowId(expandedRowId === row.id ? null : row.id)}
                  aria-expanded={expandedRowId === row.id}
                >
                  {expandedRowId === row.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  {zh ? "Details" : "Details"}
                </button>
                {expandedRowId === row.id && (
                  <dl className="provider-analytics-detail">
                    <div>
                      <dt>{zh ? "Session" : "Session"}</dt>
                      <dd>{row.sessionId || "-"}</dd>
                    </div>
                    <div>
                      <dt>{zh ? "Run" : "Run"}</dt>
                      <dd>{row.runId || "-"}</dd>
                    </div>
                    <div>
                      <dt>{zh ? "Record" : "Record"}</dt>
                      <dd>{row.id}</dd>
                    </div>
                    <div>
                      <dt>{zh ? "Safe payload" : "Safe payload"}</dt>
                      <dd>
                        <code>{JSON.stringify(toSafeAnalyticsRecord(row))}</code>
                      </dd>
                    </div>
                  </dl>
                )}
              </div>
              <time dateTime={row.recordedAt}>{formatRecordedAt(row.recordedAt)}</time>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function toSafeAnalyticsRecord(row: AnalyticsRow): Record<string, unknown> {
  return {
    usage: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
    },
    code: row.code,
    retryable: row.retryable,
  };
}

function toSafeAnalyticsExportRow(row: AnalyticsRow): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    recordedAt: row.recordedAt,
    provider: row.provider,
    eventName: row.eventName,
    requestId: row.requestId,
    sessionId: row.sessionId,
    runId: row.runId,
    summary: row.summary,
    ...toSafeAnalyticsRecord(row),
  };
}

function buildFilteredJson(rows: AnalyticsRow[]): string {
  return JSON.stringify(rows.map(toSafeAnalyticsExportRow), null, 2);
}

function buildFilteredCsv(rows: AnalyticsRow[]): string {
  const header = [
    "id",
    "kind",
    "recordedAt",
    "provider",
    "eventName",
    "requestId",
    "sessionId",
    "runId",
    "summary",
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "code",
    "retryable",
  ];
  const lines = rows.map((row) =>
    [
      row.id,
      row.kind,
      row.recordedAt,
      row.provider,
      row.eventName,
      row.requestId,
      row.sessionId,
      row.runId,
      row.summary,
      row.inputTokens,
      row.outputTokens,
      row.totalTokens,
      row.code,
      row.retryable,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function toExportTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function chartBarWidth(value: number, items: AnalyticsChartItem[]): number {
  const max = Math.max(...items.map((item) => item.value), 1);
  if (value <= 0) return 0;
  return Math.max(8, Math.round((value / max) * 100));
}

function chartBarHeight(value: number, max: number): number {
  if (value <= 0) return 0;
  return Math.max(8, Math.round((value / Math.max(max, 1)) * 100));
}

function formatProvider(provider: ProviderFilter): string {
  if (provider === "openai_responses") return "OpenAI Responses";
  if (provider === "anthropic") return "Anthropic";
  return "All";
}

function formatEvidence(row: AnalyticsRow): string {
  if (row.kind === "usage") {
    return `tokens ${row.totalTokens ?? "-"} / in ${row.inputTokens ?? "-"} / out ${row.outputTokens ?? "-"}`;
  }
  return `${row.code ?? "provider_error"}${row.retryable ? " / retryable" : ""}`;
}

function formatRecordedAt(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(time));
}

function toTrendDayKey(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value.slice(0, 10) || "unknown";
  return new Date(time).toISOString().slice(0, 10);
}
