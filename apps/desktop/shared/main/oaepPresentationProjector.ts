import {
  STRUCTURED_CONVERSATION_VERSION,
  type StructuredAssistantPart,
  type StructuredConversationEvent,
  type StructuredPartDelta,
  type StructuredTurnMeta,
} from "../api/structuredConversation";
import type { OaepEvent, OaepItem } from "./runtimeClient";
import { projectOaepAssistantItem } from "./threadRuntimeProjection";

/**
 * Per-visible-turn state for the OAEP -> Desktop presentation projection.
 * OAEP Session sequences are not reused because they span multiple Runs;
 * StructuredConversation sequences are deliberately local to one UI turn.
 */
export interface OaepPresentationProjection {
  readonly turnId: string;
  readonly workspaceLabel?: string;
  sequence: number;
  started: boolean;
  terminal: boolean;
  startedAt?: number;
  readonly startedPartIds: Set<string>;
  protocolViolations: number;
  readonly unknownDeltaKinds: Map<string, number>;
}

export function createOaepPresentationProjection(
  turnId: string,
  workspaceLabel?: string,
): OaepPresentationProjection {
  return {
    turnId,
    ...(workspaceLabel ? { workspaceLabel } : {}),
    sequence: 0,
    started: false,
    terminal: false,
    startedPartIds: new Set<string>(),
    protocolViolations: 0,
    unknownDeltaKinds: new Map<string, number>(),
  };
}

export function projectOaepEventForPresentation(
  event: OaepEvent,
  projection: OaepPresentationProjection,
  currentItem?: OaepItem,
): StructuredConversationEvent[] {
  const output: StructuredConversationEvent[] = [];
  const source = event.source.backend || "runtime";
  const base = (suffix: string) => ({
    version: STRUCTURED_CONVERSATION_VERSION,
    turnId: projection.turnId,
    sequence: ++projection.sequence,
    dedupeKey: `${event.dedupe_key}:${suffix}`,
    timestamp: event.timestamp,
    source,
  } as const);
  const ensureStarted = () => {
    if (projection.started || projection.terminal) return;
    projection.started = true;
    projection.startedAt = runTimestamp(event.data.run, "created_at") ?? Date.parse(event.timestamp);
    output.push({ ...base("turn-started"), type: "turn.started" });
  };

  if (["event.run.created", "event.run.started", "event.run.waiting", "event.run.resumed"].includes(event.type)) {
    ensureStarted();
    return output;
  }
  if (["event.run.completed", "event.run.failed", "event.run.cancelled"].includes(event.type)) {
    ensureStarted();
    if (projection.terminal) return output;
    projection.terminal = true;
    if (event.type === "event.run.completed") {
      const meta: StructuredTurnMeta = {
        backend: source,
        ...(projection.workspaceLabel ? { workspaceLabel: projection.workspaceLabel } : {}),
      };
      const durationMs = runDurationMs(event.data.run, projection.startedAt, event.timestamp);
      if (durationMs !== undefined) meta.durationMs = durationMs;
      output.push({ ...base("turn-completed"), type: "turn.completed", meta });
    } else if (event.type === "event.run.cancelled") {
      output.push({ ...base("turn-cancelled"), type: "turn.cancelled" });
    } else {
      const error = event.data.error;
      output.push({
        ...base("turn-error"),
        type: "turn.error",
        message: error?.message || String(event.data.reason || "Runtime Agent Run failed."),
        ...(error?.code ? { code: error.code } : {}),
        debugRef: event.event_id,
      });
    }
    return output;
  }

  const item = isOaepItem(event.data.item) ? event.data.item : currentItem;
  if (!item || (item.type === "message" && item.content.role !== "assistant")) return output;
  ensureStarted();
  const projected = projectOaepAssistantItem(item, projection.turnId, true);

  if (event.type === "event.item.delta") {
    const deltaKind = typeof event.data.delta?.kind === "string" ? event.data.delta.kind : "missing";
    if (!SUPPORTED_DELTA_KINDS.has(deltaKind)) {
      projection.protocolViolations += 1;
      projection.unknownDeltaKinds.set(deltaKind, (projection.unknownDeltaKinds.get(deltaKind) ?? 0) + 1);
      return output;
    }
    for (const part of projected.parts) {
      ensurePartStarted(output, projection, event, source, part, base);
      const delta = presentationDelta(event, item, part);
      if (delta) output.push({ ...base(`part-delta:${part.id}`), type: "part.delta", partId: part.id, delta });
    }
    for (const activity of projected.activities) {
      output.push({ ...base(`activity:${activity.id}`), type: "activity.updated", activity });
    }
    return output;
  }

  const terminalItem = ["event.item.completed", "event.item.failed", "event.item.cancelled"].includes(event.type)
    || ["completed", "failed", "cancelled"].includes(item.status);
  for (const part of projected.parts) {
    projection.startedPartIds.add(part.id);
    output.push({
      ...base(`${terminalItem ? "part-completed" : "part-started"}:${part.id}`),
      type: terminalItem ? "part.completed" : "part.started",
      part,
    } as StructuredConversationEvent);
  }
  for (const activity of projected.activities) {
    output.push({ ...base(`activity:${activity.id}`), type: "activity.updated", activity });
  }
  return output;
}

const SUPPORTED_DELTA_KINDS = new Set([
  "message.text.append",
  "reasoning.text.append",
  "reasoning.segment.added",
  "plan.text.append",
  "command.output.append",
  "tool.output.append",
  "subtask.summary.append",
]);

function ensurePartStarted(
  output: StructuredConversationEvent[],
  projection: OaepPresentationProjection,
  event: OaepEvent,
  source: string,
  part: StructuredAssistantPart,
  base: (suffix: string) => {
    readonly version: typeof STRUCTURED_CONVERSATION_VERSION;
    readonly turnId: string;
    readonly sequence: number;
    readonly dedupeKey: string;
    readonly timestamp: string;
    readonly source: string;
  },
): void {
  if (projection.startedPartIds.has(part.id)) return;
  projection.startedPartIds.add(part.id);
  output.push({
    ...base(`part-started:${part.id}`),
    type: "part.started",
    part: emptyStreamingPart(part, event, source),
  });
}

function emptyStreamingPart(
  part: StructuredAssistantPart,
  _event: OaepEvent,
  _source: string,
): StructuredAssistantPart {
  if (part.kind === "markdown") return { ...part, status: "running", markdown: "" };
  if (part.kind === "reasoning") return { ...part, status: "running", segments: [] };
  if (part.kind === "progress") return { ...part, status: "running", summary: "" };
  if (part.kind === "subtask") return { ...part, status: "running", summary: "" };
  if (part.kind === "notice") return { ...part, status: "running", message: "" };
  return { ...part, status: "running" };
}

function presentationDelta(
  event: OaepEvent,
  item: OaepItem,
  part: StructuredAssistantPart,
): StructuredPartDelta | null {
  const delta = event.data.delta;
  const text = typeof delta?.text === "string" ? delta.text : "";
  if (part.kind === "markdown") return { kind: "markdown.append", text };
  if (part.kind === "reasoning") {
    return {
      kind: "reasoning.append",
      segmentId: String(delta?.segment_id || `${item.id}:text`),
      text,
      source: event.source.backend,
    };
  }
  if (part.kind === "progress") return { kind: "progress.update", summary: part.summary, phase: part.phase };
  if (part.kind === "subtask") return { kind: "subtask.update", summary: part.summary || "", status: part.status };
  if (part.kind === "notice") return { kind: "notice.update", message: part.message, level: part.level };
  return null;
}

function runTimestamp(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>)[key];
  if (typeof raw !== "string") return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function runDurationMs(value: unknown, fallbackStart: number | undefined, fallbackEnd: string): number | undefined {
  const startedAt = runTimestamp(value, "created_at") ?? fallbackStart;
  const completedAt = runTimestamp(value, "completed_at") ?? runTimestamp(value, "updated_at") ?? Date.parse(fallbackEnd);
  if (startedAt === undefined || !Number.isFinite(completedAt) || completedAt <= startedAt) return undefined;
  return completedAt - startedAt;
}

function isOaepItem(value: unknown): value is OaepItem {
  return Boolean(value && typeof value === "object" && "id" in value && "type" in value && "content" in value);
}
