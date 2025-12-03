import { message } from "antd";
import { Plus, Sparkles } from "lucide-react";
import React, { useCallback, useContext, useEffect, useState } from "react";
import { parse } from "yaml";
import { appContext } from "../../../hooks/provider";
import { Agent } from "../../../types/common";
import { Button } from "../../common/Button";
import { CustomAgentData } from "../../common/agent-form/CustomAgentForm";
import { agentWorkerAPI, settingsAPI, agentAPI } from "../../views/api";
import { AgentCard, AgentCardProps } from "./AgentCard";
import CustomAgentModal from "./CustomAgentModal";
import RemoteAgentModal from "./RemoteAgentModal";

interface AgentSquareProps {
  agents: AgentCardProps[];
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
  const [agentList, setAgentList] = useState<AgentCardProps[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRemoteModalOpen, setIsRemoteModalOpen] = useState(false);
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [editingCustomAgent, setEditingCustomAgent] = useState<any | null>(null);
  const [availableModels, setAvailableModels] = useState<{ id: string }[]>([]);
  const [isModelListLoading, setIsModelListLoading] = useState(false);
  const [modelSourceBaseUrl, setModelSourceBaseUrl] = useState<string | undefined>();
  const [modelSourceApiKey, setModelSourceApiKey] = useState<string | undefined>();
  const [isSavingCustomAgent, setIsSavingCustomAgent] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleRemoveRemoteAgent = useCallback(async (id?: string) => {
    if (!id || !user?.email) return;

    try {
      await agentWorkerAPI.removeRemoteAgent(user.email, id);
      await loadAgentList({ forceRefresh: true });
      console.log("Remote agent removed successfully");
    } catch (error) {
      console.error("Failed to remove remote agent:", error);
    }
  }, [user?.email]);

  const createRemoteAgentCard = useCallback((agent: Agent): AgentCardProps => ({
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
    onClick: () => console.log("Selected remote agent:", agent.name),
  }), [handleRemoveRemoteAgent]);

  const loadRemoteAgents = useCallback(async (userEmail: string): Promise<AgentCardProps[]> => {
    try {
      const userRemoteAgents = await agentWorkerAPI.getUserRemoteAgents(userEmail) ?? [];
      console.log("Loaded remote agents:", userRemoteAgents);
      if (!userRemoteAgents?.length) {
        return [];
      }
      return userRemoteAgents?.map(createRemoteAgentCard) || [];
    } catch (error) {
      console.error("Failed to load remote agents:", error);
      return [];
    }
  }, [createRemoteAgentCard]);

  const loadAgentList = useCallback(async (options?: { forceRefresh?: boolean }) => {
    const forceRefresh = options?.forceRefresh ?? false;

    if (!user?.email) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const settings = await settingsAPI.getSettings(user.email);
      const parsed = parse(settings.model_configs);
      const modelConfig = parsed?.model_config?.config || {};
      const apiKey = modelConfig.api_key;
      const baseUrl = modelConfig.base_url;

      if (!apiKey) {
        throw new Error("API key not found in settings");
      }

      setModelSourceApiKey(apiKey);
      setModelSourceBaseUrl(baseUrl);

      const [standardAgents, remoteAgents] = await Promise.all([
        agentWorkerAPI.getAgentList(user.email, apiKey, forceRefresh),
        loadRemoteAgents(user.email)
      ]);

      const agents = Array.isArray(standardAgents) && standardAgents.length > 0
        ? [...standardAgents, ...remoteAgents]
        : remoteAgents;

      setAgentList(agents);
    } catch (err) {
      console.error("Error loading agent list:", err);
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, [user?.email, loadRemoteAgents]);

  const loadAvailableModels = useCallback(async () => {
    if (!modelSourceBaseUrl) {
      setAvailableModels([]);
      return;
    }

    setIsModelListLoading(true);

    try {
      const normalizedBaseUrl = modelSourceBaseUrl.endsWith("/")
        ? modelSourceBaseUrl.slice(0, -1)
        : modelSourceBaseUrl;
      const modelsUrl = `${normalizedBaseUrl}/models`;

      const response = await fetch(modelsUrl, {
        headers: {
          "Content-Type": "application/json",
          ...(modelSourceApiKey ? { Authorization: `Bearer ${modelSourceApiKey}` } : {}),
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const payload = await response.json();
      const rawList: any[] = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
          ? payload.models
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
  }, [modelSourceBaseUrl, modelSourceApiKey]);

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

      await loadAgentList({ forceRefresh: true });
      setIsRemoteModalOpen(false);
      console.log("Remote agent saved successfully");
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
      await loadAgentList({ forceRefresh: true });
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
    <>
      {/* 连接远程/自定义智能体按钮 */}
      <div className="flex justify-end items-center mb-4 pr-4 gap-2 flex-wrap">
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

      {/* 检查是否没有智能体 */}
      {agentList.length === 0 ? (
        <div
          className={`flex flex-col items-center justify-center h-64 ${className}`}
        >
          <div className="text-secondary mb-2">当前用户未部署任何智能体</div>
          <div className="text-secondary text-sm">请联系管理员部署智能体或使用默认智能体</div>
        </div>
      ) : (
        <div
          className={`pl-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 ${className}`}
        >
          {agentList.map((agent) => (
            <AgentCard
              key={agent.id || agent.name}
              {...agent}
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
    </>
  );
};


export { AgentSquare };
export type { AgentSquareProps };

