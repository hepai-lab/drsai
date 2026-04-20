import { message } from "antd";
import { Plus, Sparkles, RefreshCw } from "lucide-react";
import React, { useCallback, useContext, useEffect, useState, useRef } from "react";
import { parse } from "yaml";
import { appContext } from "../../../hooks/provider";
import { Agent } from "../../../types/common";
import { Button } from "../../common/Button";
import { CustomAgentData } from "../../common/agent-form/CustomAgentForm";
import { agentWorkerAPI, settingsAPI, agentAPI, organizationsAPI } from "../../views/api";
import { AgentCard, AgentCardData } from "./AgentCard";
import CustomAgentModal from "./CustomAgentModal";
import RemoteAgentModal from "./RemoteAgentModal";
import { getServerUrl } from "../../utils";
import { useModeConfigStore } from "@/store/modeConfig";
import { DRSAI_RECENT_AGENTS_KEY } from "@/utils/recentAgentsStorage";
import { pickLoginDefaultAgent } from "@/utils/agentPreference";
import { isLocalPasswordLogin } from "@/utils/authSession";

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
  const [plazaRows, setPlazaRows] = useState<
    { org_id: number; org_display_name: string; agent_id: string; snapshot: Record<string, unknown> }[]
  >([]);
  const [plazaLoading, setPlazaLoading] = useState(false);
  /** 广场接口失败（如本地账号、未接入组织服务）时仍为 true，用于提示而非整页空白 */
  const [plazaLoadError, setPlazaLoadError] = useState(false);
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
      message.success("已设为默认智能体");
    } catch (err) {
      console.error("Failed to set default agent:", err);
      message.error("设置默认智能体失败");
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
    description: agent.description || "远程智能体 - 自定义连接",
    owner: agent.owner || "未知",
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
      name: agent.name || config.name || "未知智能体",
      description: agent.description || "智能体",
      owner: agent.owner || user?.email || "未知",
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
    const modelConfig = (parsed?.model_config as { config?: Record<string, unknown> } | undefined)?.config || {};
    const apiKey = modelConfig.api_key as string | undefined;
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
      message.error(error instanceof Error ? error.message : "保存远程智能体失败");
      throw error;
    }
  }, [user?.email, loadAgentList]);

  const handleCustomAgentSave = useCallback(async (customConfig: CustomAgentData) => {
    if (!user?.email) {
      message.error("用户未登录");
      return;
    }

    try {
      setIsSavingCustomAgent(true);

      const isEdit = Boolean(editingCustomAgent?.id);

      const payload: any = {
        mode: "custom",
        name: customConfig.name,
        description: customConfig.description || "自定义智能体",
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
          description: customConfig.description || "自定义智能体",
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

      message.success(isEdit ? "自定义智能体已更新" : "自定义智能体已保存");
      setIsCustomModalOpen(false);
      setEditingCustomAgent(null);
    } catch (err) {
      console.error("Failed to save custom agent:", err);
      message.error("保存自定义智能体失败");
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
      message.warning("无法刷新：缺少用户信息");
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
      message.success("刷新成功");
    } catch (err) {
      console.error("Failed to refresh agent list:", err);
      message.error("刷新失败");
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

  // 新用户默认：后端个人显式默认(stored_default_agent_id) > 组织默认 > 列表偏好
  useEffect(() => {
    if (agentId) return;
    if (!agentList.length) return;
    const email = user?.email;
    if (!email) return;
    let cancelled = false;
    void (async () => {
      try {
        const [myOrg, userDefault] = await Promise.all([
          organizationsAPI.getMyOrg(email).catch(() => null),
          agentWorkerAPI.getUserDefaultAgent(email).catch(() => null),
        ]);
        if (cancelled) return;
        const orgDefault = (myOrg?.default_agent_id as string) || null;
        const userDefaultId = userDefault?.stored_default_agent_id ?? null;
        const target = pickLoginDefaultAgent(agentList as Agent[], orgDefault, userDefaultId);
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

  useEffect(() => {
    const email = user?.email;
    if (!email) return;
    let cancelled = false;
    void (async () => {
      setPlazaLoading(true);
      setPlazaLoadError(false);
      try {
        const rows = await organizationsAPI.plazaList(email);
        if (!cancelled) {
          setPlazaRows(rows || []);
          setPlazaLoadError(false);
        }
      } catch {
        if (!cancelled) {
          setPlazaRows([]);
          setPlazaLoadError(true);
        }
      } finally {
        if (!cancelled) setPlazaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  if (loading) {
    return (
      <div
        className={`flex justify-center items-center h-64 ${className}`}
      >
        <div className="text-secondary">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`flex flex-col items-center justify-center h-64 ${className}`}
      >
        <div className="text-red-500 mb-2">加载失败: {error}</div>
        <div className="text-secondary text-sm">使用默认数据</div>
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
      (agent.description || "").toLowerCase().includes(q) ||
      (agent.owner || "").toLowerCase().includes(q)
    );
  };

  const baseList = agentList.filter(
    (agent) => agent.mode !== "magentic-one" && agent.mode !== "besiii"
  );

  /**
   * 主推位（与下方网格去重）：
   * - 优先展示后端标记的默认智能体（is_default），便于下游自定义“默认/主推”；
   * - 若无默认，再回退到后端标记的 featured（官方精选）。
   */
  const featuredAgent =
    (userDefaultAgentId ? baseList.find((a) => a.id === userDefaultAgentId) : undefined) ||
    baseList.find((a) => a.is_default) ||
    baseList.find((a) => a.featured && a.mode !== "remote" && a.mode !== "custom");

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
        <div className="ml-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#e7e7ef] bg-white/70 px-3 py-2 backdrop-blur dark:border-[#2a2a3a] dark:bg-[#101018]/70">
          <div className="flex min-w-[260px] flex-1 items-center gap-2">
            <div className="text-sm font-semibold text-[#233457] dark:text-[#e4e8ff]">
              智能体
              <span className="ml-2 text-xs font-normal text-[#9aa2b2] dark:text-[#b6bdd0]">
                {filteredList.length}/{baseList.length}
              </span>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索名称 / 描述 / 创建人"
              className="ml-2 h-8 w-full max-w-[420px] rounded-lg border border-[#e7e7ef] bg-white px-3 text-sm outline-none transition-colors focus:border-[#b5a1ff] dark:border-[#2a2a3a] dark:bg-[#0f0f16] dark:text-[#e4e8ff]"
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
              className="h-8 rounded-lg !border border-[#e7e7ef] bg-white/80 px-3 text-xs font-medium text-[#334155] shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur-sm hover:bg-white hover:border-[#c7b8ff] hover:shadow-[0_10px_30px_rgba(93,63,205,0.12)] active:translate-y-0 dark:border-[#2a2a3a] dark:bg-[#0f0f16]/80 dark:text-[#cfd6e9] dark:hover:bg-[#121226] dark:hover:border-[#5d3fcd]/50"
            >
              连接远程
            </Button>

            {/* owner filter */}
            <div className="flex items-center rounded-lg border border-[#e7e7ef] bg-white px-1 py-1 text-xs dark:border-[#2a2a3a] dark:bg-[#0f0f16]">
              {(
                [
                  ["all", "全部"],
                  ["mine", "我的"],
                  ["official", "官方"],
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
              <option value="recent">按最近使用</option>
              <option value="name">按名称</option>
            </select>

            <Button
              variant="primary"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              icon={<RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />}
              className="text-xs px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white border-0 shadow-none"
            >
              刷新
            </Button>
          </div>
        </div>
      </div>

      {user?.email && plazaLoadError && isLocalPasswordLogin() && (
        <div className="mb-3 ml-4 mr-4 rounded-xl border border-amber-200/90 bg-amber-50/95 px-3 py-2.5 text-xs leading-relaxed text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-100/95">
          普通用户访问worker受限，暂不可用。不影响使用上方「连接远程」添加外部智能体。
        </div>
      )}

      {user?.email && plazaRows.length > 0 && (
        <div className="mb-4 ml-4 mr-4 rounded-xl border border-[#e7e7ef] bg-white/80 p-3 dark:border-[#2a2a3a] dark:bg-[#101018]/80">
          <div className="mb-2 text-xs font-semibold text-[#55627a] dark:text-[#b6bdd0]">
            其他合作组智能体（申请通过后可在「我的智能体」侧栏使用）
            {plazaLoading ? <span className="ml-2 text-[10px] opacity-70">加载中…</span> : null}
          </div>
          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
            {plazaRows.map((row) => {
              const snap = row.snapshot || {};
              const name = (snap.name as string) || row.agent_id;
              return (
                <div
                  key={`${row.org_id}-${row.agent_id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#eee] px-2 py-1.5 text-xs dark:border-[#2a2a3a]"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-[#0f172a] dark:text-[#e4e8ff]">{name}</span>
                    <span className="ml-2 text-[#9aa2b2]">
                      {row.org_display_name || `org ${row.org_id}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-md bg-[#5d3fcd] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#4c32b3]"
                    onClick={async () => {
                      try {
                        await organizationsAPI.plazaApply(user.email!, row.org_id, row.agent_id);
                        message.success("已提交申请，请等待平台管理员审批");
                      } catch (e: any) {
                        message.error(e?.message || "申请失败");
                      }
                    }}
                  >
                    申请使用
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 检查是否没有智能体 */}
      {baseList.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center h-64 flex-1 px-4 text-center"
        >
          {noModelApiKeyForList ? (
            <>
              <div className="text-[#334155] dark:text-[#cfd6e9] mb-2 font-medium">
                未配置平台模型 API Key，托管智能体列表无法加载
              </div>
              <div className="text-secondary text-sm max-w-md">
                本地账号可点击上方「连接远程」，填写远程智能体地址与 Key 即可使用；若需平台托管智能体，请在设置中配置模型 API Key 后刷新。
              </div>
            </>
          ) : (
            <>
              <div className="text-secondary mb-2">当前用户未部署任何智能体</div>
              <div className="text-secondary text-sm">请联系管理员部署智能体或使用默认智能体</div>
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* 主推位：用户默认 > 官方精选 */}
          {featuredAgent && (featuredAgent.is_user_default || ownerFilter !== "mine") && (
            <div className="mb-6 pl-4 pr-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-[#111827] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white dark:bg-white dark:text-[#111827]">
                  {featuredAgent.is_user_default ? "Default" : "Featured"}
                </span>
                <span className="text-xs font-semibold tracking-wide text-[#55627a] dark:text-[#b6bdd0]">
                  {featuredAgent.is_user_default ? "我的默认智能体" : "官方精选"}
                </span>
              </div>

              <div className="w-full max-w-[min(100%,42rem)]">
                <div className="group relative overflow-hidden rounded-2xl border border-[#e7e7ef] bg-white shadow-sm dark:border-[#2a2a3a] dark:bg-[#0f0f16]">
                  <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-gradient-to-br from-[#a78bfa]/30 via-[#60a5fa]/20 to-transparent blur-2xl" />
                  <div className="pointer-events-none absolute -bottom-24 -right-24 h-64 w-64 rounded-full bg-gradient-to-tr from-[#f472b6]/20 via-[#34d399]/10 to-transparent blur-2xl" />

                  <div className="relative flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
                    <div className="flex min-w-[240px] flex-1 items-start gap-3">
                      <div className="relative shrink-0">
                        <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-black/5 shadow-sm dark:bg-[#111122] dark:ring-white/10">
                          <img
                            src={featuredAgent.logo}
                            alt=""
                            className="h-8 w-8 object-contain"
                          />
                        </div>
                        <span className="absolute -right-1 -top-1 inline-flex h-4 w-4 rounded-full bg-gradient-to-br from-[#7c3aed] to-[#2563eb] ring-2 ring-white dark:ring-[#0f0f16]" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-[#0f172a] dark:text-[#e4e8ff]">
                            {featuredAgent.name}
                          </h3>
                          <span className="inline-flex shrink-0 items-center rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-medium text-[#334155] dark:bg-white/10 dark:text-[#cfd6e9]">
                            官方
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-[12px] text-[#64748b] dark:text-[#aab3c8]">
                          {featuredAgent.owner}
                        </div>
                        <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-[#334155] dark:text-[#cfd6e9]">
                          {featuredAgent.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex w-full shrink-0 flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
                      {featuredAgent.mode === "custom" && (
                        <button
                          type="button"
                          onClick={() => handleEditCustomAgent(featuredAgent)}
                          className="inline-flex items-center justify-center rounded-full border border-[#e7e7ef] bg-white px-4 py-2 text-sm font-medium text-[#334155] transition hover:bg-[#f8fafc] dark:border-[#2a2a3a] dark:bg-[#181824] dark:text-[#e4e8ff] dark:hover:bg-[#1f1f2e]"
                        >
                          编辑
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => startWithAgent(featuredAgent)}
                        className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-[#4f46e5] to-[#7c3aed] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.01] active:scale-[0.99]"
                      >
                        开始使用
                      </button>
                    </div>
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
                  最近使用
                </div>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                {recentAgents
                  .filter((a) => (featuredAgent?.id ? a.id !== featuredAgent.id : true))
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

          {/* 全部 */}
          <div className="pl-4 pr-4 pb-6">
            <div className="mb-2 text-xs font-semibold tracking-wide text-[#55627a] dark:text-[#b6bdd0]">
              全部
            </div>
            {filteredList.length === 0 ? (
              <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-[#e7e7ef] text-sm text-[#9aa2b2] dark:border-[#2a2a3a] dark:text-[#8f97ad]">
                没有匹配的智能体
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
        title={editingCustomAgent ? "编辑自定义智能体" : "自定义智能体"}
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

