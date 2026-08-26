import { useModeConfigStore } from "@/store/modeConfig";
import { pickAgentForSessionStart } from "@/utils/agentPreference";
import { parseModelApiKeyFromSettingsConfig } from "@/utils/modelApiKey";
import { DRSAI_RECENT_AGENTS_KEY } from "@/utils/recentAgentsStorage";
import { message } from "antd";
import { ArrowRight, Plus, RefreshCw, Star } from "lucide-react";
import React, { useCallback, useContext, useEffect, useState } from "react";
import { parse } from "yaml";
import { appContext } from "../../../hooks/provider";
import { useLang } from "../../../i18n/useLang";
import { Agent } from "../../../types/common";
import { Button } from "../../common/Button";
import { CustomAgentData } from "../../common/agent-form/CustomAgentForm";
import { getDescriptionForSearch, getLocalizedDescription, getServerUrl } from "../../utils";
import { agentWorkerAPI, settingsAPI } from "../../views/api";
import { AgentCard, AgentCardData } from "./AgentCard";
import CustomAgentModal from "./CustomAgentModal";
import RemoteAgentModal from "./RemoteAgentModal";
interface AgentSquareProps {
  agents: AgentCardData[];
  className?: string;
  handleAgentList?: (agents: any[]) => Promise<void>;
}

const AgentSquare: React.FC<AgentSquareProps> = ({
  className = "",
  handleAgentList,
}) => {
  const { user } = useContext(appContext);
  const { t, lang } = useLang();
  const { agentId, setAgentId, setMode } = useModeConfigStore();
  const [agentList, setAgentList] = useState<AgentCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRemoteModalOpen, setIsRemoteModalOpen] = useState(false);
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [editingCustomAgent, setEditingCustomAgent] = useState<any | null>(null);
  const [availableModels, setAvailableModels] = useState<{ id: string }[]>([]);
  const [isModelListLoading, setIsModelListLoading] = useState(false);
  const [modelSourceApiKey, setModelSourceApiKey] = useState<string | undefined>();
  const [isSavingCustomAgent, setIsSavingCustomAgent] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<"all" | "mine" | "official">("all");
  const [sortBy, setSortBy] = useState<"recent" | "name">("recent");
  const [recentAgentIds, setRecentAgentIds] = useState<string[]>([]);
  /** 未配置平台模型 API Key：不阻塞页面，仍可使用「连接远程」 */
  const [noModelApiKeyForList, setNoModelApiKeyForList] = useState(false);
  /** Server-side user default agent id */
  const [userDefaultAgentId, setUserDefaultAgentId] = useState<string | null>(null);

  const readRecentAgentIds = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(DRSAI_RECENT_AGENTS_KEY);
      const ids: string[] = raw ? JSON.parse(raw) : [];
      setRecentAgentIds(Array.isArray(ids) ? ids : []);
    } catch {
      setRecentAgentIds([]);
    }
  }, []);

  const syncRecentFromServer = useCallback(async () => {
    if (!user?.email) return;
    try {
      const rows = await agentWorkerAPI.getRecentUserAgents(user.email, 12);
      const ids = (rows || []).map((r: any) => r?.agent_id).filter(Boolean);
      if (ids.length) {
        setRecentAgentIds(ids);
        try {
          window.localStorage.setItem(DRSAI_RECENT_AGENTS_KEY, JSON.stringify(ids));
        } catch { }
      }
    } catch (e) {
      // ignore network errors; localStorage will be used as fallback
      console.debug("Failed to sync recent agents from server:", e);
    }
  }, [user?.email]);

  const loadUserDefaultAgent = useCallback(async () => {
    if (!user?.email) return;
    try {
      const result = await agentWorkerAPI.getUserDefaultAgent(user.email);
      // Prefer the explicit user choice; default_agent_id may be a resolved fallback.
      setUserDefaultAgentId(result.stored_default_agent_id ?? null);
    } catch {
      // ignore — old backend without the endpoint
    }
  }, [user?.email]);

  const handleSetDefault = useCallback(async (agentId?: string) => {
    if (!agentId || !user?.email) return;
    try {
      await agentWorkerAPI.setUserDefaultAgent(user.email, agentId);
      setUserDefaultAgentId(agentId);
      message.success(t("agentsquare.defaultSet"));
    } catch (err) {
      console.error("Failed to set default agent:", err);
      message.error(t("agentsquare.defaultSetFailed"));
    }
  }, [user?.email]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleRemoveRemoteAgent = useCallback(async (id?: string) => {
    if (!id || !user?.email) return;

    try {
      await agentWorkerAPI.removeRemoteAgent(user.email, id);
      await loadAgentList();
    } catch (error) {
      console.error("Failed to remove remote agent:", error);
    }
  }, [user?.email]);

  const createRemoteAgentCard = useCallback((agent: Agent): AgentCardData => ({
    id: agent.id,
    logo: agent.logo || "/api/placeholder/64/64",
    name: agent.name,
    description: agent.description || t("agentsquare.remoteAgentDesc"),
    owner: agent.owner || t("agentsquare.unknown"),
    url: agent.url || "",
    config: agent.config,
    mode: agent.mode || "remote",
    api_key: agent.api_key,
    onRemove: (id?: string) => handleRemoveRemoteAgent(id || agent.id),
    onClick: () => { },
  }), [handleRemoveRemoteAgent]);

  // 转换统一格式的 agent 为 AgentCardData
  const transformUnifiedAgentToCardData = useCallback((agent: any): AgentCardData => {
    const config = agent.config || {};
    return {
      id: agent.id,
      logo: agent.logo || "/api/placeholder/64/64",
      name: agent.name || config.name || t("agentsquare.unknownAgent"),
      description: agent.description || t("agentsquare.agent"),
      owner: agent.owner || user?.email || t("agentsquare.unknown"),
      url: agent.url || config.url || config.base_url || "",
      config: agent.config,
      mode: agent.mode || "remote",
      api_key: agent.api_key || config.api_key || config.apiKey,
      featured: Boolean(agent.featured),
      is_default: Boolean(agent.is_default),
      is_user_default: Boolean(agent.id && agent.id === userDefaultAgentId),
      onRemove: (agent.mode === "remote" || agent.mode === "custom")
        ? (id?: string) => handleRemoveRemoteAgent(id || agent.id)
        : undefined,
      onSetDefault: (id?: string) => handleSetDefault(id || agent.id),
      onClick: () => { },
    };
  }, [user?.email, handleRemoveRemoteAgent, handleSetDefault, userDefaultAgentId]);

  // 提取获取 API Key 和 BaseUrl 的逻辑
  const getApiKeyFromSettings = useCallback(async (userEmail: string) => {
    const settings = await settingsAPI.getSettings(userEmail);
    let parsed: Record<string, unknown> = {};
    try {
      if (settings?.model_configs) {
        parsed = parse(settings.model_configs as string) as Record<string, unknown>;
      }
    } catch {
      parsed = {};
    }
    const modelConfig =
      (parsed?.model_config as { config?: Record<string, unknown> } | undefined)
        ?.config || {};
    const apiKey = parseModelApiKeyFromSettingsConfig(settings);
    const baseUrl = modelConfig.base_url as string | undefined;
    return { apiKey, baseUrl };
  }, []);

  const loadAgentList = useCallback(async () => {

    if (!user?.email) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setNoModelApiKeyForList(false);

      let apiKey: string | undefined;
      try {
        const keys = await getApiKeyFromSettings(user.email);
        apiKey = keys.apiKey;
      } catch (e) {
        console.warn("Could not load settings for agent list:", e);
        apiKey = undefined;
      }

      if (!apiKey) {
        // 本地账号未配置平台模型 Key：用空 Bearer 调统一列表接口，后端仍会合并默认 + 远程/自定义（DDF 段为空）
        setNoModelApiKeyForList(true);
        setModelSourceApiKey(undefined);
        try {
          const agentsData = await agentWorkerAPI.getUserAgents(user.email, "", false);
          const agents = agentsData.map(transformUnifiedAgentToCardData);
          setAgentList(agents);
        } catch (e2) {
          console.warn("getUserAgents without platform key failed, trying remote-only list:", e2);
          try {
            const raw = await agentWorkerAPI.getUserRemoteAgents(user.email);
            const list = Array.isArray(raw) ? raw : [];
            setAgentList(list.map(transformUnifiedAgentToCardData));
          } catch {
            setAgentList([]);
          }
        }
        return;
      }

      setNoModelApiKeyForList(false);
      setModelSourceApiKey(apiKey);

      const agentsData = await agentWorkerAPI.getUserAgents(user.email, apiKey, false);
      const agents = agentsData.map(transformUnifiedAgentToCardData);
      setAgentList(agents);
    } catch (err) {
      console.error("Error loading agent list:", err);
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, [user?.email, getApiKeyFromSettings, transformUnifiedAgentToCardData]);

  const loadAvailableModels = useCallback(async () => {
    if (!user?.email || !modelSourceApiKey) {
      setAvailableModels([]);
      return;
    }

    setIsModelListLoading(true);

    try {
      const baseUrl = getServerUrl();
      const modelsUrl = `${baseUrl}/models/llm_models?user_id=${encodeURIComponent(user.email)}`;

      const response = await fetch(modelsUrl, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${modelSourceApiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const payload = await response.json();

      if (!payload.status) {
        throw new Error(payload.message || "Failed to fetch models");
      }

      // 后端返回的数据结构是 { status: True, data: {...} }
      // 需要从 data 中提取模型列表
      const modelsData = payload.data || {};
      const rawList: any[] = Array.isArray(modelsData?.data)
        ? modelsData.data
        : Array.isArray(modelsData?.models)
          ? modelsData.models
          : Array.isArray(modelsData)
            ? modelsData
            : [];

      const formatted = rawList
        .map((item, index) => ({
          id: item?.id || item?.name || item?.model || `model-${index}`,
        }))
        .filter((item) => Boolean(item.id))
        .filter((item, index, arr) => arr.findIndex((candidate) => candidate.id === item.id) === index);

      setAvailableModels(formatted);
    } catch (err) {
      console.error("Failed to load available models:", err);
      setAvailableModels([]);
    } finally {
      setIsModelListLoading(false);
    }
  }, [user?.email, modelSourceApiKey]);

  const handleRemoteAgentSave = useCallback(async (config: any, agentInfo?: any) => {
    if (!user?.email) return;

    try {
      // agentInfo first (metadata); then force UI name/url — get_info() name can differ from the form.
      const ai = agentInfo && typeof agentInfo === "object" ? agentInfo : {};
      const url = config.url;
      const displayName = String(config.name ?? "").trim();
      await agentWorkerAPI.saveRemoteAgent(user.email, {
        ...ai,
        mode: "remote",
        name: displayName,
        url,
        api_key: config.api_key ?? config.apiKey,
        config: {
          ...(typeof ai.config === "object" && ai.config ? ai.config : {}),
          name: displayName,
          url,
        },
      });

      await loadAgentList();
      setIsRemoteModalOpen(false);
    } catch (error) {
      console.error("Failed to save remote agent:", error);
      throw error;
    }
  }, [user?.email, loadAgentList]);

  const handleCustomAgentSave = useCallback(async (customConfig: CustomAgentData) => {
    if (!user?.email) {
      message.error(t("agentsquare.userNotLoggedIn"));
      return;
    }

    try {
      setIsSavingCustomAgent(true);

      const isEdit = Boolean(editingCustomAgent?.id);

      const payload: any = {
        mode: "custom",
        name: customConfig.name,
        description: customConfig.description || t("agentsquare.customAgent"),
        owner: user.email,
        type: isEdit ? "update" : "add",
        logo: customConfig.avatar || "/api/placeholder/64/64",
        system_message: customConfig.system_message,
        // 将前端自定义 Agent 配置整体塞到 config 中，方便后端统一解析
        config: {
          model_client: customConfig.model_client,
          mcp_sse_list: customConfig.mcp_sse_list,
          // 后端期望 ragflow_configs 为列表
          ragflow_configs: customConfig.ragflow_configs,
          name: customConfig.name,
          description: customConfig.description || t("agentsquare.customAgent"),
          system_message: customConfig.system_message,
        },
      };

      if (isEdit) {
        payload.id = editingCustomAgent.id;
        payload.config.id = editingCustomAgent.id;
      }

      const updatedAgents = await agentWorkerAPI.saveRemoteAgent(user.email, payload);
      await loadAgentList();
      if (handleAgentList) {
        await handleAgentList(updatedAgents);
      }

      message.success(isEdit ? t("agentsquare.customUpdated") : t("agentsquare.customSaved"));
      setIsCustomModalOpen(false);
      setEditingCustomAgent(null);
    } catch (err) {
      console.error("Failed to save custom agent:", err);
      message.error(err instanceof Error && err.message ? err.message : t("agentsquare.customSaveFailed"));
    } finally {
      setIsSavingCustomAgent(false);
    }
  }, [user?.email, handleAgentList, loadAgentList, editingCustomAgent]);

  const handleEditCustomAgent = useCallback((agent: any) => {
    const config = agent.config || {};

    const initialData: Partial<CustomAgentData> = {
      id: agent.id,
      name: agent.name,
      avatar: agent.logo,
      description: agent.description,
      system_message: agent.system_message ?? config.system_message,
      model_client: config.model_client,
      mcp_sse_list: config.mcp_sse_list || [],
      ragflow_configs: config.ragflow_configs || [],
    };

    setEditingCustomAgent({
      id: agent.id,
      initialData,
    });
    setIsCustomModalOpen(true);
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!user?.email) {
      message.warning(t("agentsquare.cannotRefresh"));
      return;
    }

    try {
      setIsRefreshing(true);

      let refreshKey = "";
      try {
        const keys = await getApiKeyFromSettings(user.email);
        refreshKey = keys.apiKey ?? "";
      } catch {
        refreshKey = "";
      }

      // 刷新智能体列表（is_refresh=true 会跳过缓存；无平台 Key 时仍刷新默认+远程）
      const agentsData = await agentWorkerAPI.getUserAgents(user.email, refreshKey, true);
      console.log("agentsData", agentsData);
      const agents = agentsData.map(transformUnifiedAgentToCardData);
      setAgentList(agents);
      message.success(t("agentsquare.refreshSuccess"));
    } catch (err) {
      console.error("Failed to refresh agent list:", err);
      message.error(t("agentsquare.refreshFailed"));
    } finally {
      setIsRefreshing(false);
    }
  }, [user?.email, getApiKeyFromSettings, transformUnifiedAgentToCardData]);

  useEffect(() => {
    loadAgentList();
    loadUserDefaultAgent();
  }, [loadAgentList, loadUserDefaultAgent]);

  useEffect(() => {
    if (isCustomModalOpen) {
      loadAvailableModels();
    }
  }, [isCustomModalOpen, loadAvailableModels]);

  useEffect(() => {
    readRecentAgentIds();
    syncRecentFromServer();
    const handler = () => readRecentAgentIds();
    window.addEventListener("drsai:recentAgentsUpdated", handler as EventListener);
    const usageHandler = (evt: Event) => {
      const custom = evt as CustomEvent<{ agentId?: string }>;
      const agentId = custom?.detail?.agentId;
      if (!user?.email || !agentId) return;
      agentWorkerAPI.recordUserAgentUsage(user.email, agentId).catch(() => { });
    };
    window.addEventListener("drsai:agentUsed", usageHandler as EventListener);
    return () => window.removeEventListener("drsai:recentAgentsUpdated", handler as EventListener);
  }, [readRecentAgentIds, syncRecentFromServer, user?.email]);

  // 仅当用户显式默认存在时自动写入 agentId；否则留空，由用户在智能体广场选择
  useEffect(() => {
    if (agentId) return;
    if (!agentList.length) return;
    const email = user?.email;
    if (!email) return;
    let cancelled = false;
    void (async () => {
      try {
        const userDefault = await agentWorkerAPI.getUserDefaultAgent(email).catch(() => null);
        if (cancelled) return;
        const userDefaultId = userDefault?.stored_default_agent_id ?? null;
        const platformPolicy = {
          auto_load_default_agent: userDefault?.auto_load_default_agent,
          default_agent_name: userDefault?.default_agent_name ?? null,
          science_default_agent_name: userDefault?.science_default_agent_name ?? null,
        };
        const target = pickAgentForSessionStart(
          agentList as Agent[],
          userDefaultId,
          platformPolicy,
        );
        if (!target?.id) return;
        setAgentId(target.id);
        setMode(target.mode || "");
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, agentList, setAgentId, setMode, user?.email]);

  if (loading) {
    return (
      <div
        className={`flex justify-center items-center h-64 ${className}`}
      >
        <div className="text-secondary">{t("agentsquare.loading")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`flex flex-col items-center justify-center h-64 ${className}`}
      >
        <div className="text-red-500 mb-2">{t("agentsquare.loadFailed")}: {error}</div>
        <div className="text-secondary text-sm">{t("agentsquare.useDefault")}</div>
      </div>
    );
  }

  const isMine = (agent: AgentCardData) =>
    Boolean(user?.email) && agent.owner === user?.email;

  const matchOwner = (agent: AgentCardData) => {
    if (ownerFilter === "all") return true;
    if (ownerFilter === "mine") return isMine(agent);
    // official
    return agent.mode !== "remote" && agent.mode !== "custom";
  };

  const matchSearch = (agent: AgentCardData) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (agent.name || "").toLowerCase().includes(q) ||
      getDescriptionForSearch(agent.description).toLowerCase().includes(q) ||
      (agent.owner || "").toLowerCase().includes(q)
    );
  };

  const baseList = agentList.filter(
    (agent) => agent.mode !== "magentic-one"
  );

  /** 主推位：仅展示用户设置的默认智能体 */
  const defaultAgent = userDefaultAgentId
    ? baseList.find((a) => a.id === userDefaultAgentId)
    : undefined;

  const filteredList = baseList.filter((agent) => matchOwner(agent) && matchSearch(agent));

  const sortList = (list: AgentCardData[]) => {
    if (sortBy === "name") {
      return [...list].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }
    // recent: keep "recently used" at top if present, otherwise stable fallback by name
    const order = new Map(recentAgentIds.map((id, idx) => [id, idx]));
    return [...list].sort((a, b) => {
      const ai = a.id ? order.get(a.id) : undefined;
      const bi = b.id ? order.get(b.id) : undefined;
      const aHas = typeof ai === "number";
      const bHas = typeof bi === "number";
      if (aHas && bHas) return ai! - bi!;
      if (aHas) return -1;
      if (bHas) return 1;
      return (a.name || "").localeCompare(b.name || "");
    });
  };

  const recentAgents = recentAgentIds
    .map((id) => baseList.find((a) => a.id === id))
    .filter(Boolean) as AgentCardData[];

  /** 与 AgentCard「试用一下」一致：选中、最近使用、上报、切会话 */
  const startWithAgent = (agent: AgentCardData) => {
    if (!agent?.id) return;
    setAgentId(agent.id);
    setMode(agent.mode || "");
    try {
      const raw = window.localStorage.getItem(DRSAI_RECENT_AGENTS_KEY);
      const list: string[] = raw ? JSON.parse(raw) : [];
      const next = [agent.id, ...list.filter((id) => id !== agent.id)].slice(0, 12);
      window.localStorage.setItem(DRSAI_RECENT_AGENTS_KEY, JSON.stringify(next));
      setRecentAgentIds(next);
      window.dispatchEvent(new CustomEvent("drsai:recentAgentsUpdated"));
      window.dispatchEvent(
        new CustomEvent("drsai:agentUsed", { detail: { agentId: agent.id } })
      );
    } catch {
      /* ignore */
    }
    window.dispatchEvent(
      new CustomEvent("switchToCurrentSession", {
        detail: { clearSession: true },
      })
    );
  };

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* 工具条（置顶） */}
      <div className="sticky top-0 z-10 mb-4 bg-transparent pr-4">
        <div className="ml-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2 backdrop-blur dark:border-[#2a2a3a] dark:bg-[#101018]/70">
          <div className="flex min-w-[260px] flex-1 items-center gap-2">
            <div className="text-sm font-semibold text-[#233457] dark:text-[#e4e8ff]">
              {t("agentsquare.title")}
              <span className="ml-2 text-xs font-normal text-[#9aa2b2] dark:text-[#b6bdd0]">
                {filteredList.length}/{baseList.length}
              </span>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("agentsquare.searchPlaceholder")}
              className="ml-2 h-8 w-full max-w-[420px] rounded-lg border border-[#e7e7ef] bg-white px-3 text-sm outline-none transition-colors focus:border-[#d3adf7] dark:border-[#2a2a3a] dark:bg-[#0f0f16] dark:text-[#e4e8ff]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditingCustomAgent(null);
                setIsCustomModalOpen(true);
              }}
              icon={<Sparkles className="h-3 w-3" />}
              className="text-xs px-2 py-1 border-0 shadow-none"
            >
              自定义
            </Button> */}

            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsRemoteModalOpen(true)}
              icon={<Plus className="h-3 w-3" />}
              className="h-8 rounded-lg !border border-[#e7e7ef] bg-white/80 px-3 text-xs font-medium text-[#334155]  backdrop-blur-sm hover:bg-white hover:border-[#c7b8ff] active:translate-y-0 dark:border-[#2a2a3a] dark:bg-[#0f0f16]/80 dark:text-[#cfd6e9] dark:hover:bg-[#121226] dark:hover:border-[#5d3fcd]/50"
            >
              {t("agentsquare.connectRemote")}
            </Button>

            {/* owner filter */}
            <div className="flex items-center rounded-lg border border-[#e7e7ef] bg-white px-1 py-1 text-xs dark:border-[#2a2a3a] dark:bg-[#0f0f16]">
              {(
                [
                  ["all", t("agentsquare.filterAll")],
                  ["mine", t("agentsquare.filterMine")],
                  ["official", t("agentsquare.filterOfficial")],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOwnerFilter(key)}
                  className={`rounded-md px-2 py-1 transition-colors ${ownerFilter === key
                    ? "bg-[#ece9ff] text-[#5d3fcd] dark:bg-[#2a2342] dark:text-[#bca8ff]"
                    : "text-[#55627a] hover:bg-[#f2f2f7] dark:text-[#b6bdd0] dark:hover:bg-[#1a1a26]"
                    }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* sort */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="h-8 rounded-lg border border-[#e7e7ef] bg-white px-2 text-xs text-[#55627a] outline-none dark:border-[#2a2a3a] dark:bg-[#0f0f16] dark:text-[#b6bdd0]"
            >
              <option value="recent">{t("agentsquare.sortRecent")}</option>
              <option value="name">{t("agentsquare.sortName")}</option>
            </select>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              icon={<RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />}
              className="h-8 rounded-lg !border border-[#d4c9ff] bg-[#f5f3ff]/90 px-3 text-xs font-medium text-[#5d3fcd]  backdrop-blur-sm   dark:border-[#5d3fcd]/40 dark:bg-[#2a2342]/80 dark:text-[#bca8ff] dark:hover:border-[#7c5ce8] dark:hover:bg-[#322a4a]"
            >
              {t("agentsquare.refresh")}
            </Button>
          </div>
        </div>
      </div>

      {/* 检查是否没有智能体 */}
      {baseList.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center h-64 flex-1 px-4 text-center"
        >
          {noModelApiKeyForList ? (
            <>
              <div className="text-[#334155] dark:text-[#cfd6e9] mb-2 font-medium">
                {t("agentsquare.noApiKeyTitle")}
              </div>
              <div className="text-secondary text-sm max-w-md">
                {t("agentsquare.noApiKeyDesc")}
              </div>
            </>
          ) : (
            <>
              <div className="text-secondary mb-2">{t("agentsquare.noAgents")}</div>
              <div className="text-secondary text-sm">{t("agentsquare.noAgentsDesc")}</div>
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* 主推位：我的默认智能体 */}
          {defaultAgent && (
            <div className="mb-4 pl-4 pr-4">
              <div className="w-full max-w-[min(100%,36rem)]">
                <div className="mb-2 flex items-center gap-1.5">
                  <Star className="h-3 w-3 fill-[#c4b5fd] text-[#c4b5fd] dark:fill-[#a78bfa] dark:text-[#a78bfa]" />
                  <span className="text-xs font-semibold tracking-wide text-[#55627a] dark:text-[#b6bdd0]">
                    {t("agentsquare.myDefaultAgent")}
                  </span>
                </div>

                <div className="flex flex-col gap-3 rounded-[18px] border border-[#ddd3ef] bg-[#fafafe] p-4 shadow-[0_6px_16px_rgba(43,51,72,0.035)] dark:border-[#433a5e] dark:bg-[rgba(167,139,250,0.08)] dark:shadow-[0_8px_20px_rgba(0,0,0,0.18)] sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#f8f9fc] ring-1 ring-inset ring-[#dfe3ec] dark:bg-[#222032] dark:ring-[#3b3651]">
                      <img
                        src={defaultAgent.logo}
                        alt=""
                        className="h-5 w-5 object-contain"
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-[#25324a] dark:text-[#eef2ff]">
                        {defaultAgent.name}
                      </h3>
                      <div className="mt-0.5 truncate text-[12px] text-[#8f98ac] dark:text-[#9fa8bf]">
                        {defaultAgent.owner}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-[#404e67] dark:text-[#c7d0e6]">
                        {getLocalizedDescription(defaultAgent.description, lang)}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                    {defaultAgent.mode === "custom" && (
                      <button
                        type="button"
                        onClick={() => handleEditCustomAgent(defaultAgent)}
                        className="inline-flex h-8 items-center justify-center rounded-[10px] border border-[#ebe7f1] bg-white px-3 text-xs font-medium text-[#5f5a73] transition hover:border-[#d3adf7] hover:text-[#544d92] dark:border-[#2f2a41] dark:bg-[#1c1628] dark:text-[#d0c0e8]"
                      >
                        {t("agentsquare.edit")}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => startWithAgent(defaultAgent)}
                      title={t("agentsquare.startChat")}
                      aria-label={t("agentsquare.startChat")}
                      className="agent-featured-cta group/cta"
                    >
                      <span className="agent-featured-cta__shine" aria-hidden />
                      <span className="agent-featured-cta__label">{t("agentsquare.startChat")}</span>
                      <span className="agent-featured-cta__arrow">
                        <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 最近使用 */}
          {recentAgents.length > 0 && (
            <div className="mb-5 pl-4 pr-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold tracking-wide text-[#55627a] dark:text-[#b6bdd0]">
                  {t("agentsquare.recentUsed")}
                </div>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                {recentAgents
                  .filter((a) => (defaultAgent?.id ? a.id !== defaultAgent.id : true))
                  .slice(0, 6)
                  .map((agent) => (
                    <AgentCard
                      key={`recent-${agent.id || agent.name}`}
                      agent={agent}
                      onEdit={agent.mode === "custom" ? () => handleEditCustomAgent(agent) : undefined}
                    />
                  ))}
              </div>
            </div>
          )}

          <div className="pl-4 pr-4 pb-6">
            <div className="mb-2 text-xs font-semibold tracking-wide text-[#55627a] dark:text-[#b6bdd0]">
            {t("agentsquare.all")}
            </div>
            {filteredList.length === 0 ? (
              <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-[#e7e7ef] text-sm text-[#9aa2b2] dark:border-[#2a2a3a] dark:text-[#8f97ad]">
                {t("agentsquare.noMatch")}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
                {sortList(filteredList).map((agent) => (
                  <AgentCard
                    key={agent.id || agent.name}
                    agent={agent}
                    onEdit={agent.mode === "custom" ? () => handleEditCustomAgent(agent) : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 自定义智能体弹框 */}
      <CustomAgentModal
        isOpen={isCustomModalOpen}
        onClose={() => {
          setIsCustomModalOpen(false);
          setEditingCustomAgent(null);
        }}
        onSave={handleCustomAgentSave}
        models={availableModels}
        isLoadingModels={isModelListLoading}
        onReloadModels={loadAvailableModels}
        isSaving={isSavingCustomAgent}
        initialData={editingCustomAgent?.initialData}
        title={editingCustomAgent ? t("agentsquare.editCustomAgentTitle") : t("agentsquare.customAgentTitle")}
      />

      {/* 远程智能体连接弹框 */}
      <RemoteAgentModal
        isOpen={isRemoteModalOpen}
        onClose={() => setIsRemoteModalOpen(false)}
        onSave={handleRemoteAgentSave}
      />
    </div>
  );
};


export { AgentSquare };
export type { AgentSquareProps };

