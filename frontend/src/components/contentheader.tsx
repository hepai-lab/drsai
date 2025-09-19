import React, { useEffect } from "react";
import { Plus, PanelLeftOpen } from "lucide-react";
import { Tooltip } from "antd";
import { useConfigStore } from "../hooks/store";
import { useModeConfigStore } from "../store/modeConfig";

import { Button } from "./common/Button";

type ContentHeaderProps = {
  onMobileMenuToggle: () => void;
  isMobileMenuOpen: boolean;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNewSession: () => void;

  agentSelector?: React.ReactNode;
  activeSubMenuItem?: string;
};


const ContentHeader = ({
  isSidebarOpen,
  onToggleSidebar,
  onNewSession,
  agentSelector,
  activeSubMenuItem,
}: ContentHeaderProps) => {
  useConfigStore();
  const { selectedAgent } = useModeConfigStore();

  useEffect(() => {
    console.log("selectedAgent", selectedAgent);
  }, [selectedAgent]);

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
            <div className="relative z-[9999] mr-2">
              {agentSelector}
            </div>
          )}
          {/* Current Agent Name - only show in Current Session tab */}
          {activeSubMenuItem === "current_session" && selectedAgent?.name && (
            <div className="ml-2 px-2 py-1 rounded-md text-lg text-accent bg-tertiary/30">
              <div className="ml-2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-tertiary/30  ">

                <span className="text-lg font-medium">
                  {selectedAgent.name}
                </span>
              </div>
            </div>
          )}
        </div>

      </div>


    </div>
  );
};

export default ContentHeader;
