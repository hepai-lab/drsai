import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Clipboard, Loader2, RefreshCw, X } from "lucide-react";
import type { DiagnosticStatus, RedactedDiagnosticTrace } from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";
import { desktopApi } from "../../desktopApi";
import { copyTextSafely } from "../../clipboard";

interface ChatDiagnosticsPanelProps {
  language: AppLanguage;
  traceId?: string;
  onClose?: () => void;
}

type LoadState = "idle" | "loading" | "ready" | "missing" | "error";

export function ChatDiagnosticsPanel({ language, traceId, onClose }: ChatDiagnosticsPanelProps) {
  const zh = language === "zh";
  const [state, setState] = useState<LoadState>("idle");
  const [trace, setTrace] = useState<RedactedDiagnosticTrace | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!traceId) {
      setTrace(null);
      setState("idle");
      return;
    }
    setState("loading");
    try {
      const next = await desktopApi.getRedactedDiagnosticTrace(traceId);
      setTrace(next);
      setState(next ? "ready" : "missing");
    } catch {
      setTrace(null);
      setState("error");
    }
  }, [traceId]);

  useEffect(() => { void load(); }, [load]);

  async function copyDiagnostics(): Promise<void> {
    if (!trace) return;
    try {
      const copied = await copyTextSafely(JSON.stringify(trace, null, 2));
      if (!copied) throw new Error("Clipboard write failed.");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return <section className="chat-diagnostics-panel" aria-label={zh ? "聊天诊断" : "Chat diagnostics"}>
    <header className="chat-diagnostics-header">
      <div>
        <strong>{zh ? "聊天诊断" : "Chat diagnostics"}</strong>
        <small>{zh ? "仅显示经过脱敏的本次运行信息" : "Only redacted information for this run is shown"}</small>
      </div>
      {onClose ? <button type="button" className="icon-button" onClick={onClose} aria-label={zh ? "关闭诊断" : "Close diagnostics"}><X size={16} /></button> : null}
    </header>

    {!traceId ? <div className="chat-diagnostics-empty"><AlertTriangle size={20} /><p>{zh ? "请选择一条失败消息以查看对应诊断。" : "Select a failed message to view its diagnostics."}</p></div> : null}
    {state === "loading" ? <div className="chat-diagnostics-empty"><Loader2 className="spin" size={20} /><p>{zh ? "正在加载脱敏诊断…" : "Loading redacted diagnostics…"}</p></div> : null}
    {state === "missing" ? <div className="chat-diagnostics-empty"><AlertTriangle size={20} /><p>{zh ? "未找到这次运行的诊断记录，记录可能已被清理。" : "Diagnostics for this run were not found or have been cleared."}</p><button type="button" onClick={() => void load()}><RefreshCw size={14} />{zh ? "重试" : "Retry"}</button></div> : null}
    {state === "error" ? <div className="chat-diagnostics-empty"><AlertTriangle size={20} /><p>{zh ? "诊断加载失败，不会影响当前会话。" : "Diagnostics could not be loaded. The conversation is unaffected."}</p><button type="button" onClick={() => void load()}><RefreshCw size={14} />{zh ? "重试" : "Retry"}</button></div> : null}

    {state === "ready" && trace ? <div className="chat-diagnostics-content">
      <div className="chat-diagnostics-actions">
        <button type="button" onClick={() => void load()}><RefreshCw size={14} />{zh ? "刷新" : "Refresh"}</button>
        <button type="button" onClick={() => void copyDiagnostics()}>{copied ? <Check size={14} /> : <Clipboard size={14} />}{copied ? (zh ? "已复制" : "Copied") : (zh ? "复制脱敏诊断" : "Copy redacted diagnostics")}</button>
      </div>
      <dl className="chat-diagnostics-summary">
        <div><dt>{zh ? "状态" : "Status"}</dt><dd data-status={trace.status}>{formatStatus(trace.status, zh)}</dd></div>
        <div><dt>{zh ? "开始时间" : "Started"}</dt><dd>{formatTime(trace.startedAt, language)}</dd></div>
        {trace.endedAt ? <div><dt>{zh ? "结束时间" : "Ended"}</dt><dd>{formatTime(trace.endedAt, language)}</dd></div> : null}
        {typeof trace.durationMs === "number" ? <div><dt>{zh ? "耗时" : "Duration"}</dt><dd>{formatDuration(trace.durationMs)}</dd></div> : null}
        <div><dt>{zh ? "操作" : "Operation"}</dt><dd>{trace.rootOperation}</dd></div>
        <div><dt>{zh ? "请求 ID" : "Request ID"}</dt><dd title={trace.traceId}>{trace.traceId}</dd></div>
      </dl>
      <div className="chat-diagnostics-timeline">
        <h3>{zh ? "事件时间线" : "Event timeline"}</h3>
        {trace.events.length ? <ol>{trace.events.map((event) => <li key={event.id} data-level={event.level}>
          <span className="chat-diagnostics-event-dot" aria-hidden="true" />
          <div><time dateTime={event.timestamp}>{formatTime(event.timestamp, language)}</time><strong>{event.operation}</strong><p>{event.message}</p>{event.errorCode ? <code>{event.errorCode}</code> : null}</div>
        </li>)}</ol> : <p className="chat-diagnostics-muted">{zh ? "暂无事件记录。" : "No events recorded."}</p>}
      </div>
    </div> : null}
  </section>;
}

function formatTime(value: string, language: AppLanguage): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "medium" }).format(timestamp);
}

function formatDuration(value: number): string {
  if (value < 1000) return `${Math.max(0, Math.round(value))} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`;
}

function formatStatus(status: DiagnosticStatus, zh: boolean): string {
  const labels: Record<DiagnosticStatus, [string, string]> = {
    started: ["已开始", "Started"],
    running: ["运行中", "Running"],
    waiting: ["等待中", "Waiting"],
    completed: ["已完成", "Completed"],
    failed: ["失败", "Failed"],
    cancelled: ["已取消", "Cancelled"],
  };
  return labels[status][zh ? 0 : 1];
}
