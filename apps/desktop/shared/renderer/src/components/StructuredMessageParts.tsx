import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CircleEllipsis,
  FileDiff,
  FileText,
  FlaskConical,
  Globe2,
  Image,
  Info,
  ListChecks,
  Reply,
  Table2,
  TriangleAlert,
} from "lucide-react";
import { userFacingBusinessText } from "../userFacingLanguage";
import { formatWebSearchActivitySummary } from "../webSearchPresentation";
import { boundedProcessWindow, PROCESS_ACTIVITY_WINDOW_SIZE, PROCESS_PART_WINDOW_SIZE } from "../boundedProcessWindow";
import type {
  ArtifactPart,
  CitationPart,
  InteractionPart,
  NoticePart,
  StructuredActivityEvent,
  StructuredAssistantPart,
  StructuredTurnState,
} from "@shared/structuredConversation";
import type { RunReproducibilityLevel } from "@shared/runInspection";
import { ChatMessageContent } from "./ChatMessageContent";
import { desktopApi } from "../desktopApi";

export interface InteractionResponse extends Record<string, unknown> {
  approved?: boolean;
  decision?: "accept" | "acceptForSession" | "decline" | "revise";
  goal?: { objective: string; materials: string[]; outputs: string[]; constraints: string[] };
  capabilityAction?: "configured" | "answer_without_network";
}

interface StructuredMessagePartsProps {
  turn: StructuredTurnState;
  runId?: string;
  language: "en" | "zh";
  respondedRequestIds: ReadonlySet<string>;
  configuredCapabilityRequestIds: ReadonlySet<string>;
  onOpenLink: (href: string | undefined) => void;
  onOpenArtifact: (part: ArtifactPart) => void;
  onOpenCitation: (part: CitationPart) => void;
  onRespondInteraction: (part: InteractionPart, response: InteractionResponse) => void;
  onRequestTextInteraction: (part: InteractionPart) => void;
  onOpenDebug?: () => void;
  onOpenRun?: (runId: string, itemId?: string) => void;
  onCreateRunExperiment?: (runId: string, itemId?: string) => void;
  reproducibilityLevel?: RunReproducibilityLevel;
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
  runId,
  language,
  respondedRequestIds,
  configuredCapabilityRequestIds,
  onOpenLink,
  onOpenArtifact,
  onOpenCitation,
  onRespondInteraction,
  onRequestTextInteraction,
  onOpenDebug,
  onOpenRun,
  onCreateRunExperiment,
  reproducibilityLevel,
  now,
  startedAt,
  completedAt,
}: StructuredMessagePartsProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const relationTimerRef = useRef<number | null>(null);
  const [focusedPartId, setFocusedPartId] = useState<string | null>(null);
  const [processOpen, setProcessOpen] = useState(turn.status === "running" || turn.status === "error");
  const citationParts = turn.parts.filter((part): part is CitationPart => part.kind === "citation");
  const progressParts = turn.parts.filter((part) => part.kind === "progress");
  const reasoningParts = turn.parts.filter((part) => part.kind === "reasoning");
  const subtaskParts = turn.parts.filter((part) => part.kind === "subtask");
  const interactionParts = turn.parts.filter((part): part is InteractionPart =>
    part.kind === "interaction"
    && (part.status === "running" || part.status === "pending")
    && (turn.status === "running" || !respondedRequestIds.has(part.requestId))
  );
  const resultParts = turn.parts.filter((part) => part.kind === "markdown" || part.kind === "artifact" || part.kind === "citation");
  const noticeParts = turn.parts.filter((part): part is NoticePart => part.kind === "notice");
  const publicSources = useMemo(() => extractPublicSources(turn), [turn]);
  const hasUserWarning = noticeParts.some((part) => part.level === "warning") || turn.parts.some((part) => part.kind === "markdown" && /could not be fully verified|citation_evidence_incomplete/i.test(part.markdown));
  const hasProcess = progressParts.length > 0 || reasoningParts.length > 0 || subtaskParts.length > 0 || turn.activities.length > 0 || noticeParts.length > 0;
  const waitingApproval = turn.parts.some((part) => part.kind === "interaction" && part.interactionType === "approval" && (part.status === "pending" || part.status === "running"));
  const turnStatusLabel = waitingApproval
    ? (language === "zh" ? "等待审批" : "Waiting for approval")
    : turn.status === "pending" ? (language === "zh" ? "排队中" : "Queued")
    : turn.status === "running" && !hasProcess ? (language === "zh" ? "已发送" : "Sent")
    : turn.status === "running" ? (language === "zh" ? "生成中" : "Generating")
    : turn.status === "completed" && hasUserWarning ? (language === "zh" ? "已完成 · 有警告" : "Completed · Warning")
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
  const commandCount = turn.activities.filter((activity) => activity.kind === "tool" && /command|shell|terminal|exec/i.test(activity.toolName)).length;
  const runCounts = [
    [language === "zh" ? "工具" : "Tools", turn.activities.filter((activity) => activity.kind === "tool").length - commandCount],
    [language === "zh" ? "命令" : "Commands", commandCount],
    [language === "zh" ? "文件" : "Files", turn.activities.filter((activity) => activity.kind === "file_change").length],
    [language === "zh" ? "审批" : "Approvals", turn.parts.filter((part) => part.kind === "interaction" && part.interactionType === "approval").length],
    [language === "zh" ? "子任务" : "Subtasks", turn.activities.filter((activity) => activity.kind === "subtask").length + turn.parts.filter((part) => part.kind === "subtask").length],
    [language === "zh" ? "产物" : "Artifacts", turn.parts.filter((part) => part.kind === "artifact").length],
  ].filter((entry): entry is [string, number] => Number(entry[1]) > 0);

  useEffect(() => () => {
    if (relationTimerRef.current !== null) window.clearTimeout(relationTimerRef.current);
  }, []);

  useEffect(() => {
    if (turn.status === "running" || turn.status === "error") setProcessOpen(true);
    else if (turn.status === "completed") setProcessOpen(hasUserWarning);
  }, [hasUserWarning, turn.status]);

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
      const displayedMarkdown = publicSources.length ? stripTrailingSourceList(part.markdown) : part.markdown;
      return displayedMarkdown ? (
        <div key={part.id} className={`structured-markdown-part ${focusedPartId === part.id ? "relation-focus" : ""}`} data-structured-part-id={part.id}>
          <ChatMessageContent content={displayedMarkdown} streaming={part.status === "running"} language={language} onOpenLink={onOpenLink} />
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
    if (part.kind === "interaction") return <InteractionItem compact key={part.id} part={part} language={language} responded={respondedRequestIds.has(part.requestId)} capabilityConfigured={configuredCapabilityRequestIds.has(part.requestId)} onRespond={onRespondInteraction} onRequestText={onRequestTextInteraction} onOpenResult={onOpenDebug} onOpenLink={onOpenLink} />;
    if (part.kind === "subtask") return <div className={`structured-subtask ${part.status}`} key={part.id}><ListChecks size={14} aria-hidden="true" /><span><strong>{part.title}</strong>{part.summary ? ` · ${part.summary}` : ""}</span></div>;
    return <NoticeItem key={part.id} part={part} language={language} onOpenDebug={onOpenDebug} />;
  }

  return (
    <div ref={containerRef} className="structured-message-parts" data-turn-id={turn.turnId} data-turn-status={turn.status}>
      {hasProcess ? <details className="structured-process" open={processOpen} onToggle={(event) => setProcessOpen(event.currentTarget.open)}>
        <summary className="structured-run-status" title={statusMeta}>
          <span className="structured-run-context">{statusMeta}</span>
          <span className="structured-run-actions">
            <span className={`structured-turn-status status-${turn.status}`}>{turnStatusLabel}{durationLabel ? ` · ${durationLabel}` : ""}</span>
            {runCounts.length ? <span className="structured-run-counts" aria-label={language === "zh" ? "运行步骤计数" : "Run step counts"}>{runCounts.map(([label, count]) => <small key={label}>{label} {count}</small>)}</span> : null}
            {reproducibilityLevel ? <span className={`structured-reproducibility level-${reproducibilityLevel}`}>{reproducibilitySummaryLabel(reproducibilityLevel, language)}</span> : null}
            <span className="structured-process-label">{language === "zh" ? "处理过程" : "Process"}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </span>
        </summary>
        {processOpen ? <div className="structured-process-content" data-testid="structured-process-content">
          {onOpenRun && runId ? <button type="button" className="structured-run-inspect-link" onClick={() => onOpenRun(runId)}>{language === "zh" ? "查看运行" : "View run"}<ArrowUpRight size={13} aria-hidden /></button> : null}
          {onCreateRunExperiment && runId ? <button type="button" className="structured-run-inspect-link" onClick={() => onCreateRunExperiment(runId)}>{language === "zh" ? "创建实验" : "Create experiment"}<FlaskConical size={13} aria-hidden /></button> : null}
          <RetrievalStageSummary turn={turn} language={language} />
          <StructuredActivityTimeline turn={turn} language={language} onOpenDebug={onOpenDebug} />
          <BoundedProcessSection title={language === "zh" ? "过程记录" : "Progress"} items={progressParts} language={language} renderPart={renderPart} />
          <BoundedProcessSection title={language === "zh" ? "分析摘要" : "Analysis summary"} items={reasoningParts} language={language} renderPart={renderPart} />
          {turn.activities.length ? <section className="structured-process-section"><h4>{language === "zh" ? "操作与变更" : "Actions and changes"}</h4><StructuredActivityDetails turn={turn} language={language} onOpenDebug={onOpenDebug} onOpenRun={onOpenRun && runId ? (itemId) => onOpenRun(runId, itemId) : undefined} onCreateExperiment={onCreateRunExperiment && runId ? (itemId) => onCreateRunExperiment(runId, itemId) : undefined} /></section> : null}
          <BoundedProcessSection title={language === "zh" ? "子任务" : "Subtasks"} items={subtaskParts} language={language} renderPart={renderPart} />
          <BoundedProcessSection title={language === "zh" ? "运行信息" : "Run information"} items={noticeParts} language={language} renderPart={renderPart} />
          <StructuredActivitySummary turn={turn} language={language} now={now} startedAt={startedAt} onOpenDebug={onOpenDebug} />
        </div> : null}
      </details> : <header className="structured-run-status" title={statusMeta}>
        <span className="structured-run-context">{statusMeta}</span>
        <span className={`structured-turn-status status-${turn.status}`}>{turnStatusLabel}{durationLabel ? ` · ${durationLabel}` : ""}</span>
        {runCounts.length ? <span className="structured-run-counts" aria-label={language === "zh" ? "运行步骤计数" : "Run step counts"}>{runCounts.map(([label, count]) => <small key={label}>{label} {count}</small>)}</span> : null}
        {reproducibilityLevel ? <span className={`structured-reproducibility level-${reproducibilityLevel}`}>{reproducibilitySummaryLabel(reproducibilityLevel, language)}</span> : null}
        {onOpenRun && runId ? <button type="button" className="structured-run-inspect-link" onClick={() => onOpenRun(runId)}>{language === "zh" ? "查看运行" : "View run"}<ArrowUpRight size={13} aria-hidden /></button> : null}
        {onCreateRunExperiment && runId ? <button type="button" className="structured-run-inspect-link" onClick={() => onCreateRunExperiment(runId)}>{language === "zh" ? "创建实验" : "Create experiment"}<FlaskConical size={13} aria-hidden /></button> : null}
      </header>}
      {interactionParts.length ? <section className="structured-interaction-layer" aria-label={language === "zh" ? "待用户交互" : "User action required"}>{interactionParts.map(renderPart)}</section> : null}
      {resultParts.length ? <section className="structured-result-layer"><h3>{language === "zh" ? "最终回答" : "Final answer"}</h3>{resultParts.map(renderPart)}</section> : null}
      {publicSources.length ? <section className="structured-source-list" aria-label={language === "zh" ? "回答来源" : "Answer sources"}>
        <h3>{language === "zh" ? `来源 · ${publicSources.length}` : `Sources · ${publicSources.length}`}</h3>
        {publicSources.map((source, index) => <button type="button" key={source.url} onClick={() => onOpenLink(source.url)}>
          <span><small>{index + 1}</small><strong>{source.label}</strong></span>
          <em>{language === "zh" ? "已获取" : "Retrieved"}</em><ArrowUpRight size={13} aria-hidden />
        </button>)}
      </section> : null}
    </div>
  );
});

function extractPublicSources(turn: StructuredTurnState): Array<{ url: string; label: string }> {
  const urls: string[] = [];
  for (const part of turn.parts) {
    if (part.kind === "citation" && part.url?.startsWith("https://")) urls.push(part.url);
    if (part.kind !== "markdown") continue;
    urls.push(...(part.markdown.match(/https:\/\/[^\s<>\]\[(){}"']+/g) ?? []).map((url) => url.replace(/[.,;:!?]+$/, "")));
  }
  return [...new Set(urls)].slice(0, 8).map((url) => {
    try { return { url, label: new URL(url).hostname.replace(/^www\./, "") }; }
    catch { return { url, label: url }; }
  });
}

export function stripTrailingSourceList(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!/^\s*(?:sources?|来源)\s*[:：]\s*$/i.test(lines[index])) continue;
    const trailing = lines.slice(index + 1).filter((line) => line.trim());
    if (trailing.length > 0 && trailing.every((line) => /^\s*(?:[-*+]\s*)?(?:\[[^\]]+\]\()?https:\/\//i.test(line))) {
      return lines.slice(0, index).join("\n").trimEnd();
    }
  }
  return markdown;
}

function RetrievalStageSummary({ turn, language }: { turn: StructuredTurnState; language: "en" | "zh" }): React.JSX.Element | null {
  const retrieval = turn.activities.filter((activity): activity is Extract<StructuredActivityEvent, { kind: "tool" }> => activity.kind === "tool" && /web[._](search|fetch)/i.test(activity.toolName));
  if (!retrieval.length) return null;
  const search = retrieval.filter((activity) => /search/i.test(activity.toolName));
  const fetch = retrieval.filter((activity) => /fetch/i.test(activity.toolName));
  const text = turn.parts.filter((part) => part.kind === "markdown").map((part) => part.markdown).join("\n");
  const warning = /could not be fully verified|citation_evidence_incomplete/i.test(text)
    || turn.parts.some((part) => part.kind === "notice" && /citation|source|引用|来源/i.test(part.message) && part.level !== "success");
  const stages = [
    { label: language === "zh" ? "搜索网络" : "Search web", values: search },
    { label: language === "zh" ? "读取网页" : "Read pages", values: fetch },
    { label: language === "zh" ? "整理回答" : "Compose answer", values: [], complete: Boolean(text.trim()) },
    { label: language === "zh" ? "验证来源" : "Verify sources", values: [], complete: turn.status === "completed", warning },
  ];
  return <section className="structured-retrieval-stages" aria-label={language === "zh" ? "网络感知阶段" : "Web perception stages"}>
    <h4>{language === "zh" ? "运行阶段" : "Run stages"}</h4>
    <div>{stages.map((stage) => {
      const failed = stage.values.some((value) => value.status === "error");
      const running = stage.values.some((value) => value.status === "running" || value.status === "pending");
      const complete = stage.complete || (stage.values.length > 0 && !failed && !running);
      const status = stage.warning ? "warning" : failed ? "error" : complete ? "completed" : "running";
      return <span className={status} key={stage.label}>{status === "completed" ? <CheckCircle2 size={13} /> : status === "warning" || status === "error" ? <TriangleAlert size={13} /> : <CircleEllipsis size={13} />}<strong>{stage.label}</strong>{stage.values.length ? <small>{stage.values.length}</small> : null}</span>;
    })}</div>
  </section>;
}

function BoundedProcessSection({
  title,
  items,
  language,
  renderPart,
}: {
  title: string;
  items: StructuredAssistantPart[];
  language: "en" | "zh";
  renderPart: (part: StructuredAssistantPart) => React.JSX.Element | null;
}): React.JSX.Element | null {
  const [page, setPage] = useState(0);
  const window = boundedProcessWindow(items.length, page, PROCESS_PART_WINDOW_SIZE);
  useEffect(() => setPage((current) => boundedProcessWindow(items.length, current, PROCESS_PART_WINDOW_SIZE).page), [items.length]);
  if (!items.length) return null;
  return <section className="structured-process-section" data-process-item-total={items.length}>
    <h4>{title}</h4>
    <div className="structured-process-window">
      {items.slice(window.start, window.end).map((part) => <div className="structured-process-window-item" key={part.id}>{renderPart(part)}</div>)}
    </div>
    <ProcessWindowNavigation window={window} total={items.length} language={language} onPage={setPage} />
  </section>;
}

function ProcessWindowNavigation({
  window,
  total,
  language,
  onPage,
}: {
  window: ReturnType<typeof boundedProcessWindow>;
  total: number;
  language: "en" | "zh";
  onPage: (page: number) => void;
}): React.JSX.Element | null {
  if (window.pageCount <= 1) return null;
  return <nav className="structured-process-pagination" aria-label={language === "zh" ? "过程证据分页" : "Process evidence pages"}>
    <button type="button" disabled={window.page === 0} onClick={() => onPage(0)}>{language === "zh" ? "首页" : "First"}</button>
    <button type="button" disabled={window.page === 0} onClick={() => onPage(window.page - 1)}>{language === "zh" ? "上一页" : "Previous"}</button>
    <span>{language === "zh" ? `显示 ${window.start + 1}–${window.end} / ${total}` : `Showing ${window.start + 1}–${window.end} of ${total}`}</span>
    <button type="button" disabled={window.page >= window.pageCount - 1} onClick={() => onPage(window.page + 1)}>{language === "zh" ? "下一页" : "Next"}</button>
    <button type="button" disabled={window.page >= window.pageCount - 1} onClick={() => onPage(window.pageCount - 1)}>{language === "zh" ? "末页" : "Last"}</button>
  </nav>;
}

function reproducibilitySummaryLabel(level: RunReproducibilityLevel, language: "en" | "zh"): string {
  const labels: Record<RunReproducibilityLevel, readonly [string, string]> = {
    exact: ["可精确复现", "Exact evidence"],
    compatible: ["可兼容复现", "Compatible evidence"],
    partial: ["部分可复现", "Partial evidence"],
    unavailable: ["证据不足", "Evidence unavailable"],
  };
  return labels[level][language === "zh" ? 0 : 1];
}

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
  onOpenRun,
  onCreateExperiment,
}: {
  turn: StructuredTurnState;
  language: "en" | "zh";
  onOpenDebug?: () => void;
  onOpenRun?: (itemId: string) => void;
  onCreateExperiment?: (itemId: string) => void;
}): React.JSX.Element {
  const [page, setPage] = useState(0);
  const window = boundedProcessWindow(turn.activities.length, page, PROCESS_ACTIVITY_WINDOW_SIZE);
  useEffect(() => setPage((current) => boundedProcessWindow(turn.activities.length, current, PROCESS_ACTIVITY_WINDOW_SIZE).page), [turn.activities.length]);
  return <div className="structured-activity-details">
    <div className="structured-activity-window" data-activity-window-start={window.start} data-activity-window-end={window.end}>
    {turn.activities.slice(window.start, window.end).map((activity) => <div className={`structured-activity-row ${activity.status}`} key={activity.id}>
      <ActivityStatusIcon status={activity.status} />
      <span>{formatActivitySummary(activity, language)}</span>
      {activity.kind === "file_change" ? <small>{activity.action}</small> : null}
      {activity.kind === "tool" ? <small>{language === "zh" ? "执行记录已保存" : "Execution record saved"}</small> : null}
      {activity.kind === "tool" && activity.toolName !== "web_search" && activity.durationMs !== undefined
        ? <time>{formatRunDuration(activity.durationMs, language)}</time>
        : null}
      {onOpenRun && activity.oaepItemId ? <button type="button" className="structured-activity-inspect" onClick={() => onOpenRun(activity.oaepItemId!)} aria-label={`${language === "zh" ? "查看运行项目" : "Inspect run item"}: ${activity.title}`}><ArrowUpRight size={12} /></button> : null}
      {onCreateExperiment && activity.oaepItemId ? <button type="button" className="structured-activity-inspect" onClick={() => onCreateExperiment(activity.oaepItemId!)} aria-label={`${language === "zh" ? "从运行项目创建实验" : "Create experiment from run item"}: ${activity.title}`}><FlaskConical size={12} /></button> : null}
    </div>)}
    </div>
    <ProcessWindowNavigation window={window} total={turn.activities.length} language={language} onPage={setPage} />
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
    <div className="structured-activity-summary">
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
  if (activity.kind === "tool") {
    if (activity.toolName === "web_search") return formatWebSearchActivitySummary(activity, language);
    return userFacingBusinessText(activity.toolName, language === "zh" ? "执行任务步骤" : "Run task step");
  }
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
  const visibleSegments = part.segments.filter((segment) => !segment.visibility || segment.visibility === "user");
  const content = visibleSegments.map((segment) => segment.text).filter(Boolean).join("\n\n");
  if (!content && !part.summary) return null;
  const running = part.status === "running" || part.status === "pending";
  return (
    <div className="structured-reasoning" data-segment-count={visibleSegments.length}>
      <div className="chat-reasoning-content">
        {part.summary ? <p className="structured-reasoning-summary">{part.summary}</p> : null}
        {/* plainMarkdown avoids nesting a second "Thinking…" block via think-tag parsing. */}
        {content ? (
          <ChatMessageContent
            content={content}
            plainMarkdown
            streaming={false}
            language={language}
            onOpenLink={onOpenLink}
          />
        ) : null}
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
  compact = false,
  part,
  language,
  responded,
  capabilityConfigured,
  onRespond,
  onRequestText,
  onOpenResult,
  onOpenLink,
}: {
  compact?: boolean;
  part: InteractionPart;
  language: "en" | "zh";
  responded: boolean;
  capabilityConfigured: boolean;
  onRespond: (part: InteractionPart, response: InteractionResponse) => void;
  onRequestText: (part: InteractionPart) => void;
  onOpenResult?: () => void;
  onOpenLink?: (href: string | undefined) => void;
}): React.JSX.Element {
  const zh = language === "zh";
  const isGoalConfirmation = part.interactionType === "confirmation" && part.requestId.startsWith("goal:");
  const goalLines = Object.fromEntries(part.prompt.split(/\r?\n/).map((line) => {
    const separator = line.indexOf(":");
    return separator > 0 ? [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()] : ["", ""];
  }));
  const [editingGoal, setEditingGoal] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [configurationError, setConfigurationError] = useState("");
  const [configurationWarning, setConfigurationWarning] = useState("");
  const [savingConfiguration, setSavingConfiguration] = useState(false);
  const [configurationSaved, setConfigurationSaved] = useState(false);
  const [goalDraft, setGoalDraft] = useState(() => ({
    objective: goalLines.goal || "",
    materials: goalLines.materials === "None supplied" ? "" : goalLines.materials || "",
    outputs: goalLines.outputs === "Not specified" ? "" : goalLines.outputs || "",
    constraints: goalLines.constraints === "None supplied" ? "" : goalLines.constraints || "",
  }));
  const splitGoalList = (value: string): string[] => value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  if (part.interactionType === "capability_configuration") {
    const capabilityPrompt = !part.prompt.trim() || part.prompt.trim() === "[REDACTED]"
      ? (zh
          ? "这个问题需要联网获取当前信息。请配置网络感知器后继续，或选择暂不联网回答。"
          : "This question needs current information from the web. Configure a network perceptor to continue, or answer without web access.")
      : part.prompt;
    const configure = async () => {
      const key = apiKey.trim();
      if (!key) {
        setConfigurationError(zh ? "请输入 Tavily API Key。" : "Enter a Tavily API key.");
        return;
      }
      setSavingConfiguration(true);
      setConfigurationError("");
      setConfigurationWarning("");
      let configurationPersisted = false;
      try {
        await desktopApi.savePerceptor({
          perceptor_id: "web-tavily-main",
          name: zh ? "网页搜索" : "Web search",
          kind: "public_web",
          adapter: "tavily",
          enabled: true,
          capabilities: ["web.search", "web.extract"],
          config: {
            api_key: key,
            base_url: "https://api.tavily.com",
            search_depth: "basic",
            extract_depth: "basic",
            timeout_seconds: 15,
            max_document_chars: 20000,
          },
        });
        configurationPersisted = true;
        const tested = await desktopApi.testPerceptor("web-tavily-main", "search");
        if (!tested.ok) {
          const messages: Record<string, string> = zh ? {
            credential_required: "请输入 API Key。",
            credential_invalid: "Tavily 未接受当前 API Key，请检查后重试。",
            quota_exhausted: "Tavily 账户额度不足，请检查账户后重试。",
            network_unavailable: "当前无法连接 Tavily，请检查网络后重试。",
            provider_timeout: "Tavily 响应超时，请稍后重试。",
          } : {
            credential_required: "Enter an API key.",
            credential_invalid: "Tavily did not accept this API key. Check it and retry.",
            quota_exhausted: "The Tavily account has insufficient quota.",
            network_unavailable: "Tavily cannot be reached. Check the network and retry.",
            provider_timeout: "Tavily timed out. Please retry.",
          };
          if (["network_unavailable", "provider_timeout", "runtime_unavailable", "degraded"].includes(tested.status)) {
            setApiKey("");
            setConfigurationWarning(zh
              ? "网络感知器已保存；自动验证暂时未完成，正在使用已保存配置继续。实际搜索会自动重试。"
              : "The network perceptor was saved, but automatic validation is temporarily inconclusive. Continuing with the saved configuration; web search will retry automatically.");
            setConfigurationSaved(true);
            onRespond(part, { decision: "accept", capabilityAction: "configured" });
            return;
          }
          throw new Error(messages[tested.status] || (zh ? "连接测试失败，请稍后重试。" : "Connection test failed. Please retry."));
        }
        setApiKey("");
        setConfigurationSaved(true);
        onRespond(part, { decision: "accept", capabilityAction: "configured" });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (configurationPersisted) {
          setApiKey("");
          setConfigurationWarning(zh
            ? "网络感知器已保存；自动验证请求未完成，正在使用已保存配置继续。实际搜索会自动重试。"
            : "The network perceptor was saved, but its automatic validation request did not complete. Continuing with the saved configuration; web search will retry automatically.");
          setConfigurationSaved(true);
          onRespond(part, { decision: "accept", capabilityAction: "configured" });
          return;
        }
        setConfigurationError(zh
          ? `网页搜索配置未通过验证：${detail}`
          : `Web search configuration could not be verified: ${detail}`);
      } finally {
        setSavingConfiguration(false);
      }
    };
    if (configurationSaved || capabilityConfigured) {
      return <section className="chat-agent-input-request structured-interaction capability-configuration-card capability-configuration-complete" data-testid="capability-configuration-card" data-state="configured" aria-label={zh ? "网络感知器已配置" : "Network perceptor configured"} role="status">
        <div className="capability-configuration-title">
          <CheckCircle2 size={18} aria-hidden="true" />
          <strong>{zh ? "网络感知器已配置" : "Network perceptor configured"}</strong>
          <span className="streaming-status capability-configuration-resume-status" aria-live="polite">
            <span className="streaming-dot" aria-hidden />
            <span>{zh ? "正在继续处理" : "Continuing the task"}</span>
          </span>
        </div>
        {configurationWarning ? <p className="capability-configuration-warning" role="status">{configurationWarning}</p> : null}
      </section>;
    }
    return <section className="chat-agent-input-request structured-interaction capability-configuration-card" data-testid="capability-configuration-card" data-state="required" aria-label={zh ? "配置网页搜索" : "Configure web search"}>
      <div className="capability-configuration-title"><Globe2 size={18} aria-hidden="true" /><strong>{zh ? "需要网络感知器" : "A network perceptor is needed"}</strong></div>
      <p>{capabilityPrompt}</p>
      <p>{zh ? "你也可以稍后在“设置 → 感知器配置”中管理 Tavily。" : "You can also manage Tavily later in Settings → Perceptors."}</p>
      <p className="capability-configuration-privacy">{zh ? "隐私说明：保存并验证之前，不会把本次问题发送给 Tavily。API Key 将安全保存在本机。" : "Privacy: this query is not sent to Tavily before you save and verify the configuration. The API key is stored securely on this device."}</p>
      <label>{zh ? "Tavily API Key" : "Tavily API key"}<input data-testid="capability-api-key" type="password" autoComplete="off" value={apiKey} disabled={responded || savingConfiguration} onChange={(event) => setApiKey(event.target.value)} placeholder="tvly-…" /></label>
      <button type="button" className="link-button" onClick={() => onOpenLink?.("https://app.tavily.com/home")}>{zh ? "如何获取 API Key" : "How to get an API key"}<ArrowUpRight size={13} aria-hidden="true" /></button>
      {configurationError ? <p className="capability-configuration-error" role="alert">{configurationError}</p> : null}
      <div>
        <button type="button" disabled={responded || savingConfiguration} onClick={() => onRespond(part, { decision: "decline", capabilityAction: "answer_without_network" })}>{zh ? "暂不联网，继续回答" : "Continue without web"}</button>
        <button type="button" data-testid="capability-save-and-continue" disabled={responded || savingConfiguration || !apiKey.trim()} onClick={() => void configure()}>{savingConfiguration ? (zh ? "正在验证…" : "Verifying…") : (zh ? "保存并继续" : "Save and continue")}</button>
      </div>
    </section>;
  }
  if (compact) {
    const label = isGoalConfirmation
      ? (responded ? (zh ? "任务目标已处理" : "Task goal handled") : (zh ? "任务目标等待确认，请在输入栏处理" : "Task goal is awaiting confirmation in the composer"))
      : (responded ? (zh ? "交互请求已处理" : "Interaction handled") : (zh ? "等待你的操作，请在输入栏处理" : "Your action is required in the composer"));
    return <div className="structured-interaction-compact" data-testid={isGoalConfirmation ? "goal-confirmation-summary" : undefined} role="status">
      <Reply size={14} aria-hidden="true" />
      <span>{label}</span>
    </div>;
  }
  return (
    <section className="chat-agent-input-request structured-interaction" data-testid={isGoalConfirmation ? "goal-confirmation-card" : undefined} aria-label={isGoalConfirmation ? (zh ? "确认任务目标" : "Confirm task goal") : (zh ? "智能体请求输入" : "Agent input request")}>
      <strong>{isGoalConfirmation ? (zh ? "开始前请确认任务目标" : "Confirm the task goal before starting") : (zh ? "智能体需要你的输入" : "Agent needs your input")}</strong>
      <p>{part.prompt}</p>
      <div>
        {isGoalConfirmation ? (
          <>
            {editingGoal ? (
              <div className="structured-goal-editor">
                <label>{zh ? "目标" : "Goal"}<textarea data-testid="goal-confirmation-objective" value={goalDraft.objective} onChange={(event) => setGoalDraft((current) => ({ ...current, objective: event.target.value }))} /></label>
                <label>{zh ? "材料（每行一项）" : "Materials (one per line)"}<textarea data-testid="goal-confirmation-materials" value={goalDraft.materials} onChange={(event) => setGoalDraft((current) => ({ ...current, materials: event.target.value }))} /></label>
                <label>{zh ? "输出（每行一项）" : "Outputs (one per line)"}<textarea data-testid="goal-confirmation-outputs" value={goalDraft.outputs} onChange={(event) => setGoalDraft((current) => ({ ...current, outputs: event.target.value }))} /></label>
                <label>{zh ? "限制（每行一项）" : "Constraints (one per line)"}<textarea data-testid="goal-confirmation-constraints" value={goalDraft.constraints} onChange={(event) => setGoalDraft((current) => ({ ...current, constraints: event.target.value }))} /></label>
                <button type="button" onClick={() => setEditingGoal(false)}>{zh ? "取消修改" : "Cancel edit"}</button>
                <button type="button" data-testid="goal-confirmation-save" disabled={!goalDraft.objective.trim() || splitGoalList(goalDraft.outputs).length === 0} onClick={() => {
                  onRespond(part, { decision: "revise", goal: { objective: goalDraft.objective.trim(), materials: splitGoalList(goalDraft.materials), outputs: splitGoalList(goalDraft.outputs), constraints: splitGoalList(goalDraft.constraints) } });
                  setEditingGoal(false);
                }}>{zh ? "保存新版本" : "Save new version"}</button>
              </div>
            ) : <button type="button" data-testid="goal-confirmation-edit" disabled={responded} onClick={() => setEditingGoal(true)}>{zh ? "修改或补充" : "Edit or add details"}</button>}
            <button type="button" data-testid="goal-confirmation-cancel" disabled={responded} onClick={() => onRespond(part, { decision: "decline" })}>{zh ? "取消任务" : "Cancel task"}</button>
            <button type="button" data-testid="goal-confirmation-confirm" disabled={responded} onClick={() => onRespond(part, { decision: "accept" })}>{zh ? "确认并开始" : "Confirm and start"}</button>
          </>
        ) : part.interactionType === "approval" || part.interactionType === "confirmation" ? (
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

function NoticeItem({ part, language, onOpenDebug }: { part: NoticePart; language: "en" | "zh"; onOpenDebug?: () => void }): React.JSX.Element {
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
      <span>{userFacingNotice(part.message, language)}</span>
      {(part.level === "error" || part.level === "warning") && onOpenDebug ? <button type="button" onClick={onOpenDebug}>{language === "zh" ? "技术详情" : "Technical details"}</button> : null}
    </div>
  );
}

function userFacingNotice(message: string, language: "en" | "zh"): string {
  if (!message || message === "[REDACTED]") {
    return language === "zh"
      ? "本次运行未能完成，旧版本没有保存可显示的详细原因。你可以重试，或查看技术详情。"
      : "This run did not finish, and the older record has no displayable reason. Retry or view technical details.";
  }
  if (/citation_evidence_(invalid|incomplete)/i.test(message)) {
    return language === "zh"
      ? "已获取网页信息，但部分来源引用未能完整验证。回答和已找到的来源仍然保留。"
      : "Web information was retrieved, but some citations could not be fully verified. The answer and retrieved sources were preserved.";
  }
  return message;
}
