import { Check, CheckCircle, Circle, Clock } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appContext } from "../../../hooks/provider";
import { BESIIIPanelProps, BESIIISubTask, BESIIITask } from "./types";
import { useModeConfigStore } from "@/store/modeConfig";

/**
 * BESIII Panel - 用于显示 BESIII Agent 的任务执行状态
 * 
 * 功能：
 * 1. 全局任务执行 - 总览
 * 2. Files - 文件列表和下载
 * 3. Terminal - 终端输出
 */

type TabType = 'logs' | 'global_info' | 'terminal';

/** Shown first; only these keys are treated as read-only. */
const GLOBAL_INFO_READ_ONLY_ORDER = ["taskName", "root_path"] as const;
const GLOBAL_INFO_READ_ONLY_SET = new Set<string>(GLOBAL_INFO_READ_ONLY_ORDER);

/** Inline keyframes so idle animation always applies (Tailwind JIT 有时未生成自定义 animate-*). */
const BESIII_IDLE_KEYFRAMES = `
@keyframes besiii-idle-wave {
  0%, 100% { transform: scaleY(0.35); }
  50% { transform: scaleY(1); }
}
@keyframes besiii-idle-glow {
  0%, 100% { opacity: 0.22; }
  50% { opacity: 0.5; }
}
`;

const BESIIIPanel: React.FC<BESIIIPanelProps> = ({
    tasks = [],
    terminalOutput = '',
    logs = [],
    fileEvents: _fileEvents = [],
    serverGlobalInfo = null,
    onMinimize,
    onInputResponse,
    activeTab: controlledActiveTab,
    onTabChange,
}) => {
    const { darkMode, user } = React.useContext(appContext);
    const [internalActiveTab, setInternalActiveTab] = useState<TabType>('global_info');
    // 使用受控的 activeTab（如果提供），否则使用内部状态
    const activeTab = controlledActiveTab !== undefined ? controlledActiveTab : internalActiveTab;
    const setActiveTab = useCallback(
        (tab: TabType) => {
            if (onTabChange) {
                onTabChange(tab);
            } else {
                setInternalActiveTab(tab);
            }
        },
        [onTabChange]
    );

    /** 与 runview 中 global_info / run.logs / besiii_terminal 的约定一致：无数据则不挂载对应 tab。 */
    const hasGlobalInfoTab = Boolean(
        serverGlobalInfo?.fields && Object.keys(serverGlobalInfo.fields).length > 0
    );
    const hasLogsTab = (logs?.length ?? 0) > 0;
    const hasTerminalTab = terminalOutput.trim().length > 0;
    const agentInfo = useModeConfigStore((s) => s.agentInfo);
    const agentOwnerRaw = agentInfo?.owner || "unknown";
    const agentOwner = agentOwnerRaw.includes("@")
        ? agentOwnerRaw.split("@")[0]
        : agentOwnerRaw;
    // (keep user fallback around; useful in cases where agentInfo isn't fetched yet)
    const _viewer = user?.name || user?.email || "unknown";

    const emptyPanelQuips = useMemo(
        () => [
            "天啦噜 我不知道这里要展示 global_info 和 logs",
            "救命 我还没想好怎么摆 global_info / logs",
            "这块面板还在施工：global_info 和 logs 该怎么放我也很纠结",
            "我在等灵感掉下来：global_info、logs 先空着吧",
            "先别盯着我看，我也不知道 global_info 和 logs 要怎么展示",
            "开发进度：global_info ✅？logs ✅？（都还没）",
        ],
        []
    );
    const emptyPanelQuip = useMemo(() => {
        if (emptyPanelQuips.length === 0) return "";
        const idx = Math.floor(Math.random() * emptyPanelQuips.length);
        return emptyPanelQuips[idx] ?? emptyPanelQuips[0] ?? "";
    }, [emptyPanelQuips]);

    const visibleTabs = useMemo((): { id: TabType; label: string }[] => {
        const t: { id: TabType; label: string }[] = [];
        if (hasGlobalInfoTab) t.push({ id: "global_info", label: "Global Info" });
        if (hasLogsTab) t.push({ id: "logs", label: "LogExecution" });
        if (hasTerminalTab) t.push({ id: "terminal", label: "Terminal" });
        return t;
    }, [hasGlobalInfoTab, hasLogsTab, hasTerminalTab]);

    // If the panel is empty for a while, show a nicer "coming soon" hint.
    const [showEmptyHint, setShowEmptyHint] = useState(false);
    useEffect(() => {
        if (visibleTabs.length > 0) {
            setShowEmptyHint(false);
            return;
        }

        setShowEmptyHint(false);
        const t = window.setTimeout(() => {
            setShowEmptyHint(true);
        }, 10_000);

        return () => window.clearTimeout(t);
    }, [visibleTabs.length]);

    useEffect(() => {
        const ids = visibleTabs.map((x) => x.id);
        if (ids.length === 0) return;
        if (!ids.includes(activeTab)) {
            setActiveTab(ids[0]);
        }
    }, [visibleTabs, activeTab, setActiveTab]);
    const [localTasks, setLocalTasks] = useState<BESIIITask[]>(tasks);
    const logContainerRef = useRef<HTMLDivElement>(null);

    const initialGlobalInfoRef = useRef<Record<string, string>>({});
    /** Only re-apply server snapshot when revision changes — avoids wiping local edits on every run.messages update. */
    const lastSyncedGlobalInfoRevisionRef = useRef<string | null>(null);
    const [globalInfo, setGlobalInfo] = useState<Record<string, string>>({});

    useEffect(() => {
        const fields = serverGlobalInfo?.fields;
        const revision = serverGlobalInfo?.revision ?? null;

        if (!fields || Object.keys(fields).length === 0) {
            if (serverGlobalInfo == null && lastSyncedGlobalInfoRevisionRef.current != null) {
                lastSyncedGlobalInfoRevisionRef.current = null;
                initialGlobalInfoRef.current = {};
                setGlobalInfo({});
            }
            return;
        }

        if (revision === lastSyncedGlobalInfoRevisionRef.current) {
            return;
        }

        lastSyncedGlobalInfoRevisionRef.current = revision;
        const normalized = { ...fields, root_path: fields.root_path ?? "" };
        initialGlobalInfoRef.current = normalized;
        setGlobalInfo({ ...normalized });
    }, [serverGlobalInfo]);

    // 同步 tasks prop 到 localTasks 状态
    useEffect(() => {
        // 始终同步 tasks prop，即使为空数组也要更新
        if (Array.isArray(tasks)) {
            setLocalTasks(tasks);
        }
    }, [tasks]);

    // 自动滚动日志到底部
    useEffect(() => {
        if (activeTab === 'logs' && logContainerRef.current && logs.length > 0) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs, activeTab]);

    // 切换任务展开/折叠
    const toggleTask = (taskId: string) => {
        setLocalTasks(prev =>
            prev.map(task =>
                task.id === taskId
                    ? { ...task, isExpanded: !task.isExpanded }
                    : task
            )
        );
    };

    // 渲染状态图标
    const renderStatusIcon = (status: BESIIISubTask['status']) => {
        switch (status) {
            case 'completed':
                return <CheckCircle size={20} className="text-green-500" />;
            case 'running':
                return (
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${darkMode === "dark" ? "bg-yellow-500/20 text-yellow-400" : "bg-yellow-100 text-yellow-800"}`}>
                        <Clock size={14} />
                        <span>执行中</span>
                    </div>
                );
            case 'waiting':
                return (
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${darkMode === "dark" ? "bg-gray-700 text-gray-400" : "bg-gray-100 text-gray-500"}`}>
                        <Circle size={14} />
                        <span>等待中</span>
                    </div>
                );
        }
    };

    const globalInfoKeys = Object.keys(globalInfo);
    const globalInfoReadOnlyKeys = GLOBAL_INFO_READ_ONLY_ORDER.filter(
        (k) => k in globalInfo
    );
    const globalInfoEditableKeys = Object.keys(globalInfo).filter(
        (k) => !GLOBAL_INFO_READ_ONLY_SET.has(k)
    );

    const hasGlobalInfoEdits = React.useMemo(() => {
        const initial = initialGlobalInfoRef.current;
        for (const key of Object.keys(globalInfo)) {
            if (GLOBAL_INFO_READ_ONLY_SET.has(key)) continue;
            if ((globalInfo[key] ?? "") !== (initial[key] ?? "")) {
                return true;
            }
        }
        return false;
    }, [globalInfo]);

    const reviseDisabled = !onInputResponse || !hasGlobalInfoEdits;

    const updateGlobalField = (key: string, value: string) => {
        setGlobalInfo((prev) => ({ ...prev, [key]: value }));
    };

    const handleRevise = () => {
        if (!onInputResponse) {
            console.warn("[BESIII] Revise skipped: onInputResponse is not wired");
            return;
        }
        const initial = initialGlobalInfoRef.current;
        const changed: Record<string, string> = {};
        for (const key of globalInfoEditableKeys) {
            const cur = globalInfo[key] ?? "";
            const init = initial[key] ?? "";
            if (cur !== init) {
                changed[key] = cur;
            }
        }
        if (Object.keys(changed).length === 0) {
            console.warn("[BESIII] Revise skipped: no edited fields");
            return;
        }
        // Revise: `type` on envelope metadata; edited fields only in inner `content` JSON (see useTaskActions)
        onInputResponse(JSON.stringify(changed), false, undefined, [], undefined, {
            type: "global_info",
        });
    };

    const renderGlobalInfo = () => {
        const border = darkMode === "dark" ? "border-gray-700" : "border-gray-200";
        const muted = darkMode === "dark" ? "text-gray-500" : "text-gray-500";
        const keyCls = `shrink-0 font-mono text-xs ${muted} sm:w-44`;
        const inputCls =
            darkMode === "dark"
                ? "bg-gray-900 border-gray-600 text-gray-100 focus:border-purple-500 focus:ring-purple-500/30"
                : "bg-white border-gray-300 text-gray-900 focus:border-purple-500 focus:ring-purple-500/30";
        const valueCls = darkMode === "dark" ? "text-gray-100" : "text-gray-900";

        const row = "px-3 py-2.5 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4";

        return (
            <div
                className={`flex min-h-0 flex-1 flex-col p-4 ${globalInfoKeys.length === 0 ? "overflow-hidden" : "overflow-y-auto"}`}
            >
                {globalInfoKeys.length === 0 ? (
                    <div
                        className={`flex min-h-0 flex-1 items-center justify-center rounded-lg border ${border} text-sm ${muted}`}
                    >
                        Loading...
                    </div>
                ) : (
                    <>
                        <div className={`rounded-lg border ${border} divide-y ${darkMode === "dark" ? "divide-gray-700" : "divide-gray-200"}`}>
                            {globalInfoReadOnlyKeys.map((key) => (
                                <div key={key} className={row}>
                                    <span className={keyCls}>{key}</span>
                                    <span className={`text-sm break-all min-h-[1.25rem] flex-1 ${valueCls}`}>
                                        {globalInfo[key] ?? ""}
                                    </span>
                                </div>
                            ))}
                            {globalInfoEditableKeys.map((key) => {
                                const initial = initialGlobalInfoRef.current[key] ?? "";
                                const current = globalInfo[key] ?? "";
                                const isEdited = current !== initial;
                                return (
                                    <div key={key} className={row}>
                                        <label htmlFor={`global-info-${key}`} className={keyCls}>
                                            {key}
                                        </label>
                                        <div className="flex flex-1 min-w-0 items-center gap-2">
                                            <input
                                                id={`global-info-${key}`}
                                                type="text"
                                                value={current}
                                                onChange={(e) => updateGlobalField(key, e.target.value)}
                                                className={`flex-1 min-w-0 rounded-md border px-2.5 py-1.5 h-9 text-sm focus:outline-none focus:ring-2 ${inputCls}`}
                                            />
                                            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center">
                                                {isEdited ? (
                                                    <Check
                                                        size={16}
                                                        className={
                                                            darkMode === "dark"
                                                                ? "text-emerald-400"
                                                                : "text-emerald-600"
                                                        }
                                                        strokeWidth={2.5}
                                                    />
                                                ) : null}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="mt-4 flex justify-end">
                            <button
                                type="button"
                                onClick={handleRevise}
                                disabled={reviseDisabled}
                                title={
                                    !onInputResponse
                                        ? "Input response is not available"
                                        : !hasGlobalInfoEdits
                                            ? "Edit at least one field to submit"
                                            : undefined
                                }
                                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${darkMode === "dark"
                                    ? "bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-40 disabled:hover:bg-purple-600 disabled:cursor-not-allowed"
                                    : "bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-40 disabled:hover:bg-purple-600 disabled:cursor-not-allowed"
                                    }`}
                            >
                                Revise
                            </button>
                        </div>
                    </>
                )}
            </div>
        );
    };

    const formatTimestamp = (timestamp?: number | string) => {
        if (timestamp === undefined || timestamp === null) {
            return "--";
        }
        const numericValue =
            typeof timestamp === "number" ? timestamp : Number(timestamp);
        if (!Number.isFinite(numericValue)) {
            return "--";
        }
        const millis = numericValue > 1e12 ? numericValue : numericValue * 1000;
        return new Date(millis).toLocaleString();
    };

    const getLevelBadgeClasses = (level: string) => {
        switch (level) {
            case "ERROR":
            case "FATAL":
                return "bg-red-500/20 text-red-300 border-red-500/40";
            case "WARNING":
                return "bg-amber-500/20 text-amber-300 border-amber-500/40";
            case "DEBUG":
            case "TRACE":
                return "bg-cyan-500/20 text-cyan-300 border-cyan-500/40";
            default:
                return "bg-emerald-500/20 text-emerald-200 border-emerald-500/40";
        }
    };

    const renderLogMeta = (logLevel: string, source?: string, contentType?: string) => (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span
                className={`px-2 py-0.5 rounded-full border font-semibold ${getLevelBadgeClasses(
                    logLevel
                )}`}
            >
                {logLevel}
            </span>
            <span className="text-slate-400">{source || "agent"}</span>
            {contentType && (
                <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-200 border border-purple-500/30">
                    {contentType}
                </span>
            )}
        </div>
    );

    // 渲染全局任务执行标签页
    const renderLogs = () => {
        if (!logs || logs.length === 0) {
            return (
                <div className="flex h-full min-h-0 items-center justify-center rounded-lg border border-gray-900 bg-gray-950 text-sm text-slate-300">
                    <div className="text-center">
                        <div className="text-slate-500 mb-2">📋</div>
                        <div>暂无日志</div>
                    </div>
                </div>
            );
        }

        return (
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <div
                    ref={logContainerRef}
                    className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-900 bg-gray-950 shadow-inner"
                    style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: '#475569 #0f172a'
                    }}
                >
                    <div className="min-w-0 p-4 flex flex-col gap-3 text-slate-100">
                        {logs.map((log, index) => {
                            const level = (log.send_level || "INFO").toUpperCase();
                            return (
                                <div
                                    key={`${log.send_time_stamp ?? index}-${index}`}
                                    className="min-w-0 rounded-lg bg-gray-900 border border-gray-800 shadow-sm"
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 bg-gray-900/80 px-4 py-2">
                                        <span className="font-mono text-[12px] text-slate-400">
                                            {formatTimestamp(log.send_time_stamp)}
                                        </span>
                                        {renderLogMeta(level, log.source, log.content_type)}
                                    </div>
                                    <div className="min-w-0 overflow-x-hidden px-4 py-3">
                                        <pre className="max-w-full whitespace-pre-wrap break-words font-mono text-sm text-slate-100 leading-relaxed select-text [overflow-wrap:anywhere]">
                                            {log.content}
                                        </pre>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-400 px-1">
                    <span>共 {logs.length} 条日志条目</span>
                    <span className="text-slate-500">自动滚动到底部</span>
                </div>
            </div>
        );
    };

    // 渲染 Terminal 标签页
    const renderTerminal = () => (
        <div className="h-full min-h-0 overflow-y-auto rounded-lg bg-black p-4 font-mono text-sm text-green-400">
            <pre className="whitespace-pre-wrap">
                {terminalOutput || "等待输出..."}
            </pre>
        </div>
    );

    return (
        <div
            className={`${darkMode === "dark" ? "bg-[#0f0f0f]" : "bg-white"} flex h-full min-h-0 min-w-0 w-full flex-col overflow-x-hidden rounded-lg shadow-lg`}
        >
            {/* Segmented control — 仅渲染当前有数据的 tab */}
            {visibleTabs.length > 0 ? (
                <div className="flex-shrink-0 px-3 pt-3 pb-2">
                    <div className={`flex min-w-0 rounded-lg p-[3px] ${darkMode === "dark" ? "bg-[#1e1e1e]" : "bg-gray-100"}`}>
                        {visibleTabs.map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                title={tab.label}
                                className={`min-w-0 flex-1 truncate py-1 px-2 text-[11px] font-medium rounded-md transition-all ${activeTab === tab.id
                                    ? darkMode === "dark"
                                        ? "bg-[#2a2a2a] text-white shadow-sm"
                                        : "bg-white text-gray-900 shadow-sm"
                                    : darkMode === "dark"
                                        ? "text-gray-400 hover:text-gray-200"
                                        : "text-gray-500 hover:text-gray-700"
                                    }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            {/* Tab Content — min-h-0 让 flex 子项可收缩，避免无溢出时出现纵向滚动条 */}
            <div className={`min-h-0 flex-1 overflow-hidden ${darkMode === "dark" ? "bg-[#0f0f0f]" : ""}`}>
                {visibleTabs.length === 0 ? (
                    <div
                        className="relative flex h-full min-h-0 flex-col items-center justify-center overflow-hidden p-6"
                        aria-busy
                        aria-label="加载中"
                    >
                        <style>{BESIII_IDLE_KEYFRAMES}</style>
                        {!showEmptyHint ? (
                            <>
                                <div
                                    className={`pointer-events-none absolute inset-0 will-change-[opacity] ${darkMode === "dark"
                                        ? "bg-[radial-gradient(ellipse_at_50%_40%,rgba(129,140,248,0.14),transparent_58%)]"
                                        : "bg-[radial-gradient(ellipse_at_50%_40%,rgba(99,102,241,0.1),transparent_58%)]"
                                        }`}
                                    style={{
                                        animation:
                                            darkMode === "dark"
                                                ? "besiii-idle-glow 6s ease-in-out infinite"
                                                : "besiii-idle-glow 2.2s ease-in-out infinite",
                                        opacity: darkMode === "dark" ? 0.14 : undefined,
                                    }}
                                    aria-hidden
                                />
                                <div className="relative z-10 flex h-11 items-end justify-center gap-1.5" aria-hidden>
                                    {(darkMode === "dark" ? [0, 1, 2, 3] : [0, 1, 2, 3, 4, 5]).map((i) => (
                                        <div
                                            key={i}
                                            className={`h-8 w-[5px] shrink-0 rounded-full will-change-transform ${darkMode === "dark" ? "bg-indigo-300/55" : "bg-indigo-500/65"
                                                }`}
                                            style={{
                                                transformOrigin: "bottom center",
                                                animation:
                                                    darkMode === "dark"
                                                        ? "besiii-idle-wave 1.65s ease-in-out infinite"
                                                        : "besiii-idle-wave 1.05s ease-in-out infinite",
                                                animationDelay: `${i * (darkMode === "dark" ? 140 : 95)}ms`,
                                            }}
                                        />
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className="relative z-10 w-full max-w-[380px]">
                                <style>{`
@keyframes ao-scan {
  0% { transform: translateY(-140%); opacity: 0; }
  10% { opacity: 0.65; }
  50% { opacity: 0.65; }
  100% { transform: translateY(140%); opacity: 0; }
}
@keyframes ao-glitch {
  0%, 92%, 100% { transform: translateX(0); }
  93% { transform: translateX(-1px); }
  94% { transform: translateX(1px); }
  95% { transform: translateX(-2px); }
  96% { transform: translateX(2px); }
  97% { transform: translateX(-1px); }
  98% { transform: translateX(1px); }
}
@keyframes ao-blink {
  0%, 92%, 100% { transform: scaleY(1); }
  93%, 94% { transform: scaleY(0.12); }
}
@keyframes ao-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.9; }
}
@keyframes ao-dots {
  0% { transform: translateX(0); opacity: 0.35; }
  50% { opacity: 0.85; }
  100% { transform: translateX(18px); opacity: 0.35; }
}
@keyframes ao-tail {
  0%, 100% { transform: rotate(8deg); }
  50% { transform: rotate(-10deg); }
}
@keyframes ao-zzz {
  0% { transform: translate(0, 0); opacity: 0; }
  15% { opacity: 0.75; }
  80% { opacity: 0.75; }
  100% { transform: translate(10px, -14px); opacity: 0; }
}
@keyframes ao-cat-breathe {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(1.5px); }
}
@keyframes ao-tail-sway {
  0%, 100% { transform: rotate(10deg); }
  50% { transform: rotate(-14deg); }
}
                                `}</style>

                                <div
                                    className={`relative overflow-hidden rounded-2xl border px-4 py-4 shadow-sm ${darkMode === "dark"
                                        ? "border-[rgba(168,85,247,0.22)] bg-white/[0.03] text-zinc-100"
                                        : "border-[rgba(168,85,247,0.28)] bg-white/85 text-slate-900"
                                        }`}
                                >
                                    <div
                                        className={`pointer-events-none absolute inset-0 ${darkMode === "dark"
                                            ? "bg-[radial-gradient(circle_at_50%_35%,rgba(168,85,247,0.18),transparent_62%)]"
                                            : "bg-[radial-gradient(circle_at_50%_35%,rgba(168,85,247,0.14),transparent_62%)]"
                                            }`}
                                        aria-hidden
                                    />
                                    <div
                                        className={`pointer-events-none absolute -inset-px opacity-70 ${darkMode === "dark"
                                            ? "bg-[linear-gradient(90deg,transparent,rgba(168,85,247,0.18),transparent)]"
                                            : "bg-[linear-gradient(90deg,transparent,rgba(168,85,247,0.14),transparent)]"
                                            }`}
                                        style={{ animation: "ao-scan 2.8s ease-in-out infinite" }}
                                        aria-hidden
                                    />

                                    <div className="relative flex items-center gap-3">
                                        {/* lazy cyber cat */}
                                        <div
                                            className="relative h-14 w-14 shrink-0"
                                            style={{ animation: "ao-cat-breathe 2.2s ease-in-out infinite" }}
                                            aria-hidden
                                        >
                                            {/* Zzz */}
                                            <div className="absolute -right-1 -top-1 text-[10px] font-mono tracking-[0.25em] text-[#a855f7]/80">
                                                <span style={{ animation: "ao-zzz 1.8s ease-in-out infinite" }}>Z</span>
                                                <span style={{ animation: "ao-zzz 1.8s ease-in-out infinite", animationDelay: "220ms" }}>Z</span>
                                                <span style={{ animation: "ao-zzz 1.8s ease-in-out infinite", animationDelay: "440ms" }}>Z</span>
                                            </div>

                                            {/* Pixel cat */}
                                            <svg
                                                viewBox="0 0 16 16"
                                                className="h-14 w-14"
                                                shapeRendering="crispEdges"
                                                style={{
                                                    filter: darkMode === "dark"
                                                        ? "drop-shadow(0 0 10px rgba(168,85,247,0.28))"
                                                        : "drop-shadow(0 0 10px rgba(168,85,247,0.2))",
                                                }}
                                            >
                                                {/* outline */}
                                                <g fill={darkMode === "dark" ? "rgba(168,85,247,0.75)" : "rgba(168,85,247,0.55)"}>
                                                    <rect x="3" y="3" width="1" height="1" />
                                                    <rect x="4" y="2" width="1" height="1" />
                                                    <rect x="5" y="2" width="1" height="1" />
                                                    <rect x="6" y="3" width="1" height="1" />
                                                    <rect x="10" y="3" width="1" height="1" />
                                                    <rect x="11" y="2" width="1" height="1" />
                                                    <rect x="12" y="2" width="1" height="1" />
                                                    <rect x="13" y="3" width="1" height="1" />

                                                    <rect x="2" y="5" width="1" height="6" />
                                                    <rect x="14" y="5" width="1" height="6" />
                                                    <rect x="3" y="11" width="11" height="1" />
                                                    <rect x="4" y="12" width="9" height="1" />
                                                </g>

                                                {/* face fill */}
                                                <g fill={darkMode === "dark" ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.78)"}>
                                                    <rect x="3" y="5" width="11" height="6" />
                                                    <rect x="4" y="4" width="9" height="1" />
                                                </g>

                                                {/* eyes + mouth */}
                                                <g fill={darkMode === "dark" ? "rgba(168,85,247,0.8)" : "rgba(168,85,247,0.65)"}>
                                                    <rect x="6" y="7" width="1" height="1" />
                                                    <rect x="10" y="7" width="1" height="1" />
                                                    <rect x="8" y="9" width="1" height="1" />
                                                    <rect x="7" y="10" width="3" height="1" />
                                                </g>

                                                {/* blush cheeks */}
                                                <g fill={darkMode === "dark" ? "rgba(244,114,182,0.35)" : "rgba(244,114,182,0.28)"}>
                                                    <rect x="5" y="9" width="1" height="1" />
                                                    <rect x="11" y="9" width="1" height="1" />
                                                </g>

                                                {/* tail */}
                                                <g fill={darkMode === "dark" ? "rgba(168,85,247,0.55)" : "rgba(168,85,247,0.45)"}>
                                                    <rect x="14" y="10" width="1" height="1" />
                                                    <rect x="15" y="9" width="1" height="2" />
                                                </g>
                                            </svg>
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <div className={`text-[12px] font-mono ${darkMode === "dark" ? "text-zinc-200" : "text-slate-700"}`}>
                                                <span className="font-semibold">{agentOwner}</span>: {emptyPanelQuip}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        {activeTab === "logs" && hasLogsTab && (
                            <div className="flex h-full min-h-0 flex-col p-4">{renderLogs()}</div>
                        )}
                        {activeTab === "global_info" && hasGlobalInfoTab && (
                            <div className="flex h-full min-h-0 flex-col">{renderGlobalInfo()}</div>
                        )}
                        {activeTab === "terminal" && hasTerminalTab && (
                            <div className="flex h-full min-h-0 flex-col p-4">{renderTerminal()}</div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default BESIIIPanel;

