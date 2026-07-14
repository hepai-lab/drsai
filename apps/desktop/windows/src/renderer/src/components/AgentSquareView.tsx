import { ArrowRight, RefreshCw, Save, Search, Server, Settings, Sparkles, Star, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  DesktopAgent,
  MyDrSaiConfig,
  PlatformAgentStatus,
  UpdateMyDrSaiConfigRequest,
} from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";

interface AgentSquareViewProps {
  language: AppLanguage;
  userEmail?: string;
  selectedAgentId?: string | null;
  onStartChat: (agent: DesktopAgent) => void;
  onSetDefault?: (agent: DesktopAgent) => void;
}

export function AgentSquareView({
  language,
  selectedAgentId,
  onStartChat,
  onSetDefault,
}: AgentSquareViewProps): React.JSX.Element {
  const zh = language === "zh";
  const [agents, setAgents] = useState<DesktopAgent[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platformStatus, setPlatformStatus] = useState<PlatformAgentStatus | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [group, setGroup] = useState<"all" | "local" | "official" | "mine">("all");
  const [availability, setAvailability] = useState<"all" | "available" | "unavailable">("all");
  const [sort, setSort] = useState<"default" | "recent" | "name">("default");
  const [detailAgent, setDetailAgent] = useState<DesktopAgent | null>(null);
  const [preferenceMessage, setPreferenceMessage] = useState<string | null>(null);
  const [preferenceBusy, setPreferenceBusy] = useState<string | null>(null);

  useEffect(() => {
    void refreshAgents(false);
  }, []);

  const filteredAgents = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const visible = agents.filter((agent) => {
      const catalogGroup = agent.catalogGroup ?? (agent.source === "local" ? "local" : "official");
      if (group !== "all" && catalogGroup !== group) return false;
      const isAvailable = agent.available !== false && agent.status === "running";
      if (availability === "available" && !isAvailable) return false;
      if (availability === "unavailable" && isAvailable) return false;
      if (!normalizedSearch) return true;
      return [
        agent.name,
        agent.description,
        agent.localizedDescription?.zh,
        agent.localizedDescription?.en,
        agent.owner,
        agent.url,
        agent.mode,
        ...(agent.capabilities ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
    return [...visible].sort((left, right) => {
      if (sort === "name") return left.name.localeCompare(right.name, zh ? "zh-CN" : "en");
      if (sort === "recent") return (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? "") || left.name.localeCompare(right.name);
      const leftDefault = left.isDefault || left.id === selectedAgentId ? 1 : 0;
      const rightDefault = right.isDefault || right.id === selectedAgentId ? 1 : 0;
      return rightDefault - leftDefault || Number(Boolean(right.featured)) - Number(Boolean(left.featured)) || left.name.localeCompare(right.name);
    });
  }, [agents, availability, group, search, selectedAgentId, sort, zh]);

  async function refreshAgents(forceRefresh: boolean): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setAgents(await loadAgents(forceRefresh));
      setPlatformStatus(await desktopApi.getPlatformAgentStatus());
    } catch (agentError) {
      setError(agentError instanceof Error ? agentError.message : String(agentError));
    } finally {
      setLoading(false);
    }
  }

  async function setDefault(agent: DesktopAgent): Promise<void> {
    setPreferenceBusy(agent.id);
    setPreferenceMessage(null);
    try {
      const result = await desktopApi.setDefaultAgent(agent.id);
      if (!result.saved) throw new Error(result.message);
      setAgents((current) => current.map((item) => ({ ...item, isDefault: item.id === agent.id })));
      setPreferenceMessage(zh ? `已将 ${agent.name} 设为默认智能体。` : `${agent.name} is now the default agent.`);
      onSetDefault?.(agent);
    } catch (preferenceError) {
      setPreferenceMessage(preferenceError instanceof Error ? preferenceError.message : String(preferenceError));
    } finally {
      setPreferenceBusy(null);
    }
  }

  function startChat(agent: DesktopAgent): void {
    const usedAt = new Date().toISOString();
    setAgents((current) => current.map((item) => item.id === agent.id ? { ...item, lastUsedAt: usedAt } : item));
    void desktopApi.recordAgentUsage(agent.id).catch(() => undefined);
    onStartChat(agent);
  }

  const myDrSai = filteredAgents.find((agent) => agent.id === "my-drsai");
  const otherAgents = filteredAgents.filter((agent) => agent.id !== "my-drsai");
  const sections = (["local", "official", "mine"] as const)
    .map((sectionGroup) => ({
      group: sectionGroup,
      agents: otherAgents.filter((agent) => (agent.catalogGroup ?? (agent.source === "local" ? "local" : "official")) === sectionGroup),
    }))
    .filter((section) => section.agents.length > 0);

  return (
    <section
      className="agent-square-view"
      aria-label={zh ? "智能体面板" : "Agent Panel"}
    >
      <div className="agent-square-toolbar">
        <div className="agent-square-title-block">
          <strong>{zh ? "智能体" : "Agents"}</strong>
          <span>
            {filteredAgents.length}/{agents.length}
          </span>
        </div>
        <label className="agent-square-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={zh ? "搜索智能体 / 来源 / 地址" : "Search agents / source / URL"}
          />
        </label>
        <div className="agent-square-actions">
          <select value={group} onChange={(event) => setGroup(event.target.value as typeof group)} aria-label={zh ? "来源分组" : "Catalog group"}>
            <option value="all">{zh ? "全部来源" : "All groups"}</option>
            <option value="local">{zh ? "本地" : "Local"}</option>
            <option value="official">{zh ? "平台官方" : "Official"}</option>
            <option value="mine">{zh ? "我的智能体" : "Mine"}</option>
          </select>
          <select value={availability} onChange={(event) => setAvailability(event.target.value as typeof availability)} aria-label={zh ? "可用状态" : "Availability"}>
            <option value="all">{zh ? "全部状态" : "All states"}</option>
            <option value="available">{zh ? "可用" : "Available"}</option>
            <option value="unavailable">{zh ? "不可用" : "Unavailable"}</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label={zh ? "排序" : "Sort"}>
            <option value="default">{zh ? "推荐排序" : "Recommended"}</option>
            <option value="recent">{zh ? "最近使用" : "Recently used"}</option>
            <option value="name">{zh ? "名称" : "Name"}</option>
          </select>
          <button
            className="agent-square-refresh"
            type="button"
            onClick={() => void refreshAgents(true)}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "spinning" : ""} />
            {zh ? "检查状态" : "Check"}
          </button>
        </div>
      </div>

      <div className="agent-square-content agent-square-empty-content">
        {error && <div className="agent-square-error">{error}</div>}
        {platformStatus && platformStatus.state !== "ready" && (
          <div className="agent-square-error" role="status">
            <span>{platformStatus.message}</span>
            <small>
              {formatPlatformStatusMeta(platformStatus, zh)}
            </small>
          </div>
        )}
        {preferenceMessage && <div className="agent-square-preference-message" role="status">{preferenceMessage}</div>}
        {myDrSai && (
          <section className="agent-square-section">
            <h3>
              <Star size={14} fill="currentColor" />
              {zh ? "我的智能体" : "My Agent"}
            </h3>
            <AgentFeaturedCard
              agent={myDrSai}
              zh={zh}
              onConfigure={() => setConfigOpen((open) => !open)}
              onStartChat={startChat}
            />
            {configOpen && <MyDrSaiConfigPanel zh={zh} />}
          </section>
        )}

        {sections.length > 0 ? (
          sections.map((section) => (
            <section className="agent-square-section" key={section.group}>
              <h3>{getGroupLabel(section.group, zh)}</h3>
              <div className="agent-square-grid">
                {section.agents.map((agent) => (
                  <AgentCard
                    key={`${agent.source}:${agent.id}`}
                    agent={{ ...agent, isDefault: agent.isDefault || agent.id === selectedAgentId }}
                    zh={zh}
                    preferenceBusy={preferenceBusy === agent.id}
                    onDetails={() => setDetailAgent(agent)}
                    onSetDefault={() => void setDefault(agent)}
                    onStartChat={startChat}
                  />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="agent-square-empty-state">
            <Sparkles size={18} />
            <span>
              {loading
                ? zh
                  ? "正在检查本机和远程智能体..."
                  : "Checking local and remote agents..."
                : zh
                  ? "暂无其他已连接智能体。"
                  : "No other connected agents are available yet."}
            </span>
          </div>
        )}
      </div>
      {detailAgent && (
        <AgentDetailDialog
          agent={detailAgent}
          zh={zh}
          onClose={() => setDetailAgent(null)}
          onStart={() => startChat(detailAgent)}
        />
      )}
    </section>
  );
}

function getGroupLabel(group: "local" | "official" | "mine", zh: boolean): string {
  if (group === "local") return zh ? "本地智能体" : "Local agents";
  if (group === "mine") return zh ? "我的平台智能体" : "My platform agents";
  return zh ? "平台官方智能体" : "Official platform agents";
}

function AgentFeaturedCard({
  agent,
  zh,
  onConfigure,
  onStartChat,
}: {
  agent: DesktopAgent;
  zh: boolean;
  onConfigure: () => void;
  onStartChat: (agent: DesktopAgent) => void;
}): React.JSX.Element {
  const running = agent.status === "running";
  return (
    <article className="agent-featured-card my-drsai-card">
      <AgentLogo agent={agent} large />
      <div>
        <div className="agent-title-row">
          <h2>{agent.name}</h2>
          <AgentStatusPill agent={agent} zh={zh} />
        </div>
        {agent.id === "my-drsai" ? (
          <div className="my-drsai-subtitle">
            <span>运行在本机的智能体。</span>
            <span>专属于您的AI智能体❤</span>
          </div>
        ) : (
          <>
            <span>{agent.owner}</span>
            <p>{getAgentDescription(agent, zh)}</p>
          </>
        )}
        {agent.error && <small className="agent-card-error">{agent.error}</small>}
      </div>
      <div className="agent-featured-actions">
        <button type="button" className="secondary" onClick={onConfigure}>
          <Settings size={15} />
          <span>{zh ? "配置" : "Config"}</span>
        </button>
        {running && (
          <button type="button" onClick={() => onStartChat(agent)}>
            <span>{zh ? "开始使用" : "Use agent"}</span>
            <ArrowRight size={15} />
          </button>
        )}
      </div>
    </article>
  );
}

function MyDrSaiConfigPanel({ zh }: { zh: boolean }): React.JSX.Element {
  const [config, setConfig] = useState<MyDrSaiConfig | null>(null);
  const [draft, setDraft] = useState<UpdateMyDrSaiConfigRequest>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadConfig();
  }, []);

  async function loadConfig(): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const nextConfig = await loadMyDrSaiConfig();
      setConfig(nextConfig);
      setDraft({
        user_id: nextConfig.config.user_id || "",
        defult_config_name:
          nextConfig.config.defult_config_name || nextConfig.defaultModelAlias || "",
        plan_mode: Boolean(nextConfig.config.plan_mode),
        workspace_enabled: nextConfig.config.workspace_enabled !== false,
        dangerous_allowed: Boolean(nextConfig.config.dangerous_allowed),
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig(): Promise<void> {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveMyDrSaiConfig(draft);
      setConfig(saved);
      setMessage(zh ? "配置已保存。" : "Configuration saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const selectedModel = config?.models.find(
    (model) => model.alias === draft.defult_config_name,
  );

  return (
    <section className="my-drsai-config-panel" aria-label={zh ? "My DrSai 配置" : "My DrSai config"}>
      <div className="my-drsai-config-header">
        <div>
          <strong>{zh ? "My DrSai 配置" : "My DrSai Config"}</strong>
          <span>{config?.cliPath || config?.baseUrl || (zh ? "读取本机配置" : "Local config")}</span>
        </div>
        <button type="button" onClick={loadConfig} disabled={loading || saving}>
          <RefreshCw size={14} className={loading ? "spinning" : ""} />
          {zh ? "刷新" : "Refresh"}
        </button>
      </div>

      {message && <div className="my-drsai-config-message">{message}</div>}

      <div className="my-drsai-config-grid">
        <label>
          <span>{zh ? "默认模型" : "Default model"}</span>
          <select
            value={draft.defult_config_name || ""}
            onChange={(event) =>
              setDraft((current) => ({ ...current, defult_config_name: event.target.value }))
            }
            disabled={loading || saving || !config?.ready}
          >
            <option value="">{zh ? "未选择" : "Not selected"}</option>
            {config?.models.map((model) => (
              <option key={model.alias} value={model.alias}>
                {model.display_name || model.alias}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{zh ? "用户 ID" : "User ID"}</span>
          <input
            value={draft.user_id || ""}
            onChange={(event) =>
              setDraft((current) => ({ ...current, user_id: event.target.value }))
            }
            disabled={loading || saving || !config?.ready}
            placeholder="desktop"
          />
        </label>
      </div>

      {selectedModel && (
        <div className="my-drsai-model-meta">
          <span>{selectedModel.client_type || "model"}</span>
          <span>{selectedModel.model || selectedModel.alias}</span>
          {typeof selectedModel.token_limit === "number" && (
            <span>{zh ? "上下文" : "Context"} {selectedModel.token_limit}</span>
          )}
          {selectedModel.vision && <span>{zh ? "视觉" : "Vision"}</span>}
        </div>
      )}

      <div className="my-drsai-toggle-list">
        <ConfigToggle
          checked={Boolean(draft.plan_mode)}
          title={zh ? "Plan mode" : "Plan mode"}
          description={zh ? "让智能体先规划再执行。" : "Ask the agent to plan before acting."}
          disabled={loading || saving || !config?.ready}
          onChange={(value) => setDraft((current) => ({ ...current, plan_mode: value }))}
        />
        <ConfigToggle
          checked={draft.workspace_enabled !== false}
          title={zh ? "工作区限制" : "Workspace scope"}
          description={zh ? "优先把文件操作限制在当前工作区。" : "Prefer file actions inside the current workspace."}
          disabled={loading || saving || !config?.ready}
          onChange={(value) =>
            setDraft((current) => ({ ...current, workspace_enabled: value }))
          }
        />
        <ConfigToggle
          checked={Boolean(draft.dangerous_allowed)}
          title={zh ? "允许危险命令" : "Allow dangerous commands"}
          description={zh ? "关闭时，高风险命令需要拦截或审批。" : "When off, high-risk commands are blocked or require approval."}
          disabled={loading || saving || !config?.ready}
          onChange={(value) =>
            setDraft((current) => ({ ...current, dangerous_allowed: value }))
          }
        />
      </div>

      <div className="my-drsai-config-footer">
        <small>
          {zh
            ? "高级项如工具、RAG、环境变量和模型目录增删改，可继续放到独立设置页。"
            : "Advanced tools, RAG, environment variables, and model CRUD can live in a full settings page."}
        </small>
        <button type="button" onClick={saveConfig} disabled={loading || saving || !config?.ready}>
          <Save size={14} />
          {saving ? (zh ? "保存中" : "Saving") : zh ? "保存配置" : "Save"}
        </button>
      </div>
    </section>
  );
}

function ConfigToggle({
  checked,
  title,
  description,
  disabled,
  onChange,
}: {
  checked: boolean;
  title: string;
  description: string;
  disabled: boolean;
  onChange: (value: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="my-drsai-config-toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}

function AgentCard({
  agent,
  zh,
  preferenceBusy,
  onDetails,
  onSetDefault,
  onStartChat,
}: {
  agent: DesktopAgent;
  zh: boolean;
  preferenceBusy: boolean;
  onDetails: () => void;
  onSetDefault: () => void;
  onStartChat: (agent: DesktopAgent) => void;
}): React.JSX.Element {
  const running = agent.available !== false && agent.status === "running";
  return (
    <article className="agent-card">
      <div className="agent-card-top">
        <AgentStatusPill agent={agent} zh={zh} />
        <button
          type="button"
          className={`agent-default-button${agent.isDefault ? " active" : ""}`}
          disabled={agent.isDefault || preferenceBusy}
          onClick={onSetDefault}
          aria-label={agent.isDefault ? (zh ? "当前默认智能体" : "Current default agent") : (zh ? "设为默认智能体" : "Set as default agent")}
          title={agent.isDefault ? (zh ? "当前默认" : "Current default") : (zh ? "设为默认" : "Set as default")}
        >
          {preferenceBusy ? <RefreshCw size={15} className="spinning" /> : <Star size={16} fill={agent.isDefault ? "currentColor" : "none"} />}
        </button>
      </div>
      <div className="agent-card-main">
        <AgentLogo agent={agent} />
        <div>
          <h4>{agent.name}</h4>
          <span>{agent.owner}</span>
        </div>
      </div>
      <p>{getAgentDescription(agent, zh)}</p>
      {agent.url && <code className="agent-url">{agent.url}</code>}
      {agent.error && <small className="agent-card-error">{agent.error}</small>}
      <div className="agent-card-actions">
        <button type="button" className="secondary" onClick={onDetails}>{zh ? "详情" : "Details"}</button>
        <button type="button" disabled={!running} onClick={() => onStartChat(agent)}>
          {zh ? "开始使用" : "Use agent"}
        </button>
      </div>
    </article>
  );
}

function AgentStatusPill({
  agent,
  zh,
}: {
  agent: DesktopAgent;
  zh: boolean;
}): React.JSX.Element {
  return (
    <span className={`agent-status-pill ${agent.source} ${agent.status}`}>
      <Server size={12} />
      {getStatusLabel(agent, zh)}
    </span>
  );
}

function AgentLogo({
  agent,
  large = false,
}: {
  agent: DesktopAgent;
  large?: boolean;
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`agent-logo ${large ? "large" : ""}`}>
      {agent.logo && !failed ? (
        <img src={agent.logo} alt="" onError={() => setFailed(true)} />
      ) : agent.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function AgentDetailDialog({
  agent,
  zh,
  onClose,
  onStart,
}: {
  agent: DesktopAgent;
  zh: boolean;
  onClose: () => void;
  onStart: () => void;
}): React.JSX.Element {
  const examples = Array.isArray(agent.examples) ? agent.examples : agent.examples ? [agent.examples] : [];
  const available = agent.available !== false && agent.status === "running";
  return (
    <div className="agent-detail-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="agent-detail-dialog" role="dialog" aria-modal="true" aria-label={agent.name}>
        <header>
          <AgentLogo agent={agent} large />
          <div><h2>{agent.name}</h2><span>{agent.owner}</span></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={zh ? "关闭" : "Close"}><X size={17} /></button>
        </header>
        <p>{getAgentDescription(agent, zh)}</p>
        <dl>
          <div><dt>{zh ? "运行模式" : "Mode"}</dt><dd>{agent.mode || (zh ? "未标注" : "Not specified")}</dd></div>
          <div><dt>{zh ? "可用状态" : "Availability"}</dt><dd>{available ? (zh ? "可用" : "Available") : (zh ? "当前不可用" : "Currently unavailable")}</dd></div>
          <div><dt>{zh ? "来源" : "Source"}</dt><dd>{getGroupLabel(agent.catalogGroup ?? (agent.source === "local" ? "local" : "official"), zh)}</dd></div>
        </dl>
        {(agent.capabilities ?? []).length > 0 && <div className="agent-detail-section"><strong>{zh ? "能力" : "Capabilities"}</strong><div className="agent-card-tags">{agent.capabilities?.map((item) => <span key={item}>{item}</span>)}</div></div>}
        {examples.length > 0 && <div className="agent-detail-section"><strong>{zh ? "示例任务" : "Example tasks"}</strong><ul>{examples.map((example, index) => <li key={index}>{typeof example === "string" ? example : (zh ? example.zh ?? example.en : example.en ?? example.zh)}</li>)}</ul></div>}
        <div className="agent-detail-note">{agent.error || (zh ? "调用平台智能体时，任务内容会发送到其运行服务；请勿提交无授权的敏感数据。" : "Tasks sent to a platform agent are processed by its runtime. Do not submit unauthorized sensitive data.")}</div>
        <footer><button type="button" className="secondary" onClick={onClose}>{zh ? "关闭" : "Close"}</button><button type="button" disabled={!available} onClick={onStart}>{zh ? "开始使用" : "Use agent"}</button></footer>
      </section>
    </div>
  );
}

function getStatusLabel(agent: DesktopAgent, zh: boolean): string {
  const source = agent.source === "local" ? (zh ? "本机" : "Local") : (zh ? "远程" : "Remote");
  if (agent.status === "running") return `${source} · ${zh ? "运行中" : "Running"}`;
  if (agent.status === "stopped") return `${source} · ${zh ? "未启动" : "Stopped"}`;
  return `${source} · ${zh ? "不可达" : "Unreachable"}`;
}

function getAgentDescription(agent: DesktopAgent, zh: boolean): string {
  const localized = agent.localizedDescription;
  const selected = zh ? localized?.zh ?? localized?.en : localized?.en ?? localized?.zh;
  if (selected) return selected;
  const text = agent.description.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return text;
  try {
    const legacy = JSON.parse(text) as unknown;
    if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return text;
    const record = legacy as Record<string, unknown>;
    const en = typeof record.en === "string" ? record.en.trim() : "";
    const zhText = typeof record.zh === "string" ? record.zh.trim() : "";
    return (zh ? zhText || en : en || zhText) || text;
  } catch {
    return text;
  }
}

function formatPlatformStatusMeta(status: PlatformAgentStatus, zh: boolean): string {
  const checkedAt = status.lastCheckedAt
    ? new Date(status.lastCheckedAt).toLocaleString(zh ? "zh-CN" : "en-US")
    : zh ? "尚未检查" : "Not checked";
  const cache = status.cacheState === "stale"
    ? zh ? "过期缓存" : "stale cache"
    : status.cacheState === "fresh"
      ? zh ? "本地缓存" : "local cache"
      : zh ? "无缓存" : "no cache";
  return zh ? `最近检查：${checkedAt} · ${cache}` : `Last checked: ${checkedAt} · ${cache}`;
}

async function loadAgents(refresh = false): Promise<DesktopAgent[]> {
  const bridge = window.openDrSai as
    | { listAgents?: (options?: { refresh?: boolean }) => Promise<DesktopAgent[]> }
    | undefined;
  if (typeof bridge?.listAgents === "function") {
    return bridge.listAgents({ refresh });
  }

  const gateway = await desktopApi.getGatewayStatus();
  return [
    {
      id: "my-drsai",
      name: "My DrSai",
      description: "专属于您的AI智能体❤",
      owner: "运行在本机的智能体。",
      source: "local",
      status: gateway.ready ? "running" : "stopped",
      url: gateway.baseUrl,
      error: gateway.ready
        ? undefined
        : "当前桌面桥尚未提供 listAgents，已降级检查本机 gateway。",
    },
  ];
}

async function loadMyDrSaiConfig(): Promise<MyDrSaiConfig> {
  const bridge = window.openDrSai as
    | { getMyDrSaiConfig?: () => Promise<MyDrSaiConfig> }
    | undefined;
  if (typeof bridge?.getMyDrSaiConfig === "function") {
    return bridge.getMyDrSaiConfig();
  }
  throw new Error("当前桌面桥尚未提供 getMyDrSaiConfig，请重启窗口后再试。");
}

async function saveMyDrSaiConfig(
  request: UpdateMyDrSaiConfigRequest,
): Promise<MyDrSaiConfig> {
  const bridge = window.openDrSai as
    | { updateMyDrSaiConfig?: (request: UpdateMyDrSaiConfigRequest) => Promise<MyDrSaiConfig> }
    | undefined;
  if (typeof bridge?.updateMyDrSaiConfig === "function") {
    return bridge.updateMyDrSaiConfig(request);
  }
  throw new Error("当前桌面桥尚未提供 updateMyDrSaiConfig，请重启窗口后再试。");
}
