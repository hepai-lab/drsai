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
 * 登录后默认智能体选择优先级（完全来自 DB，无硬编码内置）：
 * 1. 用户在后端设置的 default_agent_id（如果传入且在列表中存在）
 * 2. 组织级别的 default_agent_id
 * 3. 列表中标记 is_default 的
 * 4. pickPreferredAgentFromList 兜底（featured / 首项）
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

  const byDefault = agents.find((a) => a.is_default);
  if (byDefault?.id) return byDefault;

  return pickPreferredAgentFromList(agents);
}
