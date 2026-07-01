import { Network, Pencil, X, Star } from "lucide-react";
import React from "react";
import { useModeConfigStore } from "@/store/modeConfig";
import { useLang } from "../../../i18n/useLang";
import { getLocalizedDescription } from "../../utils";
import { DRSAI_RECENT_AGENTS_KEY } from "@/utils/recentAgentsStorage";
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
  onSetDefault?: (id?: string) => void;
  id?: string;
  featured?: boolean;
  is_default?: boolean;
  is_user_default?: boolean;
}

interface AgentCardProps {
  agent: AgentCardData;
  onEdit?: (id?: string) => void;
}

const DEFAULT_AVATAR =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iOCIgZmlsbD0iIzRkM2RjMyIvPgo8dGV4dCB4PSIzMiIgeT0iMzgiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyNCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkE8L3RleHQ+Cjwvc3ZnPgo=";

/** 统一图标：缩小版容器，logo 居中 contain */
const ICON_BOX =
  "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#f8f9fc] ring-1 ring-inset ring-[#dfe3ec] shadow-[0_4px_12px_rgba(66,78,112,0.06)] dark:bg-[#222032] dark:ring-[#3b3651] dark:shadow-none";

const ACTION_SHELL =
  "mt-auto flex items-center justify-start border-t border-[#ebe7f1] pt-1.5 dark:border-[#2f2a41]";

export const START_BUTTON_CLASS =
  "inline-flex h-8 items-center rounded-[10px] bg-[rgba(167,139,250,0.18)] px-2.5 text-[11px] font-medium tracking-[-0.01em] text-[#5f5a73] ring-1 ring-inset ring-[rgba(167,139,250,0.18)] transition-colors hover:bg-[rgba(167,139,250,0.24)] hover:text-[#535069] focus:outline-none focus:ring-2 focus:ring-[#cbb8ff]/40 dark:bg-[rgba(167,139,250,0.16)] dark:text-[#e7e2f3] dark:ring-[rgba(167,139,250,0.14)] dark:hover:bg-[rgba(167,139,250,0.22)]";

const TOP_ICON_BUTTON_BASE =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#cbb8ff]/40";

const STAR_BUTTON_ACTIVE =
  "bg-transparent text-[#6b63a0] hover:bg-transparent hover:text-[#5b5489] dark:bg-transparent dark:text-[#ddd6f2] dark:hover:bg-transparent dark:hover:text-[#efeaff]";

const STAR_BUTTON_IDLE =
  "bg-transparent text-[#8a86a0] hover:bg-transparent hover:text-[#6b63a0] dark:bg-transparent dark:text-[#bcb5d4] dark:hover:bg-transparent dark:hover:text-[#ddd6f2]";

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
  const { t, lang } = useLang();

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
  const showTopActions = Boolean(agent.onSetDefault) || showToolbar;

  const modeLabel =
    agent.mode === "remote"
      ? {
        text: t("agentsquare.connectRemote"),
        className:
          "bg-[#f1f5fb] text-[#587090] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] dark:bg-[#243247] dark:text-[#dbe8ff] dark:shadow-[0_0_0_1px_rgba(125,154,205,0.24)]",
      }
      : agent.mode === "custom"
        ? {
          text: t("agentsquare.customAgent"),
          className:
            "bg-[#f3f1fb] text-[#665d94] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] dark:bg-[#32284a] dark:text-[#ece4ff] dark:shadow-[0_0_0_1px_rgba(167,139,250,0.18)]",
        }
        : {
          text: t("agentsquare.filterOfficial"),
          className:
            "bg-[#f5f5f8] text-[#39404e] shadow-[inset_0_1px_0_rgba(255,255,255,0.86)] dark:bg-[#2b2837] dark:text-[#eff1f7] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06)]",
        };

  const modeDotClass =
    agent.mode === "custom"
      ? "bg-[#9286d1]"
      : agent.mode === "remote"
        ? "bg-[#86a0c7]"
        : "bg-[#af99f6]";

  return (
    <div className="group relative flex min-h-[110px] w-full max-w-[300px] flex-col rounded-[18px] border border-[#ddd3ef] bg-[#fafafe] px-3.5 py-2.5 shadow-[0_6px_16px_rgba(43,51,72,0.035)] transition-all duration-200 hover:-translate-y-[1px] hover:border-[#cfc0e8] hover:shadow-[0_12px_24px_rgba(52,61,88,0.065)] dark:border-[#433a5e] dark:bg-[rgba(167,139,250,0.11)] dark:shadow-[0_16px_30px_rgba(0,0,0,0.26)]">
      {/* 顶部信息区：类型标签 + 管理操作 */}
      <div className="flex min-h-[1.125rem] items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium tracking-[-0.01em] ${modeLabel.className}`}>
            {agent.mode === "remote" ? (
              <Network className="mr-1 h-3 w-3 shrink-0" />
            ) : (
              <span className={`mr-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${modeDotClass}`} />
            )}
            {modeLabel.text}
          </span>
        </div>
        {showTopActions && (
          <div className="relative flex shrink-0 items-center">
            {showToolbar && (
              <div
                className={`pointer-events-none absolute top-0 flex items-center gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 ${(agent.mode === "remote" || agent.mode === "custom") && agent.onRemove ? "right-0" : "right-8"
                  }`}
              >
                {(agent.mode === "custom") && onEdit && (
                  <button
                    type="button"
                    onClick={handleEditClick}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-[#faf9fc] text-[#657086] transition-colors hover:bg-[#f1eef7] hover:text-[#544d92] dark:bg-[#201d30] dark:text-[#a9b3ca] dark:hover:bg-[#28243b]"
                    title={t("agentsquare.editCustomAgentTitle")}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
                {(agent.mode === "remote" || agent.mode === "custom") && agent.onRemove && (
                  <button
                    type="button"
                    onClick={handleRemoveClick}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-[#faf9fc] text-[#7b8395] transition-colors hover:bg-[#f3eff8] hover:text-[#c2410c] dark:bg-[#201d30] dark:text-[#a9b3ca] dark:hover:bg-[#34212a] dark:hover:text-[#ff8a8a]"
                    title={t("agentsquare.removeAgent")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}

            {agent.onSetDefault && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  agent.onSetDefault?.(agent.id);
                }}
                title={agent.is_user_default ? t("agentsquare.currentDefault") : t("agentsquare.setAsDefault")}
                aria-label={agent.is_user_default ? t("agentsquare.currentDefault") : t("agentsquare.setAsDefault")}
                className={`${TOP_ICON_BUTTON_BASE} absolute right-0 top-0 transition-transform ${(agent.mode === "remote" || agent.mode === "custom") && agent.onRemove ? "group-hover:-translate-x-8" : ""
                  } ${agent.is_user_default ? STAR_BUTTON_ACTIVE : STAR_BUTTON_IDLE}`}
              >
                <Star
                  className="h-4 w-4"
                  fill={agent.is_user_default ? "currentColor" : "none"}
                />
              </button>
            )}
          </div>
        )}
      </div>

      {/* 标题区：图标与名称/作者垂直居中 */}
      <div className="mt-2 flex items-center gap-3">
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
          <h3 className="truncate text-[clamp(10px,1.08vw,16px)] font-semibold leading-[1.6] tracking-[-0.03em] text-[#25324a] dark:text-[#eef2ff]">
            {agent.name}
          </h3>
          <p className="mt-0.5 truncate text-[clamp(7px,0.82vw,10px)] leading-tight text-[#8f98ac] dark:text-[#9fa8bf]">
            {agent.owner}
          </p>
        </div>
      </div>

      {/* 描述区 */}
      <p className="mt-2 line-clamp-2 text-left text-[clamp(8px,0.94vw,12px)] leading-[1.42] text-[#404e67] dark:text-[#c7d0e6] mb-2">
        {getLocalizedDescription(agent.description, lang)}
      </p>

      {/* 操作区：只保留一个开始试用主按钮，默认星标固定在右上 */}
      <div className={ACTION_SHELL}>
        <button
          type="button"
          onClick={handleTryClick}
          title={t("agentsquare.startChat")}
          aria-label={t("agentsquare.startChat")}
          className={START_BUTTON_CLASS}
        >
          {t("agentsquare.startChat")}
        </button>
      </div>
    </div>
  );
};

export { AgentCard };
export type { AgentCardProps, AgentCardData };
