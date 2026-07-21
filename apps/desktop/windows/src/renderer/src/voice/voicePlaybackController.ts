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
  onerror: ((event: { error: string }) => void) | null;
  onstart: (() => void) | null;
  rate: number;
  voice: SpeechSynthesisVoice | null;
}

export interface AudioLike {
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
    this.update({ activeMessageId: request.messageId, error: null });
    const normalized = { ...request, rate: Math.min(2, Math.max(0.5, request.rate)) };
    if (normalized.mode === "provider" && this.environment.provider) {
      this.update({ phase: "synthesizing" });
      void this.playProvider(generation, normalized);
    } else {
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
    if (this.audio) void this.audio.play().catch(() => this.handleAudioError());
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
      this.update({ activeMessageId: null, error: localize(request.language, "当前系统不支持语音播报。", "System speech playback is unavailable."), phase: "failed" });
      return;
    }
    const utterance = this.environment.createUtterance(request.text);
    utterance.lang = request.language === "zh" ? "zh-CN" : "en-US";
    utterance.rate = request.rate;
    utterance.voice = this.environment.selectVoice(system.getVoices(), request.language, request.voiceName);
    utterance.onstart = () => {
      if (this.utterance === utterance) this.update({ phase: "playing" });
    };
    utterance.onend = () => {
      if (this.utterance !== utterance) return;
      this.utterance = null;
      this.update({ activeMessageId: null, phase: "idle" });
    };
    utterance.onerror = (event) => {
      if (this.utterance !== utterance) return;
      this.utterance = null;
      if (event.error === "canceled" || event.error === "interrupted") {
        this.update({ activeMessageId: null, phase: "idle" });
      } else {
        this.update({ activeMessageId: null, error: localize(request.language, "语音播报失败，请重试。", "Speech playback failed. Please try again."), phase: "failed" });
      }
    };
    this.utterance = utterance;
    this.update({ phase: "playing" });
    system.speak(utterance);
  }

  private async playProvider(generation: number, request: VoicePlaybackRequest): Promise<void> {
    const provider = this.environment.provider;
    if (!provider) return;
    let terminal = false;
    try {
      const status = await provider.getStatus();
      if (!this.isCurrent(generation)) return;
      if (status.state !== "ready" || !status.supportsSynthesisTask) {
        this.update({
          activeMessageId: null,
          error: status.message || localize(
            request.language,
            "在线语音服务当前不可用，请重试或在设置中选择 Windows 本地朗读。",
            "The speech provider is unavailable. Try again or select Windows system speech in settings.",
          ),
          phase: "failed",
        });
        return;
      }
      this.unsubscribe = provider.subscribe((event) => {
        if (!this.isCurrent(generation)) return;
        if (!this.requestId && event.type === "accepted") this.requestId = event.requestId;
        if (!this.requestId || event.requestId !== this.requestId) return;
        if (event.type === "progress") {
          this.update({ phase: "synthesizing" });
        } else if (event.type === "completed") {
          terminal = true;
          this.requestId = null;
          this.unsubscribe?.();
          this.unsubscribe = null;
          const audioBytes = Uint8Array.from(event.result.audioData);
          const audioUrl = this.environment.createObjectUrl(new Blob([audioBytes.buffer], { type: event.result.mimeType }));
          const audio = this.environment.createAudio(audioUrl);
          audio.playbackRate = request.rate;
          this.audioUrl = audioUrl;
          this.audio = audio;
          audio.onended = () => {
            if (this.audio !== audio) return;
            this.release(false);
            this.update({ activeMessageId: null, phase: "idle" });
          };
          audio.onerror = () => this.handleAudioError(request.language);
          this.update({ phase: "playing" });
          void audio.play().catch(() => this.handleAudioError(request.language));
        } else if (event.type === "failed" || event.type === "cancelled") {
          terminal = true;
          this.release(false);
          if (event.type === "cancelled") {
            this.update({ activeMessageId: null, phase: "idle" });
          } else {
            this.update({ activeMessageId: null, error: event.error.message, phase: "failed" });
          }
        }
      });
      const started = await provider.start({
        text: request.text,
        language: request.language === "zh" ? "zh-CN" : "en-US",
        voice: request.voiceName || undefined,
        speed: request.rate,
        format: "mp3",
      });
      if (!this.isCurrent(generation)) {
        this.unsubscribe?.();
        this.unsubscribe = null;
        void provider.cancel(started.requestId);
        return;
      }
      if (!terminal) this.requestId ??= started.requestId;
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.release(false);
      this.update({ activeMessageId: null, error: error instanceof Error ? error.message : localize(request.language, "语音合成失败。", "Voice synthesis failed."), phase: "failed" });
    }
  }

  private handleAudioError(language: "zh" | "en" = "en"): void {
    if (!this.audio) return;
    this.release(false);
    this.update({ activeMessageId: null, error: localize(language, "合成音频无法播放，请切换为系统声音。", "Synthesized audio could not be played. Try system speech."), phase: "failed" });
  }

  private release(cancelRemote: boolean): void {
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
