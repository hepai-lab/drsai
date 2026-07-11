import { FormEvent, useEffect, useMemo, useState } from "react";
import type { OidcLoginDebugEvent } from "@shared/desktopApi";
import drsaiLogo from "../assets/drsai-transparent.png";
import type { AppLanguage } from "../navigation";
import { useAuth } from "./AuthProvider";

type LoginMode = "oidc" | "api_key" | "password";

const DEFAULT_MODEL_OPTIONS = [
  { value: "hepai/deepseek-v4-pro", label: "HEPAI DeepSeek V4 Pro" },
  { value: "hepai/deepseek-v4-flash", label: "HEPAI DeepSeek V4 Flash" },
  { value: "glm-5.2", label: "GLM-5.2" },
  { value: "glm-5.1", label: "GLM-5.1" },
  { value: "hepai/minimax-m2.7-highspeed", label: "HEPAI MiniMax M2.7" },
];

export function LoginScreen(): React.JSX.Element {
  const auth = useAuth();
  const [language, setLanguage] = useState<AppLanguage>("zh");
  const [mode, setMode] = useState<LoginMode>("oidc");
  const [debugOpen, setDebugOpen] = useState(false);
  const [loginEvents, setLoginEvents] = useState<OidcLoginDebugEvent[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState(DEFAULT_MODEL_OPTIONS[0].value);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const zh = language === "zh";
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
    if (mode === "oidc") {
      setLoginEvents([
        {
          stage: "started",
          status: "info",
          message: "Clicked HepAI sign-in button.",
          at: new Date().toISOString(),
        },
      ]);
      await auth.startOidcLogin({ rememberMe });
    } else if (mode === "api_key") {
      await auth.login({ apiKey, defaultModel, rememberMe });
    } else {
      await auth.login({ email, password, rememberMe });
    }
  }

  const canSubmit =
    mode === "oidc"
      ? true
      : mode === "api_key"
        ? Boolean(apiKey.trim())
        : Boolean(email.trim() && password);

  function getSubmitLabel(): string {
    if (auth.loginBusy) {
      if (mode === "oidc") return zh ? "正在等待浏览器登录..." : "Waiting for browser sign-in...";
      return zh ? "正在继续..." : "Continuing...";
    }
    if (mode === "oidc") return zh ? "使用 HepAI 继续" : "Continue with HepAI";
    if (mode === "api_key") return zh ? "使用 API key 登录" : "Continue with API key";
    return zh ? "继续" : "Continue";
  }

  function getModeLinkLabel(): string {
    if (mode === "oidc") return zh ? "改用 API key" : "Use API key instead";
    if (mode === "api_key") return zh ? "使用账号登录" : "Continue with account";
    return zh ? "使用 HepAI 继续" : "Continue with HepAI";
  }

  function nextMode(): LoginMode {
    if (mode === "oidc") return "api_key";
    if (mode === "api_key") return "password";
    return "oidc";
  }

  function switchMode(next: LoginMode): void {
    auth.clearMessage();
    setMode(next);
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
          {mode === "oidc" ? null : mode === "api_key" ? (
            <>
              <label className="login-field">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={zh ? "输入你的 API key" : "Enter your API key"}
                  autoComplete="off"
                />
              </label>
              <label className="login-field">
                <select
                  value={defaultModel}
                  onChange={(event) => setDefaultModel(event.target.value)}
                  aria-label={zh ? "默认模型" : "Default model"}
                >
                  {DEFAULT_MODEL_OPTIONS.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="login-field">
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={zh ? "输入你的邮箱" : "Enter your email"}
                  autoComplete="email"
                />
              </label>
              <label className="login-field">
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={zh ? "输入你的密码" : "Enter your password"}
                  autoComplete="current-password"
                />
              </label>
            </>
          )}

          <button className="login-submit" type="submit" disabled={auth.loginBusy || !canSubmit}>
            {getSubmitLabel()}
          </button>

          {mode === "oidc" && auth.loginBusy && (
            <button className="login-mode-link" type="button" onClick={() => auth.cancelOidcLogin()}>
              {zh ? "取消登录" : "Cancel sign-in"}
            </button>
          )}

          <div className="login-divider">
            <span>{zh ? "或" : "OR"}</span>
          </div>

          <button className="login-mode-link" type="button" onClick={() => switchMode(nextMode())}>
            {getModeLinkLabel()}
          </button>

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

      {debugOpen && (
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
