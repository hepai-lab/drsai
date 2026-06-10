import { useAgentInfo } from "@/components/features/Agents/useAgentInfo";
import { appContext } from "@/hooks/provider";
import { useLang } from "../../i18n/useLang";
import { parseAgentText } from "@/utils/agentLocalizedText";
import { FileText } from "lucide-react";
import { RcFile } from "antd/es/upload";
import * as React from "react";
import { Agent } from "../../types/common";
import { IPlan } from "../../components/types/plan";
import ChatInput from "./chat/chatinput";
import type { ServerUploadedFileInfo } from "./chat/hooks/useFileUpload";
import SampleTasks from "./sampletasks";

const LOGO_BOX_BASE =
    "mb-4 flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl";

/** 有图：中性底 + contain，避免贴纸 logo 被裁切 */
const LOGO_IMAGE_BOX_CLASS = `${LOGO_BOX_BASE} bg-light ring-1 ring-inset ring-border-primary/55 dark:bg-tertiary/50 dark:ring-border-primary/40`;

function isMeaningfulAgentLogo(src?: string | null): boolean {
    if (!src?.trim()) return false;
    const url = src.trim();
    if (/\/api\/placeholder\//i.test(url)) return false;
    if (/^data:image\/svg\+xml/i.test(url)) return false;
    return true;
}

function resolveLogoUrl(src: string): string {
    const url = src.trim();
    if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
    if (url.startsWith("/")) {
        return `${window.location.origin}${url}`;
    }
    return url;
}

function AgentHeaderLogo({ src }: { src?: string | null }) {
    const [loadFailed, setLoadFailed] = React.useState(false);
    const canShowImage = isMeaningfulAgentLogo(src) && !loadFailed;

    React.useEffect(() => {
        setLoadFailed(false);
    }, [src]);

    if (!canShowImage || !src) {
        return null;
    }

    return (
        <div className={LOGO_IMAGE_BOX_CLASS}>
            <img
                src={resolveLogoUrl(src)}
                alt=""
                className="h-10 w-10 object-contain p-0.5"
                onError={() => setLoadFailed(true)}
            />
        </div>
    );
}

interface NewChatViewProps {
    agent: Agent;
    /** Lifted from manager — survives transition to WelcomeScreen after session create */
    suppressSampleTasks?: boolean;
    onDismissSampleTasks?: () => void;
    serverFilesPrefill?: ServerUploadedFileInfo[] | null;
    onSubmit: (agent: Agent, query: string, files: RcFile[] | Array<{
        name: string;
        type: string;
        path: string;
        suffix: string;
        size: number;
        uuid: string;
        url?: string;
    }>, plan?: IPlan, llm?: { label: string; value: string }) => Promise<void>;
}

/**
 * 新对话视图 - 当用户选中智能体但还没有创建会话时显示
 */
export default function NewChatView({
    agent,
    onSubmit,
    serverFilesPrefill,
    suppressSampleTasks = false,
    onDismissSampleTasks,
}: NewChatViewProps) {
    const chatInputRef = React.useRef<{
        focus: () => void;
        setValue: (value: string) => void;
    }>(null);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [hasInputValue, setHasInputValue] = React.useState(false);
    const [hideSampleTasks, setHideSampleTasks] = React.useState(false);

    React.useEffect(() => {
        if (hasInputValue) {
            setHideSampleTasks(true);
        }
    }, [hasInputValue]);
    const { user } = React.useContext(appContext);
    const { t, lang } = useLang();
    const { agentInfo } = useAgentInfo(user?.email);
    const displayName = agentInfo?.name ?? agent?.name ?? "Dr.Sai";
    const rawDescription = agentInfo?.description ?? agent?.description;
    const description = React.useMemo(
        () => parseAgentText(rawDescription, lang),
        [rawDescription, lang]
    );
    const logoSrc = agentInfo?.logo ?? agent?.logo;

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
        plan?: IPlan,
        llm?: { label: string; value: string }
    ) => {
        if (isSubmitting || (!query.trim() && (Array.isArray(files) ? files.length === 0 : false))) return;

        let finalQuery = query;
        if (!query.trim() && Array.isArray(files) && files.length > 0) {
            finalQuery = "请帮我分析这些文件。";
        }

        onDismissSampleTasks?.();
        setHideSampleTasks(true);
        setIsSubmitting(true);
        try {
            await onSubmit((agentInfo ?? agent) as Agent, finalQuery, files, plan, llm);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="relative flex h-full flex-col overflow-hidden">
            <div
                className="pointer-events-none absolute inset-0 overflow-hidden"
                aria-hidden
            >
                <div className="absolute left-1/2 top-[8%] h-48 w-[min(480px,85vw)] -translate-x-1/2 rounded-full bg-accent/[0.08] blur-3xl dark:bg-accent/[0.12]" />
            </div>

            <div className="hide-scrollbar relative flex flex-1 items-start justify-center overflow-y-auto pt-10 sm:pt-14 md:pt-[9vh]">
                <div className="w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
                    <header className="animate-fade-in mb-8 flex flex-col items-center text-center">
                        {/* <p className="font-agent-mono mb-3 text-[10px] font-medium uppercase tracking-[0.22em] text-accent">
                            {t("newChatView.title")}
                        </p> */}
                        <AgentHeaderLogo src={logoSrc} />
                        <h1
                            id="new-chat-agent-title"
                            className="font-agent max-w-xl text-[1.75rem] font-bold leading-[1.15] tracking-[-0.03em] text-primary sm:text-4xl md:text-[2.5rem] break-words"
                        >
                            {displayName}
                        </h1>
                        {description ? (
                            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-secondary sm:text-base">
                                {description}
                            </p>
                        ) : (
                            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-secondary/80 sm:text-base">
                                {t("newChatView.placeholder")}
                            </p>
                        )}
                    </header>

                    {serverFilesPrefill && serverFilesPrefill.length > 0 && (
                        <div className="mb-5 text-left">
                            <div className="rounded-2xl border border-border-primary/45 bg-tertiary/20 px-4 py-3 text-sm text-primary shadow-sm dark:bg-tertiary/30">
                                <div className="mb-2 flex items-center gap-2 font-medium">
                                    <FileText className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                                    <span>{t("newChatView.filesSelected", serverFilesPrefill.length)}</span>
                                </div>
                                <ul className="space-y-1 text-xs text-secondary sm:text-sm">
                                    {serverFilesPrefill.map((f) => (
                                        <li key={f.uuid} className="truncate font-agent-mono" title={f.name}>
                                            {f.name}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    )}

                    <div className="relative">
                        <div
                            className="pointer-events-none absolute -inset-x-2 -top-3 h-px bg-gradient-to-r from-transparent via-accent/35 to-transparent"
                            aria-hidden
                        />
                        <ChatInput
                            ref={chatInputRef}
                            composerLabelledBy="new-chat-agent-title"
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
                            onClear={() => {
                                if (!suppressSampleTasks) {
                                    setHideSampleTasks(false);
                                }
                            }}
                            serverFilesPrefill={serverFilesPrefill}
                        />
                    </div>

                    <SampleTasks
                        hidden={
                            suppressSampleTasks ||
                            hideSampleTasks ||
                            hasInputValue ||
                            isSubmitting
                        }
                        onSelect={(task: string) => {
                            setHideSampleTasks(true);
                            chatInputRef.current?.setValue(task);
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
