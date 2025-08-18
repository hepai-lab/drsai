import React, { useState, useEffect } from "react";
import { useModeConfigStore } from "../../../store/modeConfig";

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

  // 获取模式配置存储
  const { setMode, setConfig, setSelectedAgent } = useModeConfigStore();

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    handleResize(); // Initial width
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleTaskSelect = (task: (typeof SAMPLE_TASKS)[0]) => {
    // 根据任务类型设置对应的模型配置
    if (task.model === "besiii") {
      // 设置BESIII模型配置
      setMode("besiii");
      setConfig({
        mode: "besiii",
        name: "Dr.Sai BESIII",
        description: "BESIII实验专用智能体，专为高能物理实验优化",
      });
      setSelectedAgent({
        mode: "besiii",
        name: "Dr.Sai BESIII",
        type: "drsai-besiii",
        description: "BESIII实验专用智能体，专为高能物理实验优化",
      });
    } else if (task.model === "magentic-one") {
      // 设置General模型配置
      setMode("magentic-one");
      setConfig({
        mode: "magentic-one",
        name: "Dr.Sai General",
        description: "Dr.Sai通用智能体，适用于多种任务",
      });
      setSelectedAgent({
        mode: "magentic-one",
        name: "Dr.Sai General",
        type: "magentic-one",
        description: "Dr.Sai通用智能体，适用于多种任务",
      });
    }

    // 只填充任务文本到输入框，不发送消息
    onSelect(task.text);
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
              type="button"
              title="点击填充到输入框，可编辑后发送"
            >
              <div className="text-sm leading-relaxed">
                {task.text}
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="text-xs text-secondary font-medium">
                  {task.name}
                </div>
                <div className="text-xs text-secondary opacity-0 group-hover:opacity-100 transition-opacity">
                  点击填充
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
