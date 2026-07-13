import { FormEvent, useEffect, useMemo, useState } from "react";
import type { OidcLoginDebugEvent } from "@shared/desktopApi";
import drsaiLogo from "../assets/drsai-transparent.png";
import type { AppLanguage } from "../navigation";
import { useAuth } from "./AuthProvider";

export function LoginScreen(): React.JSX.Element {
  const auth = useAuth();
  const [language, setLanguage] = useState<AppLanguage>("zh");
  const [debugOpen, setDebugOpen] = useState(false);
  const [loginEvents, setLoginEvents] = useState<OidcLoginDebugEvent[]>([]);
  const [rememberMe, setRememberMe] = useState(true);
  const zh = language === "zh";
  const latestLoginEvent = loginEvents[loginEvents.length - 1] ?? null;
  const loginDebugTitle = zh ? "登录调试" : "Login Debug";
  const currentStepLabel = useMemo(() => {
    if (!latestLoginEvent) return zh ? "尚未开始" : "Not started";
    return getDebugStageLabel(latestLoginEvent.stage, zh);
  }, [latestLoginEvent, zh]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
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
    setLoginEvents([{ stage: "started", status: "info", message: "Clicked HepAI sign-in button.", at: new Date().toISOString() }]);
    await auth.startOidcLogin({ rememberMe });
  }

  function getSubmitLabel(): string {
    if (auth.loginBusy) return zh ? "正在等待浏览器登录..." : "Waiting for browser sign-in...";
    return zh ? "使用 HepAI 登录" : "Sign in with HepAI";
  }

  return (
    <main className={`login-screen ${debugOpen ? "debug-open" : ""}`}>
      <div className="login-window-drag-region" aria-hidden />
      <section className="login-panel login-minimal" aria-label={zh ? "OpenDrSai 登录" : "OpenDrSai sign in"}>
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
              <>
                <strong>科学发现的 AI</strong>
              </>
            ) : (
              <>
                <strong>The AI for Discovery</strong>
                <span>at Large Scientific Facilities</span>
              </>
            )}
          </h1>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <button className="login-submit" type="submit" disabled={auth.loginBusy}>
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

        {auth.message && <div className="login-message">{auth.message}</div>}

        <div className="login-footnote">
          {zh
            ? "继续即表示你同意 OpenDrSai 服务条款和隐私政策。"
            : "By continuing, you agree to OpenDrSai terms and privacy policy."}
        </div>
      </section>

      {import.meta.env.DEV && debugOpen && (
        <aside className="login-debug-panel" aria-label={loginDebugTitle}>
          <div className="login-debug-header">
            <div>
              <strong>{loginDebugTitle}</strong>
              <span>{zh ? "当前步骤" : "Current step"}: {currentStepLabel}</span>
            </div>
            <button type="button" onClick={() => setDebugOpen(false)} aria-label={zh ? "关闭登录调试" : "Close login debug"}>
              ×
            </button>
          </div>
          <div className={`login-debug-status ${latestLoginEvent?.status ?? "info"}`}>
            {latestLoginEvent?.message ?? (zh ? "按 F12 打开/关闭。点击登录后这里会显示流程进度。" : "Press F12 to toggle. Login progress appears here after clicking sign in.")}
          </div>
          <ol className="login-debug-list">
            {loginEvents.length === 0 ? (
              <li className="login-debug-empty">
                {zh ? "暂无日志。点击“使用 HepAI 继续”开始。" : "No logs yet. Click “Continue with HepAI” to start."}
              </li>
            ) : (
              loginEvents.map((event, index) => (
                <li key={`${event.at}-${index}`} className={`login-debug-item ${event.status}`}>
                  <time>{formatDebugTime(event.at)}</time>
                  <div>
                    <strong>{getDebugStageLabel(event.stage, zh)}</strong>
                    <p>{event.message}</p>
                    {event.url && <code>{event.url}</code>}
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

export function AuthSplash(): React.JSX.Element {
  return (
    <main className="login-screen">
      <section className="login-panel login-minimal compact">
        <div className="login-brand">
          <span className="login-brand-logo" aria-hidden>
            <img src={drsaiLogo} alt="" />
          </span>
          <strong>
            Open<span className="brand-accent">Dr</span>Sai
          </strong>
        </div>
        <div className="login-footnote">正在恢复会话...</div>
      </section>
    </main>
  );
}

export function ServiceUnavailableScreen(): React.JSX.Element {
  const auth = useAuth();
  return (
    <main className="login-screen">
      <section className="login-panel login-minimal compact" aria-label="OpenDrSai 服务准备">
        <div className="login-brand">
          <span className="login-brand-logo" aria-hidden><img src={drsaiLogo} alt="" /></span>
          <strong>Open<span className="brand-accent">Dr</span>Sai</strong>
        </div>
        <div className="login-heading">
          <h1><strong>{auth.serviceBusy ? "正在准备服务" : "服务尚未就绪"}</strong></h1>
        </div>
        <p className="login-footnote">
          {auth.message || "本地服务无法启动，或当前账号没有可用的 DrSai 服务。"}
        </p>
        <button className="login-submit" type="button" disabled={auth.serviceBusy} onClick={() => void auth.retryBootstrap()}>
          {auth.serviceBusy ? "正在重试..." : "重试"}
        </button>
        <button className="login-mode-link" type="button" disabled={auth.logoutBusy} onClick={() => void auth.logout()}>
          重新登录
        </button>
      </section>
    </main>
  );
}
