import { ConfigProvider, theme } from "antd";
import "antd/dist/reset.css";
import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { appContext } from "../hooks/provider";
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
  // TopNav
  isSidebarOpen,
  onToggleSidebar,

  // LeftMenu
  activeSubMenuItem,
  activeMenuLabel,
  onSubMenuChange,

  // RightPanel
  rightPanelWidth = 380,
  rightPanelHistory,
  rightPanelFiles,
  onRightPanelTabChange,

  // Canvas
  children,
  canvasActiveView,
  onCanvasViewChange,
  canvasFilePreviewContent,
  onNewSession,
  showNewSessionButton = false,
}) => {
  const { darkMode } = useContext(appContext);
  const rightPanelIsOpen = useRightPanelStore((s) => s.isOpen);

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

  return (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 12,
          colorBgBase: darkMode === "dark" ? "#0d1117" : "#ffffff",
        },
        algorithm:
          darkMode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
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
        {/* Top: Navigation */}
        <TopNav
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={onToggleSidebar}
        />

        {/* Bottom: three columns */}
        <div ref={containerRef} className="flex-1 flex overflow-hidden p-2 gap-2 relative z-10">
          {/* Left: menu */}
          <div
            className={`flex-shrink-0 h-full transition-all duration-300 overflow-hidden shadow-modern ${isSidebarOpen ? "rounded-2xl" : "rounded-lg"
              } ${darkMode === "dark"
                ? "bg-[#0d1117]/72 backdrop-blur-md shadow-modern-lg"
                : "bg-white/90 border border-gray-200/70 backdrop-blur-md"
              }`}
            style={{ width: isSidebarOpen ? leftWidth : sizes.left.collapsed }}
          >
            <LeftMenu
              isSidebarOpen={isSidebarOpen}
              activeSubMenuItem={activeSubMenuItem}
              onSubMenuChange={onSubMenuChange}
              onClose={onToggleSidebar}
            />
          </div>

          {/* Drag handle: left */}
          {isSidebarOpen && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整左侧栏宽度"
              onPointerDown={(e) => beginDrag(e, "left")}
              className={`w-1 rounded-full transition-colors ${darkMode === "dark" ? "bg-white/5 hover:bg-white/12" : "bg-gray-200/60 hover:bg-gray-300/80"
                }`}
              style={{ cursor: "col-resize", touchAction: "none" }}
            />
          )}

          {/* Center: canvas */}
          <div
            className={`flex-1 min-w-0 rounded-2xl shadow-modern overflow-hidden ${darkMode === "dark"
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
            >
              {children}
            </Canvas>
          </div>

          {/* Drag handle: right */}
          {rightPanelIsOpen && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整右侧栏宽度"
              onPointerDown={(e) => beginDrag(e, "right")}
              className={`w-1 rounded-full transition-colors ${darkMode === "dark" ? "bg-white/5 hover:bg-white/12" : "bg-gray-200/60 hover:bg-gray-300/80"
                }`}
              style={{ cursor: "col-resize", touchAction: "none" }}
            />
          )}

          {/* Right: panel — isOpen controlled by useRightPanelStore */}
          <RightPanel
            width={rightWidth}
            historyContent={rightPanelHistory}
            filesContent={rightPanelFiles}
            onTabChange={onRightPanelTabChange}
          />
        </div>
      </div>
    </ConfigProvider>
  );
};

export default AppLayout;
