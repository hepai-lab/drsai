import { ConfigProvider, theme } from "antd";
import "antd/dist/reset.css";
import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { appContext } from "../hooks/provider";
import { useIsCompactLayout } from "../hooks/useMediaQuery";
import TopNav from "./TopNav";
import LeftMenu from "./LeftMenu";
import Canvas from "./Canvas";
import RightPanel from "./RightPanel";
import { CanvasViewId } from "../components/views/menuRoutes";
import { useRightPanelStore } from "../store/rightPanel";

interface AppLayoutProps {
  // TopNav
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;

  // LeftMenu
  activeSubMenuItem: string;
  activeMenuLabel: string;
  onSubMenuChange: (tabId: string) => void;
  showUsageAnalyticsNav?: boolean;

  // RightPanel
  rightPanelWidth?: number;
  rightPanelHistory?: React.ReactNode;
  rightPanelFiles?: React.ReactNode;
  onRightPanelTabChange?: (tab: "overview" | "history" | "files") => void;

  // Canvas
  children: React.ReactNode;
  canvasActiveView: CanvasViewId;
  onCanvasViewChange: (view: CanvasViewId) => void;
  canvasFilePreviewContent?: React.ReactNode;
  onNewSession?: () => void;
  showNewSessionButton?: boolean;
}

const AppLayout: React.FC<AppLayoutProps> = ({
  isSidebarOpen,
  onToggleSidebar,
  activeSubMenuItem,
  activeMenuLabel,
  onSubMenuChange,
  showUsageAnalyticsNav = false,
  rightPanelWidth = 380,
  rightPanelHistory,
  rightPanelFiles,
  onRightPanelTabChange,
  children,
  canvasActiveView,
  onCanvasViewChange,
  canvasFilePreviewContent,
  onNewSession,
  showNewSessionButton = false,
}) => {
  const { darkMode } = useContext(appContext);
  const isCompact = useIsCompactLayout();
  const rightPanelIsOpen = useRightPanelStore((s) => s.isOpen);
  const setRightPanelOpen = useRightPanelStore((s) => s.setIsOpen);

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
        collapsed: 40,
        min: 280,
        max: 720,
        defaultOpen: rightPanelWidth,
        storageKey: "drsai:layout:rightWidth",
      },
    }),
    [rightPanelWidth]
  );

  const [leftWidth, setLeftWidth] = useState<number>(sizes.left.defaultOpen);
  const [rightWidth, setRightWidth] = useState<number>(sizes.right.defaultOpen);

  useEffect(() => {
    try {
      const leftRaw = localStorage.getItem(sizes.left.storageKey);
      const rightRaw = localStorage.getItem(sizes.right.storageKey);
      if (leftRaw) {
        const v = Number(leftRaw);
        if (Number.isFinite(v)) setLeftWidth(Math.min(sizes.left.max, Math.max(sizes.left.min, v)));
      }
      if (rightRaw) {
        const v = Number(rightRaw);
        if (Number.isFinite(v)) setRightWidth(Math.min(sizes.right.max, Math.max(sizes.right.min, v)));
      }
    } catch {
      // ignore
    }
  }, [sizes.left.max, sizes.left.min, sizes.left.storageKey, sizes.right.max, sizes.right.min, sizes.right.storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(sizes.left.storageKey, String(leftWidth));
    } catch {
      // ignore
    }
  }, [leftWidth, sizes.left.storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(sizes.right.storageKey, String(rightWidth));
    } catch {
      // ignore
    }
  }, [rightWidth, sizes.right.storageKey]);

  const beginDrag = (e: React.PointerEvent, side: "left" | "right") => {
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
      if (side === "left") {
        const next = clamp(ev.clientX - rect.left, sizes.left.min, sizes.left.max);
        setLeftWidth(next);
      } else {
        const next = clamp(rect.right - ev.clientX, sizes.right.min, sizes.right.max);
        setRightWidth(next);
      }
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
      showUsageAnalyticsNav={showUsageAnalyticsNav}
    />
  );

  const rightPanel = (
    <RightPanel
      isCompact={isCompact}
      width={isCompact ? undefined : rightWidth}
      historyContent={rightPanelHistory}
      filesContent={rightPanelFiles}
      onTabChange={onRightPanelTabChange}
    />
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
            className={`absolute -top-24 -left-20 h-72 w-72 rounded-full blur-3xl ${
              darkMode === "dark" ? "bg-violet-500/10" : "bg-violet-400/20"
            }`}
          />
          <div
            className={`absolute -bottom-28 right-6 h-80 w-80 rounded-full blur-3xl ${
              darkMode === "dark" ? "bg-blue-500/10" : "bg-cyan-300/25"
            }`}
          />
        </div>

        <TopNav isSidebarOpen={isSidebarOpen} onToggleSidebar={onToggleSidebar} />

        <div
          ref={containerRef}
          className={`flex-1 flex overflow-hidden relative z-10 ${
            isCompact ? "p-1 gap-0" : "p-2 gap-2"
          }`}
        >
          {/* Left: desktop inline */}
          {!isCompact && (
            <>
              <div
                className={`flex-shrink-0 h-full transition-all duration-300 overflow-hidden shadow-modern ${
                  isSidebarOpen ? "rounded-2xl" : "rounded-lg"
                } ${panelShellClass}`}
                style={{ width: isSidebarOpen ? leftWidth : sizes.left.collapsed }}
              >
                {leftMenu}
              </div>

              {isSidebarOpen && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="调整左侧栏宽度"
                  onPointerDown={(e) => beginDrag(e, "left")}
                  className={`w-1 rounded-full transition-colors ${
                    darkMode === "dark"
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
            className={`flex-1 min-w-0 rounded-2xl shadow-modern overflow-hidden ${
              darkMode === "dark"
                ? "bg-[#0d1117]/70 backdrop-blur-md shadow-modern-lg"
                : "bg-white/85 border border-gray-200/70 backdrop-blur-md"
            }`}
          >
            <Canvas
              activeView={canvasActiveView}
              activeMenuLabel={activeMenuLabel}
              onViewChange={onCanvasViewChange}
              filePreviewContent={canvasFilePreviewContent}
              onNewSession={onNewSession}
              showNewSessionButton={showNewSessionButton}
              showRightPanelToggle={isCompact && !rightPanelIsOpen}
              onOpenRightPanel={openRightPanel}
            >
              {children}
            </Canvas>
          </div>

          {/* Right: desktop inline */}
          {!isCompact && (
            <>
              {rightPanelIsOpen && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="调整右侧栏宽度"
                  onPointerDown={(e) => beginDrag(e, "right")}
                  className={`w-1 rounded-full transition-colors ${
                    darkMode === "dark"
                      ? "bg-white/5 hover:bg-white/12"
                      : "bg-gray-200/60 hover:bg-gray-300/80"
                  }`}
                  style={{ cursor: "col-resize", touchAction: "none" }}
                />
              )}
              {rightPanel}
            </>
          )}
        </div>

        {/* Left: compact drawer */}
        {isCompact && isSidebarOpen && (
          <>
            <button
              type="button"
              aria-label="关闭导航菜单"
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
        {isCompact && rightPanelIsOpen && (
          <>
            <button
              type="button"
              aria-label="关闭侧面板"
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
