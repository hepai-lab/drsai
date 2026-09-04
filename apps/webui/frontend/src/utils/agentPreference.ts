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
    (a) => a.mode !== "magentic-one",
  );
  const byDefault = baseList.find((a) => a.is_default);
  if (byDefault?.id) return byDefault;
  const featured = baseList.find((a) => a.featured);
  if (featured?.id) return featured;
  return agents[0];
}

export interface PlatformAgentPolicy {
  auto_load_default_agent?: boolean;
  default_agent_name?: string | null;
  science_default_agent_name?: string | null;
}

/** "iPanda" matches catalog name "DrSai iPanda". */
export function agentNameMatches(
  agentName: string | undefined | null,
  target: string | undefined | null,
): boolean {
  const a = (agentName || "").trim().toLowerCase();
  const t = (target || "").trim().toLowerCase();
  if (!a || !t) return false;
  return a === t || a.endsWith(t) || a.includes(t);
}

/**
 * 首屏拉 catalog 时是否应对 HepAI 做 DDF 刷新（is_refresh=true）。
 * 有个人默认或已持久化的 agentId/mode 时用缓存即可；否则视为新/空状态需刷新。
 * recentAgents 不参与判定（仅影响刷新后的选中优先级）。
 */
export function shouldRefreshAgentCatalog(params: {
  storedDefaultAgentId?: string | null;
  agentId?: string | null;
  mode?: string | null;
}): boolean {
  if ((params.storedDefaultAgentId || "").trim()) {
    return false;
  }
  const hasPersistedSelection =
    Boolean((params.agentId || "").trim()) ||
    Boolean((params.mode || "").trim());
  return !hasPersistedSelection;
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

/**
 * 会话启动时的智能体选择：
 * 个人默认 > science 专用默认（无视 auto_load 开关）> 平台新用户默认（受 auto_load 控制）。
 */
export function pickAgentForSessionStart<
  T extends {
    id?: string;
    name?: string;
    mode?: string;
    is_default?: boolean;
    featured?: boolean;
  },
>(
  agents: T[],
  userDefaultAgentId?: string | null,
  platformPolicy?: PlatformAgentPolicy | null,
): T | undefined {
  const personal = pickLoginDefaultAgent(agents, userDefaultAgentId);
  if (personal) return personal;

  // Science user 专用默认：存在即生效，无视 auto_load_default_agent
  const scienceTarget = (platformPolicy?.science_default_agent_name || "").trim();
  if (scienceTarget) {
    return agents.find((a) => agentNameMatches(a.name, scienceTarget));
  }

  if (!platformPolicy?.auto_load_default_agent) return undefined;

  const targetName = (platformPolicy.default_agent_name || "").trim();
  if (!targetName) return undefined;

  return agents.find((a) => agentNameMatches(a.name, targetName));
}
