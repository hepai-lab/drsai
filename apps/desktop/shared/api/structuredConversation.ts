import type { OaepResourceRef } from "./oaep.generated";

export const STRUCTURED_CONVERSATION_VERSION = 2 as const;

export type StructuredPartStatus = "pending" | "running" | "completed" | "error" | "cancelled";
export type StructuredTurnStatus = "pending" | "running" | "completed" | "error" | "cancelled";

interface StructuredPartBase {
  id: string;
  status: StructuredPartStatus;
  /** Sequence of the first event that introduced this part. */
  sequence?: number;
}

export interface MarkdownPart extends StructuredPartBase {
  kind: "markdown";
  /** answer is user-facing final output; process is intermediate output. */
  channel?: "process" | "answer";
  /** Set only after the backend/reconciler has sealed the final answer. */
  final?: boolean;
  markdown: string;
  citationIds?: string[];
  resourceRef?: OaepResourceRef;
  associationId?: string;
  sessionId?: string;
}

export interface ReasoningSegment {
  id: string;
  /** Structured event order for stable interleaving with activities. */
  sequence?: number;
  text: string;
  status: StructuredPartStatus;
  source?: string;
  reasoningKind?: "summary" | "commentary" | "analysis";
  visibility?: "user" | "diagnostic" | "hidden";
  startedAt?: string;
  completedAt?: string;
}

export interface ReasoningPart extends StructuredPartBase {
  kind: "reasoning";
  summary?: string;
  segments: ReasoningSegment[];
  durationMs?: number;
}

export interface ProgressPart extends StructuredPartBase {
  kind: "progress";
  summary: string;
  phase?: string;
  completed?: number;
  total?: number;
}

export interface ArtifactPart extends StructuredPartBase {
  kind: "artifact";
  artifactId: string;
  artifactType: "file" | "image" | "table" | "report" | "patch" | "web";
  name: string;
  summary?: string;
  path?: string;
  url?: string;
  mime?: string;
  size?: number;
  sha256?: string;
  previewable?: boolean;
  downloadable?: boolean;
  citationIds?: string[];
  resourceRef?: OaepResourceRef;
  associationId?: string;
  sessionId?: string;
}

export interface CitationPart extends StructuredPartBase {
  kind: "citation";
  citationId: string;
  title: string;
  url?: string;
  path?: string;
  locator?: string;
  excerpt?: string;
  markdownPartId?: string;
  artifactId?: string;
  /**
   * Knowledge base this citation came from, and the document path relative to
   * that base's root. `path` alone cannot be opened: it is relative to a corpus
   * root the renderer does not otherwise know, so resolving it needs the id.
   */
  knowledgeBaseId?: string;
  documentPath?: string;
  /**
   * 1-based line range in the source file, when the locator is line-based.
   * Page and slide locators carry no lines and only get the label.
   */
  lineStart?: number;
  lineEnd?: number;
  resourceRef?: OaepResourceRef;
  associationId?: string;
  sessionId?: string;
}

export interface InteractionOption {
  id: string;
  label: string;
  value?: string;
}

export interface InteractionPart extends StructuredPartBase {
  kind: "interaction";
  requestId: string;
  interactionType: "approval" | "text_input" | "choice" | "confirmation" | "capability_configuration";
  prompt: string;
  options?: InteractionOption[];
  response?: string;
  capability?: string;
  resourceKind?: string;
  preferredAdapter?: string;
  reason?: string;
  queryDisclosed?: boolean;
}

export interface SubtaskPart extends StructuredPartBase {
  kind: "subtask";
  taskId: string;
  title: string;
  agentName?: string;
  summary?: string;
  /** 子代理内部 reasoning segments（折叠展示） */
  reasoningSegments?: ReasoningSegment[];
  /** 子代理内部 tool activities（翻页展示） */
  activities?: StructuredActivityEvent[];
  /** 子代理中间 markdown 输出（折叠展示） */
  markdownSummary?: string;
  /** 子代理内部按首次发生顺序排列的 reasoning / tool / markdown 时间线。 */
  timeline?: StructuredProcessTimelineEntry[];
  /** 子代理状态详情 */
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  /** 子代理层级深度（0=顶层子代理, 1=嵌套子代理） */
  depth?: number;
}

export interface NoticePart extends StructuredPartBase {
  kind: "notice";
  level: "info" | "success" | "warning" | "error";
  message: string;
  actionLabel?: string;
  debugRef?: string;
}

export type StructuredAssistantPart =
  | MarkdownPart
  | ReasoningPart
  | ProgressPart
  | ArtifactPart
  | CitationPart
  | InteractionPart
  | SubtaskPart
  | NoticePart;

interface ActivityEventBase {
  id: string;
  /** First appearance order. Immutable after the activity is created. */
  sequence?: number;
  /** Most recent update order. */
  updatedSequence?: number;
  /** Terminal update order, when available. */
  completedSequence?: number;
  /** Stable child identity when the activity belongs to a subagent. */
  subtaskId?: string;
  /** Present only when this activity is projected from a durable OAEP Item. */
  oaepItemId?: string;
  turnId: string;
  timestamp: string;
  source: string;
  status: StructuredPartStatus;
  title: string;
}

export type StructuredActivityEvent =
  | (ActivityEventBase & {
      kind: "tool";
      toolName: string;
      callId: string;
      operationId?: string;
      correlationId?: string;
      runtimeRunId?: string;
      input?: unknown;
      output?: unknown;
      durationMs?: number;
      /** Terminal metadata when projected from a command_execution item. */
      cwd?: string;
      exitCode?: number | null;
      /** Semantic renderer category assigned by the runtime projection. */
      toolCategory?: "skill" | "todo" | "subagent" | "config" | "schedule" | "search" | "file" | "shell" | "generic";
    })
  | (ActivityEventBase & {
      kind: "model";
      model?: string;
      requestId?: string;
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    })
  | (ActivityEventBase & {
      kind: "retry";
      attempt: number;
      limit: number;
      delayMs?: number;
      errorCode?: string;
    })
  | (ActivityEventBase & {
      kind: "file_change";
      path: string;
      action: "create" | "modify" | "delete" | "rename" | "patch";
      resourceRef?: OaepResourceRef;
      associationId?: string;
      sessionId?: string;
    })
  | (ActivityEventBase & {
      kind: "subtask";
      taskId: string;
      agentName?: string;
    })
  | (ActivityEventBase & {
      kind: "log";
      level: "debug" | "info" | "warning" | "error";
      content: string;
    });

interface StructuredEventBase {
  version: typeof STRUCTURED_CONVERSATION_VERSION;
  turnId: string;
  sequence: number;
  dedupeKey: string;
  timestamp: string;
  source: string;
}

export type StructuredPartDelta =
  | { kind: "markdown.append"; text: string }
  | { kind: "markdown.citations"; citationIds: string[] }
  | { kind: "reasoning.append"; segmentId: string; text: string; source?: string }
  | { kind: "reasoning.summary"; summary: string }
  | { kind: "progress.update"; summary: string; phase?: string; completed?: number; total?: number }
  | { kind: "subtask.update"; summary: string; status?: StructuredPartStatus }
  | { kind: "subtask.reasoning.append"; segmentId: string; text: string; source?: string }
  | { kind: "subtask.markdown.append"; text: string }
  | { kind: "notice.update"; message: string; level?: NoticePart["level"] };

export type StructuredConversationEvent =
  | (StructuredEventBase & { type: "turn.started" })
  | (StructuredEventBase & { type: "turn.waiting"; reason?: string; queuePosition?: number })
  | (StructuredEventBase & { type: "turn.resumed"; reason?: string })
  | (StructuredEventBase & { type: "part.started"; part: StructuredAssistantPart })
  | (StructuredEventBase & { type: "part.delta"; partId: string; delta: StructuredPartDelta })
  | (StructuredEventBase & { type: "part.completed"; part: StructuredAssistantPart })
  | (StructuredEventBase & { type: "activity.updated"; activity: StructuredActivityEvent })
  | (StructuredEventBase & {
      type: "turn.completed";
      meta?: StructuredTurnMeta;
    })
  | (StructuredEventBase & { type: "turn.cancelled" })
  | (StructuredEventBase & { type: "turn.error"; message: string; code?: string; debugRef?: string });

export interface StructuredProtocolIssue {
  code: "invalid_event" | "wrong_turn" | "sequence_gap" | "duplicate_reasoning" | "missing_part" | "invalid_delta";
  message: string;
  sequence?: number;
}

export interface StructuredTurnMeta {
  model?: string;
  durationMs?: number;
  /** Backend identity is presentation metadata only; rendering remains OAEP-part driven. */
  backend?: string;
  workspaceLabel?: string;
  stopReason?: string;
  queuePosition?: number;
  waitingReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | Record<string, unknown>;
}

export type StructuredProcessTimelineEntry =
  | {
      id: string;
      kind: "reasoning";
      sequence: number;
      partId: string;
      segmentId: string;
      text: string;
      status: StructuredPartStatus;
    }
  | {
      id: string;
      kind: "markdown";
      sequence: number;
      partId: string;
      text: string;
      status: StructuredPartStatus;
      /** Live answer text is process feedback only and disappears after terminal completion. */
      transient: boolean;
    }
  | {
      id: string;
      kind: "progress";
      sequence: number;
      partId: string;
      summary: string;
      status: StructuredPartStatus;
      phase?: string;
      completed?: number;
      total?: number;
    }
  | {
      id: string;
      kind: "activity";
      sequence: number;
      activityId: string;
    }
  | {
      id: string;
      kind: "subtask";
      sequence: number;
      partId: string;
      taskId: string;
    };

export interface StructuredTurnState {
  version: typeof STRUCTURED_CONVERSATION_VERSION;
  turnId: string;
  status: StructuredTurnStatus;
  parts: StructuredAssistantPart[];
  activities: StructuredActivityEvent[];
  /** Append-ordered presentation records preserve delta boundaries lost by aggregate parts. */
  processTimeline?: StructuredProcessTimelineEntry[];
  lastSequence: number;
  seenDedupeKeys: string[];
  protocolIssues: StructuredProtocolIssue[];
  /** Terminal state is monotonic; late deltas must not reopen the turn. */
  sealed?: boolean;
  meta?: StructuredTurnMeta;
  error?: { message: string; code?: string; debugRef?: string };
}

export interface LegacyConversationMessage {
  id: string;
  content?: string;
  reasoningContent?: string;
  statusContent?: string;
  streaming?: boolean;
  error?: boolean;
  parts?: Array<Record<string, unknown>>;
  toolTimeline?: Array<Record<string, unknown>>;
}

export function migrateLegacyMessageToStructuredTurn(message: LegacyConversationMessage): StructuredTurnState {
  const turnId = `legacy:${message.id}`;
  const parts: StructuredAssistantPart[] = [];
  const activities: StructuredActivityEvent[] = [];
  const split = splitLegacyThinkContent(message.content ?? "");
  const reasoning = [message.reasoningContent?.trim(), split.reasoning.trim()].filter(Boolean).filter(
    (value, index, values) => values.indexOf(value) === index,
  ).join("\n\n");
  const partStatus: StructuredPartStatus = message.error ? "error" : message.streaming ? "running" : "completed";

  if (reasoning) {
    parts.push({
      id: `${turnId}:reasoning`,
      kind: "reasoning",
      status: partStatus,
      segments: [{ id: "legacy", text: reasoning, status: partStatus, source: "legacy-snapshot" }],
    });
  }
  if (split.text.trim()) {
    parts.push({ id: `${turnId}:markdown`, kind: "markdown", status: partStatus, markdown: split.text });
  }

  for (const legacyPart of message.parts ?? []) {
    const id = readLegacyString(legacyPart.id) || `${turnId}:part:${parts.length + 1}`;
    const status = readLegacyPartStatus(legacyPart.status, partStatus);
    if (legacyPart.type === "file") {
      const path = readLegacyString(legacyPart.path);
      parts.push({
        id,
        kind: "artifact",
        status,
        artifactId: id,
        artifactType: "file",
        name: readLegacyString(legacyPart.name) || path || "File",
        ...(path ? { path } : {}),
        ...(readLegacyString(legacyPart.mime) ? { mime: readLegacyString(legacyPart.mime) } : {}),
      });
    } else if (legacyPart.type === "patch") {
      const path = readLegacyString(legacyPart.path);
      parts.push({
        id,
        kind: "artifact",
        status,
        artifactId: id,
        artifactType: "patch",
        name: path || "Patch",
        summary: readLegacyString(legacyPart.diff).slice(0, 500),
        ...(path ? { path } : {}),
      });
    } else if (legacyPart.type === "approval") {
      parts.push({
        id,
        kind: "interaction",
        status,
        requestId: readLegacyString(legacyPart.requestId) || id,
        interactionType: "approval",
        prompt: readLegacyString(legacyPart.prompt) || "Approval required",
      });
    } else if (legacyPart.type === "error") {
      parts.push({
        id,
        kind: "notice",
        status: "error",
        level: "error",
        message: readLegacyString(legacyPart.message) || "The previous request failed.",
      });
    }
  }

  if (message.error && !parts.some((part) => part.kind === "notice" && part.level === "error")) {
    parts.push({
      id: `${turnId}:notice:error`,
      kind: "notice",
      status: "error",
      level: "error",
      message: split.text.trim() || "The previous request failed.",
    });
  }

  if (message.statusContent?.trim()) {
    activities.push({
      id: `${turnId}:legacy-status`,
      turnId,
      timestamp: new Date(0).toISOString(),
      source: "legacy-snapshot",
      status: partStatus,
      title: "Legacy status",
      kind: "log",
      level: message.error ? "error" : "info",
      content: message.statusContent.trim(),
    });
  }
  for (const [index, legacyTool] of (message.toolTimeline ?? []).entries()) {
    const id = readLegacyString(legacyTool.id) || `${turnId}:tool:${index + 1}`;
    const legacyStatus = readLegacyString(legacyTool.status);
    activities.push({
      id,
      turnId,
      timestamp: readLegacyString(legacyTool.timestamp) || new Date(0).toISOString(),
      source: "legacy-snapshot",
      status: legacyStatus === "failed" ? "error" : legacyStatus === "completed" ? "completed" : "running",
      title: readLegacyString(legacyTool.title) || "Tool activity",
      kind: "tool",
      toolName: readLegacyString(legacyTool.toolName) || readLegacyString(legacyTool.title) || "tool",
      callId: id,
      ...(readLegacyString(legacyTool.content) ? { output: readLegacyString(legacyTool.content) } : {}),
    });
  }

  return {
    version: STRUCTURED_CONVERSATION_VERSION,
    turnId,
    status: message.error ? "error" : message.streaming ? "running" : "completed",
    sealed: !message.streaming,
    parts: dedupeParts(parts).map((part) => part.kind === "markdown"
      ? { ...part, channel: "answer" as const, final: !message.streaming && !message.error }
      : part),
    activities,
    processTimeline: [],
    lastSequence: 0,
    seenDedupeKeys: [],
    protocolIssues: [],
    ...(message.error ? { error: { message: split.text.trim() || "The previous request failed." } } : {}),
  };
}

export function sanitizeStructuredTurnState(raw: unknown): StructuredTurnState | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<StructuredTurnState>;
  if (value.version !== STRUCTURED_CONVERSATION_VERSION || !isNonEmptyString(value.turnId) ||
      !["pending", "running", "completed", "error", "cancelled"].includes(String(value.status))) return null;
  const parts = Array.isArray(value.parts)
    ? value.parts.slice(0, 64).filter(isStructuredAssistantPart).map(sanitizeStructuredPart)
    : [];
  const activities = Array.isArray(value.activities)
    ? value.activities.slice(-200).filter(isStructuredActivityEvent).map(sanitizeStructuredActivity)
    : [];
  const processTimeline = Array.isArray(value.processTimeline)
    ? value.processTimeline.slice(-500).flatMap(sanitizeProcessTimelineEntry)
    : [];
  const lastSequence = Number.isSafeInteger(value.lastSequence) && Number(value.lastSequence) >= 0
    ? Number(value.lastSequence)
    : 0;
  const seenDedupeKeys = Array.isArray(value.seenDedupeKeys)
    ? value.seenDedupeKeys.filter(isNonEmptyString).slice(-500).map((key) => key.slice(0, 300))
    : [];
  const protocolIssues = Array.isArray(value.protocolIssues)
    ? value.protocolIssues.slice(-50).flatMap((issue): StructuredProtocolIssue[] => {
        if (!issue || typeof issue !== "object") return [];
        const candidate = issue as StructuredProtocolIssue;
        const codes: StructuredProtocolIssue["code"][] = [
          "invalid_event", "wrong_turn", "sequence_gap", "duplicate_reasoning", "missing_part", "invalid_delta",
        ];
        if (!codes.includes(candidate.code) || typeof candidate.message !== "string") return [];
        return [{
          code: candidate.code,
          message: candidate.message.slice(0, 2_000),
          ...(Number.isSafeInteger(candidate.sequence) ? { sequence: candidate.sequence } : {}),
        }];
      })
    : [];
  return {
    version: STRUCTURED_CONVERSATION_VERSION,
    turnId: value.turnId.slice(0, 200),
    status: value.status as StructuredTurnStatus,
    parts,
    activities,
    processTimeline,
    lastSequence,
    seenDedupeKeys,
    protocolIssues,
    ...(value.sealed === true ? { sealed: true } : {}),
    ...(value.meta ? { meta: sanitizeStructuredMeta(value.meta) } : {}),
    ...(value.error && typeof value.error.message === "string"
      ? {
          error: {
            message: value.error.message.slice(0, 80_000),
            ...(typeof value.error.code === "string" ? { code: value.error.code.slice(0, 160) } : {}),
            ...(typeof value.error.debugRef === "string" ? { debugRef: value.error.debugRef.slice(0, 300) } : {}),
          },
        }
      : {}),
  };
}

export function createStructuredTurnState(turnId: string): StructuredTurnState {
  return {
    version: STRUCTURED_CONVERSATION_VERSION,
    turnId,
    status: "pending",
    parts: [],
    activities: [],
    processTimeline: [],
    lastSequence: 0,
    seenDedupeKeys: [],
    protocolIssues: [],
    sealed: false,
  };
}

export function settleInterruptedStructuredTurn(
  state: StructuredTurnState,
  message: string,
): StructuredTurnState {
  if (state.status !== "pending" && state.status !== "running") return state;
  const noticeId = `${state.turnId}:recovery-notice`;
  const notice: NoticePart = {
    id: noticeId,
    kind: "notice",
    status: "completed",
    level: "warning",
    message: message.slice(0, 2_000),
    debugRef: `recovery:${state.turnId}`,
  };
  return {
    ...state,
    status: "cancelled",
    parts: [
      ...state.parts.map((part) => part.status === "pending" || part.status === "running"
        ? { ...part, status: "cancelled" as const }
        : part),
      ...(state.parts.some((part) => part.id === noticeId) ? [] : [notice]),
    ],
  };
}

export function applyStructuredConversationEvent(
  state: StructuredTurnState,
  event: StructuredConversationEvent,
): StructuredTurnState {
  const validationIssue = validateStructuredConversationEvent(event);
  if (validationIssue) return appendIssue(state, validationIssue);
  if (event.turnId !== state.turnId) {
    return appendIssue(state, {
      code: "wrong_turn",
      message: `Event for turn ${event.turnId} cannot update ${state.turnId}.`,
      sequence: event.sequence,
    });
  }
  if (state.sealed) return state;
  if (state.seenDedupeKeys.includes(event.dedupeKey) || event.sequence <= state.lastSequence) return state;

  let next: StructuredTurnState = {
    ...state,
    lastSequence: event.sequence,
    seenDedupeKeys: [...state.seenDedupeKeys, event.dedupeKey].slice(-500),
  };
  if (event.sequence > state.lastSequence + 1) {
    next = appendIssue(next, {
      code: "sequence_gap",
      message: `Expected sequence ${state.lastSequence + 1}, received ${event.sequence}.`,
      sequence: event.sequence,
    });
  }

  switch (event.type) {
    case "turn.started":
      return { ...next, status: "running", meta: { ...next.meta, backend: event.source } };
    case "turn.waiting":
      return { ...next, status: "pending", meta: { ...next.meta,
        ...(event.reason ? { waitingReason: event.reason } : {}),
        ...(event.queuePosition !== undefined ? { queuePosition: event.queuePosition } : {}) } };
    case "turn.resumed":
      return { ...next, status: "running", meta: { ...next.meta, queuePosition: undefined, waitingReason: undefined } };
    case "part.started":
      return startPartWithRelatedActivities(next, event.part, event.sequence);
    case "part.delta":
      return applyPartDelta(next, event.partId, event.delta, event.sequence);
    case "part.completed":
      return completePart(next, event.part, event.sequence);
    case "activity.updated": {
      const activity = event.activity;
      const previous = next.activities.find((item) => item.id === activity.id);
      const startedSequence = previous?.sequence ?? activity.sequence ?? event.sequence;
      const terminal = activity.status === "completed" || activity.status === "error" || activity.status === "cancelled";
      const updatedActivity: StructuredActivityEvent = {
        ...previous,
        ...activity,
        sequence: startedSequence,
        updatedSequence: event.sequence,
        ...(terminal ? { completedSequence: event.sequence } : {}),
      } as StructuredActivityEvent;
      let updatedParts = next.parts;
      if (activity.subtaskId) {
        updatedParts = next.parts.map((part) => {
          if (part.kind !== "subtask" || part.taskId !== activity.subtaskId) return part;
          const previousChild = part.activities?.find((item) => item.id === activity.id);
          const childActivity = { ...previousChild, ...updatedActivity, sequence: previousChild?.sequence ?? startedSequence } as StructuredActivityEvent;
          return {
            ...part,
            activities: upsertById(part.activities ?? [], childActivity),
            timeline: upsertProcessTimelineActivity(part.timeline ?? [], activity.id, childActivity.sequence ?? event.sequence),
          };
        });
      }
      const processTimeline = activity.subtaskId
        ? (next.processTimeline ?? [])
        : upsertProcessTimelineActivity(next.processTimeline ?? [], activity.id, startedSequence);
      return {
        ...next,
        activities: upsertById(next.activities, updatedActivity),
        parts: updatedParts,
        processTimeline,
      };
    }
    case "turn.completed":
      return {
        ...next,
        status: "completed",
        sealed: true,
        // A finished turn must not leave parts "running". The reasoning
        // disclosure derives its open/close transition from the part status, so
        // an unterminated part would stay expanded forever after the turn ends.
        parts: sealOpenParts(finalizeOpenSubtaskActivities(next.parts)),
        // A tool that never reported a terminal state cannot be forged into
        // "completed" either: the run ended, so its result is simply unconfirmed.
        // Reusing "cancelled" (rendered as a neutral marker) keeps the activity
        // from spinning forever without claiming success.
        activities: finalizeOpenActivities(next.activities, "cancelled"),
        // Final-answer authority belongs to part.completed / the backend. A
        // terminal turn event must never promote unclassified process text.
        meta: { ...next.meta, ...event.meta },
      };
    case "turn.cancelled":
      return {
        ...next,
        status: "cancelled",
        sealed: true,
        parts: finalizeOpenSubtaskActivities(next.parts.map((part) => part.status === "running" || part.status === "pending"
          ? { ...part, status: "cancelled" }
          : part)),
        activities: finalizeOpenActivities(next.activities, "cancelled"),
      };
    case "turn.error":
      return {
        ...next,
        status: "error",
        sealed: true,
        parts: finalizeOpenSubtaskActivities(next.parts),
        activities: finalizeOpenActivities(next.activities, "error"),
        error: {
          message: event.message,
          ...(event.code ? { code: event.code } : {}),
          ...(event.debugRef ? { debugRef: event.debugRef } : {}),
        },
      };
  }
}

export function validateStructuredConversationEvent(event: unknown): StructuredProtocolIssue | null {
  if (!event || typeof event !== "object") return invalidEvent("Event must be an object.");
  const value = event as Record<string, unknown>;
  if (value.version !== STRUCTURED_CONVERSATION_VERSION) return invalidEvent("Unsupported event version.");
  if (!isNonEmptyString(value.turnId) || !isNonEmptyString(value.dedupeKey) ||
      !isNonEmptyString(value.timestamp) || !isNonEmptyString(value.source)) {
    return invalidEvent("Event identity fields must be non-empty strings.");
  }
  if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) <= 0) {
    return invalidEvent("Event sequence must be a positive integer.");
  }
  const supportedTypes = new Set([
    "turn.started", "turn.waiting", "turn.resumed", "part.started", "part.delta", "part.completed",
    "activity.updated", "turn.completed", "turn.cancelled", "turn.error",
  ]);
  if (!supportedTypes.has(String(value.type))) return invalidEvent("Unsupported event type.");
  if ((value.type === "part.started" || value.type === "part.completed") && !isStructuredAssistantPart(value.part)) {
    return invalidEvent("Event contains an invalid assistant part.");
  }
  if (value.type === "part.delta" && (!isNonEmptyString(value.partId) || !isStructuredPartDelta(value.delta))) {
    return invalidEvent("Event contains an invalid part delta.");
  }
  if (value.type === "activity.updated" && !isStructuredActivityEvent(value.activity)) {
    return invalidEvent("Event contains an invalid activity.");
  }
  return null;
}

export function isStructuredAssistantPart(part: unknown): part is StructuredAssistantPart {
  if (!part || typeof part !== "object") return false;
  const value = part as Record<string, unknown>;
  if (!isNonEmptyString(value.id) || !isPartStatus(value.status)) return false;
  switch (value.kind) {
    case "markdown": return typeof value.markdown === "string";
    case "reasoning": return Array.isArray(value.segments) && value.segments.every(isReasoningSegment);
    case "progress": return typeof value.summary === "string";
    case "artifact": return isNonEmptyString(value.artifactId) && isNonEmptyString(value.name) &&
      ["file", "image", "table", "report", "patch", "web"].includes(String(value.artifactType));
    case "citation": return isNonEmptyString(value.citationId) && isNonEmptyString(value.title);
    case "interaction": return isNonEmptyString(value.requestId) && isNonEmptyString(value.prompt) &&
      ["approval", "text_input", "choice", "confirmation"].includes(String(value.interactionType));
    case "subtask": return isNonEmptyString(value.taskId) && isNonEmptyString(value.title);
    case "notice": return typeof value.message === "string" &&
      ["info", "success", "warning", "error"].includes(String(value.level));
    default: return false;
  }
}

function sealOpenParts(parts: StructuredAssistantPart[]): StructuredAssistantPart[] {
  return parts.map((part) => {
    // Interaction and notice parts carry their own lifecycle (an unanswered
    // approval must stay actionable) and never drive the process disclosure.
    if (part.kind === "interaction" || part.kind === "notice") return part;
    if (part.status !== "running" && part.status !== "pending") return part;
    // Mirror the local completion path: a markdown part that is still open when
    // the turn ends is the final answer, otherwise the result pane (which only
    // renders `final` answer markdown) would show nothing at all.
    return {
      ...part,
      status: "completed",
      ...(part.kind === "markdown" ? { final: true } : {}),
    } as StructuredAssistantPart;
  });
}

/**
 * Close activities that never reported a terminal state. `status` is never
 * "completed": an activity whose result did not arrive is unconfirmed, not
 * successful — the caller decides between "cancelled" (turn ended) and
 * "error" (turn failed).
 */
function finalizeOpenActivities(
  activities: StructuredActivityEvent[],
  status: StructuredPartStatus,
): StructuredActivityEvent[] {
  return activities.map((activity) =>
    activity.status === "running" || activity.status === "pending" ? { ...activity, status } : activity);
}

/** Same closure for the child activities nested inside subtask parts. */
function finalizeOpenSubtaskActivities(parts: StructuredAssistantPart[]): StructuredAssistantPart[] {
  return parts.map((part) => {
    if (part.kind !== "subtask" || !part.activities?.length) return part;
    return { ...part, activities: finalizeOpenActivities(part.activities, part.status === "error" ? "error" : "cancelled") };
  });
}

function isTerminalPartStatus(status: StructuredPartStatus): boolean {
  return status === "completed" || status === "error" || status === "cancelled";
}

function startPart(state: StructuredTurnState, part: StructuredAssistantPart, sequence: number): StructuredTurnState {
  const existing = state.parts.find((item) => item.id === part.id);
  // Terminal states are monotonic. A late duplicate `part.started` (or a stale
  // "running" replay from a snapshot) must not reopen a part that already
  // finished, otherwise a collapsed reasoning disclosure pops back open.
  if (existing && isTerminalPartStatus(existing.status) && (part.status === "running" || part.status === "pending")) {
    return state;
  }
  return { ...state, parts: upsertById(state.parts, { ...existing, ...part, sequence: existing?.sequence ?? part.sequence ?? sequence } as StructuredAssistantPart) };
}

function startPartWithRelatedActivities(state: StructuredTurnState, part: StructuredAssistantPart, sequence: number): StructuredTurnState {
  const next = startPart(state, part, sequence);
  if (part.kind !== "subtask") return next;
  const related = next.activities.filter((activity) => activity.subtaskId === part.taskId);
  const processTimeline = upsertProcessTimelineSubtask(next.processTimeline ?? [], part.id, part.taskId, part.sequence ?? sequence);
  return {
    ...next,
    processTimeline,
    parts: next.parts.map((item) => item.kind === "subtask" && item.id === part.id
      ? {
          ...item,
          ...(related.length ? { activities: related } : {}),
          timeline: related.reduce(
            (timeline, activity) => upsertProcessTimelineActivity(timeline, activity.id, activity.sequence ?? sequence),
            item.timeline ?? [],
          ),
        }
      : item),
  };
}

function completePart(state: StructuredTurnState, part: StructuredAssistantPart, _sequence: number): StructuredTurnState {
  const existing = state.parts.find((item) => item.id === part.id);
  const status = part.status === "pending" || part.status === "running" ? "completed" : part.status;
  if (!existing || existing.kind !== part.kind) {
    return { ...state, parts: upsertById(state.parts, { ...part, status, sequence: part.sequence ?? _sequence }) };
  }
  if (existing.kind === "subtask" && part.kind === "subtask") {
    const merged: SubtaskPart = {
      ...existing,
      ...part,
      status,
      reasoningSegments: part.reasoningSegments ?? existing.reasoningSegments,
      activities: part.activities ?? existing.activities,
      markdownSummary: part.markdownSummary ?? existing.markdownSummary,
      timeline: part.timeline ?? existing.timeline,
      sequence: existing.sequence ?? part.sequence ?? _sequence,
    };
    return { ...state, parts: upsertById(state.parts, merged) };
  }
  const merged = { ...existing, ...part, status, sequence: existing.sequence ?? part.sequence ?? _sequence } as StructuredAssistantPart;
  return { ...state, parts: upsertById(state.parts, merged) };
}

function applyPartDelta(
  state: StructuredTurnState,
  partId: string,
  delta: StructuredPartDelta,
  sequence: number,
): StructuredTurnState {
  const partIndex = state.parts.findIndex((part) => part.id === partId);
  if (partIndex === -1) {
    return appendIssue(state, { code: "missing_part", message: `Part ${partId} was not started.`, sequence });
  }
  const part = state.parts[partIndex];
  const updated = updatePartWithDelta(part, delta, sequence);
  if (!updated) {
    return appendIssue(state, {
      code: "invalid_delta",
      message: `Delta ${delta.kind} cannot update ${part.kind}.`,
      sequence,
    });
  }
  const updatedWithTimeline = updated.kind === "subtask"
    ? { ...updated, timeline: appendProcessTimelineDelta(updated.timeline ?? [], part, delta, sequence) }
    : updated;
  return {
    ...state,
    parts: state.parts.map((item, index) => index === partIndex ? updatedWithTimeline : item),
    processTimeline: part.kind === "subtask"
      ? (state.processTimeline ?? [])
      : appendProcessTimelineDelta(state.processTimeline ?? [], part, delta, sequence),
  };
}

function appendProcessTimelineDelta(
  timeline: StructuredProcessTimelineEntry[],
  part: StructuredAssistantPart,
  delta: StructuredPartDelta,
  sequence: number,
): StructuredProcessTimelineEntry[] {
  if (part.kind === "reasoning" && delta.kind === "reasoning.append") {
    const covered = reasoningSegmentCoveredLength(part, delta.segmentId);
    const previous = timeline.at(-1);
    if (previous?.kind === "reasoning" && previous.partId === part.id && previous.segmentId === delta.segmentId && previous.text.length < 16_384) {
      // The timeline entry mirrors what the part already holds, so a delta that
      // merely restates it must not be appended a second time here either.
      const merged = appendReasoningDeltaText(previous.text, covered, delta.text);
      if (merged === previous.text) return timeline;
      return [...timeline.slice(0, -1), { ...previous, text: merged }];
    }
    // The timeline invariant is `entries join === part segments join`. Seeding a
    // fresh entry with text the part already holds would break it and make
    // `reconcileReasoningRanges` collapse (or duplicate) the block later.
    const id = `reasoning:${part.id}:${sequence}`;
    return [...timeline, { id, kind: "reasoning", sequence, partId: part.id, segmentId: delta.segmentId, text: appendReasoningDeltaText("", covered, delta.text), status: "running" } as StructuredProcessTimelineEntry].slice(-500);
  }
  if (part.kind === "markdown" && delta.kind === "markdown.append") {
    const transient = (part.channel ?? "process") === "answer";
    const previous = timeline.at(-1);
    if (previous?.kind === "markdown" && previous.partId === part.id && previous.transient === transient && previous.text.length < 16_384) {
      return [...timeline.slice(0, -1), { ...previous, text: `${previous.text}${delta.text}` }];
    }
    const id = `markdown:${part.id}:${sequence}`;
    return [...timeline, { id, kind: "markdown", sequence, partId: part.id, text: delta.text, status: "running", transient } as StructuredProcessTimelineEntry].slice(-500);
  }
  if (part.kind === "progress" && delta.kind === "progress.update") {
    // One progress part === one live card: each update replaces the previous
    // state instead of appending another entry that all resolve to the same
    // latest part (which rendered as N duplicate "latest" cards).
    const existingIndex = timeline.findIndex((entry) => entry.kind === "progress" && entry.partId === part.id);
    const entry = { id: `progress:${part.id}:${sequence}`, kind: "progress", sequence, partId: part.id, summary: delta.summary, status: "running", ...(delta.phase ? { phase: delta.phase } : {}), ...(delta.completed !== undefined ? { completed: delta.completed } : {}), ...(delta.total !== undefined ? { total: delta.total } : {}) } as StructuredProcessTimelineEntry;
    if (existingIndex >= 0) {
      const next = timeline.slice();
      next[existingIndex] = entry;
      return next;
    }
    return [...timeline, entry].slice(-500);
  }
  if (part.kind === "subtask" && delta.kind === "subtask.reasoning.append") {
    const previous = timeline.at(-1);
    if (previous?.kind === "reasoning" && previous.partId === part.id && previous.segmentId === delta.segmentId && previous.text.length < 16_384) {
      return [...timeline.slice(0, -1), { ...previous, text: `${previous.text}${delta.text}` }];
    }
    const entry: StructuredProcessTimelineEntry = { id: `reasoning:${part.id}:${sequence}`, kind: "reasoning", sequence, partId: part.id, segmentId: delta.segmentId, text: delta.text, status: "running" };
    return [...timeline, entry].slice(-500);
  }
  if (part.kind === "subtask" && delta.kind === "subtask.markdown.append") {
    const previous = timeline.at(-1);
    if (previous?.kind === "markdown" && previous.partId === part.id && previous.text.length < 16_384) {
      return [...timeline.slice(0, -1), { ...previous, text: `${previous.text}${delta.text}` }];
    }
    const entry: StructuredProcessTimelineEntry = { id: `markdown:${part.id}:${sequence}`, kind: "markdown", sequence, partId: part.id, text: delta.text, status: "running", transient: false };
    return [...timeline, entry].slice(-500);
  }
  return timeline;
}

function upsertProcessTimelineActivity(
  timeline: StructuredProcessTimelineEntry[],
  activityId: string,
  sequence: number,
): StructuredProcessTimelineEntry[] {
  const id = `activity:${activityId}`;
  const existing = timeline.find((entry) => entry.id === id);
  if (existing) return timeline;
  return [...timeline, { id, kind: "activity", sequence, activityId } as StructuredProcessTimelineEntry].slice(-500);
}

function upsertProcessTimelineSubtask(
  timeline: StructuredProcessTimelineEntry[],
  partId: string,
  taskId: string,
  sequence: number,
): StructuredProcessTimelineEntry[] {
  const id = `subtask:${partId}`;
  if (timeline.some((entry) => entry.id === id)) return timeline;
  const entry: StructuredProcessTimelineEntry = { id, kind: "subtask", sequence, partId, taskId };
  return [...timeline, entry].slice(-500);
}

/**
 * Whether a reasoning push adds nothing the reader has not already seen.
 *
 * `appendReasoningDeltaText` returns the merged text, so it cannot distinguish
 * "pure re-statement" from "merge produced the same string". This makes that
 * distinction explicit for callers that must decide whether to add a segment.
 */
function reasoningPushIsRedundant(shown: string, deltaText: string): boolean {
  if (!shown || !deltaText) return false;
  return shown.endsWith(deltaText);
}

/**
 * Resolve one `reasoning.append` against the text a segment already holds.
 *
 * `reasoning.append` is specified as an incremental chunk, but the producers in
 * this tree are not uniform:
 *
 *  - Codex re-emits `item/reasoning/summaryTextDelta` with the same segment, and
 *    renumbers one summary across `summary-1`/`summary-2` (`native_decoder.py`);
 *  - the OAEP runtime re-attaches the **accumulated** Item payload to forwarded
 *    Journal rows (`journal._hydrate_delta_payloads`), and the Desktop projector
 *    re-derives both the segment id and the delta text from that payload
 *    (`oaepPresentationProjector.presentationDelta`).
 *
 * Concatenating those producers' text verbatim is what makes one thought render
 * two or three times in a row (and, once the process timeline disagrees with the
 * aggregate, makes `reconcileReasoningRanges` collapse the block). A push is
 * therefore interpreted as "advance this segment by its new tail": anything the
 * segment already holds is not printed again, while genuine incremental chunks
 * keep concatenating in order.
 *
 * A push is only treated as re-statement when it overlaps *what the part has
 * already received* (`coveredLength`). A chunk that merely echoes a prefix of its
 * own segment is appended, so intentional repetition ("ha" over "ha") survives.
 */
function appendReasoningDeltaText(segmentText: string, coveredLength: number, deltaText: string): string {
  if (!deltaText) return segmentText;
  // `coveredLength` is how much of the reasoning the part has already received;
  // `segmentText` is the slice we are extending. A non-empty covered length with
  // an empty slice means the whole push is already covered, so nothing is added.
  if (!segmentText) return coveredLength > 0 ? "" : deltaText;
  const covered = segmentText.slice(0, Math.max(0, Math.min(coveredLength, segmentText.length)));
  if (!covered) return `${segmentText}${deltaText}`;
  // Re-statement: the push is already part of what was written.
  if (covered.endsWith(deltaText)) return segmentText;
  // Re-statement plus a new tail: keep only the tail.
  for (let overlap = Math.min(covered.length, deltaText.length); overlap >= 1; overlap -= 1) {
    if (covered.endsWith(deltaText.slice(0, overlap))) {
      return `${segmentText}${deltaText.slice(overlap)}`;
    }
  }
  return `${segmentText}${deltaText}`;
}

/**
 * How many characters of `segmentId` the part has already received in order.
 * Everything before that segment is sealed, later segments have not arrived yet,
 * and all segments that live in one part are re-statements of the same thought.
 */
function reasoningSegmentCoveredLength(
  part: { segments: ReadonlyArray<Pick<ReasoningSegment, "id" | "text">> },
  segmentId: string,
): number {
  const index = part.segments.findIndex((segment) => segment.id === segmentId);
  if (index < 0) return leadingSegmentLength(part);
  return part.segments.slice(0, index + 1).reduce((total, segment) => total + segment.text.length, 0);
}

/**
 * Everything a reasoning part holds up to and including its leading segment.
 * Later segments carry text the reader already saw in the first one, so only the
 * leading segment can claim "this was already shown"; a segment arriving out of
 * order must still be able to add its own content.
 */
function leadingSegmentLength(
  part: { segments: ReadonlyArray<Pick<ReasoningSegment, "id" | "text">> },
): number {
  return part.segments.length ? part.segments[0].text.length : 0;
}

function leadingSegmentText(
  part: { segments: ReadonlyArray<Pick<ReasoningSegment, "id" | "text">> },
): string {
  return part.segments.length ? part.segments[0].text : "";
}

function updatePartWithDelta(part: StructuredAssistantPart, delta: StructuredPartDelta, sequence: number): StructuredAssistantPart | null {
  if (part.kind === "markdown" && delta.kind === "markdown.append") {
    // Missing channel is deliberately process-only. Only an explicitly sealed
    // answer part may enter the Result layer.
    return { ...part, channel: part.channel ?? "process", markdown: `${part.markdown}${delta.text}`, status: "running", final: false };
  }
  if (part.kind === "markdown" && delta.kind === "markdown.citations") {
    return { ...part, citationIds: dedupeStrings([...(part.citationIds ?? []), ...delta.citationIds]) };
  }
  if (part.kind === "reasoning" && delta.kind === "reasoning.append") {
    const index = part.segments.findIndex((segment) => segment.id === delta.segmentId);
    if (index === -1) {
      // A new segment id is not proof of new text: the same summary renumbered
      // into summary-2/summary-3 still describes the same thought. Repeating it
      // would render it once per id, so the segment is only added for the tail it
      // has not shown yet. Keeping a renumbered duplicate row would leave the
      // aggregate reading "AAAAAA" and break the `timeline === aggregate`
      // invariant that `reconcileReasoningRanges` relies on.
      const shown = leadingSegmentText(part);
      if (reasoningPushIsRedundant(shown, delta.text)) return part;
      const text = appendReasoningDeltaText(shown, leadingSegmentLength(part), delta.text);
      return {
        ...part,
        status: "running",
        segments: [...part.segments, {
          id: delta.segmentId,
          sequence,
          text,
          status: "running" as const,
          ...(delta.source ? { source: delta.source } : {}),
        }],
      };
    }
    // A segment is a place-holder, not a stream. Some backends re-number one
    // summary into several segments while others re-send the same one; and a
    // few emit the growing summary rather than the chunk. Appending blindly
    // therefore renders the same thought two or three times, once per push.
    const target = part.segments[index];
    const merged = appendReasoningDeltaText(target.text, reasoningSegmentCoveredLength(part, delta.segmentId), delta.text);
    if (merged === target.text) return part;
    return {
      ...part,
      status: "running",
      segments: part.segments.map((segment, segmentIndex) => segmentIndex === index
        ? { ...segment, text: merged, status: "running" as const }
        : segment),
    };
  }
  if (part.kind === "reasoning" && delta.kind === "reasoning.summary") {
    return { ...part, summary: delta.summary, status: "running" };
  }
  if (part.kind === "progress" && delta.kind === "progress.update") {
    return {
      ...part,
      summary: delta.summary,
      status: "running",
      ...(delta.phase ? { phase: delta.phase } : {}),
      ...(delta.completed !== undefined ? { completed: delta.completed } : {}),
      ...(delta.total !== undefined ? { total: delta.total } : {}),
    };
  }
  if (part.kind === "subtask" && delta.kind === "subtask.update") {
    return { ...part, summary: delta.summary, status: delta.status ?? "running" };
  }
  if (part.kind === "subtask" && delta.kind === "subtask.reasoning.append") {
    const segments = part.reasoningSegments ?? [];
    const index = segments.findIndex((segment) => segment.id === delta.segmentId);
    const updatedSegments = index === -1
      ? [...segments, {
          id: delta.segmentId,
          sequence,
          text: delta.text,
          status: "running" as const,
          ...(delta.source ? { source: delta.source } : {}),
        }]
      : segments.map((segment, segmentIndex) => segmentIndex === index
          ? { ...segment, text: `${segment.text}${delta.text}`, status: "running" as const }
          : segment);
    return { ...part, reasoningSegments: updatedSegments, status: "running" };
  }
  if (part.kind === "subtask" && delta.kind === "subtask.markdown.append") {
    // Child markdown is already normalized by the gateway. Keep it in the
    // child-only field so it can never leak into the parent answer parts.
    return { ...part, markdownSummary: `${part.markdownSummary ?? ""}${delta.text}`, status: "running" };
  }
  if (part.kind === "notice" && delta.kind === "notice.update") {
    return { ...part, message: delta.message, level: delta.level ?? part.level };
  }
  return null;
}

function isStructuredPartDelta(delta: unknown): delta is StructuredPartDelta {
  if (!delta || typeof delta !== "object") return false;
  const value = delta as Record<string, unknown>;
  switch (value.kind) {
    case "markdown.append": return typeof value.text === "string";
    case "markdown.citations": return Array.isArray(value.citationIds) && value.citationIds.every(isNonEmptyString);
    case "reasoning.append": return isNonEmptyString(value.segmentId) && typeof value.text === "string";
    case "reasoning.summary": return typeof value.summary === "string";
    case "progress.update": return typeof value.summary === "string";
    case "subtask.update": return typeof value.summary === "string";
    case "subtask.reasoning.append": return isNonEmptyString(value.segmentId) && typeof value.text === "string";
    case "subtask.markdown.append": return typeof value.text === "string";
    case "notice.update": return typeof value.message === "string";
    default: return false;
  }
}

function isStructuredActivityEvent(activity: unknown): activity is StructuredActivityEvent {
  if (!activity || typeof activity !== "object") return false;
  const value = activity as Record<string, unknown>;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.turnId) || !isNonEmptyString(value.timestamp) ||
      !isNonEmptyString(value.source) || !isNonEmptyString(value.title) || !isPartStatus(value.status)) return false;
  return ["tool", "model", "retry", "file_change", "subtask", "log"].includes(String(value.kind));
}

function isReasoningSegment(segment: unknown): segment is ReasoningSegment {
  if (!segment || typeof segment !== "object") return false;
  const value = segment as Record<string, unknown>;
  return isNonEmptyString(value.id) && typeof value.text === "string" && isPartStatus(value.status)
    && (value.reasoningKind === undefined || ["summary", "commentary", "analysis"].includes(String(value.reasoningKind)))
    && (value.visibility === undefined || ["user", "diagnostic", "hidden"].includes(String(value.visibility)));
}

function isPartStatus(value: unknown): value is StructuredPartStatus {
  return ["pending", "running", "completed", "error", "cancelled"].includes(String(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(isNonEmptyString))];
}

function sanitizeRelationIds(values: string[]): string[] {
  return dedupeStrings(values).slice(0, 100).map((value) => value.slice(0, 200));
}

function upsertById<T extends { id: string }>(items: T[], value: T): T[] {
  const index = items.findIndex((item) => item.id === value.id);
  return index === -1 ? [...items, value] : items.map((item, itemIndex) => itemIndex === index ? value : item);
}

function invalidEvent(message: string): StructuredProtocolIssue {
  return { code: "invalid_event", message };
}

function appendIssue(state: StructuredTurnState, issue: StructuredProtocolIssue): StructuredTurnState {
  return { ...state, protocolIssues: [...state.protocolIssues, issue] };
}

export function splitLegacyThinkContent(content: string): { text: string; reasoning: string } {
  const normalized = content
    .replace(/&lt;think&gt;/gi, "<think>")
    .replace(/&lt;\/think&gt;/gi, "</think>");
  const reasoning: string[] = [];
  let text = normalized.replace(/<think>([\s\S]*?)<\/think>/gi, (_match, thought: string) => {
    if (thought.trim()) reasoning.push(thought);
    return "";
  });
  const openIndex = text.toLowerCase().indexOf("<think>");
  if (openIndex >= 0) {
    const unfinished = text.slice(openIndex + "<think>".length);
    if (unfinished.trim()) reasoning.push(unfinished);
    text = text.slice(0, openIndex);
  }
  return { text, reasoning: reasoning.join("\n\n") };
}

function readLegacyString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readLegacyPartStatus(value: unknown, fallback: StructuredPartStatus): StructuredPartStatus {
  return isPartStatus(value) ? value : fallback;
}

function dedupeParts(parts: StructuredAssistantPart[]): StructuredAssistantPart[] {
  const seen = new Set<string>();
  return parts.filter((part) => {
    if (seen.has(part.id)) return false;
    seen.add(part.id);
    return true;
  });
}

function sanitizeProcessTimelineEntry(entry: unknown): StructuredProcessTimelineEntry[] {
  if (!entry || typeof entry !== "object") return [];
  const value = entry as Record<string, unknown>;
  if (!isNonEmptyString(value.id) || !Number.isSafeInteger(value.sequence) || Number(value.sequence) <= 0 || !isNonEmptyString(value.partId ?? value.activityId)) return [];
  const base = { id: String(value.id).slice(0, 300), sequence: Number(value.sequence) };
  if (value.kind === "reasoning" && isNonEmptyString(value.partId) && isNonEmptyString(value.segmentId) && typeof value.text === "string" && isPartStatus(value.status)) {
    return [{ ...base, kind: "reasoning", partId: value.partId.slice(0, 200), segmentId: value.segmentId.slice(0, 200), text: value.text.slice(0, 16_384), status: value.status }] as StructuredProcessTimelineEntry[];
  }
  if (value.kind === "markdown" && isNonEmptyString(value.partId) && typeof value.text === "string" && isPartStatus(value.status)) {
    return [{ ...base, kind: "markdown", partId: value.partId.slice(0, 200), text: value.text.slice(0, 16_384), status: value.status, transient: value.transient === true }] as StructuredProcessTimelineEntry[];
  }
  if (value.kind === "progress" && isNonEmptyString(value.partId) && typeof value.summary === "string" && isPartStatus(value.status)) {
    return [{ ...base, kind: "progress", partId: value.partId.slice(0, 200), summary: value.summary.slice(0, 10_000), status: value.status, ...(typeof value.phase === "string" ? { phase: value.phase.slice(0, 200) } : {}), ...(Number.isFinite(value.completed) ? { completed: Number(value.completed) } : {}), ...(Number.isFinite(value.total) ? { total: Number(value.total) } : {}) }] as StructuredProcessTimelineEntry[];
  }
  if (value.kind === "activity" && isNonEmptyString(value.activityId)) {
    return [{ ...base, kind: "activity", activityId: value.activityId.slice(0, 200) }] as StructuredProcessTimelineEntry[];
  }
  if (value.kind === "subtask" && isNonEmptyString(value.partId) && isNonEmptyString(value.taskId)) {
    return [{ ...base, kind: "subtask", partId: value.partId.slice(0, 200), taskId: value.taskId.slice(0, 200) }] as StructuredProcessTimelineEntry[];
  }
  return [];
}

function sanitizeStructuredPart(part: StructuredAssistantPart): StructuredAssistantPart {
  const base = { id: part.id.slice(0, 200), status: part.status, ...(Number.isSafeInteger(part.sequence) ? { sequence: part.sequence } : {}) };
  if (part.kind === "markdown") return {
    ...base,
    kind: part.kind,
    ...(part.channel ? { channel: part.channel } : {}),
    ...(part.final ? { final: true } : {}),
    markdown: part.markdown.slice(0, 200_000),
    ...(part.citationIds ? { citationIds: sanitizeRelationIds(part.citationIds) } : {}),
  };
  if (part.kind === "reasoning") {
    return {
      ...base,
      kind: part.kind,
      ...(part.summary ? { summary: part.summary.slice(0, 10_000) } : {}),
      segments: part.segments.slice(0, 32).map((segment) => ({
        id: segment.id.slice(0, 200),
        ...(Number.isSafeInteger(segment.sequence) ? { sequence: segment.sequence } : {}),
        text: segment.text.slice(0, 80_000),
        status: segment.status,
        ...(segment.source ? { source: segment.source.slice(0, 200) } : {}),
        ...(segment.reasoningKind ? { reasoningKind: segment.reasoningKind } : {}),
        ...(segment.visibility ? { visibility: segment.visibility } : {}),
        ...(segment.startedAt ? { startedAt: segment.startedAt.slice(0, 80) } : {}),
        ...(segment.completedAt ? { completedAt: segment.completedAt.slice(0, 80) } : {}),
      })),
      ...(Number.isFinite(part.durationMs) ? { durationMs: part.durationMs } : {}),
    };
  }
  if (part.kind === "progress") {
    return {
      ...base, kind: part.kind, summary: part.summary.slice(0, 10_000),
      ...(part.phase ? { phase: part.phase.slice(0, 200) } : {}),
      ...(Number.isFinite(part.completed) ? { completed: part.completed } : {}),
      ...(Number.isFinite(part.total) ? { total: part.total } : {}),
    };
  }
  if (part.kind === "artifact") {
    return {
      ...base, kind: part.kind, artifactId: part.artifactId.slice(0, 200), artifactType: part.artifactType,
      name: part.name.slice(0, 500),
      ...(part.summary ? { summary: part.summary.slice(0, 10_000) } : {}),
      ...(part.path ? { path: part.path.slice(0, 2_048) } : {}),
      ...(part.url ? { url: part.url.slice(0, 4_096) } : {}),
      ...(part.mime ? { mime: part.mime.slice(0, 160) } : {}),
      ...(Number.isFinite(part.size) ? { size: Math.max(0, Number(part.size)) } : {}),
      ...(part.sha256 ? { sha256: part.sha256.slice(0, 128) } : {}),
      ...(typeof part.previewable === "boolean" ? { previewable: part.previewable } : {}),
      ...(typeof part.downloadable === "boolean" ? { downloadable: part.downloadable } : {}),
      ...(part.citationIds ? { citationIds: sanitizeRelationIds(part.citationIds) } : {}),
    };
  }
  if (part.kind === "citation") {
    return {
      ...base, kind: part.kind, citationId: part.citationId.slice(0, 200), title: part.title.slice(0, 1_000),
      ...(part.url ? { url: part.url.slice(0, 4_096) } : {}),
      ...(part.path ? { path: part.path.slice(0, 2_048) } : {}),
      ...(part.locator ? { locator: part.locator.slice(0, 500) } : {}),
      ...(part.excerpt ? { excerpt: part.excerpt.slice(0, 20_000) } : {}),
      ...(part.markdownPartId ? { markdownPartId: part.markdownPartId.slice(0, 200) } : {}),
      ...(part.artifactId ? { artifactId: part.artifactId.slice(0, 200) } : {}),
    };
  }
  if (part.kind === "interaction") {
    return {
      ...base, kind: part.kind, requestId: part.requestId.slice(0, 200), interactionType: part.interactionType,
      prompt: part.prompt.slice(0, 20_000),
      ...(part.options ? { options: part.options.slice(0, 50).map((option) => ({
        id: option.id.slice(0, 200), label: option.label.slice(0, 1_000),
        ...(option.value ? { value: option.value.slice(0, 10_000) } : {}),
      })) } : {}),
      ...(part.response ? { response: part.response.slice(0, 20_000) } : {}),
    };
  }
  if (part.kind === "subtask") {
    return {
      ...base, kind: part.kind, taskId: part.taskId.slice(0, 200), title: part.title.slice(0, 1_000),
      ...(part.agentName ? { agentName: part.agentName.slice(0, 500) } : {}),
      ...(part.summary ? { summary: part.summary.slice(0, 20_000) } : {}),
      ...(part.reasoningSegments ? { reasoningSegments: part.reasoningSegments.slice(0, 16).map((segment) => ({
        id: segment.id.slice(0, 200),
        ...(Number.isSafeInteger(segment.sequence) ? { sequence: segment.sequence } : {}),
        text: segment.text.slice(0, 40_000),
        status: segment.status,
        ...(segment.source ? { source: segment.source.slice(0, 200) } : {}),
      })) } : {}),
      ...(part.activities ? { activities: part.activities.slice(0, 50).filter(isStructuredActivityEvent) } : {}),
      ...(part.markdownSummary ? { markdownSummary: part.markdownSummary.slice(0, 40_000) } : {}),
      ...(part.timeline ? { timeline: part.timeline.slice(-500).flatMap(sanitizeProcessTimelineEntry) } : {}),
      ...(part.startedAt ? { startedAt: part.startedAt.slice(0, 80) } : {}),
      ...(part.completedAt ? { completedAt: part.completedAt.slice(0, 80) } : {}),
      ...(Number.isFinite(part.durationMs) ? { durationMs: part.durationMs } : {}),
      ...(part.depth !== undefined ? { depth: Math.max(0, Math.min(5, Number(part.depth) || 0)) } : {}),
    };
  }
  return {
    ...base, kind: "notice", level: part.level, message: part.message.slice(0, 20_000),
    ...(part.actionLabel ? { actionLabel: part.actionLabel.slice(0, 500) } : {}),
    ...(part.debugRef ? { debugRef: part.debugRef.slice(0, 300) } : {}),
  };
}

function sanitizeStructuredActivity(activity: StructuredActivityEvent): StructuredActivityEvent {
  const base = {
    id: activity.id.slice(0, 200),
    ...(Number.isSafeInteger(activity.sequence) ? { sequence: activity.sequence } : {}),
    ...(Number.isSafeInteger(activity.updatedSequence) ? { updatedSequence: activity.updatedSequence } : {}),
    ...(Number.isSafeInteger(activity.completedSequence) ? { completedSequence: activity.completedSequence } : {}),
    turnId: activity.turnId.slice(0, 200),
    timestamp: activity.timestamp.slice(0, 80), source: activity.source.slice(0, 200),
    status: activity.status, title: activity.title.slice(0, 1_000),
    ...(activity.subtaskId ? { subtaskId: activity.subtaskId.slice(0, 200) } : {}),
    ...(activity.oaepItemId ? { oaepItemId: activity.oaepItemId.slice(0, 200) } : {}),
  };
  if (activity.kind === "tool") return {
    ...base, kind: activity.kind, toolName: activity.toolName.slice(0, 300), callId: activity.callId.slice(0, 200),
    ...(activity.operationId ? { operationId: activity.operationId.slice(0, 200) } : {}),
    ...(activity.correlationId ? { correlationId: activity.correlationId.slice(0, 200) } : {}),
    ...(activity.runtimeRunId ? { runtimeRunId: activity.runtimeRunId.slice(0, 200) } : {}),
    ...(activity.input !== undefined ? { input: boundStructuredPayload(activity.input) } : {}),
    ...(activity.output !== undefined ? { output: boundStructuredPayload(activity.output) } : {}),
    ...(Number.isFinite(activity.durationMs) ? { durationMs: activity.durationMs } : {}),
    ...(activity.cwd ? { cwd: activity.cwd.slice(0, 2_048) } : {}),
    ...(activity.exitCode !== undefined ? { exitCode: activity.exitCode } : {}),
    ...(activity.toolCategory ? { toolCategory: activity.toolCategory } : {}),
  };
  if (activity.kind === "model") return {
    ...base, kind: activity.kind,
    ...(activity.model ? { model: activity.model.slice(0, 300) } : {}),
    ...(activity.requestId ? { requestId: activity.requestId.slice(0, 200) } : {}),
    ...(activity.usage ? { usage: activity.usage } : {}),
  };
  if (activity.kind === "retry") return {
    ...base, kind: activity.kind, attempt: activity.attempt, limit: activity.limit,
    ...(Number.isFinite(activity.delayMs) ? { delayMs: activity.delayMs } : {}),
    ...(activity.errorCode ? { errorCode: activity.errorCode.slice(0, 160) } : {}),
  };
  if (activity.kind === "file_change") return {
    ...base, kind: activity.kind, path: activity.path.slice(0, 2_048), action: activity.action,
  };
  if (activity.kind === "subtask") return {
    ...base, kind: activity.kind, taskId: activity.taskId.slice(0, 200),
    ...(activity.agentName ? { agentName: activity.agentName.slice(0, 500) } : {}),
  };
  return { ...base, kind: "log", level: activity.level, content: activity.content.slice(0, 80_000) };
}

function sanitizeStructuredMeta(meta: StructuredTurnMeta): StructuredTurnMeta {
  return {
    ...(meta.model ? { model: meta.model.slice(0, 300) } : {}),
    ...(Number.isFinite(meta.durationMs) ? { durationMs: meta.durationMs } : {}),
    ...(meta.backend ? { backend: meta.backend.slice(0, 200) } : {}),
    ...(meta.workspaceLabel ? { workspaceLabel: meta.workspaceLabel.slice(0, 500) } : {}),
    ...(meta.stopReason ? { stopReason: meta.stopReason.slice(0, 200) } : {}),
    ...(meta.usage ? { usage: boundStructuredPayload(meta.usage) as Record<string, unknown> } : {}),
  };
}

function boundStructuredPayload(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= 80_000) return JSON.parse(serialized) as unknown;
    return { truncated: true, preview: serialized.slice(0, 80_000) };
  } catch {
    return { unavailable: true };
  }
}
