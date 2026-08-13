import type {
  DesktopDuplexVoiceAudioChunk,
  DesktopDuplexVoiceCapabilities,
  DesktopDuplexVoiceError,
  DesktopDuplexVoiceSessionStartRequest,
} from "../../../api/desktopApi";
import type { DuplexProviderEvent, DuplexRealtimeConnection, DuplexRealtimeProviderAdapter } from "./providerAdapter";

const MAX_PROVIDER_EVENT_BYTES = 512 * 1024;
const MAX_AUDIO_DELTA_BYTES = 2 * 1024 * 1024;
const MAX_TOOL_ARGUMENT_BYTES = 256 * 1024;

export const ZHIZENGZENG_REALTIME_CAPABILITIES = Object.freeze({
  protocolVersion: 1,
  inputAudioEncodings: ["pcm_s16le"],
  outputAudioEncodings: ["pcm_s16le"],
  inputSampleRatesHz: [24_000],
  outputSampleRatesHz: [24_000],
  supportsInputTranscription: true,
  supportsOutputTranscription: true,
  supportsServerVad: true,
  supportsResponseCancel: true,
  supportsConversationTruncation: true,
  supportsToolCalling: true,
  supportsSessionResume: false,
  maxUplinkBufferedAudioMs: 2_000,
  maxPlaybackBufferedAudioMs: 3_000,
  maxSessionDurationSeconds: 30 * 60,
} satisfies DesktopDuplexVoiceCapabilities);

export interface ZhizengzengRealtimeAdapterOptions {
  protocol?: "ga" | "legacy-beta";
  transcriptionModel?: string;
  tools?: Array<{ type: "function"; name: string; description?: string; parameters: Record<string, unknown> }>;
}

export class ZhizengzengRealtimeAdapter implements DuplexRealtimeProviderAdapter {
  readonly providerId = "zhizengzeng";
  readonly capabilities = ZHIZENGZENG_REALTIME_CAPABILITIES;
  readonly options: ZhizengzengRealtimeAdapterOptions;
  #audioSequence = 0;

  constructor(options: ZhizengzengRealtimeAdapterOptions = {}) {
    this.options = options;
  }

  resolveConnection(baseUrl: string, authorization: string): DuplexRealtimeConnection {
    const url = resolveZhizengzengRealtimeUrl(baseUrl);
    const normalizedAuthorization = validateAuthorization(authorization);
    return {
      url: url.toString(),
      headers: Object.freeze({
        Authorization: normalizedAuthorization,
        ...(this.options.protocol === "legacy-beta" ? { "OpenAI-Beta": "realtime=v1" } : {}),
      }),
    };
  }

  createSessionUpdate(request: DesktopDuplexVoiceSessionStartRequest): Record<string, unknown> {
    validateStartRequest(request, this.capabilities);
    if (this.options.protocol !== "legacy-beta") return this.#createGaSessionUpdate(request);
    const session: Record<string, unknown> = {
      modalities: ["text", "audio"],
      model: request.modelId,
      input_audio_format: "pcm16",
      output_audio_format: "pcm16",
      turn_detection: request.enableServerVad
        ? { type: "server_vad", create_response: true, interrupt_response: true }
        : null,
      tool_choice: request.enableToolCalling ? "auto" : "none",
      tools: request.enableToolCalling ? this.options.tools ?? [] : [],
    };
    if (request.voice) session.voice = boundedText(request.voice, 80, "voice");
    if (request.instructions) session.instructions = boundedText(request.instructions, 32_000, "instructions");
    if (request.enableInputTranscription && this.options.transcriptionModel) {
      session.input_audio_transcription = { model: boundedText(this.options.transcriptionModel, 240, "transcription model") };
    }
    return { type: "session.update", session };
  }

  #createGaSessionUpdate(request: DesktopDuplexVoiceSessionStartRequest): Record<string, unknown> {
    const input: Record<string, unknown> = {
      format: { type: "audio/pcm", rate: request.inputSampleRateHz },
      turn_detection: request.enableServerVad
        ? { type: "server_vad", create_response: true, interrupt_response: true }
        : null,
    };
    if (request.enableInputTranscription && this.options.transcriptionModel) {
      input.transcription = { model: boundedText(this.options.transcriptionModel, 240, "transcription model") };
    }
    const output: Record<string, unknown> = {
      format: { type: "audio/pcm", rate: request.outputSampleRateHz },
      ...(request.voice ? { voice: boundedText(request.voice, 80, "voice") } : {}),
    };
    const session: Record<string, unknown> = {
      type: "realtime",
      model: request.modelId,
      output_modalities: ["audio"],
      audio: { input, output },
      tool_choice: request.enableToolCalling ? "auto" : "none",
      tools: request.enableToolCalling ? this.options.tools ?? [] : [],
    };
    if (request.instructions) session.instructions = boundedText(request.instructions, 32_000, "instructions");
    return { type: "session.update", session };
  }

  createInputAudioAppend(chunk: DesktopDuplexVoiceAudioChunk): Record<string, unknown> {
    validateAudioChunk(chunk, this.capabilities);
    return { type: "input_audio_buffer.append", event_id: `opendrsai_audio_${chunk.sequence}`, audio: bytesToBase64(chunk.audioData) };
  }

  createInputAudioCommit(): Record<string, unknown> { return { type: "input_audio_buffer.commit" }; }
  createInputAudioClear(): Record<string, unknown> { return { type: "input_audio_buffer.clear" }; }

  createResponseCancel(responseId?: string): Record<string, unknown> {
    return { type: "response.cancel", ...(responseId ? { response_id: providerId(responseId, "response ID") } : {}) };
  }

  createConversationTruncate(itemId: string, contentIndex: number, audioEndMs: number): Record<string, unknown> {
    return {
      type: "conversation.item.truncate",
      item_id: providerId(itemId, "item ID"),
      content_index: nonNegativeInteger(contentIndex, "content index"),
      audio_end_ms: nonNegativeInteger(audioEndMs, "audio end"),
    };
  }

  createToolResult(callId: string, output: string): Record<string, unknown> {
    return {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: providerId(callId, "call ID"),
        output: boundedText(output, MAX_TOOL_ARGUMENT_BYTES, "tool output"),
      },
    };
  }

  decodeEvent(raw: string): DuplexProviderEvent[] {
    if (typeof raw !== "string" || byteLength(raw) > MAX_PROVIDER_EVENT_BYTES) return [providerFailure("protocol", "Realtime Provider event is invalid or oversized.", false)];
    let event: Record<string, unknown>;
    try { event = JSON.parse(raw) as Record<string, unknown>; }
    catch { return [providerFailure("protocol", "Realtime Provider returned invalid JSON.", false)]; }
    if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") {
      return [providerFailure("protocol", "Realtime Provider event has no valid type.", false)];
    }
    try { return this.#decode(event); }
    catch (error) { return [providerFailure("protocol", error instanceof Error ? error.message : "Realtime Provider event is invalid.", false)]; }
  }

  #decode(event: Record<string, unknown>): DuplexProviderEvent[] {
    const type = String(event.type);
    if (type === "opendrsai.input_audio_ack") return [{ type: "input_audio_ack", acknowledgedSequence: nonNegativeInteger(event.sequence, "acknowledged sequence"), bufferedAudioMs: integerOr(event.buffered_audio_ms, 0) }];
    if (type === "session.created" || type === "session.updated") return [{ type: "session_ready", capabilities: this.capabilities }];
    if (type === "input_audio_buffer.committed") return [{ type: "input_audio_ack", acknowledgedSequence: integerOr(event.sequence, -1), bufferedAudioMs: 0 }];
    if (type === "input_audio_buffer.speech_started") return [{ type: "input_speech_started", itemId: optionalId(event.item_id), audioStartMs: optionalInteger(event.audio_start_ms) }];
    if (type === "input_audio_buffer.speech_stopped") return [{ type: "input_speech_stopped", itemId: optionalId(event.item_id), audioEndMs: optionalInteger(event.audio_end_ms) }];
    if (type === "conversation.item.input_audio_transcription.delta") return [{ type: "input_transcript_delta", itemId: providerId(event.item_id, "item ID"), contentIndex: integerOr(event.content_index, 0), text: textValue(event.delta, "transcript delta") }];
    if (type === "conversation.item.input_audio_transcription.completed") return [{ type: "input_transcript_completed", itemId: providerId(event.item_id, "item ID"), text: textValue(event.transcript, "transcript") }];
    if (type === "response.created") return [{ type: "response_started", responseId: nestedId(event.response, "response") }];
    if (type === "response.audio.delta" || type === "response.output_audio.delta") {
      const audioData = base64ToBytes(audioBase64Value(event.delta));
      if (audioData.byteLength > MAX_AUDIO_DELTA_BYTES) throw new Error("Realtime Provider audio delta is oversized.");
      return [{ type: "response_audio_delta", responseId: providerId(event.response_id, "response ID"), itemId: providerId(event.item_id, "item ID"), contentIndex: integerOr(event.content_index, 0), providerSequence: this.#audioSequence++, audioData }];
    }
    if (type === "response.audio.done" || type === "response.output_audio.done") return [{ type: "response_audio_completed", responseId: providerId(event.response_id, "response ID"), itemId: providerId(event.item_id, "item ID"), contentIndex: integerOr(event.content_index, 0) }];
    if (type === "response.audio_transcript.delta" || type === "response.output_audio_transcript.delta") return [{ type: "response_transcript_delta", responseId: providerId(event.response_id, "response ID"), itemId: providerId(event.item_id, "item ID"), contentIndex: integerOr(event.content_index, 0), text: textValue(event.delta, "transcript delta") }];
    if (type === "response.audio_transcript.done" || type === "response.output_audio_transcript.done") return [{ type: "response_transcript_completed", responseId: providerId(event.response_id, "response ID"), itemId: providerId(event.item_id, "item ID"), text: textValue(event.transcript, "transcript") }];
    if (type === "response.function_call_arguments.done") return [{ type: "tool_call", callId: providerId(event.call_id, "call ID"), itemId: providerId(event.item_id, "item ID"), name: providerId(event.name, "tool name"), argumentsJson: validArguments(event.arguments) }];
    if (type === "response.done") {
      const response = recordValue(event.response, "response");
      const status = response.status === "cancelled" ? "cancelled" : response.status === "failed" || response.status === "incomplete" ? "failed" : "completed";
      return [{ type: "response_completed", responseId: providerId(response.id, "response ID"), status }];
    }
    if (type === "error") {
      const detail = recordValue(event.error, "error");
      return [providerFailure(mapProviderErrorCode(detail.code), typeof detail.message === "string" ? detail.message : "Realtime Provider failed.", detail.code === "rate_limit_exceeded" || detail.code === "server_error", typeof detail.code === "string" ? detail.code : undefined)];
    }
    return [];
  }
}

export function resolveZhizengzengRealtimeUrl(value: string): URL {
  let source: URL;
  try { source = new URL(value); } catch { throw new Error("Realtime Provider base URL is invalid."); }
  if (source.protocol !== "https:" || source.username || source.password || source.hash || source.search) throw new Error("Realtime Provider base URL must be clean HTTPS.");
  if (!source.hostname || source.hostname === "localhost" || source.hostname === "127.0.0.1" || source.hostname === "[::1]") throw new Error("Zhizengzeng Realtime Provider must use a non-loopback HTTPS host.");
  source.protocol = "wss:";
  const path = source.pathname.replace(/\/+$/, "");
  source.pathname = path.endsWith("/realtime") ? path : path.endsWith("/v1") ? `${path}/realtime` : `${path}/v1/realtime`;
  return source;
}

function validateStartRequest(request: DesktopDuplexVoiceSessionStartRequest, capabilities: DesktopDuplexVoiceCapabilities): void {
  if (request.protocolVersion !== 1 || request.channels !== 1) throw new Error("Realtime Session protocol or channels are unsupported.");
  providerId(request.sessionId, "session ID");
  providerId(request.providerId, "Provider ID");
  providerId(request.modelId, "model ID");
  if (request.providerId !== "zhizengzeng") throw new Error("Realtime Session Provider binding is invalid.");
  if (!request.modelId.toLowerCase().split("/").at(-1)?.startsWith("gpt-realtime")) throw new Error("Realtime Session model binding is invalid.");
  if (!capabilities.inputAudioEncodings.includes(request.inputEncoding) || !capabilities.outputAudioEncodings.includes(request.outputEncoding)) throw new Error("Realtime Session audio encoding is unsupported.");
  if (!capabilities.inputSampleRatesHz.includes(request.inputSampleRateHz) || !capabilities.outputSampleRatesHz.includes(request.outputSampleRateHz)) throw new Error("Realtime Session sample rate is unsupported.");
  if (request.enableToolCalling && !capabilities.supportsToolCalling) throw new Error("Realtime Session tool calling is unsupported.");
}

function validateAudioChunk(chunk: DesktopDuplexVoiceAudioChunk, capabilities: DesktopDuplexVoiceCapabilities): void {
  if (chunk.protocolVersion !== 1 || chunk.channels !== 1 || !Number.isSafeInteger(chunk.sequence) || chunk.sequence < 0) throw new Error("Realtime audio chunk identity is invalid.");
  if (!Number.isFinite(chunk.capturedAtMs) || chunk.capturedAtMs < 0) throw new Error("Realtime audio capture timestamp is invalid.");
  providerId(chunk.sessionId, "session ID");
  if (!capabilities.inputAudioEncodings.includes(chunk.encoding) || !capabilities.inputSampleRatesHz.includes(chunk.sampleRateHz)) throw new Error("Realtime audio chunk format is unsupported.");
  if (!Number.isFinite(chunk.durationMs) || chunk.durationMs <= 0 || chunk.durationMs > 1_000 || chunk.audioData.byteLength === 0 || chunk.audioData.byteLength > 512_000) throw new Error("Realtime audio chunk bounds are invalid.");
}

function validateAuthorization(value: string): string {
  const normalized = value.trim();
  if (!/^Bearer [^\s\r\n]{8,8192}$/.test(normalized)) throw new Error("Realtime Provider authorization is invalid.");
  return normalized;
}

function bytesToBase64(value: Uint8Array): string { return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64"); }
function base64ToBytes(value: string): Uint8Array {
  if (!value || value.length > Math.ceil(MAX_AUDIO_DELTA_BYTES / 3) * 4 + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("Realtime Provider audio delta is invalid.");
  return new Uint8Array(Buffer.from(value, "base64"));
}
function byteLength(value: string): number { return Buffer.byteLength(value, "utf8"); }
function boundedText(value: string, limit: number, label: string): string { const text = value.trim(); if (!text || text.length > limit || /\0/.test(text)) throw new Error(`Realtime ${label} is invalid.`); return text; }
function providerId(value: unknown, label: string): string { if (typeof value !== "string" || !value || value.length > 512 || /[\r\n\0]/.test(value)) throw new Error(`Realtime ${label} is invalid.`); return value; }
function optionalId(value: unknown): string | undefined { return value === undefined ? undefined : providerId(value, "item ID"); }
function optionalInteger(value: unknown): number | undefined { return value === undefined ? undefined : nonNegativeInteger(value, "timestamp"); }
function nonNegativeInteger(value: unknown, label: string): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`Realtime ${label} is invalid.`); return Number(value); }
function integerOr(value: unknown, fallback: number): number { return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback; }
function textValue(value: unknown, label: string): string { if (typeof value !== "string" || value.length > MAX_TOOL_ARGUMENT_BYTES || /\0/.test(value)) throw new Error(`Realtime ${label} is invalid.`); return value; }
function audioBase64Value(value: unknown): string { if (typeof value !== "string" || value.length > Math.ceil(MAX_AUDIO_DELTA_BYTES / 3) * 4 + 8 || /\0/.test(value)) throw new Error("Realtime audio delta is invalid."); return value; }
function recordValue(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Realtime ${label} is invalid.`); return value as Record<string, unknown>; }
function nestedId(value: unknown, label: string): string { return providerId(recordValue(value, label).id, `${label} ID`); }
function validArguments(value: unknown): string { const text = textValue(value, "tool arguments"); try { const parsed = JSON.parse(text); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); } catch { throw new Error("Realtime tool arguments are invalid."); } return text; }
function mapProviderErrorCode(code: unknown): DesktopDuplexVoiceError["code"] { const value = String(code ?? "").toLowerCase(); if (value.includes("auth") || value.includes("key")) return "auth"; if (value.includes("model")) return "model"; if (value.includes("rate")) return "rate_limit"; if (value.includes("server") || value.includes("connection")) return "network"; return "protocol"; }
function providerFailure(code: DesktopDuplexVoiceError["code"], message: string, retryable: boolean, providerCode?: string): DuplexProviderEvent { return { type: "provider_error", error: { code, message, retryable, ...(providerCode ? { providerCode } : {}) } }; }
