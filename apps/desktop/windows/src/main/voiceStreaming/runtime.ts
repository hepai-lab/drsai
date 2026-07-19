import type {
  DesktopStreamingVoiceAudioChunk,
  DesktopStreamingVoiceCapabilities,
  DesktopStreamingVoiceStartRequest,
  DesktopStreamingVoiceTranscriptionEvent,
  DesktopVoiceRuntimeId,
} from "../../shared/desktopApi";

export interface StreamingTranscriptionRuntimeContext {
  sessionId: string;
  turnId: string;
  request: DesktopStreamingVoiceStartRequest;
  emit: (event: DesktopStreamingVoiceTranscriptionEvent) => void;
}

export interface StreamingTranscriptionRuntime {
  readonly id: DesktopVoiceRuntimeId;
  readonly capabilities: DesktopStreamingVoiceCapabilities;
  start(): void | Promise<void>;
  pushAudio(chunk: DesktopStreamingVoiceAudioChunk): boolean;
  endInput(reason?: "provider" | "local_vad" | "manual"): boolean;
  cancel(): boolean;
  dispose(): void;
}

export interface StreamingTranscriptionRuntimeFactory {
  readonly id: DesktopVoiceRuntimeId;
  getCapabilities(): DesktopStreamingVoiceCapabilities;
  create(context: StreamingTranscriptionRuntimeContext): StreamingTranscriptionRuntime;
}
