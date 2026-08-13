export type StreamingVoiceTopPhase = "idle" | "user" | "review" | "repairing" | "repair_review" | "assistant" | "cancelling" | "completed" | "failed";
export type StreamingTaskPhase = "idle" | "starting" | "active" | "ending" | "completed" | "cancelled" | "failed";

export interface StreamingVoiceTurnState {
  turnId: string | null;
  phase: StreamingVoiceTopPhase;
  capture: StreamingTaskPhase;
  asr: StreamingTaskPhase;
  repair: StreamingTaskPhase;
  llm: StreamingTaskPhase;
  tts: StreamingTaskPhase;
  playback: StreamingTaskPhase;
  terminal: "completed" | "cancelled" | "failed" | null;
  error: string | null;
}

export const initialStreamingVoiceTurnState: StreamingVoiceTurnState = {
  turnId: null, phase: "idle", capture: "idle", asr: "idle", repair: "idle", llm: "idle", tts: "idle", playback: "idle", terminal: null, error: null,
};

export type StreamingVoiceTurnEvent =
  | { type: "begin"; turnId: string }
  | { type: "capture_started" }
  | { type: "stop_input" }
  | { type: "asr_completed" }
  | { type: "repair_started" }
  | { type: "repair_completed"; requiresReview: boolean }
  | { type: "repair_skipped" }
  | { type: "review_accepted" }
  | { type: "llm_started" }
  | { type: "llm_completed" }
  | { type: "tts_started" }
  | { type: "tts_completed" }
  | { type: "playback_started" }
  | { type: "playback_completed" }
  | { type: "cancel" }
  | { type: "cancelled" }
  | { type: "fail"; error: string }
  | { type: "reset" };

export function reduceStreamingVoiceTurn(state: StreamingVoiceTurnState, event: StreamingVoiceTurnEvent): StreamingVoiceTurnState {
  if (event.type === "reset") return state.phase === "idle" || state.terminal ? { ...initialStreamingVoiceTurnState } : state;
  if (state.terminal) return state;
  switch (event.type) {
    case "begin": return state.phase === "idle" ? { ...initialStreamingVoiceTurnState, turnId: event.turnId, phase: "user", capture: "starting", asr: "starting" } : state;
    case "capture_started": return state.phase === "user" && state.capture === "starting" ? { ...state, capture: "active", asr: "active" } : state;
    case "stop_input": return state.phase === "user" && state.capture === "active" ? { ...state, capture: "completed", asr: "ending" } : state;
    case "asr_completed": return state.phase === "user" && state.asr === "ending" ? { ...state, phase: "review", asr: "completed" } : state;
    case "repair_started": return state.phase === "review" && state.repair === "idle" ? { ...state, phase: "repairing", repair: "active" } : state;
    case "repair_completed": return state.phase === "repairing" && state.repair === "active" ? { ...state, phase: event.requiresReview ? "repair_review" : "review", repair: "completed" } : state;
    case "repair_skipped": return state.phase === "review" && state.repair === "idle" ? { ...state, repair: "completed" } : state;
    case "review_accepted": return state.phase === "review" || state.phase === "repair_review" ? { ...state, phase: "assistant", llm: "starting" } : state;
    case "llm_started": return state.phase === "assistant" && state.llm === "starting" ? { ...state, llm: "active" } : state;
    case "llm_completed": return state.phase === "assistant" && state.llm === "active" ? { ...state, llm: "completed" } : state;
    case "tts_started": return state.phase === "assistant" && state.llm !== "idle" && state.tts === "idle" ? { ...state, tts: "active" } : state;
    case "tts_completed": return state.phase === "assistant" && state.tts === "active" ? { ...state, tts: "completed" } : state;
    case "playback_started": return state.phase === "assistant" && state.capture === "completed" && state.asr === "completed" && state.playback === "idle" ? { ...state, playback: "active" } : state;
    case "playback_completed": return state.phase === "assistant" && state.playback === "active" ? { ...state, playback: "completed", phase: "completed", terminal: "completed" } : state;
    case "cancel": return state.phase !== "idle" ? { ...state, phase: "cancelling" } : state;
    case "cancelled": return state.phase === "cancelling" ? { ...state, capture: cancelTask(state.capture), asr: cancelTask(state.asr), repair: cancelTask(state.repair), llm: cancelTask(state.llm), tts: cancelTask(state.tts), playback: cancelTask(state.playback), phase: "completed", terminal: "cancelled" } : state;
    case "fail": return { ...state, capture: failActive(state.capture), asr: failActive(state.asr), repair: failActive(state.repair), llm: failActive(state.llm), tts: failActive(state.tts), playback: failActive(state.playback), phase: "failed", terminal: "failed", error: event.error };
  }
}

export function isValidStreamingVoiceTurnState(state: StreamingVoiceTurnState): boolean {
  if (state.playback === "active" && (state.capture !== "completed" || state.asr !== "completed")) return false;
  if (state.phase === "idle" && state.turnId !== null) return false;
  if (state.terminal === "completed" && state.phase !== "completed") return false;
  if (state.terminal === "cancelled" && state.phase !== "completed") return false;
  if (state.terminal === "failed" && state.phase !== "failed") return false;
  return true;
}

export function canSubmitStreamingVoiceTurn(state: StreamingVoiceTurnState): boolean {
  return (state.phase === "review" || state.phase === "repair_review")
    && state.asr === "completed"
    && state.repair !== "active"
    && state.terminal === null;
}

function cancelTask(phase: StreamingTaskPhase): StreamingTaskPhase { return ["starting", "active", "ending"].includes(phase) ? "cancelled" : phase; }
function failActive(phase: StreamingTaskPhase): StreamingTaskPhase { return ["starting", "active", "ending"].includes(phase) ? "failed" : phase; }
