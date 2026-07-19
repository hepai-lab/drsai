import { useCallback, useEffect, useRef, useState } from "react";
import { getPreferredVoiceMimeType, getVoicePermissionError, type VoiceRecordingState } from "./voiceAudio";
import {
  VoiceCaptureController,
  type VoiceCaptureResult,
  type VoiceCaptureStopMode,
} from "./voiceCaptureController";
import { useVoiceLevelMeter } from "./useVoiceLevelMeter";

export interface UseVoiceCaptureOptions {
  beforeStart: () => Promise<void>;
  deviceId: string;
  onDeviceUnavailable?: () => void;
  onRecorded: (result: VoiceCaptureResult) => void;
}

export interface VoiceCaptureHook {
  devices: MediaDeviceInfo[];
  elapsedSeconds: number;
  error: string | null;
  levels: number[];
  setElapsedSeconds: (seconds: number) => void;
  setError: (error: string | null) => void;
  setState: (state: VoiceRecordingState) => void;
  start: () => Promise<boolean>;
  state: VoiceRecordingState;
  stop: (mode: VoiceCaptureStopMode) => void;
}

export function useVoiceCapture(options: UseVoiceCaptureOptions): VoiceCaptureHook {
  const [state, setState] = useState<VoiceRecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const levelMeter = useVoiceLevelMeter();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const meterRef = useRef(levelMeter);
  meterRef.current = levelMeter;
  const controllerRef = useRef<VoiceCaptureController | null>(null);

  if (!controllerRef.current && typeof navigator !== "undefined" && navigator.mediaDevices && typeof MediaRecorder !== "undefined") {
    controllerRef.current = new VoiceCaptureController({
      clearInterval: (timer) => window.clearInterval(timer),
      createRecorder: (stream, mimeType) => mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream),
      getPreferredMimeType: getPreferredVoiceMimeType,
      mediaDevices: navigator.mediaDevices,
      now: Date.now,
      setInterval: (callback, milliseconds) => window.setInterval(callback, milliseconds),
    }, {
      beforeStart: () => optionsRef.current.beforeStart(),
      onDevices: setDevices,
      onElapsed: setElapsedSeconds,
      onError: (captureError) => setError(captureError ? getVoicePermissionError(captureError) : null),
      onLevelsReset: () => meterRef.current.reset(),
      onRecorded: (result) => optionsRef.current.onRecorded(result),
      onState: setState,
      onStreamStarted: (stream) => meterRef.current.start(stream),
      onStreamStopped: () => meterRef.current.stop(),
    });
  }

  useEffect(() => () => controllerRef.current?.dispose(), []);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) return;
    const refreshDevices = async (): Promise<void> => {
      const nextDevices = await mediaDevices.enumerateDevices().catch(() => []);
      const audioInputs = nextDevices.filter((device) => device.kind === "audioinput");
      setDevices(audioInputs);
      const selectedDeviceId = optionsRef.current.deviceId;
      if (selectedDeviceId && !audioInputs.some((device) => device.deviceId === selectedDeviceId)) {
        optionsRef.current.onDeviceUnavailable?.();
      }
    };
    void refreshDevices();
    mediaDevices.addEventListener?.("devicechange", refreshDevices);
    return () => mediaDevices.removeEventListener?.("devicechange", refreshDevices);
  }, []);

  const start = useCallback(async () => {
    if (!controllerRef.current) {
      setState("failed");
      setError("Voice recording is unavailable in this desktop runtime.");
      return false;
    }
    return controllerRef.current.start(optionsRef.current.deviceId);
  }, []);

  const stop = useCallback((mode: VoiceCaptureStopMode) => controllerRef.current?.stop(mode), []);

  return {
    devices,
    elapsedSeconds,
    error,
    levels: levelMeter.levels,
    setElapsedSeconds,
    setError,
    setState,
    start,
    state,
    stop,
  };
}
