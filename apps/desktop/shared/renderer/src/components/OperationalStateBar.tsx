import { useEffect, useRef, useState } from "react";
import type { OperationalStateBlockerInfo, OperationalStateDecision } from "@shared/operationalState";
import type { AppLanguage } from "../navigation";

const LABELS = {
  zh: { identity: "身份", runtime: "运行时", agent: "智能体", workspace: "工作区" },
  en: { identity: "Identity", runtime: "Runtime", agent: "Agent", workspace: "Workspace" },
} as const;

const STATE_COPY: Record<string, { zh: string; en: string }> = {
  loading: { zh: "正在读取登录状态", en: "Checking sign-in status" },
  anonymous: { zh: "需要登录 HAI", en: "HAI sign-in required" },
  authenticated: { zh: "已登录", en: "Signed in" },
  unknown: { zh: "正在检查", en: "Checking" },
  preparing: { zh: "正在准备本地运行时", en: "Preparing the local runtime" },
  blocked: { zh: "运行时需要修复", en: "Runtime needs attention" },
  ready: { zh: "已就绪", en: "Ready" },
  unavailable: { zh: "没有可用的智能体", en: "No Agent is available" },
  unconfigured: { zh: "当前智能体需要配置模型", en: "Current Agent model setup required" },
  untested: { zh: "当前智能体模型尚未手动测试", en: "Current Agent model has not been manually tested" },
  none: { zh: "需要选择工作区", en: "Workspace selection required" },
  untrusted: { zh: "需要信任工作区", en: "Workspace trust required" },
  trusted: { zh: "已信任", en: "Trusted" },
};

const MISSING_ITEM_LABELS: Record<string, { zh: string; en: string }> = {
  repository: { zh: "运行时仓库未找到", en: "Runtime repository not found" },
  python: { zh: "Python 3.11+ 未找到", en: "Python 3.11+ not found" },
  "drsai-cli": { zh: "drsai-cli 命令行工具未找到", en: "drsai-cli command not found" },
  "drsai-version": { zh: "无法读取运行时版本", en: "Cannot read runtime version" },
  "backend-version": { zh: "后端版本不匹配，需要更新", en: "Backend version mismatch, update needed" },
  status: { zh: "无法获取运行时状态", en: "Cannot read runtime status" },
};

const AUTO_OPEN_STATES = new Set([
  "anonymous",
  "blocked",
  "unconfigured",
  "none",
  "untrusted",
]);

export function OperationalStateBar({
  decision,
  language,
  blocker,
  installMissing,
  busy = false,
  actionMessage,
  onPrimaryAction,
  onCopyDiagnostics,
  onDismissBlocker,
}: {
  decision: OperationalStateDecision;
  language: AppLanguage;
  blocker?: OperationalStateBlockerInfo | null;
  installMissing?: string[] | null;
  busy?: boolean;
  actionMessage?: string | null;
  onPrimaryAction?: () => void | Promise<void>;
  onCopyDiagnostics?: () => void | Promise<void>;
  onDismissBlocker?: () => void;
}): React.JSX.Element {
  const zh = language === "zh";
  const labels = LABELS[language];
  const currentCopy = busy && decision.currentLayer === "agent"
    ? (zh ? "正在验证当前智能体模型" : "Verifying current Agent model")
    : STATE_COPY[decision.state]?.[language] ?? decision.state;
  const [open, setOpen] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const modalDismissedRef = useRef(false);

  useEffect(() => {
    if (AUTO_OPEN_STATES.has(decision.state)) setOpen(true);
  }, [decision.currentLayer, decision.state]);

  // Show the blocker modal when runtime is blocked and blocker details are
  // available. Only auto-show once per blocker; dismissing it prevents
  // re-showing for the same blocker instance.
  useEffect(() => {
    if (
      decision.blockingLayer === "runtime" &&
      blocker &&
      !modalDismissedRef.current
    ) {
      setModalVisible(true);
    }
  }, [decision.blockingLayer, blocker?.diagnosticCode]);

  function dismissModal(): void {
    modalDismissedRef.current = true;
    setModalVisible(false);
    onDismissBlocker?.();
  }

  return <>
    <details
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
      <div className="operational-state-popover" role="dialog" aria-label={zh ? "OpenDrSai 就绪状态" : "OpenDrSai readiness status"}>
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
        {blocker ? <div className="operational-state-blocker-reason" role="alert">
          <p><strong>{blocker.title}</strong></p>
          <p>{blocker.message}</p>
          {blocker.diagnosticCode ? <p><small>{zh ? "诊断代码" : "Diagnostic code"}: {blocker.diagnosticCode}</small></p> : null}
          {installMissing && installMissing.length > 0 ? <div className="operational-state-missing">
            <p>{zh ? "缺失的运行时组件：" : "Missing runtime components:"}</p>
            <ul>
              {installMissing.map((item) => <li key={item}>{MISSING_ITEM_LABELS[item]?.[language] ?? item}</li>)}
            </ul>
          </div> : null}
        </div> : null}
        {decision.blockingLayer || (decision.currentLayer === "agent" && decision.state === "untested") ? <div className="operational-state-actions" role="group" aria-label={zh ? "恢复操作" : "Recovery actions"}>
          {onPrimaryAction ? <button type="button" data-testid="operational-primary-action" disabled={busy} onClick={() => void onPrimaryAction()}>
            {busy ? (zh ? "正在处理…" : "Working…") : primaryActionLabel(decision, language)}
          </button> : null}
          {onCopyDiagnostics ? <button type="button" data-testid="operational-copy-diagnostics" disabled={busy} onClick={() => void onCopyDiagnostics()}>{zh ? "复制脱敏诊断" : "Copy redacted diagnostics"}</button> : null}
          {actionMessage ? <span role="status" data-testid="operational-action-message">{actionMessage}</span> : null}
        </div> : null}
      </div>
    </details>
    {modalVisible && blocker ? <div className="operational-state-modal-overlay" role="dialog" aria-modal="true" aria-label={blocker.title} onClick={(event) => { if (event.target === event.currentTarget) dismissModal(); }}>
      <div className="operational-state-modal" data-testid="operational-blocker-modal">
        <header>
          <h2>{blocker.title}</h2>
          <button type="button" className="operational-state-modal-close" aria-label={zh ? "关闭" : "Close"} onClick={dismissModal}>✕</button>
        </header>
        <div className="operational-state-modal-body">
          <p>{blocker.message}</p>
          {blocker.diagnosticCode ? <p className="operational-state-modal-diag"><small>{zh ? "诊断代码" : "Diagnostic code"}: {blocker.diagnosticCode}</small></p> : null}
          {installMissing && installMissing.length > 0 ? <div className="operational-state-modal-missing">
            <p><strong>{zh ? "缺失的运行时组件：" : "Missing runtime components:"}</strong></p>
            <ul>
              {installMissing.map((item) => <li key={item}>{MISSING_ITEM_LABELS[item]?.[language] ?? item}</li>)}
            </ul>
          </div> : null}
        </div>
        <div className="operational-state-modal-actions">
          {onPrimaryAction ? <button type="button" data-testid="operational-modal-primary-action" disabled={busy} onClick={() => { void onPrimaryAction(); dismissModal(); }}>
            {busy ? (zh ? "正在处理…" : "Working…") : primaryActionLabel(decision, language)}
          </button> : null}
          {onCopyDiagnostics ? <button type="button" data-testid="operational-modal-copy-diagnostics" disabled={busy} onClick={() => { void onCopyDiagnostics(); }}>{zh ? "复制脱敏诊断" : "Copy redacted diagnostics"}</button> : null}
          <button type="button" data-testid="operational-modal-dismiss" onClick={dismissModal}>{zh ? "稍后处理" : "Dismiss"}</button>
        </div>
      </div>
    </div> : null}
  </>;
}

function primaryActionLabel(decision: OperationalStateDecision, language: AppLanguage): string {
  const zh = language === "zh";
  if (decision.currentLayer === "identity") return zh ? "前往登录" : "Go to sign in";
  if (decision.currentLayer === "runtime") return zh ? "修复并重试运行时" : "Repair and retry runtime";
  if (decision.currentLayer === "agent") {
    if (decision.state === "unavailable") return zh ? "打开智能体配置" : "Open Agent configuration";
    return decision.state === "untested" ? (zh ? "打开模型提供方设置" : "Open Model provider settings") : (zh ? "配置当前智能体模型" : "Configure current Agent model");
  }
  if (decision.currentLayer === "workspace") return decision.state === "untrusted" ? (zh ? "信任此工作区" : "Trust this workspace") : (zh ? "选择工作区" : "Choose workspace");
  return zh ? "检查工作区" : "Check workspace";
}