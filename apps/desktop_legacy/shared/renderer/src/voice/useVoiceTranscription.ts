import { useCallback, useEffect, useRef } from "react";
import type { DesktopVoiceTranscriptionResult } from "@shared/desktopApi";
import { desktopApi, hasDesktopApi } from "../desktopApi";
import { VoiceTranscriptionController } from "./voiceTranscriptionController";

export interface VoiceTranscriptionInput {
  blob: Blob;
  durationSeconds: number;
  languageHint?: string;
  workspacePath?: string;
}

export function useVoiceTranscription(onProgress: (message: string) => void): {
  cancel: () => boolean;
  transcribe: (input: VoiceTranscriptionInput) => Promise<DesktopVoiceTranscriptionResult>;
} {
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;
  const controllerRef = useRef<VoiceTranscriptionController | null>(null);

  useEffect(() => {
    if (!hasDesktopApi()) return;
    const controller = new VoiceTranscriptionController({
      cancel: (requestId) => desktopApi.cancelVoiceTranscription(requestId),
      start: (request) => desktopApi.startVoiceTranscription(request),
      subscribe: (callback) => desktopApi.onVoiceTranscriptionEvent(callback),
    }, (message) => progressRef.current(message));
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
      controller.dispose();
    };
  }, []);

  const transcribe = useCallback(async (input: VoiceTranscriptionInput) => {
    const controller = controllerRef.current;
    if (!controller) throw new Error("Voice transcription requires the desktop runtime.");
    const audioData = new Uint8Array(await input.blob.arrayBuffer());
    return controller.transcribe({
      workspacePath: input.workspacePath,
      audioData,
      mimeType: input.blob.type || "audio/webm",
      durationSeconds: input.durationSeconds,
      languageHint: input.languageHint,
      sourceLabel: "Desktop composer microphone",
    });
  }, []);

  const cancel = useCallback(() => controllerRef.current?.cancel() ?? false, []);
  return { cancel, transcribe };
}
