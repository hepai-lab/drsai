import { Mail, Network, Pencil, Plus, X, Check } from "lucide-react";
import React, { useContext, useEffect } from "react";
import { appContext } from "../../../hooks/provider";
import { useModeConfigStore } from "@/store/modeConfig";
import { Button } from "../../common/Button";
import { agentAPI } from "../../views/api";
import type { Agent, AgentMode } from "@/types/common";

interface AgentCardProps {
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
  onEdit?: (id?: string) => void;
  handleAgentList?: (agents: any[]) => Promise<void>;
  id?: string;
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
  logo,
  name,
  description,
  owner,
  url,
  mode,
  apiKey,
  onRemove,
  onEdit,
  handleAgentList,
  id,
  existingAgents = [],
  config: extendConfig,
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
      if (id && mode === "remote" && existingAgent.id === id) {
        return true;
      }
      // 优先检查名称是否相同
      if (existingAgent.name === name) {
        return true;
      }
      // 对于非 remote agent，如果 mode 相同且配置相同，且 name 也匹配，认为是同一个
      // 这里确保 name 必须匹配，避免因为配置相同而误判不同的 agent
      if (mode && mode !== "remote" &&
        existingAgent.mode === mode &&
        existingAgent.name === name &&
        existingAgent.config?.url === url &&
        existingAgent.config?.apiKey === apiKey) {
        return true;
      }
      return false;
    });
  }, [existingAgents, name, mode, url, apiKey, id]);

  // 组件初始化时检查是否已存在
  React.useEffect(() => {
    if (existingAgents.length > 0) {
      setIsAdded(checkIfAgentExists());
    }
  }, [existingAgents, checkIfAgentExists]);

  const handleTryClick = async () => {
    const runtimeConfig = createAgentConfig(name, url, apiKey || "", mode, extendConfig);

    const agent: Partial<Agent> = {
      id,
      name,
      mode,
      description,
      logo,
      owner,
      url,
      apiKey,
      tags: extendConfig?.tags,
      config: runtimeConfig,
    };

    setSelectedAgent(agent);
    setConfig(runtimeConfig);

    window.dispatchEvent(
      new CustomEvent("switchToCurrentSession", {
        detail: { agent, config: runtimeConfig, clearSession: true },
      })
    );
  };

  const handleAddToSidebar = async () => {
    if (!user?.email || isAdding || isAdded) return;
    setIsAdding(true);
    try {
      const runtimeConfig = createAgentConfig(name, url, apiKey || "", mode, extendConfig);

      const agentNewList = await agentAPI.updateAgentList(
        user.email,
        {
          mode,
          name,
          logo,
          description,
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
    onRemove?.(id);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(id);
  };

  return (
    <div className="bg-primary border border-secondary rounded-lg px-6 pt-6 pb-0 shadow-md hover:shadow-lg transition-all duration-200 hover:border-magenta-800 group relative max-w-[350px] w-full">
      {mode === "remote" && (
        <div className="absolute -top-[-0.5px] left-6 flex gap-1 z-20">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium shadow-sm bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            <Network className="w-2.5 h-2.5 mr-0.5" />
            远程
          </span>
        </div>
      )}

      {(mode === "remote" || mode === "custom") && onRemove && (
        <button
          onClick={handleRemoveClick}
          className="absolute top-2 right-2 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
          title="移除智能体"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}

      {mode === "custom" && onEdit && (
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
            src={logo}
            alt={`${name} logo`}
            className="w-full h-full object-cover"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src = DEFAULT_AVATAR;
            }}
          />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-primary mb-1 truncate">
            {name}
          </h3>
          <div className="text-xs text-secondary">by {owner}</div>
        </div>
      </div>

      <p className="text-sm text-secondary text-left mb-4 line-clamp-3 min-h-[3rem]">
        {description}
      </p>

      <div className="w-full border-t border-secondary/30 mt-4">
        <div className="flex items-stretch divide-x divide-secondary/30">
          <Button
            variant="tertiary"
            size="sm"
            onClick={handleTryClick}
            className="flex-1 !rounded-none bg-transparent hover:bg-white/5 text-primary gap-2 justify-center border-0 h-12"
          >
            <Mail className="w-4 h-4" />
            <span>点击试用</span>
          </Button>
          <Button
            variant="tertiary"
            size="sm"
            onClick={handleAddToSidebar}
            disabled={isAdding || isAdded}
            isLoading={isAdding}
            className="flex-1 !rounded-none bg-transparent hover:bg-white/5 text-primary gap-2 justify-center border-0 h-12"
          >
            {isAdded ? (
              <>
                <Check className="w-4 h-4" />
                <span>已添加</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                <span>添加到侧边栏</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export { AgentCard };
export type { AgentCardProps };