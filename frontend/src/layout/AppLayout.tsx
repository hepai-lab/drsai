import { ConfigProvider, theme } from "antd";
import "antd/dist/reset.css";
import React, { useContext, useEffect } from "react";
import { appContext } from "../hooks/provider";
import TopNav from "./TopNav";
import LeftMenu from "./LeftMenu";
import Canvas from "./Canvas";
import RightPanel from "./RightPanel";

interface AppLayoutProps {
  // TopNav
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onLogoClick: () => void;

  // LeftMenu
  activeSubMenuItem: string;
  onSubMenuChange: (tabId: string) => void;

  // RightPanel
  rightPanelWidth?: number;
  rightPanelHistory?: React.ReactNode;
  rightPanelFiles?: React.ReactNode;

  // Canvas
  children: React.ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({
  // TopNav
  isSidebarOpen,
  onToggleSidebar,
  onLogoClick,

  // LeftMenu
  activeSubMenuItem,
  onSubMenuChange,

  // RightPanel
  rightPanelWidth = 380,
  rightPanelHistory,
  rightPanelFiles,

  // Canvas
  children,
}) => {
  const { darkMode } = useContext(appContext);

  useEffect(() => {
    document.getElementsByTagName("html")[0].className =
      darkMode === "dark" ? "dark bg-primary" : "light bg-primary";
  }, [darkMode]);

  return (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 12,
          colorBgBase: darkMode === "dark" ? "#0f0f0f" : "#ffffff",
        },
        algorithm:
          darkMode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
      }}
    >
      <div className="h-screen flex flex-col bg-primary overflow-hidden">
        {/* Top: Navigation */}
        <TopNav
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={onToggleSidebar}
          onLogoClick={onLogoClick}
        />

        {/* Bottom: three columns */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: menu */}
          <div
            className={`flex-shrink-0 h-full transition-all duration-300 overflow-hidden border-r ${
              darkMode === "dark"
                ? "bg-[#0f0f0f] border-border-primary/50"
                : "bg-gray-50/95 border-gray-200/50"
            } ${isSidebarOpen ? "w-56" : "w-0"}`}
          >
            <LeftMenu
              activeSubMenuItem={activeSubMenuItem}
              onSubMenuChange={onSubMenuChange}
              onClose={onToggleSidebar}
            />
          </div>

          {/* Center: canvas */}
          <Canvas onRootClick={onLogoClick}>{children}</Canvas>

          {/* Right: panel — isOpen controlled by useRightPanelStore */}
          <RightPanel
            width={rightPanelWidth}
            historyContent={rightPanelHistory}
            filesContent={rightPanelFiles}
          />
        </div>
      </div>
    </ConfigProvider>
  );
};

export default AppLayout;
