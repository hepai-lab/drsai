import { Check, CheckCircle, Circle, Clock, Download, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { appContext } from "../../../../hooks/provider";
import { FilesEvent, MessageFileItem } from "../../../types/datamodel";
import { BESIIIPanelProps, BESIIISubTask, BESIIITask } from "./types";

/**
 * BESIII Panel - 用于显示 BESIII Agent 的任务执行状态
 *
 * 功能：
 * 1. Global Info - 全局信息（可编辑字段 Revise）
 * 2. Files - message_files / FilesEvent 文件列表（URL 或 base64 下载）
 * 3. LogExecution - 运行日志
 * 4. Terminal - 终端输出
 */

type TabType = 'info' | 'files' | 'logs' | 'terminal';

const BESIII_TABS: { id: TabType; label: string }[] = [
    { id: "info", label: "Global Info" },
    { id: "files", label: "Files" },
    { id: "logs", label: "LogExecution" },
    { id: "terminal", label: "Terminal" },
];

/** Shown first; only these keys are treated as read-only. */
const GLOBAL_INFO_READ_ONLY_ORDER = ["taskName", "root_path"] as const;
const GLOBAL_INFO_READ_ONLY_SET = new Set<string>(GLOBAL_INFO_READ_ONLY_ORDER);

function besiiiFilesFromEvent(ev: FilesEvent): MessageFileItem[] {
    const c = ev.content?.files;
    if (c && c.length > 0) return c;
    return (ev as FilesEvent & { files?: MessageFileItem[] }).files ?? [];
}

function besiiiEventDisplayMeta(ev: FilesEvent): {
    title?: string;
    description?: string;
    ts?: number;
} {
    const title = ev.content?.title ?? (ev as { title?: string }).title;
    const description =
        ev.content?.description ?? (ev as { description?: string }).description;
    const ts = ev.send_time_stamp ?? ev.content?.send_time_stamp;
    return { title, description, ts };
}

function downloadMessageFileBase64(file: MessageFileItem) {
    const b64 = file.base64_content;
    if (!b64) return;
    try {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const mime = file.mime_type || "application/octet-stream";
        const blob = new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name || "download";
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error("[BESIII] base64 download failed", e);
    }
}

const BESIIIPanel: React.FC<BESIIIPanelProps> = ({
    tasks = [],
    terminalOutput = '',
    logs = [],
    fileEvents = [],
    serverGlobalInfo = null,
    onMinimize,
    onInputResponse,
    activeTab: controlledActiveTab,
    onTabChange,
}) => {
    const { darkMode } = React.useContext(appContext);
    const [internalActiveTab, setInternalActiveTab] = useState<TabType>('info');
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

    /** message_files / FilesEvent：含 download_method url | base64 */
    const renderFiles = () => {
        const border = darkMode === "dark" ? "border-gray-700" : "border-gray-200";
        const muted = darkMode === "dark" ? "text-gray-500" : "text-gray-500";
        const cardBg =
            darkMode === "dark"
                ? "bg-gray-900 border-gray-800"
                : "bg-gray-50 border-gray-200";
        const textMain = darkMode === "dark" ? "text-gray-100" : "text-gray-900";

        if (!fileEvents || fileEvents.length === 0) {
            return (
                <div className="flex items-center justify-center h-full min-h-[200px] px-4">
                    <div
                        className={`flex w-full max-w-lg min-h-[160px] items-center justify-center rounded-lg border text-sm ${border} ${muted}`}
                    >
                        暂无文件事件（message_files / FilesEvent）
                    </div>
                </div>
            );
        }

        return (
            <div className="flex flex-col h-full overflow-y-auto p-4 gap-4">
                {fileEvents.map((ev, evIdx) => {
                    const { title, description, ts } = besiiiEventDisplayMeta(ev);
                    const files = besiiiFilesFromEvent(ev);
                    const eventKey = `${ev.source ?? "ev"}-${String(ts ?? evIdx)}-${evIdx}`;
                    return (
                        <div key={eventKey} className={`rounded-lg border ${border} overflow-hidden`}>
                            <div
                                className={`px-4 py-3 border-b ${border} ${darkMode === "dark" ? "bg-[#1a1a1a]" : "bg-gray-50"}`}
                            >
                                <div className={`text-sm font-medium ${textMain}`}>{title || "Files"}</div>
                                {description ? (
                                    <div className={`text-xs mt-1 ${muted}`}>{description}</div>
                                ) : null}
                                <div className={`flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs ${muted}`}>
                                    {ev.source ? <span>source: {ev.source}</span> : null}
                                    {ev.type ? <span>type: {ev.type}</span> : null}
                                    <span>time: {formatTimestamp(ts)}</span>
                                </div>
                            </div>
                            <div className="p-3 flex flex-col gap-2">
                                {files.length === 0 ? (
                                    <div className={`text-xs ${muted}`}>（无文件条目）</div>
                                ) : (
                                    files.map((file, fi) => (
                                        <div
                                            key={`${file.name}-${fi}`}
                                            className={`rounded-md border p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between ${cardBg}`}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className={`font-medium text-sm ${textMain} break-all`}>
                                                    {file.name}
                                                </div>
                                                {file.description ? (
                                                    <div className={`text-xs mt-1 ${muted}`}>{file.description}</div>
                                                ) : null}
                                                <div className="flex flex-wrap gap-2 mt-2">
                                                    <span
                                                        className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase border ${darkMode === "dark"
                                                            ? "border-purple-500/40 text-purple-300"
                                                            : "border-purple-300 text-purple-700"
                                                            }`}
                                                    >
                                                        {file.download_method}
                                                    </span>
                                                    {file.size != null ? (
                                                        <span className={`text-xs ${muted}`}>
                                                            {typeof file.size === "number"
                                                                ? `${file.size} B`
                                                                : String(file.size)}
                                                        </span>
                                                    ) : null}
                                                    {file.mime_type ? (
                                                        <span className={`text-xs font-mono ${muted}`}>
                                                            {file.mime_type}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <div className="shrink-0 flex items-center gap-2">
                                                {file.download_method === "url" && file.url ? (
                                                    <a
                                                        href={file.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${darkMode === "dark"
                                                            ? "bg-purple-600 hover:bg-purple-500 text-white"
                                                            : "bg-purple-600 hover:bg-purple-700 text-white"
                                                            }`}
                                                    >
                                                        <Download size={16} />
                                                        打开 / 下载
                                                    </a>
                                                ) : null}
                                                {file.download_method === "base64" && file.base64_content ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => downloadMessageFileBase64(file)}
                                                        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${darkMode === "dark"
                                                            ? "bg-purple-600 hover:bg-purple-500 text-white"
                                                            : "bg-purple-600 hover:bg-purple-700 text-white"
                                                            }`}
                                                    >
                                                        <Download size={16} />
                                                        下载
                                                    </button>
                                                ) : null}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const tabPillClass = (tab: TabType) => {
        const isOn = activeTab === tab;
        if (isOn) {
            return darkMode === "dark"
                ? "bg-zinc-800 text-magenta-300 shadow-sm ring-1 ring-white/10"
                : "bg-white text-magenta-800 shadow-sm ring-1 ring-slate-900/[0.06]";
        }
        return darkMode === "dark"
            ? "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
            : "text-slate-600 hover:bg-white/70 hover:text-slate-900";
    };

    return (
        <div
            className={`${darkMode === "dark" ? "bg-[#0f0f0f]" : "bg-white"} flex min-h-0 flex-1 flex-col rounded-lg shadow-lg h-full w-full`}
        >

            {/* Segmented tab strip: scrolls without visible scrollbar; active = pill, not bottom rule */}
            <div
                className={`flex min-w-0 items-center gap-2 border-b px-3 py-2.5 ${darkMode === "dark" ? "border-zinc-800/80 bg-zinc-950/40" : "border-slate-200/90 bg-slate-50/80"}`}
            >
                <div
                    className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                >
                    <div
                        className={`flex w-max min-w-full flex-nowrap gap-0.5 rounded-xl p-1 ${darkMode === "dark" ? "bg-zinc-900/80 ring-1 ring-white/[0.06]" : "bg-slate-200/60 ring-1 ring-slate-900/[0.04]"}`}
                    >
                        {BESIII_TABS.map(({ id, label }) => (
                            <button
                                key={id}
                                type="button"
                                className={`shrink-0 rounded-lg px-3 py-1.5 text-left text-sm font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-magenta-800/30 dark:focus-visible:ring-magenta-500/40 sm:px-3.5 ${tabPillClass(id)}`}
                                onClick={() => setActiveTab(id)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {onMinimize && (
                    <button
                        type="button"
                        onClick={onMinimize}
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${darkMode === "dark" ? "text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100" : "text-slate-500 hover:bg-slate-200/80 hover:text-slate-800"}`}
                        title="最小化"
                        aria-label="最小化面板"
                    >
                        <X className="h-4 w-4" strokeWidth={2} />
                    </button>
                )}
            </div>

            {/* Tab Content */}
            <div className={`min-h-0 flex-1 overflow-hidden ${darkMode === "dark" ? "bg-[#0f0f0f]" : ""}`}>
                {activeTab === 'info' && <div className="h-full overflow-y-auto">{renderGlobalInfo()}</div>}
                {activeTab === 'files' && <div className="h-full overflow-y-auto">{renderFiles()}</div>}
                {activeTab === 'logs' && <div className="h-full p-4">{renderLogs()}</div>}
                {activeTab === 'terminal' && renderTerminal()}
            </div>
        </div>
    );
};

export default BESIIIPanel;

