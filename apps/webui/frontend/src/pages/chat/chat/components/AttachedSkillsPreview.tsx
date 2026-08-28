import * as React from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { Sparkles } from "lucide-react";
import type { HepaiSkillPickRow } from "../types";

interface AttachedSkillsPreviewProps {
  skills: HepaiSkillPickRow[];
  darkMode: string;
  onRemove: (id: string) => void;
}

const AttachedSkillsPreview: React.FC<AttachedSkillsPreviewProps> = ({
  skills,
  darkMode,
  onRemove,
}) => {
  if (skills.length === 0) return null;

  return (
    <>
      {skills.map((s) => (
        <div
          key={s.id}
          className={`flex items-center gap-2 max-w-[min(100%,22rem)] ${
            darkMode === "dark"
              ? "bg-[#444444] text-white border border-gray-600"
              : "bg-white text-magenta-800 border border-magenta-200"
          } rounded-lg px-3 py-2 text-xs shadow-sm`}
        >
          <Sparkles
            className={`w-3.5 h-3.5 shrink-0 ${
              darkMode === "dark" ? "text-violet-300" : "text-violet-600"
            }`}
            strokeWidth={2}
            aria-hidden
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className={`truncate font-medium ${
                darkMode === "dark" ? "text-white" : "text-magenta-800"
              }`}
              title={s.filename}
            >
              {s.filename}
            </span>
            <span
              className={`truncate text-[11px] ${
                darkMode === "dark" ? "text-gray-400" : "text-magenta-600"
              }`}
              title={s.source}
            >
              {s.source}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onRemove(s.id)}
            className={`shrink-0 rounded-full p-1 ${
              darkMode === "dark"
                ? "hover:bg-red-500/20 hover:text-red-400 text-gray-400"
                : "hover:bg-red-100 hover:text-red-600 text-magenta-600"
            }`}
            aria-label={`移除 ${s.filename}`}
          >
            <XMarkIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </>
  );
};

export default AttachedSkillsPreview;
