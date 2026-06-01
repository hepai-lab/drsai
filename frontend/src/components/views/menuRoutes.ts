export const MENU_QUERY_KEY = "menu";
export const VIEW_QUERY_KEY = "view";

export const MENU_IDS = {
  currentSession: "current_session",
  myAgents: "my_agents",
  agentSquare: "agent_square",
  savedPlan: "saved_plan",
  skillsSquare: "skills_square",
  library: "library",
  profile: "profile",
  usageAnalytics: "usage_analytics",
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
  [MENU_IDS.currentSession]: "menuRoute.chat",
  [MENU_IDS.myAgents]: "menuRoute.myAgents",
  [MENU_IDS.agentSquare]: "menuRoute.agentSquare",
  [MENU_IDS.savedPlan]: "menuRoute.savedPlan",
  [MENU_IDS.skillsSquare]: "menuRoute.skillsSquare",
  [MENU_IDS.library]: "menuRoute.library",
  [MENU_IDS.profile]: "menuRoute.profile",
  [MENU_IDS.usageAnalytics]: "menuRoute.usageAnalytics",
  [MENU_IDS.channels]: "menuRoute.channels",
  [MENU_IDS.logs]: "menuRoute.logs",
  [MENU_IDS.agentManagement]: "menuRoute.agentManagement",
  [MENU_IDS.userManagement]: "menuRoute.userManagement",
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
