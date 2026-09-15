import type { DesktopDuplexVoiceTerminalState } from "../../../../api/desktopApi";
import type { DuplexVoiceStartupStage } from "./startupTransaction";

export type DuplexSessionPhase = "idle" | "starting" | "active" | "recovering" | "ending" | "failed";
export interface DuplexSessionState {
  phase: DuplexSessionPhase;
  sessionId: string | null;
  startupStage: DuplexVoiceStartupStage | null;
  terminal: DesktopDuplexVoiceTerminalState | null;
  cleanupClaimed: boolean;
  historyFlushClaimed: boolean;
  revision: number;
  invalidTransitions: number;
}

export const initialDuplexSessionState: DuplexSessionState = { phase: "idle", sessionId: null, startupStage: null, terminal: null, cleanupClaimed: false, historyFlushClaimed: false, revision: 0, invalidTransitions: 0 };

export type DuplexSessionEvent =
  | { type: "start_requested"; sessionId: string }
  | { type: "startup_stage"; sessionId: string; stage: DuplexVoiceStartupStage }
  | { type: "started"; sessionId: string }
  | { type: "recovering"; sessionId: string }
  | { type: "end_requested"; sessionId: string }
  | { type: "startup_failed"; sessionId: string }
  | { type: "terminal"; sessionId: string; terminal: DesktopDuplexVoiceTerminalState }
  | { type: "claim_cleanup"; sessionId: string }
  | { type: "claim_history_flush"; sessionId: string }
  | { type: "reset" };

export function reduceDuplexSession(state: DuplexSessionState, event: DuplexSessionEvent): DuplexSessionState {
  if (event.type === "reset") return state.phase === "idle" && state.sessionId === null ? state : { ...initialDuplexSessionState, revision: state.revision + 1 };
  if (event.type === "start_requested") {
    if (!(["idle", "failed"].includes(state.phase)) || (state.phase === "idle" && state.sessionId !== null)) return invalid(state);
    return { phase: "starting", sessionId: event.sessionId, startupStage: "checking_readiness", terminal: null, cleanupClaimed: false, historyFlushClaimed: false, revision: state.revision + 1, invalidTransitions: state.invalidTransitions };
  }
  if (state.sessionId !== event.sessionId) return invalid(state);
  if (event.type === "claim_cleanup") return state.cleanupClaimed ? state : { ...state, cleanupClaimed: true, revision: state.revision + 1 };
  if (event.type === "claim_history_flush") return state.historyFlushClaimed ? state : { ...state, historyFlushClaimed: true, revision: state.revision + 1 };
  if (state.terminal) return state;
  switch (event.type) {
    case "startup_stage": return state.phase === "starting" ? { ...state, startupStage: event.stage, revision: state.revision + 1 } : invalid(state);
    case "started": return state.phase === "starting" ? { ...state, phase: "active", startupStage: null, revision: state.revision + 1 } : invalid(state);
    case "recovering": return ["active", "recovering"].includes(state.phase) ? { ...state, phase: "recovering", revision: state.revision + 1 } : invalid(state);
    case "end_requested": return ["starting", "active", "recovering"].includes(state.phase) ? { ...state, phase: "ending", revision: state.revision + 1 } : invalid(state);
    case "startup_failed": return state.phase === "starting" ? { ...state, phase: "failed", startupStage: null, terminal: "failed", revision: state.revision + 1 } : invalid(state);
    case "terminal": return ["starting", "active", "recovering", "ending"].includes(state.phase) ? { ...state, phase: event.terminal === "failed" ? "failed" : "idle", startupStage: null, terminal: event.terminal, revision: state.revision + 1 } : invalid(state);
  }
}

function invalid(state: DuplexSessionState): DuplexSessionState { return { ...state, invalidTransitions: state.invalidTransitions + 1, revision: state.revision + 1 }; }

export function claimWasGranted(previous: DuplexSessionState, next: DuplexSessionState, claim: "cleanupClaimed" | "historyFlushClaimed"): boolean { return !previous[claim] && next[claim]; }
