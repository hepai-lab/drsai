import * as React from "react";
import { Dropdown, Menu } from "antd";
import { Brain, ChevronDownIcon } from "lucide-react";

interface LlmOption {
  label: string;
  value: string;
}

interface LlmSelectorBarProps {
  darkMode: string;
  isInputDisabled: boolean;
  llmList: LlmOption[];
  selectedLlmLabel: string;
  onSelect: (llm: LlmOption) => void;
}

const LlmSelectorBar: React.FC<LlmSelectorBarProps> = ({
  darkMode,
  isInputDisabled,
  llmList,
  selectedLlmLabel,
  onSelect,
}) => {
  if (llmList.length === 0) return null;

  return (
    <div
      className={`chat-input-model-bar flex items-center gap-2 border-t px-4 py-2 ${
        darkMode === "dark" ? "border-border-primary/40" : "border-gray-200/80"
      } ${isInputDisabled ? "pointer-events-none opacity-50" : ""}`}
    >
      <Brain
        className={`h-3.5 w-3.5 shrink-0 ${
          darkMode === "dark" ? "text-gray-400" : "text-magenta-600"
        }`}
        aria-hidden
      />

      <Dropdown
        overlay={
          <Menu className={darkMode === "dark" ? "dark-menu" : ""}>
            {llmList.map((llm) => (
              <Menu.Item
                key={llm.value}
                onClick={() => {
                  onSelect(llm);
                }}
                className={darkMode === "dark" ? "text-gray-300 hover:text-white" : ""}
              >
                <span className="flex w-full min-w-[10rem] items-center justify-between">
                  <span className={darkMode === "dark" ? "text-gray-300" : ""}>
                    {llm.label}
                  </span>
                  {llm.label === selectedLlmLabel && (
                    <span className="ml-2 font-bold text-green-500">√</span>
                  )}
                </span>
              </Menu.Item>
            ))}
          </Menu>
        }
        trigger={["click"]}
        disabled={isInputDisabled}
      >
        <button
          type="button"
          className={`chat-input-model-trigger inline-flex max-w-full items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-smooth ${
            darkMode === "dark"
              ? "bg-white/5 text-gray-200 hover:bg-white/10"
              : "bg-violet-50 text-magenta-800 hover:bg-violet-100"
          }`}
          aria-label={`Switch model, current: ${selectedLlmLabel || llmList[0]?.label}`}
        >
          <span className="truncate">{selectedLlmLabel || llmList[0]?.label || "—"}</span>
          <ChevronDownIcon
            className={`h-3.5 w-3.5 shrink-0 ${
              darkMode === "dark" ? "text-gray-400" : "text-magenta-600"
            }`}
            aria-hidden
          />
        </button>
      </Dropdown>
    </div>
  );
};

export default LlmSelectorBar;
