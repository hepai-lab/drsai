import { Check, CheckCircle, Circle, Clock } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { appContext } from "../../../../hooks/provider";
import { BESIIIPanelProps, BESIIISubTask, BESIIITask } from "./types";

/**
 * BESIII Panel - 用于显示 BESIII Agent 的任务执行状态
 * 
 * 功能：
 * 1. 全局任务执行 - 总览
 * 2. Files - 文件列表和下载
 * 3. Terminal - 终端输出
 */

type TabType = 'logs' | 'files' | 'terminal';

/** Shown first; only these keys are treated as read-only. */
const GLOBAL_INFO_READ_ONLY_ORDER = ["taskName", "root_path"] as const;
const GLOBAL_INFO_READ_ONLY_SET = new Set<string>(GLOBAL_INFO_READ_ONLY_ORDER);

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
    const { darkMode } = React.useContext(appContext);
    const [internalActiveTab, setInternalActiveTab] = useState<TabType>('files');
    // 使用受控的 activeTab（如果提供），否则使用内部状态
    const activeTab = controlledActiveTab !== undefined ? controlledActiveTab : internalActiveTab;
    const setActiveTab = (tab: TabType) => {
        if (onTabChange) {
            onTabChange(tab);
        } else {
            setInternalActiveTab(tab);
        }
    };
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
            <div className="flex flex-col h-full overflow-y-auto p-4">
                {globalInfoKeys.length === 0 ? (
                    <div
                        className={`flex flex-1 min-h-[160px] items-center justify-center rounded-lg border ${border} text-sm ${muted}`}
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
                <div className="flex items-center justify-center h-full text-slate-300 text-sm bg-gray-950 rounded-lg border border-gray-900">
                    <div className="text-center">
                        <div className="text-slate-500 mb-2">📋</div>
                        <div>暂无日志</div>
                    </div>
                </div>
            );
        }

        return (
            <div className="h-full overflow-hidden flex flex-col">
                <div
                    ref={logContainerRef}
                    className="flex-1 overflow-y-auto bg-gray-950 rounded-lg border border-gray-900 shadow-inner"
                    style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: '#475569 #0f172a'
                    }}
                >
                    <div className="p-4 flex flex-col gap-3 text-slate-100">
                        {logs.map((log, index) => {
                            const level = (log.send_level || "INFO").toUpperCase();
                            return (
                                <div
                                    key={`${log.send_time_stamp ?? index}-${index}`}
                                    className="rounded-lg bg-gray-900 border border-gray-800 shadow-sm"
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 bg-gray-900/80 px-4 py-2">
                                        <span className="font-mono text-[12px] text-slate-400">
                                            {formatTimestamp(log.send_time_stamp)}
                                        </span>
                                        {renderLogMeta(level, log.source, log.content_type)}
                                    </div>
                                    <div className="px-4 py-3">
                                        <pre className="whitespace-pre-wrap font-mono text-sm text-slate-100 leading-relaxed select-text">
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
        <div className="bg-black text-green-400 font-mono text-sm p-4 rounded overflow-y-auto h-full">
            <pre className="whitespace-pre-wrap">
                {terminalOutput || '等待输出...'}
            </pre>
        </div>
    );

    return (
        <div className={`${darkMode === "dark" ? "bg-[#0f0f0f]" : "bg-white"} rounded-lg shadow-lg h-full flex flex-col`}>
            {/* Tab Headers */}
            <div className={`flex border-b ${darkMode === "dark" ? "bg-[#1a1a1a] border-gray-700" : "bg-gray-50 border-gray-200"}`}>

                <button
                    className={`px-6 py-3 font-medium transition-colors relative focus:outline-none ${activeTab === 'files'
                        ? darkMode === "dark"
                            ? 'bg-[#0f0f0f] text-purple-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-500'
                            : 'bg-white text-purple-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-500'
                        : darkMode === "dark"
                            ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                    onClick={() => setActiveTab('files')}
                >
                    Global Info
                </button>
                <button
                    className={`px-6 py-3 font-medium transition-colors relative focus:outline-none ${activeTab === 'logs'
                        ? darkMode === "dark"
                            ? 'bg-[#0f0f0f] text-purple-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-500'
                            : 'bg-white text-purple-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-500'
                        : darkMode === "dark"
                            ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                    onClick={() => setActiveTab('logs')}
                >
                    LogExecution
                </button>
                <button
                    className={`px-6 py-3 font-medium transition-colors relative focus:outline-none ${activeTab === 'terminal'
                        ? darkMode === "dark"
                            ? 'bg-[#0f0f0f] text-purple-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-500'
                            : 'bg-white text-purple-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-500'
                        : darkMode === "dark"
                            ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                    onClick={() => setActiveTab('terminal')}
                >
                    Terminal
                </button>

                {/* Minimize button */}
                {onMinimize && (
                    <button
                        onClick={onMinimize}
                        className={`ml-auto px-4 ${darkMode === "dark" ? "text-gray-400 hover:text-gray-200" : "text-gray-500 hover:text-gray-700"}`}
                        title="最小化"
                    >
                        ✕
                    </button>
                )}
            </div>

            {/* Tab Content */}
            <div className={`flex-1 overflow-hidden ${darkMode === "dark" ? "bg-[#0f0f0f]" : ""}`}>
                {activeTab === 'logs' && <div className="h-full p-4">{renderLogs()}</div>}
                {activeTab === 'files' && <div className="h-full overflow-y-auto">{renderGlobalInfo()}</div>}
                {activeTab === 'terminal' && renderTerminal()}
            </div>
        </div>
    );
};

export default BESIIIPanel;

