import { useEffect, useRef, useState } from "react";

// Minimum spacing between two display releases. The release itself is
// quantized to an animation frame, so this is a floor, not a timer: without it
// a 60 Hz frame loop would re-render the whole Markdown subtree every frame.
export const STREAMING_MARKDOWN_BUDGET_MS = 64;
const TARGET_DRAIN_TICKS = 3;
const MIN_GRAPHEMES_PER_TICK = 4;
// When the backlog exceeds this threshold, skip expensive Intl.Segmenter
// grapheme splitting and fall back to simple substring slicing by character
// count. This prevents O(n) per-tick overhead for large streaming outputs.
const GRAPHEME_SPLIT_THRESHOLD = 512;
// Hard cap on how many characters to advance per tick, even with a huge
// backlog. Prevents rendering too much DOM in a single frame.
const MAX_CHARS_PER_TICK = 4096;

export function splitGraphemes(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(value), (entry) => entry.segment);
  }
  return Array.from(value);
}

export function adaptiveGraphemeBudget(backlog: number): number {
  if (backlog <= 0) return 0;
  return Math.min(backlog, Math.max(MIN_GRAPHEMES_PER_TICK, Math.ceil(backlog / TARGET_DRAIN_TICKS)));
}

export function useStreamingDisplayBuffer(authoritative: string, streaming: boolean): string {
  const [displayed, setDisplayed] = useState(authoritative);
  const displayedRef = useRef(displayed);
  const targetRef = useRef(authoritative);
  const frameRef = useRef<number | null>(null);
  const lastReleaseAtRef = useRef(0);
  displayedRef.current = displayed;
  targetRef.current = authoritative;

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!streaming || reducedMotion || !authoritative.startsWith(displayedRef.current)) {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      displayedRef.current = authoritative;
      setDisplayed(authoritative);
      return undefined;
    }

    function schedule(): void {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(onFrame);
    }

    // Releasing on a frame boundary keeps the state update in the same frame as
    // the paint it produces. A bare timer fired at an arbitrary point in the
    // frame, so the render it triggered often landed after that frame's paint
    // and the user saw a stutter instead of a step.
    function onFrame(): void {
      frameRef.current = null;
      if (
        displayedRef.current !== targetRef.current
        && performance.now() - lastReleaseAtRef.current < STREAMING_MARKDOWN_BUDGET_MS
      ) {
        schedule();
        return;
      }
      lastReleaseAtRef.current = performance.now();
      release();
    }

    function release(): void {
      const current = displayedRef.current;
      const target = targetRef.current;
      if (!target.startsWith(current)) {
        displayedRef.current = target;
        setDisplayed(target);
        return;
      }
      const pendingLength = target.length - current.length;
      if (!pendingLength) return;

      // For small pending content, use precise grapheme splitting for smooth
      // visual streaming. For large pending content (e.g. after a burst of
      // SSE events), skip the expensive Intl.Segmenter and use character-based
      // slicing — the visual difference is negligible at high speed.
      let next: string;
      if (pendingLength <= GRAPHEME_SPLIT_THRESHOLD) {
        const pending = splitGraphemes(target.slice(current.length));
        if (!pending.length) return;
        const budget = adaptiveGraphemeBudget(pending.length);
        next = current + pending.slice(0, budget).join("");
      } else {
        // Character-based fast path for large backlogs
        const budget = Math.min(
          Math.min(pendingLength, Math.max(MIN_GRAPHEMES_PER_TICK, Math.ceil(pendingLength / TARGET_DRAIN_TICKS))),
          MAX_CHARS_PER_TICK,
        );
        next = current + target.slice(current.length, current.length + budget);
      }
      displayedRef.current = next;
      setDisplayed(next);
      if (next !== targetRef.current) schedule();
    }

    if (displayedRef.current === "" && authoritative) {
      lastReleaseAtRef.current = performance.now();
      release();
    } else if (frameRef.current === null && displayedRef.current !== authoritative) {
      schedule();
    }
    return undefined;
  }, [authoritative, streaming]);

  // A stalled tail needs no recovery here: leaving `streaming` snaps the
  // display to the authoritative text, so an occluded window that never ran
  // the frame callback still ends up showing the whole answer.
  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);
  return streaming ? displayed : authoritative;
}
