import { FormEvent, useState } from "react";
import drsaiLogo from "../assets/drsai-transparent.png";
import type { AppLanguage } from "../navigation";
import { useAuth } from "./AuthProvider";

type LoginMode = "oidc" | "api_key" | "password";

export function LoginScreen(): React.JSX.Element {
  const auth = useAuth();
  const [language, setLanguage] = useState<AppLanguage>("zh");
  const [mode, setMode] = useState<LoginMode>("oidc");
  const [apiKey, setApiKey] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const zh = language === "zh";

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (mode === "oidc") {
      await auth.startOidcLogin({ rememberMe });
    } else if (mode === "api_key") {
      await auth.login({ apiKey, rememberMe });
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
    if (mode === "oidc") return zh ? "使用 IHEP SSO 登录" : "Continue with IHEP SSO";
    if (mode === "api_key") return zh ? "使用 API key 登录" : "Continue with API key";
    return zh ? "继续" : "Continue";
  }

  function getModeLinkLabel(): string {
    if (mode === "oidc") return zh ? "改用 API key" : "Use API key instead";
    if (mode === "api_key") return zh ? "使用账号登录" : "Continue with account";
    return zh ? "使用 IHEP SSO 登录" : "Continue with IHEP SSO";
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
    <main className="login-screen">
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
          <h1>
            {zh
              ? "面向大科学装置科学发现的 AI"
              : "AI for Scientific Discovery at Large-Scale Research Facilities"}
          </h1>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {mode === "oidc" ? null : mode === "api_key" ? (
            <label className="login-field">
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={zh ? "输入你的 API key" : "Enter your API key"}
                autoComplete="off"
              />
            </label>
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
    </main>
  );
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
