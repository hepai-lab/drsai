/**
 * The fold: session events in, a renderable transcript out.
 *
 * Pure on purpose.  This is the last hop of the pipeline that starts at
 * `DrSaiAssistant.run_stream()`, it is the subtlest code in the renderer, and it
 * is the piece most likely to be wrong in a way nobody notices -- a conversation
 * that renders *almost* right.  Keeping it free of React means
 * `verify-desktop-surface.mts` can drive it with real event sequences instead of
 * mounting a component tree.  `useSessionStream.ts` is the twenty lines of glue
 * that connect it to a hook.
 *
 * ## Items are the truth; deltas are the animation
 *
 * An OAEP `Item` is authoritative -- it is what a snapshot contains, what a
 * second window sees, and what survives a reload.  A `delta` is a fragment sent
 * so text appears as it is produced.  Deltas may be merged or dropped under
 * backpressure (`BoundedEventDispatcher`), so treating accumulated deltas as the
 * message would render a conversation that quietly loses characters under load.
 *
 * The rule, applied per item:
 *
 * - **running or pending** -- show whichever is longer, the Item's own text or
 *   the accumulated deltas.  Early in a turn the Item exists with empty content
 *   and the deltas are all there is; later the Item catches up and overtakes.
 * - **anything else** -- show the Item and discard the overlay.  A settled turn
 *   has an authoritative body, and a dropped delta must not leave a permanent gap
 *   in it.
 *
 * That one rule is why a burst that drops deltas still renders correctly: the
 * next Item update replaces the whole text rather than appending to it.
 *
 * ## Ordering
 *
 * `Item.sequence` is **run-local**, not session-global -- two runs both start at
 * 1.  Ordering by it alone interleaves turns.  So runs are ordered by the order
 * they were first seen (which is creation order on a dense event stream) and
 * items by sequence within their run.  An item whose run has not been announced
 * yet sorts last rather than being dropped: on a live stream the item can arrive
 * in the same batch as its run, and dropping it would lose a message.
 */

import type {
  BridgeSessionEvent,
  SessionRunState,
  SessionStreamPhase,
} from "../../../api/desktopBridge";
import type { OaepItem } from "../../../api/desktopGateway";

export interface TranscriptEntry {
  item: OaepItem;
  /** The text to paint, after the item/delta reconciliation described above. */
  text: string;
  reasoning: string;
  /** True while this item is still being produced -- drives the caret. */
  streaming: boolean;
}

export interface DeltaOverlay {
  message: string;
  reasoning: string;
  output: string;
}

export interface TranscriptState {
  items: Map<string, OaepItem>;
  runs: Map<string, SessionRunState>;
  overlays: Map<string, DeltaOverlay>;
  runOrder: string[];
  phase: SessionStreamPhase;
  cursor: number;
  error: string | null;
  fatal: boolean;
}

/** Statuses that mean the turn has not finished, for the stop button and caret. */
export const LIVE_RUN_STATUSES: ReadonlySet<string> = new Set(["queued", "running", "waiting"]);

/** Item statuses during which the delta overlay may still be ahead of the Item. */
const LIVE_ITEM_STATUSES: ReadonlySet<string> = new Set(["pending", "running"]);

export function createTranscriptState(): TranscriptState {
  return {
    items: new Map(),
    runs: new Map(),
    overlays: new Map(),
    runOrder: [],
    phase: "idle",
    cursor: 0,
    error: null,
    fatal: false,
  };
}

/**
 * Folds one event into the state, in place.
 *
 * Returns whether the transcript needs rebuilding.  Phase and error changes do
 * not touch the item set, and rebuilding on them would re-render every message
 * each time the stream reconnects.
 *
 * `describeFailure` is injected rather than imported so this module stays free of
 * anything that touches `window`.
 */
export function applySessionEvent(
  state: TranscriptState,
  event: BridgeSessionEvent,
  describeFailure: (failure: { code: string; message: string }) => string,
): boolean {
  switch (event.kind) {
    case "snapshot": {
      // A snapshot is authoritative and replaces everything, including overlays:
      // any delta still accumulating belongs to a projection that no longer
      // exists.
      state.items.clear();
      state.runs.clear();
      state.overlays.clear();
      state.runOrder = [];
      for (const item of event.items) state.items.set(item.id, item);
      for (const run of event.runs) rememberRun(state, run);
      state.cursor = event.cursor;
      return true;
    }
    case "items": {
      for (const item of event.items) {
        state.items.set(item.id, item);
        if (!LIVE_ITEM_STATUSES.has(item.status)) state.overlays.delete(item.id);
      }
      state.cursor = event.cursor;
      return true;
    }
    case "run": {
      rememberRun(state, event.run);
      state.cursor = event.cursor;
      return true;
    }
    case "delta": {
      const overlay = state.overlays.get(event.itemId) ?? { message: "", reasoning: "", output: "" };
      overlay[event.channel] += event.text;
      state.overlays.set(event.itemId, overlay);
      return true;
    }
    case "phase": {
      state.phase = event.phase;
      // Reconnecting is not something the user must act on; clearing here keeps
      // a transient blip from leaving a stale banner on screen forever.
      if (event.phase === "connected") {
        state.error = null;
        state.fatal = false;
      }
      return false;
    }
    case "error": {
      state.error = describeFailure(event.error);
      state.fatal = event.fatal;
      return false;
    }
    default:
      return false;
  }
}

function rememberRun(state: TranscriptState, run: SessionRunState): void {
  if (!state.runs.has(run.runId)) state.runOrder.push(run.runId);
  state.runs.set(run.runId, run);
}

export function buildTranscript(state: TranscriptState): TranscriptEntry[] {
  const rank = new Map(state.runOrder.map((runId, index) => [runId, index]));
  return [...state.items.values()]
    .sort((left, right) => {
      const leftRank = rank.get(left.run_id) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rank.get(right.run_id) ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      if (left.sequence !== right.sequence) return left.sequence - right.sequence;
      // Two items can share a run-local sequence when one is a delta shadow that
      // was materialised before its canonical Item arrived. Ordering by id keeps
      // the transcript stable across rebuilds rather than flickering.
      return left.id.localeCompare(right.id);
    })
    .map((item) => toEntry(state, item));
}

function toEntry(state: TranscriptState, item: OaepItem): TranscriptEntry {
  const overlay = state.overlays.get(item.id);
  const live = LIVE_ITEM_STATUSES.has(item.status);
  const authoritative = itemText(item);
  const streamed =
    item.type === "reasoning"
      ? overlay?.reasoning ?? ""
      : overlay?.message || overlay?.output || "";
  const reasoningAuthoritative = item.type === "reasoning" ? authoritative : "";
  const runStatus = state.runs.get(item.run_id)?.status;
  return {
    item,
    text: live && streamed.length > authoritative.length ? streamed : authoritative,
    reasoning:
      live && (overlay?.reasoning.length ?? 0) > reasoningAuthoritative.length
        ? overlay?.reasoning ?? ""
        : reasoningAuthoritative,
    streaming: live && Boolean(runStatus && LIVE_RUN_STATUSES.has(runStatus)),
  };
}

/**
 * The text an Item carries, across the content shapes OAEP defines.
 *
 * Each branch is one item type's content field: `text` for messages and plans,
 * `segments` for reasoning, `output` for command execution, `summary` for the
 * rest. Returning "" for a type with no text is correct -- `Transcript.tsx`
 * renders those from their structured fields instead.
 */
export function itemText(item: OaepItem): string {
  const content = item.content as Record<string, unknown> | undefined;
  if (!content) return "";
  if (typeof content.text === "string") return content.text;
  if (Array.isArray(content.segments)) {
    return content.segments
      .map((segment) => (segment as { text?: unknown }).text)
      .filter((text): text is string => typeof text === "string")
      .join("");
  }
  if (typeof content.output === "string") return content.output;
  if (typeof content.summary === "string") return content.summary;
  return "";
}

/** The run the stop button acts on: the most recent one that has not settled. */
export function activeRun(state: TranscriptState): SessionRunState | null {
  for (let index = state.runOrder.length - 1; index >= 0; index -= 1) {
    const run = state.runs.get(state.runOrder[index]);
    if (run && LIVE_RUN_STATUSES.has(run.status)) return run;
  }
  return null;
}

export function runList(state: TranscriptState): SessionRunState[] {
  return state.runOrder
    .map((runId) => state.runs.get(runId))
    .filter((run): run is SessionRunState => Boolean(run));
}
