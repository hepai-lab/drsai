import { useAgentInfo } from "@/components/features/Agents/useAgentInfo";
import { appContext } from "@/hooks/provider";
import { FileText } from "lucide-react";
import { RcFile } from "antd/es/upload";
import * as React from "react";
import { Agent } from "../../types/common";
import { IPlan } from "../../components/types/plan";
import ChatInput from "./chat/chatinput";
import type { ServerUploadedFileInfo } from "./chat/hooks/useFileUpload";
import SampleTasks from "./sampletasks";

interface NewChatViewProps {
    agent: Agent;
    serverFilesPrefill?: ServerUploadedFileInfo[] | null;
    onSubmit: (agent: Agent, query: string, files: RcFile[] | Array<{
        name: string;
        type: string;
        path: string;
        suffix: string;
        size: number;
        uuid: string;
        url?: string;
    }>, plan?: IPlan) => Promise<void>;
}

/**
 * 新对话视图 - 当用户选中智能体但还没有创建会话时显示
 */
export default function NewChatView({ agent, onSubmit, serverFilesPrefill }: NewChatViewProps) {
    const chatInputRef = React.useRef<{
        focus: () => void;
        setValue: (value: string) => void;
    }>(null);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [hasInputValue, setHasInputValue] = React.useState(false);
    const { user, darkMode } = React.useContext(appContext);
    const { agentInfo } = useAgentInfo(user?.email);
    const isDark = darkMode === "dark";

    // 从 store 中获取 config 并合并到 agent 对象中

    const handleSubmit = async (
        query: string,
        files: RcFile[] | Array<{
            name: string;
            type: string;
            path: string;
            suffix: string;
            size: number;
            uuid: string;
            url?: string;
        }>,
        accepted: boolean = false,
        plan?: IPlan
    ) => {
        // 允许只发送文件（没有文本）
        if (isSubmitting || (!query.trim() && (Array.isArray(files) ? files.length === 0 : false))) return;

        // 如果只有文件没有文字，添加默认提示
        let finalQuery = query;
        if (!query.trim() && Array.isArray(files) && files.length > 0) {
            finalQuery = "请帮我分析这些文件。";
        }

        setIsSubmitting(true);
        try {
            // 注意：文件上传逻辑已经在 ChatInput 组件内部处理了
            // 这里只需要调用 onSubmit，不需要再次上传文件
            // 传递完整的 agent，确保使用的是包含完整配置的 agent
            await onSubmit((agentInfo ?? agent) as Agent, finalQuery, files, plan);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <style>{`
                .hide-scrollbar::-webkit-scrollbar {
                    display: none;
                }
                .hide-scrollbar {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
            `}</style>

            <div className="flex flex-col h-full overflow-hidden">
                <div className="flex-1 flex items-start justify-center overflow-y-auto hide-scrollbar pt-[15vh]">
                    <div className="w-full max-w-4xl py-8 px-4">
                        <div className="text-center space-y-4">
                            {/* Agent Logo and Name */}
                            <div className="animate-fade-in">
                                <div className="flex flex-col items-center gap-4">
                                    <div className="space-y-2">
                                        <h1 className="text-5xl font-bold">
                                            <span className="text-6xl bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent font-extrabold">
                                                {agentInfo?.name ?? agent?.name ?? "Dr.Sai"}
                                            </span>
                                        </h1>
                                        {(agentInfo?.description ?? agent?.description) && (
                                            <p className="text-xl text-secondary">
                                                {agentInfo?.description ?? agent?.description}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {serverFilesPrefill && serverFilesPrefill.length > 0 && (
                                <div className="w-full px-4 text-left">
                                    <div
                                        className={`rounded-xl border px-4 py-3 text-sm ${isDark
                                            ? "border-border-primary/35 bg-white/[0.04] text-primary"
                                            : "border-gray-200 bg-gray-50/90 text-gray-900"
                                            }`}
                                    >
                                        <div className="flex items-center gap-2 font-medium mb-2">
                                            <FileText className="w-4 h-4 shrink-0 opacity-80" aria-hidden />
                                            <span>已从库选择 {serverFilesPrefill.length} 个文件（直接引用，无需重新上传）</span>
                                        </div>
                                        <ul className="space-y-1 text-secondary text-xs sm:text-sm">
                                            {serverFilesPrefill.map((f) => (
                                                <li key={f.uuid} className="truncate" title={f.name}>
                                                    {f.name}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            )}

                            {/* Chat Input - Centered between title and tasks */}
                            <div className="w-full px-4">
                                <ChatInput
                                    ref={chatInputRef}
                                    onSubmit={handleSubmit}
                                    error={null}
                                    onCancel={() => { }}
                                    runStatus={undefined}
                                    inputRequest={undefined}
                                    isPlanMessage={false}
                                    onPause={() => { }}
                                    enable_upload={true}
                                    onExecutePlan={() => { }}
                                    sessionId={-1}
                                    onTextChange={(text) => {
                                        setHasInputValue(text.trim().length > 0);
                                    }}
                                    serverFilesPrefill={serverFilesPrefill}
                                />
                            </div>

                            {/* Sample Tasks */}
                            <SampleTasks
                                hasInputValue={hasInputValue}
                                onSelect={(task: string) => {
                                    setTimeout(() => {
                                        if (chatInputRef.current) {
                                            chatInputRef.current.setValue(task);
                                        }
                                    }, 200);
                                }}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

