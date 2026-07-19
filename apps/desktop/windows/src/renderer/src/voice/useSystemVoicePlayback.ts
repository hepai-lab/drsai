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

export function useSystemVoicePlayback(): SystemVoicePlayback {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const controllerRef = useRef<VoicePlaybackController | null>(null);
  if (!controllerRef.current && typeof window !== "undefined") {
    const systemAvailable = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
    controllerRef.current = new VoicePlaybackController({
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
        resume: () => window.speechSynthesis.resume(),
        speak: (utterance) => window.speechSynthesis.speak(utterance as SpeechSynthesisUtterance),
      } : undefined,
    }, setSnapshot);
  }

  useEffect(() => () => controllerRef.current?.dispose(), []);

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
    controllerRef.current?.play({
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
    isAvailable: controllerRef.current?.isAvailable ?? false,
    pause,
    play,
    resume,
    stop,
  };
}
