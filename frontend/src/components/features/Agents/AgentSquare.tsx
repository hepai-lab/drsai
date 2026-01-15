import { message } from "antd";
import { Plus, Sparkles, RefreshCw } from "lucide-react";
import React, { useCallback, useContext, useEffect, useState } from "react";
import { parse } from "yaml";
import { appContext } from "../../../hooks/provider";
import { Agent } from "../../../types/common";
import { Button } from "../../common/Button";
import { CustomAgentData } from "../../common/agent-form/CustomAgentForm";
import { agentWorkerAPI, settingsAPI, agentAPI } from "../../views/api";
import { AgentCard, AgentCardData } from "./AgentCard";
import CustomAgentModal from "./CustomAgentModal";
import RemoteAgentModal from "./RemoteAgentModal";
import { getServerUrl } from "../../utils";

interface AgentSquareProps {
  agents: AgentCardData[];
  className?: string;
  handleAgentList?: (agents: any[]) => Promise<void>;
  existingAgents?: any[]; // 现有的侧边栏智能体列表
}

const AgentSquare: React.FC<AgentSquareProps> = ({
  className = "",
  handleAgentList,
  existingAgents = [],
}) => {
  const { user } = useContext(appContext);
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
    apiKey: agent.apiKey,
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
      apiKey: agent.apiKey || config.api_key || config.apiKey,
      onRemove: (agent.mode === "remote" || agent.mode === "custom")
        ? (id?: string) => handleRemoveRemoteAgent(id || agent.id)
        : undefined,
      onClick: () => { },
    };
  }, [user?.email, handleRemoveRemoteAgent]);

  // 提取获取 API Key 和 BaseUrl 的逻辑
  const getApiKeyFromSettings = useCallback(async (userEmail: string) => {
    const settings = await settingsAPI.getSettings(userEmail);
    const parsed = parse(settings.model_configs);
    const modelConfig = parsed?.model_config?.config || {};
    const apiKey = modelConfig.api_key;
    const baseUrl = modelConfig.base_url;
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

      const { apiKey, baseUrl } = await getApiKeyFromSettings(user.email);

      if (!apiKey) {
        throw new Error("API key not found in settings");
      }

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
      await agentWorkerAPI.saveRemoteAgent(user.email, {
        name: config.name,
        url: config.url,
        apiKey: config.apiKey,
        mode: "remote",
        ...agentInfo
      });

      await loadAgentList();
      setIsRemoteModalOpen(false);
    } catch (error) {
      console.error("Failed to save remote agent:", error);
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

      const { apiKey } = await getApiKeyFromSettings(user.email);

      if (!apiKey) {
        message.error("无法刷新：API key 未找到");
        return;
      }

      // 刷新智能体列表（is_refresh=true 会跳过缓存，获取最新数据）
      const agentsData = await agentWorkerAPI.getUserAgents(user.email, apiKey, true);
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
  }, [loadAgentList]);

  useEffect(() => {
    if (isCustomModalOpen) {
      loadAvailableModels();
    }
  }, [isCustomModalOpen, loadAvailableModels]);

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

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* 连接远程/自定义智能体按钮 */}
      <div className="flex justify-between items-center mb-4 pr-4 gap-2 flex-wrap flex-shrink-0">
        <Button
          variant="primary"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          icon={<RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />}
          className="text-xs px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white border-0 shadow-none ml-4"
        >
          刷新
        </Button>
        <div className="flex gap-2">
          <Button
            variant="tertiary"
            size="sm"
            onClick={() => {
              setEditingCustomAgent(null);
              setIsCustomModalOpen(true);
            }}
            icon={<Sparkles className="h-4 w-4" />}
            className="text-sm opacity-75 hover:opacity-100 transition-opacity border border-gray-300 dark:border-gray-600"
          >
            自定义智能体
          </Button>
          <Button
            variant="tertiary"
            size="sm"
            onClick={() => setIsRemoteModalOpen(true)}
            icon={<Plus className="h-4 w-4" />}
            className="text-sm opacity-75 hover:opacity-100 transition-opacity border border-gray-300 dark:border-gray-600"
          >
            连接远程智能体
          </Button>
        </div>
      </div>

      {/* 检查是否没有智能体 */}
      {agentList.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center h-64 flex-1"
        >
          <div className="text-secondary mb-2">当前用户未部署任何智能体</div>
          <div className="text-secondary text-sm">请联系管理员部署智能体或使用默认智能体</div>
        </div>
      ) : (
        <div
          className="pl-4 flex flex-wrap gap-x-6 gap-y-6 overflow-y-auto flex-1 min-h-0 items-start content-start"
        >
          {agentList.map((agent) => (
            <AgentCard
              key={agent.id || agent.name}
              agent={agent}
              handleAgentList={handleAgentList}
              existingAgents={existingAgents}
              onEdit={agent.mode === "custom" ? () => handleEditCustomAgent(agent) : undefined}
            />
          ))}
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

