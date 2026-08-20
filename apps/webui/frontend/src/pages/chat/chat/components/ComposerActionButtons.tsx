import * as React from "react";
import {
  PaperAirplaneIcon,
  PauseCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

interface ComposerActionButtonsProps {
  darkMode: string;
  text: string;
  isInputDisabled: boolean;
  runStatus?: string;
  onClear: () => void;
  onPause: () => void;
  onSubmit: () => void;
}

const ComposerActionButtons: React.FC<ComposerActionButtonsProps> = ({
  darkMode,
  text,
  isInputDisabled,
  runStatus,
  onClear,
  onPause,
  onSubmit,
}) => {
  return (
    <div className="absolute right-2 bottom-2 flex items-center space-x-2">
      {text.trim().length > 0 && !isInputDisabled && (
        <button
          type="button"
          onClick={onClear}
          className="rounded-full flex justify-center items-center h-8 transition-smooth hover-lift text-secondary hover:text-accent hover:bg-accent/10"
          aria-label="Clear input"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      )}
      {(runStatus === "active" ||
        runStatus === "connected" ||
        runStatus === "created") && (
        <button
          type="button"
          onClick={onPause}
          className={`rounded-full flex justify-center items-center w-10 h-10 transition-smooth hover-lift ${
            darkMode === "dark"
              ? "bg-warning-primary/20 hover:bg-warning-primary/30 text-warning-primary"
              : "bg-warning-primary/10 hover:bg-warning-primary/20 text-warning-primary"
          } shadow-modern`}
        >
          <PauseCircleIcon className="h-5 w-5" />
        </button>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={isInputDisabled}
        aria-label="发送消息"
        className={`transition-smooth rounded-full flex justify-center items-center w-10 h-10 ${
          isInputDisabled
            ? "cursor-not-allowed opacity-50 bg-gray-400"
            : darkMode === "dark"
              ? "bg-gradient-primary hover:shadow-modern-lg text-white hover-lift pulse-glow"
              : "bg-gradient-primary hover:shadow-modern-lg text-white hover-lift pulse-glow"
        }`}
      >
        <PaperAirplaneIcon className="h-5 w-5 transform -rotate-45" />
      </button>
    </div>
  );
};

export default ComposerActionButtons;
