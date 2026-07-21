import { useCallback, useEffect, useRef, useState } from "react";
import {
  VOICE_LEVEL_SAMPLE_INTERVAL_MS,
  calculateVoiceLevel,
  createSilentVoiceLevels,
} from "./voiceAudio";

export interface VoiceLevelMeter {
  levels: number[];
  reset: () => void;
  start: (stream: MediaStream) => void;
  stop: () => void;
}

export function useVoiceLevelMeter(): VoiceLevelMeter {
  const [levels, setLevels] = useState<number[]>(createSilentVoiceLevels);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastSampleAtRef = useRef(0);
  const smoothedLevelRef = useRef(0);

  const stop = useCallback(() => {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current = null;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") void audioContext.close();
    smoothedLevelRef.current = 0;
  }, []);

  const reset = useCallback(() => setLevels(createSilentVoiceLevels()), []);

  const start = useCallback((stream: MediaStream) => {
    stop();
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.55;
    source.connect(analyser);
    audioContextRef.current = audioContext;
    sourceRef.current = source;
    analyserRef.current = analyser;
    lastSampleAtRef.current = 0;
    smoothedLevelRef.current = 0;

    const samples = new Float32Array(analyser.fftSize);
    const sampleLevel = (timestamp: number): void => {
      if (analyserRef.current !== analyser) return;
      if (timestamp - lastSampleAtRef.current >= VOICE_LEVEL_SAMPLE_INTERVAL_MS) {
        analyser.getFloatTimeDomainData(samples);
        const level = calculateVoiceLevel(samples, smoothedLevelRef.current);
        smoothedLevelRef.current = level;
        lastSampleAtRef.current = timestamp;
        setLevels((current) => [...current.slice(1), level]);
      }
      animationFrameRef.current = window.requestAnimationFrame(sampleLevel);
    };
    animationFrameRef.current = window.requestAnimationFrame(sampleLevel);
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { levels, reset, start, stop };
}
