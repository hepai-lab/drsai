import { AlertTriangle, Info, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { desktopApi, hasDesktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";

export interface AppDecisionRequest {
  id: string;
  title: string;
  description: string;
  impact?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "normal" | "danger";
  kind?: "confirmation" | "notice";
}

interface PendingDecision extends AppDecisionRequest {
  resolve: (approved: boolean) => void;
  trigger: HTMLElement | null;
}

let activeHost: ((request: PendingDecision) => void) | null = null;
const waiting: PendingDecision[] = [];

export function requestAppDecision(request: AppDecisionRequest): Promise<boolean> {
  return new Promise((resolve) => {
    const pending = {
      ...request,
      resolve,
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    if (activeHost) activeHost(pending);
    else waiting.push(pending);
  });
}

export async function showAppNotice(request: Omit<AppDecisionRequest, "kind">): Promise<void> {
  await requestAppDecision({ ...request, kind: "notice" });
}

export function AppDecisionDialogHost({ language }: { language: AppLanguage }): React.JSX.Element | null {
  const zh = language === "zh";
  const [current, setCurrent] = useState<PendingDecision | null>(null);
  const currentRef = useRef<PendingDecision | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const safeButtonRef = useRef<HTMLButtonElement | null>(null);
  const pumpRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const pump = (): void => {
      if (currentRef.current) return;
      const next = waiting.shift();
      if (!next) return;
      currentRef.current = next;
      setCurrent(next);
    };
    const accept = (request: PendingDecision): void => {
      waiting.push(request);
      pump();
    };
    pumpRef.current = pump;
    activeHost = accept;
    pump();
    return () => {
      if (activeHost === accept) activeHost = null;
      pumpRef.current = () => undefined;
    };
  }, []);

  useEffect(() => {
    currentRef.current = current;
    if (current) {
      window.dispatchEvent(new CustomEvent("drsai:app-dialog-shown", { detail: { id: current.id } }));
      window.setTimeout(() => safeButtonRef.current?.focus(), 0);
    }
  }, [current]);

  function finish(approved: boolean, reason: "confirm" | "cancel" | "escape" | "backdrop"): void {
    const request = currentRef.current;
    if (!request) return;
    currentRef.current = null;
    setCurrent(null);
    request.resolve(approved);
    window.dispatchEvent(new CustomEvent("drsai:app-dialog-decision", {
      detail: { id: request.id, approved, reason },
    }));
    if (hasDesktopApi()) void desktopApi.recordDiagnostic({
      module: "renderer",
      component: "app-decision-dialog",
      operation: "dialog.decision",
      message: approved ? "User confirmed an in-app decision." : "User cancelled an in-app decision.",
      domain: "app",
      level: "info",
      kind: "operation",
      status: approved ? "completed" : "cancelled",
      visibility: "detail",
      attributes: { dialogId: request.id, approved, reason },
    }).catch(() => undefined);
    window.setTimeout(() => request.trigger?.isConnected && request.trigger.focus(), 0);
    window.setTimeout(() => pumpRef.current(), 0);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false, "escape");
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    )];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!current) return null;
  const notice = current.kind === "notice";
  const titleId = `app-decision-title-${current.id.replace(/[^a-z0-9_-]/gi, "-")}`;
  const descriptionId = `${titleId}-description`;
  const Icon = notice ? Info : current.tone === "danger" ? AlertTriangle : ShieldCheck;
  return <div
    className="app-decision-overlay"
    role="presentation"
    data-testid="app-decision-overlay"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) finish(false, "backdrop");
    }}
  >
    <section
      ref={dialogRef}
      className={`app-decision-dialog ${current.tone ?? "normal"}`}
      role={notice ? "dialog" : "alertdialog"}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={onKeyDown}
    >
      <header><Icon size={22} aria-hidden="true" /><h2 id={titleId}>{current.title}</h2></header>
      <p id={descriptionId}>{current.description}</p>
      {current.impact ? <p className="app-decision-impact"><strong>{zh ? "影响：" : "Impact: "}</strong>{current.impact}</p> : null}
      <footer>
        {!notice ? <button ref={safeButtonRef} type="button" onClick={() => finish(false, "cancel")}>{current.cancelLabel ?? (zh ? "取消" : "Cancel")}</button> : null}
        <button
          ref={notice ? safeButtonRef : undefined}
          type="button"
          className={current.tone === "danger" ? "danger" : "primary"}
          onClick={() => finish(true, "confirm")}
        >{current.confirmLabel ?? (notice ? (zh ? "知道了" : "OK") : (zh ? "确认" : "Confirm"))}</button>
      </footer>
    </section>
  </div>;
}
