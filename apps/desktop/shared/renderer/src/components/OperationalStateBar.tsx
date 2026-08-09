import { useEffect, useState } from "react";
import type { OperationalStateDecision } from "@shared/operationalState";
import type { AppLanguage } from "../navigation";

const LABELS = {
  zh: { identity: "身份", runtime: "运行时", model: "当前智能体模型", workspace: "工作区", run: "任务运行" },
  en: { identity: "Identity", runtime: "Runtime", model: "Current Agent model", workspace: "Workspace", run: "Task run" },
} as const;

const STATE_COPY: Record<string, { zh: string; en: string }> = {
  loading: { zh: "正在读取登录状态", en: "Checking sign-in status" },
  anonymous: { zh: "需要登录 HAI", en: "HAI sign-in required" },
  authenticated: { zh: "已登录", en: "Signed in" },
  unknown: { zh: "正在检查", en: "Checking" },
  preparing: { zh: "正在准备本地运行时", en: "Preparing the local runtime" },
  blocked: { zh: "运行时需要修复", en: "Runtime needs attention" },
  ready: { zh: "已就绪", en: "Ready" },
  unconfigured: { zh: "当前智能体需要配置模型", en: "Current Agent model setup required" },
  untested: { zh: "当前智能体模型待验证", en: "Current Agent model pending verification" },
  none: { zh: "需要选择工作区", en: "Workspace selection required" },
  untrusted: { zh: "需要信任工作区", en: "Workspace trust required" },
  trusted: { zh: "已信任", en: "Trusted" },
  idle: { zh: "可以开始任务", en: "Ready to start a task" },
  queued: { zh: "任务正在排队", en: "Task is queued" },
  running: { zh: "任务正在运行", en: "Task is running" },
  waiting_approval: { zh: "任务等待你的批准", en: "Task needs your approval" },
  recovering: { zh: "正在恢复任务", en: "Recovering the task" },
  failed: { zh: "任务失败，需要处理", en: "Task failed and needs attention" },
  completed: { zh: "最近任务已完成", en: "Latest task completed" },
  cancelled: { zh: "最近任务已取消", en: "Latest task cancelled" },
};

const AUTO_OPEN_STATES = new Set([
  "anonymous",
  "blocked",
  "unconfigured",
  "none",
  "untrusted",
  "waiting_approval",
  "failed",
]);

export function OperationalStateBar({ decision, language, busy = false, actionMessage, onPrimaryAction, onCopyDiagnostics }: {
  decision: OperationalStateDecision;
  language: AppLanguage;
  busy?: boolean;
  actionMessage?: string | null;
  onPrimaryAction?: () => void | Promise<void>;
  onCopyDiagnostics?: () => void | Promise<void>;
}): React.JSX.Element {
  const zh = language === "zh";
  const labels = LABELS[language];
  const currentCopy = busy && decision.currentLayer === "model"
    ? (zh ? "正在验证当前智能体模型" : "Verifying current Agent model")
    : STATE_COPY[decision.state]?.[language] ?? decision.state;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (AUTO_OPEN_STATES.has(decision.state)) setOpen(true);
  }, [decision.currentLayer, decision.state]);

  return <details
    className={`operational-state-control ${decision.blockingLayer ? "blocked" : "active"}`}
    data-testid="operational-state-bar"
    data-current-layer={decision.currentLayer}
    data-current-state={decision.state}
    open={open}
    onToggle={(event) => setOpen(event.currentTarget.open)}
  >
    <summary
      title={`${labels[decision.currentLayer]}：${currentCopy}`}
      aria-label={`${labels[decision.currentLayer]}：${currentCopy}`}
      aria-haspopup="dialog"
    >
      <span className="operational-state-dot" aria-hidden="true" />
      <span>{currentCopy}</span>
    </summary>
    <div className="operational-state-popover" role="dialog" aria-label={zh ? "任务运行状态" : "Task run status"}>
      <header>
        <strong>{labels[decision.currentLayer]}</strong>
        <span>{currentCopy}</span>
      </header>
      <ol aria-label={zh ? "OpenDrSai 当前状态" : "Current OpenDrSai status"}>
        {decision.layers.map((item) => <li key={item.layer} data-status={item.status} aria-current={item.status === "current" ? "step" : undefined}>
          <span aria-hidden="true">{item.status === "complete" ? "✓" : item.status === "current" ? "●" : "○"}</span>
          <strong>{labels[item.layer]}</strong>
          <small>{STATE_COPY[item.state]?.[language] ?? item.state}</small>
        </li>)}
      </ol>
      {decision.blockingLayer || (decision.currentLayer === "model" && decision.state === "untested") ? <div className="operational-state-actions" role="group" aria-label={zh ? "恢复操作" : "Recovery actions"}>
        {onPrimaryAction ? <button type="button" data-testid="operational-primary-action" disabled={busy} onClick={() => void onPrimaryAction()}>
          {busy ? (zh ? "正在处理…" : "Working…") : primaryActionLabel(decision, language)}
        </button> : null}
        {onCopyDiagnostics ? <button type="button" data-testid="operational-copy-diagnostics" disabled={busy} onClick={() => void onCopyDiagnostics()}>{zh ? "复制脱敏诊断" : "Copy redacted diagnostics"}</button> : null}
        {actionMessage ? <span role="status" data-testid="operational-action-message">{actionMessage}</span> : null}
      </div> : null}
    </div>
  </details>;
}

function primaryActionLabel(decision: OperationalStateDecision, language: AppLanguage): string {
  const zh = language === "zh";
  if (decision.currentLayer === "identity") return zh ? "前往登录" : "Go to sign in";
  if (decision.currentLayer === "runtime") return zh ? "修复并重试运行时" : "Repair and retry runtime";
  if (decision.currentLayer === "model") return decision.state === "untested" ? (zh ? "重新验证当前智能体模型" : "Verify current Agent model again") : (zh ? "配置当前智能体模型" : "Configure current Agent model");
  if (decision.currentLayer === "workspace") return decision.state === "untrusted" ? (zh ? "信任此工作区" : "Trust this workspace") : (zh ? "选择工作区" : "Choose workspace");
  return decision.state === "waiting_approval" ? (zh ? "查看待批准操作" : "Review pending approval") : (zh ? "查看并重试任务" : "Review and retry task");
}
