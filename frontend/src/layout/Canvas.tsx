import { Bot, ChevronRight, FileText, Grid2X2, Plus } from "lucide-react";
import React, { useContext, useMemo } from "react";
import { CanvasViewId } from "../components/views/menuRoutes";
import { MENU_IDS, createSearchWithMenu, createSearchWithView } from "../components/views/menuRoutes";
import { getMenuIdFromSearch } from "../components/views/menuRoutes";
import { appContext } from "../hooks/provider";
import { useConfigStore } from "../hooks/store";
import { useLocation, useNavigate } from "../hooks/useRouter";
import { useModeConfigStore } from "../store/modeConfig";

// const VIEWS: { id: CanvasViewId; label: string; icon: React.ReactNode }[] = [
//   { id: "chat", label: "对话", icon: <MessageSquare className="w-3.5 h-3.5" /> },
//   { id: "file_preview", label: "文件预览", icon: <FileText className="w-3.5 h-3.5" /> },
// ];

interface CanvasProps {
  children: React.ReactNode;
  filePreviewContent?: React.ReactNode;
  activeView: CanvasViewId;
  activeMenuLabel: string;
  onViewChange: (view: CanvasViewId) => void;
  onNewSession?: () => void;
  showNewSessionButton?: boolean;
}

const Canvas: React.FC<CanvasProps> = ({
  children,
  filePreviewContent,
  activeView,
  activeMenuLabel,
  onViewChange,
  onNewSession,
  showNewSessionButton = false,
}) => {
  const { darkMode } = useContext(appContext);
  const location = useLocation();
  const navigate = useNavigate();
  const activeMenuId = getMenuIdFromSearch(location.search);
  const session = useConfigStore((s) => s.session);
  const agentInfo = useModeConfigStore((s) => s.agentInfo);
  const selectedAgent = useModeConfigStore((s) => s.selectedAgent);

  const { agentDisplayName, defaultConfigLabel } = useMemo(() => {
    const sessionAgentModeConfig = (session?.agent_mode_config || null) as
      | { name?: unknown; mode?: unknown; defult_config_name?: unknown }
      | null;

    const name =
      (typeof sessionAgentModeConfig?.name === "string" && sessionAgentModeConfig.name.trim()) ||
      (typeof agentInfo?.name === "string" && agentInfo.name.trim()) ||
      (typeof selectedAgent?.name === "string" && selectedAgent.name.trim()) ||
      (typeof sessionAgentModeConfig?.mode === "string" && sessionAgentModeConfig.mode.trim()) ||
      (typeof selectedAgent?.mode === "string" && selectedAgent.mode.trim()) ||
      "";

    const cfgRaw =
      sessionAgentModeConfig?.defult_config_name ??
      agentInfo?.defult_config_name ??
      (selectedAgent as any)?.defult_config_name ??
      "";
    const cfg = typeof cfgRaw === "string" ? cfgRaw.trim() : String(cfgRaw || "").trim();
    const normalizedCfg = /^default$/i.test(cfg) ? "" : cfg;
    return { agentDisplayName: name, defaultConfigLabel: normalizedCfg };
  }, [session?.id, session?.agent_mode_config, agentInfo, selectedAgent]);

  const hasActiveSession = Boolean(session?.id);

  const showSessionAgentBar =
    activeMenuId === MENU_IDS.currentSession &&
    hasActiveSession &&
    (Boolean(agentDisplayName) || Boolean(defaultConfigLabel));

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      {/* Breadcrumb */}
      <div
        className={`relative flex-shrink-0 flex items-center gap-1 px-4 h-11 text-sm ${
          darkMode === "dark"
            ? "bg-white/[0.02]"
            : "border-b border-gray-200/80 bg-white/60"
        }`}
      >
        {/* Root */}
        <div className="flex items-center gap-1 min-w-0 flex-shrink z-10">
          <span className="text-secondary font-medium tracking-wide">
            OpenDrSai
          </span>

          <ChevronRight className="w-3.5 h-3.5 text-secondary/50 flex-shrink-0" />
          <span
            className={`px-2 py-0.5 rounded-md text-xs font-medium ${darkMode === "dark"
              ? "bg-violet-500/10 text-violet-200"
              : "bg-violet-100 text-violet-700"
              }`}
          >
            {activeMenuLabel}
          </span>
        </div>

        {showSessionAgentBar && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 flex h-full items-center justify-center px-28 sm:px-36"
            aria-live="polite"
          >
            <div className="flex max-w-[min(480px,52vw)] min-w-0 items-center gap-2.5 p-0">
              <Bot
                className="h-6 w-6 flex-shrink-0 text-accent opacity-90 animate-logo-hop motion-reduce:animate-none"
                strokeWidth={2}
                aria-hidden
              />
              <div className="flex min-w-0 flex-1 flex-row flex-nowrap items-baseline gap-x-1 text-left font-agent">
                {agentDisplayName ? (
                  <span
                    className={`min-w-0 truncate text-[1.0625rem] sm:text-lg font-bold leading-tight tracking-[-0.03em] antialiased ${defaultConfigLabel
                      ? "flex-none max-w-[min(13rem,46%)]"
                      : "max-w-full"
                      } ${darkMode === "dark"
                        ? "text-white [text-shadow:0_1px_24px_rgba(167,139,250,0.12)]"
                        : "text-slate-900"
                      }`}
                    title={agentDisplayName}
                  >
                    {agentDisplayName}
                  </span>
                ) : null}

                {defaultConfigLabel ? (
                  <span
                    className={`font-agent-mono min-w-0 truncate text-[0.8125rem] font-medium tracking-wide ${agentDisplayName ? "flex-1 text-left" : "max-w-full text-left"
                      } ${darkMode === "dark"
                        ? "text-violet-300/85"
                        : "text-violet-700/90"
                      }`}
                    title={defaultConfigLabel}
                  >
                    {defaultConfigLabel}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 flex-shrink-0 z-10">
          {showNewSessionButton && onNewSession && activeMenuId === MENU_IDS.currentSession && (
            <button
              type="button"
              onClick={onNewSession}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${darkMode === "dark"
                ? "bg-white/[0.04] hover:bg-white/[0.07] text-secondary border border-border-primary/30"
                : "bg-white/70 hover:bg-white text-gray-700 border border-gray-200/80"
                }`}
              aria-label="新建会话"
              title="新建会话"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新建会话</span>
            </button>
          )}

          {activeMenuId === MENU_IDS.currentSession && (
            <button
              type="button"
              onClick={() => {
                const withMenu = createSearchWithMenu(location.search, MENU_IDS.agentSquare);
                navigate(createSearchWithView(withMenu, "chat"));
              }}
              className={`group relative inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${darkMode === "dark"
                ? "ring-offset-[#0b0f19]"
                : "ring-offset-white"
                }`}
              aria-label="体验更多：跳转智能体广场"
              title="体验更多：智能体广场"
            >
              <span
                className={`absolute inset-0 rounded-lg opacity-100 transition-opacity ${darkMode === "dark"
                  ? "bg-gradient-to-r from-fuchsia-500/90 via-violet-500/90 to-indigo-500/90"
                  : "bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500"
                  }`}
              />
              <span
                className={`absolute -inset-0.5 rounded-xl blur opacity-40 transition-opacity group-hover:opacity-70 ${darkMode === "dark"
                  ? "bg-gradient-to-r from-fuchsia-500 via-violet-500 to-indigo-500"
                  : "bg-gradient-to-r from-fuchsia-400 via-violet-400 to-indigo-400"
                  }`}
              />
              <span
                className={`relative inline-flex items-center gap-2 ${darkMode === "dark" ? "text-white" : "text-white"
                  }`}
              >
                <Grid2X2 className="w-3.5 h-3.5" />
                <span>体验更多</span>
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden rounded-b-2xl">
        <div className={activeView === "chat" ? "h-full" : "hidden"}>
          {children}
        </div>
        <div className={activeView === "file_preview" ? "h-full" : "hidden"}>
          {filePreviewContent ?? (
            <div className="flex items-center justify-center h-full text-secondary">
              <div className="text-center">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm opacity-40">暂无文件</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Canvas;
