import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { ChevronDown, RefreshCw } from "lucide-react";
import type {
  DesktopWeChatChannelStatus,
  DesktopWeChatLoginStartResult,
} from "@shared/desktopApi";
import type { AppLanguage } from "../navigation";
import { desktopApi } from "../desktopApi";

export function WeChatLogo(): React.JSX.Element {
  return <svg className="wechat-logo" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15.85 8.14c.39 0 .77.03 1.14.08C16.31 5.25 13.19 3 9.44 3c-4.25 0-7.7 2.88-7.7 6.43 0 2.05 1.15 3.86 2.94 5.04L3.67 16.5l2.76-1.19c.59.21 1.21.38 1.87.47-.09-.39-.14-.79-.14-1.21-.01-3.54 3.44-6.43 7.69-6.43M12 5.89a.96.96 0 1 1 0 1.92.96.96 0 0 1 0-1.92M6.87 7.82a.96.96 0 1 1 0-1.92.96.96 0 0 1 0 1.92" />
    <path d="M22.26 14.57c0-2.84-2.87-5.14-6.41-5.14s-6.41 2.3-6.41 5.14 2.87 5.14 6.41 5.14c.58 0 1.14-.08 1.67-.2L20.98 21l-1.2-2.4c1.5-.94 2.48-2.38 2.48-4.03m-8.34-.32a.96.96 0 1 1 .96-.96c.01.53-.43.96-.96.96m3.85 0a.96.96 0 1 1 0-1.92.96.96 0 0 1 0 1.92" />
  </svg>;
}

export function WeChatChannelCard({ language, initialStatus, onStatusChange }: { language: AppLanguage; initialStatus?: DesktopWeChatChannelStatus | null; onStatusChange?: (status: DesktopWeChatChannelStatus) => void }): React.JSX.Element {
  const zh = language === "zh";
  const [status, setStatus] = useState<DesktopWeChatChannelStatus | null>(initialStatus ?? null);
  const [login, setLogin] = useState<DesktopWeChatLoginStartResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [loginState, setLoginState] = useState<"waiting" | "scanned" | "expired" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionCount, setSessionCount] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const polling = useRef(false);

  async function refresh(): Promise<void> {
    try {
      const [next, sessions] = await Promise.all([
        desktopApi.getWeChatChannelStatus(),
        desktopApi.getWeChatSessionSummary().catch(() => ({ count: 0 })),
      ]);
      setStatus(next); setSessionCount(sessions.count); onStatusChange?.(next);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load WeChat status."); }
  }

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (!login) { setQrDataUrl(""); return; }
    let active = true;
    void QRCode.toDataURL(login.qrContent, { width: 240, margin: 2, errorCorrectionLevel: "M" })
      .then((value) => { if (active) setQrDataUrl(value); })
      .catch(() => { if (active) setError(zh ? "二维码生成失败。" : "Unable to render the QR code."); });
    return () => { active = false; };
  }, [login, zh]);

  useEffect(() => {
    if (!login) { setRemainingSeconds(0); return; }
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil((Date.parse(login.expiresAt) - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [login]);

  useEffect(() => {
    if (!login || loginState === "expired") return;
    let disposed = false;
    const interval = window.setInterval(() => {
      if (disposed || polling.current) return;
      polling.current = true;
      void desktopApi.pollWeChatLogin({ operationId: login.operationId }).then(async (result) => {
        if (disposed) return;
        setError("");
        if (result.status === "confirmed") {
          window.clearInterval(interval);
          setLogin(null); setLoginState(null); setQrDataUrl("");
          try {
            await desktopApi.startWeChatChannel();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : (zh ? "微信已连接，但自动开始接收失败。" : "WeChat connected, but receiving could not start automatically."));
          }
          await refresh();
        } else if (result.status === "expired" || result.status === "cancelled") {
          window.clearInterval(interval); setLoginState("expired");
        } else setLoginState(result.status);
      }).catch((cause) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : "Unable to check WeChat login.");
      }).finally(() => { polling.current = false; });
    }, Math.max(1, login.pollIntervalSeconds) * 1000);
    return () => { disposed = true; window.clearInterval(interval); polling.current = false; };
  }, [login, loginState]);

  async function beginLogin(): Promise<void> {
    setExpanded(true);
    setBusy(true); setError(""); setLoginState("waiting");
    try { setLogin(await desktopApi.startWeChatLogin()); }
    catch (cause) { setLoginState(null); setError(cause instanceof Error ? cause.message : "Unable to start WeChat login."); }
    finally { setBusy(false); }
  }

  async function cancelLogin(): Promise<void> {
    if (login) await desktopApi.cancelWeChatLogin({ operationId: login.operationId }).catch(() => undefined);
    setLogin(null); setLoginState(null); setQrDataUrl("");
  }

  async function mutate(action: "start" | "stop" | "logout"): Promise<void> {
    if (action === "logout" && !window.confirm(zh ? "退出微信并停止频道？历史会话将保留。" : "Sign out of WeChat and stop the channel? Conversation history will be kept.")) return;
    setBusy(true); setError("");
    try {
      const next = action === "start" ? await desktopApi.startWeChatChannel() : action === "stop" ? await desktopApi.stopWeChatChannel() : await desktopApi.logoutWeChatChannel();
      setStatus(next); onStatusChange?.(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update WeChat."); }
    finally { setBusy(false); }
  }

  const running = status?.runtimeState === "running";
  const expired = status?.credentialState === "expired" || status?.credentialState === "unavailable";
  const operationalReady = running && !expired;
  const statusLabel = operationalReady
    ? (zh ? "可用" : "Available")
    : expired
      ? (zh ? "登录已失效" : "Login expired")
      : status?.configured
        ? (zh ? "已暂停" : "Paused")
        : (zh ? "待配置" : "Setup required");
  return (
    <article className="perceptor-resource-card settings-resource-card wechat-channel-card" data-enabled={running} data-expanded={expanded} aria-label={zh ? "微信频道" : "WeChat channel"}>
      <header className="perceptor-resource-row settings-resource-row">
        <button
          type="button"
          className="perceptor-resource-main settings-resource-main collapsible-channel-header"
          aria-expanded={expanded}
          aria-label={expanded ? (zh ? "收起微信频道" : "Collapse WeChat channel") : (zh ? "展开微信频道" : "Expand WeChat channel")}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="perceptor-kind-icon wechat-channel-icon"><WeChatLogo /></span>
          <span className="perceptor-resource-name"><strong>{zh ? "微信" : "WeChat"}</strong><small>{zh ? "双向聊天频道 · 本机 Runtime" : "Bidirectional chat · Local Runtime"}</small></span>
          <span className={`perceptor-inline-status ${operationalReady ? "ok" : "warning"}`}>{statusLabel}</span>
          <ChevronDown className="perceptor-expand-icon" size={16} />
        </button>
        <button
          type="button"
          className={`perceptor-enable-switch settings-resource-switch${running ? " is-enabled" : ""}`}
          role="switch"
          aria-checked={running}
          aria-label={running ? (zh ? "暂停接收" : "Pause receiving") : (zh ? "开始接收" : "Start receiving")}
          title={running ? (zh ? "暂停接收" : "Pause receiving") : (zh ? "开始接收" : "Start receiving")}
          disabled={busy || !status?.configured || expired}
          onClick={() => void mutate(running ? "stop" : "start")}
        >
          <span className="perceptor-switch-track" aria-hidden="true"><i /></span>
          <em>{running ? (zh ? "已启用" : "Enabled") : (zh ? "未启用" : "Disabled")}</em>
        </button>
      </header>
      {expanded && <div className="perceptor-resource-details settings-resource-details channel-resource-details">
      <p>{zh ? "通过受信任的本机 Runtime 接收微信文字和图片，并为每个微信用户维护独立智能体会话。" : "Receive WeChat text and images through the trusted local Runtime with an isolated Agent conversation for each user."}</p>
      <div className="perceptor-capabilities"><code>chat.receive</code><code>chat.send</code><code>image.receive</code></div>
      <div className="perceptor-state-row">
        <span className={status?.configured && !expired ? "ok" : "warning"}>{status?.configured && !expired ? (zh ? "凭据有效" : "Credential valid") : expired ? (zh ? "登录已失效" : "Login expired") : (zh ? "需要扫码连接" : "QR sign-in required")}</span>
        {status?.accountLabel && <span>{zh ? "账号" : "Account"}: {status.accountLabel}</span>}
        {status?.configured && <span>{zh ? "活动会话" : "Active conversations"}: {sessionCount}</span>}
        {status?.expiresAt && <small title={new Date(status.expiresAt).toLocaleString()}>{zh ? "凭据有时效" : "Time-limited credential"}</small>}
      </div>
      {login && <div className="wechat-login-panel" role="status" aria-live="polite">
        {qrDataUrl && <img src={qrDataUrl} alt={zh ? "微信登录二维码" : "WeChat login QR code"} />}
        <b>{loginState === "scanned" ? (zh ? "已扫码，请在手机确认" : "Scanned — confirm on your phone") : loginState === "expired" ? (zh ? "二维码已过期" : "QR code expired") : (zh ? "请使用微信扫码" : "Scan with WeChat")}</b>
        {loginState !== "expired" && <small>{zh ? `二维码将在 ${remainingSeconds} 秒后过期` : `QR expires in ${remainingSeconds} seconds`}</small>}
        <small>{zh ? "二维码只保存在当前窗口内存中。" : "The QR content remains only in this window's memory."}</small>
        <div className="channel-card-actions">
          {loginState === "expired" && <button type="button" onClick={() => void beginLogin()}><RefreshCw size={14} />{zh ? "刷新二维码" : "Refresh QR"}</button>}
          <button type="button" onClick={() => void cancelLogin()}>{zh ? "取消" : "Cancel"}</button>
        </div>
      </div>}
      {error && <div className="channels-error" role="alert">{error}</div>}
      {!login && <footer className="channel-card-actions">
        {(!status?.configured || expired) && <button type="button" disabled={busy} onClick={() => void beginLogin()}>{busy ? (zh ? "连接中" : "Connecting") : expired ? (zh ? "重新连接" : "Reconnect") : (zh ? "连接微信" : "Connect WeChat")}</button>}
        {status?.configured && <button type="button" disabled={busy} onClick={() => void mutate("logout")}>{zh ? "退出登录" : "Sign out"}</button>}
      </footer>}
      </div>}
    </article>
  );
}
