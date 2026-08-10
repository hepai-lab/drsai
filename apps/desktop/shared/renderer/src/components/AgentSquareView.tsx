import { ArrowLeft, ArrowRight, Brain, RefreshCw, Save, Search, Server, Settings, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AuthUser,
  DesktopAgent,
  DesktopAgentCatalogSnapshot,
  DesktopProjectMemoryEntry,
  DesktopTeamMemoryEntry,
  DesktopUserPreference,
  DesktopUserPreferenceCategory,
  DesktopUserPreferenceValue,
  MyDrSaiConfig,
  PlatformAgentStatus,
  UpdateMyDrSaiConfigRequest,
} from "@shared/desktopApi";
import { LOCAL_OPENDRSAI_AGENT_NAME } from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";
import { userFacingFailureMessage } from "../userFacingLanguage";

interface AgentSquareViewProps {
  language: AppLanguage;
  user: AuthUser | null;
  userGroups?: string[];
  workspacePath?: string;
  selectedAgentId?: string | null;
  onStartChat: (agent: DesktopAgent) => void;
}

export function AgentSquareView({
  language,
  user,
  userGroups = [],
  workspacePath,
  selectedAgentId,
  onStartChat,
}: AgentSquareViewProps): React.JSX.Element {
  const zh = language === "zh";
  const [agents, setAgents] = useState<DesktopAgent[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [platformStatus, setPlatformStatus] = useState<PlatformAgentStatus | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [group, setGroup] = useState<"all" | "local" | "official" | "mine">("all");
  const [availability, setAvailability] = useState<"all" | "available" | "unavailable">("all");
  const [sort, setSort] = useState<"default" | "name">("default");
  const [detailAgent, setDetailAgent] = useState<DesktopAgent | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadInitialCatalog(): Promise<void> {
      setLoading(true);
      try {
        const initial = await loadAgentCatalogSnapshot({ preferCache: true });
        if (cancelled) return;
        applyCatalogSnapshot(initial);
        setLoading(false);
        setRefreshing(true);
        const fresh = await loadAgentCatalogSnapshot({ refresh: true });
        if (!cancelled) applyCatalogSnapshot(fresh);
      } catch (agentError) {
        if (!cancelled) setError(userFacingFailureMessage(agentError, language, "connection"));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    void loadInitialCatalog();
    return () => { cancelled = true; };
  }, [user?.id]);

  const filteredAgents = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const visible = agents.filter((agent) => agent.id !== "my-codex").filter((agent) => {
      const catalogGroup = agent.catalogGroup ?? (agent.source === "local" ? "local" : "official");
      if (group !== "all" && catalogGroup !== group) return false;
      const isAvailable = isAgentUsable(agent);
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
      const leftSelected = left.id === selectedAgentId ? 1 : 0;
      const rightSelected = right.id === selectedAgentId ? 1 : 0;
      return rightSelected - leftSelected || Number(Boolean(right.featured)) - Number(Boolean(left.featured)) || left.name.localeCompare(right.name);
    });
  }, [agents, availability, group, search, selectedAgentId, sort, zh]);

  async function refreshAgents(forceRefresh: boolean): Promise<void> {
    if (agents.length === 0) setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      applyCatalogSnapshot(await loadAgentCatalogSnapshot({ refresh: forceRefresh }));
    } catch (agentError) {
      setError(userFacingFailureMessage(agentError, language, "connection"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function applyCatalogSnapshot(snapshot: DesktopAgentCatalogSnapshot): void {
    setAgents(snapshot.agents);
    setPlatformStatus(snapshot.platformStatus);
    setError(null);
  }

  function startChat(agent: DesktopAgent): void {
    onStartChat(agent);
  }

  const openDrSai = filteredAgents.find((agent) => agent.source === "local");
  const otherAgents = filteredAgents.filter((agent) => agent !== openDrSai);
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
            <option value="name">{zh ? "名称" : "Name"}</option>
          </select>
          <button
            className="agent-square-refresh"
            type="button"
            onClick={() => void refreshAgents(true)}
            disabled={loading || refreshing}
          >
            <RefreshCw size={14} className={loading || refreshing ? "spinning" : ""} />
            {refreshing ? (zh ? "更新中" : "Refreshing") : (zh ? "刷新" : "Refresh")}
          </button>
        </div>
      </div>

      <div className="agent-square-content agent-square-empty-content">
        {error && <div className="agent-square-error">{error}</div>}
        {platformStatus && (platformStatus.state !== "ready" || platformStatus.cacheState === "stale") && (
          <div className={platformStatus.state === "error" || platformStatus.state === "forbidden" || platformStatus.state === "requires_login" ? "agent-square-error" : "agent-square-notice"} role="status">
            <span>{getPlatformStatusMessage(platformStatus, zh)}</span>
            <small>
              {formatPlatformStatusMeta(platformStatus, zh)}
            </small>
          </div>
        )}
        {openDrSai && (
          <section className="agent-square-section">
            <h3>
              <Server size={14} />
              {zh ? "本机 OpenDrSai" : "Local OpenDrSai"}
            </h3>
            <AgentFeaturedCard
              agent={openDrSai}
              zh={zh}
              onConfigure={() => setConfigOpen((open) => !open)}
              onStartChat={startChat}
            />
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
                    agent={agent}
                    zh={zh}
                    onDetails={() => setDetailAgent(agent)}
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
                  ? "正在读取智能体目录..."
                  : "Loading agents..."
                : search.trim() || group !== "all" || availability !== "all"
                  ? zh
                    ? "没有符合当前筛选条件的智能体。"
                    : "No agents match the current filters."
                : zh
                  ? "当前账号没有其他可用的 HAI 智能体。"
                  : "No additional HAI agents are available for this account."}
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
      {configOpen && (
        <AgentConfigDialog zh={zh} onClose={() => setConfigOpen(false)}>
          <OpenDrSaiConfigPanel zh={zh} user={user} userGroups={userGroups} workspacePath={workspacePath} />
        </AgentConfigDialog>
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
  const running = isAgentUsable(agent);
  return (
    <article className="agent-featured-card my-drsai-card">
      <AgentLogo agent={agent} large />
      <div>
        <div className="agent-title-row">
          <h2>{agent.name}</h2>
          <AgentStatusPill agent={agent} zh={zh} />
        </div>
        {agent.source === "local" ? (
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
        <button type="button" className="secondary" data-testid="my-drsai-configure" onClick={onConfigure}>
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

function OpenDrSaiConfigPanel({ zh, user, userGroups, workspacePath }: { zh: boolean; user: AuthUser | null; userGroups: string[]; workspacePath?: string }): React.JSX.Element {
  const [view, setView] = useState<"config" | "memory">("config");
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
        plan_mode: Boolean(nextConfig.config.plan_mode),
        workspace_enabled: nextConfig.config.workspace_enabled !== false,
        dangerous_allowed: Boolean(nextConfig.config.dangerous_allowed),
      });
    } catch (error) {
      setMessage(userFacingFailureMessage(error, zh ? "zh" : "en", "operation"));
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
      setMessage(userFacingFailureMessage(error, zh ? "zh" : "en", "operation"));
    } finally {
      setSaving(false);
    }
  }

  if (view === "memory") {
    return <UserMemoryManager zh={zh} userGroups={userGroups} workspacePath={workspacePath} onBack={() => setView("config")} />;
  }

  return (
    <section className="my-drsai-config-panel" aria-label={zh ? "OpenDrSai 配置" : "OpenDrSai config"}>
      <div className="my-drsai-config-header">
        <div>
          <strong>{zh ? "OpenDrSai 配置" : "OpenDrSai Config"}</strong>
          <span>{zh ? "仅影响此设备上的 OpenDrSai" : "Applies to OpenDrSai on this device"}</span>
        </div>
        <div className="my-drsai-config-header-actions">
          <button type="button" data-testid="open-user-memory-manager" onClick={() => setView("memory")}>
            <Brain size={14} />
            {zh ? "管理记忆" : "Manage memory"}
          </button>
          <button type="button" onClick={loadConfig} disabled={loading || saving}>
            <RefreshCw size={14} className={loading ? "spinning" : ""} />
            {zh ? "刷新" : "Refresh"}
          </button>
        </div>
      </div>

      {message && <div className="my-drsai-config-message">{message}</div>}

      <div className="my-drsai-config-grid">
        <div className="opendrsai-account-card" data-testid="opendrsai-effective-identity">
          <span>{zh ? "当前 HepAI 账号" : "Current HepAI account"}</span>
          <strong>{user?.name || user?.email || (zh ? "未登录" : "Not signed in")}</strong>
          {user?.email && <small>{user.email} · {zh ? "已通过 HepAI 登录" : "Signed in with HepAI"}</small>}
          {user?.id && (
            <details>
              <summary>{zh ? "技术账号标识" : "Technical principal"}</summary>
              <code>{user.id}</code>
            </details>
          )}
        </div>
      </div>

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

function UserMemoryManager({
  zh,
  onBack,
  userGroups,
  workspacePath,
}: {
  zh: boolean;
  onBack: () => void;
  userGroups: string[];
  workspacePath?: string;
}): React.JSX.Element {
  const [preferences, setPreferences] = useState<DesktopUserPreference[]>([]);
  const [projectEntries, setProjectEntries] = useState<DesktopProjectMemoryEntry[]>([]);
  const [teamEntries, setTeamEntries] = useState<DesktopTeamMemoryEntry[]>([]);
  const [projectDraft, setProjectDraft] = useState("");
  const [teamDraft, setTeamDraft] = useState("");
  const [teamId, setTeamId] = useState(userGroups[0] ?? "");
  const [loading, setLoading] = useState(true);
  const [busyCategory, setBusyCategory] = useState<DesktopUserPreferenceCategory | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const [nextPreferences, nextProjectEntries, nextTeamEntries] = await Promise.all([
        desktopApi.listUserPreferences(),
        workspacePath ? desktopApi.listProjectMemory({ workspacePath, limit: 100 }) : Promise.resolve([]),
        desktopApi.listTeamMemory({ limit: 100 }),
      ]);
      setPreferences(nextPreferences);
      setProjectEntries(nextProjectEntries);
      setTeamEntries(nextTeamEntries);
    } catch (error) {
      setMessage(userFacingFailureMessage(error, zh ? "zh" : "en", "operation"));
    } finally {
      setLoading(false);
    }
  }

  async function addProjectEntry(): Promise<void> {
    if (!workspacePath || !projectDraft.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      await desktopApi.addProjectMemory({ workspacePath, content: projectDraft.trim(), source: "manual" });
      setProjectDraft("");
      await refresh();
      setMessage(zh ? "当前项目记忆已保存。" : "Current-project memory saved.");
    } catch (error) {
      setMessage(userFacingFailureMessage(error, zh ? "zh" : "en", "operation"));
      setLoading(false);
    }
  }

  async function removeProjectEntry(entryId: string): Promise<void> {
    if (!workspacePath) return;
    setLoading(true);
    try {
      await desktopApi.clearProjectMemory({ workspacePath, entryId });
      await refresh();
    } catch (error) {
      setMessage(userFacingFailureMessage(error, zh ? "zh" : "en", "operation"));
      setLoading(false);
    }
  }

  async function addTeamEntry(): Promise<void> {
    if (!teamId || !teamDraft.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      await desktopApi.addTeamMemory({ teamId, content: teamDraft.trim() });
      setTeamDraft("");
      await refresh();
      setMessage(zh ? "团队记忆已保存，仅对该团队成员生效。" : "Team memory saved for authorized members only.");
    } catch (error) {
      setMessage(userFacingFailureMessage(error, zh ? "zh" : "en", "operation"));
      setLoading(false);
    }
  }

  async function removeTeamEntry(entry: DesktopTeamMemoryEntry): Promise<void> {
    setLoading(true);
    try {
      await desktopApi.deleteTeamMemory({ teamId: entry.teamId, entryId: entry.id });
      await refresh();
    } catch (error) {
      setMessage(userFacingFailureMessage(error, zh ? "zh" : "en", "operation"));
      setLoading(false);
    }
  }

  async function updatePreference(category: DesktopUserPreferenceCategory, value: DesktopUserPreferenceValue): Promise<void> {
    setBusyCategory(category);
    setMessage(null);
    try {
      await desktopApi.upsertUserPreference({ category, value, source: "explicit_user_request" });
      setPreferences(await desktopApi.listUserPreferences());
      setMessage(zh ? "记忆已修改，将从下一项任务立即生效。" : "Memory updated. It will apply to the next task immediately.");
    } catch (error) {
      setMessage(userFacingFailureMessage(error, zh ? "zh" : "en", "operation"));
    } finally {
      setBusyCategory(null);
    }
  }

  async function removePreference(category: DesktopUserPreferenceCategory): Promise<void> {
    setBusyCategory(category);
    setMessage(null);
    try {
      await desktopApi.deleteUserPreference({ category });
      setPreferences(await desktopApi.listUserPreferences());
      setMessage(zh ? "记忆已删除，不会再用于后续任务。" : "Memory deleted. It will no longer be used for future tasks.");
    } catch (error) {
      setMessage(userFacingFailureMessage(error, zh ? "zh" : "en", "operation"));
    } finally {
      setBusyCategory(null);
    }
  }

  return (
    <section className="my-drsai-config-panel user-memory-manager" data-testid="user-memory-manager" aria-label={zh ? "记忆管理" : "Memory manager"}>
      <div className="my-drsai-config-header">
        <div>
          <strong>{zh ? "记忆管理" : "Memory manager"}</strong>
          <span>{zh ? "只保存你明确要求记住的非敏感偏好" : "Only explicit, non-sensitive preferences are saved"}</span>
        </div>
        <div className="my-drsai-config-header-actions">
          <button type="button" data-testid="memory-manager-back" onClick={onBack}>
            <ArrowLeft size={14} />
            {zh ? "返回配置" : "Back to config"}
          </button>
          <button type="button" onClick={refresh} disabled={loading || busyCategory !== null}>
            <RefreshCw size={14} className={loading ? "spinning" : ""} />
            {zh ? "刷新" : "Refresh"}
          </button>
        </div>
      </div>

      <p className="user-memory-explanation">
        {zh
          ? "修改会在下一任务立即生效；删除后，该偏好会从存储和新会话上下文中移除。API Key、令牌和临时路径不会出现在这里。"
          : "Changes apply to the next task immediately. Deleted preferences are removed from storage and new-conversation context. API keys, tokens, and temporary paths never appear here."}
      </p>
      {message && <div className="my-drsai-config-message" role="status" data-testid="memory-manager-status">{message}</div>}
      {loading ? (
        <div className="user-memory-empty">{zh ? "正在读取记忆…" : "Loading memory…"}</div>
      ) : preferences.length === 0 ? (
        <div className="user-memory-empty" data-testid="memory-manager-empty">
          <Brain size={18} />
          <strong>{zh ? "目前没有已保存的偏好" : "No saved preferences"}</strong>
          <span>{zh ? "你可以在聊天中说“以后默认用中文”等明确要求。" : "In chat, make an explicit request such as “Always use Chinese by default.”"}</span>
        </div>
      ) : (
        <div className="user-memory-list">
          {preferences.map((preference) => (
            <article className="user-memory-row" data-testid={`memory-row-${preference.category}`} key={preference.category}>
              <div>
                <strong>{preferenceCategoryLabel(preference.category, zh)}</strong>
                <span>{zh ? "由你的明确要求保存" : "Saved from your explicit request"}</span>
              </div>
              <select
                data-testid={`memory-value-${preference.category}`}
                aria-label={preferenceCategoryLabel(preference.category, zh)}
                value={preference.value}
                disabled={busyCategory !== null}
                onChange={(event) => void updatePreference(preference.category, event.target.value as DesktopUserPreferenceValue)}
              >
                {preferenceOptions(preference.category).map((option) => (
                  <option key={option.value} value={option.value}>{zh ? option.zh : option.en}</option>
                ))}
              </select>
              <button
                type="button"
                className="user-memory-delete"
                data-testid={`memory-delete-${preference.category}`}
                aria-label={zh ? `删除${preferenceCategoryLabel(preference.category, true)}` : `Delete ${preferenceCategoryLabel(preference.category, false)}`}
                disabled={busyCategory !== null}
                onClick={() => void removePreference(preference.category)}
              >
                <Trash2 size={14} />
                {zh ? "删除" : "Delete"}
              </button>
            </article>
          ))}
        </div>
      )}
      <section className="memory-scope-section" data-testid="project-memory-scope">
        <div className="memory-scope-heading">
          <span className="memory-scope-badge">{zh ? "当前项目" : "Current project"}</span>
          <small>{zh ? "只在这个项目中生效" : "Applies only in this project"}</small>
        </div>
        {workspacePath ? (
          <>
            <div className="memory-scope-compose">
              <input data-testid="project-memory-input" value={projectDraft} onChange={(event) => setProjectDraft(event.target.value)} placeholder={zh ? "例如：WLCG-CAPACITY 指第 42 页的容量模型" : "Example: WLCG-CAPACITY means the capacity model on page 42"} />
              <button data-testid="project-memory-add" type="button" disabled={loading || !projectDraft.trim()} onClick={() => void addProjectEntry()}>{zh ? "保存" : "Save"}</button>
            </div>
            {projectEntries.map((entry) => (
              <article className="memory-scope-row" data-testid="project-memory-row" key={entry.id}>
                <span>{entry.content}</span>
                <button type="button" aria-label={zh ? "删除项目记忆" : "Delete project memory"} onClick={() => void removeProjectEntry(entry.id)}><Trash2 size={14} /></button>
              </article>
            ))}
          </>
        ) : <div className="user-memory-empty">{zh ? "请先打开一个项目。" : "Open a project first."}</div>}
      </section>

      <section className="memory-scope-section" data-testid="team-memory-scope">
        <div className="memory-scope-heading">
          <span className="memory-scope-badge team">{zh ? "团队" : "Team"}</span>
          <small>{zh ? "只对已授权团队成员生效" : "Applies only to authorized team members"}</small>
        </div>
        {userGroups.length ? (
          <>
            <div className="memory-scope-compose">
              <select data-testid="team-memory-team" value={teamId} onChange={(event) => setTeamId(event.target.value)}>{userGroups.map((groupId) => <option key={groupId} value={groupId}>{groupId}</option>)}</select>
              <input data-testid="team-memory-input" value={teamDraft} onChange={(event) => setTeamDraft(event.target.value)} placeholder={zh ? "输入团队共同规则" : "Enter a shared team rule"} />
              <button data-testid="team-memory-add" type="button" disabled={loading || !teamDraft.trim()} onClick={() => void addTeamEntry()}>{zh ? "保存" : "Save"}</button>
            </div>
            {teamEntries.map((entry) => (
              <article className="memory-scope-row" data-testid="team-memory-row" key={entry.id}>
                <span><strong>{entry.teamId}</strong> · {entry.content}</span>
                <button type="button" aria-label={zh ? "删除团队记忆" : "Delete team memory"} onClick={() => void removeTeamEntry(entry)}><Trash2 size={14} /></button>
              </article>
            ))}
          </>
        ) : <div className="user-memory-empty" data-testid="team-memory-no-membership">{zh ? "当前账号尚未加入任何团队。" : "This account has no team membership."}</div>}
      </section>
    </section>
  );
}

function preferenceCategoryLabel(category: DesktopUserPreferenceCategory, zh: boolean): string {
  const labels: Record<DesktopUserPreferenceCategory, { zh: string; en: string }> = {
    output_language: { zh: "默认输出语言", en: "Default output language" },
    chart_gridlines: { zh: "图表网格线", en: "Chart gridlines" },
    report_format: { zh: "默认报告格式", en: "Default report format" },
    audience: { zh: "默认受众", en: "Default audience" },
  };
  return labels[category][zh ? "zh" : "en"];
}

function preferenceOptions(category: DesktopUserPreferenceCategory): Array<{ value: DesktopUserPreferenceValue; zh: string; en: string }> {
  if (category === "output_language") return [{ value: "zh", zh: "中文", en: "Chinese" }, { value: "en", zh: "英文", en: "English" }];
  if (category === "chart_gridlines") return [{ value: "hidden", zh: "不显示", en: "Hidden" }, { value: "visible", zh: "显示", en: "Visible" }];
  if (category === "report_format") return [{ value: "presentation", zh: "演示文稿", en: "Presentation" }, { value: "report", zh: "完整报告", en: "Full report" }, { value: "summary", zh: "摘要", en: "Summary" }];
  return [{ value: "manager", zh: "管理者", en: "Managers" }, { value: "expert", zh: "技术专家", en: "Technical experts" }, { value: "general", zh: "普通读者", en: "General readers" }];
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
  onDetails,
  onStartChat,
}: {
  agent: DesktopAgent;
  zh: boolean;
  onDetails: () => void;
  onStartChat: (agent: DesktopAgent) => void;
}): React.JSX.Element {
  const running = isAgentUsable(agent);
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
      <p>{getAgentDescription(agent, zh)}</p>
      {!running && <small className="agent-card-error">{getAgentUnavailableReason(agent, zh)}</small>}
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
    <span className={`agent-status-pill ${agent.source} ${agent.status}${agent.catalogState === "cached" ? " cached" : ""}`}>
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
  const { dialogRef, initialFocusRef } = useAccessibleDialog(onClose);
  const examples = Array.isArray(agent.examples) ? agent.examples : agent.examples ? [agent.examples] : [];
  const available = isAgentUsable(agent);
  return (
    <div className="agent-detail-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="agent-detail-dialog" role="dialog" aria-modal="true" aria-label={agent.name}>
        <header>
          <AgentLogo agent={agent} large />
          <div><h2>{agent.name}</h2><span>{agent.owner}</span></div>
          <button ref={initialFocusRef} type="button" className="icon-button" onClick={onClose} aria-label={zh ? "关闭" : "Close"}><X size={17} /></button>
        </header>
        <p>{getAgentDescription(agent, zh)}</p>
        <dl>
          <div><dt>{zh ? "可用状态" : "Availability"}</dt><dd>{available ? (zh ? "可用" : "Available") : (zh ? "当前不可用" : "Currently unavailable")}</dd></div>
          <div><dt>{zh ? "来源" : "Source"}</dt><dd>{getGroupLabel(agent.catalogGroup ?? (agent.source === "local" ? "local" : "official"), zh)}</dd></div>
        </dl>
        {(agent.capabilities ?? []).length > 0 && <div className="agent-detail-section"><strong>{zh ? "能力" : "Capabilities"}</strong><div className="agent-card-tags">{agent.capabilities?.map((item) => <span key={item}>{getCapabilityLabel(item, zh)}</span>)}</div></div>}
        {examples.length > 0 && <div className="agent-detail-section"><strong>{zh ? "示例任务" : "Example tasks"}</strong><ul>{examples.map((example, index) => <li key={index}>{typeof example === "string" ? example : (zh ? example.zh ?? example.en : example.en ?? example.zh)}</li>)}</ul></div>}
        <div className="agent-detail-note">{agent.error || (zh ? "调用平台智能体时，任务内容会发送到其运行服务；请勿提交无授权的敏感数据。" : "Tasks sent to a platform agent are processed by its runtime. Do not submit unauthorized sensitive data.")}</div>
        <footer><button type="button" className="secondary" onClick={onClose}>{zh ? "关闭" : "Close"}</button><button type="button" disabled={!available} onClick={onStart}>{zh ? "开始使用" : "Use agent"}</button></footer>
      </section>
    </div>
  );
}

function getStatusLabel(agent: DesktopAgent, zh: boolean): string {
  if (agent.source === "local") return zh ? "本机" : "Local";
  if (agent.catalogState === "cached") return zh ? "缓存结果" : "Cached";
  return isAgentUsable(agent)
    ? (zh ? "可用" : "Available")
    : (zh ? "不可用" : "Unavailable");
}

function isAgentUsable(agent: DesktopAgent): boolean {
  if (agent.available === false || agent.catalogState === "cached") return false;
  if (agent.source === "local") return true;
  const capabilities = new Set((agent.capabilities ?? []).map((item) => item.toLowerCase()));
  return agent.status === "running" && capabilities.has("chat") && capabilities.has("streaming");
}

function getAgentUnavailableReason(agent: DesktopAgent, zh: boolean): string {
  if (agent.catalogState === "cached") {
    return zh ? "这是上次缓存的目录结果，刷新成功后才能使用。" : "This is a cached catalog result. Refresh successfully before using it.";
  }
  if (agent.available === false || agent.status !== "running") {
    return zh ? "该智能体当前不可用。" : "This agent is currently unavailable.";
  }
  return zh ? "该智能体未声明对话和流式回复能力。" : "This agent does not advertise chat and streaming support.";
}

function AgentConfigDialog({
  zh,
  onClose,
  children,
}: {
  zh: boolean;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const { dialogRef, initialFocusRef } = useAccessibleDialog(onClose);
  return (
    <div className="agent-detail-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="agent-config-dialog" role="dialog" aria-modal="true" aria-label={zh ? "OpenDrSai 配置" : "OpenDrSai configuration"}>
        <header>
          <strong>{zh ? "OpenDrSai 设置" : "OpenDrSai settings"}</strong>
          <button ref={initialFocusRef} type="button" className="icon-button" onClick={onClose} aria-label={zh ? "关闭" : "Close"}><X size={17} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

function useAccessibleDialog(onClose: () => void): {
  dialogRef: React.RefObject<HTMLElement | null>;
  initialFocusRef: React.RefObject<HTMLButtonElement | null>;
} {
  const dialogRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialFocusRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);
  return { dialogRef, initialFocusRef };
}

function getCapabilityLabel(capability: string, zh: boolean): string {
  const key = capability.trim().toLowerCase();
  const labels: Record<string, [string, string]> = {
    chat: ["对话", "Chat"],
    streaming: ["流式回复", "Streaming"],
    "attachment-upload": ["上传附件", "Attachments"],
    "document-input": ["读取文档", "Documents"],
    workspace: ["工作区", "Workspace"],
    tools: ["工具调用", "Tools"],
  };
  const label = labels[key];
  return label ? label[zh ? 0 : 1] : capability;
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

function getPlatformStatusMessage(status: PlatformAgentStatus, zh: boolean): string {
  if (status.state === "loading") return zh ? "正在后台更新 HAI 智能体目录。" : "Refreshing the HAI agent catalog in the background.";
  if (status.state === "requires_login") return zh ? "HepAI 登录已失效，请重新登录。" : "Your HepAI session expired. Sign in again.";
  if (status.state === "forbidden") return zh ? "当前账号无权读取 HAI 智能体目录。" : "This account cannot access the HAI agent catalog.";
  if (status.state === "native_api_unavailable") return zh ? "HAI 智能体目录当前不可用，本机 OpenDrSai 仍可使用。" : "The HAI agent catalog is unavailable. Local OpenDrSai remains usable.";
  if (status.cacheState === "stale") return zh ? "目录更新失败，当前显示上次缓存结果。" : "Catalog refresh failed; showing the last cached result.";
  return zh ? "HAI 智能体目录更新失败，本机 OpenDrSai 仍可使用。" : "The HAI agent catalog could not be refreshed. Local OpenDrSai remains usable.";
}

async function loadAgentCatalogSnapshot(
  options: { refresh?: boolean; preferCache?: boolean },
): Promise<DesktopAgentCatalogSnapshot> {
  const bridge = window.openDrSai as
    | {
        getAgentCatalogSnapshot?: (options?: { refresh?: boolean; preferCache?: boolean }) => Promise<DesktopAgentCatalogSnapshot>;
        listAgents?: (options?: { refresh?: boolean; preferCache?: boolean }) => Promise<DesktopAgent[]>;
      }
    | undefined;
  if (typeof bridge?.getAgentCatalogSnapshot === "function") {
    return bridge.getAgentCatalogSnapshot(options);
  }
  if (typeof bridge?.listAgents === "function") {
    const agents = await bridge.listAgents(options);
    return {
      agents,
      platformStatus: await desktopApi.getPlatformAgentStatus(),
      loadedAt: new Date().toISOString(),
    };
  }
  return {
    agents: [{
      id: "local-agent-unavailable",
      name: LOCAL_OPENDRSAI_AGENT_NAME,
      description: "专属于您的AI智能体❤",
      owner: "运行在本机的智能体。",
      source: "local",
      status: "stopped",
      available: true,
      catalogGroup: "local",
    }],
    platformStatus: {
      state: "native_api_unavailable",
      apiVersion: null,
      capabilities: [],
      message: "The desktop bridge does not expose the Agent catalog.",
      lastCheckedAt: null,
      cacheState: "none",
    },
    loadedAt: new Date().toISOString(),
  };
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
