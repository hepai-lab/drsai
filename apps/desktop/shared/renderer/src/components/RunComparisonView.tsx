import { useEffect, useRef, useState } from "react";
import type { RunAdoption, RunComparison, RunComparisonEvaluationCriterionId, RunComparisonEvaluationEvidenceRef, RunComparisonEvaluationList, RunComparisonEvaluationScore, RunComparisonEvaluationVerdict, RuntimeApprovalRequired } from "@shared/runExperiment";
import type { RunInspectionOpenRequest } from "@shared/runInspection";
import { desktopApi } from "../desktopApi";

export function RunComparisonView({ comparison, request, language, onOpenEvidence }: {
  comparison: RunComparison; request: RunInspectionOpenRequest; language: "en" | "zh";
  onOpenEvidence?: (runId: string, itemId: string) => void;
}): React.JSX.Element {
  const zh = language === "zh";
  const outcome = comparison.outcome as { baseline_status?: string; candidate_status?: string; status_changed?: boolean; baseline_result?: unknown; candidate_result?: unknown };
  const metrics = comparison.metrics ?? unknownComparisonMetrics(outcome.baseline_status, outcome.candidate_status);
  const [evaluations, setEvaluations] = useState<RunComparisonEvaluationList | null>(null);
  const [evaluationReceipt, setEvaluationReceipt] = useState("");
  const [verdict, setVerdict] = useState<RunComparisonEvaluationVerdict>("inconclusive");
  const [scores, setScores] = useState<Record<RunComparisonEvaluationCriterionId, RunComparisonEvaluationScore>>({
    outcome_quality: { baseline: 3, candidate: 3 },
    execution_quality: { baseline: 3, candidate: 3 },
    safety_reproducibility: { baseline: 3, candidate: 3 },
  });
  const [note, setNote] = useState("");
  const [evidenceRefs, setEvidenceRefs] = useState<RunComparisonEvaluationEvidenceRef[]>([]);
  const [adoption, setAdoption] = useState<RunAdoption | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [approvalId, setApprovalId] = useState("");
  const [pendingApprovalAction, setPendingApprovalAction] = useState<"apply" | "discard" | null>(null);
  const [adoptionOpen, setAdoptionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const evaluationKey = useRef(`desktop:comparison-evaluation:${crypto.randomUUID()}`);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!adoptionOpen || !dialog) return;
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();
    return () => { if (dialog.open) dialog.close(); };
  }, [adoptionOpen]);

  useEffect(() => {
    let active = true;
    void desktopApi.listRunComparisonEvaluations({ ...request, comparisonId: comparison.comparison_id })
      .then((value) => {
        if (!active) return;
        setEvaluations(value);
        const latest = value.evaluations[value.evaluations.length - 1];
        if (latest) {
          setVerdict(latest.verdict); setScores(latest.scores); setNote(latest.note); setEvidenceRefs(latest.evidence_refs);
        }
      })
      .catch((reason: unknown) => { if (active) setError(adoptionError(reason, language)); });
    return () => { active = false; };
  }, [comparison.comparison_id, language, request]);

  async function saveEvaluation(): Promise<void> {
    if (!evaluations) return;
    setBusy(true); setError(""); setEvaluationReceipt("");
    try {
      const saved = await desktopApi.createRunComparisonEvaluation({
        ...request, comparisonId: comparison.comparison_id,
        expectedLatestRevision: evaluations.latest_revision,
        idempotencyKey: evaluationKey.current,
        verdict, scores, note, evidenceRefs,
      });
      setEvaluations((current) => current ? {
        ...current, latest_revision: saved.revision, evaluations: [...current.evaluations, saved],
      } : current);
      evaluationKey.current = `desktop:comparison-evaluation:${crypto.randomUUID()}`;
      setEvaluationReceipt(zh ? `评价修订 ${saved.revision} 已保存。` : `Evaluation revision ${saved.revision} saved.`);
    } catch (reason) { setError(adoptionError(reason, language)); }
    finally { setBusy(false); }
  }

  function toggleEvidence(runId: string, itemId: string): void {
    const exists = evidenceRefs.some((item) => item.run_id === runId && item.item_id === itemId);
    setEvidenceRefs((current) => exists
      ? current.filter((item) => item.run_id !== runId || item.item_id !== itemId)
      : [...current, { run_id: runId, item_id: itemId }].slice(0, 20));
  }

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
    <h4>{zh ? "自动指标" : "Automatic metrics"}</h4>
    <table className="comparison-metrics"><thead><tr><th>{zh ? "指标" : "Metric"}</th><th>{zh ? "基线" : "Baseline"}</th><th>{zh ? "候选" : "Candidate"}</th><th>Δ</th></tr></thead><tbody>
      {(["duration_ms", "total_tokens", "tool_calls", "tool_errors", "approvals", "artifacts", "warnings"] as const).map((key) => <tr key={key}><th>{metricLabel(key, language)}</th><td>{metricValue(key, metrics.baseline[key], language)}</td><td>{metricValue(key, metrics.candidate[key], language)}</td><td>{deltaValue(key, metrics.delta[key], language)}</td></tr>)}
    </tbody></table>
    <details open><summary>{zh ? `步骤差异（${comparison.steps.length}）` : `Step differences (${comparison.steps.length})`}</summary>
      {comparison.steps.length ? <ol className="comparison-steps">{comparison.steps.slice(0, 200).map((step, index) => {
        const baselineItemId = typeof step.baseline_item_id === "string" ? step.baseline_item_id : "";
        const candidateItemId = typeof step.candidate_item_id === "string" ? step.candidate_item_id : "";
        return <li key={index}><strong>{String(step.alignment || "unknown")}</strong> · {String(step.baseline_type || "—")} → {String(step.candidate_type || "—")}
          <span className="comparison-evidence-actions">
            {baselineItemId ? <><button type="button" onClick={() => onOpenEvidence?.(comparison.baseline_run_id, baselineItemId)}>{zh ? "查看基线证据" : "View baseline evidence"}</button><label><input type="checkbox" checked={evidenceRefs.some((item) => item.run_id === comparison.baseline_run_id && item.item_id === baselineItemId)} onChange={() => toggleEvidence(comparison.baseline_run_id, baselineItemId)} />{zh ? "引用" : "Cite"}</label></> : null}
            {candidateItemId ? <><button type="button" onClick={() => onOpenEvidence?.(comparison.candidate_run_id, candidateItemId)}>{zh ? "查看候选证据" : "View candidate evidence"}</button><label><input type="checkbox" checked={evidenceRefs.some((item) => item.run_id === comparison.candidate_run_id && item.item_id === candidateItemId)} onChange={() => toggleEvidence(comparison.candidate_run_id, candidateItemId)} />{zh ? "引用" : "Cite"}</label></> : null}
          </span>
        </li>;
      })}</ol> : <p>{zh ? "没有步骤差异。" : "No step differences."}</p>}
      {comparison.steps.length > 200 ? <p role="status">{zh ? "仅显示前 200 项；完整差异仍保存在 Comparison 中。" : "Showing the first 200 entries; the complete comparison remains recorded."}</p> : null}
    </details>
    <h4>{zh ? "文件变化" : "File changes"}</h4>
    {comparison.files.length ? <ul>{comparison.files.map((file, index) => <li key={String(file.identity || index)}><strong>{String(file.change || "changed")}</strong> · {String(file.identity || "unknown")}</li>)}</ul> : <p>{zh ? "没有记录到文件差异。" : "No file differences were recorded."}</p>}
    <h4>{zh ? "产物变化" : "Artifact changes"}</h4>
    {comparison.artifacts.length ? <ul>{comparison.artifacts.map((artifact, index) => <li key={String(artifact.identity || index)}><strong>{String(artifact.change || "changed")}</strong> · {String(artifact.identity || "unknown")}</li>)}</ul> : <p>{zh ? "没有记录到产物差异。" : "No artifact differences were recorded."}</p>}
    <details className="comparison-evaluation" open><summary>{zh ? "人工评价" : "Human evaluation"}</summary>
      {evaluations ? <form onSubmit={(event) => { event.preventDefault(); void saveEvaluation(); }}>
        {evaluations.comparison_digest !== comparison.comparison_digest ? <p role="alert">{zh ? "比较内容已经变化；请刷新后再评价。" : "The Comparison changed. Refresh before evaluating."}</p> : null}
        <table><thead><tr><th>{zh ? "维度" : "Criterion"}</th><th>{zh ? "基线 1–5" : "Baseline 1–5"}</th><th>{zh ? "候选 1–5" : "Candidate 1–5"}</th></tr></thead><tbody>{evaluations.rubric_snapshot.criteria.map((criterion) => <tr key={criterion.id}><th><strong>{criterionLabel(criterion.id, language)}</strong><small>{criterionDescription(criterion.id, language)}</small></th>{(["baseline", "candidate"] as const).map((side) => <td key={side}><select aria-label={`${criterionLabel(criterion.id, language)} ${side}`} value={scores[criterion.id][side]} onChange={(event) => setScores((current) => ({ ...current, [criterion.id]: { ...current[criterion.id], [side]: Number(event.target.value) } }))}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value}</option>)}</select></td>)}</tr>)}</tbody></table>
        <label>{zh ? "结论" : "Verdict"}<select value={verdict} onChange={(event) => setVerdict(event.target.value as RunComparisonEvaluationVerdict)}><option value="inconclusive">{zh ? "证据不足" : "Inconclusive"}</option><option value="baseline_better">{zh ? "基线更好" : "Baseline better"}</option><option value="candidate_better">{zh ? "候选更好" : "Candidate better"}</option><option value="tie">{zh ? "相当" : "Tie"}</option></select></label>
        <label>{zh ? "评价备注" : "Evaluation note"}<textarea maxLength={4000} rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <p>{zh ? `已引用 ${evidenceRefs.length} 条 OAEP 证据。` : `${evidenceRefs.length} OAEP evidence reference(s) selected.`}</p>
        <button type="submit" className="primary" disabled={busy || evaluations.comparison_digest !== comparison.comparison_digest}>{busy ? (zh ? "保存中…" : "Saving…") : (zh ? "保存新评价修订" : "Save new evaluation revision")}</button>
        {evaluationReceipt ? <p role="status">{evaluationReceipt}</p> : null}
        {evaluations.evaluations.length ? <details><summary>{zh ? `历史修订（${evaluations.evaluations.length}）` : `Revision history (${evaluations.evaluations.length})`}</summary><ol>{evaluations.evaluations.map((item) => <li key={item.evaluation_id}>#{item.revision} · {verdictLabel(item.verdict, language)} · {new Date(item.created_at).toLocaleString()}</li>)}</ol></details> : null}
      </form> : <p role="status">{zh ? "正在加载评价…" : "Loading evaluations…"}</p>}
    </details>
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

function metricLabel(key: string, language: "en" | "zh"): string {
  const values: Record<string, [string, string]> = { duration_ms: ["Duration", "耗时"], total_tokens: ["Total tokens", "Token 总量"], tool_calls: ["Tool calls", "工具调用"], tool_errors: ["Failed items", "失败项目"], approvals: ["Approvals", "审批"], artifacts: ["Artifacts", "产物"], warnings: ["Warnings", "警告"] };
  return values[key]?.[language === "zh" ? 1 : 0] || key;
}
function metricValue(key: string, value: number | null, language: "en" | "zh"): string {
  if (value === null) return language === "zh" ? "未知" : "Unknown";
  return key === "duration_ms" ? `${(value / 1000).toFixed(2)} s` : String(value);
}
function deltaValue(key: string, value: number | null, language: "en" | "zh"): string {
  if (value === null) return language === "zh" ? "未知" : "Unknown";
  const formatted = key === "duration_ms" ? `${(value / 1000).toFixed(2)} s` : String(Math.abs(value));
  return value === 0 ? "0" : `${value > 0 ? "+" : "−"}${formatted.replace(/^-/, "")}`;
}
function criterionLabel(id: RunComparisonEvaluationCriterionId, language: "en" | "zh"): string {
  const values: Record<RunComparisonEvaluationCriterionId, [string, string]> = { outcome_quality: ["Outcome quality", "结果质量"], execution_quality: ["Execution quality", "执行质量"], safety_reproducibility: ["Safety and reproducibility", "安全与复现"] };
  return values[id][language === "zh" ? 1 : 0];
}
function criterionDescription(id: RunComparisonEvaluationCriterionId, language: "en" | "zh"): string {
  const values: Record<RunComparisonEvaluationCriterionId, [string, string]> = { outcome_quality: ["Correct, complete, and goal-aligned.", "结果正确、完整并满足目标。"], execution_quality: ["Effective tools and steps without unnecessary failures.", "工具和步骤有效，且没有不必要失败。"], safety_reproducibility: ["Sufficient approvals, safety boundaries, and evidence.", "审批、安全边界和复现证据充分。"] };
  return values[id][language === "zh" ? 1 : 0];
}
function verdictLabel(value: RunComparisonEvaluationVerdict, language: "en" | "zh"): string {
  const values: Record<RunComparisonEvaluationVerdict, [string, string]> = { baseline_better: ["Baseline better", "基线更好"], candidate_better: ["Candidate better", "候选更好"], tie: ["Tie", "相当"], inconclusive: ["Inconclusive", "证据不足"] };
  return values[value][language === "zh" ? 1 : 0];
}
function unknownComparisonMetrics(baselineStatus = "unknown", candidateStatus = "unknown"): NonNullable<RunComparison["metrics"]> {
  const side = (status: string) => ({ status, duration_ms: null, input_tokens: null, output_tokens: null, total_tokens: null, tool_calls: null, tool_errors: null, approvals: null, artifacts: null, warnings: null });
  return { baseline: side(baselineStatus), candidate: side(candidateStatus), delta: { duration_ms: null, input_tokens: null, output_tokens: null, total_tokens: null, tool_calls: null, tool_errors: null, approvals: null, artifacts: null, warnings: null } };
}
