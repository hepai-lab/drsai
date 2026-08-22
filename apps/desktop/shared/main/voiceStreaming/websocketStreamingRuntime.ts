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
  authentication?: { authorization: string; principalId: string };
  sessionId: string;
  turnId: string;
  request: DesktopStreamingVoiceStartRequest;
  emit: (event: DesktopStreamingVoiceTranscriptionEvent) => void;
  createSocket?: (url: string) => StreamingProviderSocket;
  supportsResume?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  scheduleReconnect?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelScheduledReconnect?: (timer: ReturnType<typeof setTimeout>) => void;
}

const CONNECTING_BUFFER_LIMIT = 5;
const MAX_PROVIDER_MESSAGE_BYTES = 256_000;
const MAX_RESEND_AUDIO_MS = 2_000;
type ProviderTranscriptionEvent = DesktopStreamingVoiceTranscriptionEvent extends infer Event
  ? Event extends DesktopStreamingVoiceTranscriptionEvent ? Omit<Event, "sessionId" | "turnId" | "sequence"> : never
  : never;

export const WEBSOCKET_STREAMING_CAPABILITIES: DesktopStreamingVoiceCapabilities = {
  serialStt: true, serialTts: true, streamingStt: true, streamingTts: false,
  audioEncodings: ["pcm_s16le"], sampleRatesHz: [16_000, 24_000, 48_000],
  supportsPartialTranscripts: true, supportsProviderEndpointing: true, supportsSessionResume: false,
  supportsAdaptiveEndpointing: false, supportsContextualRepair: false, supportsProviderFailover: false, protocolVersion: 2,
  maxBufferedAudioMs: 2_000,
};

export class WebSocketStreamingTranscriptionRuntime implements StreamingTranscriptionRuntime {
  readonly id = "gateway-provider" as const;
  readonly capabilities: DesktopStreamingVoiceCapabilities;
  readonly options: WebSocketStreamingRuntimeOptions;
  #socket: StreamingProviderSocket | null = null;
  #pending: DesktopStreamingVoiceAudioChunk[] = [];
  #sequence = 0;
  #terminal = false;
  #opened = false;
  #unacknowledged = new Map<number, DesktopStreamingVoiceAudioChunk>();
  #unacknowledgedAudioMs = 0;
  #lastAcknowledgedAudioSequence = -1;
  #lastProviderEventSequence = -1;
  #reconnectAttempts = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #inputEnded: "provider" | "local_vad" | "manual" | null = null;

  constructor(options: WebSocketStreamingRuntimeOptions) {
    validateStreamingProviderUrl(options.url);
    this.options = options;
    this.capabilities = { ...WEBSOCKET_STREAMING_CAPABILITIES, supportsSessionResume: options.supportsResume ?? false };
  }

  start(): void {
    if (this.#socket || this.#terminal) return;
    this.#connect();
  }

  #connect(): void {
    const createSocket = this.options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as StreamingProviderSocket);
    const socket = createSocket(this.options.url);
    this.#socket = socket;
    socket.addEventListener("open", () => { if (this.#socket === socket) this.#onOpen(); });
    socket.addEventListener("message", (event) => { if (this.#socket === socket) this.#onMessage(event as MessageEvent); });
    socket.addEventListener("error", () => { if (this.#socket === socket && !this.capabilities.supportsSessionResume) this.#fail(new Error("Streaming provider network connection failed.")); });
    socket.addEventListener("close", () => this.#onClose(socket));
    if (socket.readyState === 1) queueMicrotask(() => { if (this.#socket === socket) this.#onOpen(); });
  }

  pushAudio(chunk: DesktopStreamingVoiceAudioChunk): boolean {
    if (this.#terminal || chunk.sessionId !== this.options.sessionId || chunk.turnId !== this.options.turnId) return false;
    if (this.#unacknowledgedAudioMs + pendingDuration(this.#pending) + chunk.durationMs > MAX_RESEND_AUDIO_MS) return false;
    if (!this.#opened) {
      if (this.#pending.length >= CONNECTING_BUFFER_LIMIT) return false;
      this.#pending.push(chunk);
      return true;
    }
    this.#sendAudio(chunk);
    return true;
  }

  endInput(reason: "provider" | "local_vad" | "manual" = "manual"): boolean {
    if (this.#terminal || this.#inputEnded) return false;
    this.#inputEnded = reason;
    if (this.#opened && this.#socket) this.#socket.send(JSON.stringify({ type: "end_input", reason }));
    return true;
  }

  cancel(): boolean {
    if (this.#terminal) return false;
    this.#terminal = true;
    this.#clearReconnectTimer();
    try { this.#socket?.send(JSON.stringify({ type: "cancel" })); } catch { /* socket may already be gone */ }
    this.#socket?.close(1000, "cancelled");
    this.#emit({ type: "cancelled" });
    return true;
  }

  dispose(): void {
    this.#terminal = true;
    this.#clearReconnectTimer();
    this.#pending = [];
    this.#unacknowledged.clear();
    this.#unacknowledgedAudioMs = 0;
    this.#socket?.close(1000, "disposed");
    this.#socket = null;
  }

  #onOpen(): void {
    if (!this.#socket || this.#terminal) return;
    this.#opened = true;
    const resumed = this.#reconnectAttempts > 0;
    this.#socket.send(JSON.stringify({
      type: "start", token: this.options.token, sessionId: this.options.sessionId, turnId: this.options.turnId,
      authorization: this.options.authentication?.authorization,
      principalId: this.options.authentication?.principalId,
      encoding: this.options.request.encoding, sampleRateHz: this.options.request.sampleRateHz, channels: 1,
      languageHint: this.options.request.languageHint, providerEndpointing: this.options.request.providerEndpointing,
      protocolVersion: this.options.request.protocolVersion ?? 1,
      resume: resumed ? {
        lastAcknowledgedAudioSequence: this.#lastAcknowledgedAudioSequence,
        lastProviderEventSequence: this.#lastProviderEventSequence,
      } : undefined,
    }));
    if (resumed) {
      this.#emit({ type: "connection_state", state: "reconnected", attempt: this.#reconnectAttempts });
      for (const chunk of this.#unacknowledged.values()) this.#sendAudio(chunk, false);
    }
    for (const chunk of this.#pending) this.#sendAudio(chunk);
    this.#pending = [];
    if (this.#inputEnded) this.#socket.send(JSON.stringify({ type: "end_input", reason: this.#inputEnded }));
  }

  #sendAudio(chunk: DesktopStreamingVoiceAudioChunk, track = true): void {
    if (!this.#socket) return;
    this.#socket.send(JSON.stringify({ type: "audio", sequence: chunk.sequence, durationMs: chunk.durationMs, byteLength: chunk.audioData.byteLength }));
    this.#socket.send(chunk.audioData);
    if (track && !this.#unacknowledged.has(chunk.sequence)) {
      this.#unacknowledged.set(chunk.sequence, chunk);
      this.#unacknowledgedAudioMs += chunk.durationMs;
    }
  }

  #onMessage(event: MessageEvent): void {
    if (this.#terminal || typeof event.data !== "string" || event.data.length > MAX_PROVIDER_MESSAGE_BYTES) {
      if (!this.#terminal) this.#fail(new Error("Streaming provider returned an invalid or oversized event."));
      return;
    }
    let message: Record<string, unknown>;
    try { message = JSON.parse(event.data) as Record<string, unknown>; } catch { this.#fail(new Error("Streaming provider returned invalid JSON.")); return; }
    if (Number.isSafeInteger(message.eventSequence)) {
      const eventSequence = Number(message.eventSequence);
      if (eventSequence <= this.#lastProviderEventSequence) return;
      if (eventSequence !== this.#lastProviderEventSequence + 1) { this.#fail(new Error("Streaming provider event sequence is out of order.")); return; }
      this.#lastProviderEventSequence = eventSequence;
    }
    const type = message.type;
    if (type === "accepted") this.#emit({ type: "accepted", runtimeId: this.id });
    else if (type === "ack" && Number.isSafeInteger(message.sequence)) {
      const acknowledgedSequence = Number(message.sequence);
      if (acknowledgedSequence > this.#lastAcknowledgedAudioSequence) {
        this.#lastAcknowledgedAudioSequence = acknowledgedSequence;
        for (const [sequence, chunk] of this.#unacknowledged) {
          if (sequence > acknowledgedSequence) continue;
          this.#unacknowledged.delete(sequence);
          this.#unacknowledgedAudioMs = Math.max(0, this.#unacknowledgedAudioMs - chunk.durationMs);
        }
      }
      this.#emit({ type: "audio_ack", ack: { sessionId: this.options.sessionId, turnId: this.options.turnId, acknowledgedSequence, bufferedAudioMs: finiteNumber(message.bufferedAudioMs, 0), receivedAt: new Date().toISOString() } });
    }
    else if ((type === "partial" || type === "final") && typeof message.text === "string" && Number.isSafeInteger(message.revision)) this.#emit({ type, segment: { text: message.text, revision: Number(message.revision), confidence: optionalNumber(message.confidence) } });
    else if (type === "endpoint") this.#emit({ type: "endpoint", reason: message.reason === "local_vad" || message.reason === "manual" ? message.reason : "provider" });
    else if (type === "completed") { this.#terminal = true; this.#emit({ type: "completed" }); this.#socket?.close(1000, "completed"); }
    else if (type === "error") this.#fail(Object.assign(new Error(typeof message.message === "string" ? message.message : "Streaming provider failed."), { code: message.code, status: message.status }));
  }

  #fail(error: unknown): void {
    if (this.#terminal) return;
    this.#terminal = true;
    this.#clearReconnectTimer();
    this.#emit({ type: "failed", error: normalizeStreamingVoiceError(error, this.options.sessionId) });
    this.#socket?.close(1011, "failed");
  }

  #emit(event: ProviderTranscriptionEvent): void {
    this.options.emit({ ...event, sessionId: this.options.sessionId, turnId: this.options.turnId, sequence: this.#sequence++ } as DesktopStreamingVoiceTranscriptionEvent);
  }

  #onClose(socket: StreamingProviderSocket): void {
    if (this.#socket !== socket || this.#terminal) return;
    this.#socket = null;
    this.#opened = false;
    if (!this.capabilities.supportsSessionResume || this.#reconnectAttempts >= (this.options.maxReconnectAttempts ?? 2)) {
      this.#fail(new Error("Streaming provider socket closed before completion."));
      return;
    }
    this.#reconnectAttempts += 1;
    this.#emit({ type: "connection_state", state: "reconnecting", attempt: this.#reconnectAttempts });
    const schedule = this.options.scheduleReconnect ?? setTimeout;
    this.#reconnectTimer = schedule(() => {
      this.#reconnectTimer = null;
      if (!this.#terminal && !this.#socket) this.#connect();
    }, this.options.reconnectDelayMs ?? 250);
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer === null) return;
    (this.options.cancelScheduledReconnect ?? clearTimeout)(this.#reconnectTimer);
    this.#reconnectTimer = null;
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
function pendingDuration(chunks: DesktopStreamingVoiceAudioChunk[]): number { return chunks.reduce((total, chunk) => total + chunk.durationMs, 0); }
