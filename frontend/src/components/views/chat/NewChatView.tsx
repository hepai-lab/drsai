import * as React from "react";
import { RcFile } from "antd/es/upload";
import { IPlan } from "../../types/plan";
import { Agent } from "../../../types/common";
import ChatInput from "./chat/chatinput";
import SampleTasks from "./sampletasks";
import { useModeConfigStore } from "@/store/modeConfig";

interface NewChatViewProps {
    agent: Agent;
    onSubmit: (agent: Agent, query: string, files: RcFile[], plan?: IPlan) => Promise<void>;
}

/**
 * 新对话视图 - 当用户选中智能体但还没有创建会话时显示
 */
export default function NewChatView({ agent, onSubmit }: NewChatViewProps) {
    const chatInputRef = React.useRef<{
        focus: () => void;
        setValue: (value: string) => void;
    }>(null);

    const { config } = useModeConfigStore();
    const [isSubmitting, setIsSubmitting] = React.useState(false);

    // 从 store 中获取 config 并合并到 agent 对象中
    const fullAgent = React.useMemo(() => {

        // 定义配置属性列表（这些属性可能直接在 agent 对象上，也可能在 agent.config 中）
        const configProperties = [
            'model_client',
            'mcp_sse_list',
            'ragflow_configs',
            'system_message',
            'name',
            'url',
            'apiKey',
            'mode',
            'description',
            'id'
        ];

        // 从 agent 对象中提取配置属性
        const extractConfigFromAgent = (agentObj: Agent): any => {
            const extractedConfig: any = {};

            // 提取预定义的配置属性
            configProperties.forEach(prop => {
                const value = (agentObj as any)[prop];
                if (value !== undefined && value !== null) {
                    extractedConfig[prop] = value;
                }
            });

            // 提取其他可能的配置属性（排除 Agent 接口的基本属性）
            const basicAgentProps = ['id', 'name', 'mode', 'description', 'icon', 'tags', 'config', 'logo', 'owner', 'url', 'apiKey', 'baseUrl', 'type'];
            Object.keys(agentObj).forEach(key => {
                if (!basicAgentProps.includes(key) && (agentObj as any)[key] !== undefined && (agentObj as any)[key] !== null) {
                    // 这可能是配置属性（如 model_client, mcp_sse_list 等）
                    extractedConfig[key] = (agentObj as any)[key];
                }
            });

            // 如果提取到了配置，返回配置对象
            if (Object.keys(extractedConfig).length > 0) {
                return extractedConfig;
            }
            return null;
        };

        // 构建最终的 config
        let finalConfig: any = null;

        // 优先级1: 如果 agent 已经有 config 且不为空，直接使用
        if (agent.config && typeof agent.config === 'object' && Object.keys(agent.config).length > 0) {
            finalConfig = agent.config;
        }
        // 优先级2: 如果 agent.config 为空或不存在，从 agent 对象本身提取配置
        else {
            const extractedConfig = extractConfigFromAgent(agent);
            if (extractedConfig) {
                finalConfig = extractedConfig;
            }
        }

        // 优先级3: 如果 store 中有 config，合并到最终配置中
        if (config && typeof config === 'object' && Object.keys(config).length > 0) {
            if (finalConfig) {
                // 合并配置，store 中的 config 优先级更高
                finalConfig = { ...finalConfig, ...config };
            } else {
                finalConfig = config;
            }
        }

        // 如果最终有配置，构建 fullAgent
        if (finalConfig) {
            return {
                ...agent,
                config: finalConfig,
            };
        }

        // 否则返回原始 agent（但确保至少有一个空的 config 对象）
        return {
            ...agent,
            config: agent.config || {},
        };
    }, [agent, config]);

    const handleSubmit = async (
        query: string,
        files: RcFile[],
        accepted: boolean = false,
        plan?: IPlan
    ) => {
        // 允许只发送文件（没有文本）
        if (isSubmitting || (!query.trim() && files.length === 0)) return;

        // 如果只有文件没有文字，添加默认提示
        let finalQuery = query;
        if (!query.trim() && files.length > 0) {
            finalQuery = "请帮我分析这些文件。";
        }

        setIsSubmitting(true);
        try {
            // 传递完整的 agent，确保使用的是包含完整配置的 agent
            await onSubmit(fullAgent, finalQuery, files, plan);
        } finally {
            setIsSubmitting(false);
        }
    };

    React.useEffect(() => {
        console.log("fullAgent :::", fullAgent);
    }, [fullAgent]);

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
                <div className="flex-1 flex items-center justify-center overflow-y-auto hide-scrollbar">
                    <div className="w-full max-w-4xl py-8 px-4">
                        <div className="text-center space-y-8">
                            {/* Agent Logo and Name */}
                            <div className="animate-fade-in">
                                <div className="flex flex-col items-center gap-4">
                                    {fullAgent.logo && (
                                        <img
                                            src={fullAgent.logo}
                                            alt={fullAgent.name}
                                            className="w-20 h-20 rounded-xl shadow-lg"
                                        />
                                    )}
                                    <div className="space-y-2">
                                        <h1 className="text-5xl font-bold">
                                            <span className="text-6xl bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent font-extrabold">
                                                {fullAgent.name}
                                            </span>
                                        </h1>
                                        {fullAgent.description && (
                                            <p className="text-xl text-secondary">
                                                {fullAgent.description}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>

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
                                />
                            </div>

                            {/* Sample Tasks */}
                            <div className="w-full">
                                <SampleTasks
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
            </div>
        </>
    );
}

