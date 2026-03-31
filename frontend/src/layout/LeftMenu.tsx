import { Tooltip } from "antd";
import {
  Bot,
  BotMessageSquare,
  ChevronDown,
  ChevronRight,
  FileText,
  Grid2X2,
  MessageSquare,
  PanelLeftClose,
  Radio,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  Zap,
} from "lucide-react";
import React, { useContext, useEffect, useState } from "react";
import { appContext } from "../hooks/provider";
import { Button } from "../components/common/Button";
import UserProfileModal from "../components/userProfile";

interface LeftMenuProps {
  activeSubMenuItem: string;
  onSubMenuChange: (tabId: string) => void;
  onClose: () => void;
}

type SectionId = "chat" | "agents" | "settings" | "admin";

const LeftMenu: React.FC<LeftMenuProps> = ({
  activeSubMenuItem,
  onSubMenuChange,
  onClose,
}) => {
  const { darkMode, user } = useContext(appContext);
  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    chat: true,
    agents: false,
    settings: false,
    admin: false,
  });
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Auto-expand section containing the active item
  useEffect(() => {
    if (["current_session"].includes(activeSubMenuItem)) {
      setExpanded((e) => ({ ...e, chat: true }));
    } else if (["my_agents", "agent_square", "skills_square"].includes(activeSubMenuItem)) {
      setExpanded((e) => ({ ...e, agents: true }));
    } else if (["channels", "logs"].includes(activeSubMenuItem)) {
      setExpanded((e) => ({ ...e, settings: true }));
    } else if (["agent_management", "user_management"].includes(activeSubMenuItem)) {
      setExpanded((e) => ({ ...e, admin: true }));
    }
  }, [activeSubMenuItem]);

  const toggleSection = (id: SectionId) =>
    setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const SectionHeader = ({
    id,
    icon,
    label,
  }: {
    id: SectionId;
    icon: React.ReactNode;
    label: string;
  }) => (
    <button
      type="button"
      onClick={() => toggleSection(id)}
      className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider text-secondary hover:text-primary hover:bg-tertiary/20 transition-colors"
    >
      <div className="flex items-center gap-2">
        {icon}
        <span>{label}</span>
      </div>
      {expanded[id] ? (
        <ChevronDown className="w-3.5 h-3.5" />
      ) : (
        <ChevronRight className="w-3.5 h-3.5" />
      )}
    </button>
  );

  const NavItem = ({
    id,
    icon,
    label,
    onClick,
  }: {
    id?: string;
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
  }) => {
    const isActive = id ? activeSubMenuItem === id : false;
    return (
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex items-center gap-2.5 pl-7 pr-3 py-1.5 rounded-lg text-sm transition-colors ${
          isActive
            ? "bg-accent/10 text-accent font-medium"
            : "text-secondary hover:text-primary hover:bg-tertiary/20"
        }`}
      >
        <span className="flex-shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
    );
  };

  return (
    <>
      <div
        className={`h-full flex flex-col ${
          darkMode === "dark" ? "bg-[#0f0f0f]" : "bg-gray-50/90"
        }`}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-end px-2 pt-2 pb-1">
          <Tooltip title="Close Sidebar">
            <Button
              variant="tertiary"
              size="sm"
              icon={<PanelLeftClose strokeWidth={1.5} className="h-4 w-4" />}
              onClick={onClose}
              className="!px-1 transition-colors hover:text-accent"
            />
          </Tooltip>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto px-2 pb-4 sidebar-scroll space-y-0.5">
          {/* ── 聊天 ── */}
          <div>
            <SectionHeader
              id="chat"
              icon={<MessageSquare className="w-3.5 h-3.5" />}
              label="聊天"
            />
            {expanded.chat && (
              <div className="mt-0.5 space-y-0.5">
                <NavItem
                  id="current_session"
                  icon={<MessageSquare className="w-3.5 h-3.5" />}
                  label="聊天"
                  onClick={() => onSubMenuChange("current_session")}
                />
              </div>
            )}
          </div>

          <div className="h-px bg-border-primary/20 my-1" />

          {/* ── 智能体 ── */}
          <div>
            <SectionHeader
              id="agents"
              icon={<Bot className="w-3.5 h-3.5" />}
              label="智能体"
            />
            {expanded.agents && (
              <div className="mt-0.5 space-y-0.5">
                <NavItem
                  id="my_agents"
                  icon={<User className="w-3.5 h-3.5" />}
                  label="我的智能体"
                  onClick={() => onSubMenuChange("my_agents")}
                />
                <NavItem
                  id="agent_square"
                  icon={<Grid2X2 className="w-3.5 h-3.5" />}
                  label="智能体广场"
                  onClick={() => onSubMenuChange("agent_square")}
                />
                <NavItem
                  id="skills_square"
                  icon={<Zap className="w-3.5 h-3.5" />}
                  label="技能广场"
                  onClick={() => onSubMenuChange("skills_square")}
                />
              </div>
            )}
          </div>

          <div className="h-px bg-border-primary/20 my-1" />

          {/* ── 设置 ── */}
          <div>
            <SectionHeader
              id="settings"
              icon={<Settings className="w-3.5 h-3.5" />}
              label="设置"
            />
            {expanded.settings && (
              <div className="mt-0.5 space-y-0.5">
                <NavItem
                  icon={<UserCog className="w-3.5 h-3.5" />}
                  label="个人设置"
                  onClick={() => setIsProfileModalOpen(true)}
                />
                <NavItem
                  id="channels"
                  icon={<Radio className="w-3.5 h-3.5" />}
                  label="频道"
                  onClick={() => onSubMenuChange("channels")}
                />
                <NavItem
                  id="logs"
                  icon={<FileText className="w-3.5 h-3.5" />}
                  label="日志"
                  onClick={() => onSubMenuChange("logs")}
                />
              </div>
            )}
          </div>

          <div className="h-px bg-border-primary/20 my-1" />

          {/* ── 管理员 ── */}
          <div>
            <SectionHeader
              id="admin"
              icon={<Shield className="w-3.5 h-3.5" />}
              label="管理员"
            />
            {expanded.admin && (
              <div className="mt-0.5 space-y-0.5">
                <NavItem
                  id="agent_management"
                  icon={<BotMessageSquare className="w-3.5 h-3.5" />}
                  label="智能体管理"
                  onClick={() => onSubMenuChange("agent_management")}
                />
                <NavItem
                  id="user_management"
                  icon={<Users className="w-3.5 h-3.5" />}
                  label="用户管理"
                  onClick={() => onSubMenuChange("user_management")}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <UserProfileModal
        isVisible={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        user={user || { name: "", email: "" }}
      />
    </>
  );
};

export default LeftMenu;
