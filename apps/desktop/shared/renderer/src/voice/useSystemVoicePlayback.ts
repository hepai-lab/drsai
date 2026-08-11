import { useCallback, useEffect, useRef, useState } from "react";
import { desktopApi, hasDesktopApi } from "../desktopApi";
import {
  VoicePlaybackController,
  type AudioLike,
  type UtteranceLike,
  type VoicePlaybackPhase,
  type VoicePlaybackSnapshot,
  type VoiceSynthesisMode,
} from "./voicePlaybackController";
import { prepareTextForSpeech, selectSpeechVoice } from "./voiceSpeech";

export type { VoicePlaybackPhase, VoiceSynthesisMode } from "./voicePlaybackController";

export interface SystemVoicePlayback {
  activeMessageId: string | null;
  error: string | null;
  isAvailable: boolean;
  phase: VoicePlaybackPhase;
  pause: () => void;
  play: (
    messageId: string,
    content: string,
    language: "zh" | "en",
    options?: { mode?: VoiceSynthesisMode; rate?: number; voiceName?: string },
  ) => void;
  resume: () => void;
  stop: () => void;
}

const initialSnapshot: VoicePlaybackSnapshot = {
  activeMessageId: null,
  error: null,
  phase: "idle",
};

function createPlaybackController(
  onChange: (snapshot: VoicePlaybackSnapshot) => void,
): VoicePlaybackController {
  const systemAvailable = typeof window !== "undefined"
    && "speechSynthesis" in window
    && "SpeechSynthesisUtterance" in window;
  return new VoicePlaybackController({
    createAudio: (url) => new Audio(url) as unknown as AudioLike,
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    createUtterance: (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
    provider: hasDesktopApi() ? {
      cancel: (requestId) => desktopApi.cancelVoiceSynthesis(requestId),
      getStatus: () => desktopApi.getVoiceSynthesisRuntimeStatus(),
      start: (request) => desktopApi.startVoiceSynthesis(request),
      subscribe: (callback) => desktopApi.onVoiceSynthesisEvent(callback),
    } : undefined,
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    selectVoice: selectSpeechVoice,
    system: systemAvailable ? {
      cancel: () => window.speechSynthesis.cancel(),
      getVoices: () => window.speechSynthesis.getVoices(),
      pause: () => window.speechSynthesis.pause(),
      resume: () => {
        try {
          window.speechSynthesis.resume();
        } catch {
          // Some Chromium builds throw if nothing is paused.
        }
      },
      speak: (utterance) => {
        const synth = window.speechSynthesis;
        void synth.getVoices();
        if (synth.paused) synth.resume();
        synth.speak(utterance as SpeechSynthesisUtterance);
        if (synth.paused) synth.resume();
      },
    } : undefined,
  }, onChange);
}

export function useSystemVoicePlayback(): SystemVoicePlayback {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [isAvailable, setIsAvailable] = useState(false);
  const controllerRef = useRef<VoicePlaybackController | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const controller = createPlaybackController(setSnapshot);
    controllerRef.current = controller;
    setIsAvailable(controller.isAvailable);

    const warmVoices = (): void => {
      if ("speechSynthesis" in window) void window.speechSynthesis.getVoices();
    };
    warmVoices();
    if ("speechSynthesis" in window) {
      window.speechSynthesis.addEventListener("voiceschanged", warmVoices);
    }

    return () => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.removeEventListener("voiceschanged", warmVoices);
      }
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, []);

  const stop = useCallback(() => controllerRef.current?.stop(), []);
  const pause = useCallback(() => { controllerRef.current?.pause(); }, []);
  const resume = useCallback(() => { controllerRef.current?.resume(); }, []);
  const play = useCallback((
    messageId: string,
    content: string,
    language: "zh" | "en",
    options?: { mode?: VoiceSynthesisMode; rate?: number; voiceName?: string },
  ) => {
    const text = prepareTextForSpeech(content);
    if (!text) {
      controllerRef.current?.stop();
      setSnapshot({
        activeMessageId: null,
        error: language === "zh" ? "这条回复没有可朗读的文本。" : "This response has no readable text.",
        phase: "failed",
      });
      return;
    }
    const controller = controllerRef.current;
    if (!controller) {
      setSnapshot({
        activeMessageId: null,
        error: language === "zh" ? "朗读引擎尚未就绪，请稍后再试。" : "Speech playback is not ready yet. Try again.",
        phase: "failed",
      });
      return;
    }
    // Optimistic UI: show synthesizing immediately even before async provider work.
    setSnapshot({
      activeMessageId: messageId,
      error: null,
      phase: "synthesizing",
    });
    controller.play({
      language,
      messageId,
      mode: options?.mode ?? "system",
      rate: options?.rate ?? 1,
      text,
      voiceName: options?.voiceName ?? "",
    });
  }, []);

  return {
    ...snapshot,
    isAvailable,
    pause,
    play,
    resume,
    stop,
  };
}
