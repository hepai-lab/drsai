import { AlertCircle, CheckCircle2, Save, Wifi, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DesktopRemoteAgentSaveRequest, DesktopRemoteAgentTestResult } from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";
import { userFacingFailureMessage } from "../userFacingLanguage";

interface RemoteAgentModalProps {
  language: AppLanguage;
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

interface RemoteAgentForm {
  name: string;
  url: string;
  apiKey: string;
}

const DEFAULT_FORM: RemoteAgentForm = {
  name: "DrSai_BESIII_v3.0",
  url: "https://aiapi.ihep.ac.cn/apiv2",
  apiKey: "",
};

export function RemoteAgentModal({
  language,
  open,
  onClose,
  onSaved,
}: RemoteAgentModalProps): React.JSX.Element | null {
  const zh = language === "zh";
  const [form, setForm] = useState<RemoteAgentForm>(DEFAULT_FORM);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verified, setVerified] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [agentInfo, setAgentInfo] = useState<Record<string, unknown> | undefined>();

  useEffect(() => {
    if (!open) return;
    setForm(DEFAULT_FORM);
    setTesting(false);
    setSaving(false);
    setVerified(false);
    setTestError(null);
    setSaveError(null);
    setAgentInfo(undefined);
  }, [open]);

  if (!open) return null;

  function updateField<K extends keyof RemoteAgentForm>(field: K, value: RemoteAgentForm[K]): void {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
    if (field !== "name") {
      setVerified(false);
      setTestError(null);
      setAgentInfo(undefined);
    }
  }

  async function testConnection(): Promise<void> {
    if (!form.name.trim() || !form.url.trim() || !form.apiKey.trim()) {
      setTestError(zh ? "请填写名称、地址和 API Key。" : "Name, URL, and API key are required.");
      return;
    }
    setTesting(true);
    setTestError(null);
    try {
      const result: DesktopRemoteAgentTestResult = await desktopApi.testRemoteAgent({
        name: form.name.trim(),
        url: form.url.trim(),
        apiKey: form.apiKey.trim(),
      });
      if (!result.ok) {
        setVerified(false);
        setTestError(result.message);
        return;
      }
      setAgentInfo(result.agentInfo);
      setVerified(true);
    } catch (error) {
      setVerified(false);
      setTestError(userFacingFailureMessage(error, language, "connection"));
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(): Promise<void> {
    if (!verified) {
      setSaveError(zh ? "请先测试连接并通过后再保存。" : "Test the connection successfully before saving.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const request: DesktopRemoteAgentSaveRequest = {
        name: form.name.trim(),
        url: form.url.trim(),
        apiKey: form.apiKey.trim(),
        agentInfo,
      };
      await desktopApi.saveRemoteAgent(request);
      await onSaved();
      onClose();
    } catch (error) {
      setSaveError(userFacingFailureMessage(error, language, "operation"));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="agent-remote-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="agent-remote-modal"
        role="dialog"
        aria-modal="true"
        aria-label={zh ? "连接远程智能体" : "Connect remote agent"}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="agent-remote-modal-header">
          <div>
            <Wifi size={18} />
            <strong>{zh ? "连接远程智能体" : "Connect remote agent"}</strong>
            {verified && <span className="agent-remote-verified">{zh ? "已验证" : "Verified"}</span>}
          </div>
          <button type="button" aria-label={zh ? "关闭" : "Close"} onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="agent-remote-modal-body">
          <label>
            <span>{zh ? "智能体名称" : "Agent name"} *</span>
            <input
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
              placeholder={zh ? "例如: My Remote Agent" : "e.g. My Remote Agent"}
            />
          </label>
          <label>
            <span>{zh ? "服务地址" : "Server URL"} *</span>
            <input
              value={form.url}
              onChange={(event) => updateField("url", event.target.value)}
              placeholder="https://aiapi.ihep.ac.cn/apiv2"
            />
          </label>
          <label>
            <span>API Key *</span>
            <input
              type="password"
              value={form.apiKey}
              onChange={(event) => updateField("apiKey", event.target.value)}
              placeholder="sk-xxxxxxxx"
              autoComplete="off"
            />
          </label>

          {testError && (
            <div className="agent-remote-modal-status is-error">
              <AlertCircle size={14} />
              <span>{testError}</span>
            </div>
          )}
          {saveError && (
            <div className="agent-remote-modal-status is-error">
              <AlertCircle size={14} />
              <span>{saveError}</span>
            </div>
          )}
          {verified && !saveError && (
            <div className="agent-remote-modal-status is-ok">
              <CheckCircle2 size={14} />
              <span>{zh ? "连接可用，可以保存。" : "Connection verified. Ready to save."}</span>
            </div>
          )}
        </div>

        <footer className="agent-remote-modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            {zh ? "取消" : "Cancel"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!form.name.trim() || !form.url.trim() || !form.apiKey.trim() || testing}
            onClick={() => void testConnection()}
          >
            <Zap size={14} />
            {testing ? (zh ? "测试中…" : "Testing…") : (zh ? "测试连接" : "Test connection")}
          </button>
          <button type="button" disabled={!verified || saving} onClick={() => void handleSave()}>
            <Save size={14} />
            {saving ? (zh ? "保存中…" : "Saving…") : (zh ? "保存" : "Save")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
