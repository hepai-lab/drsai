import { Network, Pencil, X } from "lucide-react";
import React from "react";
import { useModeConfigStore } from "@/store/modeConfig";
import { Button } from "../../common/Button";
import type { AgentMode } from "@/types/common";

interface AgentCardData {
  logo: string;
  name: string;
  description: string;
  owner: string;
  url: string;
  config: any;
  onClick?: () => void;
  mode?: AgentMode;
  apiKey?: string;
  onRemove?: (id?: string) => void;
  id?: string;
}

interface AgentCardProps {
  agent: AgentCardData;
  onEdit?: (id?: string) => void;
}

const DEFAULT_AVATAR =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iOCIgZmlsbD0iIzRkM2RjMyIvPgo8dGV4dCB4PSIzMiIgeT0iMzgiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkE8L3RleHQ+Cjwvc3ZnPgo=";

/** 统一图标：48×48 容器，logo 居中 contain */
const ICON_BOX =
  "flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-tertiary/35 ring-1 ring-inset ring-border-primary/50";

const AgentCard: React.FC<AgentCardProps> = ({ agent, onEdit }) => {
  const { setAgentId } = useModeConfigStore();

  const handleTryClick = async () => {
    setAgentId(agent.id || "");

    window.dispatchEvent(
      new CustomEvent("switchToCurrentSession", {
        detail: {
          clearSession: true,
        },
      })
    );
  };

  const handleRemoveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    agent.onRemove?.(agent.id);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(agent.id);
  };

  const showToolbar =
    ((agent.mode === "remote" || agent.mode === "custom") && agent.onRemove) ||
    (agent.mode === "custom" && onEdit);

  return (
    <div className="group relative flex min-h-[204px] w-[360px] max-w-full flex-col rounded-xl border border-purple-200/90 bg-primary p-4 shadow-sm transition-all duration-200 hover:border-purple-300/90 hover:shadow-md dark:border-purple-500/35 dark:hover:border-purple-400/45">
      {/* 顶部信息区：类型标签 + 管理操作 */}
      <div className="flex min-h-[1.375rem] items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {agent.mode === "remote" && (
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800 dark:bg-blue-900/80 dark:text-blue-200">
              <Network className="mr-0.5 h-3 w-3 shrink-0" />
              远程
            </span>
          )}
        </div>
        {showToolbar && (
          <div className="flex shrink-0 items-center gap-0.5">
            {agent.mode === "custom" && onEdit && (
              <button
                type="button"
                onClick={handleEditClick}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/90 text-white opacity-0 transition-opacity hover:bg-blue-600 group-hover:opacity-100"
                title="编辑自定义智能体"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
            {(agent.mode === "remote" || agent.mode === "custom") && agent.onRemove && (
              <button
                type="button"
                onClick={handleRemoveClick}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/90 text-white opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"
                title="移除智能体"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* 标题区：图标与名称/作者垂直居中 */}
      <div className="mt-2.5 flex items-center gap-3">
        <div className={ICON_BOX}>
          <img
            src={agent.logo}
            alt=""
            className="h-8 w-8 max-h-full max-w-full object-contain"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src = DEFAULT_AVATAR;
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold leading-tight tracking-tight text-primary">
            {agent.name}
          </h3>
          <p className="mt-0.5 truncate text-xs leading-tight text-secondary">
            {agent.owner}
          </p>
        </div>
      </div>

      {/* 描述区 */}
      <p className="mt-2.5 line-clamp-2 text-left text-[13px] leading-snug text-secondary/95">
        {agent.description}
      </p>

      {/* 操作区：紧贴描述，按钮适中宽度、居中 */}
      <div className="mt-3 flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleTryClick}
          className="!rounded-full !px-6 !py-2.5 !text-[13px] min-w-[8.25rem] font-medium tracking-wide text-purple-600 transition-colors hover:!translate-y-0 hover:bg-purple-500/10 hover:text-purple-700 dark:text-purple-400 dark:hover:bg-purple-400/10 dark:hover:text-purple-300"
        >
          试用一下
        </Button>
      </div>
    </div>
  );
};

export { AgentCard };
export type { AgentCardProps, AgentCardData };
