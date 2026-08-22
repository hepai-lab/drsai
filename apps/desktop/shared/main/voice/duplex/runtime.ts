import type {
  DesktopDuplexVoiceAudioChunk,
  DesktopDuplexVoiceEvent,
  DesktopDuplexVoiceSessionStartRequest,
} from "../../../api/desktopApi";
import type { DuplexProviderEvent, DuplexRealtimeConnection, DuplexRealtimeProviderAdapter } from "./providerAdapter";
import { DuplexRuntimeMetrics, DuplexSessionBudget, reconnectDelayMs } from "./runtimePolicy";

export interface DuplexProviderSocket {
  readonly readyState: number;
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: Event | MessageEvent) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type DuplexRuntimeState = "idle" | "connecting" | "reconnecting" | "connected" | "stopping" | "terminal" | "disposed";

export interface DuplexVoiceRuntimeOptions {
  request: DesktopDuplexVoiceSessionStartRequest;
  connection: DuplexRealtimeConnection;
  adapter: DuplexRealtimeProviderAdapter;
  createSocket: (connection: DuplexRealtimeConnection) => DuplexProviderSocket;
  emit: (event: DesktopDuplexVoiceEvent) => void;
  connectTimeoutMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
  now?: () => number;
  idleTimeoutMs?: number;
  maxSessionMs?: number;
  maxReconnectAttempts?: number;
  reconnectBaseDelayMs?: number;
}

const MAX_PENDING_CHUNKS = 100;
const MAX_PROVIDER_EVENT_BYTES = 512 * 1024;
type RuntimeEvent = DesktopDuplexVoiceEvent extends infer Event
  ? Event extends DesktopDuplexVoiceEvent ? Omit<Event, "protocolVersion" | "sessionId" | "sequence"> : never
  : never;

export class DuplexVoiceRuntime {
  readonly options: DuplexVoiceRuntimeOptions;
  state: DuplexRuntimeState = "idle";
  #socket: DuplexProviderSocket | null = null;
  #pending: DesktopDuplexVoiceAudioChunk[] = [];
  #unacknowledged = new Map<number, number>();
  #bufferedAudioMs = 0;
  #lastInputSequence = -1;
  #eventSequence = 0;
  #terminalEmitted = false;
  #connectTimer: ReturnType<typeof setTimeout> | null = null;
  #uplinkPaused = false;
  #audioSequence = 0;
  #acceptedAudioMs = 0;
  #acceptedAudioBytes = 0;
  #maintenanceTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempts = 0;
  #startedAt = 0;
  #lastActivityAt = 0;
  #metrics: DuplexRuntimeMetrics | null = null;
  #budget: DuplexSessionBudget | null = null;
  #budgetWarningEmitted = false;

  constructor(options: DuplexVoiceRuntimeOptions) {
    this.options = options;
  }

  start(): boolean {
    if (this.state !== "idle") return false;
    this.#startedAt = this.#now(); this.#lastActivityAt = this.#startedAt;
    this.#metrics = new DuplexRuntimeMetrics(this.#startedAt);
    this.#budget = new DuplexSessionBudget({ maxAudioMs: this.options.maxSessionMs ?? (this.options.adapter.capabilities.maxSessionDurationSeconds ?? 1_800) * 1_000 });
    this.state = "connecting";
    this.#emit({ type: "connection_state", state: "connecting" });
    this.#scheduleMaintenance();
    return this.#connect();
  }

  #connect(): boolean {
    let socket: DuplexProviderSocket;
    try { socket = this.options.createSocket(this.options.connection); }
    catch (error) { this.#fail(error, "network"); return false; }
    this.#socket = socket;
    socket.addEventListener("open", () => { if (this.#socket === socket) this.#onOpen(); });
    socket.addEventListener("message", (event) => { if (this.#socket === socket) this.#onMessage(event as MessageEvent); });
    socket.addEventListener("error", () => { if (this.#socket === socket) this.#handleSocketFailure(socket); });
    socket.addEventListener("close", () => { if (this.#socket === socket) this.#onClose(); });
    const schedule = this.options.schedule ?? setTimeout;
    this.#connectTimer = schedule(() => {
      this.#connectTimer = null;
      if (this.state === "connecting" || this.state === "reconnecting") this.#handleSocketFailure(socket);
    }, this.options.connectTimeoutMs ?? 10_000);
    if (socket.readyState === 1) queueMicrotask(() => { if (this.#socket === socket) this.#onOpen(); });
    return true;
  }

  update(request: DesktopDuplexVoiceSessionStartRequest): boolean {
    if (this.state !== "connected" || request.sessionId !== this.options.request.sessionId) return false;
    this.#send(this.options.adapter.createSessionUpdate(request));
    return true;
  }

  pushAudio(chunk: DesktopDuplexVoiceAudioChunk): boolean {
    if ((this.state !== "connecting" && this.state !== "reconnecting" && this.state !== "connected") || chunk.sessionId !== this.options.request.sessionId) return false;
    if (chunk.sequence !== this.#lastInputSequence + 1) return false;
    const high = this.options.adapter.capabilities.maxUplinkBufferedAudioMs;
    const maxDurationMs = (this.options.adapter.capabilities.maxSessionDurationSeconds ?? 1_800) * 1_000;
    const maxAudioBytes = this.options.request.inputSampleRateHz * 2 * (this.options.adapter.capabilities.maxSessionDurationSeconds ?? 1_800);
    if (this.#acceptedAudioMs + chunk.durationMs > maxDurationMs || this.#acceptedAudioBytes + chunk.audioData.byteLength > maxAudioBytes || !this.#budget?.addInputAudio(chunk.durationMs)) return false;
    if (this.#pending.length >= MAX_PENDING_CHUNKS || this.#bufferedAudioMs + chunk.durationMs > high) {
      this.#setUplinkPaused(true, "high_watermark");
      return false;
    }
    const providerAppend = this.options.adapter.createInputAudioAppend(chunk);
    this.#lastInputSequence = chunk.sequence;
    this.#acceptedAudioMs += chunk.durationMs;
    this.#acceptedAudioBytes += chunk.audioData.byteLength;
    this.#bufferedAudioMs += chunk.durationMs;
    this.#lastActivityAt = this.#now(); this.#metrics?.inputAudio(chunk.durationMs, this.#bufferedAudioMs);
    this.#emitBudgetWarning();
    this.#unacknowledged.set(chunk.sequence, chunk.durationMs);
    if (this.state === "connecting" || this.state === "reconnecting") this.#pending.push(cloneChunk(chunk));
    else this.#send(providerAppend);
    if (this.#bufferedAudioMs >= high) this.#setUplinkPaused(true, "high_watermark");
    return true;
  }

  interrupt(responseId: string, itemId: string, contentIndex: number, playedAudioMs: number, reason: "user_speech" | "manual" | "stop_intent"): boolean {
    if (this.state !== "connected") return false;
    this.#send(this.options.adapter.createResponseCancel(responseId));
    if (this.options.adapter.capabilities.supportsConversationTruncation) {
      this.#send(this.options.adapter.createConversationTruncate(itemId, contentIndex, playedAudioMs));
    }
    this.#emit({ type: "interrupted", responseId, playedAudioMs, reason });
    this.#metrics?.interrupted();
    return true;
  }

  submitToolResult(callId: string, output: string): boolean {
    if (this.state !== "connected") return false;
    this.#send(this.options.adapter.createToolResult(callId, output));
    return true;
  }

  stop(): boolean {
    if (this.state === "terminal" || this.state === "disposed") return false;
    if (this.state === "stopping") return true;
    this.state = "stopping";
    if (this.#socket?.readyState === 1) {
      try { this.#send(this.options.adapter.createInputAudioCommit()); } catch { /* terminal cleanup wins */ }
    }
    this.#finish("completed");
    return true;
  }

  cancel(): boolean {
    if (this.state === "terminal" || this.state === "disposed") return false;
    if (this.#socket?.readyState === 1) {
      try { this.#send(this.options.adapter.createResponseCancel()); } catch { /* terminal cleanup wins */ }
    }
    this.#finish("cancelled");
    return true;
  }

  dispose(): void {
    if (this.state === "disposed") return;
    if (!this.#terminalEmitted) this.#finish("cancelled");
    this.#clearConnectTimer();
    this.#clearMaintenanceTimers();
    this.#pending = [];
    this.#unacknowledged.clear();
    this.#bufferedAudioMs = 0;
    this.#socket?.close(1000, "disposed");
    this.#socket = null;
    this.state = "disposed";
  }

  snapshot(): Readonly<{ state: DuplexRuntimeState; bufferedAudioMs: number; pendingChunks: number; terminalEmitted: boolean; reconnectAttempts?: number; metrics?: ReturnType<DuplexRuntimeMetrics["snapshot"]>; usage?: ReturnType<DuplexSessionBudget["snapshot"]> }> {
    const base = { state: this.state, bufferedAudioMs: this.#bufferedAudioMs, pendingChunks: this.#pending.length, terminalEmitted: this.#terminalEmitted };
    return Object.freeze(this.options.maxReconnectAttempts === undefined ? base : { ...base, reconnectAttempts: this.#reconnectAttempts, metrics: this.#metrics?.snapshot(), usage: this.#budget?.snapshot() });
  }

  #onOpen(): void {
    if ((this.state !== "connecting" && this.state !== "reconnecting") || !this.#socket) return;
    this.#clearConnectTimer();
    const reconnected = this.state === "reconnecting";
    this.state = "connected";
    this.#lastActivityAt = this.#now(); this.#metrics?.connected(this.#lastActivityAt); if (reconnected) this.#metrics?.reconnected();
    this.#emit({ type: "connection_state", state: reconnected ? "reconnected" : "connected", ...(reconnected ? { attempt: this.#reconnectAttempts } : {}) });
    this.#send(this.options.adapter.createSessionUpdate(this.options.request));
    for (const chunk of this.#pending) this.#send(this.options.adapter.createInputAudioAppend(chunk));
    this.#pending = [];
  }

  #onMessage(event: MessageEvent): void {
    this.#lastActivityAt = this.#now();
    if (this.#terminalEmitted || typeof event.data !== "string" || Buffer.byteLength(event.data, "utf8") > MAX_PROVIDER_EVENT_BYTES) {
      if (!this.#terminalEmitted) this.#fail(new Error("Realtime Provider returned an invalid or oversized event."), "protocol");
      return;
    }
    for (const providerEvent of this.options.adapter.decodeEvent(event.data)) this.#forwardProviderEvent(providerEvent);
  }

  #forwardProviderEvent(event: DuplexProviderEvent): void {
    if (event.type === "session_ready") this.#emit({ type: "session_started", runtimeId: "realtime-provider", providerId: this.options.request.providerId, modelId: this.options.request.modelId, capabilities: event.capabilities });
    else if (event.type === "input_audio_ack") {
      let acknowledgedDuration = 0;
      for (const [sequence, duration] of this.#unacknowledged) if (sequence <= event.acknowledgedSequence) { acknowledgedDuration += duration; this.#unacknowledged.delete(sequence); }
      this.#bufferedAudioMs = Math.max(0, this.#bufferedAudioMs - acknowledgedDuration);
      const low = Math.floor(this.options.adapter.capabilities.maxUplinkBufferedAudioMs / 2);
      if (this.#uplinkPaused && this.#bufferedAudioMs <= low) this.#setUplinkPaused(false, "low_watermark");
      this.#emit({ type: "input_audio_ack", acknowledgedSequence: event.acknowledgedSequence, bufferedAudioMs: this.#bufferedAudioMs });
    } else if (event.type === "input_speech_started" || event.type === "input_speech_stopped") { this.#metrics?.inputEvent(this.#now()); this.#emit(event); }
    else if (event.type === "input_transcript_delta") this.#emit({ type: "input_transcript_delta", delta: { itemId: event.itemId, contentIndex: event.contentIndex, text: event.text } });
    else if (event.type === "input_transcript_completed") this.#emit(event);
    else if (event.type === "response_started") this.#emit(event);
    else if (event.type === "response_audio_delta") {
      const durationMs = event.audioData.byteLength / 2 / this.options.request.outputSampleRateHz * 1_000;
      if (!this.#budget?.addOutputAudio(durationMs)) { this.#fail(new Error("Realtime output audio exceeded the Session budget."), "rate_limit"); return; }
      this.#metrics?.outputAudio(this.#now(), durationMs);
      this.#emitBudgetWarning();
      for (let offset = 0; offset < event.audioData.byteLength; offset += 64 * 1024) {
        const audioData = event.audioData.slice(offset, Math.min(event.audioData.byteLength, offset + 64 * 1024));
        this.#emit({ type: "response_audio_delta", delta: { responseId: event.responseId, itemId: event.itemId, contentIndex: event.contentIndex, sequence: this.#audioSequence++, encoding: this.options.request.outputEncoding, sampleRateHz: this.options.request.outputSampleRateHz, channels: 1, audioData } });
      }
    }
    else if (event.type === "response_audio_completed") this.#emit(event);
    else if (event.type === "response_transcript_delta") this.#emit({ type: "response_transcript_delta", delta: { responseId: event.responseId, itemId: event.itemId, contentIndex: event.contentIndex, text: event.text } });
    else if (event.type === "response_transcript_completed") this.#emit(event);
    else if (event.type === "tool_call") this.#emit({ type: "tool_call", call: { callId: event.callId, itemId: event.itemId, name: event.name, argumentsJson: event.argumentsJson } });
    else if (event.type === "provider_error") this.#fail(Object.assign(new Error(event.error.message), { providerError: event.error }), event.error.code);
  }

  #send(value: Record<string, unknown>): void {
    if (!this.#socket || this.#socket.readyState !== 1) throw new Error("Realtime Provider socket is not open.");
    this.#socket.send(JSON.stringify(value));
  }

  #onClose(): void {
    this.#socket = null;
    if (!this.#terminalEmitted) this.#reconnectOrFail();
  }

  #fail(error: unknown, fallbackCode: "network" | "protocol" | import("../../../api/desktopApi").DesktopDuplexVoiceErrorCode): void {
    const providerError = error && typeof error === "object" && "providerError" in error ? (error as { providerError: import("../../../api/desktopApi").DesktopDuplexVoiceError }).providerError : undefined;
    this.#finish("failed", providerError ?? { code: fallbackCode, message: error instanceof Error ? error.message : "Realtime Session failed.", retryable: fallbackCode === "network" });
  }

  #finish(terminal: "completed" | "cancelled" | "failed", error?: import("../../../api/desktopApi").DesktopDuplexVoiceError): void {
    if (this.#terminalEmitted) return;
    this.#terminalEmitted = true;
    this.state = "terminal";
    this.#clearConnectTimer();
    this.#clearMaintenanceTimers();
    this.#pending = [];
    this.#unacknowledged.clear();
    this.#bufferedAudioMs = 0;
    if (this.#metrics) this.#emit({ type: "diagnostic", metrics: this.#metrics.snapshot() });
    if (terminal === "completed") this.#emit({ type: "completed", terminal });
    else if (terminal === "cancelled") this.#emit({ type: "cancelled", terminal });
    else this.#emit({ type: "failed", terminal, error: error ?? { code: "internal", message: "Realtime Session failed.", retryable: false } });
    this.#socket?.close(terminal === "failed" ? 1011 : 1000, terminal);
  }

  #setUplinkPaused(paused: boolean, reason: "high_watermark" | "low_watermark"): void {
    if (this.#uplinkPaused === paused) return;
    this.#uplinkPaused = paused;
    this.#emit({ type: "flow_control", direction: "uplink", paused, bufferedAudioMs: this.#bufferedAudioMs, reason });
  }

  #emitBudgetWarning(): void { const usage = this.#budget?.snapshot(); if (!usage || !usage.warning || this.#budgetWarningEmitted) return; this.#budgetWarningEmitted = true; this.#emit({ type: "usage_update", ...usage }); }

  #emit(event: RuntimeEvent): void {
    this.options.emit({ ...event, protocolVersion: 1, sessionId: this.options.request.sessionId, sequence: this.#eventSequence++ } as DesktopDuplexVoiceEvent);
  }

  #clearConnectTimer(): void {
    if (this.#connectTimer === null) return;
    (this.options.cancelSchedule ?? clearTimeout)(this.#connectTimer);
    this.#connectTimer = null;
  }

  #handleSocketFailure(socket: DuplexProviderSocket): void {
    if (this.#socket !== socket || this.#terminalEmitted) return;
    this.#socket = null; try { socket.close(1012, "reconnect"); } catch { /* reconnect path is authoritative */ }
    this.#reconnectOrFail();
  }

  #reconnectOrFail(): void {
    this.#clearConnectTimer();
    const maximum = this.options.maxReconnectAttempts ?? 0;
    if (this.#reconnectAttempts >= maximum) { this.#fail(new Error("Realtime Provider connection could not be recovered."), "network"); return; }
    this.#reconnectAttempts += 1;
    this.state = "reconnecting";
    this.#unacknowledged.clear(); this.#bufferedAudioMs = 0; this.#pending = [];
    this.#emit({ type: "connection_state", state: "reconnecting", attempt: this.#reconnectAttempts });
    const schedule = this.options.schedule ?? setTimeout;
    this.#reconnectTimer = schedule(() => { this.#reconnectTimer = null; if (this.state === "reconnecting" && !this.#terminalEmitted) this.#connect(); }, reconnectDelayMs(this.#reconnectAttempts, this.options.reconnectBaseDelayMs ?? 250));
  }

  #scheduleMaintenance(): void {
    const idle = this.options.idleTimeoutMs ?? 5 * 60_000; const maximum = this.options.maxSessionMs ?? (this.options.adapter.capabilities.maxSessionDurationSeconds ?? 1_800) * 1_000;
    const schedule = this.options.schedule ?? setTimeout;
    this.#maintenanceTimer = schedule(() => {
      this.#maintenanceTimer = null; if (this.#terminalEmitted || this.state === "disposed") return;
      const now = this.#now();
      if (now - this.#startedAt >= maximum) { this.#fail(new Error("Realtime Session reached its configured duration budget."), "rate_limit"); return; }
      if (now - this.#lastActivityAt >= idle) { this.#finish("completed"); return; }
      this.#scheduleMaintenance();
    }, Math.max(250, Math.min(5_000, Math.floor(idle / 4), Math.floor(maximum / 20))));
  }

  #clearMaintenanceTimers(): void {
    const cancel = this.options.cancelSchedule ?? clearTimeout;
    if (this.#maintenanceTimer !== null) cancel(this.#maintenanceTimer);
    if (this.#reconnectTimer !== null) cancel(this.#reconnectTimer);
    this.#maintenanceTimer = null; this.#reconnectTimer = null;
  }

  #now(): number { return (this.options.now ?? Date.now)(); }
}

function cloneChunk(chunk: DesktopDuplexVoiceAudioChunk): DesktopDuplexVoiceAudioChunk {
  return { ...chunk, audioData: new Uint8Array(chunk.audioData) };
}
