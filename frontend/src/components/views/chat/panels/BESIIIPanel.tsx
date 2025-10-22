import React, { useState } from "react";
import { ChevronDown, ChevronUp, CheckCircle, Clock, Circle } from "lucide-react";
import { BESIIIPanelProps, BESIIITask, BESIIISubTask } from "./types";

/**
 * BESIII Panel - 用于显示 BESIII Agent 的任务执行状态
 * 
 * 功能：
 * 1. 全局任务执行 - 总览
 * 2. TaskManager - 任务管理和状态跟踪
 * 3. Terminal - 终端输出
 */

type TabType = 'overview' | 'taskmanager' | 'terminal';

const BESIIIPanel: React.FC<BESIIIPanelProps> = ({
    tasks = [],
    terminalOutput = '',
    onMinimize,
}) => {
    const [activeTab, setActiveTab] = useState<TabType>('taskmanager');
    const [localTasks, setLocalTasks] = useState<BESIIITask[]>(tasks);

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
                    <div className="flex items-center gap-1 px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs">
                        <Clock size={14} />
                        <span>执行中</span>
                    </div>
                );
            case 'waiting':
                return (
                    <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-500 rounded-full text-xs">
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
                <div className="flex items-center justify-center h-full text-gray-500">
                    暂无任务
                </div>
            ) : (
                localTasks.map(task => (
                    <div key={task.id} className="border rounded-lg overflow-hidden">
                        {/* Task Header */}
                        <div
                            className="flex items-center justify-between px-4 py-3 bg-purple-100 cursor-pointer hover:bg-purple-200 transition-colors"
                            onClick={() => toggleTask(task.id)}
                        >
                            <span className="font-medium text-gray-800">{task.name}</span>
                            {task.isExpanded ? (
                                <ChevronDown size={20} />
                            ) : (
                                <ChevronUp size={20} />
                            )}
                        </div>

                        {/* Subtasks */}
                        {task.isExpanded && (
                            <div className="bg-white">
                                {task.subtasks.map(subtask => (
                                    <div
                                        key={subtask.id}
                                        className="flex items-center justify-between px-4 py-3 border-b last:border-b-0 hover:bg-gray-50"
                                    >
                                        <span className="text-gray-700">{subtask.name}</span>
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

    // 渲染全局任务执行标签页
    const renderOverview = () => (
        <div className="flex flex-col gap-4 overflow-y-auto">
            <h3 className="text-lg font-semibold">全局任务执行概览</h3>
            {localTasks.map(task => {
                const total = task.subtasks.length;
                const completed = task.subtasks.filter(st => st.status === 'completed').length;
                const running = task.subtasks.filter(st => st.status === 'running').length;
                const progress = total > 0 ? (completed / total) * 100 : 0;

                return (
                    <div key={task.id} className="border rounded-lg p-4 bg-white">
                        <div className="flex justify-between items-center mb-2">
                            <span className="font-medium">{task.name}</span>
                            <span className="text-sm text-gray-500">
                                {completed}/{total} 完成
                            </span>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                            <div
                                className="bg-green-500 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${progress}%` }}
                            />
                        </div>

                        <div className="flex gap-4 text-sm">
                            <span className="text-green-600">✓ {completed} 完成</span>
                            {running > 0 && <span className="text-yellow-600">⟳ {running} 执行中</span>}
                            <span className="text-gray-500">○ {total - completed - running} 等待</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );

    // 渲染 Terminal 标签页
    const renderTerminal = () => (
        <div className="bg-black text-green-400 font-mono text-sm p-4 rounded overflow-y-auto h-full">
            <pre className="whitespace-pre-wrap">
                {terminalOutput || '等待输出...'}
            </pre>
        </div>
    );

    return (
        <div className="bg-white rounded-lg shadow-lg h-full flex flex-col">
            {/* Tab Headers */}
            <div className="flex bg-gray-50 border-b border-gray-200">
                <button
                    className={`px-6 py-3 font-medium transition-colors relative focus:outline-none ${activeTab === 'overview'
                        ? 'bg-white text-purple-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-500'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                    onClick={() => setActiveTab('overview')}
                >
                    全局任务执行
                </button>
                <button
                    className={`px-6 py-3 font-medium transition-colors relative focus:outline-none ${activeTab === 'taskmanager'
                        ? 'bg-white text-purple-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-500'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                    onClick={() => setActiveTab('taskmanager')}
                >
                    TaskManager
                </button>
                <button
                    className={`px-6 py-3 font-medium transition-colors relative focus:outline-none ${activeTab === 'terminal'
                        ? 'bg-white text-purple-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-purple-500'
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
                        className="ml-auto px-4 text-gray-500 hover:text-gray-700"
                        title="最小化"
                    >
                        ✕
                    </button>
                )}
            </div>

            {/* Tab Content */}
            <div className="flex-1 p-4 overflow-hidden">
                {activeTab === 'overview' && renderOverview()}
                {activeTab === 'taskmanager' && renderTaskManager()}
                {activeTab === 'terminal' && renderTerminal()}
            </div>
        </div>
    );
};

export default BESIIIPanel;

