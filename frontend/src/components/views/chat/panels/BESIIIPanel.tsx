import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, CheckCircle, Clock, Circle } from "lucide-react";
import { BESIIIPanelProps, BESIIITask, BESIIISubTask } from "./types";
import { appContext } from "../../../../hooks/provider";

/**
 * BESIII Panel - 用于显示 BESIII Agent 的任务执行状态
 * 
 * 功能：
 * 1. 全局任务执行 - 总览
 * 2. TaskManager - 任务管理和状态跟踪
 * 3. Terminal - 终端输出
 */

type TabType = 'logs' | 'taskmanager' | 'terminal';

const BESIIIPanel: React.FC<BESIIIPanelProps> = ({
    tasks = [],
    terminalOutput = '',
    logs = [],
    onMinimize,
}) => {
    const { darkMode } = React.useContext(appContext);
    const [activeTab, setActiveTab] = useState<TabType>('taskmanager');
    const [localTasks, setLocalTasks] = useState<BESIIITask[]>(tasks);
    const logContainerRef = useRef<HTMLDivElement>(null);

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

    // 渲染 TaskManager 标签页
    const renderTaskManager = () => (
        <div className="flex flex-col gap-2 overflow-y-auto">
            {localTasks.length === 0 ? (
                <div className={`flex items-center justify-center h-full ${darkMode === "dark" ? "text-gray-400" : "text-gray-500"}`}>
                    暂无任务
                </div>
            ) : (
                localTasks.map(task => (
                    <div key={task.id} className={`border rounded-lg overflow-hidden ${darkMode === "dark" ? "border-gray-700" : ""}`}>
                        {/* Task Header */}
                        <div
                            className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${darkMode === "dark" ? "bg-purple-500/20 hover:bg-purple-500/30" : "bg-purple-100 hover:bg-purple-200"}`}
                            onClick={() => toggleTask(task.id)}
                        >
                            <span className={`font-medium ${darkMode === "dark" ? "text-gray-200" : "text-gray-800"}`}>{task.name}</span>
                            {task.isExpanded ? (
                                <ChevronDown size={20} className={darkMode === "dark" ? "text-gray-300" : ""} />
                            ) : (
                                <ChevronUp size={20} className={darkMode === "dark" ? "text-gray-300" : ""} />
                            )}
                        </div>

                        {/* Subtasks */}
                        {task.isExpanded && (
                            <div className={darkMode === "dark" ? "bg-[#0f0f0f]" : "bg-white"}>
                                {task.subtasks.map(subtask => (
                                    <div
                                        key={subtask.id}
                                        className={`flex items-center justify-between px-4 py-3 border-b last:border-b-0 ${darkMode === "dark" ? "border-gray-700 hover:bg-gray-800" : "hover:bg-gray-50"}`}
                                    >
                                        <span className={darkMode === "dark" ? "text-gray-300" : "text-gray-700"}>{subtask.name}</span>
                                        {renderStatusIcon(subtask.status)}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))
            )}
        </div>
    );

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
                    className={`px-6 py-3 font-medium transition-colors relative focus:outline-none ${activeTab === 'taskmanager'
                        ? darkMode === "dark"
                            ? 'bg-[#0f0f0f] text-purple-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-500'
                            : 'bg-white text-purple-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-500'
                        : darkMode === "dark"
                            ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                    onClick={() => setActiveTab('taskmanager')}
                >
                    TaskManager
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
                {activeTab === 'taskmanager' && <div className="h-full p-4 overflow-y-auto">{renderTaskManager()}</div>}
                {activeTab === 'terminal' && renderTerminal()}
            </div>
        </div>
    );
};

export default BESIIIPanel;

