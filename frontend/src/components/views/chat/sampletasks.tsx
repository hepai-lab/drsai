import React, { useState, useEffect, useContext } from "react";
import { useModeConfigStore } from "../../../store/modeConfig";
import { sessionAPI } from "../api";
import { appContext } from "../../../hooks/provider";

interface SampleTasksProps {
  onSelect: (task: string) => void;
}

// 定义任务和对应的模型配置
const SAMPLE_TASKS = [
  {
    text: "帮我测量psi(4260) -> pi+ pi- [J/psi -> mu+ mu-]过程在4.26 GeV能量点上的截面，并且绘制Jpsi（mumu）的不变质量。先规划后执行。",
    model: "besiii",
    name: "Dr.Sai BESIII",
  },
  {
    text: "Search arXiv for the latest papers on computer use agents",
    model: "magentic-one",
    name: "Dr.Sai General",
  },
];

const SampleTasks: React.FC<SampleTasksProps> = ({ onSelect }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [windowWidth, setWindowWidth] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // 获取用户上下文
  const { user } = useContext(appContext);

  // 获取模式配置存储和会话管理
  const { setMode, setConfig, setSelectedAgent } = useModeConfigStore();

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    handleResize(); // Initial width
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleTaskSelect = async (task: (typeof SAMPLE_TASKS)[0]) => {
    if (!user?.email) return;

    try {
      setIsLoading(true);

      // 根据任务类型创建对应的 agent 对象
      let agent;
      if (task.model === "besiii") {
        agent = {
          mode: "besiii" as const,
          name: "Dr.Sai BESIII",
          description: "BESIII实验专用智能助手",
          config: {
            url: "",
            apikey: ""
          }
        };
      } else if (task.model === "magentic-one") {
        agent = {
          mode: "magentic-one" as const,
          name: "Dr.Sai General",
          description: "通用智能助手",
          config: {
            url: "",
            apikey: ""
          }
        };
      }

      if (agent) {
        // 设置选中的 agent 和配置
        setSelectedAgent(agent);
        setConfig({ mode: agent.mode });

        // 创建新会话
        const created = await sessionAPI.createSession(
          {
            name:
              `${agent.name} - ` +
              new Date().toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
            agent_mode_config: {
              mode: agent.mode,
              name: agent.name,
              description: agent.description,
              url: agent.config.url,
              apikey: agent.config.apikey,
            },
          },
          user.email
        );

        // 触发自定义事件，通知其他组件会话已创建
        window.dispatchEvent(
          new CustomEvent("switchToCurrentSession", {
            detail: {
              agent: agent,
              newSession: created,
            },
          })
        );

        // 确保会话创建完成后立即填充任务文本到输入框
        // 直接调用，不使用延迟
        onSelect(task.text);
      } else {
        // 如果没有创建 agent，直接填充任务文本
        onSelect(task.text);
      }
    } catch (e) {
      console.error("Failed to create session for task:", e);
      // 即使会话创建失败，也要填充任务文本
      onSelect(task.text);
    } finally {
      setIsLoading(false);
    }
  };

  const isLargeScreen = windowWidth >= 1024; // lg breakpoint
  const tasksPerRow = windowWidth >= 640 ? 2 : 1; // 2 columns on sm, 1 on mobile
  const defaultVisibleTasks = tasksPerRow * 2;
  const maxVisibleTasks = isLargeScreen
    ? SAMPLE_TASKS.length
    : isExpanded
      ? SAMPLE_TASKS.length
      : defaultVisibleTasks;
  const visibleTasks = SAMPLE_TASKS.slice(0, maxVisibleTasks);
  const shouldShowToggle =
    !isLargeScreen && SAMPLE_TASKS.length > defaultVisibleTasks;

  return (
    <div className="mb-8">
      <div className="mb-4 text-center"></div>
      <div className="flex flex-col gap-3 w-full">
        <div className="inline-flex flex-wrap justify-center gap-3 w-full">
          {visibleTasks.map((task, idx) => (
            <button
              key={idx}
              className="max-w-80 rounded-2xl px-6 py-4 text-left transition-smooth text-primary hover:text-accent bg-tertiary/50 hover:bg-tertiary/70 backdrop-blur-sm border border-border-primary hover:border-accent/50 shadow-modern hover:shadow-modern-lg hover-lift animate-fade-in group"
              style={{ animationDelay: `${idx * 0.1}s` }}
              onClick={() => handleTaskSelect(task)}
              disabled={isLoading}
              type="button"
              title="点击创建会话并填充到输入框，可编辑后发送"
            >
              <div className="text-sm leading-relaxed">
                {task.text}
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="text-xs text-secondary font-medium">
                  {task.name}
                </div>
                <div className="text-xs text-secondary opacity-0 group-hover:opacity-100 transition-opacity">
                  {isLoading ? "创建会话中..." : "点击创建会话"}
                </div>
              </div>
            </button>
          ))}
        </div>
        {shouldShowToggle && (
          <button
            className="text-secondary hover:text-accent transition-smooth text-sm font-medium mt-2 px-4 py-2 rounded-xl hover:bg-tertiary/30 mx-auto"
            onClick={() => setIsExpanded(!isExpanded)}
            type="button"
          >
            {isExpanded
              ? "Show less..."
              : "Show more sample tasks..."}
          </button>
        )}
      </div>
    </div>
  );
};

export default SampleTasks;

