/**
 * 排除内部占位 mode，优先 is_default，其次 featured，最后列表首项。
 */
export function pickPreferredAgentFromList<
  T extends {
    id?: string;
    mode?: string;
    is_default?: boolean;
    featured?: boolean;
  },
>(agents: T[]): T | undefined {
  if (!agents?.length) return undefined;
  const baseList = agents.filter(
    (a) => a.mode !== "magentic-one" && a.mode !== "besiii",
  );
  const byDefault = baseList.find((a) => a.is_default);
  if (byDefault?.id) return byDefault;
  const featured = baseList.find((a) => a.featured);
  if (featured?.id) return featured;
  return agents[0];
}

/**
 * 登录后自动选中的智能体：**仅**在用户显式设置个人默认时返回，不做列表兜底。
 * 未设置时返回 undefined，由前端引导至智能体广场自行选择。
 */
export function pickLoginDefaultAgent<
  T extends {
    id?: string;
    name?: string;
    mode?: string;
    is_default?: boolean;
    featured?: boolean;
  },
>(agents: T[], userDefaultAgentId?: string | null): T | undefined {
  if (!agents?.length) return undefined;

  const uid = (userDefaultAgentId || "").trim();
  if (!uid) return undefined;

  return agents.find((a) => a.id === uid);
}
