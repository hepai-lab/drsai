import { useAgentInfo } from "@/components/features/Agents/useAgentInfo";
import { appContext } from "@/hooks/provider";
import React, { useContext, useEffect, useRef, useState } from "react";

interface SampleTasksProps {
  onSelect: (task: string) => void;
  hasInputValue: boolean;
}

const SampleTasks: React.FC<SampleTasksProps> = ({ onSelect }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const truncateText = (text: string, maxWords: number = 20): string => {
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(" ") + "...";
  };

  const { user, darkMode } = useContext(appContext);
  const { agentInfo } = useAgentInfo(user?.email);

  // 监听输入框焦点
  useEffect(() => {
    const handleFocus = () => {
      if (agentInfo?.examples && agentInfo.examples.length > 3) {
        setIsInputFocused(true);
      }
    };

    const handleBlur = (e: FocusEvent) => {
      if (dropdownRef.current && dropdownRef.current.contains(e.relatedTarget as Node)) {
        return;
      }
      setIsInputFocused(false);
    };

    const findTextarea = () =>
      document.querySelector("#queryInput") as HTMLTextAreaElement | null;

    const attach = (ta: HTMLTextAreaElement) => {
      ta.addEventListener("focus", handleFocus);
      ta.addEventListener("blur", handleBlur);
    };

    const textarea = findTextarea();
    if (textarea) {
      attach(textarea);
      return () => {
        textarea.removeEventListener("focus", handleFocus);
        textarea.removeEventListener("blur", handleBlur);
      };
    }

    const observer = new MutationObserver(() => {
      const ta = findTextarea();
      if (ta) {
        attach(ta);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [agentInfo?.examples]);

  // 点击外部隐藏
  useEffect(() => {
    if (!isInputFocused) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && dropdownRef.current.contains(event.target as Node)) return;
      const textarea = document.querySelector("#queryInput") as HTMLTextAreaElement | null;
      if (textarea && textarea.contains(event.target as Node)) return;
      setIsInputFocused(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isInputFocused]);

  const handleTaskSelect = async (task: string) => {
    try {
      setIsLoading(true);
      onSelect(task);
      setIsInputFocused(false);
    } catch {
      onSelect(task);
      setIsInputFocused(false);
    } finally {
      setIsLoading(false);
    }
  };

  const shouldShowDropdown = agentInfo?.examples && agentInfo.examples.length > 3;

  return (
    <div className="w-full">
      <style>{`
        .sample-tasks-scrollbar::-webkit-scrollbar { width: 6px; }
        .sample-tasks-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .sample-tasks-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(156,163,175,0.3); border-radius: 3px;
        }
        .sample-tasks-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(156,163,175,0.5);
        }
        .sample-tasks-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(156,163,175,0.3) transparent; }
      `}</style>

      {/* 超过3条时：列表下拉 */}
      {shouldShowDropdown && isInputFocused && (
        <div
          ref={dropdownRef}
          className="w-full rounded-b-2xl overflow-hidden border-border-primary mt-1"
        >
          <div className="max-h-[400px] flex flex-col items-center overflow-y-auto sample-tasks-scrollbar">
            {agentInfo?.examples?.map((task: string, idx: number) => (
              <button
                key={idx}
                className={`w-[94%] px-4 py-3 text-left transition-smooth text-primary hover:text-accent border-b last:border-b-0 group ${
                  darkMode === "dark"
                    ? "hover:bg-[#1a1a1a] hover:rounded-lg"
                    : "hover:bg-gray-50 hover:rounded-lg"
                }`}
                style={{ borderBottomColor: "#434141" }}
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
      )}

      {/* 3条及以下：卡片布局 */}
      {!shouldShowDropdown && (
        <div className="flex flex-wrap justify-center gap-3 w-full mt-2">
          {agentInfo?.examples?.map((task: string, idx: number) => (
            <button
              key={idx}
              className={`flex-1 min-w-[260px] max-w-[380px] rounded-2xl px-5 py-4 text-left transition-all duration-200 animate-fade-in group border ${
                darkMode === "dark"
                  ? "bg-white/[0.03] border-border-primary/50 hover:border-accent/40 hover:bg-white/[0.06]"
                  : "bg-white/80 border-gray-200/70 hover:border-violet-300/70 hover:bg-violet-50/60"
              } shadow-sm hover:shadow-modern`}
              style={{ animationDelay: `${idx * 0.08}s` }}
              onClick={() => handleTaskSelect(task)}
              disabled={isLoading}
              type="button"
              title="点击填充到输入框，可编辑后发送"
            >
              <div className="text-sm leading-relaxed text-secondary group-hover:text-primary transition-colors line-clamp-3">
                {task}
              </div>
              <div className="flex items-center gap-1.5 mt-3">
                <span className="text-[10px] font-medium text-secondary/50 group-hover:text-accent/70 transition-colors uppercase tracking-wide">
                  {isLoading ? "处理中..." : "点击使用"}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SampleTasks;
