import * as React from "react";
import { RcFile } from "antd/es/upload";
import { IPlan } from "../../components/types/plan";
import { Run } from "../../components/types/datamodel";
import { IStatus } from "../../components/types/app";
import ChatInput from "./chat/chatinput";
import type { ServerUploadedFileInfo } from "./chat/hooks/useFileUpload";
import SampleTasks from "./sampletasks";

interface WelcomeScreenProps {
    currentRun: Run | null;
    sessionId: number;
    error: IStatus | null;
    isPlanMessage: boolean | undefined;
    chatInputRef: React.RefObject<{
        focus: () => void;
        setValue: (value: string) => void;
    }>;
    onSubmit: (
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
        accepted: boolean,
        plan?: IPlan,
        llm?: { label: string; value: string }
    ) => void;
    onCancel: () => void;
    onPause: () => void;
    onExecutePlan: (plan: IPlan) => void;
    serverFilesPrefill?: ServerUploadedFileInfo[] | null;
}

export default function WelcomeScreen({
    currentRun,
    sessionId,
    error,
    isPlanMessage,
    chatInputRef,
    onSubmit,
    onCancel,
    onPause,
    onExecutePlan,
    serverFilesPrefill,
}: WelcomeScreenProps) {
    const [hasInputValue, setHasInputValue] = React.useState(false);

    return (
        <div
            className="text-center w-full mx-auto px-2 sm:px-3 md:px-4"
        >
            <div className="animate-fade-in text-center mb-10">
                <div className="space-y-3">
                    <h1 className="leading-tight">
                        <span
                            className="block text-5xl font-extrabold bg-gradient-to-br from-violet-500 via-purple-500 to-blue-500 bg-clip-text text-transparent"
                            style={{ letterSpacing: "-0.02em" }}
                        >
                            Dr.Sai
                        </span>
                    </h1>
                    <p
                        className="text-base text-secondary animate-slide-up max-w-sm mx-auto leading-relaxed"
                        style={{ animationDelay: "0.15s" }}
                    >
                        输入消息开始对话，或从下方选择示例任务
                    </p>
                </div>
            </div>

            <div className="w-full space-y-6">
                <ChatInput
                    ref={chatInputRef}
                    onSubmit={(
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
                        accepted = false,
                        plan?: IPlan,
                        llm?: { label: string; value: string }
                    ) => {
                        onSubmit(query, files, accepted, plan, llm);
                    }}
                    error={error}
                    onCancel={onCancel}
                    runStatus={currentRun?.status}
                    inputRequest={currentRun?.input_request}
                    isPlanMessage={isPlanMessage}
                    onPause={onPause}
                    enable_upload={true}
                    onExecutePlan={onExecutePlan}
                    sessionId={sessionId}
                    onTextChange={(text) => {
                        setHasInputValue(text.trim().length > 0);
                    }}
                    serverFilesPrefill={serverFilesPrefill}
                />
            </div>

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
    );
}

