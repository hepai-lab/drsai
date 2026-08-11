import { useEffect, useRef, useState } from "react";
import type { OperationalStateDecision } from "@shared/operationalState";
import { copyTextSafely } from "../clipboard";
import { OperationalStateBar } from "../components/OperationalStateBar";

interface DiagnosticsContainerProps {
  autoRecoverKey?: string;
  decision: OperationalStateDecision;
  formatError: (error: unknown) => string;
  language: "en" | "zh";
  report: () => Record<string, unknown>;
  onRecover: () => Promise<string | void>;
}

const completedAutomaticRecoveries = new Set<string>();

/** Owns transient recovery and diagnostic-copy state; callers provide only
 * domain operations and a redacted report projection. */
export function DiagnosticsContainer({ autoRecoverKey, decision, formatError, language, onRecover, report }: DiagnosticsContainerProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function recover(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const completionMessage = await onRecover();
      if (mountedRef.current) setMessage(completionMessage || (language === "zh" ? "恢复操作已执行。" : "Recovery action completed."));
    } catch (error) {
      if (mountedRef.current) setMessage(formatError(error));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoRecoverKey || completedAutomaticRecoveries.has(autoRecoverKey)) return;
    completedAutomaticRecoveries.add(autoRecoverKey);
    void recover();
  }, [autoRecoverKey]);

  async function copyDiagnostics(): Promise<void> {
    await copyTextSafely(JSON.stringify(report(), null, 2));
    setMessage(language === "zh" ? "脱敏诊断已复制。" : "Redacted diagnostics copied.");
  }

  return <OperationalStateBar
    decision={decision}
    language={language}
    busy={busy}
    actionMessage={message}
    onPrimaryAction={recover}
    onCopyDiagnostics={copyDiagnostics}
  />;
}
