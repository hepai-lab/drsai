import { Dropdown } from "antd";
import { ChevronRight, FileText, MessageSquare } from "lucide-react";
import React, { useContext, useState } from "react";
import { appContext } from "../hooks/provider";

type CanvasView = "chat" | "file_preview";

const VIEWS: { id: CanvasView; label: string; icon: React.ReactNode }[] = [
  { id: "chat", label: "对话", icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { id: "file_preview", label: "文件预览", icon: <FileText className="w-3.5 h-3.5" /> },
];

interface CanvasProps {
  children: React.ReactNode;
  filePreviewContent?: React.ReactNode;
  onRootClick?: () => void;
}

const Canvas: React.FC<CanvasProps> = ({ children, filePreviewContent, onRootClick }) => {
  const { darkMode } = useContext(appContext);
  const [activeView, setActiveView] = useState<CanvasView>("chat");

  const current = VIEWS.find((v) => v.id === activeView)!;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Breadcrumb */}
      <div
        className={`flex-shrink-0 flex items-center gap-1 px-4 h-10 border-b text-sm ${
          darkMode === "dark" ? "border-border-primary/30" : "border-gray-200/80"
        }`}
      >
        {/* Root */}
        <button
          type="button"
          onClick={onRootClick}
          className="text-secondary hover:text-accent transition-colors font-medium"
        >
          OpenDrSai
        </button>

        <ChevronRight className="w-3.5 h-3.5 text-secondary/50 flex-shrink-0" />

        {/* Current view — dropdown to switch */}
        <Dropdown
          trigger={["click"]}
          menu={{
            items: VIEWS.map((v) => ({
              key: v.id,
              label: (
                <span className="flex items-center gap-2">
                  {v.icon}
                  {v.label}
                </span>
              ),
              onClick: () => setActiveView(v.id),
            })),
            selectedKeys: [activeView],
          }}
          placement="bottomLeft"
        >
          <button
            type="button"
            className="flex items-center gap-1.5 text-primary font-medium hover:text-accent transition-colors"
          >
            {current.icon}
            {current.label}
            <ChevronRight className="w-3 h-3 text-secondary/50 rotate-90" />
          </button>
        </Dropdown>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className={activeView === "chat" ? "h-full" : "hidden"}>
          {children}
        </div>
        <div className={activeView === "file_preview" ? "h-full" : "hidden"}>
          {filePreviewContent ?? (
            <div className="flex items-center justify-center h-full text-secondary">
              <div className="text-center">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm opacity-40">暂无文件</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Canvas;
