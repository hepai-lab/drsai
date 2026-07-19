import type { DesktopStreamingVoiceTtsAudioSegment } from "@shared/desktopApi";
import type { StreamingAudioPlaybackAdapter, StreamingAudioPlaybackHandle } from "./orderedAudioPlaybackQueue";

export interface BrowserAudioLike {
  currentTime: number;
  preload?: string;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  pause(): void;
  play(): Promise<void>;
  load?(): void;
}

export class BrowserStreamingAudioAdapter implements StreamingAudioPlaybackAdapter {
  readonly createAudio: (url: string) => BrowserAudioLike;
  readonly createUrl: (blob: Blob) => string;
  readonly revokeUrl: (url: string) => void;
  readonly prepared = new Map<string, { url: string; audio: BrowserAudioLike }>();

  constructor(options: { createAudio?: (url: string) => BrowserAudioLike; createUrl?: (blob: Blob) => string; revokeUrl?: (url: string) => void } = {}) {
    this.createAudio = options.createAudio ?? ((url) => new Audio(url) as unknown as BrowserAudioLike);
    this.createUrl = options.createUrl ?? ((blob) => URL.createObjectURL(blob));
    this.revokeUrl = options.revokeUrl ?? ((url) => URL.revokeObjectURL(url));
  }

  prepare(segment: DesktopStreamingVoiceTtsAudioSegment): void {
    const key = this.#key(segment);
    if (this.prepared.has(key)) return;
    const audioBuffer = Uint8Array.from(segment.audioData).buffer as ArrayBuffer;
    const url = this.createUrl(new Blob([audioBuffer], { type: segment.mimeType }));
    const audio = this.createAudio(url);
    audio.preload = "auto";
    audio.load?.();
    this.prepared.set(key, { url, audio });
  }

  release(segment: DesktopStreamingVoiceTtsAudioSegment): void {
    const prepared = this.prepared.get(this.#key(segment));
    if (!prepared) return;
    prepared.audio.pause();
    prepared.audio.onended = null;
    prepared.audio.onerror = null;
    this.revokeUrl(prepared.url);
    this.prepared.delete(this.#key(segment));
  }

  play(segment: DesktopStreamingVoiceTtsAudioSegment, onEnded: () => void, onError: (error: Error) => void): StreamingAudioPlaybackHandle {
    this.prepare(segment);
    const key = this.#key(segment);
    const prepared = this.prepared.get(key)!;
    const { url, audio } = prepared;
    let released = false;
    const release = (): void => { if (!released) { released = true; this.prepared.delete(key); this.revokeUrl(url); } };
    audio.onended = () => { release(); onEnded(); };
    audio.onerror = () => { release(); onError(new Error("The streaming audio segment could not be played.")); };
    void audio.play().catch((error) => { release(); onError(error instanceof Error ? error : new Error(String(error))); });
    return {
      pause: () => audio.pause(),
      resume: () => { void audio.play().catch((error) => onError(error instanceof Error ? error : new Error(String(error)))); },
      stop: () => { audio.pause(); audio.currentTime = 0; audio.onended = null; audio.onerror = null; release(); },
    };
  }

  #key(segment: DesktopStreamingVoiceTtsAudioSegment): string {
    return `${segment.sessionId}:${segment.turnId}:${segment.messageId}:${segment.segmentId}:${segment.segmentIndex}`;
  }
}
