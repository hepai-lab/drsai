import { Network, Pencil, X } from "lucide-react";
import React, { useContext, useEffect } from "react";
import { appContext } from "../../../hooks/provider";
import { useModeConfigStore } from "@/store/modeConfig";
import { Button } from "../../common/Button";
import { agentAPI } from "../../views/api";
import type { Agent, AgentMode } from "@/types/common";

interface AgentCardData {
  logo: string;
  name: string;
  description: string;
  owner: string;
  url: string;
  config: any;
  onClick?: () => void;
  mode?: AgentMode;
  apiKey?: string;
  onRemove?: (id?: string) => void;
  id?: string;
}

interface AgentCardProps {
  agent: AgentCardData;
  onEdit?: (id?: string) => void;
  handleAgentList?: (agents: any[]) => Promise<void>;
  existingAgents?: any[]; // 现有的侧边栏智能体列表
}

const DEFAULT_AVATAR = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iOCIgZmlsbD0iIzRkM2RjMyIvPgo8dGV4dCB4PSIzMiIgeT0iMzgiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkE8L3RleHQ+Cjwvc3ZnPgo=";

const createAgentConfig = (name: string, url: string, apiKey: string, mode?: AgentMode, extendConfig?: any) => ({
  name,
  url,
  apiKey,
  mode,
  ...extendConfig,
});

const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  onEdit,
  handleAgentList,
  existingAgents = [],
}) => {
  const { setSelectedAgent, setConfig } = useModeConfigStore();
  const { user } = useContext(appContext);

  // 添加状态跟踪
  const [isAdding, setIsAdding] = React.useState(false);
  const [isAdded, setIsAdded] = React.useState(false);


  // 检查智能体是否已存在于侧边栏中
  const checkIfAgentExists = React.useCallback(() => {
    return existingAgents.some(existingAgent => {
      // 对于 remote agent，优先通过 id 检查
      if (agent.id && agent.mode === "remote" && existingAgent.id === agent.id) {
        return true;
      }
      // 优先检查名称是否相同
      if (existingAgent.name === agent.name) {
        return true;
      }
      // 对于非 remote agent，如果 mode 相同且配置相同，且 name 也匹配，认为是同一个
      // 这里确保 name 必须匹配，避免因为配置相同而误判不同的 agent
      if (agent.mode && agent.mode !== "remote" &&
        existingAgent.mode === agent.mode &&
        existingAgent.name === agent.name &&
        existingAgent.config?.url === agent.url &&
        existingAgent.config?.apiKey === agent.apiKey) {
        return true;
      }
      return false;
    });
  }, [existingAgents, agent]);

  // 组件初始化时检查是否已存在
  React.useEffect(() => {
    if (existingAgents.length > 0) {
      setIsAdded(checkIfAgentExists());
    }
  }, [existingAgents, checkIfAgentExists]);

  const handleTryClick = async () => {
    const runtimeConfig = createAgentConfig(agent.name, agent.url, agent.apiKey || "", agent.mode, agent.config);

    const agentToSet: Partial<Agent> = {
      ...agent,
      tags: agent.config?.tags,
      config: runtimeConfig,
    };
    setSelectedAgent(agentToSet);
    setConfig(agentToSet);

    window.dispatchEvent(
      new CustomEvent("switchToCurrentSession", {
        detail: { agent: agentToSet, config: agentToSet, clearSession: true },
      })
    );
  };

  const handleAddToSidebar = async () => {
    if (!user?.email || isAdding || isAdded) return;
    setIsAdding(true);
    try {
      const runtimeConfig = createAgentConfig(agent.name, agent.url, agent.apiKey || "", agent.mode, agent.config);

      const agentNewList = await agentAPI.updateAgentList(
        user.email,
        {
          ...agent,
          config: runtimeConfig,
          type: "add",
        }
      );

      if (handleAgentList) {
        await handleAgentList(agentNewList);
      }

      // 添加成功后设置状态
      setIsAdded(true);
    } catch (error) {
      console.error("Failed to add agent to sidebar:", error);
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    agent.onRemove?.(agent.id);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(agent.id);
  };

  return (
    <div className="bg-primary border border-secondary rounded-lg p-6 shadow-md hover:shadow-lg transition-all duration-200 hover:border-magenta-800 group relative w-[360px] h-[285px]">
      {agent.mode === "remote" && (
        <div className="absolute -top-[-0.5px] left-6 flex gap-1 z-20">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium shadow-sm bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            <Network className="w-2.5 h-2.5 mr-0.5" />
            远程
          </span>
        </div>
      )}

      {(agent.mode === "remote" || agent.mode === "custom") && agent.onRemove && (
        <button
          onClick={handleRemoveClick}
          className="absolute top-2 right-2 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
          title="移除智能体"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}

      {agent.mode === "custom" && onEdit && (
        <button
          onClick={handleEditClick}
          className="absolute top-2 right-8 w-5 h-5 bg-blue-500 hover:bg-blue-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
          title="编辑自定义智能体"
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
      )}

      <div className="flex items-start mb-4">
        <div className="flex-shrink-0 w-16 h-16 bg-secondary rounded-lg overflow-hidden mr-3 relative">
          <img
            src={agent.logo}
            alt={`${agent.name} logo`}
            className="w-full h-full object-cover"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src = DEFAULT_AVATAR;
            }}
          />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-primary mb-1 truncate">
            {agent.name}
          </h3>
          <div className="text-xs text-secondary">by {agent.owner}</div>
        </div>
      </div>

      <p className="text-sm text-secondary text-left mb-4 line-clamp-3 min-h-[3rem]">
        {agent.description}
      </p>

      <div className="w-full flex flex-col gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={handleTryClick}
          className="w-full"
        >
          点击试用
        </Button>
        <Button
          variant={isAdded ? "success" : "secondary"}
          size="sm"
          onClick={handleAddToSidebar}
          disabled={isAdding || isAdded}
          isLoading={isAdding}
          className={`w-full transition-all duration-300 ${isAdded
            ? "bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            : "bg-black/5 dark:bg-white/5 backdrop-blur-sm border border-white/20 dark:border-white/10 text-primary hover:bg-accent/10 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/20 transform hover:-translate-y-0.5"
            }`}
        >
          {isAdded ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              已添加
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              添加到侧边栏
            </span>
          )}
        </Button>
      </div>
    </div>
  );
};

export { AgentCard };
export type { AgentCardProps, AgentCardData };