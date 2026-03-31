import React, { useCallback, useContext } from "react";
import { Activity, Clock, FileText } from "lucide-react";
import { appContext } from "../hooks/provider";
import { useRightPanelStore } from "../store/rightPanel";

type RightPanelTab = "overview" | "history" | "files";

const TABS: { id: RightPanelTab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "运行概览", icon: <Activity className="w-3.5 h-3.5" /> },
  { id: "history", label: "历史会话", icon: <Clock className="w-3.5 h-3.5" /> },
  { id: "files", label: "文件", icon: <FileText className="w-3.5 h-3.5" /> },
];

interface RightPanelProps {
  width?: number;
  /** 历史会话 tab 的内容 */
  historyContent?: React.ReactNode;
  /** 文件 tab 的内容 */
  filesContent?: React.ReactNode;
  /** tab 切换回调 */
  onTabChange?: (tab: RightPanelTab) => void;
}

const RightPanel: React.FC<RightPanelProps> = ({
  width = 380,
  historyContent,
  filesContent,
  onTabChange,
}) => {
  const { darkMode } = useContext(appContext);
  const [activeTab, setActiveTab] = React.useState<RightPanelTab>("overview");
  const isOpen = useRightPanelStore((s) => s.isOpen);
  const setOverviewSlot = useRightPanelStore((s) => s.setOverviewSlot);

  // Register the overview slot element so RunView can portal AgentPanel into it
  const overviewSlotRef = useCallback(
    (el: HTMLDivElement | null) => {
      setOverviewSlot(el);
    },
    [setOverviewSlot]
  );

  return (
    <div
      className={`flex-shrink-0 flex flex-col h-full transition-all duration-300 overflow-hidden border-l ${darkMode === "dark"
          ? "bg-[#0f0f0f] border-border-primary/50"
          : "bg-gray-50/95 border-gray-200/50"
        }`}
      style={{ width: isOpen ? width : 0 }}
    >
      {isOpen && (
        <>
          {/* Primary tab bar — "page switching" style, fixed h-10 */}
          <div
            className={`flex-shrink-0 flex border-b ${darkMode === "dark" ? "border-border-primary/30" : "border-gray-200/80"
              }`}
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    onTabChange?.(tab.id);
                  }}
                  className={`relative flex flex-col items-center justify-center gap-0.5 h-10 text-[11px] font-medium transition-all select-none flex-1 ${isActive
                      ? "text-accent bg-accent/[0.07]"
                      : "text-secondary hover:text-primary hover:bg-tertiary/20"
                    }`}
                >
                  <span className={`transition-transform ${isActive ? "scale-110" : ""}`}>
                    {tab.icon}
                  </span>
                  <span className={isActive ? "font-semibold" : ""}>{tab.label}</span>
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-[3px] rounded-t bg-accent" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Content — extra top padding to visually separate from tab bar */}
          <div className="flex-1 min-h-0 overflow-hidden pt-1">
            {/* 运行概览 — portal target for AgentPanel */}
            <div className={activeTab === "overview" ? "h-full" : "hidden"}>
              {/* This div is the portal target; RunView's AgentPanel renders here */}
              <div ref={overviewSlotRef} className="h-full w-full" />
            </div>

            {/* 历史会话 */}
            <div className={activeTab === "history" ? "h-full" : "hidden"}>
              {historyContent ?? (
                <Empty icon={<Clock />} text="暂无历史会话" />
              )}
            </div>

            {/* 文件 */}
            <div className={activeTab === "files" ? "h-full" : "hidden"}>
              {filesContent ?? (
                <Empty icon={<FileText />} text="暂无文件" />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const Empty: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div className="flex items-center justify-center h-full text-secondary">
    <div className="text-center">
      <div className="w-10 h-10 mx-auto mb-3 opacity-20 [&>svg]:w-full [&>svg]:h-full">
        {icon}
      </div>
      <p className="text-sm opacity-40">{text}</p>
    </div>
  </div>
);

export default RightPanel;
