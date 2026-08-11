import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, RefreshCw, Smartphone, X } from "lucide-react";
import type {
  DesktopMobilePairingGrant,
  DesktopMobilePairingReadiness,
  WorkspaceProject,
} from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";
import { copyTextSafely } from "../clipboard";

type Language = "zh" | "en";

export function mobilePairingErrorText(reason: unknown, language: Language): string {
  const zh = language === "zh";
  const raw = (reason instanceof Error ? reason.message : String(reason))
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .trim();
  if (raw.includes("mobile_pairing_runtime_external_update_required")) {
    return zh
      ? "当前 Runtime 由外部开发进程管理，无法自动更新。请重启开发 Runtime 后重试。"
      : "The Runtime is managed by an external development process. Restart that Runtime and try again.";
  }
  if (raw.includes("mobile_pairing_runtime_repair_failed") || /(?:remoteprotocolerror:\s*)?not found\.?$/i.test(raw)) {
    return zh
      ? "OpenDrSai 已尝试自动更新本地 Runtime，但未能完成。请在设置中修复本地运行环境后重试。"
      : "OpenDrSai tried to update the local Runtime automatically but could not finish. Repair the local Runtime in Settings and try again.";
  }
  if (raw.includes("mobile_pairing_oidc_login_required")) {
    return zh ? "请先使用 HepAI 登录，再连接 Android。" : "Sign in with HepAI before connecting Android.";
  }
  if (raw.includes("mobile_pairing_registration_code_failed")
    || raw.includes("mobile_pairing_registration_code_invalid")
    || raw.includes("mobile_pairing_runtime_registration_failed")
    || raw.includes("runtime_registration_failed")) {
    return zh
      ? "无法向 HepAI 注册此电脑，请检查网络后重试。"
      : "This computer could not be registered with HepAI. Check the network and try again.";
  }
  if (raw.includes("mobile_pairing_runtime_restart_failed")) {
    return zh ? "注册已完成，但本地 Runtime 重启失败。请重启 OpenDrSai 后重试。" : "Registration completed, but the local Runtime could not restart. Restart OpenDrSai and try again.";
  }
  return raw || (zh ? "无法创建二维码，请重试。" : "Could not create the QR code. Try again.");
}

export function MobilePairingDialog({
  language,
  onClose,
  onConnected,
}: {
  language: Language;
  onClose: () => void;
  onConnected?: () => void;
}): React.JSX.Element {
  const zh = language === "zh";
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const activeGrantRef = useRef<DesktopMobilePairingGrant | null>(null);
  const mountedRef = useRef(true);
  const connectedNotifiedRef = useRef(false);
  const scopeChangeInitializedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const onConnectedRef = useRef(onConnected);
  const [readiness, setReadiness] = useState<DesktopMobilePairingReadiness | null>(null);
  const [grant, setGrant] = useState<DesktopMobilePairingGrant | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceProject[]>([]);
  const [scopeMode, setScopeMode] = useState<"all" | "selected">("all");
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<Set<string>>(new Set());
  const scopeRef = useRef({ workspace_scope: "all" as "all" | "selected", workspace_ids: [] as string[] });
  scopeRef.current = {
    workspace_scope: scopeMode,
    workspace_ids: scopeMode === "all" ? [] : [...selectedWorkspaceIds].sort(),
  };
  const selectedWorkspaceKey = [...selectedWorkspaceIds].sort().join("\0");

  onCloseRef.current = onClose;
  onConnectedRef.current = onConnected;

  const revokeActive = useCallback(async (): Promise<void> => {
    const active = activeGrantRef.current;
    activeGrantRef.current = null;
    if (active?.status !== "pending") return;
    try {
      await desktopApi.revokeMobilePairingGrant(active.grant_id);
    } catch {
      // The short Relay TTL remains the safety boundary while offline.
    }
  }, []);

  const createGrant = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setCopied(false);
    setQrDataUrl(null);
    try {
      const currentReadiness = await desktopApi.getMobilePairingReadiness();
      if (!mountedRef.current) return;
      setReadiness(currentReadiness);
      if (currentReadiness.state !== "ready") {
        setGrant(null);
        return;
      }
      const selection = scopeRef.current;
      if (selection.workspace_scope === "selected" && selection.workspace_ids.length === 0) {
        setGrant(null);
        return;
      }
      const created = await desktopApi.createMobilePairingGrant(selection);
      if (!mountedRef.current) return;
      activeGrantRef.current = created;
      setGrant(created);
      if (!created.payload) throw new Error(zh ? "运行时没有返回二维码内容。" : "The Runtime did not return a QR payload.");
      const dataUrl = await QRCode.toDataURL(created.payload, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 240,
        color: { dark: "#111111ff", light: "#ffffffff" },
      });
      if (mountedRef.current) setQrDataUrl(dataUrl);
    } catch (reason) {
      if (mountedRef.current) setError(mobilePairingErrorText(reason, language));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [language, zh]);

  useEffect(() => {
    void desktopApi.listWorkspaces()
      .then((items) => {
        if (mountedRef.current) setWorkspaces(items);
      })
      .catch(() => {
        if (mountedRef.current) setWorkspaces([]);
      });
  }, []);

  useEffect(() => {
    if (!scopeChangeInitializedRef.current) {
      scopeChangeInitializedRef.current = true;
      return;
    }
    void refresh();
  }, [scopeMode, selectedWorkspaceKey]);

  useEffect(() => {
    mountedRef.current = true;
    closeButtonRef.current?.focus();
    void createGrant();
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("keydown", keydown);
      void revokeActive();
    };
  }, [createGrant, revokeActive]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!grant || grant.status !== "pending") return;
    let reading = false;
    const poll = window.setInterval(() => {
      if (document.visibilityState !== "visible" || reading) return;
      reading = true;
      void desktopApi.getMobilePairingGrant(grant.grant_id)
        .then((next) => {
          if (!mountedRef.current) return;
          activeGrantRef.current = next.status === "pending" ? next : null;
          setGrant(next);
          if (next.status !== "pending") setQrDataUrl(null);
          if (next.status === "consumed" && !connectedNotifiedRef.current) {
            connectedNotifiedRef.current = true;
            onConnectedRef.current?.();
          }
        })
        .catch((reason) => {
          if (mountedRef.current) setError(mobilePairingErrorText(reason, language));
        })
        .finally(() => { reading = false; });
    }, 2_000);
    return () => window.clearInterval(poll);
  }, [grant?.grant_id, grant?.status, language]);

  const secondsLeft = grant ? Math.max(0, Math.ceil((Date.parse(grant.expires_at) - now) / 1_000)) : 0;
  const expired = grant?.status === "expired" || (grant?.status === "pending" && secondsLeft === 0);

  useEffect(() => {
    if (!expired || grant?.status !== "pending") return;
    activeGrantRef.current = null;
    setQrDataUrl(null);
    setGrant({ ...grant, status: "expired" });
  }, [expired, grant]);
  const code = useMemo(() => {
    if (!grant?.payload) return "";
    try { return new URL(grant.payload).searchParams.get("code") ?? ""; } catch { return ""; }
  }, [grant?.payload]);

  async function refresh(): Promise<void> {
    await revokeActive();
    setGrant(null);
    await createGrant();
  }

  const readinessText: Record<string, string> = zh ? {
    not_registered: "此电脑尚未注册到 HepAI，请先完成 Runtime 注册。",
    credential_invalid: "此电脑的 Relay 凭据不可用，请重新注册 Runtime。",
    offline: "暂时无法连接 HepAI，请检查网络后重试。",
  } : {
    not_registered: "This computer is not registered with HepAI. Register its Runtime first.",
    credential_invalid: "The Relay credential is invalid. Register this Runtime again.",
    offline: "HepAI is currently unreachable. Check the network and retry.",
  };

  return (
    <div className="mobile-pairing-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="mobile-pairing-dialog" role="dialog" aria-modal="true" aria-labelledby="mobile-pairing-title" data-testid="mobile-pairing-dialog">
        <header>
          <span className="mobile-pairing-heading-icon" aria-hidden="true"><Smartphone size={20} /></span>
          <div><h2 id="mobile-pairing-title">{zh ? "连接 Android" : "Connect Android"}</h2><p>{zh ? "使用 OpenDrSai Android 扫描一次性二维码。" : "Scan this one-time QR code with OpenDrSai for Android."}</p></div>
          <button ref={closeButtonRef} type="button" className="mobile-pairing-icon-button" aria-label={zh ? "关闭" : "Close"} onClick={onClose}><X size={18} /></button>
        </header>

        <div className="mobile-pairing-device"><span>{zh ? "计算机" : "Computer"}</span><strong>OpenDrSai Desktop</strong><span>{zh ? "环境" : "Environment"}</span><strong>{readiness?.environment ?? "—"}</strong></div>

        <fieldset className="mobile-pairing-scope" disabled={busy}>
          <legend>{zh ? "允许访问的工作区" : "Allowed workspaces"}</legend>
          <label>
            <input type="radio" name="mobile-pairing-scope" checked={scopeMode === "all"}
              onChange={() => setScopeMode("all")} />
            <span>{zh ? "全部工作区" : "All workspaces"}</span>
          </label>
          <label>
            <input type="radio" name="mobile-pairing-scope" checked={scopeMode === "selected"}
              onChange={() => setScopeMode("selected")} />
            <span>{zh ? "仅指定工作区" : "Selected workspaces only"}</span>
          </label>
          {scopeMode === "selected" ? <div className="mobile-pairing-workspaces">
            {workspaces.length === 0 ? <small>{zh ? "当前没有可授权的工作区。" : "There are no workspaces available to authorize."}</small> :
              workspaces.map((workspace) => <label key={workspace.id}>
                <input type="checkbox" checked={selectedWorkspaceIds.has(workspace.id)} onChange={(event) => {
                  setSelectedWorkspaceIds((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(workspace.id); else next.delete(workspace.id);
                    return next;
                  });
                }} />
                <span>{workspace.name}</span>
              </label>)}
          </div> : null}
          <small>{zh ? "授权范围会写入一次性配对授权，Android 无法自行扩大。" : "The one-time grant binds this scope; Android cannot expand it."}</small>
        </fieldset>

        {busy ? <div className="mobile-pairing-state" role="status"><RefreshCw className="spin" size={28} />{zh ? "正在创建安全连接…" : "Creating a secure connection…"}</div> : null}
        {!busy && readiness && readiness.state !== "ready" ? <div className="mobile-pairing-state mobile-pairing-warning" role="alert"><p>{readinessText[readiness.state] ?? readiness.action}</p><button type="button" onClick={() => void createGrant()}>{zh ? "重试" : "Retry"}</button></div> : null}
        {!busy && error ? <div className="mobile-pairing-state mobile-pairing-warning" role="alert"><p>{error}</p><button type="button" onClick={() => void createGrant()}>{zh ? "重试" : "Retry"}</button></div> : null}
        {!busy && readiness?.state === "ready" && scopeMode === "selected" && selectedWorkspaceIds.size === 0 ? <div className="mobile-pairing-state" role="status"><p>{zh ? "请选择至少一个工作区后生成二维码。" : "Select at least one workspace to create the QR code."}</p></div> : null}
        {!busy && grant?.status === "consumed" ? <div className="mobile-pairing-state mobile-pairing-success" role="status"><Check size={42} /><h3>{zh ? "已连接" : "Connected"}</h3><p>{zh ? "Android 设备现在可以访问此 Runtime。" : "The Android device can now access this Runtime."}</p></div> : null}
        {!busy && (expired || grant?.status === "revoked") ? <div className="mobile-pairing-state" role="status"><h3>{expired ? (zh ? "二维码已过期" : "QR code expired") : (zh ? "连接已取消" : "Pairing cancelled")}</h3><button type="button" onClick={() => void refresh()}>{zh ? "刷新二维码" : "Refresh QR code"}</button></div> : null}
        {!busy && grant?.status === "pending" && !expired ? <>
          <div className="mobile-pairing-qr" aria-label={zh ? "Android 配对二维码" : "Android pairing QR code"}>{qrDataUrl ? <img src={qrDataUrl} alt={zh ? "用于连接此电脑的一次性二维码" : "One-time QR code for connecting this computer"} /> : null}</div>
          <div className="mobile-pairing-countdown" role="status"><span>{zh ? "剩余时间" : "Time remaining"}</span><strong>{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</strong><progress max={120} value={Math.min(120, secondsLeft)} aria-label={zh ? "二维码剩余有效时间" : "QR validity remaining"} /></div>
          <div className="mobile-pairing-manual"><span><small>{zh ? "手工配对码" : "Manual pairing code"}</small><code>{code}</code></span><button type="button" aria-label={zh ? "复制手工配对码" : "Copy manual pairing code"} onClick={() => void copyTextSafely(code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1_500); })}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? (zh ? "已复制" : "Copied") : (zh ? "复制" : "Copy")}</button></div>
        </> : null}

        <p className="mobile-pairing-privacy">{zh ? "二维码仅包含短时、单次使用的授权码，不包含密码、工作区路径或 Runtime 凭据。" : "The QR contains only a short-lived, single-use grant. It contains no password, workspace path, or Runtime credential."}</p>
        <footer>
          <button type="button" onClick={() => void refresh()} disabled={busy || readiness?.state !== "ready"}>{zh ? "刷新二维码" : "Refresh QR code"}</button>
          <button type="button" className="primary" onClick={onClose}>{grant?.status === "consumed" ? (zh ? "完成" : "Done") : (zh ? "取消" : "Cancel")}</button>
        </footer>
      </section>
    </div>
  );
}
