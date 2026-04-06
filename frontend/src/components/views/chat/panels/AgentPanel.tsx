import React from "react";
import VNCPanel from "./VNCPanel";
import BESIIIPanel from "./BESIIIPanel";
import { AgentPanelConfig } from "../config/agentConfigs";
import { RunLogEntry, FilesEvent } from "../../../types/datamodel";
import { IPlan } from "../../../types/plan";
import type { BESIIIServerGlobalInfo } from "./types";

/**
 * AgentPanel - 通用 Panel 容器组件
 * 根据 agent 配置动态渲染不同类型的面板
 */

interface AgentPanelProps {
    // Agent 配置
    panelConfig: AgentPanelConfig;

    // 通用 props
    onMinimize: () => void;

    // VNC Panel 需要的 props
    vncProps?: {
        images: string[];
        imageTitles: string[];
        currentIndex: number;
        onIndexChange: (index: number) => void;
        novncPort?: string;
        onPause?: () => void;
        runStatus?: string;
        activeTab?: "screenshots" | "live";
        onTabChange?: (tab: "screenshots" | "live") => void;
        detailViewerContainerId?: string;
        onInputResponse?: (
            response: string,
            accepted?: boolean,
            plan?: any,
            files?: any[],
            llm?: { label: string; value: string },
            inputMetadata?: Record<string, unknown>
        ) => void;
        isExpanded?: boolean;
        onToggleExpand?: () => void;
    };

    // BESIII Panel 需要的 props
    besiiiProps?: {
        logs?: RunLogEntry[];
        tasks?: any[];
        terminalOutput?: string;
        fileEvents?: FilesEvent[];
        serverGlobalInfo?: BESIIIServerGlobalInfo | null;
        onTaskClick?: (taskId: string) => void;
        onSubtaskClick?: (taskId: string, subtaskId: string) => void;
        activeTab?: 'info' | 'files' | 'logs' | 'terminal';
        onTabChange?: (tab: 'info' | 'files' | 'logs' | 'terminal') => void;
        /** When true, panel uses narrower width (matches detail viewer expanded layout). */
        isExpanded?: boolean;
        onInputResponse?: (
            response: string,
            accepted?: boolean,
            plan?: IPlan,
            files?: any[],
            llm?: { label: string; value: string },
            inputMetadata?: Record<string, unknown>
        ) => void;
    };

    // 其他扩展 props
    [key: string]: any;
}

const AgentPanel: React.FC<AgentPanelProps> = ({
    panelConfig,
    onMinimize,
    vncProps,
    besiiiProps,
    ...otherProps
}) => {

    // 根据面板类型渲染对应的组件
    const renderPanel = () => {
        switch (panelConfig.type) {
            case 'vnc':
                // VNC 浏览器预览面板 (magentic-one)
                if (!vncProps) {
                    return (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            VNC Panel: Missing props
                        </div>
                    );
                }
                return (
                    <VNCPanel
                        images={vncProps.images}
                        imageTitles={vncProps.imageTitles}
                        currentIndex={vncProps.currentIndex}
                        onIndexChange={vncProps.onIndexChange}
                        novncPort={vncProps.novncPort}
                        onPause={vncProps.onPause}
                        runStatus={vncProps.runStatus}
                        activeTab={vncProps.activeTab}
                        onTabChange={vncProps.onTabChange}
                        detailViewerContainerId={vncProps.detailViewerContainerId}
                        onInputResponse={vncProps.onInputResponse}
                        isExpanded={vncProps.isExpanded ?? false}
                        onToggleExpand={vncProps.onToggleExpand ?? (() => { })}
                        onMinimize={onMinimize}
                    />
                );

            case 'besiii':
                // BESIII 分析面板
                return (
                    <div
                        className={`flex h-full min-h-0 w-full max-w-full shrink-0 flex-col ${besiiiProps?.isExpanded
                            ? "w-[min(100%,360px)] sm:w-[380px] lg:w-[420px] xl:w-[460px] 2xl:w-[520px]"
                            : "w-[min(100%,340px)] sm:w-[360px] lg:w-[400px] xl:w-[420px] 2xl:w-[460px]"
                            }`}
                    >
                        <BESIIIPanel
                            tasks={besiiiProps?.tasks}
                            terminalOutput={besiiiProps?.terminalOutput}
                            logs={besiiiProps?.logs}
                            fileEvents={besiiiProps?.fileEvents}
                            serverGlobalInfo={besiiiProps?.serverGlobalInfo ?? null}
                            onMinimize={onMinimize}
                            onTaskClick={besiiiProps?.onTaskClick}
                            onSubtaskClick={besiiiProps?.onSubtaskClick}
                            activeTab={besiiiProps?.activeTab}
                            onTabChange={besiiiProps?.onTabChange}
                            onInputResponse={besiiiProps?.onInputResponse}
                        />
                    </div>
                );

            case 'terminal':
                // 纯终端面板 (未来扩展)
                return (
                    <div className="bg-black text-green-400 font-mono p-4 rounded h-full overflow-auto">
                        <pre>Terminal Panel (Coming Soon...)</pre>
                    </div>
                );

            case 'none':
            default:
                // 无面板或未知类型
                return null;
        }
    };

    const panel = renderPanel();

    if (!panel) {
        return null;
    }

    return (
        <div
            className={
                panelConfig.type === 'besiii'
                    ? 'flex h-full min-h-0 w-auto max-w-full flex-1 flex-col self-end'
                    : 'h-full min-h-0 w-full'
            }
        >
            {panel}
        </div>
    );
};

export default AgentPanel;

