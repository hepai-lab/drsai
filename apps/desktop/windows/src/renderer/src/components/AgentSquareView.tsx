import { ArrowRight, RefreshCw, Save, Search, Server, Settings, Sparkles, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  DesktopAgent,
  MyDrSaiConfig,
  UpdateMyDrSaiConfigRequest,
} from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";

interface AgentSquareViewProps {
  language: AppLanguage;
  userEmail?: string;
  onStartChat: (agent: DesktopAgent) => void;
}

export function AgentSquareView({
  language,
  onStartChat,
}: AgentSquareViewProps): React.JSX.Element {
  const zh = language === "zh";
  const [agents, setAgents] = useState<DesktopAgent[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  useEffect(() => {
    void refreshAgents();
  }, []);

  const filteredAgents = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return agents;
    return agents.filter((agent) =>
      [agent.name, agent.description, agent.owner, agent.url]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [agents, search]);

  async function refreshAgents(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setAgents(await loadAgents());
    } catch (agentError) {
      setError(agentError instanceof Error ? agentError.message : String(agentError));
    } finally {
      setLoading(false);
    }
  }

  const myDrSai = filteredAgents.find((agent) => agent.id === "my-drsai");
  const otherAgents = filteredAgents.filter((agent) => agent.id !== "my-drsai");

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
          <button className="agent-square-refresh" type="button" onClick={refreshAgents}>
            <RefreshCw size={14} className={loading ? "spinning" : ""} />
            {zh ? "检查状态" : "Check"}
          </button>
        </div>
      </div>

      <div className="agent-square-content agent-square-empty-content">
        {error && <div className="agent-square-error">{error}</div>}
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
              onStartChat={onStartChat}
            />
            {configOpen && <MyDrSaiConfigPanel zh={zh} />}
          </section>
        )}

        {otherAgents.length > 0 ? (
          <section className="agent-square-section">
            <h3>{zh ? "已连接智能体" : "Connected Agents"}</h3>
            <div className="agent-square-grid">
              {otherAgents.map((agent) => (
                <AgentCard key={`${agent.source}:${agent.id}`} agent={agent} zh={zh} onStartChat={onStartChat} />
              ))}
            </div>
          </section>
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
    </section>
  );
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
            <p>{agent.description}</p>
          </>
        )}
        {agent.error && <small className="agent-card-error">{agent.error}</small>}
      </div>
      <div className="agent-featured-actions">
        <button type="button" className="secondary" onClick={onConfigure}>
          <Settings size={15} />
          <span>{zh ? "配置" : "Config"}</span>
        </button>
        {!running && (
          <button type="button" onClick={() => onStartChat(agent)}>
            <span>{zh ? "一键启动" : "Start"}</span>
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
  onStartChat,
}: {
  agent: DesktopAgent;
  zh: boolean;
  onStartChat: (agent: DesktopAgent) => void;
}): React.JSX.Element {
  const running = agent.status === "running";
  return (
    <article className="agent-card">
      <div className="agent-card-top">
        <AgentStatusPill agent={agent} zh={zh} />
      </div>
      <div className="agent-card-main">
        <AgentLogo agent={agent} />
        <div>
          <h4>{agent.name}</h4>
          <span>{agent.owner}</span>
        </div>
      </div>
      <p>{agent.description}</p>
      {agent.url && <code className="agent-url">{agent.url}</code>}
      {agent.error && <small className="agent-card-error">{agent.error}</small>}
      <div className="agent-card-actions">
        <button type="button" disabled={!running} onClick={() => onStartChat(agent)}>
          {zh ? "一键启动" : "Start"}
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
  return (
    <span className={`agent-logo ${large ? "large" : ""}`}>
      {agent.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function getStatusLabel(agent: DesktopAgent, zh: boolean): string {
  const source = agent.source === "local" ? (zh ? "本机" : "Local") : (zh ? "远程" : "Remote");
  if (agent.status === "running") return `${source} · ${zh ? "运行中" : "Running"}`;
  if (agent.status === "stopped") return `${source} · ${zh ? "未启动" : "Stopped"}`;
  return `${source} · ${zh ? "不可达" : "Unreachable"}`;
}

async function loadAgents(): Promise<DesktopAgent[]> {
  const bridge = window.openDrSai as
    | { listAgents?: () => Promise<DesktopAgent[]> }
    | undefined;
  if (typeof bridge?.listAgents === "function") {
    return bridge.listAgents();
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
