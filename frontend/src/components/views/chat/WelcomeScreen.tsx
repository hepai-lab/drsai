import * as React from "react";
import { RcFile } from "antd/es/upload";
import { IPlan } from "../../types/plan";
import { Run } from "../../types/datamodel";
import { IStatus } from "../../types/app";
import ChatInput from "./chat/chatinput";
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
        files: RcFile[],
        accepted: boolean,
        plan?: IPlan,
        uploadedFileData?: Record<string, any>
    ) => void;
    onCancel: () => void;
    onPause: () => void;
    onExecutePlan: (plan: IPlan) => void;
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
}: WelcomeScreenProps) {
    return (
        <div
            className="text-center w-full mx-auto px-2 sm:px-3 md:px-4"
        >
            <div className="animate-fade-in text-center mb-8">
                {/* Welcome Message */}
                <div className="space-y-4">
                    <h1 className="text-5xl font-bold">
                        <span className="text-6xl bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent font-extrabold">
                            Welcome to Dr.Sai
                        </span>
                    </h1>
                    <p
                        className="text-xl text-secondary animate-slide-up"
                        style={{ animationDelay: "0.2s" }}
                    >
                        Enter a message to get started or try a sample task below
                    </p>
                </div>
            </div>

            <div className="w-full space-y-6">
                <ChatInput
                    ref={chatInputRef}
                    onSubmit={(
                        query: string,
                        files: RcFile[],
                        accepted = false,
                        plan?: IPlan,
                        uploadedFileData?: Record<string, any>
                    ) => {
                        onSubmit(query, files, accepted, plan, uploadedFileData);
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
                />
            </div>

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
    );
}

