import { memo, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { ModelGroup } from "./types";

interface ModelPickerProps {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  modelGroups: ModelGroup[];
  displayModel: string;
  onOpen: () => void;
  onSelectModel: (provider: string, model: string, baseUrl: string) => void;
}

export const ModelPicker = memo(function ModelPicker({
  currentModel,
  currentProvider,
  currentBaseUrl,
  modelGroups,
  displayModel,
  onOpen,
  onSelectModel,
}: ModelPickerProps): React.JSX.Element {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  function toggle(): void {
    if (!isOpen) onOpen();
    setIsOpen((v) => !v);
  }

  function select(provider: string, model: string, baseUrl: string): void {
    onSelectModel(provider, model, baseUrl);
    setIsOpen(false);
    setCustomInput("");
  }

  function submitCustom(): void {
    const model = customInput.trim();
    if (!model) return;
    select(
      currentProvider === "auto" ? "auto" : currentProvider,
      model,
      currentBaseUrl,
    );
  }

  return (
    <div className="chat-model-bar" ref={pickerRef}>
      <button className="chat-model-trigger" onClick={toggle}>
        <span className="chat-model-name">{displayModel}</span>
        <ChevronDown size={12} />
      </button>

      {isOpen && (
        <div className="chat-model-dropdown">
          {modelGroups.map((group) => (
            <div key={group.provider} className="chat-model-group">
              <div className="chat-model-group-label">
                {t(group.providerLabel)}
              </div>
              {group.models.map((m) => {
                const active =
                  currentModel === m.model && currentProvider === m.provider;
                return (
                  <button
                    key={`${m.provider}:${m.model}`}
                    className={`chat-model-option ${active ? "active" : ""}`}
                    onClick={() => select(m.provider, m.model, m.baseUrl)}
                  >
                    <span className="chat-model-option-label">{m.label}</span>
                    <span className="chat-model-option-id">{m.model}</span>
                  </button>
                );
              })}
            </div>
          ))}

          <div className="chat-model-group">
            <div className="chat-model-group-label">{t("chat.custom")}</div>
            <div className="chat-model-custom">
              <input
                className="chat-model-custom-input"
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitCustom();
                }}
                placeholder={t("chat.typeModelName")}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
