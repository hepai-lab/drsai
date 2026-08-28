import type {
  DesktopDuplexVoiceAudioChunk,
  DesktopDuplexVoiceEvent,
  DesktopDuplexVoicePlaybackAck,
  DesktopDuplexVoiceSessionStartRequest,
  DesktopDuplexVoiceUplinkCredit,
} from "../../../api/desktopApi";
import type { DuplexProviderEvent, DuplexRealtimeConnection, DuplexRealtimeProviderAdapter } from "./providerAdapter";
import { DuplexRuntimeMetrics, DuplexSessionBudget, reconnectDelayMs } from "./runtimePolicy";
import { classifyDuplexSessionUpdate } from "./sessionUpdatePolicy";

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
  prepareReconnect?: () => Promise<void>;
  emit: (event: DesktopDuplexVoiceEvent) => void;
  connectTimeoutMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
  now?: () => number;
  idleTimeoutMs?: number;
  maxSessionMs?: number;
  maxReconnectAttempts?: number;
  reconnectBaseDelayMs?: number;
  injectDisconnectAfterFirstSessionReady?: boolean;
}

const MAX_PENDING_CHUNKS = 100;
const MAX_PROVIDER_EVENT_BYTES = 512 * 1024;
const MAX_DOWNLINK_PENDING_AUDIO_MS = 30_000;
const PROVIDER_FAILURE_CLOSE_CODE = 4000;
const PROVIDER_RECONNECT_CLOSE_CODE = 4001;
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
  #lastAcknowledgedSequence = -1;
  #downlinkPending: Array<{ event: Extract<RuntimeEvent, { type: "response_audio_delta" | "response_audio_completed" }>; durationMs: number }> = [];
  #downlinkSent = new Map<number, number>(); #downlinkPendingAudioMs = 0; #playbackPaused = false;
  #lastPlaybackAck = { receivedSequence: -1, scheduledSequence: -1, playedSequence: -1, receivedAudioMs: 0, scheduledAudioMs: 0, playedAudioMs: 0 };
  #interruptedResponses = new Set<string>();
  #connectionSegment = 0; #lostAudioMs = 0;
  #submittedTextItems = new Map<string, string>();
  #drainTimer: ReturnType<typeof setTimeout> | null = null;
  #effectiveRequest: DesktopDuplexVoiceSessionStartRequest;
  #pendingSessionUpdate: { updateId: string; next: DesktopDuplexVoiceSessionStartRequest; previous: DesktopDuplexVoiceSessionStartRequest; changedFields: string[]; timer: ReturnType<typeof setTimeout> } | null = null;
  #disconnectInjected = false;
  #uncommittedInputAudio = false;

  constructor(options: DuplexVoiceRuntimeOptions) {
    this.options = options;
    this.#effectiveRequest = { ...options.request };
  }

  start(): boolean {
    if (this.state !== "idle") return false;
    this.#startedAt = this.#now(); this.#lastActivityAt = this.#startedAt;
    this.#metrics = new DuplexRuntimeMetrics(this.#startedAt);
    this.#budget = new DuplexSessionBudget({ maxAudioMs: this.options.maxSessionMs ?? (this.options.adapter.capabilities.maxSessionDurationSeconds ?? 1_800) * 1_000 });
    this.state = "connecting";
    this.#emit({ type: "connection_state", state: "connecting" });
    this.#emitCredit("initial");
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
    const updateId = request.updateId?.trim();
    if (this.state !== "connected" || request.sessionId !== this.options.request.sessionId || !updateId || !/^[a-zA-Z0-9_.:-]{8,160}$/.test(updateId) || this.#pendingSessionUpdate) return false;
    const matrix = classifyDuplexSessionUpdate(this.#effectiveRequest, request);
    if (matrix.restart.length) { this.#emit({ type: "session_update_ack", updateId, status: "requires_restart", changedFields: matrix.restart, reason: "These fields require a new Realtime Session." }); return true; }
    if (!matrix.hot.length) { this.#emit({ type: "session_update_ack", updateId, status: "applied", changedFields: [] }); return true; }
    const next = { ...request }; const previous = { ...this.#effectiveRequest }; const schedule = this.options.schedule ?? setTimeout;
    this.#send(this.options.adapter.createSessionUpdate(next));
    const timer = schedule(() => { const pending = this.#pendingSessionUpdate; if (!pending || pending.updateId !== updateId) return; this.#pendingSessionUpdate = null; try { this.#send(this.options.adapter.createSessionUpdate(pending.previous)); } catch { /* active Session failure remains authoritative */ } this.#emit({ type: "session_update_ack", updateId, status: "rolled_back", changedFields: pending.changedFields, reason: "Provider update acknowledgement timed out." }); }, 2_000);
    this.#pendingSessionUpdate = { updateId, next, previous, changedFields: matrix.hot, timer };
    return true;
  }

  pushAudio(chunk: DesktopDuplexVoiceAudioChunk): boolean {
    if ((this.state !== "connecting" && this.state !== "connected") || chunk.sessionId !== this.options.request.sessionId) return false;
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
    this.#uncommittedInputAudio = true;
    if (this.state === "connecting") this.#pending.push(cloneChunk(chunk));
    else this.#send(providerAppend);
    if (this.#bufferedAudioMs >= high) this.#setUplinkPaused(true, "high_watermark");
    return true;
  }

  get uplinkCredit(): DesktopDuplexVoiceUplinkCredit {
    if (this.state === "reconnecting") return Object.freeze({ frames: 0, bytes: 0, audioMs: 0, acknowledgedSequence: this.#lastAcknowledgedSequence });
    const highMs = this.options.adapter.capabilities.maxUplinkBufferedAudioMs;
    const availableMs = Math.max(0, highMs - this.#bufferedAudioMs);
    const bytesPerMs = this.options.request.inputSampleRateHz * 2 / 1_000;
    return Object.freeze({
      frames: Math.max(0, MAX_PENDING_CHUNKS - this.#unacknowledged.size),
      bytes: Math.max(0, Math.floor(availableMs * bytesPerMs)),
      audioMs: availableMs,
      acknowledgedSequence: this.#lastAcknowledgedSequence,
    });
  }

  interrupt(interruptId: string, responseId: string, itemId: string, contentIndex: number, playedAudioMs: number, reason: "user_speech" | "manual" | "stop_intent"): boolean {
    if (this.state !== "connected") return false;
    if (this.#interruptedResponses.has(responseId)) return true;
    this.#interruptedResponses.add(responseId);
    this.#send(this.options.adapter.createResponseCancel(responseId));
    if (this.options.adapter.capabilities.supportsConversationTruncation) {
      this.#send(this.options.adapter.createConversationTruncate(itemId, contentIndex, playedAudioMs));
    }
    this.#emit({ type: "interrupted", interruptId, responseId, playedAudioMs, reason });
    this.#metrics?.interrupted();
    return true;
  }

  submitToolResult(callId: string, output: string): boolean {
    if (this.state !== "connected") return false;
    this.#send(this.options.adapter.createToolResult(callId, output));
    return true;
  }
  submitTextInput(itemId: string, text: string): boolean { if (typeof itemId !== "string" || typeof text !== "string") return false; const value = text.trim(); const existing = this.#submittedTextItems.get(itemId); if (existing !== undefined) return existing === value; if (this.state !== "connected" || !itemId || itemId.length > 160 || !value || value.length > 20_000) return false; this.#send(this.options.adapter.createTextInput(itemId, value)); this.#send(this.options.adapter.createResponse()); this.#submittedTextItems.set(itemId, value); return true; }

  finishTurn(): boolean {
    if (this.state !== "connected" || !this.#socket || this.#socket.readyState !== 1 || !this.#uncommittedInputAudio) return false;
    this.#send(this.options.adapter.createInputAudioCommit()); this.#uncommittedInputAudio = false; return true;
  }

  acknowledgePlayback(ack: DesktopDuplexVoicePlaybackAck): boolean {
    if (ack.protocolVersion !== 2 || ack.sessionId !== this.options.request.sessionId || this.#terminalEmitted) return false;
    const cursors = [ack.receivedSequence, ack.scheduledSequence, ack.playedSequence]; const durations = [ack.receivedAudioMs, ack.scheduledAudioMs, ack.playedAudioMs];
    if (cursors.some((value) => !Number.isInteger(value) || value < -1) || durations.some((value) => !Number.isFinite(value) || value < 0)) return false;
    if (ack.receivedSequence < ack.scheduledSequence || ack.scheduledSequence < ack.playedSequence || ack.receivedAudioMs < ack.scheduledAudioMs || ack.scheduledAudioMs < ack.playedAudioMs) return false;
    const previous = this.#lastPlaybackAck;
    if (ack.receivedSequence < previous.receivedSequence || ack.scheduledSequence < previous.scheduledSequence || ack.playedSequence < previous.playedSequence || ack.receivedAudioMs < previous.receivedAudioMs || ack.scheduledAudioMs < previous.scheduledAudioMs || ack.playedAudioMs < previous.playedAudioMs) return false;
    const lastSent = this.#downlinkSent.size ? Math.max(...this.#downlinkSent.keys()) : previous.receivedSequence;
    if (ack.receivedSequence > lastSent || ack.scheduledSequence > lastSent || ack.playedSequence > lastSent) return false;
    this.#lastPlaybackAck = { receivedSequence: ack.receivedSequence, scheduledSequence: ack.scheduledSequence, playedSequence: ack.playedSequence, receivedAudioMs: ack.receivedAudioMs, scheduledAudioMs: ack.scheduledAudioMs, playedAudioMs: ack.playedAudioMs };
    for (const sequence of this.#downlinkSent.keys()) if (sequence <= ack.playedSequence) this.#downlinkSent.delete(sequence);
    this.#flushDownlink(); return true;
  }

  stop(): boolean {
    if (this.state === "terminal" || this.state === "disposed") return false;
    if (this.state === "stopping") return true;
    this.state = "stopping";
    if (this.#socket?.readyState === 1 && this.#uncommittedInputAudio) { try { this.#send(this.options.adapter.createInputAudioCommit()); this.#uncommittedInputAudio = false; } catch { /* drain deadline wins */ } }
    const schedule = this.options.schedule ?? setTimeout;
    this.#drainTimer = schedule(() => { this.#drainTimer = null; if (this.state === "stopping") this.#finish("completed"); }, 2_000);
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
    this.#closeSocket(1000, "disposed");
    this.state = "disposed";
  }

  snapshot(): Readonly<{ state: DuplexRuntimeState; bufferedAudioMs: number; pendingChunks: number; terminalEmitted: boolean; reconnectAttempts?: number; metrics?: ReturnType<DuplexRuntimeMetrics["snapshot"]>; usage?: ReturnType<DuplexSessionBudget["snapshot"]>; resources?: { timers: number; uplinkFrames: number; downlinkFrames: number; downlinkAudioMs: number } }> {
    const resources = { timers: Number(this.#connectTimer !== null) + Number(this.#maintenanceTimer !== null) + Number(this.#reconnectTimer !== null) + Number(this.#drainTimer !== null), uplinkFrames: this.#pending.length + this.#unacknowledged.size, downlinkFrames: this.#downlinkPending.length + this.#downlinkSent.size, downlinkAudioMs: this.#downlinkPendingAudioMs + [...this.#downlinkSent.values()].reduce((sum, value) => sum + value, 0) };
    const base = { state: this.state, bufferedAudioMs: this.#bufferedAudioMs, pendingChunks: this.#pending.length, terminalEmitted: this.#terminalEmitted };
    return Object.freeze(this.options.maxReconnectAttempts === undefined ? base : { ...base, reconnectAttempts: this.#reconnectAttempts, metrics: this.#metrics?.snapshot(), usage: this.#budget?.snapshot(), resources });
  }

  #onOpen(): void {
    if ((this.state !== "connecting" && this.state !== "reconnecting") || !this.#socket) return;
    this.#clearConnectTimer();
    const reconnected = this.state === "reconnecting";
    this.state = "connected";
    this.#lastActivityAt = this.#now(); this.#metrics?.connected(this.#lastActivityAt); if (reconnected) this.#metrics?.reconnected();
    if (reconnected) this.#connectionSegment += 1;
    this.#emit({ type: "connection_state", state: reconnected ? "reconnected" : "connected", segmentId: this.#connectionSegment, ...(reconnected ? { attempt: this.#reconnectAttempts, lostAudioMs: this.#lostAudioMs } : {}) });
    this.#send(this.options.adapter.createSessionUpdate(this.options.request));
    for (const chunk of this.#pending) this.#send(this.options.adapter.createInputAudioAppend(chunk));
    this.#pending = [];
    if (reconnected) this.#lostAudioMs = 0;
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
    if (event.type === "session_ready") {
      const pending = this.#pendingSessionUpdate;
      if (pending) { (this.options.cancelSchedule ?? clearTimeout)(pending.timer); this.#pendingSessionUpdate = null; this.#effectiveRequest = { ...pending.next }; this.#emit({ type: "session_update_ack", updateId: pending.updateId, status: "applied", changedFields: pending.changedFields }); }
      else this.#emit({ type: "session_started", runtimeId: "realtime-provider", providerId: this.options.request.providerId, modelId: this.options.request.modelId, capabilities: event.capabilities });
      if (this.options.injectDisconnectAfterFirstSessionReady && !this.#disconnectInjected) {
        this.#disconnectInjected = true;
        const socket = this.#socket;
        (this.options.schedule ?? setTimeout)(() => { if (socket && this.#socket === socket && this.state === "connected") this.#handleSocketFailure(socket); }, 100);
      }
    }
    else if (event.type === "input_audio_ack") {
      if (event.acknowledgedSequence <= this.#lastAcknowledgedSequence) return;
      let acknowledgedDuration = 0;
      for (const [sequence, duration] of this.#unacknowledged) if (sequence <= event.acknowledgedSequence) { acknowledgedDuration += duration; this.#unacknowledged.delete(sequence); }
      this.#bufferedAudioMs = Math.max(0, this.#bufferedAudioMs - acknowledgedDuration);
      this.#lastAcknowledgedSequence = event.acknowledgedSequence;
      const low = Math.floor(this.options.adapter.capabilities.maxUplinkBufferedAudioMs / 2);
      if (this.#uplinkPaused && this.#bufferedAudioMs <= low) this.#setUplinkPaused(false, "low_watermark");
      this.#emit({ type: "input_audio_ack", acknowledgedSequence: event.acknowledgedSequence, bufferedAudioMs: this.#bufferedAudioMs });
      this.#emitCredit("ack");
    } else if (event.type === "input_speech_started" || event.type === "input_speech_stopped") { if (event.type === "input_speech_stopped") this.#uncommittedInputAudio = false; this.#metrics?.inputEvent(this.#now()); this.#emit(event); }
    else if (event.type === "input_transcript_delta") this.#emit({ type: "input_transcript_delta", delta: { itemId: event.itemId, contentIndex: event.contentIndex, text: event.text } });
    else if (event.type === "input_transcript_completed") this.#emit(event);
    else if (event.type === "response_started") this.#emit({ ...event, firstAudioSequence: this.#audioSequence });
    else if (event.type === "response_audio_delta") {
      const durationMs = event.audioData.byteLength / 2 / this.options.request.outputSampleRateHz * 1_000;
      if (!this.#budget?.addOutputAudio(durationMs)) { this.#fail(new Error("Realtime output audio exceeded the Session budget."), "rate_limit"); return; }
      this.#metrics?.outputAudio(this.#now(), durationMs);
      this.#emitBudgetWarning();
      const providerReceivedAtMs = this.#now();
      const frameBytes = Math.max(2, Math.floor(this.options.request.outputSampleRateHz * 2 * 40 / 1_000 / 2) * 2);
      for (let offset = 0; offset < event.audioData.byteLength; offset += frameBytes) {
        const audioData = event.audioData.slice(offset, Math.min(event.audioData.byteLength, offset + frameBytes));
        const partDurationMs = audioData.byteLength / 2 / this.options.request.outputSampleRateHz * 1_000;
        this.#queueDownlink({ type: "response_audio_delta", delta: { responseId: event.responseId, itemId: event.itemId, contentIndex: event.contentIndex, sequence: this.#audioSequence++, providerReceivedAtMs, encoding: this.options.request.outputEncoding, sampleRateHz: this.options.request.outputSampleRateHz, channels: 1, audioData } }, partDurationMs);
      }
    }
    else if (event.type === "response_audio_completed") this.#queueDownlink({ ...event, finalSequence: this.#audioSequence - 1 }, 0);
    else if (event.type === "response_transcript_delta") this.#emit({ type: "response_transcript_delta", delta: { responseId: event.responseId, itemId: event.itemId, contentIndex: event.contentIndex, text: event.text } });
    else if (event.type === "response_transcript_completed") { this.#emit(event); if (this.state === "stopping") this.#finish("completed"); }
    else if (event.type === "response_completed" && event.status === "cancelled") {
      // Server VAD may cancel the active response before the Renderer commits its
      // local candidate. Remember it so a racing IPC cannot send another cancel.
      this.#interruptedResponses.add(event.responseId);
    }
    else if (event.type === "tool_call") this.#emit({ type: "tool_call", call: { callId: event.callId, itemId: event.itemId, name: event.name, argumentsJson: event.argumentsJson } });
    else if (event.type === "provider_error") { const pending = this.#pendingSessionUpdate; if (pending) { (this.options.cancelSchedule ?? clearTimeout)(pending.timer); this.#pendingSessionUpdate = null; try { this.#send(this.options.adapter.createSessionUpdate(pending.previous)); } catch { /* connection lifecycle remains authoritative */ } this.#emit({ type: "session_update_ack", updateId: pending.updateId, status: "rejected", changedFields: pending.changedFields, reason: event.error.message }); } else this.#fail(Object.assign(new Error(event.error.message), { providerError: event.error }), event.error.code); }
  }

  #send(value: Record<string, unknown>): void {
    if (!this.#socket || this.#socket.readyState !== 1) throw new Error("Realtime Provider socket is not open.");
    this.#socket.send(JSON.stringify(value));
  }

  #queueDownlink(event: Extract<RuntimeEvent, { type: "response_audio_delta" | "response_audio_completed" }>, durationMs: number): void {
    this.#downlinkPending.push({ event, durationMs }); this.#downlinkPendingAudioMs += durationMs;
    if (this.#downlinkPendingAudioMs > MAX_DOWNLINK_PENDING_AUDIO_MS) { this.#fail(new Error("Realtime output exceeded the bounded playback delivery queue."), "audio"); return; }
    this.#flushDownlink();
  }

  #flushDownlink(): void {
    const high = this.options.adapter.capabilities.maxPlaybackBufferedAudioMs;
    let outstanding = 0; for (const duration of this.#downlinkSent.values()) outstanding += duration;
    while (this.#downlinkPending.length) {
      const next = this.#downlinkPending[0];
      if (next.durationMs > 0 && outstanding + next.durationMs > high) break;
      this.#downlinkPending.shift(); this.#downlinkPendingAudioMs = Math.max(0, this.#downlinkPendingAudioMs - next.durationMs);
      if (next.event.type === "response_audio_delta") { this.#downlinkSent.set(next.event.delta.sequence, next.durationMs); outstanding += next.durationMs; }
      this.#emit(next.event);
    }
    const paused = this.#downlinkPending.some((item) => item.durationMs > 0);
    if (paused !== this.#playbackPaused) { this.#playbackPaused = paused; this.#emit({ type: "flow_control", direction: "playback", paused, bufferedAudioMs: outstanding + this.#downlinkPendingAudioMs, reason: paused ? "high_watermark" : "low_watermark" }); }
  }

  #onClose(): void {
    this.#socket = null;
    if (this.state === "stopping") { this.#finish("completed"); return; }
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
    this.#downlinkPending = []; this.#downlinkSent.clear(); this.#downlinkPendingAudioMs = 0;
    this.#unacknowledged.clear();
    this.#bufferedAudioMs = 0;
    if (this.#metrics) this.#emit({ type: "diagnostic", metrics: this.#metrics.snapshot() });
    if (terminal === "completed") this.#emit({ type: "completed", terminal });
    else if (terminal === "cancelled") this.#emit({ type: "cancelled", terminal });
    else this.#emit({ type: "failed", terminal, error: error ?? { code: "internal", message: "Realtime Session failed.", retryable: false } });
    this.#closeSocket(terminal === "failed" ? PROVIDER_FAILURE_CLOSE_CODE : 1000, terminal);
  }

  #setUplinkPaused(paused: boolean, reason: "high_watermark" | "low_watermark"): void {
    if (this.#uplinkPaused === paused) return;
    this.#uplinkPaused = paused;
    this.#emit({ type: "flow_control", direction: "uplink", paused, bufferedAudioMs: this.#bufferedAudioMs, reason });
  }

  #emitCredit(reason: "initial" | "ack" | "reconnect"): void { this.#emit({ type: "uplink_credit", credit: this.uplinkCredit, reason }); }

  #emitBudgetWarning(): void { const usage = this.#budget?.snapshot(); if (!usage || !usage.warning || this.#budgetWarningEmitted) return; this.#budgetWarningEmitted = true; this.#emit({ type: "usage_update", ...usage }); }

  #emit(event: RuntimeEvent): void {
    this.options.emit({ ...event, protocolVersion: 2, sessionId: this.options.request.sessionId, sequence: this.#eventSequence++ } as DesktopDuplexVoiceEvent);
  }

  #clearConnectTimer(): void {
    if (this.#connectTimer === null) return;
    (this.options.cancelSchedule ?? clearTimeout)(this.#connectTimer);
    this.#connectTimer = null;
  }

  #handleSocketFailure(socket: DuplexProviderSocket): void {
    if (this.#socket !== socket || this.#terminalEmitted) return;
    this.#socket = null; try { socket.close(PROVIDER_RECONNECT_CLOSE_CODE, "reconnect"); } catch { /* reconnect path is authoritative */ }
    if (this.state === "stopping") { this.#finish("completed"); return; }
    this.#reconnectOrFail();
  }

  #reconnectOrFail(): void {
    this.#clearConnectTimer();
    const maximum = this.options.maxReconnectAttempts ?? 0;
    if (this.#reconnectAttempts >= maximum) { this.#fail(new Error("Realtime Provider connection could not be recovered."), "network"); return; }
    this.#reconnectAttempts += 1;
    this.state = "reconnecting";
    this.#lostAudioMs += this.#bufferedAudioMs; this.#unacknowledged.clear(); this.#bufferedAudioMs = 0; this.#pending = []; this.#lastAcknowledgedSequence = this.#lastInputSequence;
    this.#uncommittedInputAudio = false;
    const retryAfterMs = reconnectDelayMs(this.#reconnectAttempts, this.options.reconnectBaseDelayMs ?? 250);
    this.#emit({ type: "connection_state", state: "reconnecting", attempt: this.#reconnectAttempts, segmentId: this.#connectionSegment, lostAudioMs: this.#lostAudioMs, retryAfterMs });
    this.#emitCredit("reconnect");
    const schedule = this.options.schedule ?? setTimeout;
    this.#reconnectTimer = schedule(() => {
      this.#reconnectTimer = null;
      if (this.state !== "reconnecting" || this.#terminalEmitted) return;
      if (!this.options.prepareReconnect) { this.#connect(); return; }
      void this.options.prepareReconnect().then(() => {
        if (this.state === "reconnecting" && !this.#terminalEmitted) this.#connect();
      }, () => {
        if (this.state === "reconnecting" && !this.#terminalEmitted) this.#reconnectOrFail();
      });
    }, retryAfterMs);
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
    if (this.#drainTimer !== null) cancel(this.#drainTimer);
    if (this.#pendingSessionUpdate) cancel(this.#pendingSessionUpdate.timer);
    this.#maintenanceTimer = null; this.#reconnectTimer = null; this.#drainTimer = null; this.#pendingSessionUpdate = null;
  }

  #closeSocket(code: number, reason: string): void {
    const socket = this.#socket;
    this.#socket = null;
    if (!socket) return;
    try { socket.close(code, reason); } catch { /* terminal cleanup must never escape into Electron's main process */ }
  }

  #now(): number { return (this.options.now ?? Date.now)(); }
}

function cloneChunk(chunk: DesktopDuplexVoiceAudioChunk): DesktopDuplexVoiceAudioChunk {
  return { ...chunk, audioData: new Uint8Array(chunk.audioData) };
}
