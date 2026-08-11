import { useEffect, useRef, useState } from "react";

export const STREAMING_MARKDOWN_BUDGET_MS = 64;
const TARGET_DRAIN_TICKS = 3;
const MIN_GRAPHEMES_PER_TICK = 4;

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
  const timerRef = useRef<number | null>(null);
  displayedRef.current = displayed;
  targetRef.current = authoritative;

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!streaming || reducedMotion || !authoritative.startsWith(displayedRef.current)) {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      displayedRef.current = authoritative;
      setDisplayed(authoritative);
      return undefined;
    }

    const release = (): void => {
      timerRef.current = null;
      const current = displayedRef.current;
      const target = targetRef.current;
      if (!target.startsWith(current)) {
        displayedRef.current = target;
        setDisplayed(target);
        return;
      }
      const pending = splitGraphemes(target.slice(current.length));
      if (!pending.length) return;
      const next = current + pending.slice(0, adaptiveGraphemeBudget(pending.length)).join("");
      displayedRef.current = next;
      setDisplayed(next);
      if (next !== targetRef.current) timerRef.current = window.setTimeout(release, STREAMING_MARKDOWN_BUDGET_MS);
    };

    if (displayedRef.current === "" && authoritative) release();
    else if (timerRef.current === null && displayedRef.current !== authoritative) {
      timerRef.current = window.setTimeout(release, STREAMING_MARKDOWN_BUDGET_MS);
    }
    return undefined;
  }, [authoritative, streaming]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);
  return streaming ? displayed : authoritative;
}
