import { LayoutPanelLeft } from "lucide-react";
import React from "react";
import type { UiCanvasDocument } from "./canvasArtifactTypes";

interface CanvasChatTeaserProps {
  doc: UiCanvasDocument;
  darkMode: "dark" | "light";
  onOpen: () => void;
}

const CanvasChatTeaser: React.FC<CanvasChatTeaserProps> = ({ doc, darkMode, onOpen }) => {
  const isDark = darkMode === "dark";
  return (
    <div
      className={`my-2 max-w-lg rounded-xl border px-4 py-3 text-sm ${
        isDark
          ? "border-white/10 bg-white/[0.03] text-primary"
          : "border-gray-200/90 bg-white text-gray-900 shadow-sm"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
            isDark ? "bg-violet-500/15 text-violet-200" : "bg-violet-100 text-violet-700"
          }`}
        >
          <LayoutPanelLeft className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug">{doc.title}</p>
          {doc.subtitle ? (
            <p className={`mt-1 text-xs ${isDark ? "text-secondary" : "text-gray-500"}`}>{doc.subtitle}</p>
          ) : null}
          <button
            type="button"
            onClick={onOpen}
            className={`mt-2 inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              isDark
                ? "bg-violet-500/20 text-violet-100 hover:bg-violet-500/30"
                : "bg-violet-600 text-white hover:bg-violet-700"
            }`}
          >
            在右侧「产出物」中查看
          </button>
        </div>
      </div>
    </div>
  );
};

export default CanvasChatTeaser;
