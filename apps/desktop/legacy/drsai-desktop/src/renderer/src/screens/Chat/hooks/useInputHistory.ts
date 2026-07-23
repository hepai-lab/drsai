import { useCallback, useRef, useState } from "react";

interface UseInputHistoryArgs {
  /** Current draft text — used to save the in-progress draft on first ArrowUp. */
  currentInput: string;
  /** Apply recalled history (or restored draft) text to the textarea. */
  applyText: (text: string) => void;
}

interface UseInputHistoryResult {
  /** Append a freshly-sent message to history; resets the cursor. */
  push: (text: string) => void;
  /** Move backwards through history; returns false if there's nothing to recall. */
  recallPrev: () => boolean;
  /** Move forwards through history; restores the draft past the newest entry. */
  recallNext: () => boolean;
  /** True if the user is currently navigating history (not editing fresh). */
  isNavigating: () => boolean;
  /** Number of entries — used to decide whether ArrowUp should engage. */
  size: () => number;
}

/**
 * Terminal-style command history navigation. State is held in refs so that
 * key presses don't trigger React re-renders for navigation alone — only the
 * applied text change (via `applyText`) re-renders the textarea.
 */
export function useInputHistory({
  currentInput,
  applyText,
}: UseInputHistoryArgs): UseInputHistoryResult {
  const [history, setHistory] = useState<string[]>([]);
  const indexRef = useRef(-1);
  const draftRef = useRef("");

  const push = useCallback((text: string) => {
    setHistory((prev) => [...prev, text]);
    indexRef.current = -1;
    draftRef.current = "";
  }, []);

  const recallPrev = useCallback((): boolean => {
    if (history.length === 0) return false;
    const cur = indexRef.current;
    const next = cur === -1 ? history.length - 1 : Math.max(0, cur - 1);
    if (cur === -1) draftRef.current = currentInput;
    indexRef.current = next;
    applyText(history[next]);
    return true;
  }, [history, currentInput, applyText]);

  const recallNext = useCallback((): boolean => {
    const cur = indexRef.current;
    if (cur === -1) return false;
    if (cur < history.length - 1) {
      indexRef.current = cur + 1;
      applyText(history[cur + 1]);
    } else {
      indexRef.current = -1;
      applyText(draftRef.current);
    }
    return true;
  }, [history, applyText]);

  const isNavigating = useCallback(() => indexRef.current !== -1, []);
  const size = useCallback(() => history.length, [history.length]);

  return { push, recallPrev, recallNext, isNavigating, size };
}
