import { Network, Pencil, X } from "lucide-react";
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

const CARD_CLS =
  "group relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-gray-200/60 bg-gradient-to-b from-white via-white to-gray-50/30 p-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04),0_0_0_1px_rgba(15,23,42,0.02)] transition-all duration-300 hover:-translate-y-1 hover:border-accent/25 hover:shadow-[0_12px_32px_rgba(139,92,246,0.12),0_4px_8px_rgba(139,92,246,0.06)] dark:border-white/[0.07] dark:bg-gradient-to-b dark:from-white/[0.04] dark:via-white/[0.03] dark:to-white/[0.01] dark:shadow-none dark:hover:border-accent/20 dark:hover:shadow-[0_12px_32px_rgba(0,0,0,0.4),0_0_0_1px_rgba(139,92,246,0.08)]";

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

  const showTopActions =
    ((agent.mode === "remote" || agent.mode === "custom") && agent.onRemove) ||
    (agent.mode === "custom" && onEdit);

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
    <div
      className={CARD_CLS}
      onClick={handleTryClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleTryClick();
        }
      }}
    >
      {/* Subtle top accent bar — only visible on hover */}
      <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-xl bg-gradient-to-r from-accent/0 via-accent/40 to-accent/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      {/* Top row: mode badge + actions */}
      <div className="relative flex items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${modeLabel.className}`}>
            {agent.mode === "remote" ? (
              <Network className="mr-1 h-2.5 w-2.5 shrink-0" />
            ) : (
              <span className={`mr-1 inline-block h-2 w-2 shrink-0 rounded-full ${modeDotClass}`} />
            )}
            {modeLabel.text}
          </span>
        </div>

        {showTopActions && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {agent.mode === "custom" && onEdit && (
              <button
                type="button"
                onClick={handleEditClick}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-secondary/60 transition-colors hover:bg-purple-50 hover:text-purple-600 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] dark:hover:text-purple-400"
                title={t("agentsquare.editCustomAgentTitle")}
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
            {(agent.mode === "remote" || agent.mode === "custom") && agent.onRemove && (
              <button
                type="button"
                onClick={handleRemoveClick}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-secondary/60 transition-colors hover:bg-red-50 hover:text-red-500 dark:bg-white/[0.06] dark:hover:bg-red-500/15 dark:hover:text-red-400"
                title={t("agentsquare.removeAgent")}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Icon + name + owner */}
      <div className="mt-2.5 flex items-center gap-2.5">
        <div className="relative shrink-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-accent/15 to-accent/5 shadow-sm ring-1 ring-border-primary/20 transition-shadow duration-300 group-hover:shadow-md group-hover:ring-accent/30 dark:from-accent/20 dark:to-accent/5">
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
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-semibold leading-tight text-primary transition-colors duration-300 group-hover:text-accent" title={agent.name}>
            {agent.name}
          </h3>
          <p className="mt-0.5 truncate text-[10px] leading-tight text-secondary/60">
            {agent.owner}
          </p>
        </div>
        {/* 设为默认智能体 - 暂时注释 */}
        {/* {agent.onSetDefault && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              agent.onSetDefault?.(agent.id);
            }}
            title={agent.is_user_default ? t("agentsquare.currentDefault") : t("agentsquare.setAsDefault")}
            aria-label={agent.is_user_default ? t("agentsquare.currentDefault") : t("agentsquare.setAsDefault")}
            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ${
              agent.is_user_default
                ? "text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300"
                : "text-secondary/40 hover:text-amber-500 dark:text-secondary/30 dark:hover:text-amber-400"
            }`}
          >
            <Star
              className="h-3.5 w-3.5"
              fill={agent.is_user_default ? "currentColor" : "none"}
            />
          </button>
        )} */}
      </div>

      {/* Description */}
      <p className="relative mt-2.5 line-clamp-2 text-[12px] leading-relaxed text-secondary min-h-[2rem]">
        {getLocalizedDescription(agent.description, lang) || t("agentsquare.agent")}
      </p>

      {/* Subtle divider */}
      <div className="my-2 h-px w-full bg-gradient-to-r from-transparent via-gray-200/60 to-transparent dark:via-white/[0.06]" />

      {/* Footer: action button */}
      <div className="flex items-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleTryClick();
          }}
          title={t("agentsquare.startChat")}
          aria-label={t("agentsquare.startChat")}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-accent/10 px-2.5 text-[11px] font-medium text-accent ring-1 ring-inset ring-accent/15 transition-all hover:bg-accent/15 hover:ring-accent/25 dark:bg-accent/15 dark:text-accent-foreground dark:ring-accent/10 dark:hover:bg-accent/20"
        >
          <Network className="h-3 w-3" />
          {t("agentsquare.startChat")}
        </button>
      </div>
    </div>
  );
};

export { AgentCard };
export type { AgentCardProps, AgentCardData };
