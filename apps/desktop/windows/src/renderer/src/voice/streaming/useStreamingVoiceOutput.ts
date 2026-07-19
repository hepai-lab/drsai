import { useCallback, useEffect, useRef, useState } from "react";
import { desktopApi } from "../../desktopApi";
import type { SpeechTextSegment } from "./semanticSpeechSegmenter";
import { BrowserStreamingAudioAdapter } from "./browserStreamingAudioAdapter";
import { DesktopStreamingTtsRuntime } from "./desktopStreamingTtsRuntime";
import { OrderedStreamingAudioPlaybackQueue, type StreamingPlaybackPhase } from "./orderedAudioPlaybackQueue";
import { BoundedStreamingTtsScheduler } from "./streamingTtsScheduler";

export interface StreamingVoiceOutputState {
  phase: StreamingPlaybackPhase | "synthesizing";
  error: string | null;
  synthesizedSegments: number;
  playedSegments: number;
  deviceNotice: string | null;
  pause(): void;
  resume(): void;
  stop(): void;
}

export function useStreamingVoiceOutput(options: {
  enabled: boolean;
  segments: SpeechTextSegment[];
  textCompleted: boolean;
  voice?: string;
  speed?: number;
  onTerminal?: (terminal: "completed" | "cancelled" | "failed") => void;
}): StreamingVoiceOutputState {
  const [phase, setPhase] = useState<StreamingVoiceOutputState["phase"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [synthesizedSegments, setSynthesizedSegments] = useState(0);
  const [playedSegments, setPlayedSegments] = useState(0);
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null);
  const schedulerRef = useRef<BoundedStreamingTtsScheduler | null>(null);
  const playbackRef = useRef<OrderedStreamingAudioPlaybackQueue | null>(null);
  const segmentsRef = useRef(options.segments);
  const completedRef = useRef(options.textCompleted);
  const nextScheduledRef = useRef(0);
  const identityRef = useRef<{ sessionId: string; turnId: string; messageId: string } | null>(null);
  const pumpRef = useRef<() => void>(() => {});
  const onTerminalRef = useRef(options.onTerminal);
  onTerminalRef.current = options.onTerminal;
  segmentsRef.current = options.segments;
  completedRef.current = options.textCompleted;

  useEffect(() => {
    if (!options.enabled) return;
    const identity = { sessionId: `tts-session-${crypto.randomUUID()}`, turnId: `tts-turn-${crypto.randomUUID()}`, messageId: `tts-message-${crypto.randomUUID()}` };
    identityRef.current = identity;
    nextScheduledRef.current = 0;
    setError(null); setSynthesizedSegments(0); setPlayedSegments(0); setPhase("buffering");
    const runtime = new DesktopStreamingTtsRuntime({
      start: (request) => desktopApi.startVoiceSynthesis(request),
      cancel: (requestId) => desktopApi.cancelVoiceSynthesis(requestId),
      subscribe: (callback) => desktopApi.onVoiceSynthesisEvent(callback),
    });
    const playback = new OrderedStreamingAudioPlaybackQueue(new BrowserStreamingAudioAdapter(), {
      onPhase: (next) => {
        setPhase(next);
        setPlayedSegments(playback.playedIndexes.length);
        if (next === "completed") onTerminalRef.current?.("completed");
        else if (next === "failed") { setError("Streaming reply audio could not be played."); onTerminalRef.current?.("failed"); }
      },
    });
    playbackRef.current = playback;
    const scheduler = new BoundedStreamingTtsScheduler(runtime, {
      onEvent: (event) => {
        if (event.type === "started" && !["playing", "paused"].includes(playbackRef.current?.phase ?? "idle")) setPhase("synthesizing");
        else if (event.type === "audio") {
          if (!playback.enqueue(event.segment)) {
            setError("The streaming playback queue is full or received a duplicate segment.");
            onTerminalRef.current?.("failed");
          }
          setSynthesizedSegments((current) => current + 1);
        } else if (event.type === "failed") setError(event.error.message);
        else if (event.type === "idle") pumpRef.current();
      },
    });
    schedulerRef.current = scheduler;
    pumpRef.current();
    return () => {
      scheduler.cancel();
      playback.stop();
      schedulerRef.current = null;
      playbackRef.current = null;
      identityRef.current = null;
    };
  }, [options.enabled]);

  pumpRef.current = (): void => {
    const scheduler = schedulerRef.current;
    const playback = playbackRef.current;
    const identity = identityRef.current;
    if (!scheduler || !playback || !identity) return;
    while (scheduler.capacity > 0 && nextScheduledRef.current < segmentsRef.current.length) {
      const segment = segmentsRef.current[nextScheduledRef.current];
      const accepted = scheduler.enqueue({
        ...identity, segmentId: segment.id, segmentIndex: segment.index, text: segment.text,
        voice: options.voice, speed: options.speed, format: "wav",
      });
      if (!accepted) break;
      nextScheduledRef.current += 1;
    }
    if (completedRef.current && nextScheduledRef.current >= segmentsRef.current.length && !scheduler.active && !scheduler.pending) {
      playback.finish(segmentsRef.current.length - 1);
    }
  };

  useEffect(() => { if (options.enabled) pumpRef.current(); }, [options.enabled, options.segments, options.textCompleted]);

  useEffect(() => {
    if (!options.enabled || typeof navigator === "undefined" || !navigator.mediaDevices?.addEventListener) return;
    const changed = (): void => setDeviceNotice("Output device changed; playback will continue on the system default device.");
    navigator.mediaDevices.addEventListener("devicechange", changed);
    return () => navigator.mediaDevices.removeEventListener("devicechange", changed);
  }, [options.enabled]);

  const pause = useCallback(() => { playbackRef.current?.pause(); }, []);
  const resume = useCallback(() => { playbackRef.current?.resume(); }, []);
  const stop = useCallback(() => {
    if (!schedulerRef.current && !playbackRef.current) return;
    schedulerRef.current?.cancel();
    playbackRef.current?.stop();
    onTerminalRef.current?.("cancelled");
  }, []);

  return { phase, error, synthesizedSegments, playedSegments, deviceNotice, pause, resume, stop };
}
