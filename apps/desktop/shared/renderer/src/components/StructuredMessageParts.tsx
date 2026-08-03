import { memo, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
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
  StructuredActivityEvent,
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
  onRespondInteraction: (part: InteractionPart, response: { approved?: boolean; decision?: "accept" | "acceptForSession" | "decline" }) => void;
  onRequestTextInteraction: (part: InteractionPart) => void;
  onOpenDebug?: () => void;
  now: number;
  startedAt?: number;
  completedAt?: number;
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
  onOpenDebug,
  now,
  startedAt,
  completedAt,
}: StructuredMessagePartsProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const relationTimerRef = useRef<number | null>(null);
  const [focusedPartId, setFocusedPartId] = useState<string | null>(null);
  const [processOpen, setProcessOpen] = useState(turn.status === "running" || turn.status === "error");
  const citationParts = turn.parts.filter((part): part is CitationPart => part.kind === "citation");
  const processParts = turn.parts.filter((part) => part.kind === "progress" || part.kind === "reasoning" || part.kind === "subtask");
  const interactionParts = turn.parts.filter((part): part is InteractionPart => part.kind === "interaction" && (part.status === "running" || part.status === "pending"));
  const resultParts = turn.parts.filter((part) => part.kind === "markdown" || part.kind === "artifact" || part.kind === "citation");
  const noticeParts = turn.parts.filter((part): part is NoticePart => part.kind === "notice");
  const hasProcess = processParts.length > 0 || turn.activities.length > 0 || noticeParts.length > 0;
  const waitingApproval = turn.parts.some((part) => part.kind === "interaction" && part.interactionType === "approval" && (part.status === "pending" || part.status === "running"));
  const turnStatusLabel = waitingApproval
    ? (language === "zh" ? "等待审批" : "Waiting for approval")
    : turn.status === "pending" ? (language === "zh" ? "排队中" : "Queued")
    : turn.status === "running" && !hasProcess ? (language === "zh" ? "已发送" : "Sent")
    : turn.status === "running" ? (language === "zh" ? "生成中" : "Generating")
    : turn.status === "completed" ? (language === "zh" ? "已完成" : "Completed")
    : turn.status === "error" ? (language === "zh" ? "失败" : "Failed")
    : (language === "zh" ? "已停止" : "Stopped");
  const inferredEnd = turn.status === "running" ? now : completedAt;
  const inferredDuration = startedAt !== undefined && inferredEnd !== undefined && inferredEnd > startedAt
    ? inferredEnd - startedAt
    : undefined;
  const durationMs = turn.meta?.durationMs !== undefined && turn.meta.durationMs > 0
    ? turn.meta.durationMs
    : inferredDuration;
  const durationLabel = durationMs === undefined ? "" : formatRunDuration(durationMs, language);
  const backendLabel = formatBackendLabel(turn.meta?.backend);
  const statusMeta = ["OpenDrSai", backendLabel, turn.meta?.workspaceLabel].filter(Boolean).join(" · ");

  useEffect(() => () => {
    if (relationTimerRef.current !== null) window.clearTimeout(relationTimerRef.current);
  }, []);

  useEffect(() => {
    if (turn.status === "running" || turn.status === "error") setProcessOpen(true);
    else if (turn.status === "completed") setProcessOpen(false);
  }, [turn.status]);

  function focusPart(partId: string): void {
    setFocusedPartId(partId);
    window.requestAnimationFrame(() => {
      const selector = `[data-structured-part-id="${CSS.escape(partId)}"]`;
      containerRef.current?.querySelector<HTMLElement>(selector)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    if (relationTimerRef.current !== null) window.clearTimeout(relationTimerRef.current);
    relationTimerRef.current = window.setTimeout(() => setFocusedPartId(null), 1800);
  }

  function renderPart(part: StructuredAssistantPart): React.JSX.Element | null {
    if (part.kind === "markdown") {
      return part.markdown ? (
        <div key={part.id} className={`structured-markdown-part ${focusedPartId === part.id ? "relation-focus" : ""}`} data-structured-part-id={part.id}>
          <ChatMessageContent content={part.markdown} streaming={part.status === "running"} language={language} onOpenLink={onOpenLink} />
          {part.citationIds?.length ? <div className="structured-inline-citations" aria-label={language === "zh" ? "本段引用" : "Citations for this section"}>
            {part.citationIds.map((citationId) => {
              const citation = citationParts.find((candidate) => candidate.citationId === citationId);
              if (!citation) return null;
              const index = citationParts.findIndex((candidate) => candidate.id === citation.id);
              return <button type="button" key={citationId} onClick={() => focusPart(citation.id)} title={citation.title} aria-label={`${language === "zh" ? "定位引用" : "Go to citation"} ${index + 1}: ${citation.title}`}>[{index + 1}]</button>;
            })}
          </div> : null}
        </div>
      ) : null;
    }
    if (part.kind === "reasoning") return <StructuredReasoning key={part.id} part={part} language={language} onOpenLink={onOpenLink} />;
    if (part.kind === "progress") return <div className={`structured-progress ${part.status}`} key={part.id} role="status">
      {part.status === "completed" ? <CheckCircle2 size={14} aria-hidden="true" /> : <CircleEllipsis size={14} aria-hidden="true" />}
      <ChatMessageContent content={part.summary} streaming={part.status === "running"} language={language} onOpenLink={onOpenLink} />
      {part.total !== undefined && part.completed !== undefined ? <small>{part.completed}/{part.total}</small> : null}
    </div>;
    if (part.kind === "artifact") return <ArtifactItem key={part.id} part={part} language={language} focused={focusedPartId === part.id} onOpen={() => onOpenArtifact(part)} />;
    if (part.kind === "citation") return <CitationItem key={part.id} part={part} index={citationParts.findIndex((candidate) => candidate.id === part.id) + 1} language={language} focused={focusedPartId === part.id} onOpen={() => onOpenCitation(part)} onBack={part.markdownPartId ? () => focusPart(part.markdownPartId as string) : undefined} />;
    if (part.kind === "interaction") return <InteractionItem key={part.id} part={part} language={language} responded={respondedRequestIds.has(part.requestId)} onRespond={onRespondInteraction} onRequestText={onRequestTextInteraction} onOpenResult={onOpenDebug} />;
    if (part.kind === "subtask") return <div className={`structured-subtask ${part.status}`} key={part.id}><ListChecks size={14} aria-hidden="true" /><span><strong>{part.title}</strong>{part.summary ? ` · ${part.summary}` : ""}</span></div>;
    return <NoticeItem key={part.id} part={part} />;
  }

  return (
    <div ref={containerRef} className="structured-message-parts" data-turn-id={turn.turnId} data-turn-status={turn.status}>
      {hasProcess ? <details className="structured-process" open={processOpen} onToggle={(event) => setProcessOpen(event.currentTarget.open)}>
        <summary className="structured-run-status" title={statusMeta}>
          <span className="structured-run-context">{statusMeta}</span>
          <span className="structured-run-actions">
            <span className={`structured-turn-status status-${turn.status}`}>{turnStatusLabel}{durationLabel ? ` · ${durationLabel}` : ""}</span>
            <span className="structured-process-label">{language === "zh" ? "处理过程" : "Process"}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </span>
        </summary>
        <div className="structured-process-content">
          <StructuredActivityTimeline turn={turn} language={language} onOpenDebug={onOpenDebug} />
          {processParts.filter((part) => part.kind === "progress").length ? <section className="structured-process-section"><h4>{language === "zh" ? "过程记录" : "Progress"}</h4>{processParts.filter((part) => part.kind === "progress").map(renderPart)}</section> : null}
          {processParts.filter((part) => part.kind === "reasoning").length ? <section className="structured-process-section"><h4>{language === "zh" ? "分析摘要" : "Analysis summary"}</h4>{processParts.filter((part) => part.kind === "reasoning").map(renderPart)}</section> : null}
          {turn.activities.length ? <section className="structured-process-section"><h4>{language === "zh" ? "操作与变更" : "Actions and changes"}</h4><StructuredActivityDetails turn={turn} language={language} onOpenDebug={onOpenDebug} /></section> : null}
          {processParts.filter((part) => part.kind === "subtask").length ? <section className="structured-process-section"><h4>{language === "zh" ? "子任务" : "Subtasks"}</h4>{processParts.filter((part) => part.kind === "subtask").map(renderPart)}</section> : null}
          {noticeParts.length ? <section className="structured-process-section"><h4>{language === "zh" ? "运行信息" : "Run information"}</h4>{noticeParts.map(renderPart)}</section> : null}
          <StructuredActivitySummary turn={turn} language={language} now={now} startedAt={startedAt} onOpenDebug={onOpenDebug} />
        </div>
      </details> : <header className="structured-run-status" title={statusMeta}>
        <span className="structured-run-context">{statusMeta}</span>
        <span className={`structured-turn-status status-${turn.status}`}>{turnStatusLabel}{durationLabel ? ` · ${durationLabel}` : ""}</span>
      </header>}
      {interactionParts.length ? <section className="structured-interaction-layer" aria-label={language === "zh" ? "待用户交互" : "User action required"}>{interactionParts.map(renderPart)}</section> : null}
      {resultParts.length ? <section className="structured-result-layer"><h3>{language === "zh" ? "最终回答" : "Final answer"}</h3>{resultParts.map(renderPart)}</section> : null}
    </div>
  );
});

function formatBackendLabel(backend: string | undefined): string {
  if (!backend) return "";
  if (/codex/i.test(backend)) return "Codex";
  if (/opendrsai|drsai/i.test(backend)) return "OpenDrSai Agent";
  return backend;
}

function summarizeProcess(turn: StructuredTurnState, language: "en" | "zh"): string {
  const files = new Set(turn.activities.filter((activity) => activity.kind === "file_change").map((activity) => activity.kind === "file_change" ? activity.path : "")).size;
  const tools = turn.activities.filter((activity) => activity.kind === "tool").length;
  const tasks = turn.parts.filter((part) => part.kind === "subtask").length;
  const chunks = language === "zh"
    ? [files ? `${files} 个文件` : "", tools ? `${tools} 项操作` : "", tasks ? `${tasks} 个子任务` : ""]
    : [files ? `${files} file${files === 1 ? "" : "s"}` : "", tools ? `${tools} operation${tools === 1 ? "" : "s"}` : "", tasks ? `${tasks} subtask${tasks === 1 ? "" : "s"}` : ""];
  return chunks.filter(Boolean).join(" · ");
}

function StructuredActivityTimeline({
  turn,
  language,
  onOpenDebug,
}: {
  turn: StructuredTurnState;
  language: "en" | "zh";
  onOpenDebug?: () => void;
}): React.JSX.Element | null {
  if (!turn.activities.length) return null;
  const failedActivities = turn.activities.filter((activity) => activity.status === "error");
  const failed = failedActivities.length;
  const active = turn.activities.filter(
    (activity) => activity.status === "pending" || activity.status === "running",
  ).length;
  const changedFiles = new Set(turn.activities
    .filter((activity) => activity.kind === "file_change")
    .map((activity) => activity.kind === "file_change" ? activity.path : ""));
  const toolCount = turn.activities.filter((activity) => activity.kind === "tool").length;
  const aggregateStatus: StructuredActivityEvent["status"] = failed
    ? "error"
    : active
      ? "running"
      : "completed";
  const aggregateLabel = failed
    ? language === "zh"
      ? `工具操作有 ${failed} 项失败`
      : `${failed} tool operation${failed === 1 ? "" : "s"} failed`
    : active
      ? language === "zh"
        ? "正在执行工具操作"
        : "Running tool operations"
      : language === "zh"
        ? changedFiles.size
          ? `已修改 ${changedFiles.size} 个文件${toolCount ? `，执行 ${toolCount} 项工具操作` : ""}`
          : `处理过程已完成${toolCount ? ` · ${toolCount} 项工具操作` : ""}`
        : changedFiles.size
          ? `Changed ${changedFiles.size} file${changedFiles.size === 1 ? "" : "s"}${toolCount ? ` · ${toolCount} tool operation${toolCount === 1 ? "" : "s"}` : ""}`
          : `Work completed${toolCount ? ` · ${toolCount} tool operation${toolCount === 1 ? "" : "s"}` : ""}`;
  const failedTitle = failedActivities[0]?.title?.replace(/\s+response$/i, "").trim();
  const label = failed && failedTitle
    ? language === "zh"
      ? `步骤失败：${failedTitle}`
      : `Step failed: ${failedTitle}`
    : aggregateLabel;
  const content = (
    <>
      <ActivityStatusIcon status={aggregateStatus} />
      <span>{label}</span>
      {onOpenDebug ? <small>{language === "zh" ? "在调试中查看详情" : "View details in Debug"}</small> : null}
    </>
  );
  return (
    <section
      className="structured-activity-timeline"
      aria-label={language === "zh" ? "工具活动摘要" : "Tool activity summary"}
      data-activity-count={turn.activities.length}
      data-activity-status={aggregateStatus}
    >
      {onOpenDebug ? (
        <button type="button" className="structured-activity-compact" onClick={onOpenDebug}>
          {content}
        </button>
      ) : (
        <div className="structured-activity-compact">{content}</div>
      )}
    </section>
  );
}

function ActivityStatusIcon({
  status,
}: {
  status: StructuredActivityEvent["status"];
}): React.JSX.Element {
  if (status === "completed") return <CheckCircle2 size={16} aria-hidden="true" />;
  if (status === "error") return <AlertCircle size={16} aria-hidden="true" />;
  return <CircleEllipsis size={16} aria-hidden="true" />;
}

function StructuredActivityDetails({
  turn,
  language,
  onOpenDebug,
}: {
  turn: StructuredTurnState;
  language: "en" | "zh";
  onOpenDebug?: () => void;
}): React.JSX.Element {
  return <div className="structured-activity-details">
    {turn.activities.map((activity) => <div className={`structured-activity-row ${activity.status}`} key={activity.id}>
      <ActivityStatusIcon status={activity.status} />
      <span>{formatActivitySummary(activity, language)}</span>
      {activity.kind === "file_change" ? <small>{activity.action}</small> : null}
      {activity.kind === "tool" && activity.durationMs !== undefined ? <time>{formatRunDuration(activity.durationMs, language)}</time> : null}
    </div>)}
    {onOpenDebug ? <button type="button" className="structured-debug-link" onClick={onOpenDebug}>{language === "zh" ? "查看技术详情" : "View technical details"}</button> : null}
  </div>;
}

function StructuredActivitySummary({
  turn,
  language,
  now,
  startedAt,
  onOpenDebug,
}: {
  turn: StructuredTurnState;
  language: "en" | "zh";
  now: number;
  startedAt?: number;
  onOpenDebug?: () => void;
}): React.JSX.Element | null {
  if (turn.status !== "pending" && turn.status !== "running") return null;
  const active = [...turn.activities]
    .reverse()
    .find((activity) => activity.status === "pending" || activity.status === "running");
  const label = active
    ? formatActivitySummary(active, language)
    : language === "zh" ? "正在处理" : "Working";
  const elapsed = formatRunDuration(Math.max(0, now - (startedAt ?? now)), language);
  const activityContent = <><span className="structured-activity-dot" aria-hidden="true" /><span>{label}</span></>;

  return (
    <div className="structured-activity-summary" role="status" aria-live="polite">
      {onOpenDebug && active ? (
        <button
          type="button"
          className="structured-activity-detail"
          onClick={onOpenDebug}
          title={language === "zh" ? "在调试面板查看活动详情" : "View activity details in Debug"}
        >
          {activityContent}
        </button>
      ) : <span className="structured-activity-detail">{activityContent}</span>}
      <time>{language === "zh" ? `已执行 ${elapsed}` : `Running ${elapsed}`}</time>
    </div>
  );
}

function formatRunDuration(durationMs: number, language: "en" | "zh"): string {
  if (durationMs < 1000) return language === "zh" ? "少于 1 秒" : "<1s";
  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}${language === "zh" ? " 秒" : "s"}`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatActivitySummary(activity: StructuredActivityEvent, language: "en" | "zh"): string {
  if (activity.kind === "tool") return activity.toolName || (language === "zh" ? "工具" : "Tool");
  if (activity.kind === "model") return language === "zh" ? "正在生成" : "Generating";
  if (activity.kind === "retry") {
    return language === "zh"
      ? `正在重试 ${activity.attempt}/${activity.limit}`
      : `Retrying ${activity.attempt}/${activity.limit}`;
  }
  if (activity.kind === "file_change") {
    const name = activity.path.split(/[\\/]/).filter(Boolean).pop() || activity.path;
    return language === "zh" ? `正在处理 ${name}` : `Working on ${name}`;
  }
  if (activity.kind === "subtask") return activity.agentName || activity.title;
  return activity.title || (language === "zh" ? "正在处理" : "Working");
}

function StructuredReasoning({
  part,
  language,
  onOpenLink,
}: {
  part: Extract<StructuredAssistantPart, { kind: "reasoning" }>;
  language: "en" | "zh";
  onOpenLink: (href: string | undefined) => void;
}): React.JSX.Element | null {
  const content = part.segments.map((segment) => segment.text).filter(Boolean).join("\n\n");
  if (!content && !part.summary) return null;
  const running = part.status === "running" || part.status === "pending";
  return (
    <div className="structured-reasoning" data-segment-count={part.segments.length}>
      <div className="chat-reasoning-content">
        {part.summary ? <p className="structured-reasoning-summary">{part.summary}</p> : null}
        {content ? <ChatMessageContent content={content} streaming={running} language={language} onOpenLink={onOpenLink} /> : null}
      </div>
    </div>
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
  onOpenResult,
}: {
  part: InteractionPart;
  language: "en" | "zh";
  responded: boolean;
  onRespond: (part: InteractionPart, response: { approved?: boolean; decision?: "accept" | "acceptForSession" | "decline" }) => void;
  onRequestText: (part: InteractionPart) => void;
  onOpenResult?: () => void;
}): React.JSX.Element {
  const zh = language === "zh";
  return (
    <section className="chat-agent-input-request structured-interaction" aria-label={zh ? "智能体请求输入" : "Agent input request"}>
      <strong>{zh ? "智能体需要你的输入" : "Agent needs your input"}</strong>
      <p>{part.prompt}</p>
      <div>
        {part.interactionType === "approval" || part.interactionType === "confirmation" ? (
          <>
            <button type="button" disabled={responded} onClick={() => onRespond(part, { decision: "decline" })}>{zh ? "拒绝" : "Reject"}</button>
            <button type="button" disabled={responded} title={zh ? "只允许这一次操作" : "Allow only this operation"} onClick={() => onRespond(part, { decision: "accept" })}>{zh ? "仅允许一次" : "Allow once"}</button>
            <button type="button" disabled={responded} title={zh ? "在当前会话内允许同类操作；关闭会话后失效" : "Allow equivalent operations in this session; expires when the session ends"} onClick={() => onRespond(part, { decision: "acceptForSession" })}>{zh ? "本会话允许" : "Allow for session"}</button>
          </>
        ) : (
          <button type="button" disabled={responded} onClick={() => onRequestText(part)}>{zh ? "回复" : "Respond"}</button>
        )}
        {responded ? <span>{zh ? "已发送" : "Sent"}{onOpenResult ? <button type="button" onClick={onOpenResult}>{zh ? "查看操作/审计结果" : "View operation/audit result"}</button> : null}</span> : null}
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
