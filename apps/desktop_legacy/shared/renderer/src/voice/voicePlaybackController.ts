import type {
  DesktopVoiceSynthesisEvent,
  DesktopVoiceSynthesisRequest,
  DesktopVoiceSynthesisRuntimeStatus,
  DesktopVoiceSynthesisStartResult,
} from "@shared/desktopApi";

export type VoicePlaybackPhase = "idle" | "synthesizing" | "playing" | "paused" | "failed";
export type VoiceSynthesisMode = "system" | "provider";

export interface VoicePlaybackSnapshot {
  activeMessageId: string | null;
  error: string | null;
  phase: VoicePlaybackPhase;
}

export interface UtteranceLike {
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onstart: (() => void) | null;
  rate: number;
  voice: SpeechSynthesisVoice | null;
}

export interface AudioLike {
  error?: { code: number; message?: string } | null;
  load: () => void;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  pause: () => void;
  play: () => Promise<void>;
  playbackRate: number;
  removeAttribute: (name: string) => void;
}

export interface VoicePlaybackEnvironment {
  createAudio: (url: string) => AudioLike;
  createObjectUrl: (blob: Blob) => string;
  createUtterance: (text: string) => UtteranceLike;
  provider?: {
    cancel: (requestId: string) => Promise<boolean>;
    getStatus: () => Promise<DesktopVoiceSynthesisRuntimeStatus>;
    start: (request: DesktopVoiceSynthesisRequest) => Promise<DesktopVoiceSynthesisStartResult>;
    subscribe: (callback: (event: DesktopVoiceSynthesisEvent) => void) => () => void;
  };
  revokeObjectUrl: (url: string) => void;
  selectVoice: (voices: SpeechSynthesisVoice[], language: "zh" | "en", preferredName: string) => SpeechSynthesisVoice | null;
  system?: {
    cancel: () => void;
    getVoices: () => SpeechSynthesisVoice[];
    pause: () => void;
    resume: () => void;
    speak: (utterance: UtteranceLike) => void;
  };
}

export interface VoicePlaybackRequest {
  language: "zh" | "en";
  messageId: string;
  mode: VoiceSynthesisMode;
  rate: number;
  text: string;
  voiceName: string;
}

export class VoicePlaybackController {
  private audio: AudioLike | null = null;
  private audioUrl: string | null = null;
  private disposed = false;
  private readonly environment: VoicePlaybackEnvironment;
  private generation = 0;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private requestId: string | null = null;
  private snapshot: VoicePlaybackSnapshot = { activeMessageId: null, error: null, phase: "idle" };
  private readonly onChange: (snapshot: VoicePlaybackSnapshot) => void;
  private unsubscribe: (() => void) | null = null;
  private utterance: UtteranceLike | null = null;

  constructor(
    environment: VoicePlaybackEnvironment,
    onChange: (snapshot: VoicePlaybackSnapshot) => void,
  ) {
    this.environment = environment;
    this.onChange = onChange;
  }

  get isAvailable(): boolean {
    return Boolean(this.environment.system || this.environment.provider);
  }

  play(request: VoicePlaybackRequest): void {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.release(true);
    const normalized = { ...request, rate: Math.min(2, Math.max(0.5, request.rate)) };
    if (normalized.mode === "provider" && this.environment.provider) {
      this.update({ activeMessageId: request.messageId, error: null, phase: "synthesizing" });
      void this.playProvider(generation, normalized);
    } else if (normalized.mode === "system" && this.environment.provider) {
      // Electron Chromium speechSynthesis is unreliable on Windows; prefer native SAPI WAV.
      this.update({ activeMessageId: request.messageId, error: null, phase: "synthesizing" });
      void this.playProvider(generation, normalized, { runtime: "system" });
    } else {
      this.update({ activeMessageId: request.messageId, error: null });
      this.playSystem(normalized);
    }
  }

  pause(): boolean {
    if (this.snapshot.phase !== "playing") return false;
    if (this.audio) this.audio.pause();
    else if (this.utterance && this.environment.system) this.environment.system.pause();
    else return false;
    this.update({ phase: "paused" });
    return true;
  }

  resume(): boolean {
    if (this.snapshot.phase !== "paused") return false;
    if (this.audio) void this.audio.play().catch((error: unknown) => this.handleAudioError("en", error));
    else if (this.utterance && this.environment.system) this.environment.system.resume();
    else return false;
    this.update({ phase: "playing" });
    return true;
  }

  stop(): void {
    if (this.disposed) return;
    this.generation += 1;
    this.release(true);
    this.update({ activeMessageId: null, error: null, phase: "idle" });
  }

  dispose(): void {
    if (this.disposed) return;
    this.generation += 1;
    this.release(true);
    this.disposed = true;
  }

  private playSystem(request: VoicePlaybackRequest): void {
    const system = this.environment.system;
    if (!system) {
      this.update({ activeMessageId: request.messageId, error: localize(request.language, "当前系统不支持语音播报。", "System speech playback is unavailable."), phase: "failed" });
      return;
    }
    // Chromium often leaves speechSynthesis paused after cancel(); clear that before speaking.
    system.cancel();
    system.resume();

    const voices = system.getVoices();
    const utterance = this.environment.createUtterance(request.text);
    utterance.lang = request.language === "zh" ? "zh-CN" : "en-US";
    utterance.rate = request.rate;
    utterance.voice = this.environment.selectVoice(voices, request.language, request.voiceName);
    utterance.onstart = () => {
      if (this.utterance === utterance) {
        this.update({ phase: "playing" });
        this.startSystemKeepalive(system);
      }
    };
    utterance.onend = () => {
      if (this.utterance !== utterance) return;
      this.clearSystemKeepalive();
      this.utterance = null;
      this.update({ activeMessageId: null, phase: "idle" });
    };
    utterance.onerror = (event) => {
      if (this.utterance !== utterance) return;
      this.clearSystemKeepalive();
      this.utterance = null;
      if (event.error === "canceled" || event.error === "interrupted") {
        this.update({ activeMessageId: null, phase: "idle" });
      } else {
        const detail = describeError(event.error, event.message);
        this.update({ activeMessageId: request.messageId, error: localize(request.language, `系统语音播放失败（${detail}）。`, `Speech playback failed (${detail}).`), phase: "failed" });
      }
    };
    this.utterance = utterance;
    this.update({ phase: "playing" });

    // Re-select voice if the first getVoices() returned empty (common on first use).
    if (!utterance.voice) {
      utterance.voice = this.environment.selectVoice(system.getVoices(), request.language, request.voiceName);
    }
    system.speak(utterance);
    // Some Chromium builds queue the utterance but stay paused with no audio.
    system.resume();
  }

  private startSystemKeepalive(system: NonNullable<VoicePlaybackEnvironment["system"]>): void {
    this.clearSystemKeepalive();
    // Chromium Google / remote voices can silently stall on longer text; nudge every ~12s.
    this.keepaliveTimer = setInterval(() => {
      if (this.snapshot.phase !== "playing" || !this.utterance) {
        this.clearSystemKeepalive();
        return;
      }
      try {
        system.pause();
        system.resume();
      } catch {
        // Ignore keepalive failures; end/error handlers own lifecycle.
      }
    }, 12_000);
  }

  private clearSystemKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private async playProvider(
    generation: number,
    request: VoicePlaybackRequest,
    options?: { runtime?: "system" },
  ): Promise<void> {
    const provider = this.environment.provider;
    if (!provider) return;
    let terminal = false;
    let boundRequestId: string | null = null;
    const pendingEvents: DesktopVoiceSynthesisEvent[] = [];
    try {
      if (options?.runtime !== "system") {
        const status = await provider.getStatus();
        if (!this.isCurrent(generation)) return;
        if (status.state !== "ready" || !status.supportsSynthesisTask) {
          this.update({
            activeMessageId: request.messageId,
            error: status.message || localize(
              request.language,
              "在线语音服务当前不可用，请重试或在设置中选择 Windows 本地朗读。",
              "The speech provider is unavailable. Try again or select Windows system speech in settings.",
            ),
            phase: "failed",
          });
          return;
        }
      }

      const handleEvent = (event: DesktopVoiceSynthesisEvent): void => {
        if (!this.isCurrent(generation) || terminal) return;
        if (!boundRequestId) {
          if (event.type === "accepted") {
            boundRequestId = event.requestId;
            this.requestId = event.requestId;
          } else {
            pendingEvents.push(event);
            return;
          }
        }
        if (event.requestId !== boundRequestId) return;
        if (event.type === "progress") {
          this.update({ phase: "synthesizing" });
        } else if (event.type === "completed") {
          terminal = true;
          this.requestId = null;
          this.unsubscribe?.();
          this.unsubscribe = null;
          const audioBytes = normalizeAudioBytes(event.result.audioData);
          if (audioBytes.byteLength < 44) {
            this.update({
              activeMessageId: request.messageId,
              error: localize(request.language, "语音合成返回了空音频。", "Speech synthesis returned empty audio."),
              phase: "failed",
            });
            return;
          }
          // Copy bytes so the Blob owns a stable buffer (IPC views can be detached).
          const stableBytes = audioBytes.slice();
          const mimeType = event.result.mimeType || "audio/wav";
          const audioUrl = this.environment.createObjectUrl(new Blob([stableBytes], { type: mimeType }));
          const audio = this.environment.createAudio(audioUrl);
          audio.playbackRate = request.rate;
          this.audioUrl = audioUrl;
          this.audio = audio;
          audio.onended = () => {
            if (this.audio !== audio) return;
            this.release(false);
            this.update({ activeMessageId: null, phase: "idle" });
          };
          audio.onerror = () => this.handleAudioError(request.language, audio.error);
          this.update({ phase: "playing" });
          void audio.play().catch((error: unknown) => this.handleAudioError(request.language, error));
        } else if (event.type === "failed" || event.type === "cancelled") {
          terminal = true;
          this.release(false);
          if (event.type === "cancelled") {
            this.update({ activeMessageId: null, phase: "idle" });
          } else {
            this.update({ activeMessageId: request.messageId, error: event.error.message, phase: "failed" });
          }
        }
      };

      this.unsubscribe = provider.subscribe(handleEvent);
      const started = await provider.start({
        text: request.text,
        language: request.language === "zh" ? "zh-CN" : "en-US",
        voice: request.voiceName || undefined,
        speed: request.rate,
        format: options?.runtime === "system" ? "wav" : "mp3",
        runtime: options?.runtime,
      });
      if (!this.isCurrent(generation)) {
        this.unsubscribe?.();
        this.unsubscribe = null;
        void provider.cancel(started.requestId);
        return;
      }
      boundRequestId = started.requestId;
      this.requestId = started.requestId;
      if (!terminal) this.update({ phase: "synthesizing" });
      for (const event of pendingEvents.splice(0)) handleEvent(event);
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      // Fall back to in-renderer speechSynthesis if native system TTS fails.
      if (options?.runtime === "system" && this.environment.system) {
        this.playSystem(request);
        return;
      }
      this.release(false);
      this.update({ activeMessageId: request.messageId, error: error instanceof Error ? error.message : localize(request.language, "语音合成失败。", "Voice synthesis failed."), phase: "failed" });
    }
  }

  private handleAudioError(language: "zh" | "en" = "en", cause?: unknown): void {
    if (!this.audio) return;
    const activeMessageId = this.snapshot.activeMessageId;
    const detail = describeUnknownError(cause);
    this.release(false);
    this.update({
      activeMessageId,
      error: localize(
        language,
        `合成音频无法播放${detail ? `（${detail}）` : ""}，请重试或切换为 Windows 本地朗读。`,
        `Synthesized audio could not be played${detail ? ` (${detail})` : ""}. Try again or use Windows system speech.`,
      ),
      phase: "failed",
    });
  }

  private release(cancelRemote: boolean): void {
    this.clearSystemKeepalive();
    this.environment.system?.cancel();
    this.utterance = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    if (this.audioUrl) {
      this.environment.revokeObjectUrl(this.audioUrl);
      this.audioUrl = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    const requestId = this.requestId;
    this.requestId = null;
    if (cancelRemote && requestId && this.environment.provider) void this.environment.provider.cancel(requestId);
  }

  private update(updates: Partial<VoicePlaybackSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...updates };
    this.onChange(this.snapshot);
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && this.generation === generation;
  }
}

function localize(language: "zh" | "en", zh: string, en: string): string {
  return language === "zh" ? zh : en;
}

function normalizeAudioBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (value && typeof value === "object" && ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (value && typeof value === "object" && "data" in value && Array.isArray((value as { data: unknown }).data)) {
    return Uint8Array.from((value as { data: number[] }).data);
  }
  return Uint8Array.from(value as ArrayLike<number>);
}

function describeError(code: string, message?: string): string {
  return message?.trim() ? `${code}: ${message.trim()}` : code;
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return describeError(error.name, error.message);
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; message?: unknown; name?: unknown };
    const name = typeof value.name === "string"
      ? value.name
      : typeof value.code === "number"
        ? `media code ${value.code}`
        : "";
    const message = typeof value.message === "string" ? value.message : "";
    return name ? describeError(name, message) : message;
  }
  return typeof error === "string" ? error : "";
}
