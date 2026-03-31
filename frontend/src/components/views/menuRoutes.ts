export const MENU_QUERY_KEY = "menu";
export const VIEW_QUERY_KEY = "view";

export const MENU_IDS = {
  currentSession: "current_session",
  myAgents: "my_agents",
  agentSquare: "agent_square",
  savedPlan: "saved_plan",
  skillsSquare: "skills_square",
  profile: "profile",
  channels: "channels",
  logs: "logs",
  agentManagement: "agent_management",
  userManagement: "user_management",
} as const;

export type MenuId = (typeof MENU_IDS)[keyof typeof MENU_IDS];
export type CanvasViewId = "chat" | "file_preview";

const VALID_MENU_IDS = new Set<string>(Object.values(MENU_IDS));

export const DEFAULT_MENU_ID: MenuId = MENU_IDS.currentSession;
export const DEFAULT_VIEW_ID: CanvasViewId = "chat";

export const MENU_LABELS: Record<MenuId, string> = {
  [MENU_IDS.currentSession]: "聊天",
  [MENU_IDS.myAgents]: "我的智能体",
  [MENU_IDS.agentSquare]: "智能体广场",
  [MENU_IDS.savedPlan]: "计划",
  [MENU_IDS.skillsSquare]: "技能广场",
  [MENU_IDS.profile]: "个人设置",
  [MENU_IDS.channels]: "频道",
  [MENU_IDS.logs]: "日志",
  [MENU_IDS.agentManagement]: "智能体管理",
  [MENU_IDS.userManagement]: "用户管理",
};

export const getMenuIdFromSearch = (search: string): MenuId => {
  const params = new URLSearchParams(search);
  const rawMenu = params.get(MENU_QUERY_KEY);

  if (rawMenu && VALID_MENU_IDS.has(rawMenu)) {
    return rawMenu as MenuId;
  }

  return DEFAULT_MENU_ID;
};

export const createSearchWithMenu = (search: string, menuId: MenuId): string => {
  const params = new URLSearchParams(search);
  params.set(MENU_QUERY_KEY, menuId);
  return `?${params.toString()}`;
};

export const getCanvasViewFromSearch = (search: string): CanvasViewId => {
  const params = new URLSearchParams(search);
  const rawView = params.get(VIEW_QUERY_KEY);
  if (rawView === "file_preview" || rawView === "chat") {
    return rawView;
  }
  return DEFAULT_VIEW_ID;
};

export const createSearchWithView = (search: string, viewId: CanvasViewId): string => {
  const params = new URLSearchParams(search);
  params.set(VIEW_QUERY_KEY, viewId);
  return `?${params.toString()}`;
};
