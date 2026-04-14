/**
 * 内置 Dr.Sai General（ddf）在包数据中的固定 id，与后端 builtin_drsai_general.json 一致。
 */
export const BUILTIN_DRSAI_GENERAL_AGENT_ID = "eab8c9e8-e5be-4bb2-9dd8-0fdc6938e357";

/**
 * 与 AgentSquare 新用户默认逻辑一致：排除内部占位 mode，优先 is_default，其次 featured，最后列表首项。
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
 * 登录后默认智能体：有组织且配置了 default_agent_id 且列表中存在 → 用组织默认；
 * 否则 → 优先 is_default；再否则 → Dr.Sai General（按 id 或名称）；再否则 → pickPreferredAgentFromList。
 */
export function findDrSaiGeneralAgent<
  T extends { id?: string; name?: string },
>(agents: T[]): T | undefined {
  if (!agents?.length) return undefined;
  const byId = agents.find((a) => a.id === BUILTIN_DRSAI_GENERAL_AGENT_ID);
  if (byId) return byId;
  return agents.find((a) => (a.name || "").trim() === "Dr.Sai General");
}

export function pickLoginDefaultAgent<
  T extends {
    id?: string;
    name?: string;
    mode?: string;
    is_default?: boolean;
    featured?: boolean;
  },
>(agents: T[], orgDefaultAgentId: string | null | undefined): T | undefined {
  if (!agents?.length) return undefined;
  const oid = (orgDefaultAgentId || "").trim();
  if (oid) {
    const orgHit = agents.find((a) => a.id === oid);
    if (orgHit) return orgHit;
  }
  const byDefault = agents.find((a) => a.is_default);
  if (byDefault?.id) return byDefault;
  const drsai = findDrSaiGeneralAgent(agents);
  if (drsai) return drsai;
  return pickPreferredAgentFromList(agents);
}
