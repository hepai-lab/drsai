export type DuplexTurnPhase = "idle" | "listening" | "user_speaking" | "responding" | "overlapping" | "interrupting" | "stopping" | "completed" | "failed";
export interface DuplexTurnState { phase: DuplexTurnPhase; responseId: string | null; itemId: string | null; contentIndex: number; interruptionReason: "user_speech" | "manual" | "stop_intent" | null; terminal: "completed" | "cancelled" | "failed" | null }
export const initialDuplexTurnState: DuplexTurnState = { phase: "idle", responseId: null, itemId: null, contentIndex: 0, interruptionReason: null, terminal: null };
export type DuplexTurnEvent =
  | { type: "session_ready" } | { type: "speech_started" } | { type: "speech_stopped" }
  | { type: "response_started"; responseId: string } | { type: "response_audio"; responseId: string; itemId: string; contentIndex: number }
  | { type: "interrupt"; reason: "user_speech" | "manual" | "stop_intent" } | { type: "interrupted" }
  | { type: "response_completed"; responseId: string } | { type: "stop" }
  | { type: "terminal"; terminal: "completed" | "cancelled" | "failed" } | { type: "reset" };

export function reduceDuplexTurn(state: DuplexTurnState, event: DuplexTurnEvent): DuplexTurnState {
  if (state.terminal && event.type !== "reset") return state;
  switch (event.type) {
    case "reset": return initialDuplexTurnState;
    case "session_ready": return state.phase === "idle" ? { ...state, phase: "listening" } : state;
    case "speech_started":
      if (state.phase === "listening") return { ...state, phase: "user_speaking" };
      if (state.phase === "responding") return { ...state, phase: "overlapping" };
      return state;
    case "speech_stopped": return state.phase === "user_speaking" ? { ...state, phase: "listening" } : state;
    case "response_started": return ["listening", "user_speaking"].includes(state.phase) ? { ...state, phase: state.phase === "user_speaking" ? "overlapping" : "responding", responseId: event.responseId } : state;
    case "response_audio": return state.responseId === event.responseId && ["responding", "overlapping"].includes(state.phase) ? { ...state, itemId: event.itemId, contentIndex: event.contentIndex } : state;
    case "interrupt": return ["responding", "overlapping"].includes(state.phase) ? { ...state, phase: "interrupting", interruptionReason: event.reason } : state;
    case "interrupted": return state.phase === "interrupting" ? { ...state, phase: "user_speaking", responseId: null, itemId: null, contentIndex: 0 } : state;
    case "response_completed": return state.responseId === event.responseId && ["responding", "overlapping"].includes(state.phase) ? { ...state, phase: "listening", responseId: null, itemId: null, contentIndex: 0 } : state;
    case "stop": return !["idle", "completed", "failed"].includes(state.phase) ? { ...state, phase: "stopping", interruptionReason: "manual" } : state;
    case "terminal": return { ...state, phase: event.terminal === "failed" ? "failed" : "completed", terminal: event.terminal };
  }
}
