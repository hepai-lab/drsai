import * as React from "react";
import { Dropdown, Menu, Tooltip } from "antd";
import { PaperclipIcon, PlusIcon, WrenchIcon } from "lucide-react";

interface AttachDropdownProps {
  darkMode: string;
  isInputDisabled: boolean;
  fileCount: number;
  skillCount: number;
  attachFileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  onAttachFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenSkillModal: () => void;
}

const AttachDropdown: React.FC<AttachDropdownProps> = ({
  darkMode,
  isInputDisabled,
  fileCount,
  skillCount,
  attachFileInputRef,
  onAttachFileChange,
  onOpenSkillModal,
}) => {
  const totalCount = fileCount + skillCount;

  const tooltipTitle = (() => {
    if (totalCount === 0) return "Attach File";
    const parts: string[] = [];
    if (fileCount) parts.push(`${fileCount} 个文件`);
    if (skillCount) parts.push(`${skillCount} 个技能包`);
    return parts.join("，");
  })();

  return (
    <div
      className={`absolute left-4 top-1/2 transform -translate-y-1/2 z-10 ${
        isInputDisabled ? "pointer-events-none opacity-50" : ""
      }`}
    >
      <input
        ref={attachFileInputRef}
        type="file"
        multiple
        className="hidden"
        aria-hidden
        onChange={onAttachFileChange}
      />
      <Dropdown
        overlay={
          <Menu className={darkMode === "dark" ? "dark-menu" : ""}>
            <Menu.Item
              key="attach-file"
              onClick={({ domEvent }) => {
                domEvent?.preventDefault();
                domEvent?.stopPropagation();
                if (!isInputDisabled) {
                  attachFileInputRef.current?.click();
                }
              }}
            >
              <div className="flex items-center gap-2">
                <PaperclipIcon
                  className={`w-4 h-4 flex-shrink-0 ${
                    darkMode === "dark" ? "text-gray-300" : "text-magenta-600"
                  }`}
                />
                <span className={darkMode === "dark" ? "text-gray-300" : "text-magenta-600"}>
                  Attach File
                </span>
              </div>
            </Menu.Item>
            <Menu.Item
              key="attach-skill"
              onClick={({ domEvent }) => {
                domEvent?.preventDefault();
                domEvent?.stopPropagation();
                onOpenSkillModal();
              }}
            >
              <div className="flex items-center gap-2">
                <WrenchIcon
                  className={`w-4 h-4 flex-shrink-0 ${
                    darkMode === "dark" ? "text-gray-300" : "text-magenta-600"
                  }`}
                />
                <span className={darkMode === "dark" ? "text-gray-300" : "text-magenta-600"}>
                  Attach Skill
                </span>
              </div>
            </Menu.Item>
          </Menu>
        }
        trigger={["click"]}
      >
        <Tooltip title={<span className="text-sm">{tooltipTitle}</span>} placement="top">
          <button
            type="button"
            disabled={isInputDisabled}
            className={`flex justify-center items-center w-8 h-8 rounded-xl transition-smooth hover-lift relative ${
              totalCount > 0
                ? "text-accent bg-accent/10"
                : darkMode === "dark"
                  ? "text-secondary hover:text-accent hover:bg-accent/10"
                  : "text-secondary hover:text-accent hover:bg-accent/10"
            }`}
          >
            <PlusIcon className="h-4 w-4" />
            {totalCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-accent text-white text-xs rounded-full w-4 h-4 flex items-center justify-center animate-bounce-in">
                {totalCount}
              </span>
            )}
          </button>
        </Tooltip>
      </Dropdown>
    </div>
  );
};

export default AttachDropdown;
