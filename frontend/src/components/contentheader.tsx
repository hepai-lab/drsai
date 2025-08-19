import React from "react";
import { Plus, PanelLeftOpen } from "lucide-react";
import { Tooltip } from "antd";
import { appContext } from "../hooks/provider";
import { useConfigStore } from "../hooks/store";
import { Settings } from "lucide-react";
import SignInModal from "./signin";
import SettingsMenu from "./settings";

import { Button } from "./common/Button";
import UserProfileModal from "./userProfile";

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
  const { user } = React.useContext(appContext);
  useConfigStore();
  const [isEmailModalOpen, setIsEmailModalOpen] = React.useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);


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

        {/* User Profile and Settings */}
        <div className="flex items-center space-x-4">
          {/* User Profile */}
          {user && (
            <Tooltip title="用户信息">
              <div
                className="flex items-center space-x-2 cursor-pointer"
                // onClick={() => setIsEmailModalOpen(true)}
                onClick={() => setIsProfileModalOpen(true)}
              >
                {user.avatar_url ? (
                  <img
                    className="h-8 w-8 rounded-full"
                    src={user.avatar_url}
                    alt={user.name}
                  />
                ) : (
                  <div className="bg-blue-400 h-8 w-8 rounded-full flex items-center justify-center text-gray-800 font-semibold hover:text-message">
                    {user.name?.[0]}
                  </div>
                )}
              </div>
            </Tooltip>
          )}

          {/* Settings Button */}
          <div className="text-primary">
            <Tooltip title="Settings">
              <Button
                variant="tertiary"
                size="sm"
                icon={<Settings className="h-8 w-8" />}
                onClick={() => setIsSettingsOpen(true)}
                className="!px-0 transition-colors hover:text-accent"
                aria-label="Settings"
              />
            </Tooltip>
          </div>
        </div>
      </div>

      <SignInModal
        isVisible={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
      />
      <UserProfileModal
        isVisible={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        user={user || { name: '', email: '' }}
      />
      <SettingsMenu
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};

export default ContentHeader;
