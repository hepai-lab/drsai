/**
 * The React glue around `transcript.ts`.
 *
 * Everything with a decision in it is in that module, tested by
 * `verify-desktop-surface.mts` without React.  What is left here is subscription
 * lifecycle and the re-render signal -- the two things a hook is actually for.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionRunState, SessionStreamPhase } from "../../../api/desktopBridge";
import { bridge, describeFailure } from "./bridge";
import {
  activeRun,
  applySessionEvent,
  buildTranscript,
  createTranscriptState,
  runList,
  type TranscriptEntry,
} from "./transcript";

export type { TranscriptEntry } from "./transcript";

export interface SessionStreamState {
  phase: SessionStreamPhase;
  entries: TranscriptEntry[];
  runs: SessionRunState[];
  /** The run the composer's stop button acts on, or null when nothing is live. */
  activeRun: SessionRunState | null;
  error: string | null;
  fatal: boolean;
  cursor: number;
}

/**
 * Subscribes to one session and keeps a transcript for it.
 *
 * Passing `null` unsubscribes.  Switching conversations must release the previous
 * stream, or a user browsing their history accumulates one live subscription per
 * session they glanced at -- each of which holds a Runtime thread parked in
 * `wait_oaep_events`.
 */
export function useSessionStream(sessionId: string | null): SessionStreamState {
  const state = useRef(createTranscriptState());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    state.current = createTranscriptState();
    setVersion((value) => value + 1);
    if (!sessionId) return undefined;

    const api = bridge();
    const unsubscribe = api.onSessionEvent((event) => {
      // One listener serves every session this window has open, so an event for a
      // session this hook is not showing must be ignored rather than folded.
      if (event.sessionId !== sessionId) return;
      applySessionEvent(state.current, event, describeFailure);
      // Bumped for every event, including phase and error changes: those do not
      // rebuild the transcript but they do change the banner.
      setVersion((value) => value + 1);
    });

    void api.sessions.subscribe({ sessionId });
    return () => {
      unsubscribe();
      void api.sessions.unsubscribe({ sessionId });
    };
  }, [sessionId]);

  // `version` is the change signal. The maps are mutated in place so their
  // identity never changes, and a dependency on them would never re-fire.
  /* eslint-disable react-hooks/exhaustive-deps */
  const entries = useMemo(() => buildTranscript(state.current), [version]);
  const runs = useMemo(() => runList(state.current), [version]);
  const active = useMemo(() => activeRun(state.current), [version]);
  /* eslint-enable react-hooks/exhaustive-deps */

  return {
    phase: state.current.phase,
    entries,
    runs,
    activeRun: active,
    error: state.current.error,
    fatal: state.current.fatal,
    cursor: state.current.cursor,
  };
}
