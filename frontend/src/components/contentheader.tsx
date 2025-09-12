import React from "react";
import { Plus, PanelLeftOpen } from "lucide-react";
import { Tooltip } from "antd";
import { useConfigStore } from "../hooks/store";

import { Button } from "./common/Button";

type ContentHeaderProps = {
  onMobileMenuToggle: () => void;
  isMobileMenuOpen: boolean;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNewSession: () => void;

  agentSelector?: React.ReactNode;
};


const ContentHeader = ({
  isSidebarOpen,
  onToggleSidebar,
  onNewSession,
  agentSelector,
}: ContentHeaderProps) => {
  useConfigStore();


  return (
    <div className="bg-primary z-[70] pr-4">
      <div className="flex h-16 items-center justify-between">
        {/* Left side: Sidebar Toggle, Agent Selector and New Session */}
        <div className="flex items-center">
          {/* Sidebar Toggle - only show when sidebar is closed */}
          {!isSidebarOpen && (
            <Tooltip title="Open Sidebar">
              <Button
                variant="tertiary"
                size="sm"
                icon={<PanelLeftOpen strokeWidth={1.5} className="h-5 w-5" />}
                onClick={onToggleSidebar}
                className="!px-1 transition-colors hover:text-accent mr-3"
              />
            </Tooltip>
          )}

          {/* New Session Button */}
          {!isSidebarOpen && (
            <Tooltip title="Create new session">
              <Button
                variant="tertiary"
                size="sm"
                icon={<Plus className="w-6 h-6" />}
                onClick={onNewSession}
                className="transition-colors hover:text-accent mr-4"
              />
            </Tooltip>
          )}

          {/* Agent Selector */}
          {agentSelector && (
            <div className="relative z-[9999]">
              {agentSelector}
            </div>
          )}
        </div>


      </div>


    </div>
  );
};

export default ContentHeader;
