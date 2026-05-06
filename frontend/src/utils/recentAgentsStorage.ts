/** 与 AgentSquare / AgentCard 中「最近使用」列表共用同一 key */
export const DRSAI_RECENT_AGENTS_KEY = "drsai.recentAgents";

/** 最近使用列表第一条 agent id（即最近一次使用的智能体），用于与 drsai-mode-config.agentId 对齐 */
export function getFirstRecentAgentId(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(DRSAI_RECENT_AGENTS_KEY);
    if (!raw) return null;
    const ids = JSON.parse(raw) as unknown;
    if (!Array.isArray(ids) || ids.length === 0) return null;
    const first = ids[0];
    return typeof first === "string" && first.trim() ? first.trim() : null;
  } catch {
    return null;
  }
}
