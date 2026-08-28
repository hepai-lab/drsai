import * as React from "react";
import { Dropdown, Menu } from "antd";
import { Brain, ChevronDown, Sparkles } from "lucide-react";

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
  skillCount?: number;
  onOpenSkillModal?: () => void;
}

const chipBase =
  "chat-input-model-trigger group inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium leading-none tracking-tight transition-[background-color,color] duration-150";

function chipTone(darkMode: string, active: boolean) {
  if (darkMode === "dark") {
    return active
      ? "bg-violet-500/18 text-violet-100 hover:bg-violet-500/24"
      : "bg-white/[0.04] text-gray-200 hover:bg-white/[0.08]";
  }
  return active
    ? "bg-violet-100 text-magenta-900 hover:bg-violet-200/80"
    : "bg-violet-50/90 text-magenta-800 hover:bg-violet-100";
}

interface SelectorChipProps {
  darkMode: string;
  active?: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  ariaLabel: string;
  onClick?: () => void;
  disabled?: boolean;
}

const SelectorChip = React.forwardRef<HTMLButtonElement, SelectorChipProps>(
  ({ darkMode, active = false, icon, label, badge, ariaLabel, onClick, disabled }, ref) => (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`${chipBase} ${chipTone(darkMode, active)}`}
    >
      <span className="inline-flex shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5">
        {icon}
      </span>
      <span className="truncate">{label}</span>
      {typeof badge === "number" && badge > 0 && (
        <span
          className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums ${
            darkMode === "dark"
              ? "bg-violet-400/25 text-violet-100"
              : "bg-violet-500 text-white"
          }`}
        >
          {badge}
        </span>
      )}
      <ChevronDown
        className={`h-3 w-3 shrink-0 opacity-55 transition-transform duration-150 group-hover:opacity-80 ${
          darkMode === "dark" ? "text-gray-300" : "text-magenta-700"
        }`}
        aria-hidden
      />
    </button>
  )
);

SelectorChip.displayName = "SelectorChip";

const LlmSelectorBar: React.FC<LlmSelectorBarProps> = ({
  darkMode,
  isInputDisabled,
  llmList,
  selectedLlmLabel,
  onSelect,
  skillCount = 0,
  onOpenSkillModal,
}) => {
  const showModel = llmList.length > 0;
  const showSkill = Boolean(onOpenSkillModal);

  if (!showModel && !showSkill) return null;

  const currentModel = selectedLlmLabel || llmList[0]?.label || "—";

  return (
    <div
      className={`chat-input-model-bar flex items-center gap-1.5 border-t px-3 py-1.5 ${
        darkMode === "dark" ? "border-border-primary/40" : "border-gray-200/80"
      } ${isInputDisabled ? "pointer-events-none opacity-50" : ""}`}
    >
      {showModel && (
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
          <SelectorChip
            darkMode={darkMode}
            icon={<Brain strokeWidth={2} aria-hidden />}
            label={currentModel}
            ariaLabel={`Switch model, current: ${currentModel}`}
            disabled={isInputDisabled}
          />
        </Dropdown>
      )}

      {showSkill && (
        <SelectorChip
          darkMode={darkMode}
          active={skillCount > 0}
          icon={<Sparkles strokeWidth={2} aria-hidden />}
          label="Skill"
          badge={skillCount}
          ariaLabel={
            skillCount > 0
              ? `Attach skill, ${skillCount} selected`
              : "Attach skill"
          }
          onClick={onOpenSkillModal}
          disabled={isInputDisabled}
        />
      )}
    </div>
  );
};

export default LlmSelectorBar;
