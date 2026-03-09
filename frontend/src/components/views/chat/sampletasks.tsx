import { useAgentInfo } from "@/components/features/Agents/useAgentInfo";
import { appContext } from "@/hooks/provider";
import React, { useContext, useEffect, useRef, useState } from "react";

interface SampleTasksProps {
  onSelect: (task: string) => void;
  hasInputValue: boolean;
}

// 定义任务和对应的模型配置
const BESIII_TASKS = [
  "帮我测量psi(4260) -> pi+ pi- [J/psi -> mu+ mu-]过程在4.26 GeV能量点上的截面，并且绘制Jpsi（mumu）的不变质量。先规划后执行。",
  "帮我测量Psip -> pi+ pi- [J/psi -> Lambda Lambdabar]过程在3.686GeV能量点上的截面,并且绘制Lambda的能量分布。先规划后执行。",
  "帮我测量Jpsi to eta [phi -> K+ K-]过程在3.097 GeV能量点上的截面,并且绘制eta的动量分布。先规划后执行。",
];

const MAGENTIC_ONE_TASKS = [
  "Search arXiv for the latest papers on computer use agents",
  "检索arXiv上关于高能物理人工智能智能体的最新进展",
];

// 合并所有任务类型
const SAMPLE_TASKS = [...BESIII_TASKS, ...MAGENTIC_ONE_TASKS];

const SampleTasks: React.FC<SampleTasksProps> = ({ onSelect, hasInputValue }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const lastClickPositionRef = useRef<{ x: number; y: number } | null>(null);

  // 截断文本为30个单词
  const truncateText = (text: string, maxWords: number = 20): string => {
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) {
      return text;
    }
    return words.slice(0, maxWords).join(' ') + '...';
  };

  // 获取用户上下文
  const { user, darkMode } = useContext(appContext);
  const { agentInfo } = useAgentInfo(user?.email);

  // 计算下拉列表位置
  useEffect(() => {
    const updateDropdownPosition = () => {
      const textarea = document.querySelector('#queryInput') as HTMLTextAreaElement;
      if (textarea) {
        const rect = textarea.getBoundingClientRect();
        const inputWrapper = textarea.closest('.chat-input-wrapper') as HTMLElement;
        if (inputWrapper) {
          const wrapperRect = inputWrapper.getBoundingClientRect();
          setDropdownPosition({
            top: wrapperRect.bottom + window.scrollY,
            left: wrapperRect.left + window.scrollX,
            width: wrapperRect.width,
          });
        } else {
          // 如果没有找到 wrapper，使用 textarea 的位置
          setDropdownPosition({
            top: rect.bottom + window.scrollY,
            left: rect.left + window.scrollX,
            width: rect.width,
          });
        }
      }
    };

    if (isInputFocused) {
      updateDropdownPosition();
      window.addEventListener('scroll', updateDropdownPosition, true);
      window.addEventListener('resize', updateDropdownPosition);
      return () => {
        window.removeEventListener('scroll', updateDropdownPosition, true);
        window.removeEventListener('resize', updateDropdownPosition);
      };
    }
  }, [isInputFocused]);

  // 监听输入框的焦点事件
  useEffect(() => {
    const handleFocus = () => {
      if (agentInfo?.examples && agentInfo.examples.length > 3) {
        setIsInputFocused(true);
      }
    };

    const handleBlur = (e: FocusEvent) => {
      // 如果点击的是下拉列表内的元素，不隐藏列表
      if (dropdownRef.current && dropdownRef.current.contains(e.relatedTarget as Node)) {
        return;
      }

      // 检查最后一次点击位置是否在下拉列表区域内（包括滚动条）
      if (dropdownRef.current && lastClickPositionRef.current) {
        const rect = dropdownRef.current.getBoundingClientRect();
        const { x, y } = lastClickPositionRef.current;
        const isInsideDropdown =
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom;

        if (isInsideDropdown) {
          return; // 点击在下拉列表内（包括滚动条），不隐藏
        }
      }

      setIsInputFocused(false);
    };

    // 查找输入框元素（ChatInput 中的 textarea）
    const findTextarea = () => {
      // 使用 id 选择器查找输入框
      const textarea = document.querySelector('#queryInput') as HTMLTextAreaElement;
      return textarea;
    };

    const textarea = findTextarea();
    if (textarea) {
      textarea.addEventListener('focus', handleFocus);
      textarea.addEventListener('blur', handleBlur);

      return () => {
        textarea.removeEventListener('focus', handleFocus);
        textarea.removeEventListener('blur', handleBlur);
      };
    }

    // 如果找不到，使用 MutationObserver 等待输入框出现
    const observer = new MutationObserver(() => {
      const textarea = findTextarea();
      if (textarea) {
        textarea.addEventListener('focus', handleFocus);
        textarea.addEventListener('blur', handleBlur);
        observer.disconnect();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    return () => {
      observer.disconnect();
    };
  }, [agentInfo?.examples]);

  // 点击外部时隐藏下拉列表
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // 记录点击位置
      lastClickPositionRef.current = { x: event.clientX, y: event.clientY };

      if (dropdownRef.current) {
        // 获取下拉列表的边界矩形（包括滚动条区域）
        const rect = dropdownRef.current.getBoundingClientRect();
        const clickX = event.clientX;
        const clickY = event.clientY;

        // 检查点击位置是否在下拉列表区域内（包括滚动条）
        const isInsideDropdown =
          clickX >= rect.left &&
          clickX <= rect.right &&
          clickY >= rect.top &&
          clickY <= rect.bottom;

        // 如果点击在下拉列表内（包括滚动条），不隐藏
        if (isInsideDropdown || dropdownRef.current.contains(event.target as Node)) {
          return;
        }

        // 检查是否点击的是输入框
        const textarea = document.querySelector('#queryInput') as HTMLTextAreaElement;
        if (textarea && textarea.contains(event.target as Node)) {
          return; // 点击输入框时不隐藏
        }
        setIsInputFocused(false);
      }
    };

    if (isInputFocused) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isInputFocused]);

  const handleTaskSelect = async (task: (typeof SAMPLE_TASKS)[0]) => {
    if (!user?.email) return;

    try {
      setIsLoading(true);
      onSelect(task);
      setIsInputFocused(false); // 选择后隐藏下拉列表
    } catch (e) {
      console.error("Failed to create session for task:", e);
      // 即使会话创建失败，也要填充任务文本
      onSelect(task);
      setIsInputFocused(false);
    } finally {
      setIsLoading(false);
    }
  };




  const shouldShowDropdown = agentInfo?.examples && agentInfo.examples.length > 3;

  return (
    <div className="mb-8">
      <style>{`
        .sample-tasks-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .sample-tasks-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .sample-tasks-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(156, 163, 175, 0.3);
          border-radius: 3px;
          transition: background 0.2s ease;
        }
        .sample-tasks-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(156, 163, 175, 0.5);
        }
        .sample-tasks-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(156, 163, 175, 0.3) transparent;
        }
      `}</style>
      <div className="mb-4 text-center"></div>
      <div className="flex flex-col gap-3 w-full">
        {shouldShowDropdown && isInputFocused && !hasInputValue && (
          // 超过3个时显示为下拉列表形式（仅在输入框聚焦时显示）
          <div
            ref={dropdownRef}
            className="fixed z-50"
            style={{
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              width: `${dropdownPosition.width}px`,
            }}
          >
            <div
              className="rounded-b-2xl overflow-hidden border-t-0 border-l-0 border-border-primary "

            >
              <div className="max-h-[400px] flex flex-col items-center overflow-y-auto sample-tasks-scrollbar mt-2">
                {agentInfo?.examples?.map((task: string, idx: number) => (
                  <button
                    key={idx}
                    className={`w-[94%]  px-4 py-3 text-left transition-smooth text-primary hover:text-accent border-b last:border-b-0 group ${darkMode === "dark"
                      ? "hover:bg-[#1a1a1a] hover:rounded-lg"
                      : "hover:bg-gray-50 hover:rounded-lg"
                      }`}
                    style={{ borderBottomColor: '#434141' }}
                    onClick={() => handleTaskSelect(task)}
                    disabled={isLoading}
                    type="button"
                    title={task}
                  >
                    <div className="text-sm leading-loose line-clamp-2">
                      {truncateText(task, 22)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {!shouldShowDropdown && (
          // 3个或以下时保持原有的卡片按钮布局
          <div className="flex flex-wrap justify-center gap-3 w-full">
            {agentInfo?.examples?.map((task: string, idx: number) => (
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
                  {task}
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="text-xs text-secondary opacity-0 group-hover:opacity-100 transition-opacity">
                    {isLoading ? "创建会话中..." : "点击创建会话"}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SampleTasks;

