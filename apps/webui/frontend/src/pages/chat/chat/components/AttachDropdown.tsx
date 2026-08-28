import * as React from "react";
import { Tooltip } from "antd";
import { PlusIcon } from "lucide-react";

interface AttachDropdownProps {
  darkMode: string;
  isInputDisabled: boolean;
  fileCount: number;
  attachFileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  onAttachFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const AttachDropdown: React.FC<AttachDropdownProps> = ({
  darkMode,
  isInputDisabled,
  fileCount,
  attachFileInputRef,
  onAttachFileChange,
}) => {
  const tooltipTitle = fileCount > 0 ? `${fileCount} 个文件` : "Attach File";

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
      <Tooltip title={<span className="text-sm">{tooltipTitle}</span>} placement="top">
        <button
          type="button"
          disabled={isInputDisabled}
          aria-label={tooltipTitle}
          onClick={() => {
            if (!isInputDisabled) {
              attachFileInputRef.current?.click();
            }
          }}
          className={`flex justify-center items-center w-8 h-8 rounded-xl transition-smooth hover-lift relative ${
            fileCount > 0
              ? "text-accent bg-accent/10"
              : darkMode === "dark"
                ? "text-secondary hover:text-accent hover:bg-accent/10"
                : "text-secondary hover:text-accent hover:bg-accent/10"
          }`}
        >
          <PlusIcon className="h-4 w-4" />
          {fileCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-accent text-white text-xs rounded-full w-4 h-4 flex items-center justify-center animate-bounce-in">
              {fileCount}
            </span>
          )}
        </button>
      </Tooltip>
    </div>
  );
};

export default AttachDropdown;
