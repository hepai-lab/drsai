import { memo, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleEllipsis,
  FileDiff,
  FileText,
  Globe2,
  Image,
  Info,
  ListChecks,
  Reply,
  Table2,
  TriangleAlert,
} from "lucide-react";
import type {
  ArtifactPart,
  CitationPart,
  InteractionPart,
  NoticePart,
  StructuredAssistantPart,
  StructuredTurnState,
} from "@shared/structuredConversation";
import { ChatMessageContent } from "./ChatMessageContent";

interface StructuredMessagePartsProps {
  turn: StructuredTurnState;
  language: "en" | "zh";
  respondedRequestIds: ReadonlySet<string>;
  onOpenLink: (href: string | undefined) => void;
  onOpenArtifact: (part: ArtifactPart) => void;
  onOpenCitation: (part: CitationPart) => void;
  onRespondInteraction: (part: InteractionPart, response: { approved: boolean }) => void;
  onRequestTextInteraction: (part: InteractionPart) => void;
}

export function getStructuredVisibleText(turn: StructuredTurnState): string {
  return turn.parts
    .filter((part): part is Extract<StructuredAssistantPart, { kind: "markdown" }> => part.kind === "markdown")
    .map((part) => part.markdown)
    .join("\n\n")
    .trim();
}

export const StructuredMessageParts = memo(function StructuredMessageParts({
  turn,
  language,
  respondedRequestIds,
  onOpenLink,
  onOpenArtifact,
  onOpenCitation,
  onRespondInteraction,
  onRequestTextInteraction,
}: StructuredMessagePartsProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const relationTimerRef = useRef<number | null>(null);
  const [focusedPartId, setFocusedPartId] = useState<string | null>(null);
  const citationParts = turn.parts.filter((part): part is CitationPart => part.kind === "citation");
  const visibleParts = turn.parts.filter((part) => {
    if (part.kind === "notice" && part.level === "error" && part.id.endsWith(":notice:turn-error")) {
      return false;
    }
    if (part.kind === "progress") {
      return part.status === "running" || part.status === "pending" || part.status === "error";
    }
    if (part.kind === "interaction") {
      return part.status === "running" || part.status === "pending";
    }
    return true;
  });

  useEffect(() => () => {
    if (relationTimerRef.current !== null) window.clearTimeout(relationTimerRef.current);
  }, []);

  function focusPart(partId: string): void {
    setFocusedPartId(partId);
    window.requestAnimationFrame(() => {
      const selector = `[data-structured-part-id="${CSS.escape(partId)}"]`;
      containerRef.current?.querySelector<HTMLElement>(selector)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    if (relationTimerRef.current !== null) window.clearTimeout(relationTimerRef.current);
    relationTimerRef.current = window.setTimeout(() => setFocusedPartId(null), 1800);
  }

  return (
    <div ref={containerRef} className="structured-message-parts" data-turn-id={turn.turnId} data-turn-status={turn.status}>
      {visibleParts.map((part) => {
        if (part.kind === "markdown") {
          return part.markdown ? (
            <div key={part.id} className={`structured-markdown-part ${focusedPartId === part.id ? "relation-focus" : ""}`} data-structured-part-id={part.id}>
              <ChatMessageContent
                content={part.markdown}
                streaming={part.status === "running"}
                language={language}
                onOpenLink={onOpenLink}
              />
              {part.citationIds?.length ? (
                <div className="structured-inline-citations" aria-label={language === "zh" ? "本段引用" : "Citations for this section"}>
                  {part.citationIds.map((citationId) => {
                    const citation = citationParts.find((candidate) => candidate.citationId === citationId);
                    if (!citation) return null;
                    const index = citationParts.findIndex((candidate) => candidate.id === citation.id);
                    return (
                      <button type="button" key={citationId} onClick={() => focusPart(citation.id)} title={citation.title} aria-label={`${language === "zh" ? "定位引用" : "Go to citation"} ${index + 1}: ${citation.title}`}>
                        [{index + 1}]
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null;
        }
        if (part.kind === "reasoning") {
          return <StructuredReasoning key={part.id} part={part} language={language} onOpenLink={onOpenLink} />;
        }
        if (part.kind === "progress") {
          return (
            <div className={`structured-progress ${part.status}`} key={part.id} role="status">
              <CircleEllipsis size={14} aria-hidden="true" />
              <span>{part.summary}</span>
              {part.total !== undefined && part.completed !== undefined ? <small>{part.completed}/{part.total}</small> : null}
            </div>
          );
        }
        if (part.kind === "artifact") {
          return <ArtifactItem key={part.id} part={part} language={language} focused={focusedPartId === part.id} onOpen={() => onOpenArtifact(part)} />;
        }
        if (part.kind === "citation") {
          return (
            <CitationItem
              key={part.id}
              part={part}
              index={citationParts.findIndex((candidate) => candidate.id === part.id) + 1}
              language={language}
              focused={focusedPartId === part.id}
              onOpen={() => onOpenCitation(part)}
              onBack={part.markdownPartId ? () => focusPart(part.markdownPartId as string) : undefined}
            />
          );
        }
        if (part.kind === "interaction") {
          return (
            <InteractionItem
              key={part.id}
              part={part}
              language={language}
              responded={respondedRequestIds.has(part.requestId)}
              onRespond={onRespondInteraction}
              onRequestText={onRequestTextInteraction}
            />
          );
        }
        if (part.kind === "subtask") {
          return (
            <div className={`structured-subtask ${part.status}`} key={part.id}>
              <ListChecks size={14} aria-hidden="true" />
              <span><strong>{part.title}</strong>{part.summary ? ` · ${part.summary}` : ""}</span>
            </div>
          );
        }
        return <NoticeItem key={part.id} part={part} />;
      })}
    </div>
  );
});

function StructuredReasoning({
  part,
  language,
  onOpenLink,
}: {
  part: Extract<StructuredAssistantPart, { kind: "reasoning" }>;
  language: "en" | "zh";
  onOpenLink: (href: string | undefined) => void;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const content = part.segments.map((segment) => segment.text).filter(Boolean).join("\n\n");
  if (!content && !part.summary) return null;
  const running = part.status === "running" || part.status === "pending";
  const title = running
    ? language === "zh" ? "正在思考" : "Thinking"
    : language === "zh" ? "思考过程" : "Reasoning";
  return (
    <details className="chat-reasoning structured-reasoning" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{title}</span>
        {part.segments.length > 1 ? <small>{part.segments.length}</small> : null}
      </summary>
      <div className="chat-reasoning-content">
        {part.summary ? <p className="structured-reasoning-summary">{part.summary}</p> : null}
        {content ? <ChatMessageContent content={content} streaming={running} language={language} onOpenLink={onOpenLink} /> : null}
      </div>
    </details>
  );
}

function ArtifactItem({
  part,
  language,
  focused,
  onOpen,
}: {
  part: ArtifactPart;
  language: "en" | "zh";
  focused: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const Icon = part.artifactType === "image"
    ? Image
    : part.artifactType === "table"
      ? Table2
      : part.artifactType === "patch"
        ? FileDiff
        : part.artifactType === "web"
          ? Globe2
          : FileText;
  return (
    <button
      type="button"
      className={`structured-artifact ${focused ? "relation-focus" : ""}`}
      data-structured-part-id={part.id}
      data-artifact-id={part.artifactId}
      data-status={part.status}
      onClick={onOpen}
      title={part.path || part.url || part.name}
    >
      <Icon size={16} aria-hidden="true" />
      <span><strong>{part.name}</strong>{part.summary ? <small>{part.summary}</small> : null}</span>
      <em>{formatPartStatus(part.status, language)}</em>
      <ArrowUpRight size={14} aria-hidden="true" />
    </button>
  );
}

function CitationItem({
  part,
  index,
  language,
  focused,
  onOpen,
  onBack,
}: {
  part: CitationPart;
  index: number;
  language: "en" | "zh";
  focused: boolean;
  onOpen: () => void;
  onBack?: () => void;
}): React.JSX.Element {
  return (
    <div className={`structured-citation ${focused ? "relation-focus" : ""}`} data-structured-part-id={part.id} data-citation-id={part.citationId}>
      <button type="button" className="structured-citation-open" onClick={onOpen} title={part.url || part.path || part.title}>
        <span className="structured-citation-index">[{index}]</span>
        <Globe2 size={13} aria-hidden="true" />
        <span>{part.title}</span>
        {part.locator ? <small>{part.locator}</small> : null}
        <ArrowUpRight size={12} aria-hidden="true" />
      </button>
      {onBack ? (
        <button type="button" className="structured-citation-back" onClick={onBack} title={language === "zh" ? "返回引用位置" : "Back to citation marker"} aria-label={language === "zh" ? `返回引用 ${index} 的正文位置` : `Back to citation ${index} in the answer`}>
          <Reply size={13} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function formatPartStatus(status: ArtifactPart["status"], language: "en" | "zh"): string {
  const labels = {
    pending: ["等待", "Pending"],
    running: ["生成中", "Creating"],
    completed: ["可用", "Ready"],
    error: ["失败", "Failed"],
    cancelled: ["已取消", "Cancelled"],
  } as const;
  return labels[status][language === "zh" ? 0 : 1];
}

function InteractionItem({
  part,
  language,
  responded,
  onRespond,
  onRequestText,
}: {
  part: InteractionPart;
  language: "en" | "zh";
  responded: boolean;
  onRespond: (part: InteractionPart, response: { approved: boolean }) => void;
  onRequestText: (part: InteractionPart) => void;
}): React.JSX.Element {
  const zh = language === "zh";
  return (
    <section className="chat-agent-input-request structured-interaction" aria-label={zh ? "智能体请求输入" : "Agent input request"}>
      <strong>{zh ? "智能体需要你的输入" : "Agent needs your input"}</strong>
      <p>{part.prompt}</p>
      <div>
        {part.interactionType === "approval" || part.interactionType === "confirmation" ? (
          <>
            <button type="button" disabled={responded} onClick={() => onRespond(part, { approved: false })}>{zh ? "拒绝" : "Reject"}</button>
            <button type="button" disabled={responded} onClick={() => onRespond(part, { approved: true })}>{zh ? "批准" : "Approve"}</button>
          </>
        ) : (
          <button type="button" disabled={responded} onClick={() => onRequestText(part)}>{zh ? "回复" : "Respond"}</button>
        )}
        {responded ? <span>{zh ? "已发送" : "Sent"}</span> : null}
      </div>
    </section>
  );
}

function NoticeItem({ part }: { part: NoticePart }): React.JSX.Element {
  const Icon = part.level === "error"
    ? AlertCircle
    : part.level === "warning"
      ? TriangleAlert
      : part.level === "success"
        ? CheckCircle2
        : Info;
  return (
    <div className={`structured-notice ${part.level}`} role={part.level === "error" ? "alert" : "status"}>
      <Icon size={14} aria-hidden="true" />
      <span>{part.message}</span>
    </div>
  );
}
