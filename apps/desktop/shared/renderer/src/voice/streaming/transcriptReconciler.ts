import type { DesktopStreamingVoiceTranscriptionEvent } from "@shared/desktopApi";

export interface StreamingTranscriptState {
  committedText: string;
  unstableText: string;
  revision: number;
  finalConfidence: number | null;
  lastEventSequence: number;
  endpoint: "provider" | "local_vad" | "manual" | null;
  terminal: "completed" | "cancelled" | "failed" | null;
}

export const initialStreamingTranscriptState: StreamingTranscriptState = {
  committedText: "",
  unstableText: "",
  revision: 0,
  finalConfidence: null,
  lastEventSequence: -1,
  endpoint: null,
  terminal: null,
};

export type TranscriptEventResult =
  | { accepted: true; state: StreamingTranscriptState }
  | { accepted: false; state: StreamingTranscriptState; reason: "duplicate" | "out_of_order" | "stale_revision" | "terminal" };

export function reconcileStreamingTranscript(
  state: StreamingTranscriptState,
  event: DesktopStreamingVoiceTranscriptionEvent,
): TranscriptEventResult {
  if (state.terminal) return { accepted: false, state, reason: "terminal" };
  if (event.sequence === state.lastEventSequence) return { accepted: false, state, reason: "duplicate" };
  if (event.sequence !== state.lastEventSequence + 1) return { accepted: false, state, reason: "out_of_order" };

  const base = { ...state, lastEventSequence: event.sequence };
  if (event.type === "partial") {
    if (event.segment.revision < state.revision) return { accepted: false, state: base, reason: "stale_revision" };
    return {
      accepted: true,
      state: { ...base, unstableText: normalizeTranscript(event.segment.text), revision: event.segment.revision },
    };
  }
  if (event.type === "final") {
    if (event.segment.revision < state.revision) return { accepted: false, state: base, reason: "stale_revision" };
    const finalText = normalizeTranscript(event.segment.text);
    return {
      accepted: true,
      state: {
        ...base,
        committedText: appendTranscript(state.committedText, finalText),
        unstableText: "",
        revision: event.segment.revision,
        finalConfidence: event.segment.confidence ?? null,
      },
    };
  }
  if (event.type === "endpoint") return { accepted: true, state: { ...base, endpoint: event.reason } };
  if (event.type === "completed") return { accepted: true, state: { ...base, unstableText: "", terminal: "completed" } };
  if (event.type === "cancelled") return { accepted: true, state: { ...base, unstableText: "", terminal: "cancelled" } };
  if (event.type === "failed") return { accepted: true, state: { ...base, unstableText: "", terminal: "failed" } };
  return { accepted: true, state: base };
}

export function getStreamingTranscriptDisplayText(state: StreamingTranscriptState): string {
  return appendTranscript(state.committedText, state.unstableText);
}

function normalizeTranscript(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function appendTranscript(current: string, addition: string): string {
  if (!addition) return current;
  if (!current) return addition;
  if (/\s$/u.test(current) || /^[,.;:!?，。；：！？、]/u.test(addition)) return `${current}${addition}`;
  return `${current} ${addition}`;
}
