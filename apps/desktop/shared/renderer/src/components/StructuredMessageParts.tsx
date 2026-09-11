import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleEllipsis,
  FileDiff,
  FileText,
  FlaskConical,
  Globe2,
  Image,
  Info,
  ListChecks,
  Loader2,
  Quote,
  Reply,
  Table2,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { stripTrailingSourceList } from "../sourceListPresentation";
import { stripAgentToolDebugText } from "../chatOutputModel";
import type { InlineCitationLink } from "../citationMarkerPlugin";
import { boundedProcessWindow, PROCESS_ACTIVITY_WINDOW_SIZE, PROCESS_PART_WINDOW_SIZE } from "../boundedProcessWindow";
import { useFollowLatestPage } from "../useFollowLatestPage";
import { createSmoothFollowOutputController } from "../smoothFollowOutput";
import {
  buildStructuredProcessPresentation,
  formatActivitySummary,
  type ProcessActivityGroup,
  type ProcessProgressGroup,
} from "../structuredProcessPresentation";
import type {
  ArtifactPart,
  CitationPart,
  InteractionPart,
  NoticePart,
  ReasoningSegment,
  StructuredActivityEvent,
  StructuredProcessTimelineEntry,
  StructuredAssistantPart,
  StructuredTurnState,
  SubtaskPart,
} from "@shared/structuredConversation";
import type { RunReproducibilityLevel } from "@shared/runInspection";
import type { OaepResourceRef } from "@shared/oaep.generated";
import { selectInlineArtifactLinks, type InlineArtifactLink, type SelectedInlineArtifactLink } from "../artifactLinkPlugin";
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
  workspacePath?: string;
  resourceStates?: Readonly<Record<string, "available" | "moved" | "changed" | "deleted" | "offline" | "unsupported">>;
  respondedRequestIds: ReadonlySet<string>;
  configuredCapabilityRequestIds: ReadonlySet<string>;
  onOpenLink: (href: string | undefined) => void;
  onOpenArtifact: (part: ArtifactPart) => void;
  onDownloadArtifact?: (part: ArtifactPart) => void;
  onOpenArtifactMenu?: (part: ArtifactPart, anchor: { x: number; y: number; trigger?: HTMLElement }) => void;
  onOpenCitation: (part: CitationPart) => void;
  onOpenCitationMenu?: (part: CitationPart, anchor: { x: number; y: number; trigger?: HTMLElement }) => void;
  onOpenResource?: (resourceRef: OaepResourceRef) => void;
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
  workspacePath,
  resourceStates,
  respondedRequestIds,
  configuredCapabilityRequestIds,
  onOpenLink,
  onOpenArtifact,
  onOpenArtifactMenu,
  onOpenCitation,
  onOpenCitationMenu,
  onOpenResource,
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
  const [processOpen, setProcessOpen] = useState(
    turn.status === "running" || turn.status === "error",
  );
  const previousTurnStatusRef = useRef(turn.status);
  const processContentRef = useRef<HTMLDivElement | null>(null);
  const [processFollowOutput] = useState(() => createSmoothFollowOutputController({
    scrollToBottom: (behavior) => {
      const el = processContentRef.current;
      if (el) el.scrollTo({ top: Math.max(0, el.scrollHeight - el.clientHeight), behavior });
    },
    stopScrolling: (scrollTop) => {
      processContentRef.current?.scrollTo({ top: scrollTop, behavior: "auto" });
    },
  }));
  const citationParts = turn.parts.filter((part): part is CitationPart => part.kind === "citation");
  const progressParts = turn.parts.filter((part) => part.kind === "progress");
  const reasoningParts = turn.parts.filter((part) => part.kind === "reasoning");
  const subtaskParts = turn.parts.filter((part) => part.kind === "subtask");
  const interactionParts = turn.parts.filter((part): part is InteractionPart =>
    part.kind === "interaction"
    && (part.status === "running" || part.status === "pending")
    && (turn.status === "running" || !respondedRequestIds.has(part.requestId))
  );
  const artifactParts = turn.parts.filter((part): part is ArtifactPart => part.kind === "artifact");
  const inlineArtifactCandidates: InlineArtifactLink[] = artifactParts
    .filter((part) => part.artifactType !== "image" && part.artifactType !== "web")
    .map((part) => ({
      id: part.id,
      label: part.name,
      title: part.path || part.url || part.name,
      targets: [part.name, part.path, part.url].filter((value): value is string => Boolean(value)),
      state: resourceState(part, resourceStates),
    }));
  const inlineArtifactsByMarkdown = new Map<string, SelectedInlineArtifactLink[]>();
  const embeddedArtifactIds = new Set<string>();
  for (const markdownPart of turn.parts.filter((part): part is Extract<StructuredAssistantPart, { kind: "markdown" }> => part.kind === "markdown")) {
    const selected = selectInlineArtifactLinks(markdownPart.markdown, inlineArtifactCandidates.filter((candidate) => !embeddedArtifactIds.has(candidate.id)));
    if (selected.length) inlineArtifactsByMarkdown.set(markdownPart.id, selected);
    for (const artifact of selected) embeddedArtifactIds.add(artifact.id);
  }
  const finalAnswerParts = turn.parts.filter((part): part is Extract<StructuredAssistantPart, { kind: "markdown" }> =>
    part.kind === "markdown" && turn.status === "completed" && part.final === true && part.channel === "answer",
  );
  const finalAnswerIds = new Set(finalAnswerParts.map((part) => part.id));
  const finalCitationIds = new Set(finalAnswerParts.flatMap((part) => part.citationIds ?? []));
  // Keep the answer text clean (webui style): file cards sit below the final reply,
  // not as inline chips where the model happens to name the file.
  const resultParts = turn.parts.filter((part) =>
    finalAnswerIds.has(part.id)
    || (part.kind === "citation" && (finalCitationIds.has(part.citationId) || (part.markdownPartId !== undefined && finalAnswerIds.has(part.markdownPartId)))),
  );
  const deliveryArtifactParts = turn.status === "completed"
    ? selectDeliveryArtifacts(artifactParts)
    : [];
  // The model writes `[E1]` so the support check can tell which passage each
  // sentence rests on. The reader has no use for the number, so the marker is
  // shown as the document it stands for. Order is the marker order the runtime
  // assigned, which is what the model was given.
  const inlineCitations = useMemo<InlineCitationLink[]>(() => citationParts.map((part, index) => ({
    marker: index + 1,
    citationId: part.citationId,
    label: citationFileName(part),
    title: [part.path ?? part.url ?? part.title, part.locator].filter(Boolean).join(" · "),
  })), [citationParts]);
  const noticeParts = turn.parts.filter((part): part is NoticePart => part.kind === "notice");
  const importantNoticeParts = noticeParts.filter((part) => part.level === "warning" || part.level === "error");
  const backgroundNoticeParts = noticeParts.filter((part) => part.level !== "warning" && part.level !== "error");
  const publicSources = useMemo(() => extractPublicSources(turn), [turn]);
  const processPresentation = useMemo(() => buildStructuredProcessPresentation(turn, language), [language, turn]);
  const hasUserWarning = noticeParts.some((part) => part.level === "warning") || turn.parts.some((part) => part.kind === "markdown" && /could not be fully verified|citation_evidence_incomplete/i.test(part.markdown));
  const hasProcess = (turn.processTimeline?.length ?? 0) > 0 || progressParts.length > 0 || reasoningParts.length > 0 || subtaskParts.length > 0 || turn.activities.length > 0 || noticeParts.length > 0;
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
  const runCounts = processPresentation.counts;
  const activeProgress = [...progressParts].reverse().find((part) => part.status === "pending" || part.status === "running");
  const currentProcessLabel = processPresentation.currentActivity ?? activeProgress?.summary;
  const statusContext = [formatRunContext(turn.meta?.backend), turn.meta?.workspaceLabel, turn.status === "running" ? currentProcessLabel : undefined].filter(Boolean).join(" · ");

  useEffect(() => () => {
    if (relationTimerRef.current !== null) window.clearTimeout(relationTimerRef.current);
  }, []);

  useEffect(() => {
    const previousStatus = previousTurnStatusRef.current;
    if (turn.status === "running" && previousStatus !== "running") {
      setProcessOpen(true);
    } else if (turn.status === "error" && previousStatus !== "error") {
      setProcessOpen(true);
    } else if (previousStatus === "running" && turn.status !== "running") {
      // Keep the live reasoning and activity stream visible while work is in
      // progress, then return the completed card to its compact summary. This
      // runs only on the terminal transition, so a later manual expansion is
      // never overridden.
      setProcessOpen(false);
    }
    previousTurnStatusRef.current = turn.status;
  }, [turn.status]);

  // Auto-scroll the "过程" content container to bottom during streaming,
  // using the same smoothFollowOutput state machine as the outer message list.
  // Without this, the independent overflow-y:auto viewport stays at its
  // current scroll position while new content grows below.
  useEffect(() => {
    if (!processOpen) return;
    const container = processContentRef.current;
    if (!container) return;
    const onScroll = () => {
      const maxScroll = container.scrollHeight - container.clientHeight;
      processFollowOutput.handleScroll(container.scrollTop, maxScroll);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [processOpen, processFollowOutput]);

  useEffect(() => {
    if (!processOpen || turn.status !== "running") return;
    const container = processContentRef.current;
    if (!container) return;
    const frame = requestAnimationFrame(() => {
      if (container) processFollowOutput.handleHeightChange(container.scrollHeight);
    });
    return () => cancelAnimationFrame(frame);
  }, [turn, processOpen, processFollowOutput]);

  useEffect(() => () => processFollowOutput.dispose(), [processFollowOutput]);

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
      const displayedMarkdown = stripAgentToolDebugText(
        publicSources.length ? stripTrailingSourceList(part.markdown) : part.markdown,
      ).trim();
      return displayedMarkdown ? (
        <div key={part.id} className={`structured-markdown-part ${focusedPartId === part.id ? "relation-focus" : ""}`} data-structured-part-id={part.id}>
          <ChatMessageContent
            content={displayedMarkdown}
            plainMarkdown
            streaming={part.status === "running"}
            language={language}
            onOpenLink={onOpenLink}
            citations={inlineCitations}
            onOpenCitation={(citationId) => {
              const citation = citationParts.find((candidate) => candidate.citationId === citationId);
              if (citation) onOpenCitation(citation);
            }}
          />
          {part.citationIds?.length ? <div className="structured-inline-citations" aria-label={language === "zh" ? "本段引用" : "Citations for this section"}>
            {part.citationIds.map((citationId) => {
              const citation = citationParts.find((candidate) => candidate.citationId === citationId);
              if (!citation) return null;
              const openCitation = citation.url?.startsWith("https://") ? () => onOpenCitation(citation) : () => focusPart(citation.id);
              return <button type="button" key={citationId} onClick={openCitation} title={[citation.path ?? citation.url ?? citation.title, citation.locator].filter(Boolean).join(" · ")} aria-label={`${language === "zh" ? "打开引用" : "Open citation"}: ${citation.title}`}>{citationFileName(citation)}</button>;
            })}
          </div> : null}
        </div>
      ) : null;
    }
    if (part.kind === "reasoning") return <StructuredReasoning key={part.id} part={part} language={language} onOpenLink={onOpenLink} />;
    if (part.kind === "progress") {
      const ProgressIcon = part.status === "completed" ? CheckCircle2 : part.status === "error" ? AlertCircle : part.status === "cancelled" ? XCircle : part.status === "running" ? Loader2 : CircleEllipsis;
      const progressIconClass = part.status === "running" ? "structured-progress-icon spinning" : "structured-progress-icon";
      return <div className={`structured-progress ${part.status}`} key={part.id} role="status" data-phase={part.phase || undefined}>
        <ProgressIcon size={14} className={progressIconClass} aria-hidden="true" />
        <span className="structured-progress-text">
          {part.phase ? <em className="structured-progress-phase">{part.phase}</em> : null}
          <ChatMessageContent content={part.summary} streaming={part.status === "running"} language={language} onOpenLink={onOpenLink} />
        </span>
        {part.total !== undefined && part.completed !== undefined ? <small className="structured-progress-count">{part.completed}/{part.total}</small> : null}
      </div>;
    }
    if (part.kind === "artifact") return <ArtifactItem key={part.id} part={part} language={language} workspacePath={workspacePath} resourceState={resourceState(part, resourceStates)} focused={focusedPartId === part.id} onOpen={() => onOpenArtifact(part)} onOpenMenu={onOpenArtifactMenu ? (anchor) => onOpenArtifactMenu(part, anchor) : undefined} />;
    if (part.kind === "citation") return <CitationItem key={part.id} part={part} index={citationParts.findIndex((candidate) => candidate.id === part.id) + 1} language={language} resourceState={resourceState(part, resourceStates)} focused={focusedPartId === part.id} onOpen={() => onOpenCitation(part)} onOpenMenu={onOpenCitationMenu && (part.resourceRef || part.associationId) ? (anchor) => onOpenCitationMenu(part, anchor) : undefined} onBack={part.markdownPartId ? () => focusPart(part.markdownPartId as string) : undefined} />;
    if (part.kind === "interaction") return <InteractionItem compact key={part.id} part={part} language={language} responded={respondedRequestIds.has(part.requestId)} capabilityConfigured={configuredCapabilityRequestIds.has(part.requestId)} onRespond={onRespondInteraction} onRequestText={onRequestTextInteraction} onOpenResult={onOpenDebug} onOpenLink={onOpenLink} />;
    if (part.kind === "subtask") return <SubtaskContainer key={part.id} part={part} language={language} onOpenLink={onOpenLink} />;
    return <NoticeItem key={part.id} part={part} language={language} onOpenDebug={onOpenDebug} />;
  }

  return (
    <div ref={containerRef} className="structured-message-parts" data-turn-id={turn.turnId} data-turn-status={turn.status}>
      {hasProcess ? <details className="structured-process" open={processOpen} onToggle={(event) => setProcessOpen(event.currentTarget.open)}>
        <summary className="structured-run-status" title={statusMeta}>
          <span className="structured-run-context">{statusContext}</span>
          <span className="structured-run-actions">
            <span className={`structured-turn-status status-${turn.status}`}>{turnStatusLabel}{durationLabel ? ` · ${durationLabel}` : ""}</span>
            {runCounts.length ? <span className="structured-run-counts" aria-label={language === "zh" ? "运行步骤计数" : "Run step counts"}>{runCounts.map((item) => <small key={item.key}>{item.label} {item.count}</small>)}</span> : null}
            {reproducibilityLevel === "partial" || reproducibilityLevel === "unavailable" ? <span className={`structured-reproducibility level-${reproducibilityLevel}`}>{reproducibilitySummaryLabel(reproducibilityLevel, language)}</span> : null}
            <span className="structured-process-label">{language === "zh" ? "过程" : "Process"}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </span>
        </summary>
        {processOpen ? <div className="structured-process-content" ref={processContentRef} data-testid="structured-process-content">
          <RetrievalStageSummary turn={turn} language={language} />
          {processPresentation.completionSummary ? <div className="structured-process-overview"><CheckCircle2 size={15} aria-hidden="true" /><span>{processPresentation.completionSummary}</span></div> : null}
          <StructuredProcessTimeline
            timeline={turn.processTimeline}
            reasoningParts={reasoningParts}
            progressParts={progressParts}
            markdownParts={turn.parts.filter((part): part is Extract<StructuredAssistantPart, { kind: "markdown" }> => part.kind === "markdown")}
            activities={turn.activities.filter((activity) => !activity.subtaskId)}
            language={language}
            resourceStates={resourceStates}
            onOpenResource={onOpenResource}
            onOpenLink={onOpenLink}
            artifactParts={artifactParts}
            inlineArtifactsByMarkdown={inlineArtifactsByMarkdown}
            citationParts={citationParts}
            inlineCitations={inlineCitations}
            onOpenArtifact={onOpenArtifact}
            onOpenArtifactMenu={onOpenArtifactMenu}
            onOpenCitation={onOpenCitation}
            running={turn.status === "running"}
            renderPart={renderPart}
          />
          <BoundedProcessSection title={language === "zh" ? "子任务" : "Subtasks"} items={subtaskParts} language={language} renderPart={renderPart} running={turn.status === "running"} />
          <BoundedProcessSection title={language === "zh" ? "运行信息" : "Run information"} items={backgroundNoticeParts} language={language} renderPart={renderPart} running={turn.status === "running"} />
          <div className="structured-process-footer">
            {onOpenRun && runId ? <button type="button" className="structured-run-inspect-link" onClick={() => onOpenRun(runId)}>{language === "zh" ? "查看完整运行" : "View full run"}<ArrowUpRight size={13} aria-hidden /></button> : null}
            {onCreateRunExperiment && runId ? <button type="button" className="structured-run-inspect-link" onClick={() => onCreateRunExperiment(runId)}>{language === "zh" ? "创建实验" : "Create experiment"}<FlaskConical size={13} aria-hidden /></button> : null}
            {onOpenDebug ? <button type="button" className="structured-debug-link" onClick={onOpenDebug}>{language === "zh" ? "技术诊断" : "Technical diagnostics"}</button> : null}
          </div>
        </div> : null}
      </details> : <header className="structured-run-status" title={statusMeta}>
        <span className="structured-run-context">{statusContext}</span>
        <span className={`structured-turn-status status-${turn.status}`}>{turnStatusLabel}{durationLabel ? ` · ${durationLabel}` : ""}</span>
        {runCounts.length ? <span className="structured-run-counts" aria-label={language === "zh" ? "运行步骤计数" : "Run step counts"}>{runCounts.map((item) => <small key={item.key}>{item.label} {item.count}</small>)}</span> : null}
        {reproducibilityLevel === "partial" || reproducibilityLevel === "unavailable" ? <span className={`structured-reproducibility level-${reproducibilityLevel}`}>{reproducibilitySummaryLabel(reproducibilityLevel, language)}</span> : null}
        {onOpenRun && runId ? <button type="button" className="structured-run-inspect-link" onClick={() => onOpenRun(runId)}>{language === "zh" ? "查看运行" : "View run"}<ArrowUpRight size={13} aria-hidden /></button> : null}
        {onCreateRunExperiment && runId ? <button type="button" className="structured-run-inspect-link" onClick={() => onCreateRunExperiment(runId)}>{language === "zh" ? "创建实验" : "Create experiment"}<FlaskConical size={13} aria-hidden /></button> : null}
      </header>}
      {importantNoticeParts.length ? <section className="structured-important-notices">{importantNoticeParts.map(renderPart)}</section> : null}
      {interactionParts.length ? <section className="structured-interaction-layer" aria-label={language === "zh" ? "待用户交互" : "User action required"}>{interactionParts.map(renderPart)}</section> : null}
      {resultParts.length || deliveryArtifactParts.length ? (
        <section className="structured-result-layer">
          <h3>{language === "zh" ? "回答" : "Answer"}</h3>
          {resultParts.map(renderPart)}
          {deliveryArtifactParts.length ? (
            <div className="structured-result-files" aria-label={language === "zh" ? "生成的文件" : "Generated files"}>
              {deliveryArtifactParts.map((part) => (
                <ArtifactItem
                  key={part.id}
                  part={part}
                  language={language}
                  workspacePath={workspacePath}
                  resourceState={resourceState(part, resourceStates)}
                  focused={focusedPartId === part.id}
                  onOpen={() => onOpenArtifact(part)}
                  onOpenMenu={onOpenArtifactMenu ? (anchor) => onOpenArtifactMenu(part, anchor) : undefined}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      <PublicSourcesDisclosure sources={publicSources} language={language} onOpenLink={onOpenLink} running={turn.status === "running"} />
    </div>
  );
});

const SubtaskContainer = memo(function SubtaskContainer({
  part,
  language,
  onOpenLink,
}: {
  part: SubtaskPart;
  language: "en" | "zh";
  onOpenLink: (href: string | undefined) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const SubtaskIcon = part.status === "completed" ? CheckCircle2
    : part.status === "error" ? AlertCircle
    : part.status === "cancelled" ? XCircle
    : part.status === "running" ? Loader2
    : CircleEllipsis;
  const iconClass = part.status === "running" ? "structured-subtask-icon spinning" : "structured-subtask-icon";
  const hasInternals = (part.reasoningSegments?.length ?? 0) > 0
    || (part.activities?.length ?? 0) > 0
    || Boolean(part.markdownSummary);

  return (
    <div className={`structured-subtask-container ${part.status}`}
         data-agent={part.agentName || undefined}
         data-depth={part.depth ?? 0}
         key={part.id}>
      <div className="structured-subtask-header"
           onClick={() => hasInternals && setExpanded(!expanded)}>
        <SubtaskIcon size={14} className={iconClass} aria-hidden="true" />
        <span className="structured-subtask-text">
          <strong>{part.title}</strong>
          {/* The final child markdown is rendered in the expandable body;
              do not repeat the same text in the header summary. */}
          {!part.markdownSummary && part.summary ? ` · ${part.summary}` : ""}
        </span>
        {part.agentName ? <span className="structured-subtask-agent">{part.agentName}</span> : null}
        {hasInternals ? (
          <button className="structured-subtask-toggle" type="button" aria-label={expanded ? "Collapse" : "Expand"}>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : null}
      </div>
      {expanded && hasInternals ? (
        <div className="structured-subtask-internals">
          {part.reasoningSegments?.length ? (
            <details className="structured-subtask-reasoning" open>
              <summary><Info size={12} /> {language === "zh" ? "推理过程" : "Reasoning"}</summary>
              {part.reasoningSegments.map((seg) => (
                <div key={seg.id} className="structured-subtask-reasoning-segment">
                  <ChatMessageContent content={seg.text} plainMarkdown language={language} onOpenLink={onOpenLink} />
                </div>
              ))}
            </details>
          ) : null}
          {part.activities?.length ? (
            <details className="structured-subtask-activities">
              <summary><ListChecks size={12} /> {language === "zh" ? `工具活动 · ${part.activities.length}` : `Tool activities · ${part.activities.length}`}</summary>
              <div className="structured-subtask-activity-list">
                {part.activities.slice(0, 50).map((activity) => (
                  <div key={activity.id} className="structured-subtask-activity-item">
                    <ActivityStatusIcon status={activity.status} />
                    <span>{activity.title}</span>
                    {activity.kind === "tool" ? <small>{activity.toolName}</small> : null}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          {part.markdownSummary ? (
            <div className="structured-subtask-markdown">
              <ChatMessageContent content={part.markdownSummary} plainMarkdown language={language} onOpenLink={onOpenLink} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

function resourceState(
  link: { resourceRef?: OaepResourceRef; associationId?: string; sessionId?: string } | OaepResourceRef | undefined,
  states: StructuredMessagePartsProps["resourceStates"],
): "available" | "moved" | "changed" | "deleted" | "offline" | "unsupported" | undefined {
  if (!link) return undefined;
  if ("associationId" in link && link.associationId && link.sessionId) return states?.[`${link.sessionId}:${link.associationId}`];
  const reference = "workspace_id" in link
    ? link as OaepResourceRef
    : (link as { resourceRef?: OaepResourceRef }).resourceRef;
  if (!reference) return undefined;
  return states?.[`${reference.workspace_id}:${reference.resource_type}:${reference.resource_id}`];
}

function resourceStateLabel(
  state: "available" | "moved" | "changed" | "deleted" | "offline" | "unsupported",
  language: "en" | "zh",
): string {
  const labels = language === "zh"
    ? { available: "可用", moved: "已移动", changed: "已更改", deleted: "已删除", offline: "离线", unsupported: "不支持" }
    : { available: "Available", moved: "Moved", changed: "Changed", deleted: "Deleted", offline: "Offline", unsupported: "Unsupported" };
  return labels[state];
}

function extractPublicSources(turn: StructuredTurnState): Array<{ url: string; label: string }> {
  const urls: string[] = [];
  for (const part of turn.parts) {
    if (part.kind === "citation" && part.url?.startsWith("https://")) urls.push(part.url);
    if (part.kind !== "markdown") continue;
    urls.push(...(part.markdown.match(/https:\/\/[^\s<>\]\[(){}"']+/g) ?? []).map((url) => url.replace(/[.,;:!?]+$/, "")));
  }
  return [...new Set(urls)].map((url) => {
    try { return { url, label: new URL(url).hostname.replace(/^www\./, "") }; }
    catch { return { url, label: url }; }
  });
}

function PublicSourcesDisclosure({
  sources,
  language,
  onOpenLink,
  running,
}: {
  sources: Array<{ url: string; label: string }>;
  language: "en" | "zh";
  onOpenLink: (href: string | undefined) => void;
  running: boolean;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const { page, setPage, window } = useFollowLatestPage(sources.length, PROCESS_PART_WINDOW_SIZE, running);
  if (!sources.length) return null;
  return <details className="structured-source-list" open={open} onToggle={(event) => setOpen(event.currentTarget.open)} aria-label={language === "zh" ? "回答来源" : "Answer sources"}>
    <summary>{language === "zh" ? `来源 · ${sources.length}` : `Sources · ${sources.length}`}<ChevronDown size={14} aria-hidden="true" /></summary>
    {open ? <div>
      {sources.slice(window.start, window.end).map((source, index) => <button type="button" key={source.url} onClick={() => onOpenLink(source.url)}>
        <span><small>{window.start + index + 1}</small><strong>{source.label}</strong></span>
        <em>{language === "zh" ? "已获取" : "Retrieved"}</em><ArrowUpRight size={13} aria-hidden />
      </button>)}
      <ProcessWindowNavigation window={window} total={sources.length} language={language} onPage={setPage} />
    </div> : null}
  </details>;
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
  running,
}: {
  title: string;
  items: StructuredAssistantPart[];
  language: "en" | "zh";
  renderPart: (part: StructuredAssistantPart) => React.JSX.Element | null;
  running: boolean;
}): React.JSX.Element | null {
  const { page, setPage, window } = useFollowLatestPage(items.length, PROCESS_PART_WINDOW_SIZE, running);
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
  // Chat badge must match Run Inspector wording. "证据不足" made successful
  // GFS listings look like the answer failed verification; this level only
  // means the run manifest lacks fields needed for exact replay/export.
  const labels: Record<RunReproducibilityLevel, readonly [string, string]> = {
    exact: ["可精确复现", "Exact evidence"],
    compatible: ["可兼容复现", "Compatible evidence"],
    partial: ["部分可复现", "Partial evidence"],
    unavailable: ["暂不可复现", "Not reproducible yet"],
  };
  return labels[level][language === "zh" ? 0 : 1];
}

function formatBackendLabel(backend: string | undefined): string {
  if (!backend) return "";
  if (/codex/i.test(backend)) return "Codex";
  if (/opendrsai|drsai/i.test(backend)) return "OpenDrSai Agent";
  return backend;
}

function formatRunContext(backend: string | undefined): string {
  if (!backend || /runtime|opendrsai|drsai/i.test(backend)) return "OpenDrSai";
  if (/codex/i.test(backend)) return "Codex";
  return backend;
}

function CompactProgressSection({
  groups,
  language,
  running,
}: {
  groups: ProcessProgressGroup[];
  language: "en" | "zh";
  running: boolean;
}): React.JSX.Element | null {
  const { page, setPage, window } = useFollowLatestPage(groups.length, PROCESS_PART_WINDOW_SIZE, running);
  if (!groups.length) return null;
  return <section className="structured-process-section structured-progress-groups" data-progress-group-total={groups.length}>
    <h4>{language === "zh" ? "进度与计划" : "Progress and plan"}</h4>
    <div className="structured-process-window">
      {groups.slice(window.start, window.end).map((group) => <div className={`structured-progress-group ${group.status}`} key={group.id}>
        <ActivityStatusIcon status={group.status} />
        <span>{group.summary}</span>
        {group.count > 1 ? <small>×{group.count}</small> : null}
        {group.total !== undefined && group.completed !== undefined ? <small>{group.completed}/{group.total}</small> : null}
      </div>)}
    </div>
    <ProcessWindowNavigation window={window} total={groups.length} language={language} onPage={setPage} />
  </section>;
}

function ReasoningDisclosure({
  parts,
  language,
  running,
  renderPart,
}: {
  parts: Array<Extract<StructuredAssistantPart, { kind: "reasoning" }>>;
  language: "en" | "zh";
  running: boolean;
  renderPart: (part: StructuredAssistantPart) => React.JSX.Element | null;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(running);
  const previousRunningRef = useRef(running);
  useEffect(() => {
    const wasRunning = previousRunningRef.current;
    if (running && !wasRunning) setOpen(true);
    else if (!running && wasRunning) setOpen(false);
    previousRunningRef.current = running;
  }, [running]);
  const { page, setPage, window } = useFollowLatestPage(parts.length, PROCESS_PART_WINDOW_SIZE, running);
  if (!parts.length) return null;
  const latestSummary = [...parts].reverse().map((part) => part.summary?.trim()).find(Boolean);
  return <details className="structured-analysis-disclosure" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <span><strong>{language === "zh" ? "分析说明" : "Analysis notes"}</strong>{latestSummary ? <small>{latestSummary}</small> : <small>{language === "zh" ? `${parts.length} 条记录` : `${parts.length} record${parts.length === 1 ? "" : "s"}`}</small>}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </summary>
    {open ? <div className="structured-analysis-content" data-analysis-window-start={window.start} data-analysis-window-end={window.end}>
      {parts.slice(window.start, window.end).map(renderPart)}
      <ProcessWindowNavigation window={window} total={parts.length} language={language} onPage={setPage} />
    </div> : null}
  </details>;
}

function StructuredProcessTimeline({
  timeline,
  reasoningParts,
  progressParts,
  markdownParts,
  activities,
  language,
  resourceStates,
  onOpenResource,
  onOpenLink,
  artifactParts,
  inlineArtifactsByMarkdown,
  citationParts,
  inlineCitations,
  onOpenArtifact,
  onOpenArtifactMenu,
  onOpenCitation,
  running,
  renderPart,
}: {
  timeline: StructuredProcessTimelineEntry[] | undefined;
  reasoningParts: Array<Extract<StructuredAssistantPart, { kind: "reasoning" }>>;
  progressParts: Array<Extract<StructuredAssistantPart, { kind: "progress" }>>;
  markdownParts: Array<Extract<StructuredAssistantPart, { kind: "markdown" }>>;
  activities: StructuredActivityEvent[];
  language: "en" | "zh";
  resourceStates?: Readonly<Record<string, "available" | "moved" | "changed" | "deleted" | "offline" | "unsupported">>;
  onOpenResource?: (resourceRef: OaepResourceRef) => void;
  onOpenLink: (href: string | undefined) => void;
  artifactParts: ArtifactPart[];
  inlineArtifactsByMarkdown: Map<string, SelectedInlineArtifactLink[]>;
  citationParts: CitationPart[];
  inlineCitations: InlineCitationLink[];
  onOpenArtifact: (part: ArtifactPart) => void;
  onOpenArtifactMenu?: (part: ArtifactPart, anchor: { x: number; y: number; trigger?: HTMLElement }) => void;
  onOpenCitation: (part: CitationPart) => void;
  running: boolean;
  renderPart: (part: StructuredAssistantPart) => React.JSX.Element | null;
}): React.JSX.Element | null {
  const entries = useMemo(() => buildProcessTimeline(timeline, reasoningParts, progressParts, markdownParts, activities, running), [timeline, reasoningParts, progressParts, markdownParts, activities, running]);
  const { page, setPage, window } = useFollowLatestPage(entries.length, PROCESS_ACTIVITY_WINDOW_SIZE, running);
  if (!entries.length) return null;
  return <div className="structured-process-timeline" aria-label={language === "zh" ? "执行时间线" : "Execution timeline"}>
    <div className="structured-timeline-window" data-timeline-window-start={window.start} data-timeline-window-end={window.end}>
      {entries.slice(window.start, window.end).map((entry) => {
        if (entry.type === "reasoning") return <div key={entry.id} className="structured-timeline-item reasoning"><span className="structured-timeline-marker">💭</span>{renderPart(entry.part)}</div>;
        if (entry.type === "markdown") return <div key={entry.id} className="structured-timeline-item streaming-markdown"><span className="structured-timeline-marker">✎</span><ChatMessageContent content={entry.text} streaming={running} language={language} onOpenLink={onOpenLink} citations={inlineCitations} onOpenCitation={(citationId) => { const citation = citationParts.find((candidate) => candidate.citationId === citationId); if (citation) onOpenCitation(citation); }} artifactLinks={inlineArtifactsByMarkdown.get(entry.partId)} onOpenArtifactLink={(artifactPartId) => { const artifact = artifactParts.find((candidate) => candidate.id === artifactPartId); if (artifact) onOpenArtifact(artifact); }} onOpenArtifactLinkMenu={onOpenArtifactMenu ? (artifactPartId, anchor) => { const artifact = artifactParts.find((candidate) => candidate.id === artifactPartId); if (artifact) onOpenArtifactMenu(artifact, anchor); } : undefined} /></div>;
        if (entry.type === "progress") return <div key={entry.id} className={`structured-timeline-item progress ${entry.part.status}`}><span className="structured-timeline-marker"><ActivityStatusIcon status={entry.part.status} /></span>{renderPart(entry.part)}</div>;
        return <div key={entry.id} className={`structured-timeline-item activity ${entry.activity.status}`}><span className="structured-timeline-marker"><ActivityStatusIcon status={entry.activity.status} /></span><ActivityTimelineItem activity={entry.activity} language={language} resourceStates={resourceStates} onOpenResource={onOpenResource} /></div>;
      })}
      <ProcessWindowNavigation window={window} total={entries.length} language={language} onPage={setPage} />
    </div>
  </div>;
}

type ProcessTimelineEntry =
  | { type: "reasoning"; id: string; sequence: number; part: Extract<StructuredAssistantPart, { kind: "reasoning" }> }
  | { type: "markdown"; id: string; partId: string; sequence: number; text: string; transient: boolean }
  | { type: "progress"; id: string; sequence: number; part: Extract<StructuredAssistantPart, { kind: "progress" }> }
  | { type: "activity"; id: string; sequence: number; activity: StructuredActivityEvent };

function buildProcessTimeline(
  timeline: StructuredProcessTimelineEntry[] | undefined,
  reasoningParts: Array<Extract<StructuredAssistantPart, { kind: "reasoning" }>>,
  progressParts: Array<Extract<StructuredAssistantPart, { kind: "progress" }>>,
  markdownParts: Array<Extract<StructuredAssistantPart, { kind: "markdown" }>>,
  activities: StructuredActivityEvent[],
  running: boolean,
): ProcessTimelineEntry[] {
  // Prefer the authoritative append-ordered timeline when available.
  if (timeline && timeline.length) {
    const activityById = new Map(activities.map((activity) => [activity.id, activity]));
    const reasoningByPartId = new Map(reasoningParts.map((part) => [part.id, part]));
    const progressByPartId = new Map(progressParts.map((part) => [part.id, part]));
    const markdownByPartId = new Map(markdownParts.map((part) => [part.id, part]));
    const result: ProcessTimelineEntry[] = [];
    for (const entry of timeline) {
      if (entry.kind === "reasoning") {
        const part = reasoningByPartId.get(entry.partId);
        if (part) {
          // For timeline display, we show only the segment text from this
          // delta boundary, not the full accumulated reasoning. We create a
          // lightweight wrapper part so renderPart can display it.
          const segmentPart = { ...part, segments: part.segments.filter((seg) => seg.id === entry.segmentId || seg.text.includes(entry.text.slice(0, 50))) };
          if (segmentPart.segments.length === 0) segmentPart.segments = [{ id: entry.segmentId, text: entry.text, status: entry.status }];
          result.push({ type: "reasoning", id: entry.id, sequence: entry.sequence, part: segmentPart });
        }
      } else if (entry.kind === "markdown") {
        // The aggregate markdown part is the source of truth at render time.
        // A hydrated/legacy timeline may have lost its transient flag, so do
        // not let a finalized answer reappear in Process after completion.
        const markdownPart = markdownByPartId.get(entry.partId);
        const isFinalAnswer = markdownPart?.channel === "answer" && markdownPart.final === true;
        // A finalized answer is exclusively owned by Result. Do not render it
        // in Process even during the short part.completed/turn.completed race;
        // otherwise the same text is printed twice.
        if (isFinalAnswer) continue;
        if (entry.transient && !running) continue;
        result.push({ type: "markdown", id: entry.id, partId: entry.partId, sequence: entry.sequence, text: entry.text, transient: entry.transient });
      } else if (entry.kind === "progress") {
        const part = progressByPartId.get(entry.partId);
        if (part) result.push({ type: "progress", id: entry.id, sequence: entry.sequence, part });
      } else if (entry.kind === "activity") {
        const activity = activityById.get(entry.activityId);
        if (activity) result.push({ type: "activity", id: entry.id, sequence: entry.sequence, activity });
      }
    }
    return result;
  }

  // Legacy fallback: reconstruct from aggregate parts when no authoritative
  // timeline exists (e.g. old snapshots). Uses part.sequence for ordering.
  const entries: ProcessTimelineEntry[] = [];
  reasoningParts.forEach((part, index) => {
    const sequence = part.sequence ?? Number.MAX_SAFE_INTEGER - 100000 + index;
    entries.push({ type: "reasoning", id: `reasoning:${part.id}`, sequence, part });
  });
  progressParts.forEach((part, index) => {
    const sequence = part.sequence ?? Number.MAX_SAFE_INTEGER - 50000 + index;
    entries.push({ type: "progress", id: `progress:${part.id}`, sequence, part });
  });
  // Show process-channel markdown in the timeline during fallback.
  markdownParts.filter((part) =>
    part.channel === "process" || (part.channel === undefined && !part.final),
  ).forEach((part, index) => {
    const sequence = part.sequence ?? Number.MAX_SAFE_INTEGER - 80000 + index;
    entries.push({ type: "markdown", id: `markdown:${part.id}`, partId: part.id, sequence, text: part.markdown, transient: false });
  });
  activities.forEach((activity, index) => {
    const sequence = activity.sequence ?? Number.MAX_SAFE_INTEGER - 10000 + index;
    entries.push({ type: "activity", id: `activity:${activity.id}`, sequence, activity });
  });
  return entries.sort((a, b) => a.sequence - b.sequence);
}

const TOOL_OUTPUT_PREVIEW_LIMIT = 600;

function truncateToolPayload(value: unknown, limit = TOOL_OUTPUT_PREVIEW_LIMIT): string {
  if (value === undefined || value === null) return "";
  const display = typeof value === "string" ? value : (() => { try { return JSON.stringify(value, null, 2) } catch { return String(value) } })();
  if (display.length <= limit) return display;
  return display.slice(0, limit) + "…";
}

function formatToolInputSummary(input: unknown, language: "en" | "zh"): string {
  if (input === undefined || input === null) return "";
  if (typeof input === "string") return input.slice(0, 200);
  if (typeof input === "object") {
    try {
      const obj = input as Record<string, unknown>;
      const entries = Object.entries(obj).slice(0, 4);
      return entries.map(([key, val]) => {
        const valStr = typeof val === "string" ? val.slice(0, 80) : (() => { try { return JSON.stringify(val) } catch { return String(val) } })().slice(0, 80);
        return `${key}: ${valStr}`;
      }).join(", ");
    } catch { return String(input).slice(0, 200); }
  }
  return String(input).slice(0, 200);
}

function ActivityTimelineItem({
  activity,
  language,
  resourceStates,
  onOpenResource,
}: {
  activity: StructuredActivityEvent;
  language: "en" | "zh";
  resourceStates?: Readonly<Record<string, "available" | "moved" | "changed" | "deleted" | "offline" | "unsupported">>;
  onOpenResource?: (resourceRef: OaepResourceRef) => void;
}): React.JSX.Element {
  const label = formatActivitySummary(activity, language);
  const [expanded, setExpanded] = useState(false);
  const zh = language === "zh";

  // For file_change activities, keep the original compact rendering
  if (activity.kind === "file_change") {
    return <div className="structured-timeline-activity"><span>{label}</span>{activity.resourceRef && onOpenResource ? <button type="button" onClick={() => onOpenResource(activity.resourceRef!)}>{activity.path}</button> : null}</div>;
  }

  // For tool activities, show enhanced detail with input/output
  if (activity.kind === "tool") {
    const hasInput = activity.input !== undefined && activity.input !== null;
    const hasOutput = activity.output !== undefined && activity.output !== null && activity.output !== "";
    const hasDetail = hasInput || hasOutput;
    const inputPreview = hasInput ? formatToolInputSummary(activity.input, language) : "";
    const outputPreview = hasOutput ? truncateToolPayload(activity.output) : "";
    const showDuration = activity.durationMs !== undefined && (activity.durationMs >= 500 || activity.status === "error");
    const isError = activity.status === "error";

    return <div className={`structured-timeline-activity structured-timeline-tool ${activity.status}`}>
      <div className="structured-tool-header" onClick={hasDetail ? () => setExpanded((v) => !v) : undefined} role={hasDetail ? "button" : undefined} tabIndex={hasDetail ? 0 : undefined}>
        <ActivityStatusIcon status={activity.status} />
        <span className="structured-tool-name">{activity.toolName}</span>
        <span className="structured-tool-label">{label}</span>
        {showDuration && activity.durationMs !== undefined ? <time className="structured-tool-duration">{formatRunDuration(activity.durationMs, language)}</time> : null}
        {hasDetail ? <ChevronDown size={12} className={`structured-tool-chevron ${expanded ? "expanded" : ""}`} aria-hidden="true" /> : null}
      </div>
      {hasDetail && !expanded ? <div className="structured-tool-preview">
        {inputPreview ? <span className="structured-tool-input-preview"><em>{zh ? "输入" : "Input"}:</em> {inputPreview}</span> : null}
        {outputPreview ? <span className="structured-tool-output-preview"><em>{zh ? "输出" : "Output"}:</em> {outputPreview.slice(0, 200)}{outputPreview.length > 200 ? "…" : ""}</span> : null}
      </div> : null}
      {hasDetail && expanded ? <div className="structured-tool-detail">
        {hasInput ? <div className="structured-tool-input">
          <strong>{zh ? "输入参数" : "Input"}</strong>
          <pre>{truncateToolPayload(activity.input, 4000)}</pre>
        </div> : null}
        {hasOutput ? <div className="structured-tool-output">
          <strong>{zh ? "输出结果" : "Output"}</strong>
          <pre>{truncateToolPayload(activity.output, 4000)}</pre>
        </div> : null}
        {isError ? <div className="structured-tool-error">{zh ? "执行出错" : "Execution error"}</div> : null}
      </div> : null}
    </div>;
  }

  // For other activity kinds (model, retry, subtask, log), keep compact rendering
  return <div className="structured-timeline-activity"><span>{label}</span></div>;
}

function AggregatedActivityDetails({
  groups,
  language,
  resourceStates,
  onOpenResource,
  running,
}: {
  groups: ProcessActivityGroup[];
  language: "en" | "zh";
  resourceStates?: Readonly<Record<string, "available" | "moved" | "changed" | "deleted" | "offline" | "unsupported">>;
  onOpenResource?: (resourceRef: OaepResourceRef) => void;
  running: boolean;
}): React.JSX.Element | null {
  const { page, setPage, window } = useFollowLatestPage(groups.length, PROCESS_ACTIVITY_WINDOW_SIZE, running);
  if (!groups.length) return null;
  return <section className="structured-process-section structured-activity-groups" data-activity-group-total={groups.length}>
    <h4>{language === "zh" ? "操作与文件" : "Actions and files"}</h4>
    <div className="structured-activity-window" data-activity-window-start={window.start} data-activity-window-end={window.end}>
      {groups.slice(window.start, window.end).map((group) => <div className={`structured-activity-group ${group.status}`} key={group.id}>
        <ActivityStatusIcon status={group.status} />
        <span style={{ display: "flex", alignItems: "baseline", gap: "5px", minWidth: 0 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.label}</span>
          {group.kind === "tool" && group.toolName ? <small className="structured-activity-tool-name" title={group.toolName}>{group.toolName}</small> : null}
        </span>
        {group.count > 1 ? <small>×{group.count}</small> : null}
        {group.fileResources.length && onOpenResource ? <span className="structured-activity-files structured-activity-resource-links">
          {group.fileResources.slice(0, 3).map(({ name, resourceRef }) => {
            const state = resourceState(resourceRef, resourceStates);
            return <button
              type="button"
              key={`${resourceRef.workspace_id}:${resourceRef.resource_id}`}
              disabled={state === "deleted"}
              data-resource-state={state || "unknown"}
              title={state === "deleted"
                ? (language === "zh" ? `${name} 已删除` : `${name} was deleted`)
                : (language === "zh" ? `在文件中打开 ${name}` : `Open ${name} in Files`)}
              onClick={() => onOpenResource(resourceRef)}
            >{name}{state && state !== "available" ? ` · ${resourceStateLabel(state, language)}` : ""}</button>;
          })}
          {group.fileResources.length > 3 ? <small>{`+${group.fileResources.length - 3}`}</small> : null}
        </span> : group.fileNames.length ? <small className="structured-activity-files">{group.fileNames.slice(0, 3).join("、")}{group.fileNames.length > 3 ? ` +${group.fileNames.length - 3}` : ""}</small> : null}
        {group.durationMs !== undefined && (group.durationMs >= 1000 || group.status === "error") ? <time>{formatRunDuration(group.durationMs, language)}</time> : null}
      </div>)}
    </div>
    <ProcessWindowNavigation window={window} total={groups.length} language={language} onPage={setPage} />
  </section>;
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

function formatRunDuration(durationMs: number, language: "en" | "zh"): string {
  if (durationMs < 1000) return language === "zh" ? "少于 1 秒" : "<1s";
  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}${language === "zh" ? " 秒" : "s"}`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
  // Auto-expand while running, auto-collapse when done. User can still toggle.
  const [open, setOpen] = useState(running);
  const previousRunningRef = useRef(running);
  useEffect(() => {
    const wasRunning = previousRunningRef.current;
    if (running && !wasRunning) setOpen(true);
    else if (!running && wasRunning) setOpen(false);
    previousRunningRef.current = running;
  }, [running]);
  return (
    <details className="structured-reasoning" open={open} onToggle={(event) => setOpen(event.currentTarget.open)} data-segment-count={visibleSegments.length}>
      <summary>
        <span className="structured-reasoning-label">
          {language === "zh" ? "思考" : "Reasoning"}
          {part.summary ? <small>{part.summary}</small> : null}
        </span>
        <ChevronDown size={12} aria-hidden="true" />
      </summary>
      {open ? <div className="chat-reasoning-content">
        {part.summary ? <p className="structured-reasoning-summary">{part.summary}</p> : null}
        {/* plainMarkdown avoids nesting a second "Thinking…" block via think-tag parsing. */}
        {content ? (
          <ChatMessageContent
            content={content}
            plainMarkdown
            streaming={running}
            language={language}
            onOpenLink={onOpenLink}
          />
        ) : null}
      </div> : null}
    </details>
  );
}

function isImageArtifact(part: ArtifactPart): boolean {
  if (part.artifactType === "image") return true;
  if (part.mime?.toLowerCase().startsWith("image/")) return true;
  const name = `${part.name || ""} ${part.path || ""}`.toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg)(?:$|[?#])/i.test(name);
}

const DOCUMENT_ARTIFACT_EXT = /\.(pdf|docx?|pptx?|xlsx?|rtf|od[tsp])$/i;

function artifactBaseName(part: ArtifactPart): string {
  const leaf = (part.name || part.path || "").split(/[\\/]/).pop() || "";
  return leaf.replace(/\.[^.]+$/, "").toLowerCase();
}

/** Agent often ships `foo-预览.png` / `foo-preview.png` next to `foo.pdf` — hide the thumbnail. */
function isCompanionPreviewImage(
  part: ArtifactPart,
  documents: readonly ArtifactPart[],
): boolean {
  if (!isImageArtifact(part) || documents.length === 0) return false;
  const leaf = ((part.name || part.path || "").split(/[\\/]/).pop() || "").toLowerCase();
  if (!/(?:^|[_\-.])(预览|preview|thumb|thumbnail)(?:[_\-.]|\.|$)/i.test(leaf)
    && !/(预览|preview|thumb|thumbnail)\.(png|jpe?g|gif|webp)$/i.test(leaf)) {
    return false;
  }
  const imageStem = leaf
    .replace(/\.(png|jpe?g|gif|webp|bmp|svg)$/i, "")
    .replace(/[-_.]?(预览|preview|thumb|thumbnail)$/i, "")
    .toLowerCase();
  return documents.some((doc) => {
    const docStem = artifactBaseName(doc);
    return Boolean(docStem) && (imageStem === docStem || imageStem.startsWith(`${docStem}-`) || imageStem.startsWith(`${docStem}_`));
  });
}

/** One card per logical file: explicit deliver first, skip same-content copies. */
function selectDeliveryArtifacts(parts: readonly ArtifactPart[]): ArtifactPart[] {
  const selected: ArtifactPart[] = [];
  const seenDigests = new Set<string>();
  const seenSizeKeys = new Set<string>();
  for (const part of parts) {
    if (part.artifactType === "web") continue;
    const digest = part.sha256?.trim();
    if (digest) {
      if (seenDigests.has(digest)) continue;
      seenDigests.add(digest);
      selected.push(part);
      continue;
    }
    // Legacy turns without sha256: collapse deliver-copy + scanned source pairs.
    const extension = (part.name.split(".").pop() || "").toLowerCase();
    const sizeKey = part.size !== undefined ? `${part.size}:${extension}` : "";
    if (sizeKey && seenSizeKeys.has(sizeKey)) continue;
    if (sizeKey) seenSizeKeys.add(sizeKey);
    selected.push(part);
  }
  const documents = selected.filter((part) => DOCUMENT_ARTIFACT_EXT.test(part.name || part.path || ""));
  return selected.filter((part) => !isCompanionPreviewImage(part, documents));
}

function formatArtifactSize(size: number | undefined): string | undefined {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return undefined;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function ArtifactItem({
  part,
  language,
  workspacePath,
  resourceState,
  focused,
  onOpen,
  onOpenMenu,
}: {
  part: ArtifactPart;
  language: "en" | "zh";
  workspacePath?: string;
  resourceState?: "available" | "moved" | "changed" | "deleted" | "offline" | "unsupported";
  focused: boolean;
  onOpen: () => void;
  onOpenMenu?: (anchor: { x: number; y: number }) => void;
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
  const showImage = isImageArtifact(part);
  const [previewSrc, setPreviewSrc] = useState<string | undefined>(
    part.url?.startsWith("data:image/") ? part.url : undefined,
  );

  useEffect(() => {
    if (part.url?.startsWith("data:image/")) {
      setPreviewSrc(part.url);
      return;
    }
    if (!showImage || previewSrc || !workspacePath?.trim() || !part.path?.trim()) return;
    let cancelled = false;
    void desktopApi.previewWorkspaceFile({
      workspacePath,
      path: part.path,
      maxBytes: 1_500_000,
    }).then((preview) => {
      if (!cancelled && preview.kind === "image" && preview.dataUrl?.startsWith("data:image/")) {
        setPreviewSrc(preview.dataUrl);
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [part.path, part.url, previewSrc, showImage, workspacePath]);

  return (
    <div
      className={`structured-artifact-card ${showImage && previewSrc ? "has-preview" : ""} ${focused ? "relation-focus" : ""}`}
      data-structured-part-id={part.id}
      data-artifact-id={part.artifactId}
      data-status={part.status}
      data-resource-state={resourceState}
      onContextMenu={onOpenMenu ? (event) => {
        event.preventDefault();
        event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
        onOpenMenu({ x: event.clientX, y: event.clientY });
      } : undefined}
    >
      {showImage && previewSrc ? (
        <button
          type="button"
          className="structured-artifact-image"
          onClick={onOpen}
          title={part.path || part.url || part.name}
          aria-label={language === "zh" ? `打开图片：${part.name}` : `Open image: ${part.name}`}
          data-testid="structured-artifact-image"
        >
          <img src={previewSrc} alt={part.name} />
        </button>
      ) : null}
      <button
        type="button"
        className="structured-artifact"
        onClick={resourceState === "deleted" ? undefined : onOpen}
        aria-disabled={resourceState === "deleted" ? true : undefined}
        onKeyDown={onOpenMenu ? (event) => {
          if (event.key === "F10" && event.shiftKey) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenMenu({ x: rect.left, y: rect.bottom });
          }
        } : undefined}
        title={part.path || part.url || part.name}
        aria-label={`${language === "zh" ? "打开资源" : "Open resource"}: ${part.name}${resourceState ? ` · ${formatResourceState(resourceState, language)}` : ""}`}
      >
        <Icon size={16} aria-hidden="true" />
        <span>
          <strong><bdi>{part.name}</bdi></strong>
          {part.summary ? <small>{part.summary}</small> : null}
          <small>{[formatArtifactSize(part.size), language === "zh" ? "在文件中显示" : "Show in Files"].filter(Boolean).join(" · ")}</small>
        </span>
        <em>{formatResourceState(resourceState, language) || formatPartStatus(part.status, language)}</em>
        <ArrowUpRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/** The name a reader recognises: the file, not the number the model wrote. */
export function citationFileName(part: CitationPart): string {
  const source = part.documentPath || part.path || part.title;
  const leaf = source.split(/[\\/]/).filter(Boolean).pop();
  return leaf || part.title;
}

function CitationItem({
  part,
  index,
  language,
  resourceState,
  focused,
  onOpen,
  onOpenMenu,
  onBack,
}: {
  part: CitationPart;
  index: number;
  language: "en" | "zh";
  resourceState?: "available" | "moved" | "changed" | "deleted" | "offline" | "unsupported";
  focused: boolean;
  onOpen: () => void;
  onOpenMenu?: (anchor: { x: number; y: number }) => void;
  onBack?: () => void;
}): React.JSX.Element {
  // Checking a claim means reading the passage it rests on. A public URL opens
  // in the browser pane and a Knowledge Base document opens in the source pane
  // at the cited lines. Anything else can still show its passage in place,
  // which answers the same question without the navigation.
  const [showExcerpt, setShowExcerpt] = useState(false);
  const isWeb = Boolean(part.url && /^https?:\/\//i.test(part.url));
  const openable = isWeb || Boolean(part.resourceRef) || Boolean(part.associationId && part.sessionId) || Boolean(part.path) || Boolean(part.knowledgeBaseId && (part.documentPath || part.path));
  const expandable = Boolean(part.excerpt);
  return (
    <div className={`structured-citation ${focused ? "relation-focus" : ""}`} data-structured-part-id={part.id} data-citation-id={part.citationId} data-resource-state={resourceState} onContextMenu={onOpenMenu ? (event) => { event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus(); onOpenMenu({ x: event.clientX, y: event.clientY }); } : undefined}>
      <button
        type="button"
        className="structured-citation-open"
        onClick={resourceState === "deleted" ? undefined : openable ? onOpen : expandable ? () => setShowExcerpt((value) => !value) : undefined}
        aria-disabled={resourceState === "deleted" ? true : undefined}
        onKeyDown={onOpenMenu ? (event) => {
          if (event.key === "F10" && event.shiftKey) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenMenu({ x: rect.left, y: rect.bottom });
          }
        } : undefined}
        disabled={!openable && !expandable}
        aria-expanded={expandable && !openable ? showExcerpt : undefined}
        title={part.url || part.path || part.title}
      >
        <span className="structured-citation-index">[{index}]</span>
        {isWeb ? <Globe2 size={13} aria-hidden="true" /> : <FileText size={13} aria-hidden="true" />}
        <span><bdi>{part.title}</bdi></span>
        {part.locator ? <small>{part.locator}</small> : null}
        {resourceState && resourceState !== "available" ? <small>{formatResourceState(resourceState, language)}</small> : null}
        {openable ? <ArrowUpRight size={12} aria-hidden="true" /> : null}
      </button>
      {expandable && openable ? (
        <button
          type="button"
          className="structured-citation-back"
          onClick={() => setShowExcerpt((value) => !value)}
          aria-expanded={showExcerpt}
          title={language === "zh" ? "查看引用原文" : "Show the cited passage"}
        >
          <Quote size={13} aria-hidden="true" />
        </button>
      ) : null}
      {onBack ? (
        <button type="button" className="structured-citation-back" onClick={onBack} title={language === "zh" ? "返回引用位置" : "Back to citation marker"} aria-label={language === "zh" ? `返回引用 ${citationFileName(part)} 的正文位置` : `Back to where ${citationFileName(part)} is cited in the answer`}>
          <Reply size={13} aria-hidden="true" />
        </button>
      ) : null}
      {showExcerpt && part.excerpt ? (
        <blockquote className="structured-citation-excerpt">
          {part.locator ? <cite>{part.locator}</cite> : null}
          <p>{part.excerpt}</p>
        </blockquote>
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

function formatResourceState(state: "available" | "moved" | "changed" | "deleted" | "offline" | "unsupported" | undefined, language: "en" | "zh"): string {
  if (!state || state === "available") return "";
  const labels = {
    moved: ["已移动", "Moved"],
    changed: ["已变化", "Changed"],
    deleted: ["已删除", "Deleted"],
    offline: ["离线", "Offline"],
    unsupported: ["不支持", "Unsupported"],
  } as const;
  return labels[state][language === "zh" ? 0 : 1];
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
  const [showByokConfiguration, setShowByokConfiguration] = useState(false);
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
    const signInAndContinue = async () => {
      setSavingConfiguration(true);
      setConfigurationError("");
      try {
        const result = await desktopApi.startOidcLogin({ rememberMe: true });
        if (!result.ok || !result.session?.authenticated) throw new Error(result.message || "sign_in_failed");
        setConfigurationSaved(true);
        onRespond(part, { decision: "accept", capabilityAction: "configured" });
      } catch (error) {
        setConfigurationError(zh
          ? `登录未完成：${error instanceof Error ? error.message : String(error)}`
          : `Sign-in did not complete: ${error instanceof Error ? error.message : String(error)}`);
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
      <p>{zh ? "登录 HAI 后可直接使用平台托管网页搜索，无需配置 Tavily Key。也可选择使用自己的 Key。" : "Sign in to HAI to use platform-managed web search without a Tavily key, or use your own key."}</p>
      <p>{zh ? "你也可以稍后在“设置 → 智能体 → 感知执行器”中查看托管状态或管理自己的 Tavily 配置。" : "You can also review managed status or manage your own Tavily configuration later in Settings → Agent → Perception & execution."}</p>
      <p className="capability-configuration-privacy">{zh ? "隐私说明：完成选择之前不会发送本次问题；使用托管搜索时，Key 不会下发到本机。" : "Privacy: this query is not sent before you choose. Managed provider credentials never reach this device."}</p>
      {showByokConfiguration ? <>
        <label>{zh ? "Tavily API Key" : "Tavily API key"}<input data-testid="capability-api-key" type="password" autoComplete="off" value={apiKey} disabled={responded || savingConfiguration} onChange={(event) => setApiKey(event.target.value)} placeholder="tvly-…" /></label>
        <button type="button" className="link-button" onClick={() => onOpenLink?.("https://app.tavily.com/home")}>{zh ? "如何获取 API Key" : "How to get an API key"}<ArrowUpRight size={13} aria-hidden="true" /></button>
      </> : null}
      {configurationError ? <p className="capability-configuration-error" role="alert">{configurationError}</p> : null}
      <div>
        <button type="button" disabled={responded || savingConfiguration} onClick={() => onRespond(part, { decision: "decline", capabilityAction: "answer_without_network" })}>{zh ? "暂不联网，继续回答" : "Continue without web"}</button>
        <button type="button" data-testid="capability-use-byok" disabled={responded || savingConfiguration} onClick={() => setShowByokConfiguration(true)}>{zh ? "使用自己的 Tavily Key" : "Use my Tavily key"}</button>
        {showByokConfiguration ? <button type="button" data-testid="capability-save-and-continue" disabled={responded || savingConfiguration || !apiKey.trim()} onClick={() => void configure()}>{savingConfiguration ? (zh ? "正在验证…" : "Verifying…") : (zh ? "保存并继续" : "Save and continue")}</button> : <button type="button" className="primary" data-testid="capability-sign-in-and-continue" disabled={responded || savingConfiguration} onClick={() => void signInAndContinue()}>{savingConfiguration ? (zh ? "正在登录…" : "Signing in…") : (zh ? "登录并继续" : "Sign in and continue")}</button>}
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
