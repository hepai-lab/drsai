import * as React from "react";
import { useLang } from "../../i18n/useLang";
import { RcFile } from "antd/es/upload";
import { IPlan } from "../../components/types/plan";
import { Run } from "../../components/types/datamodel";
import { IStatus } from "../../components/types/app";
import ChatInput from "./chat/chatinput";
import type { ServerUploadedFileInfo } from "./chat/hooks/useFileUpload";
import type { HepaiSkillPickRow } from "./chat/types";
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
        llm?: { label: string; value: string },
        attachedSkills?: HepaiSkillPickRow[]
    ) => void;
    onCancel: () => void;
    onPause: () => void;
    onExecutePlan: (plan: IPlan) => void;
    serverFilesPrefill?: ServerUploadedFileInfo[] | null;
    /** From manager — keep examples hidden after NewChatView → session transition */
    suppressSampleTasks?: boolean;
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
    suppressSampleTasks = false,
}: WelcomeScreenProps) {
    const { t } = useLang();
    const [hasInputValue, setHasInputValue] = React.useState(false);
    const [hideSampleTasks, setHideSampleTasks] = React.useState(suppressSampleTasks);

    React.useEffect(() => {
        if (hasInputValue || suppressSampleTasks) {
            setHideSampleTasks(true);
        }
    }, [hasInputValue, suppressSampleTasks]);

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
                        {t("welcomeScreen.title")}
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
                        llm?: { label: string; value: string },
                        attachedSkills?: HepaiSkillPickRow[]
                    ) => {
                        setHideSampleTasks(true);
                        onSubmit(query, files, accepted, plan, llm, attachedSkills);
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
                    onClear={() => {
                        if (!suppressSampleTasks) {
                            setHideSampleTasks(false);
                        }
                    }}
                    serverFilesPrefill={serverFilesPrefill}
                />
            </div>

            <SampleTasks
                hidden={suppressSampleTasks || hideSampleTasks || hasInputValue}
                onSelect={(task: string) => {
                    setHideSampleTasks(true);
                    chatInputRef.current?.setValue(task);
                }}
            />
        </div>
    );
}

