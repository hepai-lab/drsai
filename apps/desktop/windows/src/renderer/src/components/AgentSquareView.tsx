import { ArrowRight, Network, RefreshCw, Search, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AppLanguage } from "../navigation";

type AgentMode = "local" | "remote" | "custom";
type OwnerFilter = "all" | "mine" | "official";
type SortMode = "recent" | "name";

interface AgentCardData {
  id: string;
  name: string;
  description: string;
  owner: string;
  mode: AgentMode;
  logoText: string;
  featured?: boolean;
  isUserDefault?: boolean;
}

interface AgentSquareViewProps {
  language: AppLanguage;
  userEmail?: string;
  onStartChat: (agent: AgentCardData) => void;
}

const RECENT_AGENTS_KEY = "drsai.recentAgents";

const AGENTS: AgentCardData[] = [
  {
    id: "drsai-research",
    name: "DrSai Research",
    description: "面向科研问题拆解、文献线索整理和实验路线规划的通用智能体。",
    owner: "OpenDrSai",
    mode: "local",
    logoText: "R",
    featured: true,
    isUserDefault: true,
  },
  {
    id: "code-lab",
    name: "Code Lab",
    description: "辅助阅读代码、生成补丁、运行验证并总结工程风险。",
    owner: "OpenDrSai",
    mode: "local",
    logoText: "C",
  },
  {
    id: "data-analyst",
    name: "Data Analyst",
    description: "用于表格清洗、统计分析、图表解释和数据报告草稿。",
    owner: "OpenDrSai",
    mode: "local",
    logoText: "D",
  },
  {
    id: "paper-reader",
    name: "Paper Reader",
    description: "读取论文结构，提取方法、实验设置、局限和可复现实验线索。",
    owner: "OpenDrSai",
    mode: "local",
    logoText: "P",
  },
  {
    id: "my-remote-agent",
    name: "Remote Agent",
    description: "连接你自己的远程智能体服务，适合接入团队已有工作流。",
    owner: "Me",
    mode: "remote",
    logoText: "N",
  },
];

export function AgentSquareView({
  language,
  userEmail,
  onStartChat,
}: AgentSquareViewProps): React.JSX.Element {
  const zh = language === "zh";
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [sortBy, setSortBy] = useState<SortMode>("recent");
  const [recentAgentIds, setRecentAgentIds] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const defaultAgent = AGENTS.find((agent) => agent.isUserDefault) ?? AGENTS[0];

  useEffect(() => {
    setRecentAgentIds(readRecentAgentIds());
  }, []);

  const filteredAgents = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return AGENTS.filter((agent) => {
      if (ownerFilter === "mine" && !isMine(agent, userEmail)) return false;
      if (ownerFilter === "official" && agent.mode !== "local") return false;
      if (!normalizedSearch) return true;
      return [agent.name, agent.description, agent.owner]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [ownerFilter, search, userEmail]);

  const sortedAgents = useMemo(() => {
    const order = new Map(recentAgentIds.map((id, index) => [id, index]));
    return [...filteredAgents].sort((left, right) => {
      if (sortBy === "name") return left.name.localeCompare(right.name);
      return (order.get(left.id) ?? 999) - (order.get(right.id) ?? 999);
    });
  }, [filteredAgents, recentAgentIds, sortBy]);

  const recentAgents = recentAgentIds
    .map((id) => AGENTS.find((agent) => agent.id === id))
    .filter(Boolean)
    .filter((agent) => agent?.id !== defaultAgent.id)
    .slice(0, 6) as AgentCardData[];

  function startWithAgent(agent: AgentCardData): void {
    const nextRecent = [agent.id, ...recentAgentIds.filter((id) => id !== agent.id)].slice(0, 12);
    setRecentAgentIds(nextRecent);
    writeRecentAgentIds(nextRecent);
    onStartChat(agent);
  }

  function refreshAgents(): void {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 350);
  }

  return (
    <section className="agent-square-view" aria-label={zh ? "智能体广场" : "Agent Square"}>
      <div className="agent-square-toolbar">
        <div className="agent-square-title-block">
          <strong>{zh ? "智能体" : "Agents"}</strong>
          <span>
            {sortedAgents.length}/{AGENTS.length}
          </span>
        </div>
        <label className="agent-square-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={zh ? "搜索名称 / 描述 / 创建人" : "Search name / description / owner"}
          />
        </label>
        <div className="agent-square-actions">
          <div className="agent-square-segmented" aria-label={zh ? "筛选智能体" : "Filter agents"}>
            {([
              ["all", zh ? "全部" : "All"],
              ["mine", zh ? "我的" : "Mine"],
              ["official", zh ? "本地" : "Local"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={ownerFilter === key ? "active" : ""}
                onClick={() => setOwnerFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortMode)}>
            <option value="recent">{zh ? "按最近使用" : "Recent"}</option>
            <option value="name">{zh ? "按名称" : "Name"}</option>
          </select>
          <button className="agent-square-refresh" type="button" onClick={refreshAgents}>
            <RefreshCw size={14} className={refreshing ? "spinning" : ""} />
            {zh ? "刷新" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="agent-square-content">
        {defaultAgent && (
          <section className="agent-square-section">
            <h3>
              <Star size={14} fill="currentColor" />
              {zh ? "我的默认智能体" : "My Default Agent"}
            </h3>
            <FeaturedAgentCard agent={defaultAgent} zh={zh} onStartChat={startWithAgent} />
          </section>
        )}

        {recentAgents.length > 0 && (
          <section className="agent-square-section">
            <h3>{zh ? "最近使用" : "Recently Used"}</h3>
            <div className="agent-square-grid compact">
              {recentAgents.map((agent) => (
                <AgentCard key={`recent-${agent.id}`} agent={agent} zh={zh} onStartChat={startWithAgent} />
              ))}
            </div>
          </section>
        )}

        <section className="agent-square-section">
          <h3>{zh ? "全部" : "All"}</h3>
          {sortedAgents.length === 0 ? (
            <div className="agent-square-empty">{zh ? "没有匹配的智能体" : "No matching agents"}</div>
          ) : (
            <div className="agent-square-grid">
              {sortedAgents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} zh={zh} onStartChat={startWithAgent} />
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function FeaturedAgentCard({
  agent,
  zh,
  onStartChat,
}: {
  agent: AgentCardData;
  zh: boolean;
  onStartChat: (agent: AgentCardData) => void;
}): React.JSX.Element {
  return (
    <article className="agent-featured-card">
      <AgentLogo agent={agent} large />
      <div>
        <h2>{agent.name}</h2>
        <span>{agent.owner}</span>
        <p>{agent.description}</p>
      </div>
      <button type="button" onClick={() => onStartChat(agent)}>
        <span>{zh ? "开始会话" : "Start Chat"}</span>
        <ArrowRight size={15} />
      </button>
    </article>
  );
}

function AgentCard({
  agent,
  zh,
  onStartChat,
}: {
  agent: AgentCardData;
  zh: boolean;
  onStartChat: (agent: AgentCardData) => void;
}): React.JSX.Element {
  const mode = getModeLabel(agent.mode, zh);
  return (
    <article className="agent-card">
      <div className="agent-card-top">
        <span className={`agent-mode-pill ${agent.mode}`}>
          {agent.mode === "remote" ? <Network size={12} /> : <span aria-hidden />}
          {mode}
        </span>
        {agent.isUserDefault && (
          <span className="agent-default-star" title={zh ? "当前默认" : "Current default"}>
            <Star size={15} fill="currentColor" />
          </span>
        )}
      </div>
      <div className="agent-card-main">
        <AgentLogo agent={agent} />
        <div>
          <h4>{agent.name}</h4>
          <span>{agent.owner}</span>
        </div>
      </div>
      <p>{agent.description}</p>
      <div className="agent-card-actions">
        <button type="button" onClick={() => onStartChat(agent)}>
          {zh ? "开始会话" : "Start Chat"}
        </button>
      </div>
    </article>
  );
}

function AgentLogo({
  agent,
  large = false,
}: {
  agent: AgentCardData;
  large?: boolean;
}): React.JSX.Element {
  return <span className={`agent-logo ${large ? "large" : ""}`}>{agent.logoText}</span>;
}

function getModeLabel(mode: AgentMode, zh: boolean): string {
  if (mode === "remote") return zh ? "连接远程" : "Remote";
  if (mode === "custom") return zh ? "自定义智能体" : "Custom";
  return zh ? "本地" : "Local";
}

function isMine(agent: AgentCardData, userEmail?: string): boolean {
  return agent.owner === "Me" || Boolean(userEmail && agent.owner === userEmail);
}

function readRecentAgentIds(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_AGENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function writeRecentAgentIds(ids: string[]): void {
  try {
    window.localStorage.setItem(RECENT_AGENTS_KEY, JSON.stringify(ids));
  } catch {
    // Ignore storage failures in private or restricted environments.
  }
}
