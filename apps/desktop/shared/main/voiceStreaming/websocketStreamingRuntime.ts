import type {
  DesktopStreamingVoiceAudioChunk,
  DesktopStreamingVoiceCapabilities,
  DesktopStreamingVoiceStartRequest,
  DesktopStreamingVoiceTranscriptionEvent,
} from "../../api/desktopApi";
import { normalizeStreamingVoiceError } from "./errors";
import type { StreamingTranscriptionRuntime } from "./runtime";

export interface StreamingProviderSocket {
  readonly readyState: number;
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: Event | MessageEvent) => void): void;
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export interface WebSocketStreamingRuntimeOptions {
  url: string;
  token?: string;
  sessionId: string;
  turnId: string;
  request: DesktopStreamingVoiceStartRequest;
  emit: (event: DesktopStreamingVoiceTranscriptionEvent) => void;
  createSocket?: (url: string) => StreamingProviderSocket;
}

const CONNECTING_BUFFER_LIMIT = 5;
const MAX_PROVIDER_MESSAGE_BYTES = 256_000;
type ProviderTranscriptionEvent = DesktopStreamingVoiceTranscriptionEvent extends infer Event
  ? Event extends DesktopStreamingVoiceTranscriptionEvent ? Omit<Event, "sessionId" | "turnId" | "sequence"> : never
  : never;

export const WEBSOCKET_STREAMING_CAPABILITIES: DesktopStreamingVoiceCapabilities = {
  serialStt: true, serialTts: true, streamingStt: true, streamingTts: false,
  audioEncodings: ["pcm_s16le"], sampleRatesHz: [16_000, 24_000, 48_000],
  supportsPartialTranscripts: true, supportsProviderEndpointing: true, supportsSessionResume: false, maxBufferedAudioMs: 2_000,
};

export class WebSocketStreamingTranscriptionRuntime implements StreamingTranscriptionRuntime {
  readonly id = "gateway-provider" as const;
  readonly capabilities = WEBSOCKET_STREAMING_CAPABILITIES;
  readonly options: WebSocketStreamingRuntimeOptions;
  #socket: StreamingProviderSocket | null = null;
  #pending: DesktopStreamingVoiceAudioChunk[] = [];
  #sequence = 0;
  #terminal = false;
  #opened = false;

  constructor(options: WebSocketStreamingRuntimeOptions) {
    validateStreamingProviderUrl(options.url);
    this.options = options;
  }

  start(): void {
    if (this.#socket || this.#terminal) return;
    const createSocket = this.options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as StreamingProviderSocket);
    const socket = createSocket(this.options.url);
    this.#socket = socket;
    socket.addEventListener("open", () => this.#onOpen());
    socket.addEventListener("message", (event) => this.#onMessage(event as MessageEvent));
    socket.addEventListener("error", () => this.#fail(new Error("Streaming provider network connection failed.")));
    socket.addEventListener("close", () => {
      if (!this.#terminal) this.#fail(new Error("Streaming provider socket closed before completion."));
    });
  }

  pushAudio(chunk: DesktopStreamingVoiceAudioChunk): boolean {
    if (this.#terminal || chunk.sessionId !== this.options.sessionId || chunk.turnId !== this.options.turnId) return false;
    if (!this.#opened) {
      if (this.#pending.length >= CONNECTING_BUFFER_LIMIT) return false;
      this.#pending.push(chunk);
      return true;
    }
    this.#sendAudio(chunk);
    return true;
  }

  endInput(reason: "provider" | "local_vad" | "manual" = "manual"): boolean {
    if (this.#terminal || !this.#socket) return false;
    this.#socket.send(JSON.stringify({ type: "end_input", reason }));
    return true;
  }

  cancel(): boolean {
    if (this.#terminal) return false;
    this.#terminal = true;
    try { this.#socket?.send(JSON.stringify({ type: "cancel" })); } catch { /* socket may already be gone */ }
    this.#socket?.close(1000, "cancelled");
    this.#emit({ type: "cancelled" });
    return true;
  }

  dispose(): void {
    this.#terminal = true;
    this.#pending = [];
    this.#socket?.close(1000, "disposed");
    this.#socket = null;
  }

  #onOpen(): void {
    if (!this.#socket || this.#terminal) return;
    this.#opened = true;
    this.#socket.send(JSON.stringify({
      type: "start", token: this.options.token, sessionId: this.options.sessionId, turnId: this.options.turnId,
      encoding: this.options.request.encoding, sampleRateHz: this.options.request.sampleRateHz, channels: 1,
      languageHint: this.options.request.languageHint, providerEndpointing: this.options.request.providerEndpointing,
    }));
    for (const chunk of this.#pending) this.#sendAudio(chunk);
    this.#pending = [];
  }

  #sendAudio(chunk: DesktopStreamingVoiceAudioChunk): void {
    if (!this.#socket) return;
    this.#socket.send(JSON.stringify({ type: "audio", sequence: chunk.sequence, durationMs: chunk.durationMs, byteLength: chunk.audioData.byteLength }));
    this.#socket.send(chunk.audioData);
  }

  #onMessage(event: MessageEvent): void {
    if (this.#terminal || typeof event.data !== "string" || event.data.length > MAX_PROVIDER_MESSAGE_BYTES) {
      if (!this.#terminal) this.#fail(new Error("Streaming provider returned an invalid or oversized event."));
      return;
    }
    let message: Record<string, unknown>;
    try { message = JSON.parse(event.data) as Record<string, unknown>; } catch { this.#fail(new Error("Streaming provider returned invalid JSON.")); return; }
    const type = message.type;
    if (type === "accepted") this.#emit({ type: "accepted", runtimeId: this.id });
    else if (type === "ack" && Number.isSafeInteger(message.sequence)) this.#emit({ type: "audio_ack", ack: { sessionId: this.options.sessionId, turnId: this.options.turnId, acknowledgedSequence: Number(message.sequence), bufferedAudioMs: finiteNumber(message.bufferedAudioMs, 0), receivedAt: new Date().toISOString() } });
    else if ((type === "partial" || type === "final") && typeof message.text === "string" && Number.isSafeInteger(message.revision)) this.#emit({ type, segment: { text: message.text, revision: Number(message.revision), confidence: optionalNumber(message.confidence) } });
    else if (type === "endpoint") this.#emit({ type: "endpoint", reason: message.reason === "local_vad" || message.reason === "manual" ? message.reason : "provider" });
    else if (type === "completed") { this.#terminal = true; this.#emit({ type: "completed" }); this.#socket?.close(1000, "completed"); }
    else if (type === "error") this.#fail(Object.assign(new Error(typeof message.message === "string" ? message.message : "Streaming provider failed."), { code: message.code, status: message.status }));
  }

  #fail(error: unknown): void {
    if (this.#terminal) return;
    this.#terminal = true;
    this.#emit({ type: "failed", error: normalizeStreamingVoiceError(error, this.options.sessionId) });
    this.#socket?.close(1011, "failed");
  }

  #emit(event: ProviderTranscriptionEvent): void {
    this.options.emit({ ...event, sessionId: this.options.sessionId, turnId: this.options.turnId, sequence: this.#sequence++ } as DesktopStreamingVoiceTranscriptionEvent);
  }
}

export function validateStreamingProviderUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Streaming provider URL is invalid."); }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "wss:" && !(url.protocol === "ws:" && loopback)) throw new Error("Streaming provider must use WSS or a loopback WS endpoint.");
  if (url.username || url.password || url.hash) throw new Error("Streaming provider URL must not contain credentials or fragments.");
  return url;
}

function finiteNumber(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function optionalNumber(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
