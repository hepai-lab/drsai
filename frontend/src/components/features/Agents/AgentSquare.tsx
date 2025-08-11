import React, { useEffect, useState } from "react";
import { Button } from "../../common/Button";
import { appContext } from "../../../hooks/provider";
import { agentAPI, agentWorkerAPI, settingsAPI } from "../../views/api";
import { parse } from "yaml";

interface AgentCardProps {
  logo: string;
  name: string;
  description: string;
  owner: string;
  url: string;
  config: any;
  onClick?: () => void;
}

// 后端返回的agent数据结构
interface BackendAgentData {
  name: string;
  owner: string;
  description?: string;
  version?: string;
  type?: string;
  [key: string]: any; // 其他可能的字段
}

// 后端API返回的数据结构
interface AgentWorkerResponse {
  status: boolean;
  data: Record<string, BackendAgentData>;
}

const AgentCard: React.FC<AgentCardProps> = ({
  logo,
  name,
  description,
  owner,
  url,
  config,
  onClick,
}) => {
  const handleTryClick = () => {
    const urlWithParams = new URL(url);
    urlWithParams.searchParams.set("mode", "remote-mode");
    urlWithParams.searchParams.set("config", JSON.stringify(config));

    window.open(urlWithParams.toString(), "_blank");

    if (onClick) {
      onClick();
    }
  };

  return (
    <div className="bg-primary border border-secondary rounded-lg p-6 shadow-md hover:shadow-lg transition-all duration-200 hover:border-magenta-800 group">
      {/* Logo */}
      <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 bg-secondary rounded-lg overflow-hidden">
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

      {/* Name */}
      <h3 className="text-lg font-semibold text-primary text-center mb-2 truncate">
        {name}
      </h3>

      {/* Description */}
      <p className="text-sm text-secondary text-center mb-4 line-clamp-3 min-h-[3rem]">
        {description}
      </p>

      {/* Owner */}
      <div className="flex items-center justify-center mb-4">
        <span className="text-xs text-secondary bg-secondary px-2 py-1 rounded-full">
          by {owner}
        </span>
      </div>

      {/* Try Button */}
      <div className="flex justify-center">
        <Button
          variant="primary"
          size="sm"
          onClick={handleTryClick}
          className="px-6 group-hover:bg-magenta-900 transition-colors"
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
  const { darkMode, setDarkMode, user } = React.useContext(appContext);
  const [agentList, setAgentList] = useState<AgentCardProps[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          setAgentList(convertedAgents);
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
    <div
      className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 ${className}`}
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
        />
      ))}
    </div>
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
