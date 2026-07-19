import type { DesktopVoiceErrorCode } from "@shared/desktopApi";

export type VoiceTurnPhase =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "preparing_audio"
  | "transcribing"
  | "reviewing"
  | "ready_to_send"
  | "submitting"
  | "awaiting_response"
  | "response_ready"
  | "synthesizing"
  | "ready_to_play"
  | "playing"
  | "paused"
  | "completed"
  | "cancelling"
  | "failed";

export interface VoiceTurnError {
  stage: VoiceTurnPhase;
  code: DesktopVoiceErrorCode | "permission_denied" | "device_unavailable" | "capture_error" | "chat_error" | "playback_error";
  message: string;
  retryable: boolean;
  requestId?: string;
  runtimeId?: string;
  userAction?: string;
}

export interface VoiceTurnState {
  turnId: string | null;
  phase: VoiceTurnPhase;
  sttRequestId: string | null;
  ttsRequestId: string | null;
  sourceMessageId: string | null;
  responseMessageId: string | null;
  error: VoiceTurnError | null;
}

export type VoiceTurnEvent =
  | { type: "begin_capture"; turnId: string }
  | { type: "permission_granted" }
  | { type: "recording_stopped" }
  | { type: "stt_started"; requestId: string }
  | { type: "stt_completed"; requestId: string }
  | { type: "review_accepted" }
  | { type: "submit_started"; messageId: string }
  | { type: "response_started" }
  | { type: "response_completed"; messageId: string }
  | { type: "tts_started"; requestId: string }
  | { type: "tts_completed"; requestId: string }
  | { type: "play" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "finish" }
  | { type: "cancel" }
  | { type: "cancelled" }
  | { type: "fail"; error: VoiceTurnError }
  | { type: "retry" }
  | { type: "reset" };

export const initialVoiceTurnState: VoiceTurnState = {
  turnId: null,
  phase: "idle",
  sttRequestId: null,
  ttsRequestId: null,
  sourceMessageId: null,
  responseMessageId: null,
  error: null,
};

export function createVoiceTurnId(randomId: () => string = () => crypto.randomUUID()): string {
  return `voice-turn-${randomId()}`;
}

const TRANSITIONS: Readonly<Record<VoiceTurnPhase, readonly VoiceTurnPhase[]>> = {
  idle: ["requesting_permission"],
  requesting_permission: ["recording", "cancelling", "failed"],
  recording: ["preparing_audio", "cancelling", "failed"],
  preparing_audio: ["transcribing", "cancelling", "failed"],
  transcribing: ["reviewing", "cancelling", "failed"],
  reviewing: ["ready_to_send", "transcribing", "cancelling", "failed"],
  ready_to_send: ["submitting", "cancelling", "failed"],
  submitting: ["awaiting_response", "cancelling", "failed"],
  awaiting_response: ["response_ready", "cancelling", "failed"],
  response_ready: ["synthesizing", "completed", "cancelling", "failed"],
  synthesizing: ["ready_to_play", "cancelling", "failed"],
  ready_to_play: ["playing", "completed", "cancelling", "failed"],
  playing: ["paused", "completed", "cancelling", "failed"],
  paused: ["playing", "completed", "cancelling", "failed"],
  completed: ["idle", "requesting_permission"],
  cancelling: ["idle", "failed"],
  failed: ["requesting_permission", "transcribing", "synthesizing", "idle"],
};

export function canTransitionVoiceTurn(from: VoiceTurnPhase, to: VoiceTurnPhase): boolean {
  return TRANSITIONS[from].includes(to);
}

function transition(state: VoiceTurnState, phase: VoiceTurnPhase): VoiceTurnState {
  return canTransitionVoiceTurn(state.phase, phase) ? { ...state, phase, error: null } : state;
}

export function reduceVoiceTurn(state: VoiceTurnState, event: VoiceTurnEvent): VoiceTurnState {
  switch (event.type) {
    case "begin_capture": {
      if (!canTransitionVoiceTurn(state.phase, "requesting_permission")) return state;
      return { ...initialVoiceTurnState, turnId: event.turnId, phase: "requesting_permission" };
    }
    case "permission_granted":
      return transition(state, "recording");
    case "recording_stopped":
      return transition(state, "preparing_audio");
    case "stt_started": {
      if (!canTransitionVoiceTurn(state.phase, "transcribing")) return state;
      return { ...state, phase: "transcribing", sttRequestId: event.requestId, error: null };
    }
    case "stt_completed":
      return event.requestId === state.sttRequestId ? transition(state, "reviewing") : state;
    case "review_accepted":
      return transition(state, "ready_to_send");
    case "submit_started": {
      if (!canTransitionVoiceTurn(state.phase, "submitting")) return state;
      return { ...state, phase: "submitting", sourceMessageId: event.messageId, error: null };
    }
    case "response_started":
      return transition(state, "awaiting_response");
    case "response_completed": {
      if (!canTransitionVoiceTurn(state.phase, "response_ready")) return state;
      return { ...state, phase: "response_ready", responseMessageId: event.messageId, error: null };
    }
    case "tts_started": {
      if (!canTransitionVoiceTurn(state.phase, "synthesizing")) return state;
      return { ...state, phase: "synthesizing", ttsRequestId: event.requestId, error: null };
    }
    case "tts_completed":
      return event.requestId === state.ttsRequestId ? transition(state, "ready_to_play") : state;
    case "play":
    case "resume":
      return transition(state, "playing");
    case "pause":
      return transition(state, "paused");
    case "finish":
      return transition(state, "completed");
    case "cancel":
      return transition(state, "cancelling");
    case "cancelled":
      return transition(state, "idle");
    case "fail": {
      if (!canTransitionVoiceTurn(state.phase, "failed")) return state;
      return { ...state, phase: "failed", error: event.error };
    }
    case "retry": {
      if (state.phase !== "failed" || !state.error?.retryable) return state;
      const retryPhase = state.error.stage === "transcribing"
        ? "transcribing"
        : state.error.stage === "synthesizing"
          ? "synthesizing"
          : "requesting_permission";
      return transition(state, retryPhase);
    }
    case "reset":
      return state.phase === "idle" || state.phase === "completed" || state.phase === "failed"
        ? initialVoiceTurnState
        : state;
  }
}

export function isVoiceCaptureActive(phase: VoiceTurnPhase): boolean {
  return phase === "requesting_permission" || phase === "recording";
}

export function isVoicePlaybackActive(phase: VoiceTurnPhase): boolean {
  return phase === "playing" || phase === "paused";
}
