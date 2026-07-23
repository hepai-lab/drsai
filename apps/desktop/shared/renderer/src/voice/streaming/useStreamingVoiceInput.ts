import { useCallback, useEffect, useRef, useState } from "react";
import { desktopApi } from "../../desktopApi";
import { useVoiceLevelMeter } from "../useVoiceLevelMeter";
import { StreamingCaptureController } from "./streamingCaptureController";
import {
  getStreamingTranscriptDisplayText,
  initialStreamingTranscriptState,
  reconcileStreamingTranscript,
  type StreamingTranscriptState,
} from "./transcriptReconciler";
import {
  initialStreamingVoiceTurnState,
  reduceStreamingVoiceTurn,
  type StreamingVoiceTurnEvent,
  type StreamingVoiceTurnState,
} from "./streamingVoiceTurnReducer";
import { LocalVoiceActivityDetector } from "./localVad";

export type StreamingVoiceInputPhase = "idle" | "starting" | "streaming" | "stopping" | "reviewing" | "cancelling" | "failed";

export interface UseStreamingVoiceInputOptions {
  deviceId: string;
  languageHint?: string;
  onReview: (transcript: string) => void;
}

export interface StreamingVoiceInputHook {
  phase: StreamingVoiceInputPhase;
  transcript: StreamingTranscriptState;
  displayText: string;
  elapsedSeconds: number;
  levels: number[];
  error: string | null;
  flowControl: { paused: boolean; bufferedAudioMs: number };
  turnState: StreamingVoiceTurnState;
  start: () => Promise<boolean>;
  stop: () => Promise<boolean>;
  cancel: () => Promise<boolean>;
  reset: () => void;
  acceptReview: () => void;
  markAssistantTextStarted: () => void;
  markAssistantTextCompleted: () => void;
  markTtsStarted: () => void;
  markTtsCompleted: () => void;
  markPlaybackStarted: () => void;
  markPlaybackCompleted: () => void;
  cancelOutput: () => void;
  failOutput: (error: string) => void;
}

export function useStreamingVoiceInput(options: UseStreamingVoiceInputOptions): StreamingVoiceInputHook {
  const [phase, setPhase] = useState<StreamingVoiceInputPhase>("idle");
  const [transcript, setTranscript] = useState(initialStreamingTranscriptState);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [flowControl, setFlowControl] = useState({ paused: false, bufferedAudioMs: 0 });
  const [turnState, setTurnState] = useState(initialStreamingVoiceTurnState);
  const optionsRef = useRef(options);
  const phaseRef = useRef(phase);
  const transcriptRef = useRef(transcript);
  const sessionRef = useRef<{ sessionId: string; turnId: string } | null>(null);
  const captureRef = useRef<StreamingCaptureController | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const meter = useVoiceLevelMeter();
  const meterRef = useRef(meter);
  const turnStateRef = useRef(turnState);
  const vadRef = useRef(new LocalVoiceActivityDetector());
  const stopWithReasonRef = useRef<(reason: "provider" | "local_vad" | "manual") => Promise<boolean>>(async () => false);
  const cancelEmptyInputRef = useRef<() => Promise<void>>(async () => {});
  optionsRef.current = options;
  phaseRef.current = phase;
  transcriptRef.current = transcript;
  meterRef.current = meter;
  turnStateRef.current = turnState;

  const dispatchTurn = useCallback((event: StreamingVoiceTurnEvent): void => {
    const next = reduceStreamingVoiceTurn(turnStateRef.current, event);
    turnStateRef.current = next;
    setTurnState(next);
  }, []);

  const setCurrentPhase = useCallback((next: StreamingVoiceInputPhase): void => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const stopTimer = useCallback((): void => {
    if (elapsedTimerRef.current !== null) window.clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = null;
  }, []);

  useEffect(() => desktopApi.onStreamingVoiceTranscriptionEvent((event) => {
    const session = sessionRef.current;
    if (!session || event.sessionId !== session.sessionId || event.turnId !== session.turnId) return;
    const result = reconcileStreamingTranscript(transcriptRef.current, event);
    if (result.state !== transcriptRef.current) {
      transcriptRef.current = result.state;
      setTranscript(result.state);
    }
    if (!result.accepted) return;
    if (event.type === "flow_control") setFlowControl({ paused: event.paused, bufferedAudioMs: event.bufferedAudioMs });
    if (event.type === "endpoint" && phaseRef.current === "streaming") {
      setCurrentPhase("stopping");
      dispatchTurn({ type: "stop_input" });
      stopTimer();
      void captureRef.current?.stop(false);
      captureRef.current = null;
    }
    if (event.type === "completed") {
      dispatchTurn({ type: "asr_completed" });
      stopTimer();
      void captureRef.current?.stop(false);
      captureRef.current = null;
      sessionRef.current = null;
      if (!result.state.committedText.trim()) {
        setError("No speech was detected. Try again or use serial voice input.");
        setCurrentPhase("failed");
      } else {
        if (result.state.finalConfidence !== null && result.state.finalConfidence < 0.55) {
          setError("Low-confidence transcript: review the text carefully before inserting it.");
        }
        setCurrentPhase("reviewing");
        optionsRef.current.onReview(result.state.committedText);
      }
    } else if (event.type === "cancelled") {
      dispatchTurn({ type: "cancelled" });
      stopTimer();
      sessionRef.current = null;
      setCurrentPhase("idle");
    } else if (event.type === "failed") {
      dispatchTurn({ type: "fail", error: event.error.message });
      stopTimer();
      void captureRef.current?.stop(false);
      captureRef.current = null;
      sessionRef.current = null;
      setError(event.error.message);
      setCurrentPhase("failed");
    }
  }), [dispatchTurn, setCurrentPhase, stopTimer]);

  const start = useCallback(async (): Promise<boolean> => {
    if (phaseRef.current !== "idle" && phaseRef.current !== "reviewing" && phaseRef.current !== "failed") return false;
    setError(null);
    setElapsedSeconds(0);
    setFlowControl({ paused: false, bufferedAudioMs: 0 });
    vadRef.current.reset();
    const initial = { ...initialStreamingTranscriptState };
    transcriptRef.current = initial;
    setTranscript(initial);
    setCurrentPhase("starting");
    const turnId = `voice-streaming-turn-${crypto.randomUUID()}`;
    dispatchTurn({ type: "reset" });
    dispatchTurn({ type: "begin", turnId });
    try {
      const result = await desktopApi.startStreamingVoiceTranscription({
        turnId,
        languageHint: optionsRef.current.languageHint,
        encoding: "pcm_s16le",
        sampleRateHz: 16_000,
        channels: 1,
        frameDurationMs: 20,
        providerEndpointing: true,
      });
      sessionRef.current = { sessionId: result.sessionId, turnId };
      // invoke() resolving is the acceptance boundary. Main may emit the
      // accepted event before Renderer has the session id, so sequence 0 is
      // reserved here and a later duplicate accepted event remains harmless.
      const acceptedState = { ...initialStreamingTranscriptState, lastEventSequence: 0 };
      transcriptRef.current = acceptedState;
      setTranscript(acceptedState);
      const capture = new StreamingCaptureController({
        sessionId: result.sessionId,
        turnId,
        deviceId: optionsRef.current.deviceId,
        targetSampleRateHz: 16_000,
        onChunk: (chunk) => desktopApi.sendStreamingVoiceAudioChunk(chunk),
        onAudioBatch: (samples, durationMs) => {
          const activity = vadRef.current.observe(samples, durationMs);
          if (activity.endpoint === "local_vad") queueMicrotask(() => { void stopWithReasonRef.current("local_vad"); });
          else if (activity.endpoint === "empty_input") queueMicrotask(() => { void cancelEmptyInputRef.current(); });
        },
        onError: (captureError) => {
          setError(captureError.message);
          dispatchTurn({ type: "fail", error: captureError.message });
          setCurrentPhase("failed");
          stopTimer();
          const activeSession = sessionRef.current;
          sessionRef.current = null;
          captureRef.current = null;
          meterRef.current.stop();
          if (activeSession) void desktopApi.cancelStreamingVoiceTranscription(activeSession.sessionId);
        },
        onStreamStarted: (stream) => meterRef.current.start(stream),
        onStreamStopped: () => meterRef.current.stop(),
      });
      captureRef.current = capture;
      await capture.start();
      startedAtRef.current = performance.now();
      elapsedTimerRef.current = window.setInterval(() => {
        setElapsedSeconds(Math.max(0, (performance.now() - startedAtRef.current) / 1_000));
      }, 100);
      setCurrentPhase("streaming");
      dispatchTurn({ type: "capture_started" });
      return true;
    } catch (startError) {
      const session = sessionRef.current;
      if (session) await desktopApi.cancelStreamingVoiceTranscription(session.sessionId).catch(() => false);
      sessionRef.current = null;
      await captureRef.current?.stop(false).catch(() => undefined);
      captureRef.current = null;
      setError(startError instanceof Error ? startError.message : String(startError));
      dispatchTurn({ type: "fail", error: startError instanceof Error ? startError.message : String(startError) });
      setCurrentPhase("failed");
      return false;
    }
  }, [dispatchTurn, setCurrentPhase, stopTimer]);

  stopWithReasonRef.current = async (reason): Promise<boolean> => {
    const session = sessionRef.current;
    if (!session || phaseRef.current !== "streaming") return false;
    setCurrentPhase("stopping");
    dispatchTurn({ type: "stop_input" });
    stopTimer();
    await captureRef.current?.stop(true);
    captureRef.current = null;
    return desktopApi.stopStreamingVoiceTranscription(session.sessionId, reason);
  };

  const stop = useCallback(async (): Promise<boolean> => stopWithReasonRef.current("manual"), []);

  const cancel = useCallback(async (): Promise<boolean> => {
    const session = sessionRef.current;
    if (!session) return false;
    setCurrentPhase("cancelling");
    dispatchTurn({ type: "cancel" });
    stopTimer();
    await captureRef.current?.stop(false);
    captureRef.current = null;
    return desktopApi.cancelStreamingVoiceTranscription(session.sessionId);
  }, [dispatchTurn, setCurrentPhase, stopTimer]);

  cancelEmptyInputRef.current = async (): Promise<void> => {
    const cancelled = await cancel();
    if (!cancelled) return;
    setError("No speech was detected. Try again or use serial voice input.");
    setCurrentPhase("failed");
  };

  const reset = useCallback((): void => {
    if (!["idle", "reviewing", "failed"].includes(phaseRef.current)) return;
    setError(null);
    setElapsedSeconds(0);
    const initial = { ...initialStreamingTranscriptState };
    transcriptRef.current = initial;
    setTranscript(initial);
    dispatchTurn({ type: "reset" });
    setCurrentPhase("idle");
  }, [dispatchTurn, setCurrentPhase]);

  const acceptReview = useCallback((): void => { dispatchTurn({ type: "review_accepted" }); setCurrentPhase("idle"); }, [dispatchTurn, setCurrentPhase]);
  const markAssistantTextStarted = useCallback((): void => dispatchTurn({ type: "llm_started" }), [dispatchTurn]);
  const markAssistantTextCompleted = useCallback((): void => dispatchTurn({ type: "llm_completed" }), [dispatchTurn]);
  const markTtsStarted = useCallback((): void => dispatchTurn({ type: "tts_started" }), [dispatchTurn]);
  const markTtsCompleted = useCallback((): void => dispatchTurn({ type: "tts_completed" }), [dispatchTurn]);
  const markPlaybackStarted = useCallback((): void => dispatchTurn({ type: "playback_started" }), [dispatchTurn]);
  const markPlaybackCompleted = useCallback((): void => dispatchTurn({ type: "playback_completed" }), [dispatchTurn]);
  const cancelOutput = useCallback((): void => { dispatchTurn({ type: "cancel" }); dispatchTurn({ type: "cancelled" }); }, [dispatchTurn]);
  const failOutput = useCallback((outputError: string): void => dispatchTurn({ type: "fail", error: outputError }), [dispatchTurn]);

  useEffect(() => () => {
    stopTimer();
    void captureRef.current?.stop(false);
    const session = sessionRef.current;
    if (session) void desktopApi.cancelStreamingVoiceTranscription(session.sessionId);
  }, [stopTimer]);

  return {
    phase,
    transcript,
    displayText: getStreamingTranscriptDisplayText(transcript),
    elapsedSeconds,
    levels: meter.levels,
    error,
    flowControl,
    turnState,
    start,
    stop,
    cancel,
    reset,
    acceptReview,
    markAssistantTextStarted,
    markAssistantTextCompleted,
    markTtsStarted,
    markTtsCompleted,
    markPlaybackStarted,
    markPlaybackCompleted,
    cancelOutput,
    failOutput,
  };
}
