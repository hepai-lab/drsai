import { Plus } from "lucide-react";
import React, { useCallback, useContext, useEffect, useState } from "react";
import { parse } from "yaml";
import { appContext } from "../../../hooks/provider";
import { Agent } from "../../../types/common";
import { Button } from "../../common/Button";
import { agentWorkerAPI, settingsAPI } from "../../views/api";
import { AgentCard, AgentCardProps } from "./AgentCard";
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

  const handleRemoveRemoteAgent = useCallback(async (id?: string) => {
    if (!id || !user?.email) return;

    try {
      await agentWorkerAPI.removeRemoteAgent(user.email, id);
      setAgentList(prev => prev.filter(agent =>
        !(agent.mode === "remote" && agent.id === id)
      ));
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
    mode: "remote",
    apiKey: agent.apiKey,
    onRemove: (id?: string) => handleRemoveRemoteAgent(id || agent.id),
    onClick: () => console.log("Selected remote agent:", agent.name),
  }), [handleRemoveRemoteAgent]);

  const loadRemoteAgents = useCallback(async (userEmail: string): Promise<AgentCardProps[]> => {
    try {
      const userRemoteAgents = await agentWorkerAPI.getUserRemoteAgents(userEmail);
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
      const apiKey = parsed.model_config.config.api_key;

      if (!apiKey) {
        throw new Error("API key not found in settings");
      }

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

  useEffect(() => {
    loadAgentList();
  }, [loadAgentList]);

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
      {/* 连接远程智能体小按钮 - 放在右上角 */}
      <div className="flex justify-end items-center mb-4 pr-4">
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
            />
          ))}
        </div>
      )}

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

