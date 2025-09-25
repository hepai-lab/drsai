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
}) => {
  const { setSelectedAgent, setConfig } = useModeConfigStore();
  const { user } = useContext(appContext);

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
    if (!user?.email) return;

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
    } catch (error) {
      console.error("Failed to add agent to sidebar:", error);
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
          className="w-full group-hover:bg-magenta-900 transition-colors"
        >
          点击试用
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleAddToSidebar}
          className="w-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          添加到侧边栏
        </Button>
      </div>
    </div>
  );
};

export { AgentCard };
export type { AgentCardProps };