import { useEffect, useRef, useState } from "react";
import type { ReplayMode, ReplayPlan, RunComparison, RunExperiment, RunExperimentCapabilities, RuntimeApprovalRequired } from "@shared/runExperiment";
import type { RunInspectionOpenRequest } from "@shared/runInspection";
import { desktopApi } from "../desktopApi";
import { ReplayPlanReview } from "./ReplayPlanReview";
import { RunComparisonView } from "./RunComparisonView";

export function RunExperimentPanel({ request, itemId, language, onClose, onOpenEvidence }: {
  request: RunInspectionOpenRequest; itemId?: string; language: "en" | "zh"; onClose: () => void;
  onOpenEvidence?: (runId: string, itemId?: string) => void;
}): React.JSX.Element {
  const zh = language === "zh";
  const createKey = useRef(`desktop:create-experiment:${crypto.randomUUID()}`);
  const executeKey = useRef(`desktop:execute-replay:${crypto.randomUUID()}`);
  const [draft, setDraft] = useState<RunExperiment | null>(null);
  const [capabilities, setCapabilities] = useState<RunExperimentCapabilities | null>(null);
  const [title, setTitle] = useState(zh ? "运行实验" : "Run experiment");
  const [input, setInput] = useState("");
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [attachmentRefs, setAttachmentRefs] = useState("");
  const [mode, setMode] = useState<ReplayMode>("rerun_from_start");
  const [plan, setPlan] = useState<ReplayPlan | null>(null);
  const [comparison, setComparison] = useState<RunComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [executionApprovalId, setExecutionApprovalId] = useState<string | null>(null);
  const [executionApprovalKind, setExecutionApprovalKind] = useState<"security" | "runtime" | "snapshot" | null>(null);
  const [candidateRunId, setCandidateRunId] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState("");
  const [candidateSnapshotNotice, setCandidateSnapshotNotice] = useState("");
  const [restoredDraftNotice, setRestoredDraftNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => { panelRef.current?.focus(); }, []);

  useEffect(() => {
    let active = true;
    void desktopApi.getRunExperimentCapabilities({
      workspacePath: request.workspacePath, workspaceId: request.workspaceId, runId: request.runId,
    }).then((value) => {
      if (!active) return;
      setCapabilities(value);
    }).catch((reason: unknown) => { if (active) setError(actionableError(reason, language)); });
    return () => { active = false; };
  }, [language, request.runId, request.workspaceId, request.workspacePath]);

  useEffect(() => {
    let active = true;
    void desktopApi.getRunRelations({
      workspacePath: request.workspacePath, workspaceId: request.workspaceId, runId: request.runId,
    }).then((relations) => {
      if (!active) return;
      const recovered = [...relations.experiments]
        .filter((experiment) => experiment.base_run_id === request.runId)
        .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))[0];
      if (!recovered) return;
      setDraft(recovered);
      setTitle(recovered.title);
      setInput(recovered.overrides.input?.message || "");
      setProviderId(recovered.overrides.model?.provider_id || "");
      setModelId(recovered.overrides.model?.model_id || "");
      setAttachmentRefs((recovered.overrides.attachments || []).map((item) => item.reference).join("\n"));
      setMode(recovered.replay_mode);
      setDirty(false);
      if (recovered.status === "executed" && recovered.executed_run_id) {
        setCandidateRunId(recovered.executed_run_id);
        setRestoredDraftNotice(language === "zh" ? "已恢复上次执行的实验，正在恢复比较。" : "Restored the last executed experiment; recovering its Comparison.");
        void desktopApi.getRunInspection({
          workspacePath: request.workspacePath, workspaceId: request.workspaceId,
          runId: recovered.executed_run_id, limit: 1,
        }).then((inspection) => {
          if (!active || !["completed", "failed", "cancelled"].includes(String(inspection.run.status))) return;
          return desktopApi.createRunComparison({
            workspacePath: request.workspacePath, workspaceId: request.workspaceId,
            baselineRunId: request.runId, candidateRunId: recovered.executed_run_id!,
          }).then((value) => { if (active) setComparison(value); });
        }).catch((reason: unknown) => { if (active) setError(actionableError(reason, language)); });
      } else {
        setRestoredDraftNotice(language === "zh" ? "已恢复上次保存的实验草稿。" : "Restored the last saved experiment draft.");
      }
    }).catch((reason: unknown) => { if (active) setError(actionableError(reason, language)); });
    return () => { active = false; };
  }, [language, request.runId, request.workspaceId, request.workspacePath]);

  async function save(): Promise<RunExperiment | null> {
    if ((providerId && !modelId) || (!providerId && modelId)) {
      setError(zh ? "提供商和模型必须同时填写。" : "Provider and model must be filled together.");
      return null;
    }
    const overrides = {
      ...(input ? { input: { message: input } } : {}),
      ...(providerId && modelId ? { model: { provider_id: providerId, model_id: modelId } } : {}),
      ...(lines(attachmentRefs).length ? { attachments: lines(attachmentRefs).map((reference) => ({ reference, required: true })) } : {}),
    };
    setBusy(true); setError(""); setPlan(null); setComparison(null);
    try {
      const current = draft ?? await desktopApi.createRunExperiment({
        workspacePath: request.workspacePath, workspaceId: request.workspaceId, runId: request.runId,
        idempotencyKey: createKey.current, title, forkedFromItemId: itemId, replayMode: mode,
      });
      if (!draft) setDraft(current);
      const updated = await desktopApi.updateRunExperiment({
        workspacePath: request.workspacePath, workspaceId: request.workspaceId,
        experimentId: current.experiment_id, expectedVersion: current.draft_version,
        idempotencyKey: `desktop:save-experiment:${crypto.randomUUID()}`,
        patch: { title, replay_mode: mode, overrides },
      });
      setDraft(updated);
      setDirty(false);
      return updated;
    } catch (reason) { setError(actionableError(reason, language)); return null; }
    finally { setBusy(false); }
  }

  async function generatePlan(): Promise<void> {
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    try {
      const generated = await desktopApi.createReplayPlan({
        workspacePath: request.workspacePath, workspaceId: request.workspaceId,
        experimentId: saved.experiment_id, expectedDraftVersion: saved.draft_version,
        availability: {
          attachments: lines(attachmentRefs),
        },
      });
      setPlan(generated);
    } catch (reason) { setError(actionableError(reason, language)); }
    finally { setBusy(false); }
  }

  async function execute(approvalId?: string, runtimeApprovalId?: string): Promise<void> {
    if (!plan) return;
    setBusy(true); setError(""); setCandidateSnapshotNotice("");
    try {
      const result = await desktopApi.executeReplayPlan({
        workspacePath: request.workspacePath, workspaceId: request.workspaceId,
        replayPlanId: plan.replay_plan_id, draftVersion: plan.draft_version,
        planDigest: plan.plan_digest, baseManifestDigest: plan.base_manifest_digest,
        idempotencyKey: executeKey.current,
        ...(approvalId ? { approvalId } : {}),
        ...(runtimeApprovalId ? { runtimeApprovalId } : {}),
      });
      if (isApprovalRequired(result)) {
        setExecutionApprovalId(result.approval_id);
        setExecutionApprovalKind("security");
        setError(zh ? "此计划需要审批。可在这里批准并继续，或前往审批中心查看详情。" : "This plan requires approval. Approve and continue here, or review it in Approval Center.");
        return;
      }
      const runtimeApproval = result.approval as { approval_id?: string; status?: string } | null | undefined;
      if (result.run.status === "waiting_approval" && runtimeApproval?.status === "pending" && runtimeApproval.approval_id) {
        setExecutionApprovalId(runtimeApproval.approval_id);
        setExecutionApprovalKind("runtime");
        setError(zh ? "重放计划正在等待运行步骤审批。批准后将继续同一次执行。" : "The Replay Plan is waiting for a runtime step approval. Approving continues the same execution.");
        return;
      }
      setExecutionApprovalId(null);
      setExecutionApprovalKind(null);
      if (["completed", "failed", "cancelled"].includes(result.run.status)) {
        setCandidateRunId(result.run.run_id);
        await finalizeCandidate(result.run.run_id);
      } else {
        setError(zh ? `实验运行当前状态：${result.run.status}。可在运行检查器中继续查看。` : `Experiment Run is ${result.run.status}. Continue in Run Inspector.`);
      }
    } catch (reason) { setError(actionableError(reason, language)); }
    finally { setBusy(false); }
  }

  async function finalizeCandidate(runId: string, approvalId?: string): Promise<void> {
    if (!plan) return;
    const snapshot = await desktopApi.finalizeRunExperimentCandidate({
      workspacePath: request.workspacePath, workspaceId: request.workspaceId,
      experimentId: plan.experiment_id, ...(approvalId ? { approvalId } : {}),
    });
    if (isApprovalRequired(snapshot)) {
      setExecutionApprovalId(snapshot.approval_id);
      setExecutionApprovalKind("snapshot");
      setError(zh ? "固定候选变更需要批准。批准后将自动生成比较。" : "Capturing candidate changes needs approval. Approving will create the comparison automatically.");
      return;
    }
    setExecutionApprovalId(null);
    setExecutionApprovalKind(null);
    setCandidateSnapshotNotice(snapshot.snapshot_created && snapshot.candidate_head
      ? (zh ? `候选变更已固定：${snapshot.candidate_head.slice(0, 12)}` : `Candidate changes captured: ${snapshot.candidate_head.slice(0, 12)}`)
      : (zh ? "候选工作区没有待固定的变更。" : "The candidate workspace had no pending changes."));
    setComparison(await desktopApi.createRunComparison({
      workspacePath: request.workspacePath, workspaceId: request.workspaceId,
      baselineRunId: request.runId, candidateRunId: runId,
    }));
  }

  async function exportPackage(): Promise<void> {
    if (!draft) return;
    setBusy(true); setError(""); setExportNotice("");
    try {
      const result = await desktopApi.exportRunExperimentPackage({
        workspacePath: request.workspacePath, workspaceId: request.workspaceId,
        experimentId: draft.experiment_id,
      });
      if (!result.cancelled && result.savedPath) {
        const fileName = result.savedPath.split(/[\\/]/).pop() || "experiment-package.json";
        setExportNotice(zh
          ? `已导出脱敏实验包：${fileName}（${result.package.integrity.digest}）`
          : `Redacted experiment package exported: ${fileName} (${result.package.integrity.digest})`);
      }
    } catch (reason) { setError(actionableError(reason, language)); }
    finally { setBusy(false); }
  }

  async function discardDraft(): Promise<void> {
    if (!draft || draft.status !== "draft") return;
    setBusy(true); setError("");
    try {
      await desktopApi.deleteRunExperiment({
        workspacePath: request.workspacePath, workspaceId: request.workspaceId,
        experimentId: draft.experiment_id,
      });
      setDraft(null); setDirty(false); onClose();
    } catch (reason) { setError(actionableError(reason, language)); }
    finally { setBusy(false); }
  }

  function requestClose(): void {
    if (dirty) { setCloseConfirmOpen(true); return; }
    onClose();
  }

  async function approveAndContinue(): Promise<void> {
    if (!executionApprovalId) return;
    setBusy(true); setError("");
    try {
      if (executionApprovalKind === "snapshot") {
        await desktopApi.decideRuntimeSecurityApproval({
          workspacePath: request.workspacePath, workspaceId: request.workspaceId,
          approvalId: executionApprovalId, decision: "approved",
        });
        if (!candidateRunId) throw new Error("Candidate Run identity is unavailable.");
        await finalizeCandidate(candidateRunId, executionApprovalId);
      } else if (executionApprovalKind === "runtime") {
        await desktopApi.decideRuntimeRunApproval({
          workspacePath: request.workspacePath, workspaceId: request.workspaceId,
          approvalId: executionApprovalId, decision: "approved",
        });
        await execute(undefined, executionApprovalId);
      } else {
        await desktopApi.decideRuntimeSecurityApproval({
          workspacePath: request.workspacePath, workspaceId: request.workspaceId,
          approvalId: executionApprovalId, decision: "approved",
        });
        await execute(executionApprovalId);
      }
    } catch (reason) { setError(actionableError(reason, language)); }
    finally { setBusy(false); }
  }

  const executed = draft?.status === "executed";
  return <div className="run-experiment-overlay"><section ref={panelRef} tabIndex={-1} className="run-experiment-panel" role="dialog" aria-modal="true" aria-label={zh ? "运行实验" : "Run experiment"} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); requestClose(); } }}>
    <header><div><small>{zh ? "基线" : "Baseline"} · {request.runId}</small><h2>{zh ? "创建运行实验" : "Create run experiment"}</h2></div><button type="button" onClick={requestClose} aria-label={zh ? "关闭" : "Close"}>×</button></header>
    {executed ? <p role="status">{zh ? "该实验已经执行，配置保持只读；你可以继续查看候选运行、比较和评价。" : "This experiment has executed and is now read-only. You can continue with its candidate Run, Comparison, and Evaluation."}</p> : null}
    <form onSubmit={(event) => { event.preventDefault(); void generatePlan(); }}>
      <label>{zh ? "实验名称" : "Experiment name"}<input value={title} maxLength={500} disabled={executed} onChange={(event) => { setTitle(event.target.value); setDirty(true); }} required /></label>
      <label>{zh ? "输入覆盖（留空则使用原值）" : "Input override (blank keeps original)"}<textarea value={input} maxLength={200000} disabled={executed} onChange={(event) => { setInput(event.target.value); setDirty(true); }} rows={4} /></label>
      {capabilities?.models.length ? <label>{zh ? "模型" : "Model"}<select disabled={executed} value={providerId && modelId ? `${providerId}/${modelId}` : ""} onChange={(event) => { setDirty(true); if (!event.target.value) { setProviderId(""); setModelId(""); return; } const selected = capabilities.models.find((model) => `${model.provider_id}/${model.model_id}` === event.target.value); if (selected) { setProviderId(selected.provider_id); setModelId(selected.model_id); } }}><option value="">{zh ? "使用基线模型" : "Use baseline model"}</option>{capabilities.models.map((model) => <option key={`${model.provider_id}/${model.model_id}`} value={`${model.provider_id}/${model.model_id}`}>{model.display_name} · {model.provider_id}/{model.model_id}</option>)}</select></label> : <p role="status">{capabilities ? (zh ? "当前 Runtime 没有可用于实验的模型目录；将使用基线模型。" : "Runtime has no experiment model catalog; the baseline model will be used.") : (zh ? "正在读取 Runtime 模型目录…" : "Loading Runtime model catalog…")}</p>}
      <p>{zh ? "当前仅支持从头重新运行。更多重放方式将在 Runtime 能证明安全兼容时自动开放。" : "Only rerun from start is currently available. More replay modes will appear after Runtime can prove safe compatibility."}</p>
      <label>{zh ? "附件引用（每行一个）" : "Attachment references (one per line)"}<textarea rows={2} value={attachmentRefs} disabled={executed} onChange={(event) => { setAttachmentRefs(event.target.value); setDirty(true); }} placeholder="workspace://artifact.csv" /></label>
      <div className="experiment-actions"><button type="button" disabled={busy || executed} onClick={() => { setInput(""); setProviderId(""); setModelId(""); setAttachmentRefs(""); setMode("rerun_from_start"); setDirty(true); }}>{zh ? "恢复原值" : "Restore originals"}</button><button type="button" disabled={busy || !draft} onClick={() => void exportPackage()}>{zh ? "导出脱敏实验包" : "Export redacted package"}</button>{draft?.status === "draft" ? <button type="button" disabled={busy} onClick={() => void discardDraft()}>{zh ? "放弃草稿" : "Discard draft"}</button> : null}<button type="submit" className="primary" disabled={busy || executed}>{zh ? "保存并生成计划" : "Save and generate plan"}</button></div>
    </form>
    {closeConfirmOpen ? <div className="run-inspector-export-notice" role="alertdialog" aria-label={zh ? "未保存编辑" : "Unsaved edits"}><strong>{zh ? "有未保存的编辑" : "You have unsaved edits"}</strong><p>{zh ? "关闭会丢失本次尚未生成计划的修改。" : "Closing will discard changes that have not been saved into a Replay Plan."}</p><button type="button" onClick={() => setCloseConfirmOpen(false)}>{zh ? "继续编辑" : "Keep editing"}</button><button type="button" onClick={onClose}>{zh ? "放弃并关闭" : "Discard and close"}</button></div> : null}
    {exportNotice ? <p className="run-experiment-export-notice" role="status">{exportNotice}</p> : null}
    {restoredDraftNotice ? <p className="run-experiment-export-notice" role="status">{restoredDraftNotice}</p> : null}
    {candidateSnapshotNotice ? <p className="run-experiment-candidate-notice" role="status">{candidateSnapshotNotice}</p> : null}
    {error ? <p className="run-experiment-error" role="alert">{error}</p> : null}
    {executionApprovalId ? <div className="experiment-actions"><button type="button" className="primary" disabled={busy} onClick={() => void approveAndContinue()}>{zh ? "批准并继续" : "Approve and continue"}</button></div> : null}
    {plan ? <ReplayPlanReview plan={plan} language={language} executing={busy} onExecute={() => void execute()} /> : null}
    {candidateRunId ? <div className="experiment-actions"><button type="button" onClick={() => onOpenEvidence?.(candidateRunId)}>{zh ? "查看候选运行" : "View candidate Run"}</button></div> : null}
    {comparison ? <RunComparisonView comparison={comparison} request={request} language={language} onOpenEvidence={(runId, evidenceItemId) => onOpenEvidence?.(runId, evidenceItemId)} /> : null}
  </section></div>;
}

function message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
function lines(value: string): string[] { return [...new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))]; }
function isApprovalRequired(value: unknown): value is RuntimeApprovalRequired {
  return Boolean(value && typeof value === "object" && (value as { approval_required?: unknown }).approval_required === true && typeof (value as { approval_id?: unknown }).approval_id === "string");
}
function actionableError(reason: unknown, language: "en" | "zh"): string {
  const raw = message(reason);
  if (/409|conflict|version/i.test(raw)) return language === "zh" ? "草稿或计划已变化。请重新打开实验并生成新计划。" : "The draft or plan changed. Reopen the experiment and generate a new plan.";
  if (/428|approval/i.test(raw)) return language === "zh" ? "此计划需要审批。请在审批中心确认后重试。" : "This plan requires approval. Approve it in Approval Center, then retry.";
  if (/404|not.?found/i.test(raw)) return language === "zh" ? "运行或实验已不可用，请返回基线运行重试。" : "The Run or experiment is unavailable. Return to the baseline Run and retry.";
  return raw;
}
