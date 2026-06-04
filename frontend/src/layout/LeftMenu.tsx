import { Tooltip } from "antd";
import {
  Bot,
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  Grid2X2,
  Library,
  MessageSquare,
  Settings,
  UserCog,
  Users,
  ChevronDown,
  Wrench,
} from "lucide-react";
import React, { useContext, useEffect, useState } from "react";
import { appContext } from "../hooks/provider";
import { useLang } from "../i18n/useLang";

interface LeftMenuProps {
  isSidebarOpen: boolean;
  activeSubMenuItem: string;
  onSubMenuChange: (tabId: string) => void;
  onClose: () => void;
  /** Platform admin only: settings → 使用分析 / 用户管理 */
  showAdminNav?: boolean;
}

type SectionId = "chat" | "agents" | "settings";

const SECTIONS: { id: SectionId; icon: React.ReactNode; label: string; defaultItem: string }[] = [
  { id: "chat", icon: <MessageSquare className="w-3.5 h-3.5" />, label: "Chat", defaultItem: "current_session" },
  { id: "agents", icon: <Bot className="w-3.5 h-3.5" />, label: "Agents", defaultItem: "my_agents" },
  { id: "settings", icon: <Settings className="w-3.5 h-3.5" />, label: "Settings", defaultItem: "profile" },
];

const LeftMenu: React.FC<LeftMenuProps> = ({
  isSidebarOpen,
  activeSubMenuItem,
  onSubMenuChange,
  onClose,
  showAdminNav = false,
}) => {
  const { darkMode } = useContext(appContext);
  const { t } = useLang();
  const isDark = darkMode === "dark";

  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    chat: true,
    agents: false,
    settings: false,
  });

  useEffect(() => {
    if (["current_session"].includes(activeSubMenuItem)) {
      setExpanded((e) => ({ ...e, chat: true }));
    } else if (["my_agents", "agent_square", "skills_square", "library"].includes(activeSubMenuItem)) {
      setExpanded((e) => ({ ...e, agents: true }));
    } else if (
      ["profile", "channels", "logs", "usage_analytics", "user_management", "agent_management"].includes(
        activeSubMenuItem
      )
    ) {
      setExpanded((e) => ({ ...e, settings: true }));
    }
  }, [activeSubMenuItem]);

  const toggleSection = (id: SectionId) =>
    setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const SectionHeader = ({ id, icon }: { id: SectionId; icon: React.ReactNode }) => (
    <button
      type="button"
      onClick={() => toggleSection(id)}
      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-semibold tracking-wide text-secondary hover:text-primary hover:bg-tertiary/25 transition-colors"
    >
      <div className="flex items-center gap-2">
        {icon}
        <span>{t("leftmenu.section." + id)}</span>
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
        className={`relative w-full flex items-center gap-2.5 pl-7 pr-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${isActive
          ? "bg-accent/15 text-accent font-semibold shadow-sm"
          : "text-secondary hover:text-primary hover:bg-tertiary/25"
          }`}
      >
        {isActive && <span className="absolute left-3 h-4 w-0.5 rounded-full bg-accent" />}
        <span className="flex-shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
    );
  };

  // ── Collapsed strip ──
  // Map each section to the items it contains, for active highlight detection
  const SECTION_ITEMS: Record<SectionId, string[]> = {
    chat: ["current_session"],
    agents: ["my_agents", "agent_square", "skills_square", "library"],
    settings: [
      "profile",
      "channels",
      "logs",
      ...(showAdminNav ? ["usage_analytics", "user_management"] : []),
      "agent_management",
    ],
  };

  if (!isSidebarOpen) {
    return (
      <div className="flex flex-col items-center pt-1 h-full">
        {/* Expand button */}
        <button
          type="button"
          onClick={onClose}
          title={t("leftmenu.expand")}
          className={`flex items-center justify-center w-full h-8 transition-colors ${isDark
            ? "text-secondary hover:text-primary hover:bg-white/5"
            : "text-gray-400 hover:text-gray-600 hover:bg-gray-100/60"
            }`}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>

        {/* Section icons */}
        <div className="flex flex-col items-center gap-1 mt-2">
          {SECTIONS.map((s) => {
            const isSectionActive = SECTION_ITEMS[s.id].includes(activeSubMenuItem);
            return (
              <Tooltip key={s.id} title={t("leftmenu.section." + s.id)} placement="right">
                <button
                  type="button"
                  onClick={() => { onSubMenuChange(s.defaultItem); onClose(); }}
                  className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${isSectionActive
                    ? "text-accent bg-accent/10"
                    : isDark
                      ? "text-secondary hover:text-primary hover:bg-white/5"
                      : "text-gray-400 hover:text-gray-600 hover:bg-gray-100/60"
                    }`}
                >
                  {s.icon}
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Expanded ──
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 pt-3 flex items-center justify-end">
        <button
          type="button"
          onClick={onClose}
          title={t("leftmenu.collapse")}
          className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${isDark
            ? "text-secondary hover:text-primary hover:bg-white/5"
            : "text-gray-400 hover:text-gray-600 hover:bg-gray-100/60"
            }`}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto px-2 pt-2 pb-4 sidebar-scroll space-y-1">
        {/* ── 聊天 ── */}
        <div>
          <SectionHeader id="chat" icon={<MessageSquare className="w-3.5 h-3.5" />} />
          {expanded.chat && (
            <div className="mt-0.5 space-y-0.5">
              <NavItem
                id="current_session"
                icon={<MessageSquare className="w-3.5 h-3.5" />}
                label={t("leftmenu.section.chat")}
                onClick={() => onSubMenuChange("current_session")}
              />
            </div>
          )}
        </div>

        <div className="h-px bg-border-primary/25 my-1.5" />

        {/* ── 智能体 ── */}
        <div>
          <SectionHeader id="agents" icon={<Bot className="w-3.5 h-3.5" />} />
          {expanded.agents && (
            <div className="mt-0.5 space-y-0.5">
              {/* <NavItem
                id="my_agents"
                icon={<User className="w-3.5 h-3.5" />}
                label="我的智能体"
                onClick={() => onSubMenuChange("my_agents")}
              /> */}
              <NavItem
                id="agent_square"
                icon={<Grid2X2 className="w-3.5 h-3.5" />}
                label={t("leftmenu.nav.agentSquare")}
                onClick={() => onSubMenuChange("agent_square")}
              />
              <NavItem
                id="skills_square"
                icon={<Wrench className="w-3.5 h-3.5" />}
                label={t("leftmenu.nav.skillsSquare")}
                onClick={() => onSubMenuChange("skills_square")}
              />
              <NavItem
                id="library"
                icon={<Library className="w-3.5 h-3.5" />}
                label={t("leftmenu.nav.library")}
                onClick={() => onSubMenuChange("library")}
              />
            </div>
          )}
        </div>

        <div className="h-px bg-border-primary/25 my-1.5" />

        {/* ── 设置 ── */}
        <div>
          <SectionHeader id="settings" icon={<Settings className="w-3.5 h-3.5" />} />
          {expanded.settings && (
            <div className="mt-0.5 space-y-0.5">
              <NavItem
                id="profile"
                icon={<UserCog className="w-3.5 h-3.5" />}
                label={t("leftmenu.nav.profile")}
                onClick={() => onSubMenuChange("profile")}
              />
              {showAdminNav ? (
                <>
                  <NavItem
                    id="usage_analytics"
                    icon={<ChartColumn className="w-3.5 h-3.5" />}
                    label={t("leftmenu.nav.usageAnalytics")}
                    onClick={() => onSubMenuChange("usage_analytics")}
                  />
                  <NavItem
                    id="user_management"
                    icon={<Users className="w-3.5 h-3.5" />}
                    label={t("leftmenu.nav.userManagement")}
                    onClick={() => onSubMenuChange("user_management")}
                  />
                </>
              ) : null}
              {/* <NavItem
                id="channels"
                icon={<Radio className="w-3.5 h-3.5" />}
                label="频道"
                onClick={() => onSubMenuChange("channels")}
              /> */}
              {/* <NavItem
                id="logs"
                icon={<FileText className="w-3.5 h-3.5" />}
                label="日志"
                onClick={() => onSubMenuChange("logs")}
              /> */}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LeftMenu;
