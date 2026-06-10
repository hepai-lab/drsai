import React, { useCallback, useContext, useEffect } from "react";
import { Activity, Clock, FileText, ChevronLeft, ChevronRight, Library } from "lucide-react";
import { appContext } from "../hooks/provider";
import { useLang } from "../i18n/useLang";
import { useRightPanelStore, type RightPanelLayoutTab } from "../store/rightPanel";

type RightPanelTab = RightPanelLayoutTab;
export type RightPanelTabSpec = { id: RightPanelTab; label: string; icon: React.ReactNode };

export const DEFAULT_RIGHT_PANEL_TABS: RightPanelTabSpec[] = [
  { id: "files", label: "Files", icon: <FileText className="w-3.5 h-3.5" /> },
  { id: "overview", label: "Overview", icon: <Activity className="w-3.5 h-3.5" /> },
  { id: "history", label: "History", icon: <Clock className="w-3.5 h-3.5" /> },
];

export const TEMPLATES_TAB: RightPanelTabSpec = {
  id: "templates",
  label: "Templates",
  icon: <Library className="w-3.5 h-3.5" />,
};

interface RightPanelProps {
  width?: number;
  isCompact?: boolean;
  /** 历史会话 tab 的内容 */
  historyContent?: React.ReactNode;
  /** 文件 tab 的内容 */
  filesContent?: React.ReactNode;
  /** 模板库 tab 的内容（仅在传入时显示该 tab） */
  templatesContent?: React.ReactNode;
  /** 可选：自定义 tab 列表。未传入时使用 DEFAULT_RIGHT_PANEL_TABS（如有 templatesContent 则自动追加 templates tab）。 */
  tabs?: RightPanelTabSpec[];
  /** tab 切换回调 */
  onTabChange?: (tab: RightPanelTab) => void;
}

const RightPanel: React.FC<RightPanelProps> = ({
  width = 380,
  isCompact = false,
  historyContent,
  filesContent,
  templatesContent,
  tabs,
  onTabChange,
}) => {
  const { darkMode } = useContext(appContext);
  const { t } = useLang();
  const activeTab = useRightPanelStore((s) => s.layoutTab);
  const setActiveTab = useRightPanelStore((s) => s.setLayoutTab);
  const isOpen = useRightPanelStore((s) => s.isOpen);
  const setIsOpen = useRightPanelStore((s) => s.setIsOpen);
  const setOverviewSlot = useRightPanelStore((s) => s.setOverviewSlot);

  const visibleTabs: RightPanelTabSpec[] = tabs ?? (
    templatesContent !== undefined
      ? [...DEFAULT_RIGHT_PANEL_TABS, TEMPLATES_TAB]
      : DEFAULT_RIGHT_PANEL_TABS
  );

  // If the active tab is no longer visible (e.g. user switched away from
  // DocMaster while on the templates tab), gracefully fall back to overview.
  useEffect(() => {
    if (!visibleTabs.some((t) => t.id === activeTab)) {
      setActiveTab("overview");
    }
  }, [visibleTabs, activeTab, setActiveTab]);

  const overviewSlotRef = useCallback(
    (el: HTMLDivElement | null) => {
      setOverviewSlot(el);
    },
    [setOverviewSlot]
  );

  const isDark = darkMode === "dark";

  if (isCompact && !isOpen) {
    return null;
  }

  const panelWidth = isCompact ? "100%" : isOpen ? width : 40;

  return (
    <div
      className={`flex-shrink-0 flex flex-col h-full transition-all duration-300 overflow-hidden shadow-modern ${
        isOpen && !isCompact ? "rounded-2xl" : isCompact ? "rounded-none" : "rounded-lg"
      } ${
        isDark
          ? "bg-[#0d1117]/70 backdrop-blur-md shadow-modern-lg"
          : "bg-white/90 border border-gray-200/70 backdrop-blur-md"
      }`}
      style={{ width: panelWidth }}
    >
      {isOpen ? (
        <>
          {/* Tab bar */}
          <div
            className={`flex-shrink-0 flex items-stretch ${
              isDark ? "bg-white/[0.02]" : "border-b border-gray-200/80 bg-white/70"
            }`}
          >
            {visibleTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    onTabChange?.(tab.id);
                  }}
                  className={`relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 flex-1 text-[11px] font-medium transition-all select-none ${
                    isActive
                      ? "text-accent bg-accent/[0.11]"
                      : "text-secondary hover:text-primary hover:bg-tertiary/25"
                  }`}
                >
                  <span className={`transition-transform ${isActive ? "scale-110" : ""}`}>
                    {tab.icon}
                  </span>
                  <span className={isActive ? "font-semibold" : ""}>{t("rightpanel.tab." + tab.id)}</span>
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
              title={t("rightpanel.collapse")}
              className={`flex-shrink-0 flex min-h-[44px] min-w-[44px] items-center justify-center transition-colors ${
                isDark
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
              {historyContent ?? <Empty icon={<Clock />} text={t("rightpanel.empty.history")} />}
            </div>
            <div className={activeTab === "files" ? "h-full" : "hidden"}>
              {filesContent ?? (
                <div className="border border-gray-200/70 rounded-lg m-4 h-full flex items-center justify-center bg-gray-100/60">
                  <Empty icon={<FileText />} text={t("rightpanel.empty.files")} />
                </div>
              )}
            </div>
            {visibleTabs.some((t) => t.id === "templates") && (
              <div className={activeTab === "templates" ? "h-full" : "hidden"}>
                {templatesContent ?? <Empty icon={<Library />} text={t("rightpanel.empty.templates")} />}
              </div>
            )}
          </div>
        </>
      ) : (
        /* Collapsed strip (desktop only) */
        <div className="flex flex-col items-center pt-1">
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            title={t("rightpanel.expand")}
            className={`flex items-center justify-center w-full h-8 transition-colors ${
              isDark
                ? "text-secondary hover:text-primary hover:bg-white/5"
                : "text-gray-400 hover:text-gray-600 hover:bg-gray-100/60"
            }`}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <div className="flex flex-col items-center gap-1 mt-2">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setIsOpen(true);
                  setActiveTab(tab.id);
                  onTabChange?.(tab.id);
                }}
                title={t("rightpanel.tab." + tab.id)}
                className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
                  activeTab === tab.id
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
