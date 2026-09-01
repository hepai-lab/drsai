import { ConfigProvider, theme } from "antd";
import "antd/dist/reset.css";
import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { appContext } from "../hooks/provider";
import { useLang } from "../i18n/useLang";
import { useIsCompactLayout } from "../hooks/useMediaQuery";
import TopNav from "./TopNav";
import LeftMenu from "./LeftMenu";
import Canvas from "./Canvas";
import UnifiedRightPanel from "./UnifiedRightPanel";
import { type MenuId, MENU_IDS } from "../components/views/menuRoutes";
import { useRightPanelStore } from "../store/rightPanel";

interface AppLayoutProps {
  // TopNav
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;

  // LeftMenu
  activeSubMenuItem: string;
  activeMenuLabel: string;
  onSubMenuChange: (tabId: string) => void;
  /** 平台管理员可见：使用分析、用户管理 */
  showAdminNav?: boolean;
  /** 历史会话列表（传入后显示在左侧菜单底部） */
  leftMenuHistory?: React.ReactNode;
  /** 技能广场当前子页签 */
  skillsSubTab?: string;
  /** 技能广场子页签切换 */
  onSkillsSubTabChange?: (tabId: string) => void;

  // RightPanel
  rightPanelTemplates?: React.ReactNode;
  rightPanelGuanlianyewu?: React.ReactNode;
  rightPanelZongheCailiao?: React.ReactNode;
  /** 试用 button next to 申请资料审查 — seeds demo files and fires the audit prompt. */
  onTryGuanlianyewu?: () => void;
  /** 试用 button next to 综合材料撰写 — seeds demo files and fires the expert prompt. */
  onTryZonghe?: () => void;
  /** Whether the active agent is DocMaster (controls visibility of DocMaster tab). */
  isDocMasterAgent?: boolean;
  /** Content for the 生成的文件 right panel tab. */
  generatedFilesContent?: React.ReactNode;
  /** File count badge on the 生成的文件 button and tab. */
  generatedFilesCount?: number;

  // Canvas
  children: React.ReactNode;
  onNewSession?: () => void;
  showNewSessionButton?: boolean;
}

const AppLayout: React.FC<AppLayoutProps> = ({
  isSidebarOpen,
  onToggleSidebar,
  activeSubMenuItem,
  activeMenuLabel,
  onSubMenuChange,
  showAdminNav = false,
  rightPanelTemplates,
  leftMenuHistory,
  rightPanelGuanlianyewu,
  rightPanelZongheCailiao,
  onTryGuanlianyewu,
  onTryZonghe,
  isDocMasterAgent = false,
  generatedFilesContent,
  generatedFilesCount = 0,
  children,
  onNewSession,
  showNewSessionButton = false,
  skillsSubTab,
  onSkillsSubTabChange,
}) => {
  const { darkMode } = useContext(appContext);
  const { t } = useLang();
  const isCompact = useIsCompactLayout();

  const isRightPanelOpen = useRightPanelStore((s) => s.isRightPanelOpen);
  const setRightPanelOpen = useRightPanelStore((s) => s.setRightPanelOpen);
  const setRightPanelWidth = useRightPanelStore((s) => s.setRightPanelWidth);

  // Keep panel width at 20vw on resize, unless the user manually dragged it.
  useEffect(() => {
    const RIGHT_PANEL_WIDTH_VW = 0.20;
    const RIGHT_PANEL_WIDTH_KEY = 'drsai:layout:rightPanelWidth';
    const hasSaved = Boolean(localStorage.getItem(RIGHT_PANEL_WIDTH_KEY));
    if (hasSaved) return;
    const onResize = () => setRightPanelWidth(Math.round(window.innerWidth * RIGHT_PANEL_WIDTH_VW));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setRightPanelWidth]);

  // Right panel only renders for DocMaster agent on the chat tab.
  const showRightPanel = isDocMasterAgent && activeSubMenuItem === MENU_IDS.currentSession;

  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const sizes = useMemo(
    () => ({
      left: {
        collapsed: 40,
        min: 180,
        max: 420,
        defaultOpen: 224,
        storageKey: "drsai:layout:leftWidth",
      },
      right: {
        min: 50,
      },
    }),
    []
  );

  const [leftWidth, setLeftWidth] = useState<number>(sizes.left.defaultOpen);

  useEffect(() => {
    try {
      const leftRaw = localStorage.getItem(sizes.left.storageKey);
      if (leftRaw) {
        const v = Number(leftRaw);
        if (Number.isFinite(v)) setLeftWidth(Math.min(sizes.left.max, Math.max(sizes.left.min, v)));
      }
    } catch {
      // ignore
    }
  }, [sizes.left.max, sizes.left.min, sizes.left.storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(sizes.left.storageKey, String(leftWidth));
    } catch {
      // ignore
    }
  }, [leftWidth, sizes.left.storageKey]);

  const beginLeftDrag = (e: React.PointerEvent) => {
    const el = containerRef.current;
    if (!el) return;

    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);

    const rect = el.getBoundingClientRect();

    const bodyCursor = document.body.style.cursor;
    const bodyUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

    const onMove = (ev: PointerEvent) => {
      const next = clamp(ev.clientX - rect.left, sizes.left.min, sizes.left.max);
      setLeftWidth(next);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = bodyCursor;
      document.body.style.userSelect = bodyUserSelect;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const beginRightDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);

    const rightEdge = rightPanelRef.current?.getBoundingClientRect().right ?? 0;

    const bodyCursor = document.body.style.cursor;
    const bodyUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      const next = Math.max(sizes.right.min, rightEdge - ev.clientX);
      setRightPanelWidth(next);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = bodyCursor;
      document.body.style.userSelect = bodyUserSelect;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  useEffect(() => {
    document.getElementsByTagName("html")[0].className =
      darkMode === "dark" ? "dark bg-primary" : "light bg-primary";
  }, [darkMode]);

  const panelShellClass =
    darkMode === "dark"
      ? "bg-[#0d1117]/72 backdrop-blur-md shadow-modern-lg"
      : "bg-white/90 border border-gray-200/70 backdrop-blur-md";

  const leftMenu = (
    <LeftMenu
      isSidebarOpen={isCompact ? true : isSidebarOpen}
      activeSubMenuItem={activeSubMenuItem}
      onSubMenuChange={onSubMenuChange}
      onClose={onToggleSidebar}
      showAdminNav={showAdminNav}
      historyContent={leftMenuHistory}
      onNewSession={onNewSession}
      skillsSubTab={skillsSubTab}
      onSkillsSubTabChange={onSkillsSubTabChange}
    />
  );

  const resizeHandleClass = `w-1 rounded-full transition-colors flex-shrink-0 ${darkMode === "dark"
      ? "bg-white/5 hover:bg-white/20"
      : "bg-gray-200/60 hover:bg-gray-300/80"
    }`;

  const rightPanel = (
    <div className="flex h-full">
      {isRightPanelOpen && !isCompact && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("applayout.resize.left")}
          onPointerDown={beginRightDrag}
          className={resizeHandleClass}
          style={{ cursor: "col-resize", touchAction: "none" }}
        />
      )}

      <div ref={rightPanelRef} className="h-full">
        <UnifiedRightPanel
          isCompact={isCompact}
          isDocMasterAgent={isDocMasterAgent}
          activeSubMenuItem={activeSubMenuItem}
          templatesContent={rightPanelTemplates}
          guanlianyewuContent={rightPanelGuanlianyewu}
          zongheCailiaoContent={rightPanelZongheCailiao}
          onTryGuanlianyewu={onTryGuanlianyewu}
          onTryZonghe={onTryZonghe}
        />
      </div>
    </div>
  );

  const openRightPanel = () => {
    if (isCompact && isSidebarOpen) onToggleSidebar();
    setRightPanelOpen(true);
  };

  return (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 12,
          colorBgBase: darkMode === "dark" ? "#0d1117" : "#ffffff",
        },
        algorithm: darkMode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
      }}
    >
      <div className="h-screen flex flex-col bg-primary overflow-hidden relative">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className={`absolute -top-24 -left-20 h-72 w-72 rounded-full blur-3xl ${darkMode === "dark" ? "bg-violet-500/10" : "bg-violet-400/20"
              }`}
          />
          <div
            className={`absolute -bottom-28 right-6 h-80 w-80 rounded-full blur-3xl ${darkMode === "dark" ? "bg-blue-500/10" : "bg-cyan-300/25"
              }`}
          />
        </div>

        <TopNav isSidebarOpen={isSidebarOpen} onToggleSidebar={onToggleSidebar} />

        <div
          ref={containerRef}
          className={`flex-1 flex overflow-hidden relative z-10 ${isCompact ? "p-1 gap-0" : "p-2 gap-2"
            }`}
        >
          {/* Left: desktop inline */}
          {!isCompact && (
            <>
              <div
                className={`flex-shrink-0 h-full transition-all duration-300 overflow-hidden shadow-modern ${isSidebarOpen ? "rounded-2xl" : "rounded-lg"
                  } ${panelShellClass}`}
                style={{ width: isSidebarOpen ? leftWidth : sizes.left.collapsed }}
              >
                {leftMenu}
              </div>

              {isSidebarOpen && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t("applayout.resize.left")}
                  onPointerDown={beginLeftDrag}
                  className={`w-1 rounded-full transition-colors ${darkMode === "dark"
                      ? "bg-white/5 hover:bg-white/12"
                      : "bg-gray-200/60 hover:bg-gray-300/80"
                    }`}
                  style={{ cursor: "col-resize", touchAction: "none" }}
                />
              )}
            </>
          )}

          {/* Center: canvas */}
          <div
            className={`flex-1 min-w-0 rounded-2xl shadow-modern overflow-hidden ${darkMode === "dark"
                ? "bg-[#0d1117]/70 backdrop-blur-md shadow-modern-lg"
                : "bg-white/85 border border-gray-200/70 backdrop-blur-md"
              }`}
          >
            <Canvas
              activeMenuId={activeSubMenuItem as MenuId}
              activeMenuLabel={activeMenuLabel}
              onNewSession={onNewSession}
              showNewSessionButton={showNewSessionButton}
              showRightPanelToggle={isCompact && showRightPanel && !isRightPanelOpen}
              onOpenRightPanel={openRightPanel}
              generatedFilesCount={generatedFilesCount}
              generatedFilesContent={generatedFilesContent}
            >
              {children}
            </Canvas>
          </div>

          {/* Right: desktop inline (resize handle lives inside rightPanel) */}
          {!isCompact && showRightPanel && rightPanel}
        </div>

        {/* Left: compact drawer */}
        {isCompact && isSidebarOpen && (
          <>
            <button
              type="button"
              aria-label={t("applayout.close.menu")}
              className="fixed inset-0 top-12 lg:top-14 z-40 bg-black/50"
              onClick={onToggleSidebar}
            />
            <div
              className={`fixed top-12 lg:top-14 left-0 bottom-0 z-50 w-[min(280px,85vw)] overflow-hidden shadow-modern rounded-r-2xl ${panelShellClass}`}
            >
              {leftMenu}
            </div>
          </>
        )}

        {/* Right: compact drawer */}
        {isCompact && showRightPanel && isRightPanelOpen && (
          <>
            <button
              type="button"
              aria-label={t("applayout.close.panel")}
              className="fixed inset-0 top-12 lg:top-14 z-40 bg-black/50"
              onClick={() => setRightPanelOpen(false)}
            />
            <div
              className={`fixed top-12 lg:top-14 right-0 bottom-0 z-50 w-[min(100%,420px)] overflow-hidden shadow-modern rounded-l-2xl ${panelShellClass}`}
            >
              {rightPanel}
            </div>
          </>
        )}

      </div>
    </ConfigProvider>
  );
};

export default AppLayout;
