import { randomUUID } from "node:crypto";
import type {
  DesktopStreamingVoiceAudioChunk,
  DesktopStreamingVoiceCapabilities,
  DesktopStreamingVoiceStartRequest,
  DesktopStreamingVoiceStartResult,
  DesktopStreamingVoiceTranscriptionEvent,
} from "../../api/desktopApi";
import { BoundedStreamingAudioQueue } from "./audioQueue";
import { FixtureStreamingTranscriptionRuntime } from "./fixtureStreamingRuntime";
import { normalizeStreamingVoiceError } from "./errors";
import type { StreamingTranscriptionRuntime } from "./runtime";
import { validateStreamingProviderUrl, WebSocketStreamingTranscriptionRuntime, type StreamingProviderSocket } from "./websocketStreamingRuntime";
import { PrewarmedStreamingSocketPool } from "./prewarmedSocketPool";
import { FailoverStreamingTranscriptionRuntime, type FailoverRuntimeCandidate } from "./failoverRuntime";
import type { StreamingProviderCapability } from "./providerPolicy";
import { StreamingVoiceSessionRegistry } from "./sessionRegistry";
import { StreamingTransportReliability } from "./transportReliability";
import { validateStreamingVoiceAudioChunk, validateStreamingVoiceStartRequest } from "./validation";
import { getAuthenticatedGatewayRequestHeaders, getGatewayRequestHeaders, getGatewaySnapshot } from "../gateway";

export interface StreamingVoiceSender {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, event: DesktopStreamingVoiceTranscriptionEvent): void;
  once(event: "destroyed", listener: () => void): unknown;
  removeListener(event: "destroyed", listener: () => void): unknown;
}

export interface StreamingVoiceMessagePort {
  on(event: "message", listener: (message: { data: unknown }) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  start(): void;
  close(): void;
}

interface ActiveStreamingVoiceSession {
  sender: StreamingVoiceSender;
  request: DesktopStreamingVoiceStartRequest;
  queue: BoundedStreamingAudioQueue;
  runtime: StreamingTranscriptionRuntime;
  port: StreamingVoiceMessagePort | null;
  lastEventSequence: number;
  transport: StreamingTransportReliability;
  transportTimer: NodeJS.Timeout;
  receivedAudioBytes: number;
  receivedAudioMs: number;
  detachSender: () => void;
}

const MAX_BUFFERED_AUDIO_MS = 2_000;
const MAX_SESSION_AUDIO_MS = 120_000;
const MAX_SESSION_AUDIO_BYTES = 48_000 * 2 * 120;
const STREAMING_CAPABILITIES: DesktopStreamingVoiceCapabilities = {
  serialStt: true,
  serialTts: true,
  streamingStt: false,
  streamingTts: false,
  audioEncodings: ["pcm_s16le"],
  sampleRatesHz: [16_000, 24_000, 48_000],
  supportsPartialTranscripts: true,
  supportsProviderEndpointing: true,
  supportsSessionResume: false,
  supportsAdaptiveEndpointing: false,
  supportsContextualRepair: false,
  supportsProviderFailover: false,
  protocolVersion: 2,
  maxBufferedAudioMs: MAX_BUFFERED_AUDIO_MS,
};

const sessions = new StreamingVoiceSessionRegistry<ActiveStreamingVoiceSession>(3);
const prewarmedSockets = new PrewarmedStreamingSocketPool({
  maxIdle: 1,
  idleTimeoutMs: 15_000,
  createSocket: (url) => new WebSocket(url) as unknown as StreamingProviderSocket,
});

export function getStreamingVoiceCapabilities(): DesktopStreamingVoiceCapabilities {
  const fixtureEnabled = process.env.OPENDRSAI_VOICE_RUNTIME === "fixture";
  const providerEnabled = isStreamingProviderConfigured();
  const ttsRuntime = process.env.OPENDRSAI_VOICE_TTS_RUNTIME;
  const streamingTts = ttsRuntime === "fixture" || ttsRuntime === "gateway-provider";
  return {
    ...STREAMING_CAPABILITIES,
    streamingStt: fixtureEnabled || providerEnabled,
    streamingTts,
    supportsAdaptiveEndpointing: fixtureEnabled,
    supportsContextualRepair: fixtureEnabled,
    supportsProviderFailover: providerConfigurations().length > 1 && process.env.OPENDRSAI_STREAMING_STT_ALLOW_FAILOVER === "1",
    audioEncodings: [...STREAMING_CAPABILITIES.audioEncodings],
    sampleRatesHz: [...STREAMING_CAPABILITIES.sampleRatesHz],
  };
}

export async function startStreamingVoiceTranscription(
  sender: StreamingVoiceSender,
  request: DesktopStreamingVoiceStartRequest,
): Promise<DesktopStreamingVoiceStartResult> {
  validateStreamingVoiceStartRequest(request);
  if (!getStreamingVoiceCapabilities().streamingStt) throw new Error("Streaming transcription is unavailable for the configured production runtime.");
  const sessionId = randomUUID();
  const queue = new BoundedStreamingAudioQueue({
    maxBufferedAudioMs: MAX_BUFFERED_AUDIO_MS,
    highWatermarkMs: 1_500,
    lowWatermarkMs: 500,
  });
  let detachSender = (): void => {};
  const capabilities = getStreamingVoiceCapabilities();
  const transport = new StreamingTransportReliability(Date.now(), { supportsResume: capabilities.supportsSessionResume });
  const authentication = process.env.OPENDRSAI_VOICE_RUNTIME === "fixture"
    ? undefined
    : await gatewayStreamingAuthentication();
  const runtime: StreamingTranscriptionRuntime = process.env.OPENDRSAI_VOICE_RUNTIME === "fixture"
    ? new FixtureStreamingTranscriptionRuntime({
      sessionId, turnId: request.turnId, partials: ["Fixture", "Fixture streaming", "Fixture streaming transcript"],
      finalText: "Fixture streaming transcript.", partialEveryChunks: 2, emit: (event) => emitStreamingEvent(sessionId, event),
    })
    : createProductionStreamingRuntime(sessionId, request, (event) => emitStreamingEvent(sessionId, event), authentication);
  const handleSenderDestroyed = (): void => { cancelStreamingVoiceSessionsForSender(sender); };
  detachSender = () => sender.removeListener("destroyed", handleSenderDestroyed);
  const transportTimer = setInterval(() => {
    const status = transport.poll();
    if (status.timeout) failStreamingSession(sessionId, new Error(`Streaming ${status.timeout} timeout.`), status.timeout !== "total");
  }, 1_000);
  transportTimer.unref();
  try {
    sessions.register({
      sessionId,
      turnId: request.turnId,
      ownerId: String(sender.id),
      value: { sender, request, queue, runtime, port: null, lastEventSequence: -1, transport, transportTimer, receivedAudioBytes: 0, receivedAudioMs: 0, detachSender },
    });
  } catch (error) {
    clearInterval(transportTimer);
    transport.finish();
    throw error;
  }
  sender.once("destroyed", handleSenderDestroyed);
  runtime.start();
  transport.connected();
  return {
    sessionId,
    turnId: request.turnId,
    acceptedAt: new Date().toISOString(),
    capabilities: getStreamingVoiceCapabilities(),
  };
}

export function attachStreamingVoiceAudioPort(sender: StreamingVoiceSender, sessionId: string, port: StreamingVoiceMessagePort): boolean {
  const record = sessions.get(sessionId);
  if (!record || record.terminal !== null || record.ownerId !== String(sender.id) || record.value.port) {
    port.close();
    return false;
  }
  record.value.port = port;
  port.on("message", (message) => {
    const current = sessions.get(sessionId);
    if (!current || current.terminal !== null || current.value.port !== port) return;
    try {
      const chunk = message.data as DesktopStreamingVoiceAudioChunk;
      validateStreamingVoiceAudioChunk(chunk, { sessionId, ...current.value.request });
      if (current.value.receivedAudioMs + chunk.durationMs > MAX_SESSION_AUDIO_MS) {
        throw new Error("Streaming audio duration exceeds the session limit.");
      }
      if (current.value.receivedAudioBytes + chunk.audioData.byteLength > MAX_SESSION_AUDIO_BYTES) {
        throw new Error("Streaming audio byte limit exceeded.");
      }
      const queued = current.value.queue.enqueue(chunk);
      if (!queued.accepted) {
        if (queued.reason !== "duplicate") failStreamingSession(sessionId, new Error(`Streaming audio rejected: ${queued.reason}.`), queued.reason === "backpressure");
        return;
      }
      current.value.receivedAudioMs += chunk.durationMs;
      current.value.receivedAudioBytes += chunk.audioData.byteLength;
      current.value.transport.activity();
      if (current.value.transport.setBackpressured(current.value.queue.backpressured) && current.value.queue.backpressured) {
        emitStreamingEvent(sessionId, {
          sessionId, turnId: current.turnId, sequence: -1, type: "flow_control", paused: true,
          bufferedAudioMs: current.value.queue.bufferedAudioMs, reason: "high_watermark",
        });
      }
      if (!current.value.runtime.pushAudio(chunk)) cancelStreamingVoiceTranscription(sender, sessionId);
    } catch (error) {
      failStreamingSession(sessionId, error);
    }
  });
  port.on("close", () => {
    const current = sessions.get(sessionId);
    if (current?.terminal === null && current.value.port === port) cancelStreamingVoiceTranscription(sender, sessionId);
  });
  port.start();
  return true;
}

export function stopStreamingVoiceTranscription(sender: StreamingVoiceSender, sessionId: string, reason: "provider" | "local_vad" | "manual" = "manual"): boolean {
  const record = ownedActiveSession(sender, sessionId);
  return record ? record.value.runtime.endInput(reason) : false;
}

export function cancelStreamingVoiceTranscription(sender: StreamingVoiceSender, sessionId: string): boolean {
  const record = ownedActiveSession(sender, sessionId);
  return record ? record.value.runtime.cancel() : false;
}

export function cancelStreamingVoiceSessionsForSender(sender: StreamingVoiceSender): void {
  for (const sessionId of sessions.activeSessionIdsForOwner(String(sender.id))) {
    const record = sessions.get(sessionId);
    if (!record) continue;
    record.value.runtime.cancel();
    const remaining = sessions.get(sessionId);
    if (remaining) {
      sessions.finish(sessionId, "cancelled");
      cleanupSession(sessionId, remaining.value);
    }
  }
}

function ownedActiveSession(sender: StreamingVoiceSender, sessionId: string) {
  const record = sessions.get(sessionId);
  return record && record.ownerId === String(sender.id) && record.terminal === null ? record : null;
}

function emitStreamingEvent(sessionId: string, event: DesktopStreamingVoiceTranscriptionEvent): void {
  const record = sessions.get(sessionId);
  if (!record || record.terminal !== null || record.value.sender.isDestroyed()) return;
  const orderedEvent = { ...event, protocolVersion: 2, sequence: record.value.lastEventSequence + 1 } as DesktopStreamingVoiceTranscriptionEvent;
  record.value.lastEventSequence = orderedEvent.sequence;
  record.value.transport.activity();
  if (orderedEvent.type === "audio_ack") {
    record.value.queue.acknowledge(orderedEvent.ack.acknowledgedSequence);
    if (record.value.queue.canResume && record.value.transport.setBackpressured(false)) {
      record.value.sender.send("desktop:voice-streaming-transcription-event", orderedEvent);
      emitStreamingEvent(sessionId, {
        sessionId, turnId: record.turnId, sequence: -1, type: "flow_control", paused: false,
        bufferedAudioMs: record.value.queue.bufferedAudioMs, reason: "low_watermark",
      });
      return;
    }
  }
  record.value.sender.send("desktop:voice-streaming-transcription-event", orderedEvent);
  if (orderedEvent.type === "completed" || orderedEvent.type === "cancelled" || orderedEvent.type === "failed") {
    sessions.finish(sessionId, orderedEvent.type === "completed" ? "completed" : orderedEvent.type === "cancelled" ? "cancelled" : "failed");
    cleanupSession(sessionId, record.value);
  }
}

function failStreamingSession(sessionId: string, error: unknown, retryable = false): void {
  const record = sessions.get(sessionId);
  if (!record || record.terminal !== null) return;
  const normalizedError = normalizeStreamingVoiceError(error, sessionId);
  emitStreamingEvent(sessionId, {
    sessionId,
    turnId: record.turnId,
    sequence: record.value.lastEventSequence + 1,
    type: "failed",
    error: { ...normalizedError, retryable: retryable || normalizedError.retryable },
  });
}

function cleanupSession(sessionId: string, session: ActiveStreamingVoiceSession): void {
  session.detachSender();
  session.transport.finish();
  session.runtime.dispose();
  clearInterval(session.transportTimer);
  session.queue.clear();
  session.port?.close();
  session.port = null;
  sessions.delete(sessionId);
}

function isStreamingProviderConfigured(): boolean {
  return streamingProviderConfiguration() !== null;
}

function streamingProviderConfiguration(): { url: string; token?: string; gatewayAuth: boolean } | null {
  const explicit = process.env.OPENDRSAI_STREAMING_STT_WS_URL?.trim();
  if (explicit) {
    try {
      validateStreamingProviderUrl(explicit);
      return { url: explicit, token: process.env.OPENDRSAI_STREAMING_STT_TOKEN?.trim() || undefined, gatewayAuth: false };
    } catch { return null; }
  }
  const gateway = getGatewaySnapshot();
  if (!gateway.ready || !gateway.baseUrl) return null;
  try {
    const base = new URL(gateway.baseUrl);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = `${base.pathname.replace(/\/$/, "")}/v1/audio/transcriptions/stream`;
    validateStreamingProviderUrl(base.toString());
    const token = getGatewayRequestHeaders()["X-OpenDrSai-Gateway-Token"];
    return { url: base.toString(), token, gatewayAuth: true };
  } catch { return null; }
}

function providerConfigurations(): Array<{ id: string; url: string; token?: string; gatewayAuth: boolean; privacyTier: StreamingProviderCapability["privacyTier"] }> {
  const primary = streamingProviderConfiguration();
  if (!primary) return [];
  const result = [{ id: "primary", ...primary, privacyTier: (process.env.OPENDRSAI_STREAMING_STT_PRIVACY_TIER as StreamingProviderCapability["privacyTier"]) || "private" }];
  const fallbackUrl = process.env.OPENDRSAI_STREAMING_STT_FAILOVER_WS_URL?.trim();
  if (fallbackUrl) {
    try {
      validateStreamingProviderUrl(fallbackUrl);
      result.push({ id: "failover", url: fallbackUrl, token: process.env.OPENDRSAI_STREAMING_STT_FAILOVER_TOKEN?.trim() || undefined, gatewayAuth: false, privacyTier: (process.env.OPENDRSAI_STREAMING_STT_FAILOVER_PRIVACY_TIER as StreamingProviderCapability["privacyTier"]) || "external" });
    } catch { /* invalid failover configuration is unavailable */ }
  }
  return result.filter((item) => ["local", "private", "external"].includes(item.privacyTier));
}

function createProductionStreamingRuntime(
  sessionId: string,
  request: DesktopStreamingVoiceStartRequest,
  emit: (event: DesktopStreamingVoiceTranscriptionEvent) => void,
  authentication?: { authorization: string; principalId: string },
): StreamingTranscriptionRuntime {
  const configurations = providerConfigurations();
  const createCandidate = (configuration: typeof configurations[number]): FailoverRuntimeCandidate => ({
    capability: { id: configuration.id, available: true, protocolVersion: 2, encodings: ["pcm_s16le"], languages: ["*"], endpointing: true, resume: false, maxAudioMs: MAX_SESSION_AUDIO_MS, latencyMs: configuration.id === "primary" ? 0 : 1, costTier: 1, privacyTier: configuration.privacyTier },
    create: (candidateEmit) => new WebSocketStreamingTranscriptionRuntime({
      url: configuration.url, token: configuration.token,
      authentication: configuration.gatewayAuth ? authentication : undefined,
      sessionId, turnId: request.turnId, request, emit: candidateEmit,
      createSocket: (url) => {
        const socket = prewarmedSockets.acquire(url) ?? new WebSocket(url) as unknown as StreamingProviderSocket;
        prewarmedSockets.prewarm(url, 1); return socket;
      },
    }),
  });
  const candidates = configurations.map(createCandidate);
  if (candidates.length > 1) return new FailoverStreamingTranscriptionRuntime(candidates, emit, process.env.OPENDRSAI_STREAMING_STT_ALLOW_FAILOVER === "1");
  return candidates[0].create(emit);
}

async function gatewayStreamingAuthentication(): Promise<{ authorization: string; principalId: string } | undefined> {
  if (!providerConfigurations().some((configuration) => configuration.gatewayAuth)) return undefined;
  const headers = await getAuthenticatedGatewayRequestHeaders();
  const authorization = headers.Authorization;
  const principalId = headers["X-OpenDrSai-Principal"];
  return authorization && principalId ? { authorization, principalId } : undefined;
}
