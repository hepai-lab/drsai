import { useModeConfigStore } from "@/store/modeConfig";
import React, { useContext, useEffect, useState } from "react";
import { appContext } from "@/hooks/provider";

interface SampleTasksProps {
  onSelect: (task: string) => void;
}

// 定义任务和对应的模型配置
const BESIII_TASKS = [
  {
    text: "帮我测量psi(4260) -> pi+ pi- [J/psi -> mu+ mu-]过程在4.26 GeV能量点上的截面，并且绘制Jpsi（mumu）的不变质量。先规划后执行。",
    model: "besiii",
    name: "Dr.Sai BESIII",
  },
  {
    text: "帮我测量Psip -> pi+ pi- [J/psi -> Lambda Lambdabar]过程在3.686GeV能量点上的截面,并且绘制Lambda的能量分布。先规划后执行。",
    model: "besiii",
    name: "Dr.Sai BESIII",
  },
  {
    text: "帮我测量Jpsi to eta [phi -> K+ K-]过程在3.097 GeV能量点上的截面,并且绘制eta的动量分布。先规划后执行。",
    model: "besiii",
    name: "Dr.Sai BESIII",
  }
];

const MAGENTIC_ONE_TASKS = [
  {
    text: "Search arXiv for the latest papers on computer use agents",
    model: "magentic-one",
    name: "Dr.Sai General",
  },
  {
    text: "检索arXiv上关于高能物理人工智能智能体的最新进展",
    model: "magentic-one",
    name: "Dr.Sai General",
  },
];

// 合并所有任务类型
const SAMPLE_TASKS = [...BESIII_TASKS, ...MAGENTIC_ONE_TASKS];

const SampleTasks: React.FC<SampleTasksProps> = ({ onSelect }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [windowWidth, setWindowWidth] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // 获取用户上下文
  const { user } = useContext(appContext);

  // 获取模式配置存储和会话管理
  const { selectedAgent } = useModeConfigStore();

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
      onSelect(task.text);

    } catch (e) {
      console.error("Failed to create session for task:", e);
      // 即使会话创建失败，也要填充任务文本
      onSelect(task.text);
    } finally {
      setIsLoading(false);
    }
  };

  // 检查当前选中的agent是否支持sample tasks
  const shouldShowSampleTasks = () => {
    if (!selectedAgent?.name) {
      return true; // 没有选择agent时显示所有任务
    }

    // 只在这两个特定agent名称时显示sample tasks
    return selectedAgent.name === "Dr.Sai General" || selectedAgent.name === "Dr.Sai BESIII";
  };

  if (!shouldShowSampleTasks()) {
    return null;
  }

  // 根据选中的agent过滤任务
  const getFilteredTasks = () => {
    if (!selectedAgent?.name) {
      return SAMPLE_TASKS;
    }

    // 根据选中的agent名字过滤对应的任务
    return SAMPLE_TASKS.filter(task => task.name === selectedAgent.name);
  };

  const filteredTasks = getFilteredTasks();

  const isLargeScreen = windowWidth >= 1024; // lg breakpoint
  const tasksPerRow = windowWidth >= 640 ? 2 : 1; // 2 columns on sm, 1 on mobile
  const defaultVisibleTasks = tasksPerRow * 2;
  const maxVisibleTasks = isLargeScreen
    ? filteredTasks.length
    : isExpanded
      ? filteredTasks.length
      : defaultVisibleTasks;
  const visibleTasks = filteredTasks.slice(0, maxVisibleTasks);
  const shouldShowToggle =
    !isLargeScreen && SAMPLE_TASKS.length > defaultVisibleTasks;

  return (
    <div className="mb-8">
      <div className="mb-4 text-center"></div>
      <div className="flex flex-col gap-3 w-full">
        <div className="flex flex-wrap justify-center gap-3 w-full">
          {visibleTasks.map((task, idx) => (
            <button
              key={idx}
              className="flex-1 min-w-[280px] max-w-[400px] rounded-2xl px-6 py-4 text-left transition-smooth text-primary hover:text-accent bg-tertiary/50 hover:bg-tertiary/70 backdrop-blur-sm border border-border-primary hover:border-accent/50 shadow-modern hover:shadow-modern-lg hover-lift animate-fade-in group"
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

