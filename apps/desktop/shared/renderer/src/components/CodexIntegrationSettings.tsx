import { useMemo, useState } from "react";
import {
  AlertCircle,
  Cable,
  Check,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Download,
  ExternalLink,
  LogIn,
  LogOut,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  UserRound,
  Wrench,
} from "lucide-react";
import type { CodexBackendLogin, CodexBackendStatus, DesktopHealth, WorkspaceProject } from "@shared/desktopApi";
import { copyTextSafely } from "../clipboard";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";
import { OpenAiBrandIcon } from "./OpenAiBrandIcon";

type CodexIntegrationTone = "checking" | "success" | "warning" | "danger";
type CodexPrimaryAction = "use" | "install" | "upgrade" | "login" | "refresh" | "restart" | null;

export interface CodexIntegrationViewModel {
  tone: CodexIntegrationTone;
  statusLabel: string;
  statusSummary: string;
  primaryAction: CodexPrimaryAction;
  primaryLabel: string | null;
  showSetup: boolean;
  recovering: boolean;
}

export function deriveCodexIntegrationViewModel(
  status: CodexBackendStatus | null,
  health: DesktopHealth | null,
  zh: boolean,
): CodexIntegrationViewModel {
  const liveness = health?.gateway.liveness?.state;
  const recovering = liveness === "degraded" || liveness === "reconnecting";
  if (!status) {
    return {
      tone: "checking",
      statusLabel: zh ? "正在检查" : "Checking",
      statusSummary: zh ? "正在读取 Codex 集成状态。" : "Reading the Codex integration status.",
      primaryAction: null,
      primaryLabel: null,
      showSetup: true,
      recovering,
    };
  }
  if (recovering) {
    return {
      tone: "checking",
      statusLabel: zh ? "正在恢复" : "Recovering",
      statusSummary: zh ? "OpenDrSai 正在自动恢复与 Codex 的连接。" : "OpenDrSai is restoring the Codex connection automatically.",
      primaryAction: null,
      primaryLabel: null,
      showSetup: status.state !== "available",
      recovering: true,
    };
  }
  if (status.state === "available") {
    return {
      tone: "success",
      statusLabel: zh ? "已连接" : "Connected",
      statusSummary: zh ? "Codex 已可在当前工作区使用。" : "Codex is ready in the current workspace.",
      primaryAction: "use",
      primaryLabel: zh ? "开始使用 Codex" : "Use Codex",
      showSetup: false,
      recovering: false,
    };
  }
  if (status.state === "not_installed") {
    return {
      tone: "warning",
      statusLabel: zh ? "需要安装" : "Installation required",
      statusSummary: zh ? "安装 Codex 后即可连接 ChatGPT 账户。" : "Install Codex before connecting a ChatGPT account.",
      primaryAction: "install",
      primaryLabel: zh ? "安装 Codex" : "Install Codex",
      showSetup: true,
      recovering: false,
    };
  }
  if (status.state === "version_incompatible") {
    return {
      tone: "warning",
      statusLabel: zh ? "需要更新" : "Update required",
      statusSummary: zh ? "当前 Codex 版本与 OpenDrSai 不兼容。" : "The installed Codex version is not compatible with OpenDrSai.",
      primaryAction: "upgrade",
      primaryLabel: zh ? "更新 Codex" : "Update Codex",
      showSetup: true,
      recovering: false,
    };
  }
  if (status.state === "not_logged_in") {
    return {
      tone: "warning",
      statusLabel: zh ? "需要登录" : "Sign-in required",
      statusSummary: zh ? "使用 ChatGPT 账户连接 Codex。" : "Connect Codex with your ChatGPT account.",
      primaryAction: "login",
      primaryLabel: zh ? "登录 ChatGPT" : "Sign in to ChatGPT",
      showSetup: true,
      recovering: false,
    };
  }
  if (status.state === "account_unavailable") {
    return {
      tone: "warning",
      statusLabel: zh ? "账户暂不可用" : "Account unavailable",
      statusSummary: zh ? "暂时无法确认 Codex 账户或模型状态。" : "The Codex account or model status could not be confirmed.",
      primaryAction: "refresh",
      primaryLabel: zh ? "重新检查" : "Check again",
      showSetup: true,
      recovering: false,
    };
  }
  const action: CodexPrimaryAction = status.action === "install" ? "install"
    : status.action === "upgrade" ? "upgrade"
    : status.action === "login" ? "login"
    : status.action === "restart" || status.action === "reconnect" ? "restart"
    : "refresh";
  const label = action === "install" ? (zh ? "安装 Codex" : "Install Codex")
    : action === "upgrade" ? (zh ? "更新 Codex" : "Update Codex")
    : action === "login" ? (zh ? "登录 ChatGPT" : "Sign in to ChatGPT")
    : action === "restart" ? (zh ? "恢复连接" : "Restore connection")
    : (zh ? "重新检查" : "Check again");
  return {
    tone: "danger",
    statusLabel: zh ? "连接异常" : "Connection issue",
    statusSummary: status.reason || (zh ? "Codex 当前无法使用。" : "Codex is currently unavailable."),
    primaryAction: action,
    primaryLabel: label,
    showSetup: true,
    recovering: false,
  };
}

export function CodexIntegrationSettings({
  busy,
  health,
  language,
  status,
  onRefresh,
  onRestart,
  onRepair,
  onLogin,
  onLogout,
  onUseCodex,
  workspaces,
  onSyncWorkspaceSessions,
}: {
  busy: boolean;
  health: DesktopHealth | null;
  language: AppLanguage;
  status: CodexBackendStatus | null;
  onRefresh: () => void | Promise<void>;
  onRestart: () => void | Promise<void>;
  onRepair: () => void | Promise<void>;
  onLogin: (type: "chatgpt" | "chatgptDeviceCode") => Promise<CodexBackendLogin>;
  onLogout: () => void | Promise<void>;
  onUseCodex: () => void | Promise<void>;
  workspaces: WorkspaceProject[];
  onSyncWorkspaceSessions: (workspace: WorkspaceProject) => void | Promise<void>;
}): React.JSX.Element {
  const zh = language === "zh";
  const view = useMemo(() => deriveCodexIntegrationViewModel(status, health, zh), [health, status, zh]);
  const [login, setLogin] = useState<CodexBackendLogin | null>(null);
  const [pendingAction, setPendingAction] = useState<CodexPrimaryAction | "logout" | "diagnostic">(null);
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionBusy = busy || pendingAction !== null;
  const localWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.location !== "remote"),
    [workspaces],
  );

  async function runAction(action: CodexPrimaryAction): Promise<void> {
    if (!action || actionBusy) return;
    setActionError(null);
    setPendingAction(action);
    try {
      if (action === "use") await onUseCodex();
      else if (action === "login") setLogin(await onLogin("chatgptDeviceCode"));
      else if (action === "install" || action === "upgrade") await onRepair();
      else if (action === "restart") await onRestart();
      else await onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function copyDiagnostic(): Promise<void> {
    setPendingAction("diagnostic");
    try {
      await copyTextSafely(JSON.stringify({
        product: "OpenDrSai Desktop",
        desktopVersion: health?.update.currentVersion ?? "unknown",
        runtimeReady: health?.gatewayReady ?? false,
        runtimeMode: health?.mode ?? "local",
        runtimeInstance: health?.gateway.instance ?? null,
        codex: status ? {
          state: status.state,
          version: status.version,
          loggedIn: status.loggedIn,
          appServerState: status.appServerState,
          connectionState: status.connectionState,
          transport: status.transport,
          adapterVersion: status.adapterVersion,
          retryable: status.retryable,
          liveness: health?.gateway.liveness,
          readiness: status.readiness,
          binaryIdentity: status.binaryIdentity ? {
            source: status.binaryIdentity.source,
            version: status.binaryIdentity.version,
            binaryDigest: status.binaryIdentity.binaryDigest,
            schemaDigest: status.binaryIdentity.schemaDigest,
            releaseSafe: status.binaryIdentity.releaseSafe,
          } : null,
        } : null,
        generatedAt: new Date().toISOString(),
      }, null, 2));
      setDiagnosticCopied(true);
      window.setTimeout(() => setDiagnosticCopied(false), 2_000);
    } finally {
      setPendingAction(null);
    }
  }

  async function logout(): Promise<void> {
    if (actionBusy) return;
    setPendingAction("logout");
    setActionError(null);
    try {
      await onLogout();
      setLogin(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  const transport = status?.transport === "ssh" ? (zh ? "远程 SSH" : "Remote SSH") : (zh ? "本机" : "Local");
  const liveness = connectionLabel(health, zh);
  const installed = status ? (status.installed ?? status.state !== "not_installed") : false;
  const contractReady = status ? (status.contractCompatible ?? status.state !== "version_incompatible") : false;
  const installState = installed
    ? contractReady
      ? `${zh ? "已安装" : "Installed"}${status?.version ? ` · ${status.version}` : ""}`
      : `${zh ? "需要更新" : "Update required"}${status?.version ? ` · ${status.version}` : ""}`
    : (zh ? "尚未安装" : "Not installed");

  return (
    <div className="codex-integration-page" data-testid="codex-runtime-settings">
      <section className={`codex-integration-hero tone-${view.tone}`}>
        <header>
          <span className="codex-integration-logo"><OpenAiBrandIcon size={30} /></span>
          <div className="codex-integration-title">
            <div><h2>Codex</h2><span className="codex-status-badge" data-testid={`codex-state-${status?.state ?? "loading"}`}>{view.statusLabel}</span></div>
            <p>{zh ? "在当前工作区使用 Codex 完成编程任务。" : "Use Codex for coding tasks in the current workspace."}</p>
          </div>
          <button className="codex-icon-button" type="button" onClick={() => void runAction("refresh")} disabled={actionBusy} aria-label={zh ? "刷新 Codex 状态" : "Refresh Codex status"} title={zh ? "刷新" : "Refresh"}>
            <RefreshCw size={15} className={view.tone === "checking" || pendingAction === "refresh" ? "spinning" : ""} />
          </button>
        </header>

        <p className="codex-integration-description">
          {zh
            ? "通过自研 Codex Adapter 接入并符合 OpenDrSai Agent 协议（OAEP），使任务过程可复现，并将数据与技能沉淀为可复用资产。"
            : "Integrated through the in-house Codex Adapter and aligned with the OpenDrSai Agent Protocol (OAEP), so tasks are reproducible and their data and skills become reusable assets."}
        </p>

        <div className="codex-integration-summary" role="status" data-testid="codex-backend-status">
          <span>{view.tone === "success" ? <CheckCircle2 size={15} /> : view.tone === "danger" ? <AlertCircle size={15} /> : <RefreshCw size={15} className={view.recovering ? "spinning" : ""} />}{view.statusSummary}</span>
          {status?.loggedIn && <span><UserRound size={14} />{status.accountLabel || (zh ? "ChatGPT 账户" : "ChatGPT account")}</span>}
          {status && <span><Cable size={14} />{transport}</span>}
        </div>

        {actionError && <div className="codex-action-error" role="alert">{actionError}</div>}
        {view.primaryAction && view.primaryLabel && (
          <div className="codex-primary-action-row">
            <button className="codex-primary-action" type="button" data-testid={primaryActionTestId(view.primaryAction)} disabled={actionBusy} onClick={() => void runAction(view.primaryAction)}>
              {primaryActionIcon(view.primaryAction, pendingAction === view.primaryAction)}
              {pendingAction === view.primaryAction ? (zh ? "正在处理…" : "Working…") : view.primaryLabel}
            </button>
          </div>
        )}
      </section>

      <section className="codex-connection-section" aria-labelledby="codex-connection-heading">
        <h3 id="codex-connection-heading">{zh ? "连接" : "Connection"}</h3>
        <div className="codex-connection-list" data-testid="codex-health-layers">
          <ConnectionRow icon={<PackageCheck size={17} />} label="Codex" value={installState} ok={Boolean(installed && contractReady)} />
          <ConnectionRow icon={<UserRound size={17} />} label={zh ? "ChatGPT 账户" : "ChatGPT account"} value={status?.loggedIn ? status.accountLabel || (zh ? "已登录" : "Signed in") : (zh ? "尚未登录" : "Not signed in")} ok={Boolean(status?.loggedIn)} />
          <ConnectionRow icon={<Cable size={17} />} label={zh ? "工作区连接" : "Workspace connection"} value={`${transport} · ${liveness}`} ok={health?.gateway.liveness?.state === "ready" && status?.available === true} />
        </div>
      </section>

      <section
        className="codex-connection-section codex-session-sync-section"
        data-testid="codex-workspace-sync-settings"
        aria-labelledby="codex-session-sync-heading"
      >
        <div className="codex-section-heading">
          <div>
            <h3 id="codex-session-sync-heading">{zh ? "Codex 会话同步" : "Codex conversation sync"}</h3>
            <p>{zh ? "将 Codex CLI 的历史会话同步到对应的本机工作区。" : "Sync Codex CLI conversation history into the matching local workspace."}</p>
          </div>
        </div>
        <div className="codex-session-sync-list">
          {localWorkspaces.map((workspace) => (
            <div className="codex-session-sync-row" key={workspace.id}>
              <span>
                <strong>{workspace.name}</strong>
                <small title={workspace.path}>{workspace.path}</small>
              </span>
              <button type="button" disabled={busy} onClick={() => void onSyncWorkspaceSessions(workspace)}>
                <RefreshCw size={14} />
                {zh ? "同步" : "Sync"}
              </button>
            </div>
          ))}
          {localWorkspaces.length === 0 && (
            <p className="codex-session-sync-empty">{zh ? "暂无可同步的本机工作区。" : "No local workspace is available for sync."}</p>
          )}
        </div>
      </section>

      {view.showSetup && (
        <section className="codex-setup-section" aria-labelledby="codex-setup-heading">
          <h3 id="codex-setup-heading">{zh ? "完成连接" : "Finish connecting"}</h3>
          <ol className="codex-setup-steps" data-testid="codex-setup-steps" aria-label={zh ? "Codex 首次使用向导" : "Codex first-use setup"}>
            <SetupStep state={installed ? "complete" : "current"} label={zh ? "检查或安装 Codex" : "Check or install Codex"} detail={installState} />
            <SetupStep state={status?.loggedIn ? "complete" : installed ? "current" : "pending"} label={zh ? "登录 ChatGPT" : "Sign in to ChatGPT"} detail={status?.loggedIn ? status.accountLabel || (zh ? "已登录" : "Signed in") : (zh ? "连接账户后才能使用 Codex" : "Connect an account before using Codex")} />
            <SetupStep state={status?.available ? "complete" : status?.loggedIn ? "current" : "pending"} label={zh ? "开始 Codex 会话" : "Start a Codex conversation"} detail={zh ? "完成前两步后自动就绪" : "Ready automatically after the first two steps"} />
          </ol>
          {login?.userCode && (
            <div className="codex-device-login" role="status" data-testid="codex-device-code">
              <div><strong>{zh ? "在 ChatGPT 中确认登录" : "Confirm sign-in with ChatGPT"}</strong><span>{zh ? "输入以下一次性设备码。" : "Enter this one-time device code."}</span></div>
              <code>{login.userCode}</code>
              <div>
                <button type="button" onClick={() => void copyTextSafely(login.userCode!)}><Clipboard size={14} />{zh ? "复制设备码" : "Copy code"}</button>
                {login.verificationUrl && <button type="button" onClick={() => void desktopApi.openExternal(login.verificationUrl!)}><ExternalLink size={14} />{zh ? "打开登录页面" : "Open sign-in page"}</button>}
              </div>
            </div>
          )}
        </section>
      )}

      <details className="codex-advanced" data-testid="codex-advanced-diagnostics">
        <summary><ChevronRight size={15} />{zh ? "高级设置与诊断" : "Advanced settings and diagnostics"}</summary>
        <div className="codex-advanced-content">
          <dl>
            <div><dt>App Server</dt><dd>{status?.appServerState === "running" ? (zh ? "运行中" : "Running") : (zh ? "按需启动" : "Starts on demand")}</dd></div>
            <div><dt>{zh ? "连接方式" : "Transport"}</dt><dd>{transport}</dd></div>
            <div><dt>Adapter</dt><dd>{status?.adapterVersion || (zh ? "等待检测" : "Pending check")}</dd></div>
            <div><dt>{zh ? "Codex 来源" : "Codex source"}</dt><dd>{status?.binaryIdentity?.source || (zh ? "等待检测" : "Pending check")}</dd></div>
            <div><dt>Runtime instance</dt><dd>{health?.gateway.instance ? `${health.gateway.instance.mode} · ${health.gateway.instance.port} · ${health.gateway.instance.instanceId.slice(0, 8)}` : (zh ? "等待检测" : "Pending check")}</dd></div>
            <div><dt>Runtime home</dt><dd title={health?.gateway.instance?.home || health?.install.home || ""}>{health?.gateway.instance?.home || health?.install.home || "—"}</dd></div>
            <div><dt>{zh ? "最近观察" : "Last observation"}</dt><dd>{health?.gateway.liveness?.lastAttemptAt ? new Date(health.gateway.liveness.lastAttemptAt).toLocaleTimeString() : "—"}</dd></div>
          </dl>
          {status?.readiness && (
            <div className="codex-readiness-details">
              {Object.entries(status.readiness).map(([key, facet]) => <span key={key}><strong>{key}</strong><em>{facet?.state || "unknown"}{facet?.reason ? ` · ${facet.reason}` : ""}</em></span>)}
            </div>
          )}
          <div className="codex-advanced-actions">
            <button type="button" data-testid="copy-codex-diagnostic" disabled={actionBusy} onClick={() => void copyDiagnostic()}><Clipboard size={14} />{diagnosticCopied ? (zh ? "已复制" : "Copied") : (zh ? "复制脱敏诊断" : "Copy redacted diagnostics")}</button>
            {installed && <button type="button" data-testid="codex-restart-action" disabled={actionBusy} onClick={() => void runAction("restart")}><RotateCcw size={14} />{zh ? "重启 Codex" : "Restart Codex"}</button>}
            {status?.loggedIn && <button className="codex-logout-action" type="button" data-testid="codex-logout" disabled={actionBusy} onClick={() => void logout()}><LogOut size={14} />{zh ? "退出 Codex 账户" : "Sign out of Codex"}</button>}
          </div>
        </div>
      </details>
    </div>
  );
}

function ConnectionRow({ icon, label, value, ok }: { icon: React.ReactNode; label: string; value: string; ok: boolean }): React.JSX.Element {
  return <div className="codex-connection-row"><span className="codex-connection-icon">{icon}</span><span><strong>{label}</strong><small>{value}</small></span><span className={`codex-row-state ${ok ? "is-ready" : "is-pending"}`}>{ok ? <Check size={14} /> : <AlertCircle size={14} />}</span></div>;
}

function SetupStep({ state, label, detail }: { state: "complete" | "current" | "pending"; label: string; detail: string }): React.JSX.Element {
  return <li data-state={state}><span className="codex-step-marker">{state === "complete" ? <Check size={13} /> : null}</span><span><strong>{label}</strong><small>{detail}</small></span></li>;
}

function connectionLabel(health: DesktopHealth | null, zh: boolean): string {
  const state = health?.gateway.liveness?.state;
  if (state === "ready") return zh ? "已连接" : "Connected";
  if (state === "degraded" || state === "reconnecting") return zh ? "正在恢复" : "Recovering";
  if (state === "probing" || state === "unknown" || !state) return zh ? "正在连接" : "Connecting";
  if (state === "action_required") return zh ? "需要操作" : "Action required";
  return zh ? "已停止" : "Stopped";
}

function primaryActionIcon(action: CodexPrimaryAction, spinning: boolean): React.JSX.Element {
  if (spinning) return <RefreshCw size={15} className="spinning" />;
  if (action === "use") return <ChevronRight size={15} />;
  if (action === "login") return <LogIn size={15} />;
  if (action === "install") return <Download size={15} />;
  if (action === "upgrade") return <Wrench size={15} />;
  if (action === "restart") return <RotateCcw size={15} />;
  return <RefreshCw size={15} />;
}

function primaryActionTestId(action: CodexPrimaryAction): string | undefined {
  if (action === "login") return "codex-login";
  if (action === "install") return "codex-install-action";
  if (action === "upgrade") return "codex-upgrade-action";
  if (action === "restart") return "codex-restart-action";
  if (action === "use") return "codex-use-action";
  return undefined;
}
