import type {
  ReasoningSegment,
  StructuredActivityEvent,
  StructuredAssistantPart,
  StructuredPartStatus,
  StructuredProcessTimelineEntry,
  SubtaskPart,
} from "../../api/structuredConversation";

export type StructuredReasoningPart = Extract<StructuredAssistantPart, { kind: "reasoning" }>;
export type StructuredProgressPart = Extract<StructuredAssistantPart, { kind: "progress" }>;
export type StructuredMarkdownPart = Extract<StructuredAssistantPart, { kind: "markdown" }>;
export type StructuredSubtaskPart = Extract<StructuredAssistantPart, { kind: "subtask" }>;

/**
 * One row of the "Process" timeline.
 *
 * `reasoning` rows carry a *range* part: a lightweight reasoning part whose
 * segments hold only the text produced at that timeline boundary. Rendering the
 * range (never the whole accumulated segment) is what keeps interleaved
 * reasoning from being printed once per boundary.
 */
export type ProcessTimelineEntry =
  | { type: "reasoning"; id: string; sequence: number; part: StructuredReasoningPart }
  | { type: "markdown"; id: string; partId: string; sequence: number; text: string; transient: boolean }
  | { type: "progress"; id: string; sequence: number; part: StructuredProgressPart }
  | { type: "activity"; id: string; sequence: number; activity: StructuredActivityEvent }
  | { type: "subtask"; id: string; sequence: number; part: SubtaskPart };

/**
 * The text a reasoning block renders. Kept next to the timeline model so the
 * model and `StructuredReasoning` cannot drift apart.
 */
export function visibleReasoningText(part: {
  segments: ReadonlyArray<Pick<ReasoningSegment, "text" | "visibility">>;
}): string {
  return part.segments
    .filter((segment) => !segment.visibility || segment.visibility === "user")
    .map((segment) => segment.text)
    .filter(Boolean)
    .join("\n\n");
}

export interface ReasoningRange {
  /** Text produced between this boundary and the next one. */
  text: string;
  segmentId: string;
  status: StructuredPartStatus;
  visibility?: ReasoningSegment["visibility"];
  /** Only the first range of a part carries the part summary. */
  carriesSummary: boolean;
}

export interface ReasoningRangeReconciliation {
  /** Range keyed by the timeline entry id it belongs to. */
  ranges: Map<string, ReasoningRange>;
  /** Entry ids whose text was folded into another entry of the same part. */
  suppressedEntryIds: Set<string>;
  /** Parts that produced no timeline entry at all (truncated/legacy timeline). */
  orphanParts: StructuredReasoningPart[];
}

/**
 * Align the per-boundary timeline texts with the aggregate segment text.
 *
 * Invariant of both producers (`appendProcessTimelineDelta` and the snapshot
 * projection): concatenating every reasoning entry of a part, in order, equals
 * the part's concatenated segment text. Consuming the timeline therefore must
 * render each entry's own range, not the aggregate.
 *
 * When the two disagree the timeline text wins nothing and loses nothing:
 *  - a missing tail is appended to the last range (partial hydrate / slicing);
 *  - anything else collapses into a single authoritative range so the block is
 *    still rendered exactly once instead of duplicated.
 */
function alignRangesToAggregate(entryTexts: readonly string[], aggregate: string): string[] {
  const covered = entryTexts.join("");
  if (covered === aggregate) return [...entryTexts];
  if (!aggregate && covered) return [...entryTexts];
  if (aggregate.startsWith(covered)) {
    const tail = aggregate.slice(covered.length);
    if (!tail) return [...entryTexts];
    const texts = [...entryTexts];
    texts[texts.length - 1] = `${texts[texts.length - 1]}${tail}`;
    return texts;
  }
  return [aggregate];
}

export function reconcileReasoningRanges(
  timeline: readonly StructuredProcessTimelineEntry[],
  reasoningParts: readonly StructuredReasoningPart[],
): ReasoningRangeReconciliation {
  const entryById = new Map<string, Extract<StructuredProcessTimelineEntry, { kind: "reasoning" }>>();
  const entryIdsByPart = new Map<string, string[]>();
  for (const entry of timeline) {
    if (entry.kind !== "reasoning") continue;
    entryById.set(entry.id, entry);
    const ids = entryIdsByPart.get(entry.partId);
    if (ids) ids.push(entry.id);
    else entryIdsByPart.set(entry.partId, [entry.id]);
  }

  const ranges = new Map<string, ReasoningRange>();
  const suppressedEntryIds = new Set<string>();
  const orphanParts: StructuredReasoningPart[] = [];

  for (const part of reasoningParts) {
    const aggregate = part.segments.map((segment) => segment.text).join("");
    const entryIds = entryIdsByPart.get(part.id) ?? [];
    if (!entryIds.length) {
      // The timeline dropped this part (bounded to the newest 500 entries) or
      // never carried it. Fall back to the aggregate so the text is not lost.
      if (aggregate || part.summary) orphanParts.push(part);
      continue;
    }
    const texts = alignRangesToAggregate(entryIds.map((id) => entryById.get(id)?.text ?? ""), aggregate);
    if (texts.length < entryIds.length) {
      for (let index = texts.length; index < entryIds.length; index += 1) suppressedEntryIds.add(entryIds[index]);
    }
    entryIds.slice(0, texts.length).forEach((entryId, index) => {
      const entry = entryById.get(entryId);
      const segment = part.segments.find((candidate) => candidate.id === entry?.segmentId);
      ranges.set(entryId, {
        text: texts[index],
        segmentId: entry?.segmentId ?? segment?.id ?? `${part.id}:text`,
        status: part.status,
        ...(segment?.visibility ? { visibility: segment.visibility } : {}),
        carriesSummary: index === 0,
      });
    });
  }

  return { ranges, suppressedEntryIds, orphanParts };
}

function buildReasoningEntry(
  id: string,
  sequence: number,
  part: StructuredReasoningPart,
  range: ReasoningRange | undefined,
  fallback: { segmentId: string; text: string; status: StructuredPartStatus },
): ProcessTimelineEntry | null {
  const text = range?.text ?? fallback.text;
  // The part summary belongs to the part, not to every boundary: repeating it
  // per range is exactly the duplication this module exists to remove.
  const summary = range?.carriesSummary ? part.summary : undefined;
  if (!text && !summary) return null;
  const segment: ReasoningSegment = {
    id: range?.segmentId ?? fallback.segmentId,
    text,
    status: range?.status ?? part.status,
    ...(range?.visibility ? { visibility: range.visibility } : {}),
  };
  const rangePart: StructuredReasoningPart = {
    ...part,
    status: range?.status ?? part.status,
    segments: [segment],
  };
  if (!summary) delete rangePart.summary;
  return { type: "reasoning", id, sequence, part: rangePart };
}

export function buildProcessTimeline(
  timeline: StructuredProcessTimelineEntry[] | undefined,
  reasoningParts: StructuredReasoningPart[],
  progressParts: StructuredProgressPart[],
  markdownParts: StructuredMarkdownPart[],
  activities: StructuredActivityEvent[],
  subtaskParts: SubtaskPart[],
  running: boolean,
): ProcessTimelineEntry[] {
  // Prefer the authoritative append-ordered timeline when available.
  if (timeline && timeline.length) {
    const activityById = new Map(activities.map((activity) => [activity.id, activity]));
    const reasoningByPartId = new Map(reasoningParts.map((part) => [part.id, part]));
    const progressByPartId = new Map(progressParts.map((part) => [part.id, part]));
    const markdownByPartId = new Map(markdownParts.map((part) => [part.id, part]));
    const subtaskByPartId = new Map(subtaskParts.map((part) => [part.id, part]));
    // Reasoning entries carry the delta range, while `part.segments` holds the
    // accumulated text. Reconcile them before rendering so each block shows its
    // own range exactly once (see `reconcileReasoningRanges`).
    const { ranges, suppressedEntryIds, orphanParts } = reconcileReasoningRanges(timeline, reasoningParts);
    const result: ProcessTimelineEntry[] = [];
    for (const entry of timeline) {
      if (entry.kind === "reasoning") {
        if (suppressedEntryIds.has(entry.id)) continue;
        const part = reasoningByPartId.get(entry.partId);
        if (!part) continue;
        const rangeEntry = buildReasoningEntry(entry.id, entry.sequence, part, ranges.get(entry.id), {
          segmentId: entry.segmentId,
          text: entry.text,
          status: entry.status,
        });
        if (rangeEntry) result.push(rangeEntry);
      } else if (entry.kind === "markdown") {
        // The aggregate markdown part is the source of truth at render time.
        // A hydrated/legacy timeline may have lost its transient flag, so do
        // not let a finalized answer reappear in Process after completion.
        const markdownPart = markdownByPartId.get(entry.partId);
        const visibleInResult = !running && markdownPart?.channel === "answer" && markdownPart.final === true;
        // Keep the process copy until Result owns the final answer. This avoids
        // a blank frame when part.completed arrives before turn.completed.
        if (visibleInResult) continue;
        if (entry.transient && !running) continue;
        result.push({ type: "markdown", id: entry.id, partId: entry.partId, sequence: entry.sequence, text: entry.text, transient: entry.transient });
      } else if (entry.kind === "progress") {
        const part = progressByPartId.get(entry.partId);
        if (part) result.push({ type: "progress", id: entry.id, sequence: entry.sequence, part });
      } else if (entry.kind === "activity") {
        const activity = activityById.get(entry.activityId);
        if (activity) result.push({ type: "activity", id: entry.id, sequence: entry.sequence, activity });
      } else if (entry.kind === "subtask") {
        const part = subtaskByPartId.get(entry.partId);
        if (part) result.push({ type: "subtask", id: entry.id, sequence: entry.sequence, part });
      }
    }
    for (const part of orphanParts) {
      result.push({
        type: "reasoning",
        id: `reasoning:${part.id}:aggregate`,
        sequence: part.sequence ?? Number.MAX_SAFE_INTEGER - 1000,
        part,
      });
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
