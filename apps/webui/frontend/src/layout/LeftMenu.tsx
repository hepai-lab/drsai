import { Tooltip } from "antd";
import {
  BookmarkPlus,
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cloud,
  Globe,
  Grid2X2,
  MessageSquare,
  ChevronDown,
  Settings,
  Upload,
  UserCog,
  Users,
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
  /** Platform admin only: settings -> 使用分析 / 用户管理 */
  showAdminNav?: boolean;
  /** 历史会话列表（从 manager.tsx 传入） */
  historyContent?: React.ReactNode;
  /** 点击"开始聊天"创建新会话 */
  onNewSession?: () => void;
  /** 技能广场当前子页签 */
  skillsSubTab?: string;
  /** 技能广场子页签切换 */
  onSkillsSubTabChange?: (tabId: string) => void;
}

type SectionId = "chat" | "skills" | "settings" | "history";

const SECTIONS: { id: SectionId; icon: React.ReactNode; label: string; defaultItem: string }[] = [
  { id: "chat", icon: <MessageSquare className="w-3.5 h-3.5" />, label: "Chat", defaultItem: "current_session" },
  { id: "history", icon: <Clock className="w-3.5 h-3.5" />, label: "History", defaultItem: "" },
  { id: "settings", icon: <Settings className="w-3.5 h-3.5" />, label: "Settings", defaultItem: "profile" },
];

// 技能广场子菜单 ID
const SKILLS_SUB_MENU_IDS = {
  skillsPublic: "skills_public",
  skillsMyCreations: "skills_my_creations",
  skillsMyCollections: "skills_my_collections",
  skillsPublish: "skills_publish",
};

const LeftMenu: React.FC<LeftMenuProps> = ({
  isSidebarOpen,
  activeSubMenuItem,
  onSubMenuChange,
  onClose,
  showAdminNav = false,
  historyContent,
  onNewSession,
  skillsSubTab,
  onSkillsSubTabChange,
}) => {
  const { darkMode } = useContext(appContext);
  const { t } = useLang();
  const isDark = darkMode === "dark";

  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    chat: true,
    settings: false,
    history: true,
    skills: true,
  });

  useEffect(() => {
    if (["current_session"].includes(activeSubMenuItem)) {
      setExpanded((e) => ({ ...e, chat: true }));
    } else if (historyContent) {
      setExpanded((e) => ({ ...e, history: true }));
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
        <span>{t(("leftmenu.section." + id) as Parameters<typeof t>[0])}</span>
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

  const isSkillsActive = activeSubMenuItem === "skills_square";
  const isSkillsSubActive = (subId: string) => isSkillsActive && skillsSubTab === subId;

  // ── Collapsed strip ──
  const SECTION_ITEMS: Record<SectionId, string[]> = {
    chat: ["current_session"],
    settings: [
      "profile",
      "channels",
      "logs",
      ...(showAdminNav ? ["usage_analytics", "user_management"] : []),
      "agent_management",
    ],
    history: [],
    skills: [],
  };

  if (!isSidebarOpen) {
    return (
      <div className="flex flex-col items-center pt-1 h-full">
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

        <div className="flex flex-col items-center gap-1 mt-2">
          {(["chat"] as SectionId[]).map((id) => {
            const s = SECTIONS.find((x) => x.id === id)!;
            const isSectionActive = SECTION_ITEMS[s.id].includes(activeSubMenuItem);
            return (
              <Tooltip key={s.id} title={t(("leftmenu.section." + s.id) as Parameters<typeof t>[0])} placement="right">
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

          <Tooltip title={t("leftmenu.nav.agentSquare")} placement="right">
            <button
              type="button"
              onClick={() => { onSubMenuChange("agent_square"); onClose(); }}
              className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${activeSubMenuItem === "agent_square"
                ? "text-accent bg-accent/10"
                : isDark
                  ? "text-secondary hover:text-primary hover:bg-white/5"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-100/60"
                }`}
            >
              <Grid2X2 className="w-3.5 h-3.5" />
            </button>
          </Tooltip>

          <Tooltip title={t("leftmenu.nav.skillsSquare")} placement="right">
            <button
              type="button"
              onClick={() => { onSubMenuChange("skills_square"); onClose(); }}
              className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${isSkillsActive
                ? "text-accent bg-accent/10"
                : isDark
                  ? "text-secondary hover:text-primary hover:bg-white/5"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-100/60"
                }`}
            >
              <Wrench className="w-3.5 h-3.5" />
            </button>
          </Tooltip>

          <Tooltip title={t("leftmenu.section.files")} placement="right">
            <button
              type="button"
              onClick={() => { onSubMenuChange("cloud"); onClose(); }}
              className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${activeSubMenuItem === "cloud"
                ? "text-accent bg-accent/10"
                : isDark
                  ? "text-secondary hover:text-primary hover:bg-white/5"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-100/60"
                }`}
            >
              <Cloud className="w-3.5 h-3.5" />
            </button>
          </Tooltip>

          {(["history", "settings"] as SectionId[]).map((id) => {
            const s = SECTIONS.find((x) => x.id === id)!;
            const isSectionActive = SECTION_ITEMS[s.id].includes(activeSubMenuItem);
            return (
              <Tooltip key={s.id} title={t(("leftmenu.section." + s.id) as Parameters<typeof t>[0])} placement="right">
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

      {/* Nav — scrollable upper area */}
      <div className="flex-1 overflow-y-auto px-2 pt-2 sidebar-scroll space-y-1">
        {/* ── 开始聊天 ── */}
        <button
          type="button"
          onClick={() => {
            if (onNewSession) onNewSession();
          }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold tracking-wide transition-colors text-secondary hover:text-primary hover:bg-tertiary/25"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>{t("leftmenu.nav.startChat")}</span>
        </button>

        <div className="h-px bg-border-primary/25 my-1.5" />

        {/* ── 智能体广场 ── */}
        <div>
          <button
            type="button"
            onClick={() => onSubMenuChange("agent_square")}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold tracking-wide transition-colors ${activeSubMenuItem === "agent_square"
              ? "bg-accent/15 text-accent shadow-sm"
              : "text-secondary hover:text-primary hover:bg-tertiary/25"
            }`}
          >
            <Grid2X2 className="w-3.5 h-3.5" />
            <span>{t("leftmenu.nav.agentSquare")}</span>
          </button>
        </div>

        {/* ── 技能广场（可折叠，含子菜单） ── */}
        <div>
          <button
            type="button"
            onClick={() => {
              onSubMenuChange("skills_square");
              toggleSection("skills");
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-semibold tracking-wide transition-colors ${isSkillsActive
              ? "bg-accent/15 text-accent shadow-sm"
              : "text-secondary hover:text-primary hover:bg-tertiary/25"
            }`}
          >
            <div className="flex items-center gap-2">
              <Wrench className="w-3.5 h-3.5" />
              <span>{t("leftmenu.nav.skillsSquare")}</span>
            </div>
            {expanded.skills ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
          {expanded.skills && isSkillsActive && (
            <div className="mt-0.5 space-y-0.5">
              <button
                type="button"
                onClick={() => onSkillsSubTabChange?.(SKILLS_SUB_MENU_IDS.skillsPublic)}
                className={`relative w-full flex items-center gap-2.5 pl-7 pr-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${isSkillsSubActive(SKILLS_SUB_MENU_IDS.skillsPublic)
                  ? "bg-accent/15 text-accent font-semibold shadow-sm"
                  : "text-secondary hover:text-primary hover:bg-tertiary/25"
                  }`}
              >
                {isSkillsSubActive(SKILLS_SUB_MENU_IDS.skillsPublic) && <span className="absolute left-3 h-4 w-0.5 rounded-full bg-accent" />}
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t("skillSquare.allSkills")}</span>
              </button>
              <button
                type="button"
                onClick={() => onSkillsSubTabChange?.(SKILLS_SUB_MENU_IDS.skillsMyCreations)}
                className={`relative w-full flex items-center gap-2.5 pl-7 pr-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${isSkillsSubActive(SKILLS_SUB_MENU_IDS.skillsMyCreations)
                  ? "bg-accent/15 text-accent font-semibold shadow-sm"
                  : "text-secondary hover:text-primary hover:bg-tertiary/25"
                  }`}
              >
                {isSkillsSubActive(SKILLS_SUB_MENU_IDS.skillsMyCreations) && <span className="absolute left-3 h-4 w-0.5 rounded-full bg-accent" />}
                <Wrench className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t("skillSquare.myCreations")}</span>
              </button>
              <button
                type="button"
                onClick={() => onSkillsSubTabChange?.(SKILLS_SUB_MENU_IDS.skillsMyCollections)}
                className={`relative w-full flex items-center gap-2.5 pl-7 pr-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${isSkillsSubActive(SKILLS_SUB_MENU_IDS.skillsMyCollections)
                  ? "bg-accent/15 text-accent font-semibold shadow-sm"
                  : "text-secondary hover:text-primary hover:bg-tertiary/25"
                  }`}
              >
                {isSkillsSubActive(SKILLS_SUB_MENU_IDS.skillsMyCollections) && <span className="absolute left-3 h-4 w-0.5 rounded-full bg-accent" />}
                <BookmarkPlus className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t("skillSquare.myCollections")}</span>
              </button>
              <button
                type="button"
                onClick={() => onSkillsSubTabChange?.(SKILLS_SUB_MENU_IDS.skillsPublish)}
                className={`relative w-full flex items-center gap-2.5 pl-7 pr-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${isSkillsSubActive(SKILLS_SUB_MENU_IDS.skillsPublish)
                  ? "bg-accent/15 text-accent font-semibold shadow-sm"
                  : "text-secondary hover:text-primary hover:bg-tertiary/25"
                  }`}
              >
                {isSkillsSubActive(SKILLS_SUB_MENU_IDS.skillsPublish) && <span className="absolute left-3 h-4 w-0.5 rounded-full bg-accent" />}
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t("skillSquare.publishSkill")}</span>
              </button>
            </div>
          )}
        </div>

        <div className="h-px bg-border-primary/25 my-1.5" />

        {/* ── 云盘 ── */}
        <div>
          <button
            type="button"
            onClick={() => onSubMenuChange("cloud")}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold tracking-wide transition-colors ${activeSubMenuItem === "cloud"
              ? "bg-accent/15 text-accent shadow-sm"
              : "text-secondary hover:text-primary hover:bg-tertiary/25"
              }`}
          >
            <Cloud className="w-3.5 h-3.5" />
            <span>{t("leftmenu.section.files")}</span>
          </button>
        </div>

        <div className="h-px bg-border-primary/25 my-1.5" />

        {/* ── 历史会话 ── */}
        <div className="pb-2">
          <SectionHeader id="history" icon={<Clock className="w-3.5 h-3.5" />} />
          {expanded.history && historyContent && (
            <div className="mt-0.5 space-y-0.5">
              {historyContent}
            </div>
          )}
        </div>
      </div>

      {/* ── 设置 — fixed bottom ── */}
      <div className="flex-shrink-0  px-2 pt-1 pb-2">
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
              {showAdminNav && (
                <>
                  <div className="h-px bg-border-primary/15 my-1" />
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
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LeftMenu;