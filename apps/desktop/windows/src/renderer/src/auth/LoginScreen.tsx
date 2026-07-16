import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AuthSession,
  DesktopBootstrapBlockerKind,
  DesktopHealth,
  OidcLoginDebugEvent,
} from "@shared/desktopApi";
import drsaiLogo from "../assets/drsai-transparent.png";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";
import { useAuth } from "./AuthProvider";

export function LoginScreen(): React.JSX.Element {
  const auth = useAuth();
  const [language, setLanguage] = useState<AppLanguage>("zh");
  const [debugOpen, setDebugOpen] = useState(false);
  const [loginEvents, setLoginEvents] = useState<OidcLoginDebugEvent[]>([]);
  const [rememberMe, setRememberMe] = useState(true);
  const [diagnosticMessage, setDiagnosticMessage] = useState<string | null>(null);
  const zh = language === "zh";
  const authGuide = getAvailabilityGuide("auth_required", zh);
  const latestLoginEvent = loginEvents[loginEvents.length - 1] ?? null;
  const loginDebugTitle = zh ? "登录调试" : "Login Debug";
  const currentStepLabel = useMemo(() => {
    if (!latestLoginEvent) return zh ? "尚未开始" : "Not started";
    return getDebugStageLabel(latestLoginEvent.stage, zh);
  }, [latestLoginEvent, zh]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "F12") return;
      event.preventDefault();
      setDebugOpen((open) => !open);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const unsubscribe = window.openDrSai?.onOidcLoginDebug?.((event) => {
      setLoginEvents((events) => [...events.slice(-79), event]);
    });
    return () => unsubscribe?.();
  }, []);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setLoginEvents([
      {
        stage: "started",
        status: "info",
        message: "Clicked HepAI sign-in button.",
        at: new Date().toISOString(),
      },
    ]);
    await auth.startOidcLogin({ rememberMe });
  }

  function getSubmitLabel(): string {
    if (auth.loginBusy) return zh ? "正在等待浏览器登录..." : "Waiting for browser sign-in...";
    return zh ? "使用 HepAI 登录" : "Sign in with HepAI";
  }

  async function handleCopyDiagnostics(): Promise<void> {
    const copied = await copyAvailabilityDiagnostics({
      kind: "auth_required",
      message: auth.message || authGuide.body,
      session: auth.session,
    });
    setDiagnosticMessage(
      copied
        ? zh ? "已复制脱敏诊断信息。" : "Redacted diagnostics copied."
        : zh ? "复制失败，请重试。" : "Copy failed. Please try again.",
    );
  }

  return (
    <main className={`login-screen ${debugOpen ? "debug-open" : ""}`}>
      <div className="login-window-drag-region" aria-hidden />
      <section
        className="login-panel login-minimal"
        aria-label={zh ? "OpenDrSai 登录" : "OpenDrSai sign in"}
        data-a5-state="auth_required"
      >
        <div className="login-brand">
          <span className="login-brand-logo" aria-hidden>
            <img src={drsaiLogo} alt="" />
          </span>
          <strong>
            Open<span className="brand-accent">Dr</span>Sai
          </strong>
        </div>

        <div className="login-language" role="group" aria-label={zh ? "语言" : "Language"}>
          <button type="button" className={language === "zh" ? "active" : ""} onClick={() => setLanguage("zh")}>
            中文
          </button>
          <button type="button" className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>
            EN
          </button>
        </div>

        <img className="login-glyph login-glyph-logo" src={drsaiLogo} alt="" aria-hidden />

        <div className="login-heading">
          <h1 className={zh ? undefined : "login-heading-title-en"}>
            {zh ? (
              <strong>科学发现的 AI</strong>
            ) : (
              <>
                <strong>The AI for Discovery</strong>
                <span>at Large Scientific Facilities</span>
              </>
            )}
          </h1>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <button className="login-submit" type="submit" disabled={auth.loginBusy} data-testid="a5-login-action">
            {getSubmitLabel()}
          </button>

          {auth.loginBusy && (
            <button className="login-mode-link" type="button" onClick={() => auth.cancelOidcLogin()}>
              {zh ? "取消登录" : "Cancel sign-in"}
            </button>
          )}

          <label className="login-checkbox">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
            />
            <span>{zh ? "保持登录状态" : "Keep me signed in"}</span>
          </label>
        </form>

        {import.meta.env.DEV && (
          <button
            className="developer-bypass"
            type="button"
            disabled={auth.loginBusy}
            onClick={() => auth.login({ developerBypass: true, rememberMe })}
          >
            {zh ? "进入开发者工作区" : "Enter developer workspace"}
          </button>
        )}

        <div className="login-footnote">
          {zh
            ? "继续即表示你同意 OpenDrSai 服务条款和隐私政策。"
            : "By continuing, you agree to OpenDrSai terms and privacy policy."}
        </div>
      </section>

      {debugOpen && (
        <aside className="login-debug-panel" aria-label={loginDebugTitle}>
          <div className="login-debug-header">
            <div>
              <strong>{loginDebugTitle}</strong>
              <span>{zh ? "当前步骤" : "Current step"}: {currentStepLabel}</span>
            </div>
            <button type="button" onClick={() => setDebugOpen(false)} aria-label={zh ? "关闭登录调试" : "Close login debug"}>
              x
            </button>
          </div>
          <div className={`login-debug-status ${latestLoginEvent?.status ?? "info"}`}>
            {latestLoginEvent?.message ?? (zh
              ? "按 F12 打开或关闭。点击登录后这里会显示流程进度。"
              : "Press F12 to toggle. Login progress appears here after clicking sign in.")}
          </div>
          <section className="availability-guidance" aria-label={zh ? "无法开始任务的原因" : "Why tasks cannot start"}>
            <strong>{authGuide.title}</strong>
            <p data-testid="a5-guidance-message">{authGuide.body}</p>
            {auth.message && <code>{sanitizeDiagnosticText(auth.message)}</code>}
            <ul>
              {authGuide.points.map((point) => <li key={point}>{point}</li>)}
            </ul>
            <button
              className="login-mode-link"
              type="button"
              onClick={handleCopyDiagnostics}
              data-testid="a5-copy-diagnostics"
            >
              {zh ? "复制脱敏诊断" : "Copy redacted diagnostics"}
            </button>
            {diagnosticMessage && <span className="availability-copy-status">{diagnosticMessage}</span>}
          </section>
          <ol className="login-debug-list">
            {loginEvents.length === 0 ? (
              <li className="login-debug-empty">
                {zh ? "暂无日志。点击“使用 HepAI 登录”开始。" : "No logs yet. Click Sign in with HepAI to start."}
              </li>
            ) : (
              loginEvents.map((event, index) => (
                <li key={`${event.at}-${index}`} className={`login-debug-item ${event.status}`}>
                  <time>{formatDebugTime(event.at)}</time>
                  <div>
                    <strong>{getDebugStageLabel(event.stage, zh)}</strong>
                    <p>{event.message}</p>
                    {event.url && <code>{sanitizeDiagnosticText(event.url)}</code>}
                  </div>
                </li>
              ))
            )}
          </ol>
        </aside>
      )}
    </main>
  );
}

function getDebugStageLabel(stage: OidcLoginDebugEvent["stage"], zh: boolean): string {
  const labels: Record<OidcLoginDebugEvent["stage"], [string, string]> = {
    started: ["已开始", "Started"],
    "callback-listening": ["本地回调监听中", "Loopback callback listening"],
    discovery: ["已读取 Discovery", "Discovery loaded"],
    "authorize-url": ["准备打开授权地址", "Authorization URL prepared"],
    "browser-opened": ["已请求打开浏览器", "Browser open requested"],
    "waiting-callback": ["等待浏览器回调", "Waiting for callback"],
    "callback-received": ["已收到回调", "Callback received"],
    "token-exchange": ["正在交换 token", "Exchanging token"],
    "token-verified": ["token 已验证", "Token verified"],
    "session-created": ["会话已创建", "Session created"],
    cancelled: ["已取消", "Cancelled"],
    failed: ["失败", "Failed"],
  };
  const [zhLabel, enLabel] = labels[stage];
  return zh ? zhLabel : enLabel;
}

function formatDebugTime(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ServiceUnavailableScreen(): React.JSX.Element {
  const auth = useAuth();
  const [health, setHealth] = useState<DesktopHealth | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairMessage, setRepairMessage] = useState<string | null>(null);
  const kind = getServiceAvailabilityKind(auth.serviceBlocker?.kind, auth.message, health);
  const guide = getAvailabilityGuide(kind, true);

  useEffect(() => {
    let cancelled = false;
    loadAvailabilityHealth()
      .then((snapshot) => {
        if (!cancelled) setHealth(snapshot);
      })
      .catch(() => {
        if (!cancelled) setHealth(null);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.serviceBusy, auth.message]);

  async function handleRetry(): Promise<void> {
    setCopyMessage(null);
    setRepairMessage(null);
    await auth.retryBootstrap();
    setHealth(await loadAvailabilityHealth().catch(() => null));
  }

  async function handleRepairRuntime(): Promise<void> {
    setRepairBusy(true);
    setCopyMessage(null);
    setRepairMessage(null);
    try {
      await desktopApi.startInstall({ installPrerequisites: true });
      setRepairMessage("已开始检查并修复本地运行时。完成后请重试。");
    } catch (error) {
      setRepairMessage(error instanceof Error ? sanitizeDiagnosticText(error.message) : "无法启动运行时修复。");
    } finally {
      setRepairBusy(false);
      setHealth(await loadAvailabilityHealth().catch(() => null));
    }
  }

  async function handleCopyDiagnostics(): Promise<void> {
    const copied = await copyAvailabilityDiagnostics({
      kind,
      message: auth.message || guide.body,
      session: auth.session,
      health,
    });
    setCopyMessage(copied ? "已复制脱敏诊断信息。" : "复制失败，请重试。");
  }

  return (
    <main className="login-screen">
      <section
        className="login-panel login-minimal compact availability-panel"
        aria-label="OpenDrSai 服务引导"
        data-a5-state={kind}
      >
        <div className="login-brand">
          <span className="login-brand-logo" aria-hidden><img src={drsaiLogo} alt="" /></span>
          <strong>Open<span className="brand-accent">Dr</span>Sai</strong>
        </div>
        <div className="login-heading">
          <h1><strong>{auth.serviceBusy ? "正在检查服务" : guide.title}</strong></h1>
        </div>
        <section className="availability-guidance" aria-label="服务不可用说明">
          <p data-testid="a5-guidance-message">
            {auth.serviceBusy ? "OpenDrSai 正在确认登录、运行时和本地服务状态。" : guide.body}
          </p>
          <ul>
            {guide.points.map((point) => <li key={point}>{point}</li>)}
          </ul>
          {auth.message && <code>{sanitizeDiagnosticText(auth.message)}</code>}
        </section>
        <div className="availability-actions">
          {kind === "runtime_missing" && (
            <button
              className="login-submit"
              type="button"
              disabled={auth.serviceBusy || repairBusy}
              onClick={handleRepairRuntime}
              data-testid="a5-repair-runtime-action"
            >
              {repairBusy ? "正在检查运行时..." : "修复/检查运行时"}
            </button>
          )}
          {kind !== "permission_denied" && (
            <button
              className={kind === "runtime_missing" ? "login-mode-link" : "login-submit"}
              type="button"
              disabled={auth.serviceBusy || repairBusy}
              onClick={handleRetry}
              data-testid="a5-retry-action"
            >
              {auth.serviceBusy ? "正在重试..." : "重试"}
            </button>
          )}
          <button
            className={kind === "permission_denied" ? "login-submit" : "login-mode-link"}
            type="button"
            disabled={auth.logoutBusy}
            onClick={() => void auth.logout()}
            data-testid="a5-login-again-action"
          >
            重新登录
          </button>
          <button
            className="login-mode-link"
            type="button"
            onClick={handleCopyDiagnostics}
            data-testid="a5-copy-diagnostics"
          >
            复制脱敏诊断
          </button>
        </div>
        {(copyMessage || repairMessage) && <div className="login-message">{copyMessage || repairMessage}</div>}
      </section>
    </main>
  );
}

function getServiceAvailabilityKind(
  blockerKind: DesktopBootstrapBlockerKind | undefined,
  message: string | null,
  health: DesktopHealth | null,
): DesktopBootstrapBlockerKind {
  if (blockerKind) return blockerKind;
  if (health && isRuntimeMissing(health)) return "runtime_missing";
  const raw = message ?? "";
  if (/sign[- ]?in|oidc|auth|session|token/i.test(raw)) return "auth_required";
  if (/no available|permission|forbidden|cannot use|not authorized|unauthorized|account/i.test(raw)) {
    return "permission_denied";
  }
  if (/runtime|install|repair|python|git|drsai-cli|backend/i.test(raw)) return "runtime_missing";
  return "service_unavailable";
}

export function getAvailabilityGuide(
  kind: DesktopBootstrapBlockerKind,
  zh: boolean,
): { title: string; body: string; points: string[] } {
  const guides: Record<DesktopBootstrapBlockerKind, { zh: [string, string, string[]]; en: [string, string, string[]] }> = {
    auth_required: {
      zh: [
        "需要先登录",
        "OpenDrSai 需要确认你的 HepAI 身份后，才能准备任务服务。现在不会执行任何任务。",
        ["点击登录并在浏览器完成授权。", "如果登录失败，可以复制脱敏诊断给支持人员。"],
      ],
      en: [
        "Sign in required",
        "OpenDrSai needs a valid HepAI sign-in before it can prepare task services. No task will run yet.",
        ["Sign in and complete authorization in the browser.", "If sign-in fails, copy redacted diagnostics for support."],
      ],
    },
    service_unavailable: {
      zh: [
        "服务暂时不可用",
        "OpenDrSai 已阻止任务发送，因为本地任务服务现在没有准备好。",
        ["点击重试会重新检查服务。", "问题仍存在时复制脱敏诊断，不需要截取 token 或密钥。"],
      ],
      en: [
        "Service unavailable",
        "OpenDrSai blocked task submission because the local task service is not ready.",
        ["Retry checks the service again.", "Copy redacted diagnostics if the problem continues; tokens and keys are not needed."],
      ],
    },
    runtime_missing: {
      zh: [
        "需要修复本地运行时",
        "OpenDrSai 已登录，但运行任务所需的本地组件缺失、损坏或版本不匹配。",
        ["点击修复/检查运行时会启动受控安装或修复流程。", "修复完成前不会执行未授权任务。"],
      ],
      en: [
        "Local runtime needs repair",
        "OpenDrSai is signed in, but local components required to run tasks are missing, damaged, or out of date.",
        ["Repair/check runtime starts the controlled repair flow.", "No unauthorized task runs before repair completes."],
      ],
    },
    permission_denied: {
      zh: [
        "账号暂无可用服务",
        "这个 HepAI 账号当前没有可用的 DrSai 模型服务权限，任务不会被发送。",
        ["可重新登录另一个有权限的账号。", "也可以复制脱敏诊断，让管理员检查账号权限。"],
      ],
      en: [
        "Account has no available service",
        "This HepAI account does not currently have permission to use a DrSai model service, so no task was sent.",
        ["Sign in with another authorized account.", "Copy redacted diagnostics so an administrator can check access."],
      ],
    },
  };
  const [title, body, points] = zh ? guides[kind].zh : guides[kind].en;
  return { title, body, points };
}

async function loadAvailabilityHealth(): Promise<DesktopHealth> {
  const [snapshot, install, gateway] = await Promise.all([
    desktopApi.getHealth(),
    desktopApi.getInstallStatus(),
    desktopApi.getGatewayStatus(),
  ]);
  return {
    ...snapshot,
    installed: install.installed,
    gatewayReady: gateway.ready,
    version: install.version,
    install,
    gateway,
  };
}

function isRuntimeMissing(health: DesktopHealth): boolean {
  return (
    !health.install.installed ||
    health.install.backendNeedsRepair ||
    health.install.missing.length > 0 ||
    !health.install.prerequisites.pythonOnPath ||
    !health.install.prerequisites.gitOnPath
  );
}

async function copyAvailabilityDiagnostics({
  kind,
  message,
  session,
  health,
}: {
  kind: DesktopBootstrapBlockerKind;
  message: string;
  session: AuthSession;
  health?: DesktopHealth | null;
}): Promise<boolean> {
  const payload = {
    area: "first-use-service-availability",
    kind,
    capturedAt: new Date().toISOString(),
    message: sanitizeDiagnosticText(message),
    session: {
      authenticated: session.authenticated,
      authMode: session.authMode,
      authProvider: session.authProvider ?? null,
      userRole: session.user?.role ?? null,
      hasUser: Boolean(session.user),
      refreshable: Boolean(session.refreshable),
    },
    health: health ? sanitizeHealthForDiagnostics(health) : null,
  };
  const diagnosticsText = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(diagnosticsText);
    return true;
  } catch {
    return desktopApi.copyTextToClipboard(diagnosticsText).catch(() => false);
  }
}

function sanitizeHealthForDiagnostics(health: DesktopHealth): Record<string, unknown> {
  return {
    installed: health.installed,
    gatewayReady: health.gatewayReady,
    mode: health.mode,
    version: sanitizeDiagnosticText(health.version),
    install: {
      installed: health.install.installed,
      missing: health.install.missing,
      backendNeedsRepair: health.install.backendNeedsRepair,
      bundledBackendAvailable: health.install.bundledBackendAvailable,
      configExists: health.install.configExists,
      envExists: health.install.envExists,
      apiKeyConfigured: health.install.apiKeyConfigured,
      homePresent: Boolean(health.install.home),
      repoPathPresent: Boolean(health.install.repoPath),
      pythonPathPresent: Boolean(health.install.pythonPath),
      scriptPathPresent: Boolean(health.install.scriptPath),
      prerequisites: {
        pythonOnPath: health.install.prerequisites.pythonOnPath,
        pythonVersion: sanitizeDiagnosticText(health.install.prerequisites.pythonVersion),
        gitOnPath: health.install.prerequisites.gitOnPath,
        gitVersion: sanitizeDiagnosticText(health.install.prerequisites.gitVersion),
        apiKeyConfigured: health.install.prerequisites.apiKeyConfigured,
        problems: health.install.prerequisites.problems.map(sanitizeDiagnosticText),
      },
    },
    gateway: {
      ready: health.gateway.ready,
      managed: health.gateway.managed,
      externalReady: health.gateway.externalReady,
      externalConflict: health.gateway.externalConflict,
      pidPresent: Boolean(health.gateway.pid),
      baseUrl: sanitizeDiagnosticText(health.gateway.baseUrl),
      lastLog: sanitizeDiagnosticText(health.gateway.lastLog).slice(-1200),
    },
    update: {
      phase: health.update.phase,
      errorCode: sanitizeDiagnosticText(health.update.errorCode),
      error: sanitizeDiagnosticText(health.update.error),
    },
  };
}

export function sanitizeDiagnosticText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/([?&][^=&#]*(?:token|secret|password|passwd|pwd|api[_-]?key|private[_-]?key|credential|auth|session|cookie|signature)[^=&#]*=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/\b(Bearer|Token)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:sk|ak|pk|rk|org|sess|token|key)-[A-Za-z0-9_-]{12,}\b/g, "[redacted-secret]")
    .replace(/\b(token|secret|password|passwd|pwd|api[_-]?key|private[_-]?key|credential|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/C:\\Users\\[^\\\s]+/gi, "C:\\Users\\[user]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[user]");
}
