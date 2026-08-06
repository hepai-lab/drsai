import { useEffect, useRef, useState } from "react";
import type { RunAdoption, RunComparison, RuntimeApprovalRequired } from "@shared/runExperiment";
import type { RunInspectionOpenRequest } from "@shared/runInspection";
import { desktopApi } from "../desktopApi";

export function RunComparisonView({ comparison, request, language }: {
  comparison: RunComparison; request: RunInspectionOpenRequest; language: "en" | "zh";
}): React.JSX.Element {
  const zh = language === "zh";
  const outcome = comparison.outcome as { baseline_status?: string; candidate_status?: string; status_changed?: boolean; baseline_result?: unknown; candidate_result?: unknown };
  const usage = comparison.usage as { baseline?: { known?: boolean; value?: Record<string, number> | null }; candidate?: { known?: boolean; value?: Record<string, number> | null } };
  const [adoption, setAdoption] = useState<RunAdoption | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [approvalId, setApprovalId] = useState("");
  const [pendingApprovalAction, setPendingApprovalAction] = useState<"apply" | "discard" | null>(null);
  const [adoptionOpen, setAdoptionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!adoptionOpen || !dialog) return;
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();
    return () => { if (dialog.open) dialog.close(); };
  }, [adoptionOpen]);

  async function previewAdoption(): Promise<void> {
    setBusy(true); setError("");
    try {
      const record = await desktopApi.getRunAdoptionPreview({ ...request, comparisonId: comparison.comparison_id });
      setAdoption(record);
      setSelected(record.preview.changes.flatMap((change) => [change.path, change.old_path, change.new_path].filter((value): value is string => Boolean(value))));
      setAdoptionOpen(true);
    } catch (reason) { setError(adoptionError(reason, language)); }
    finally { setBusy(false); }
  }

  async function applyAdoption(): Promise<void> {
    if (!adoption) return;
    setBusy(true); setError("");
    try {
      const result = await desktopApi.applyRunAdoption({ ...request, adoptionId: adoption.adoption_id, selectedPaths: selected, approvalId });
      if (isApprovalRequired(result)) { setApprovalId(result.approval_id); setPendingApprovalAction("apply"); return; }
      setAdoption(result); setAdoptionOpen(false);
    } catch (reason) { setError(adoptionError(reason, language)); }
    finally { setBusy(false); }
  }

  async function discardAdoption(): Promise<void> {
    if (!adoption) return;
    setBusy(true); setError("");
    try {
      const result = await desktopApi.discardRunAdoption({ ...request, adoptionId: adoption.adoption_id, cleanup: true, approvalId });
      if (isApprovalRequired(result)) { setApprovalId(result.approval_id); setPendingApprovalAction("discard"); return; }
      setAdoption(result); setAdoptionOpen(false);
    } catch (reason) { setError(adoptionError(reason, language)); }
    finally { setBusy(false); }
  }

  async function approveAndContinue(): Promise<void> {
    if (!approvalId || !pendingApprovalAction) return;
    setBusy(true); setError("");
    try {
      await desktopApi.decideRuntimeSecurityApproval({ ...request, approvalId, decision: "approved" });
      const action = pendingApprovalAction;
      setPendingApprovalAction(null);
      if (action === "apply") await applyAdoption(); else await discardAdoption();
    } catch (reason) { setError(adoptionError(reason, language)); }
    finally { setBusy(false); }
  }

  return <section className="run-comparison-view" aria-label={zh ? "运行对比" : "Run comparison"}>
    <h3>{zh ? "基线与实验结果" : "Baseline vs experiment"}</h3>
    <div className="comparison-outcomes"><article><small>{zh ? "基线" : "Baseline"}</small><strong>{outcome.baseline_status || "—"}</strong></article><article><small>{zh ? "实验" : "Experiment"}</small><strong>{outcome.candidate_status || "—"}</strong></article></div>
    <p>{outcome.status_changed ? (zh ? "终态发生变化。" : "The terminal outcome changed.") : (zh ? "终态一致；请继续查看文件和步骤差异。" : "Terminal status matches; review files and steps below.")}</p>
    {comparison.candidate_snapshot ? <p className="comparison-snapshot" role="status">{zh ? "候选快照" : "Candidate snapshot"}: <code>{comparison.candidate_snapshot.candidate_head.slice(0, 12)}</code> · {comparison.candidate_snapshot.change_count} {zh ? "项变更" : "changes"}</p> : null}
    <div className="comparison-results">
      <article><h4>{zh ? "基线结果" : "Baseline result"}</h4><pre>{readableResult(outcome.baseline_result, language)}</pre></article>
      <article><h4>{zh ? "候选结果" : "Candidate result"}</h4><pre>{readableResult(outcome.candidate_result, language)}</pre></article>
    </div>
    <details open><summary>{zh ? `步骤差异（${comparison.steps.length}）` : `Step differences (${comparison.steps.length})`}</summary>
      {comparison.steps.length ? <ol className="comparison-steps">{comparison.steps.slice(0, 200).map((step, index) => <li key={index}><strong>{String(step.alignment || "unknown")}</strong> · {String(step.baseline_type || "—")} → {String(step.candidate_type || "—")}</li>)}</ol> : <p>{zh ? "没有步骤差异。" : "No step differences."}</p>}
      {comparison.steps.length > 200 ? <p role="status">{zh ? "仅显示前 200 项；完整差异仍保存在 Comparison 中。" : "Showing the first 200 entries; the complete comparison remains recorded."}</p> : null}
    </details>
    <h4>{zh ? "文件变化" : "File changes"}</h4>
    {comparison.files.length ? <ul>{comparison.files.map((file, index) => <li key={String(file.identity || index)}><strong>{String(file.change || "changed")}</strong> · {String(file.identity || "unknown")}</li>)}</ul> : <p>{zh ? "没有记录到文件差异。" : "No file differences were recorded."}</p>}
    <h4>{zh ? "产物变化" : "Artifact changes"}</h4>
    {comparison.artifacts.length ? <ul>{comparison.artifacts.map((artifact, index) => <li key={String(artifact.identity || index)}><strong>{String(artifact.change || "changed")}</strong> · {String(artifact.identity || "unknown")}</li>)}</ul> : <p>{zh ? "没有记录到产物差异。" : "No artifact differences were recorded."}</p>}
    <h4>{zh ? "使用量" : "Usage"}</h4>
    <p>{usage.baseline?.known ? JSON.stringify(usage.baseline.value) : (zh ? "基线未知" : "Baseline unknown")} → {usage.candidate?.known ? JSON.stringify(usage.candidate.value) : (zh ? "实验未知" : "Experiment unknown")}</p>
    <h4>{zh ? "差异归因" : "Attribution"}</h4>
    <ul>{comparison.attribution.map((item, index) => <li key={index}>{String(item.kind || "unattributed")}</li>)}</ul>
    {comparison.incomplete ? <p role="status">{zh ? "大型运行尚未加载全部步骤；未加载项不会被强行配对。" : "The large run is only partially loaded; missing steps are not force-aligned."}</p> : null}
    <div className="comparison-adoption-actions">
      <button type="button" disabled={busy || adoption?.status === "applied" || adoption?.status === "discarded"} onClick={() => void previewAdoption()}>{busy ? (zh ? "检查中…" : "Checking…") : (zh ? "预览采纳" : "Preview adoption")}</button>
      {adoption?.status === "applied" ? <p role="status">{zh ? `已采纳 ${adoption.selected_paths.length} 个路径；审计回执已保存。` : `Adopted ${adoption.selected_paths.length} paths; the audit receipt is saved.`}</p> : null}
      {adoption?.status === "discarded" ? <p role="status">{zh ? "实验变更已放弃；清理回执已保存。" : "Experiment changes were discarded; the cleanup receipt is saved."}</p> : null}
    </div>
    {error ? <p className="run-experiment-error" role="alert">{error}</p> : null}
    {adoptionOpen && adoption ? <dialog ref={dialogRef} className="run-adoption-dialog" aria-labelledby="run-adoption-title" onCancel={(event) => { event.preventDefault(); setAdoptionOpen(false); }}>
      <header><h3 id="run-adoption-title">{zh ? "采纳实验变更" : "Adopt experiment changes"}</h3><button ref={closeRef} type="button" onClick={() => setAdoptionOpen(false)} aria-label={zh ? "关闭" : "Close"}>×</button></header>
      <p>{adoption.preview.source_clean && adoption.preview.candidate_clean ? (zh ? "基线与实验工作区均为干净状态。" : "Both baseline and experiment Worktrees are clean.") : (zh ? "工作区已变化，不能安全采纳。" : "A Worktree changed and cannot be safely adopted.")}</p>
      {adoption.preview.conflict_count ? <p role="alert">{zh ? `检测到 ${adoption.preview.conflict_count} 个潜在冲突。` : `${adoption.preview.conflict_count} possible conflicts detected.`}</p> : null}
      <fieldset><legend>{zh ? "选择要采纳的路径" : "Select paths to adopt"}</legend>{adoption.preview.changes.map((change, index) => {
        const paths = [change.path, change.old_path, change.new_path].filter((value): value is string => Boolean(value));
        const checked = paths.every((path) => selected.includes(path));
        return <label key={`${change.status}-${index}`}><input type="checkbox" checked={checked} disabled={change.conflict_possible} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, ...paths])] : current.filter((path) => !paths.includes(path)))} /><span><strong>{change.status}</strong> {paths.join(" → ")}{change.conflict_possible ? (zh ? "（冲突）" : " (conflict)") : ""}</span></label>;
      })}</fieldset>
      {pendingApprovalAction ? <section className="run-adoption-approval" role="status"><p>{zh ? "此操作需要一次明确批准。批准后会自动继续，无需复制回执。" : "This operation needs explicit approval. It will continue automatically; no receipt copying is needed."}</p><button type="button" disabled={busy} onClick={() => void approveAndContinue()}>{zh ? "批准并继续" : "Approve and continue"}</button></section> : null}
      <div className="experiment-actions"><button type="button" disabled={busy} onClick={() => void discardAdoption()}>{zh ? "放弃并清理" : "Discard and clean up"}</button><button type="button" className="primary" disabled={busy || !adoption.preview.can_apply || !selected.length} onClick={() => void applyAdoption()}>{zh ? "确认采纳" : "Confirm adoption"}</button></div>
    </dialog> : null}
    <details><summary>{zh ? "技术标识" : "Technical IDs"}</summary><code>{comparison.comparison_digest}</code></details>
  </section>;
}

function isApprovalRequired(value: RunAdoption | RuntimeApprovalRequired): value is RuntimeApprovalRequired {
  return "approval_required" in value && value.approval_required === true;
}

function adoptionError(reason: unknown, language: "en" | "zh"): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/428|approval/i.test(message)) return language === "zh" ? "操作已送往审批中心；批准后重试。" : "The action was sent to Approval Center. Retry after approval.";
  if (/stale|digest|changed/i.test(message)) return language === "zh" ? "预览后工作区已变化，请重新生成采纳预览。" : "A Worktree changed after preview. Generate a fresh adoption preview.";
  if (/conflict/i.test(message)) return language === "zh" ? "存在冲突；请先处理基线工作区变更。" : "Conflicts exist. Resolve baseline Workspace changes first.";
  return message;
}

function readableResult(value: unknown, language: "en" | "zh"): string {
  if (value === null || value === undefined) return language === "zh" ? "未记录结果" : "No result recorded";
  if (typeof value === "string") return value.slice(0, 20_000);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const text = record.text ?? record.content ?? record.output ?? record.message;
    if (typeof text === "string") return text.slice(0, 20_000);
    return JSON.stringify(record, null, 2).slice(0, 20_000);
  }
  return String(value);
}
