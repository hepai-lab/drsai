export const MENU_IDS = {
  currentSession: "current_session",
  myAgents: "my_agents",
  agentSquare: "agent_square",
  savedPlan: "saved_plan",
  results: "results",
  skillsSquare: "skills_square",
  plugins: "plugins",
  library: "library",
  approvalCenter: "approval_center",
  profile: "profile",
  usageAnalytics: "usage_analytics",
  channels: "channels",
  logs: "logs",
  agentManagement: "agent_management",
  userManagement: "user_management",
} as const;

export type NavId = (typeof MENU_IDS)[keyof typeof MENU_IDS];

export type RightTab =
  | "files"
  | "templates"
  | "browser"
  | "terminal"
  | "debug";
export type AppLanguage = "en" | "zh";

export const MENU_LABELS: Record<AppLanguage, Record<NavId, string>> = {
  zh: {
    [MENU_IDS.results]: "成果库",
    [MENU_IDS.approvalCenter]: "审批中心",
    [MENU_IDS.currentSession]: "当前会话",
    [MENU_IDS.myAgents]: "我的智能体",
    [MENU_IDS.agentSquare]: "智能体",
    [MENU_IDS.savedPlan]: "已保存计划",
    [MENU_IDS.skillsSquare]: "Skills",
    [MENU_IDS.plugins]: "插件",
    [MENU_IDS.library]: "GFS 云盘",
    [MENU_IDS.profile]: "设置",
    [MENU_IDS.usageAnalytics]: "使用分析",
    [MENU_IDS.channels]: "频道",
    [MENU_IDS.logs]: "日志",
    [MENU_IDS.agentManagement]: "智能体管理",
    [MENU_IDS.userManagement]: "用户管理",
  },
  en: {
    [MENU_IDS.results]: "Results Library",
    [MENU_IDS.currentSession]: "Chat",
    [MENU_IDS.myAgents]: "My Agents",
    [MENU_IDS.agentSquare]: "Agents",
    [MENU_IDS.savedPlan]: "Saved Plans",
    [MENU_IDS.skillsSquare]: "Skills",
    [MENU_IDS.plugins]: "Plugins",
    [MENU_IDS.library]: "GFS Storage",
    [MENU_IDS.approvalCenter]: "Approval Center",
    [MENU_IDS.profile]: "Settings",
    [MENU_IDS.usageAnalytics]: "Usage Analytics",
    [MENU_IDS.channels]: "Channels",
    [MENU_IDS.logs]: "Logs",
    [MENU_IDS.agentManagement]: "Agent Management",
    [MENU_IDS.userManagement]: "User Management",
  },
};

export interface NavItem {
  id: NavId;
  label: string;
  enabled: boolean;
}

export interface NavSection {
  id: "chat" | "agents" | "workspace" | "admin" | "settings";
  label: string;
  items: NavItem[];
}

const sectionLabels: Record<AppLanguage, Record<NavSection["id"], string>> = {
  zh: {
    chat: "会话",
    agents: "广场",
    workspace: "工作区",
    admin: "管理",
    settings: "设置",
  },
  en: {
    chat: "Chat",
    agents: "Square",
    workspace: "Workspace",
    admin: "Admin",
    settings: "Settings",
  },
};

const navDefinitions: Array<{
  id: NavSection["id"];
  items: Array<{ id: NavId; enabled: boolean }>;
}> = [
  {
    id: "chat",
    items: [
      { id: MENU_IDS.currentSession, enabled: true },
      { id: MENU_IDS.results, enabled: true },
    ],
  },
  {
    id: "workspace",
    items: [
      { id: MENU_IDS.skillsSquare, enabled: true },
      { id: MENU_IDS.library, enabled: true },
      { id: MENU_IDS.approvalCenter, enabled: false },
      { id: MENU_IDS.usageAnalytics, enabled: false },
      { id: MENU_IDS.channels, enabled: false },
      { id: MENU_IDS.logs, enabled: false },
    ],
  },
  // Settings stays reachable from the titlebar user menu, not the primary sidebar.
  {
    id: "settings",
    items: [{ id: MENU_IDS.profile, enabled: false }],
  },
];

export function getNavSections(language: AppLanguage): NavSection[] {
  return navDefinitions.map((section) => ({
    id: section.id,
    label: sectionLabels[language][section.id],
    items: section.items.map((item) => ({
      ...item,
      label: MENU_LABELS[language][item.id],
    })),
  }));
}

export function getNavItems(language: AppLanguage): NavItem[] {
  return getNavSections(language).flatMap((section) =>
    section.items.filter((item) => item.enabled),
  );
}

const rightTabLabels: Record<AppLanguage, Record<RightTab, string>> = {
  zh: {
    debug: "调试",
    files: "文件",
    templates: "模板",
    browser: "浏览器",
    terminal: "终端",
  },
  en: {
    files: "Files",
    templates: "Templates",
    browser: "Browser",
    terminal: "Terminal",
    debug: "Debug",
  },
};

export function getRightTabs(
  language: AppLanguage,
): Array<{ id: RightTab; label: string }> {
  return (
    ["files", "browser", "terminal", "debug"] as RightTab[]
  ).map((id) => ({
    id,
    label: rightTabLabels[language][id],
  }));
}

export const navSections: NavSection[] = getNavSections("zh");
export const navItems: NavItem[] = getNavItems("zh");
export const rightTabs: Array<{ id: RightTab; label: string }> =
  getRightTabs("zh");
