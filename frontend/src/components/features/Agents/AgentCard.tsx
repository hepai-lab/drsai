import { Network, Pencil, X } from "lucide-react";
import React from "react";
import { useModeConfigStore } from "@/store/modeConfig";
import { DRSAI_RECENT_AGENTS_KEY } from "@/utils/recentAgentsStorage";
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
  api_key?: string;
  onRemove?: (id?: string) => void;
  id?: string;
  featured?: boolean;
  is_default?: boolean;
}

interface AgentCardProps {
  agent: AgentCardData;
  onEdit?: (id?: string) => void;
}

const DEFAULT_AVATAR =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iOCIgZmlsbD0iIzRkM2RjMyIvPgo8dGV4dCB4PSIzMiIgeT0iMzgiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkE8L3RleHQ+Cjwvc3ZnPgo=";

/** 统一图标：缩小版容器，logo 居中 contain */
const ICON_BOX =
  "flex h-7 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#fbf8ee] ring-1 ring-inset ring-[#f3cf63]";

const pushRecentAgent = (agentId?: string) => {
  if (!agentId) return;
  try {
    const raw = window.localStorage.getItem(DRSAI_RECENT_AGENTS_KEY);
    const list: string[] = raw ? JSON.parse(raw) : [];
    const next = [agentId, ...list.filter((id) => id !== agentId)].slice(0, 12);
    window.localStorage.setItem(DRSAI_RECENT_AGENTS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("drsai:recentAgentsUpdated"));
    window.dispatchEvent(
      new CustomEvent("drsai:agentUsed", {
        detail: { agentId },
      })
    );
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
};

const AgentCard: React.FC<AgentCardProps> = ({ agent, onEdit }) => {
  const { setAgentId, setMode } = useModeConfigStore();

  const handleTryClick = async () => {
    setAgentId(agent.id || "");
    setMode(agent.mode || "");
    pushRecentAgent(agent.id);

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

  const modeLabel =
    agent.mode === "remote"
      ? {
          text: "远程",
          className:
            "bg-blue-100 text-blue-800 dark:bg-[#0b2a4a]/70 dark:text-[#bfe3ff] dark:shadow-[0_0_0_1px_rgba(56,189,248,0.22)]",
        }
      : agent.mode === "custom"
        ? {
            text: "自定义",
            className:
              "bg-purple-100 text-purple-800 dark:bg-[#2a2342] dark:text-[#d9ccff] dark:shadow-[0_0_0_1px_rgba(167,139,250,0.22)]",
          }
        : {
            text: "官方",
            className:
              "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-[#e4e8ff] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.10)]",
          };

  const modeDotClass =
    agent.mode === "custom"
      ? "bg-[#a78bfa]/80"
      : agent.mode === "remote"
        ? "bg-[#38bdf8]/85"
        : "bg-[#a78bfa]/75";

  return (
    <div className="group relative flex min-h-[96px] w-full max-w-[300px] flex-col rounded-xl border border-[#c9b8ff] bg-[#f8f8fb] px-3 py-2.5 shadow-sm transition-all duration-200 hover:border-[#b8a4ff] hover:shadow-md dark:border-[#6550ba] dark:bg-[#181824]">
      {/* 顶部信息区：类型标签 + 管理操作 */}
      <div className="flex min-h-[1.125rem] items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${modeLabel.className}`}>
            {agent.mode === "remote" ? (
              <Network className="mr-1 h-3 w-3 shrink-0" />
            ) : (
              <span className={`mr-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${modeDotClass}`} />
            )}
            {modeLabel.text}
          </span>
        </div>
        {showToolbar && (
          <div className="flex shrink-0 items-center gap-1">
            {agent.mode === "custom" && onEdit && (
              <button
                type="button"
                onClick={handleEditClick}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/90 text-white opacity-0 transition-opacity hover:bg-blue-600 group-hover:opacity-100"
                title="编辑自定义智能体"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
            {(agent.mode === "remote" || agent.mode === "custom") && agent.onRemove && (
              <button
                type="button"
                onClick={handleRemoveClick}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500/90 text-white opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"
                title="移除智能体"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* 标题区：图标与名称/作者垂直居中 */}
      <div className="mt-1.5 flex items-center gap-2">
        <div className={ICON_BOX}>
          <img
            src={agent.logo}
            alt=""
            className="h-5 w-5 max-h-full max-w-full object-contain"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src = DEFAULT_AVATAR;
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[clamp(9px,1.1vw,15px)] font-semibold leading-[1.15] tracking-[-0.02em] text-[#233457] dark:text-[#e4e8ff]">
            {agent.name}
          </h3>
          <p className="mt-0.5 truncate text-[clamp(7px,0.8vw,10px)] leading-tight text-[#9aa2b2] dark:text-[#b6bdd0]">
            {agent.owner}
          </p>
        </div>
      </div>

      {/* 描述区 */}
      <p className="mt-2 line-clamp-2 text-left text-[clamp(8px,0.95vw,12px)] leading-[1.35] text-[#374156] dark:text-[#cfd6e9]">
        {agent.description}
      </p>

      {/* 操作区：紧贴描述，按钮适中宽度、居中 */}
      <div className="mt-2.5 flex justify-start">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleTryClick}
          className="min-w-[4.5rem] !rounded-full !border !border-[#b5a1ff] !bg-[#ece9ff] !px-2.5 !py-1 !text-[clamp(8px,0.95vw,12px)] font-semibold tracking-[0.02em] text-[#5d3fcd] transition-colors hover:!translate-y-0 hover:!border-[#9f85ff] hover:!bg-[#e2dcff] hover:text-[#4d32b4] dark:!border-[#6f56c7] dark:!bg-[#2a2342] dark:text-[#bca8ff] dark:hover:!bg-[#32294d]"
        >
          试用一下
        </Button>
      </div>
    </div>
  );
};

export { AgentCard };
export type { AgentCardProps, AgentCardData };
