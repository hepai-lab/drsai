import { useEffect, useRef, useState } from "react";
import { AlertCircle, Clock3 } from "lucide-react";
import type { SessionRunList } from "@shared/runInspection";
import { desktopApi } from "../desktopApi";

export function SessionRunHistory({ workspacePath, workspaceId, sessionId, selectedRunId, language, onSelectRun }: {
  workspacePath: string; workspaceId?: string; sessionId: string; selectedRunId: string;
  language: "en" | "zh"; onSelectRun: (runId: string) => void;
}): React.JSX.Element {
  const zh = language === "zh";
  const [listing, setListing] = useState<SessionRunList | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [visibleStart, setVisibleStart] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setListing(null); setVisibleStart(0); setLoading(true); setError("");
    void desktopApi.listSessionRuns({ workspacePath, workspaceId, sessionId, limit: 100, status: status || undefined })
      .then((value) => { if (current === generation.current) setListing(value); })
      .catch((reason: unknown) => { if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (current === generation.current) setLoading(false); });
  }, [sessionId, status, workspaceId, workspacePath]);

  async function loadMore(): Promise<void> {
    if (!listing?.has_more || !listing.next_cursor || loading) return;
    const current = generation.current;
    setLoading(true); setError("");
    try {
      const next = await desktopApi.listSessionRuns({ workspacePath, workspaceId, sessionId, cursor: listing.next_cursor, limit: 100, status: status || undefined });
      if (current !== generation.current) return;
      setListing((previous) => {
        const combined = previous ? dedupeRuns([...previous.data, ...next.data]) : next.data;
        setVisibleStart(Math.max(0, combined.length - 50));
        return { ...next, data: combined };
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (current === generation.current) setLoading(false); }
  }

  return <details className="run-inspector-section run-history" open>
    <summary><Clock3 size={14} />{zh ? "本会话运行历史" : "Session run history"}</summary>
    <div className="run-inspector-filters"><label>{zh ? "状态" : "Status"}<select value={status} onChange={(event) => setStatus(event.target.value)}>
      <option value="">{zh ? "全部" : "All"}</option>
      {["queued", "running", "waiting_approval", "completed", "failed", "cancelled"].map((value) => <option key={value} value={value}>{statusLabel(value, language)}</option>)}
    </select></label></div>
    {error ? <p className="run-inspector-inline-error" role="alert"><AlertCircle size={14} />{error}</p> : null}
    {listing?.data.length ? <ol className="run-history-list" data-rendered-runs={Math.min(50, listing.data.length - visibleStart)}>{listing.data.slice(visibleStart, visibleStart + 50).map((run) => {
      const runStatus = String(run.status || "unknown");
      const relation = relationLabel(run.relation_type, language);
      return <li key={run.run_id}><button type="button" aria-current={run.run_id === selectedRunId ? "true" : undefined} onClick={() => onSelectRun(run.run_id)}>
        <span>{statusLabel(runStatus, language)}{relation ? ` · ${relation}` : ""}</span>
        <small>{formatTime(String(run.created_at || ""))} · {run.run_id}</small>
      </button></li>;
    })}</ol> : loading ? null : <p className="run-inspector-muted">{zh ? "没有符合条件的运行。" : "No Runs match this filter."}</p>}
    {listing && listing.data.length > 50 ? <div className="run-inspector-window-controls">
      <button type="button" disabled={visibleStart === 0} onClick={() => setVisibleStart(Math.max(0, visibleStart - 50))}>{zh ? "上一段" : "Previous window"}</button>
      <span>{visibleStart + 1}–{Math.min(visibleStart + 50, listing.data.length)} / {listing.data.length}</span>
      <button type="button" disabled={visibleStart + 50 >= listing.data.length} onClick={() => setVisibleStart(Math.min(Math.max(0, listing.data.length - 50), visibleStart + 50))}>{zh ? "下一段" : "Next window"}</button>
    </div> : null}
    {listing?.has_more ? <button type="button" className="run-inspector-load-more" disabled={loading} onClick={() => void loadMore()}>{loading ? (zh ? "加载中…" : "Loading…") : (zh ? "加载更多" : "Load more")}</button> : null}
    {loading && !listing ? <p role="status">{zh ? "正在加载运行历史…" : "Loading Run history…"}</p> : null}
  </details>;
}

function dedupeRuns(runs: SessionRunList["data"]): SessionRunList["data"] { return [...new Map(runs.map((run) => [run.run_id, run])).values()]; }
function statusLabel(status: string, language: "en" | "zh"): string {
  const labels: Record<string, [string, string]> = { queued: ["Queued", "排队中"], running: ["Running", "运行中"], waiting_approval: ["Waiting approval", "等待审批"], completed: ["Completed", "已完成"], failed: ["Failed", "失败"], cancelled: ["Cancelled", "已取消"] };
  return labels[status]?.[language === "zh" ? 1 : 0] ?? status;
}
function relationLabel(relation: SessionRunList["data"][number]["relation_type"], language: "en" | "zh"): string {
  if (relation === "experiment_replay") return language === "zh" ? "实验重放" : "Experiment replay";
  if (relation === "subagent") return language === "zh" ? "子智能体" : "Subagent";
  if (relation === "retry") return language === "zh" ? "重试" : "Retry";
  return "";
}
function formatTime(value: string): string { if (!value) return "—"; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(); }
