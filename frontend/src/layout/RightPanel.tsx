import React, { useCallback, useContext } from "react";
import { Activity, Clock, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { appContext } from "../hooks/provider";
import { useRightPanelStore, type RightPanelLayoutTab } from "../store/rightPanel";

type RightPanelTab = RightPanelLayoutTab;

const TABS: { id: RightPanelTab; label: string; icon: React.ReactNode }[] = [
  { id: "files", label: "文件空间", icon: <FileText className="w-3.5 h-3.5" /> },
  { id: "overview", label: "运行概览", icon: <Activity className="w-3.5 h-3.5" /> },
  { id: "history", label: "历史会话", icon: <Clock className="w-3.5 h-3.5" /> },
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
  const activeTab = useRightPanelStore((s) => s.layoutTab);
  const setActiveTab = useRightPanelStore((s) => s.setLayoutTab);
  const isOpen = useRightPanelStore((s) => s.isOpen);
  const setIsOpen = useRightPanelStore((s) => s.setIsOpen);
  const setOverviewSlot = useRightPanelStore((s) => s.setOverviewSlot);

  const overviewSlotRef = useCallback(
    (el: HTMLDivElement | null) => {
      setOverviewSlot(el);
    },
    [setOverviewSlot]
  );

  const isDark = darkMode === "dark";

  return (
    <div
      className={`flex-shrink-0 flex flex-col h-full transition-all duration-300 overflow-hidden shadow-modern ${isOpen ? "rounded-2xl" : "rounded-lg"
        } ${isDark
          ? "bg-[#0d1117]/70 backdrop-blur-md shadow-modern-lg"
          : "bg-white/90 border border-gray-200/70 backdrop-blur-md"
        }`}
      style={{ width: isOpen ? width : 40 }}
    >
      {isOpen ? (
        <>
          {/* Tab bar */}
          <div
            className={`flex-shrink-0 flex items-stretch ${isDark
              ? "bg-white/[0.02]"
              : "border-b border-gray-200/80 bg-white/70"
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
                  className={`relative flex flex-col items-center justify-center gap-0.5 h-11 text-[11px] font-medium transition-all select-none flex-1 ${isActive
                    ? "text-accent bg-accent/[0.11]"
                    : "text-secondary hover:text-primary hover:bg-tertiary/25"
                    }`}
                >
                  <span className={`transition-transform ${isActive ? "scale-110" : ""}`}>
                    {tab.icon}
                  </span>
                  <span className={isActive ? "font-semibold" : ""}>{tab.label}</span>
                  {isActive && (
                    <span className="absolute bottom-0 left-2 right-2 h-[3px] rounded-full bg-accent" />
                  )}
                </button>
              );
            })}

            {/* Collapse button */}
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              title="收起面板"
              className={`flex-shrink-0 flex items-center justify-center w-8 transition-colors ${isDark
                ? "text-secondary hover:text-primary hover:bg-white/5"
                : "text-gray-400 hover:text-gray-600 hover:bg-gray-100/60"
                }`}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 min-h-0 overflow-hidden pt-1">
            <div className={activeTab === "overview" ? "h-full" : "hidden"}>
              <div ref={overviewSlotRef} className="h-full w-full" />
            </div>
            <div className={activeTab === "history" ? "h-full" : "hidden"}>
              {historyContent ?? <Empty icon={<Clock />} text="暂无历史会话" />}
            </div>
            <div className={activeTab === "files" ? "h-full" : "hidden"}>
              {filesContent ??
                <div className="border border-gray-200/70 rounded-lg m-4  h-full flex items-center justify-center bg-gray-100/60">
                  <Empty icon={<FileText />} text="暂无文件" />
                </div>

              }
            </div>
          </div>
        </>
      ) : (
        /* Collapsed strip */
        <div className="flex flex-col items-center pt-1">
          {/* Expand button */}
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            title="展开面板"
            className={`flex items-center justify-center w-full h-8 transition-colors ${isDark
              ? "text-secondary hover:text-primary hover:bg-white/5"
              : "text-gray-400 hover:text-gray-600 hover:bg-gray-100/60"
              }`}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          {/* Tab icons */}
          <div className="flex flex-col items-center gap-1 mt-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => { setIsOpen(true); setActiveTab(tab.id); onTabChange?.(tab.id); }}
                title={tab.label}
                className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${activeTab === tab.id
                  ? "text-accent bg-accent/10"
                  : isDark
                    ? "text-secondary hover:text-primary hover:bg-white/5"
                    : "text-gray-400 hover:text-gray-600 hover:bg-gray-100/60"
                  }`}
              >
                {tab.icon}
              </button>
            ))}
          </div>
        </div>
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
