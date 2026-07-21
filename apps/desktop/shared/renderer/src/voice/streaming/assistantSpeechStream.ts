import { useCallback, useEffect, useRef, useState } from "react";
import { SemanticSpeechSegmenter, type SpeechTextSegment } from "./semanticSpeechSegmenter";

export type AssistantSpeechStreamEvent =
  | { type: "chunk"; requestId: string; content: string; at: number }
  | { type: "done" | "aborted" | "error"; requestId: string; at: number };

const EVENT_NAME = "opendrsai:assistant-speech-stream";

export function emitAssistantSpeechStreamEvent(event: AssistantSpeechStreamEvent): void {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: event }));
}

export function subscribeAssistantSpeechStream(listener: (event: AssistantSpeechStreamEvent) => void): () => void {
  const handler = (event: Event): void => listener((event as CustomEvent<AssistantSpeechStreamEvent>).detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

export function useAssistantSpeechSegments(enabled: boolean): {
  segments: SpeechTextSegment[];
  completed: boolean;
  clear: () => void;
} {
  const [segments, setSegments] = useState<SpeechTextSegment[]>([]);
  const [completed, setCompleted] = useState(false);
  const segmenterRef = useRef(new SemanticSpeechSegmenter());
  const requestIdRef = useRef<string | null>(null);

  const clear = useCallback(() => {
    segmenterRef.current.reset();
    requestIdRef.current = null;
    setSegments([]);
    setCompleted(false);
  }, []);

  useEffect(() => {
    if (!enabled) { clear(); return; }
    return subscribeAssistantSpeechStream((event) => {
      if (event.type === "chunk") {
        if (requestIdRef.current !== event.requestId) {
          segmenterRef.current.reset();
          requestIdRef.current = event.requestId;
          setSegments([]);
          setCompleted(false);
        }
        const next = segmenterRef.current.push(event.content, event.at);
        if (next.length) setSegments((current) => [...current, ...next]);
        return;
      }
      if (requestIdRef.current !== event.requestId) return;
      if (event.type === "done") {
        const tail = segmenterRef.current.flush();
        if (tail.length) setSegments((current) => [...current, ...tail]);
        setCompleted(true);
      } else {
        clear();
      }
    });
  }, [clear, enabled]);

  return { segments, completed, clear };
}
