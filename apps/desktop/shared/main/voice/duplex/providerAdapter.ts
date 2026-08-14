import type {
  DesktopDuplexVoiceAudioChunk,
  DesktopDuplexVoiceCapabilities,
  DesktopDuplexVoiceError,
  DesktopDuplexVoiceSessionStartRequest,
} from "../../../api/desktopApi";

export interface DuplexRealtimeConnection {
  url: string;
  headers: Readonly<Record<string, string>>;
}

export type DuplexProviderEvent =
  | { type: "session_ready"; capabilities: DesktopDuplexVoiceCapabilities }
  | { type: "input_audio_ack"; acknowledgedSequence: number; bufferedAudioMs: number }
  | { type: "input_speech_started"; itemId?: string; audioStartMs?: number }
  | { type: "input_speech_stopped"; itemId?: string; audioEndMs?: number }
  | { type: "input_transcript_delta"; itemId: string; contentIndex: number; text: string }
  | { type: "input_transcript_completed"; itemId: string; text: string }
  | { type: "response_started"; responseId: string }
  | { type: "response_audio_delta"; responseId: string; itemId: string; contentIndex: number; providerSequence: number; audioData: Uint8Array }
  | { type: "response_audio_completed"; responseId: string; itemId: string; contentIndex: number }
  | { type: "response_transcript_delta"; responseId: string; itemId: string; contentIndex: number; text: string }
  | { type: "response_transcript_completed"; responseId: string; itemId: string; text: string }
  | { type: "tool_call"; callId: string; itemId: string; name: string; argumentsJson: string }
  | { type: "response_completed"; responseId: string; status: "completed" | "cancelled" | "failed" }
  | { type: "provider_error"; error: DesktopDuplexVoiceError };

export interface DuplexRealtimeProviderAdapter {
  readonly providerId: string;
  readonly capabilities: DesktopDuplexVoiceCapabilities;
  resolveConnection(baseUrl: string, authorization: string): DuplexRealtimeConnection;
  createSessionUpdate(request: DesktopDuplexVoiceSessionStartRequest): Record<string, unknown>;
  createInputAudioAppend(chunk: DesktopDuplexVoiceAudioChunk): Record<string, unknown>;
  createInputAudioCommit(): Record<string, unknown>;
  createInputAudioClear(): Record<string, unknown>;
  createResponseCancel(responseId?: string): Record<string, unknown>;
  createConversationTruncate(itemId: string, contentIndex: number, audioEndMs: number): Record<string, unknown>;
  createToolResult(callId: string, output: string): Record<string, unknown>;
  decodeEvent(raw: string): DuplexProviderEvent[];
}
