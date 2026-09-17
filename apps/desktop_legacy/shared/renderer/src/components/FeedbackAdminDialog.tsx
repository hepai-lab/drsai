import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Trash2, X } from "lucide-react";
import type { FeedbackAdminRecord, FeedbackStatus } from "@shared/feedback";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";

const statuses: FeedbackStatus[] = ["received", "triaged", "investigating", "needs_info", "planned", "fixed", "closed"];

export function FeedbackAdminDialog({ language, onClose }: { language: AppLanguage; onClose(): void }): React.JSX.Element {
  const zh = language === "zh";
  const [items, setItems] = useState<FeedbackAdminRecord[]>([]);
  const [filter, setFilter] = useState<FeedbackStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = useMemo(() => items.find((item) => item.feedback_id === selectedId) ?? items[0] ?? null, [items, selectedId]);

  async function refresh(): Promise<void> { setBusy(true); setError(""); try { const next = await desktopApi.listFeedbackAdmin(filter === "all" ? undefined : filter); setItems(next); if (!next.some((item) => item.feedback_id === selectedId)) setSelectedId(next[0]?.feedback_id ?? null); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } }
  useEffect(() => { void refresh(); }, [filter]);
  async function update(status: FeedbackStatus, owner?: string): Promise<void> { if (!selected) return; setBusy(true); try { const next = await desktopApi.updateFeedbackAdmin(selected.feedback_id, { status, recommended_owner: owner, note: "Updated in Desktop feedback console." }); setItems((current) => current.map((item) => item.feedback_id === next.feedback_id ? next : item)); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } }

  return <div className="feedback-overlay" role="presentation" onMouseDown={onClose}><section className="feedback-admin-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-admin-title" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><h2 id="feedback-admin-title">{zh ? "反馈处理台" : "Feedback console"}</h2><small>{zh ? "Agent 建议必须由人工确认" : "Agent recommendations require human confirmation"}</small></div><button type="button" onClick={onClose}><X size={18} /></button></header>
    <div className="feedback-admin-toolbar"><select value={filter} onChange={(event) => setFilter(event.target.value as FeedbackStatus | "all")}><option value="all">{zh ? "全部状态" : "All statuses"}</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select><button type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} />{zh ? "刷新" : "Refresh"}</button></div>
    {error ? <div className="feedback-error" role="alert">{error}</div> : null}
    <div className="feedback-admin-body"><aside>{items.map((item) => <button type="button" className={selected?.feedback_id === item.feedback_id ? "selected" : ""} key={item.feedback_id} onClick={() => setSelectedId(item.feedback_id)}><strong>{item.triage?.summary || item.user_description || item.feedback_id}</strong><span>{item.status} · {item.category}</span><small>{new Date(item.created_at).toLocaleString()}</small></button>)}{!items.length ? <p>{busy ? (zh ? "加载中…" : "Loading…") : (zh ? "暂无反馈" : "No feedback")}</p> : null}</aside>
      {selected ? <article><h3>{selected.feedback_id}</h3><dl><dt>{zh ? "分类" : "Category"}</dt><dd>{selected.category}</dd><dt>{zh ? "来源" : "Source"}</dt><dd>{selected.source}</dd><dt>{zh ? "模块" : "Module"}</dt><dd>{selected.triage?.module || selected.context.module}</dd><dt>{zh ? "严重度" : "Severity"}</dt><dd>{selected.triage?.severity || "untriaged"}</dd><dt>{zh ? "重复于" : "Duplicate of"}</dt><dd>{selected.duplicate_of || "—"}</dd><dt>{zh ? "诊断" : "Diagnostics"}</dt><dd>{selected.diagnostics.attached ? `${Math.ceil(selected.diagnostics.byte_length / 1024)} KB` : "—"}</dd></dl><p>{selected.user_description || (zh ? "用户未填写描述。" : "No user description.")}</p><label>{zh ? "状态" : "Status"}<select value={selected.status} disabled={busy} onChange={(event) => void update(event.target.value as FeedbackStatus)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label><label>{zh ? "负责人" : "Owner"}<input defaultValue={selected.triage?.recommended_owner || ""} onBlur={(event) => { if (event.target.value !== (selected.triage?.recommended_owner || "")) void update(selected.status, event.target.value); }} /></label><button type="button" className="danger" disabled={busy} onClick={() => void desktopApi.deleteFeedbackAdmin(selected.feedback_id).then(() => setItems((current) => current.filter((item) => item.feedback_id !== selected.feedback_id)))}><Trash2 size={14} />{zh ? "删除反馈及附件" : "Delete feedback and attachments"}</button></article> : null}
    </div>
  </section></div>;
}

