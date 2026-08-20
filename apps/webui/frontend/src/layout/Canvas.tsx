import { Bot, ChevronRight, Files, PanelLeftOpen, Plus } from "lucide-react";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  MENU_IDS,
  type MenuId,
} from "../components/views/menuRoutes";
import { appContext } from "../hooks/provider";
import { useLang } from "../i18n/useLang";
import { useConfigStore } from "../hooks/store";
import { useLocation } from "../hooks/useRouter";
import { useModeConfigStore } from "../store/modeConfig";
import { useRightPanelStore } from "../store/rightPanel";
import CanvasFilePreviewPane from "./CanvasFilePreviewPane";
const CANVAS_SPLIT_KEY = 'drsai:layout:canvasSplitPct';
const DEFAULT_SPLIT_PCT = 50;

interface CanvasProps {
  children: React.ReactNode;
  activeMenuId: MenuId;
  activeMenuLabel: string;
  onNewSession?: () => void;
  showNewSessionButton?: boolean;
  showRightPanelToggle?: boolean;
  onOpenRightPanel?: () => void;
  generatedFilesCount?: number;
  generatedFilesContent?: React.ReactNode;
}

const Canvas: React.FC<CanvasProps> = ({
  children,
  activeMenuId,
  activeMenuLabel,
  onNewSession,
  showNewSessionButton = false,
  showRightPanelToggle = false,
  onOpenRightPanel,
  generatedFilesCount = 0,
  generatedFilesContent,
}) => {
  const { darkMode } = useContext(appContext);
  const { t } = useLang();
  const location = useLocation();
  const session = useConfigStore((s) => s.session);
  const agentInfo = useModeConfigStore((s) => s.agentInfo);
  const selectedAgent = useModeConfigStore((s) => s.selectedAgent);
  const agentOfflineSnapshot = useModeConfigStore((s) => s.agentOfflineSnapshot);
  const hasActiveSession = Boolean(session?.id);

  const previewFile = useRightPanelStore((s) => s.previewFile);
  const setPreviewFile = useRightPanelStore((s) => s.setPreviewFile);

  const [filesOpen, setFilesOpen] = useState(false);
  const filesButtonRef = useRef<HTMLButtonElement | null>(null);
  const filesPopoverRef = useRef<HTMLDivElement | null>(null);

  // Close popover when a file preview opens
  useEffect(() => {
    if (previewFile) setFilesOpen(false);
  }, [previewFile]);

  // Auto-close file preview when switching routes or sessions
  useEffect(() => {
    setPreviewFile(null);
  }, [activeMenuId, session?.id]);

  // Close popover on outside click
  useEffect(() => {
    if (!filesOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        filesButtonRef.current?.contains(e.target as Node) ||
        filesPopoverRef.current?.contains(e.target as Node)
      ) return;
      setFilesOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [filesOpen]);

  // Canvas split percentage (left side width as % of total)
  const [splitPct, setSplitPct] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(CANVAS_SPLIT_KEY);
      if (raw) {
        const v = Number(raw);
        if (Number.isFinite(v) && v > 10 && v < 90) return v;
      }
    } catch { /* ignore */ }
    return DEFAULT_SPLIT_PCT;
  });

  useEffect(() => {
    try { localStorage.setItem(CANVAS_SPLIT_KEY, String(splitPct)); } catch { /* ignore */ }
  }, [splitPct]);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const beginSplitDrag = useCallback((e: React.PointerEvent) => {
    const el = containerRef.current;
    if (!el) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const rect = el.getBoundingClientRect();
    const origCursor = document.body.style.cursor;
    const origUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: PointerEvent) => {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.max(20, Math.min(80, pct)));
    };
    const onUp = () => {
      document.body.style.cursor = origCursor;
      document.body.style.userSelect = origUserSelect;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, []);

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

    const cfgRaw = hasActiveSession
      ? sessionAgentModeConfig?.defult_config_name ?? ""
      : sessionAgentModeConfig?.defult_config_name ??
      agentInfo?.defult_config_name ??
      (selectedAgent as { defult_config_name?: unknown } | null)?.defult_config_name ??
      "";
    const cfg = typeof cfgRaw === "string" ? cfgRaw.trim() : String(cfgRaw || "").trim();
    const normalizedCfg = /^default$/i.test(cfg) ? "" : cfg;
    return { agentDisplayName: name, defaultConfigLabel: normalizedCfg };
  }, [session?.id, session?.agent_mode_config, agentInfo, selectedAgent, hasActiveSession]);

  const showSessionAgentBar =
    activeMenuId === MENU_IDS.currentSession &&
    hasActiveSession &&
    (Boolean(agentDisplayName) || Boolean(defaultConfigLabel));

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      {/* Breadcrumb */}
      <div
        className={`relative flex-shrink-0 flex items-center gap-1 px-2 sm:px-4 h-11 text-sm ${darkMode === "dark"
          ? "bg-white/[0.02]"
          : "border-b border-gray-200/80 bg-white/60"
          }`}
      >
        {/* Root */}
        <div className="flex items-center gap-1 min-w-0 flex-shrink z-10">
          <span className="text-secondary font-medium tracking-wide hidden sm:inline">
            OpenDrSai
          </span>

          <ChevronRight className="w-3.5 h-3.5 text-secondary/50 flex-shrink-0 hidden sm:inline" />
          <span
            className={`px-2 py-0.5 rounded-md text-xs font-medium ${darkMode === "dark"
              ? "bg-violet-500/10 text-violet-200"
              : "bg-violet-100 text-violet-700"
              }`}
          >
            {t(activeMenuLabel as Parameters<typeof t>[0])}
          </span>
        </div>

        {showSessionAgentBar && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 hidden md:flex h-full items-center justify-center px-28 sm:px-36"
            aria-live="polite"
          >
            <div className="flex max-w-[min(480px,52vw)] min-w-0 items-center gap-2.5 p-0">
              <Bot
                className={`h-6 w-6 flex-shrink-0 motion-reduce:animate-none ${agentOfflineSnapshot
                  ? `opacity-45 grayscale ${darkMode === "dark"
                    ? "text-white/45"
                    : "text-slate-400"
                  }`
                  : "text-accent opacity-90 animate-logo-hop"
                  }`}
                strokeWidth={2}
                aria-hidden={!agentOfflineSnapshot}
                {...(agentOfflineSnapshot
                  ? {
                    "aria-label": t("canvas.agentOffline"),
                    title: t("canvas.agentOffline"),
                  }
                  : {})}
              />
              <div className="flex min-w-0 flex-1 flex-row flex-nowrap items-baseline gap-x-1 text-left font-agent">
                {agentDisplayName ? (
                  <span
                    className={`min-w-0 truncate text-[1.0625rem] sm:text-lg font-bold leading-tight tracking-[-0.03em] antialiased ${defaultConfigLabel
                      ? "flex-none max-w-[clamp(13rem,46%,28rem)]"
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

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2 flex-shrink-0 z-10">
          {showRightPanelToggle && onOpenRightPanel && (
            <button
              type="button"
              onClick={onOpenRightPanel}
              className={`flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${darkMode === "dark"
                ? "bg-white/[0.04] hover:bg-white/[0.07] text-secondary border border-border-primary/30"
                : "bg-white/70 hover:bg-white text-gray-700 border border-gray-200/80"
                }`}
              aria-label={t("canvas.openPanel")}
              title={t("canvas.openPanel")}
            >
              <PanelLeftOpen className="w-3.5 h-3.5" />
            </button>
          )}

          {showNewSessionButton && onNewSession && activeMenuId === MENU_IDS.currentSession && (
            <>
              {generatedFilesCount > 0 && (
                <div className="relative">
                  <button
                    ref={filesButtonRef}
                    type="button"
                    onClick={() => setFilesOpen((v) => !v)}
                    className={`relative flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      filesOpen
                        ? darkMode === "dark"
                          ? "bg-accent/20 text-accent border border-accent/30"
                          : "bg-accent/10 text-accent border border-accent/20"
                        : darkMode === "dark"
                          ? "bg-white/[0.04] hover:bg-white/[0.07] text-secondary border border-border-primary/30"
                          : "bg-white/70 hover:bg-white text-gray-700 border border-gray-200/80"
                    }`}
                    title="查看本次会话生成的文件"
                  >
                    <Files className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">生成的文件</span>
                    <span className="min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center bg-accent text-white leading-none">
                      {generatedFilesCount}
                    </span>
                  </button>

                  {filesOpen && (
                    <div
                      ref={filesPopoverRef}
                      className={`absolute right-0 top-full mt-1.5 z-50 w-72 sm:w-80 rounded-xl shadow-lg border overflow-hidden ${
                        darkMode === "dark"
                          ? "bg-[#0d1117]/95 border-white/10 backdrop-blur-md"
                          : "bg-white border-gray-200/80 backdrop-blur-md"
                      }`}
                    >
                      <div className={`px-3 py-2 text-[11px] font-semibold border-b ${
                        darkMode === "dark" ? "text-secondary border-white/8" : "text-gray-500 border-gray-100"
                      }`}>
                        生成的文件
                      </div>
                      <div className="max-h-[60vh] overflow-y-auto p-2">
                        {generatedFilesContent ?? (
                          <div className="py-6 text-center text-xs text-secondary">暂无生成文件</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={onNewSession}
                className={`flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${darkMode === "dark"
                  ? "bg-white/[0.04] hover:bg-white/[0.07] text-secondary border border-border-primary/30"
                  : "bg-white/70 hover:bg-white text-gray-700 border border-gray-200/80"
                  }`}
                aria-label={t("canvas.newSession")}
                title={t("canvas.newSession")}
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t("canvas.newSession")}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content — split when file preview is active */}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden rounded-b-2xl flex">
        {/* Left: chat */}
        <div
          className="min-w-0 h-full overflow-hidden"
          style={previewFile ? { width: `${splitPct}%`, flexShrink: 0 } : { flex: 1 }}
        >
          {children}
        </div>

        {/* Drag handle + right pane (only when preview active) */}
        {previewFile && (
          <>
            <div
              onPointerDown={beginSplitDrag}
              className={`flex-shrink-0 w-1.5 h-full cursor-col-resize transition-colors ${darkMode === "dark"
                ? "bg-white/5 hover:bg-white/20"
                : "bg-gray-200/60 hover:bg-gray-300/80"
                }`}
              style={{ touchAction: 'none' }}
            />
            <div className="flex-1 min-w-0 h-full overflow-hidden">
              <CanvasFilePreviewPane />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Canvas;
