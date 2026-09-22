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

const PLAYBACK_ENGINE_REV = 13;

export function useSystemVoicePlayback(): SystemVoicePlayback {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [isAvailable, setIsAvailable] = useState(false);
  const controllerRef = useRef<VoicePlaybackController | null>(null);
  const onChangeRef = useRef(setSnapshot);
  onChangeRef.current = setSnapshot;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const controller = createPlaybackController((next) => onChangeRef.current(next));
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
  }, [PLAYBACK_ENGINE_REV]);

  const stop = useCallback(() => {
    controllerRef.current?.stop();
    setSnapshot({ activeMessageId: null, error: null, phase: "idle" });
  }, []);
  const pause = useCallback(() => {
    controllerRef.current?.pause();
    setSnapshot((current) => (
      current.phase === "idle" && !current.activeMessageId
        ? current
        : { ...current, phase: "paused" }
    ));
  }, []);
  const resume = useCallback(() => {
    controllerRef.current?.resume();
    setSnapshot((current) => (
      current.activeMessageId
        ? { ...current, phase: "playing" }
        : current
    ));
  }, []);
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
        activeMessageId: messageId,
        error: language === "zh" ? "这条回复没有可朗读的文本。" : "This response has no readable text.",
        phase: "failed",
      });
      return;
    }
    let controller = controllerRef.current;
    if (!controller || controller.isDisposed) {
      controller = createPlaybackController((next) => onChangeRef.current(next));
      controllerRef.current = controller;
      setIsAvailable(controller.isAvailable);
    }
    setSnapshot({
      activeMessageId: messageId,
      error: null,
      phase: "playing",
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
