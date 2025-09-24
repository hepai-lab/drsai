import React, { useEffect, useState, useContext } from "react";
import { Button } from "../../common/Button";
import { appContext } from "../../../hooks/provider";
import { agentWorkerAPI, settingsAPI, SessionAPI } from "../../views/api";
import { agentAPI } from "../../views/api";
import { parse } from "yaml";
import { useModeConfigStore } from "../../../store/modeConfig";
import RemoteAgentModal from "./RemoteAgentModal";
import { Plus, X, Network, MoreVertical, Trash2 } from "lucide-react";
import { Agent } from "../../../types/common";

interface AgentCardProps {
  logo: string;
  name: string;
  description: string;
  owner: string;
  url: string;
  config: any;
  onClick?: () => void;
  mode?: string;
  apiKey?: string;
  onRemove?: (id?: string) => void;
  handleAgentList?: (agents: any[]) => Promise<void>;
  id?: string;
}

const AgentCard: React.FC<AgentCardProps> = ({
  logo,
  name,
  description,
  owner,
  url,
  mode,
  config,
  apiKey,
  onClick,
  onRemove,
  handleAgentList,
  id,
}) => {
  const { setSelectedAgent, setConfig } = useModeConfigStore();
  const { user } = useContext(appContext);

  const handleTryClick = async () => {
    // 创建agent对象，按照新的格式
    const agent = {
      mode,
      name, // 传递当前的Model信息
    };

    // 设置选中的agent
    setSelectedAgent({ name, mode });

    setConfig({
      name, // 传递当前的Model信息
      url,
      apiKey,
      mode,
    });

    // 创建新Session
    try {
      if (user?.email) {
        const sessionAPI = new SessionAPI();
        const newSession = await sessionAPI.createSession(
          {
            name: `${name} - ${new Date().toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}`,
            agent_mode_config: {
              name, // 传递当前的Model信息
              url,
              apiKey,
              mode,
            },
          },
          user.email
        );

        // 触发自定义事件，通知切换到 Current Session tab 并设置新Session
        window.dispatchEvent(
          new CustomEvent("switchToCurrentSession", {
            detail: { agent, newSession },
          })
        );
      }
    } catch (error) {

    }
  };

  const AddMainAgent = async () => {

    // Add agent to the list
    try {
      if (user?.email) {
        const AgentNewList =  await agentAPI.updateAgentList(
          user.email,
          {
            "mode":mode,
            "name":name,
            "logo":logo,
            "description":description,
            "config": {
              "url":url,
              "apiKey": apiKey,
            },
            "type": "add",

          },
        );
        if (handleAgentList) {
          await handleAgentList(AgentNewList);
        }
      }
    } catch (error) {

    }

  };

  return (
    <div className="bg-primary border border-secondary rounded-lg p-6 shadow-md hover:shadow-lg transition-all duration-200 hover:border-magenta-800 group relative">
      {/* 标签 - 定位在卡片上方 */}
      {mode === "remote" && (
        <div className="absolute -top-[-0.5px] left-6 flex gap-1 z-20">
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium shadow-sm bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
            >
              <Network className="w-2.5 h-2.5 mr-0.5" />
              远程
            </span>
        </div>
      )}

    

      {/* 移除按钮 - 右上角（远程智能体专用） */}
      {mode === "remote" && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(id);
          }}
          className="absolute top-2 right-2 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
          title="移除智能体"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}

      {/* Logo, Name and Owner Section */}
      <div className="flex items-start mb-4">
        {/* Logo with Badge */}
        <div className="flex-shrink-0 w-16 h-16 bg-secondary rounded-lg overflow-hidden mr-3 relative">
          <img
            src={logo}
            alt={`${name} logo`}
            className="w-full h-full object-cover"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src =
                "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iOCIgZmlsbD0iIzRkM2RjMyIvPgo8dGV4dCB4PSIzMiIgeT0iMzgiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkE8L3RleHQ+Cjwvc3ZnPgo=";
            }}
          />


        </div>

        {/* Name and Owner */}
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-primary mb-1 truncate">
            {name}
          </h3>
          <div className="text-xs text-secondary">by {owner}</div>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-secondary text-left mb-4 line-clamp-3 min-h-[3rem]">
        {description}
      </p>

      {/* Action Buttons */}
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
          onClick={AddMainAgent}
          className="w-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          添加到侧边栏
        </Button>
      </div>
    </div>
  );
};

interface AgentSquareProps {
  agents: AgentCardProps[];
  className?: string;
  handleAgentList?: (agents: any[]) => Promise<void>;
}

const AgentSquare: React.FC<AgentSquareProps> = ({
  className = "",
  handleAgentList,
}) => {
  const { user } = React.useContext(appContext);
  const [agentList, setAgentList] = useState<AgentCardProps[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRemoteModalOpen, setIsRemoteModalOpen] = useState(false);

  // 处理移除远程智能体
  const handleRemoveRemoteAgent = async (id?: string) => {

    if (!id) return;
    try {
      if (user?.email) {
        // 从后端删除
        await agentWorkerAPI.removeRemoteAgent(user.email, id);
      }

      // 从前端列表中移除
      setAgentList(prev => prev.filter(agent =>
        !(agent.mode === "remote" && agent.id === id)
      ));

      console.log("Remote agent removed from frontend list");
    } catch (error) {
      console.error("Failed to remove remote agent:", error);
      // 可以添加错误提示
    }
  };

  const handleRemoteAgentSave = async (config: any, agentInfo?: any) => {
    try {

      // 保存到后端 - 移除 createdAt，让数据库自动处理
      if (user?.email) {
        await agentWorkerAPI.saveRemoteAgent(
          user.email,
          {
            name: config.name,
            url: config.url,
            apiKey: config.apiKey,
            mode: "remote",
            ...agentInfo
          }
        );
      }

      const newRemoteAgents = await agentWorkerAPI.getUserRemoteAgents(user?.email || "");
      console.log("New remote agent saved to backend:", newRemoteAgents);

      // 获取最新添加的远程智能体并创建完整的AgentCard对象
      const latestAgent = newRemoteAgents[newRemoteAgents.length - 1];
      const newRemoteAgentCard: AgentCardProps = {
        id: latestAgent.id,
        logo: latestAgent.logo || "/api/placeholder/64/64",
        name: latestAgent.name,
        description: latestAgent.description || "远程智能体 - 自定义连接",
        owner: latestAgent.owner || "未知",
        url: latestAgent.url,
        config: latestAgent.config,
        mode: "remote",
        apiKey: latestAgent.apiKey,
        onRemove: (id?: string) => handleRemoveRemoteAgent(id || latestAgent.id),
        onClick: () => console.log("Selected remote agent:", latestAgent.name),
      };

      // 添加到智能体列表
      setAgentList(prev => [...prev, newRemoteAgentCard]);
      setIsRemoteModalOpen(false);

    } catch (error) {
      console.error("Failed to save remote agent:", error);
    }
  };


  useEffect(() => {
    const loadAgentList = async () => {
      if (user) {
        try {
          setLoading(true);
          setError(null);

          // 获取用户设置以获取apiKey
          const settings = await settingsAPI.getSettings(
            user?.email || ""
          );
          const parsed = parse(settings.model_configs);
          const apiKey = parsed.model_config.config.api_key;

          if (!apiKey) {
            throw new Error("API key not found in settings");
          }

          const response = await agentWorkerAPI.getAgentList(
            user?.email || "",
            apiKey
          );

          // 检查响应是否为空
          if (!response || Object.keys(response).length === 0) {
            console.log("No agents found for user");
            setAgentList([]);
            return;
          }

          // 加载用户保存的远程智能体
          try {
            const userRemoteAgents = await agentWorkerAPI.getUserRemoteAgents(user.email || "");

            const remoteAgentCards: AgentCardProps[] = userRemoteAgents?.map((agent: Agent) => ({
              id: agent.id,
              logo: agent.logo || "/api/placeholder/64/64",
              name: agent.name,
              description: agent.description || "远程智能体 - 自定义连接",
              owner: agent.owner || "未知",
              url: agent.url,
              config: agent.config,
              mode: "remote",
              apiKey: agent.apiKey,
              onRemove: (id?: string) => handleRemoveRemoteAgent(id || agent.id),
              onClick: () => console.log("Selected remote agent:", agent.name),
            }));


            // 合并远程智能体和普通智能体
            setAgentList([...response, ...remoteAgentCards]);
          } catch (remoteError) {
            console.error("Error loading remote agents:", remoteError);
            // 即使远程智能体加载失败，也要显示普通智能体
            setAgentList(response);
          }
        } catch (err) {
          console.error("Error loading agent list:", err);
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load agents"
          );
          // 如果加载失败，使用mock数据作为fallback
          setAgentList(mockAgents);
        } finally {
          setLoading(false);
        }
      } else {
        // 如果没有用户，使用mock数据
        console.log("No user found, using mock data");
        setAgentList(mockAgents);
        setLoading(false);
      }
    };

    loadAgentList();
  }, [user]);

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
          {agentList.map((agent, index) => (
            <AgentCard
              key={index}
              logo={agent.logo}
              name={agent.name}
              description={agent.description}
              owner={agent.owner}
              url={agent.url}
              config={agent.config}
              onClick={agent.onClick}
              mode={agent.mode}
              apiKey={agent.apiKey}
              onRemove={agent.onRemove}
              handleAgentList={handleAgentList}
              id={agent.id || agent.name}
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

// Mock data for testing
export const mockAgents: AgentCardProps[] = [
  {
    logo: "/api/placeholder/64/64",
    name: "代码助手",
    description:
      "专业的代码生成和代码审查助手，支持多种编程语言，能够帮助你编写高质量的代码",
    owner: "DrSAI团队",
    url: "https://example.com/code-assistant",
    config: {
      name: "gpt-4",
    },
  },
];

export { AgentCard, AgentSquare };
export type { AgentCardProps, AgentSquareProps };
