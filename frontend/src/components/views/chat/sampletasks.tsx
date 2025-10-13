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
    text: "Search arXiv for the latest papers on computer use agents",
    model: "besiii",
    name: "Dr.Sai BESIII",
  },
];

const MAGENTIC_ONE_TASKS = [
  {
    text: "为什么现代人越来越难集中注意力？从认知科学和生活方式角度分析原因，并提出一些实用可行的改善建议。",
    model: "magentic-one",
    name: "Dr.Sai General",
  },
  {
    text: "电动车真的比燃油车更环保吗？从全生命周期角度比较碳排放、资源消耗和环境影响，给出客观分析。",
    model: "magentic-one",
    name: "Dr.Sai General",
  },
  {
    text: "远程工作是未来趋势吗？分析其对生产力、创新能力和工作生活平衡的影响，讨论企业和个人的应对策略。",
    model: "magentic-one",
    name: "Dr.Sai General",
  },
  {
    text: "人工智能会取代人类创造力吗？探讨AI在艺术、音乐和文学创作中的作用，分析人类创造力和AI生成内容的本质区别。",
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

