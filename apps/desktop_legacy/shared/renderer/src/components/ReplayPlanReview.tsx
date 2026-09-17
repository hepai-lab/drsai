import type { ReplayPlan } from "@shared/runExperiment";

export function ReplayPlanReview({ plan, language, executing, onExecute }: {
  plan: ReplayPlan; language: "en" | "zh"; executing: boolean; onExecute: () => void;
}): React.JSX.Element {
  const zh = language === "zh";
  return <section className="replay-plan-review" aria-label={zh ? "重放计划审查" : "Replay plan review"}>
    <header><h3>{zh ? "执行前计划" : "Plan before execution"}</h3><span className={plan.executable ? "plan-ready" : "plan-blocked"}>{plan.executable ? (zh ? "可执行" : "Ready") : (zh ? "已阻止" : "Blocked")}</span></header>
    {plan.stale ? <p role="alert">{zh ? "草稿或基线证据已变化，请重新生成计划。" : "The draft or baseline evidence changed. Generate a new plan."}</p> : null}
    {plan.blockers.length ? <ul className="plan-blockers">{plan.blockers.map((blocker, index) => <li key={`${blocker.code}-${index}`}>{String(blocker.code)}{typeof blocker.reference === "string" ? ` · ${blocker.reference}` : ""}</li>)}</ul> : null}
    <ol className="replay-plan-steps">{plan.steps.map((step) => <li key={step.step_id} data-decision={step.decision}><strong>{decisionLabel(step.decision, language)}</strong><span>{step.kind}</span><p>{step.reason}</p></li>)}</ol>
    <dl className="replay-plan-estimate">
      <div><dt>{zh ? "令牌" : "Tokens"}</dt><dd>{plan.estimate.token_usage_known ? String(plan.estimate.token_usage?.total_tokens ?? "—") : (zh ? "未知" : "Unknown")}</dd></div>
      <div><dt>{zh ? "费用" : "Cost"}</dt><dd>{plan.estimate.monetary_cost_known ? String(plan.estimate.monetary_cost) : (zh ? "未知（不会显示为 0）" : "Unknown (not shown as zero)")}</dd></div>
      <div><dt>{zh ? "工作区写入" : "Workspace writes"}</dt><dd>{plan.estimate.workspace_writes}</dd></div>
    </dl>
    <button type="button" className="primary" disabled={!plan.executable || plan.stale || executing} onClick={onExecute}>{executing ? (zh ? "执行中…" : "Executing…") : (zh ? "执行已审查计划" : "Execute reviewed plan")}</button>
  </section>;
}

function decisionLabel(decision: string, language: "en" | "zh"): string {
  const labels = language === "zh"
    ? { reuse: "复用", reexecute: "重新执行", isolate: "隔离执行", block: "阻止" }
    : { reuse: "Reuse", reexecute: "Re-execute", isolate: "Isolate", block: "Block" };
  return labels[decision as keyof typeof labels] || decision;
}
