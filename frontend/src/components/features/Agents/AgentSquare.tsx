import React, { useEffect, useState, useContext } from "react";
import { Button } from "../../common/Button";
import { appContext } from "../../../hooks/provider";
import { agentWorkerAPI, settingsAPI, SessionAPI } from "../../views/api";
import { parse } from "yaml";
import { useModeConfigStore } from "../../../store/modeConfig";
import RemoteAgentModal from "./RemoteAgentModal";
import { Plus, X, Network } from "lucide-react";

interface AgentCardProps {
  logo: string;
  name: string;
  description: string;
  owner: string;
  url: string;
  config: any;
  onClick?: () => void;
  tags?: string[];
  isRemovable?: boolean;
  onRemove?: () => void;
}





const AgentCard: React.FC<AgentCardProps> = ({
  logo,
  name,
  description,
  owner,
  url,
  config,
  onClick,
  tags = [],
  isRemovable = false,
  onRemove,
}) => {
  const { setSelectedAgent, setMode, setConfig } = useModeConfigStore();
  const { user } = useContext(appContext);

  const handleTryClick = async () => {
    // 创建agent对象，按照新的格式
    const agent = {
      mode: "remote",
      name: name,
      type: "remote" as const,
      description: description,
      config: {
        model: config.model, // 传递当前的Model信息
      },
    };

    // 设置选中的agent
    setSelectedAgent(agent);

    // 同时更新mode和config，这样WebSocket消息就会使用正确的参数
    setMode("remote");
    setConfig({
      model: config.model, // 传递当前的Model信息
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
            agent: name,
          },
          user.email
        );

        // 触发自定义事件，通知切换到 Current Session tab 并设置新Session
        window.dispatchEvent(
          new CustomEvent("switchToCurrentSession", {
            detail: { agent, newSession },
          })
        );
      } else {
        // 如果没有用户，只触发原有的事件
        window.dispatchEvent(
          new CustomEvent("switchToCurrentSession", {
            detail: { agent },
          })
        );
      }
    } catch (error) {
      console.error("Error creating new session:", error);
      // 即使创建Session失败，也要触发原有的事件
      window.dispatchEvent(
        new CustomEvent("switchToCurrentSession", {
          detail: { agent },
        })
      );
    }

    // 保留原有的onClick回调
    if (onClick) {
      onClick();
    }
  };

  return (
    <div className="bg-primary border border-secondary rounded-lg p-6 shadow-md hover:shadow-lg transition-all duration-200 hover:border-magenta-800 group relative">
      {/* 标签 - 定位在卡片上方 */}
      {tags.length > 0 && (
        <div className="absolute -top-[-0.5px] left-6 flex gap-1 z-20">
          {tags.map((tag, index) => (
            <span
              key={index}
              className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium shadow-sm ${tag === "远程"
                ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                }`}
            >
              {tag === "远程" && <Network className="w-2.5 h-2.5 mr-0.5" />}
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* 移除按钮 - 右上角 */}
      {isRemovable && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
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

      {/* Try Button */}
      <div className="w-full">
        <Button
          variant="primary"
          size="sm"
          onClick={handleTryClick}
          className="w-full group-hover:bg-magenta-900 transition-colors"
        >
          点击试用
        </Button>
      </div>
    </div>
  );
};

interface AgentSquareProps {
  agents: AgentCardProps[];
  className?: string;
}

const AgentSquare: React.FC<AgentSquareProps> = ({
  agents,
  className = "",
}) => {
  const { user } = React.useContext(appContext);
  const [agentList, setAgentList] = useState<AgentCardProps[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRemoteModalOpen, setIsRemoteModalOpen] = useState(false);

  // 处理移除远程智能体
  const handleRemoveRemoteAgent = async (agentName: string) => {
    try {
      if (user?.email) {
        // 从后端删除
        await agentWorkerAPI.removeRemoteAgent(user.email, agentName);
        console.log("Remote agent removed from backend successfully");
      }

      // 从前端列表中移除
      setAgentList(prev => prev.filter(agent =>
        !(agent.config?.type === "remote" && agent.config?.remoteConfig?.name === agentName)
      ));

      console.log("Remote agent removed from frontend list");
    } catch (error) {
      console.error("Failed to remove remote agent:", error);
      // 可以添加错误提示
    }
  };

  const handleRemoteAgentSave = async (config: { name: string; url: string; apiKey: string }, agentInfo?: any) => {
    try {
      // 从测试结果中获取智能体信息，如果没有则使用默认值
      const agentDetails = agentInfo?.[config.name] || {};

      // 处理 owner 字段 - 可能是数组或字符串
      let ownerDisplay = "用户";
      if (agentDetails.owner) {
        if (Array.isArray(agentDetails.owner)) {
          ownerDisplay = agentDetails.owner[0] || "用户";
        } else {
          ownerDisplay = agentDetails.owner;
        }
      } else if (agentDetails.author) {
        ownerDisplay = agentDetails.author;
      } else if (user?.email) {
        ownerDisplay = user.email;
      }

      // 创建新的远程智能体卡片，参考其他智能体的结构
      const newRemoteAgent: AgentCardProps = {
        logo: agentDetails.logo || "/api/placeholder/64/64",
        name: agentDetails.name || config.name,
        description: agentDetails.description || "远程智能体 - 自定义连接",
        owner: ownerDisplay,
        url: config.url,
        config: {
          model: config.name, // 保持与其他智能体一致的结构
          temperature: 0.7,
          maxTokens: 2048,
          specialization: "remote",
          version: agentDetails.version,
          type: "remote",
          // 远程智能体特有的配置
          remoteConfig: {
            name: config.name,
            url: config.url,
            apiKey: config.apiKey
          },
          // 包含从远程智能体获取的其他信息
          ...agentDetails
        },
        // 添加标签和移除功能
        tags: ["远程"],
        isRemovable: true,
        onRemove: () => handleRemoveRemoteAgent(config.name),
        onClick: () => {
          // 处理点击事件，可以设置为选中的智能体
          console.log("Selected remote agent:", config.name);
        }
      };

      // 保存到后端 - 移除 createdAt，让数据库自动处理
      if (user?.email) {
        await agentWorkerAPI.saveRemoteAgent(
          user.email,
          config.name,
          {
            name: config.name,
            url: config.url,
            apiKey: config.apiKey,
            agentInfo: agentDetails,
            type: "remote"
            // 移除 createdAt，让数据库的 created_at 字段自动处理
          }
        );
        console.log("Remote agent saved to backend successfully");
      }

      // 添加到智能体列表
      setAgentList(prev => [...prev, newRemoteAgent]);
      setIsRemoteModalOpen(false);

    } catch (error) {
      console.error("Failed to save remote agent:", error);
      // 即使保存到后端失败，也要添加到前端列表
      const newRemoteAgent: AgentCardProps = {
        logo: "/api/placeholder/64/64",
        name: config.name,
        description: "远程智能体 - 自定义连接",
        owner: user?.email || "用户",
        url: config.url,
        config: {
          model: config.name,
          temperature: 0.7,
          maxTokens: 2048,
          specialization: "remote",
          type: "remote",
          remoteConfig: {
            name: config.name,
            url: config.url,
            apiKey: config.apiKey
          }
        },
        onClick: () => {
          console.log("Selected remote agent:", config.name);
        }
      };
      setAgentList(prev => [...prev, newRemoteAgent]);
      setIsRemoteModalOpen(false);
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

          console.log("Loading agent list for user:", user.email);
          const response = await agentWorkerAPI.getAgentList(
            user?.email || "",
            apiKey
          );
          console.log("Agent worker response:", response);

          // 检查响应是否为空
          if (!response || Object.keys(response).length === 0) {
            console.log("No agents found for user");
            setAgentList([]);
            return;
          }

          // 转换后端数据格式为前端需要的格式
          const convertedAgents: AgentCardProps[] = Object.entries(
            response
          ).map(([agentId, agentData]) => {
            console.log("Processing agent:", agentId, agentData);
            return {
              logo: agentData.logo, // 默认logo
              name:
                agentData.name ||
                agentId.split("/").pop() ||
                "Unknown Agent",
              description:
                agentData.description ||
                "专业的AI助手，提供智能对话和任务处理服务",
              owner: agentData.owner || "DrSAI团队",
              url: `https://aiapi.ihep.ac.cn/apiv2/chat/completions?model=${agentId}`,
              config: {
                model: agentId,
                temperature: 0.7,
                maxTokens: 2048,
                specialization: agentData.type || "general",
                version: agentData.version,
                ...agentData, // 包含所有其他字段
              },
            };
          });

          console.log("Converted agents:", convertedAgents);

          // 加载用户保存的远程智能体
          try {
            const userRemoteAgents = await agentWorkerAPI.getUserRemoteAgents(user.email || "");
            console.log("User remote agents:", userRemoteAgents);

            // 转换远程智能体为前端格式，保持与保存时相同的结构
            const remoteAgentCards: AgentCardProps[] = Object.entries(userRemoteAgents).map(([agentName, agentConfig]: [string, any]) => {
              const agentInfo = agentConfig.agentInfo || {};

              // 处理 owner 字段 - 可能是数组或字符串
              let ownerDisplay = "用户";
              if (agentInfo.owner) {
                if (Array.isArray(agentInfo.owner)) {
                  ownerDisplay = agentInfo.owner[0] || "用户";
                } else {
                  ownerDisplay = agentInfo.owner;
                }
              } else if (agentInfo.author) {
                ownerDisplay = agentInfo.author;
              }

              return {
                logo: agentInfo.logo || "/api/placeholder/64/64",
                name: agentInfo.name || agentName,
                description: agentInfo.description || "远程智能体 - 自定义连接",
                owner: ownerDisplay,
                url: agentConfig.url,
                config: {
                  model: agentName, // 保持与其他智能体一致的结构
                  temperature: 0.7,
                  maxTokens: 2048,
                  specialization: "remote",
                  version: agentInfo.version,
                  type: "remote",
                  // 远程智能体特有的配置
                  remoteConfig: {
                    name: agentName,
                    url: agentConfig.url,
                    apiKey: agentConfig.apiKey
                  },
                  // 包含从远程智能体获取的其他信息
                  ...agentInfo
                },
                // 添加标签和移除功能
                tags: ["远程"],
                isRemovable: true,
                onRemove: () => handleRemoveRemoteAgent(agentName),
                onClick: () => {
                  console.log("Selected remote agent:", agentName);
                }
              };
            });

            // 合并远程智能体和普通智能体
            setAgentList([...convertedAgents, ...remoteAgentCards]);
          } catch (remoteError) {
            console.error("Error loading remote agents:", remoteError);
            // 即使远程智能体加载失败，也要显示普通智能体
            setAgentList(convertedAgents);
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
              tags={agent.tags}
              isRemovable={agent.isRemovable}
              onRemove={agent.onRemove}
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
      model: "gpt-4",
      temperature: 0.2,
      maxTokens: 2048,
      specialization: "coding",
    },
  },
  {
    logo: "/api/placeholder/64/64",
    name: "文档写手",
    description:
      "专注于技术文档编写，能够生成清晰、专业的API文档、用户手册和技术规范",
    owner: "文档团队",
    url: "https://example.com/doc-writer",
    config: {
      model: "gpt-4",
      temperature: 0.7,
      maxTokens: 4096,
      specialization: "documentation",
    },
  },
  {
    logo: "/api/placeholder/64/64",
    name: "数据分析师",
    description:
      "强大的数据分析和可视化助手，能够处理各种数据格式，生成洞察报告和图表",
    owner: "数据科学团队",
    url: "https://example.com/data-analyst",
    config: {
      model: "gpt-4",
      temperature: 0.3,
      maxTokens: 3072,
      specialization: "data_analysis",
      tools: ["pandas", "matplotlib", "plotly"],
    },
  },
  {
    logo: "/api/placeholder/64/64",
    name: "UI设计顾问",
    description:
      "专业的UI/UX设计助手，提供界面设计建议、用户体验优化和设计系统指导",
    owner: "设计团队",
    url: "https://example.com/ui-consultant",
    config: {
      model: "gpt-4",
      temperature: 0.8,
      maxTokens: 2048,
      specialization: "ui_design",
    },
  },
  {
    logo: "/api/placeholder/64/64",
    name: "营销策划师",
    description:
      "创意营销策划助手，能够制定营销方案、撰写推广文案和分析市场趋势",
    owner: "营销团队",
    url: "https://example.com/marketing-planner",
    config: {
      model: "gpt-4",
      temperature: 0.9,
      maxTokens: 2048,
      specialization: "marketing",
    },
  },
  {
    logo: "/api/placeholder/64/64",
    name: "客服助手",
    description:
      "智能客户服务助手，提供24/7在线支持，能够快速响应用户问题并提供解决方案",
    owner: "客服团队",
    url: "https://example.com/customer-service",
    config: {
      model: "gpt-3.5-turbo",
      temperature: 0.5,
      maxTokens: 1024,
      specialization: "customer_service",
      knowledge_base: "faq_database",
    },
  },
  {
    logo: "/api/placeholder/64/64",
    name: "翻译专家",
    description:
      "多语种翻译助手，支持50+种语言互译，保持语言的准确性和文化适应性",
    owner: "本地化团队",
    url: "https://example.com/translator",
    config: {
      model: "gpt-4",
      temperature: 0.3,
      maxTokens: 2048,
      specialization: "translation",
      supported_languages: ["zh", "en", "ja", "ko", "fr", "de", "es"],
    },
  },
  {
    logo: "/api/placeholder/64/64",
    name: "安全顾问",
    description:
      "网络安全专家助手，提供安全漏洞检测、安全策略建议和威胁分析服务",
    owner: "安全团队",
    url: "https://example.com/security-advisor",
    config: {
      model: "gpt-4",
      temperature: 0.1,
      maxTokens: 3072,
      specialization: "cybersecurity",
      security_frameworks: ["OWASP", "NIST", "ISO27001"],
    },
  },
];

export { AgentCard, AgentSquare };
export type { AgentCardProps, AgentSquareProps };
