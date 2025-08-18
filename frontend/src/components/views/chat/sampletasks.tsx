import React, { useState, useEffect } from "react";

interface SampleTasksProps {
  onSelect: (task: string) => void;
}

const SAMPLE_TASKS = [
  "帮我测量psi(4260) -> pi+ pi- [J/psi -> mu+ mu-]过程在4.26 GeV能量点上的截面，并且绘制Jpsi（mumu）的不变质量。先规划后执行。",
  // "When does the post office near me close today?",
  // "Find the latest publications from the the Microsoft Research AI Frontiers Lab on Human-Agent interaction",
  // "Which commit of Microsoft/markitdown repo introduced MCP support?",
  // "Can you make a Markdown file with python that summarizes the Microsoft AutoGen repo?",
  // "Order me a custom pizza from Tangle Town Pub with sausage, pineapple, and black olives",
  "Search arXiv for the latest papers on computer use agents",
];

const SampleTasks: React.FC<SampleTasksProps> = ({ onSelect }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [windowWidth, setWindowWidth] = useState(0);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    handleResize(); // Initial width
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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
      <div className="mb-4 text-center">
      </div>
      <div className="flex flex-col gap-3 w-full">
        <div className="inline-flex flex-wrap justify-center gap-3 w-full">
          {visibleTasks.map((task, idx) => (
            <button
              key={idx}
              className="max-w-80 rounded-2xl px-6 py-4 text-left transition-smooth text-primary hover:text-accent bg-tertiary/50 hover:bg-tertiary/70 backdrop-blur-sm border border-border-primary hover:border-accent/50 shadow-modern hover:shadow-modern-lg hover-lift animate-fade-in"
              style={{ animationDelay: `${idx * 0.1}s` }}
              onClick={() => onSelect(task)}
              type="button"
            >
              <div className="text-sm leading-relaxed">{task}</div>
            </button>
          ))}
        </div>
        {shouldShowToggle && (
          <button
            className="text-secondary hover:text-accent transition-smooth text-sm font-medium mt-2 px-4 py-2 rounded-xl hover:bg-tertiary/30 mx-auto"
            onClick={() => setIsExpanded(!isExpanded)}
            type="button"
          >
            {isExpanded ? "Show less..." : "Show more sample tasks..."}
          </button>
        )}
      </div>
    </div>
  );
};

export default SampleTasks;
