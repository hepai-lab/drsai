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
 * 登录后自动选中的智能体：**仅**在显式配置时返回，不做列表兜底。
 * 1. 用户在 AgentModeSettings 中保存的个人默认（stored_default_agent_id）
 * 2. 组织级别的 default_agent_id
 *
 * 新用户未设置个人默认且组织未指定时返回 undefined，由前端引导至智能体广场自行选择。
 */
export function pickLoginDefaultAgent<
  T extends {
    id?: string;
    name?: string;
    mode?: string;
    is_default?: boolean;
    featured?: boolean;
  },
>(
  agents: T[],
  orgDefaultAgentId: string | null | undefined,
  userDefaultAgentId?: string | null,
): T | undefined {
  if (!agents?.length) return undefined;

  const uid = (userDefaultAgentId || "").trim();
  if (uid) {
    const userHit = agents.find((a) => a.id === uid);
    if (userHit) return userHit;
  }

  const oid = (orgDefaultAgentId || "").trim();
  if (oid) {
    const orgHit = agents.find((a) => a.id === oid);
    if (orgHit) return orgHit;
  }

  return undefined;
}
