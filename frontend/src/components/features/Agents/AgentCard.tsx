import { Network, X } from "lucide-react";
import React, { useContext } from "react";
import { appContext } from "../../../hooks/provider";
import { useModeConfigStore } from "@/store/modeConfig";
import { Button } from "../../common/Button";
import { agentAPI, SessionAPI } from "../../views/api";
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
  handleAgentList?: (agents: any[]) => Promise<void>;
  id?: string;
  existingAgents?: any[]; // 现有的侧边栏智能体列表
}

const DEFAULT_AVATAR = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iOCIgZmlsbD0iIzRkM2RjMyIvPgo8dGV4dCB4PSIzMiIgeT0iMzgiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkE8L3RleHQ+Cjwvc3ZnPgo=";

const createSessionName = (name: string): string => {
  return `${name} - ${new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

const createAgentConfig = (name: string, url: string, apiKey: string, mode?: AgentMode) => ({
  name,
  url,
  apiKey,
  mode,
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
  handleAgentList,
  id,
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
      // 检查名称是否相同
      if (existingAgent.name === name) {
        return true;
      }
      // 检查配置是否相同
      if (existingAgent.mode === mode &&
        existingAgent.config?.url === url &&
        existingAgent.config?.apiKey === apiKey) {
        return true;
      }
      return false;
    });
  }, [existingAgents, name, mode, url, apiKey]);

  // 组件初始化时检查是否已存在
  React.useEffect(() => {
    if (existingAgents.length > 0) {
      setIsAdded(checkIfAgentExists());
    }
  }, [existingAgents, checkIfAgentExists]);

  const handleTryClick = async () => {
    const agent: Partial<Agent> = { mode, name };
    const config = createAgentConfig(name, url, apiKey || "", mode);

    setSelectedAgent({ name, mode });
    setConfig(config);

    if (!user?.email) return;

    try {
      const sessionAPI = new SessionAPI();
      const newSession = await sessionAPI.createSession(
        {
          name: createSessionName(name),
          agent_mode_config: config,
        },
        user.email
      );

      window.dispatchEvent(
        new CustomEvent("switchToCurrentSession", {
          detail: { agent, newSession },
        })
      );
    } catch (error) {
      console.error("Failed to create session:", error);
    }
  };

  const handleAddToSidebar = async () => {
    if (!user?.email || isAdding || isAdded) return;

    setIsAdding(true);
    try {
      const agentNewList = await agentAPI.updateAgentList(
        user.email,
        {
          mode,
          name,
          logo,
          description,
          config: {
            url,
            apiKey,
          },
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

  return (
    <div className="bg-primary border border-secondary rounded-lg p-6 shadow-md hover:shadow-lg transition-all duration-200 hover:border-magenta-800 group relative">
      {mode === "remote" && (
        <div className="absolute -top-[-0.5px] left-6 flex gap-1 z-20">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium shadow-sm bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            <Network className="w-2.5 h-2.5 mr-0.5" />
            远程
          </span>
        </div>
      )}

      {mode === "remote" && onRemove && (
        <button
          onClick={handleRemoveClick}
          className="absolute top-2 right-2 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
          title="移除智能体"
        >
          <X className="w-2.5 h-2.5" />
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
export type { AgentCardProps };