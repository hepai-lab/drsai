import type {
  DesktopDuplexVoiceAudioChunk,
  DesktopDuplexVoiceCapabilities,
  DesktopDuplexVoiceLiveProbe,
  DesktopDuplexVoiceReadiness,
  DesktopDuplexVoiceInterruptRequest,
  DesktopDuplexVoiceOccupancy,
  DesktopDuplexVoicePlaybackAck,
  DesktopDuplexVoiceSessionStartRequest,
  DesktopDuplexVoiceSessionStartResult,
  DesktopDuplexVoiceTakeoverRequest,
  DesktopDuplexVoiceToolResultRequest,
} from "../../../api/desktopApi";
import { getAuthenticatedGatewayRequestHeaders, getGatewayRequestHeaders, getGatewayStatus, startGateway } from "../../gateway";
import { getMyDrSaiAgentModelPolicy, probeMyDrSaiAgentRealtimeVoice } from "../../myDrSaiConfig";
import { DuplexVoiceRuntime, type DuplexProviderSocket } from "./runtime";
import { DuplexSessionRegistry } from "./sessionRegistry";
import { ZhizengzengRealtimeAdapter, ZHIZENGZENG_REALTIME_CAPABILITIES } from "./zhizengzengRealtimeAdapter";
import { buildDuplexVoiceReadiness, hasUsableDuplexCredential } from "./readiness";

export interface DuplexVoiceSender {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, events: unknown): void;
  once(event: "destroyed", listener: () => void): unknown;
  removeListener(event: "destroyed", listener: () => void): unknown;
}

export interface DuplexVoiceMessagePort {
  on(event: "message", listener: (message: { data: unknown }) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  start(): void;
  close(): void;
}

interface PreparedSession {
  connectionUrl: string;
  startEvent: Record<string, unknown>;
  adapter: ZhizengzengRealtimeAdapter;
  capabilities: DesktopDuplexVoiceCapabilities;
}

const prepared = new Map<string, PreparedSession>();
const ports = new Map<string, DuplexVoiceMessagePort>();
const owners = new Map<string, { sender: DuplexVoiceSender; listener: () => void }>();
const readySessions = new Set<string>();
let gatewayRecoveryPromise: Promise<boolean> | null = null;

function recoverGatewayForDuplexReconnect(): void {
  if (gatewayRecoveryPromise) return;
  gatewayRecoveryPromise = startGateway()
    .catch(() => false)
    .finally(() => { gatewayRecoveryPromise = null; });
}

const registry = new DuplexSessionRegistry({
  maxGlobalSessions: 1,
  createRuntime: (_ownerId, request, emit) => {
    const setup = prepared.get(request.sessionId);
    if (!setup) throw new Error("Duplex Session was not securely prepared.");
    return new DuplexVoiceRuntime({
      request,
      connection: { url: setup.connectionUrl, headers: {} },
      adapter: setup.adapter,
      createSocket: (connection) => createAuthenticatedSocket(connection.url, setup.startEvent),
      emit: (event) => {
        if (event.type === "session_started") readySessions.add(request.sessionId);
        emit(event);
        if (event.type === "connection_state" && event.state === "reconnecting") recoverGatewayForDuplexReconnect();
      },
      idleTimeoutMs: 5 * 60_000,
      maxSessionMs: 30 * 60_000,
      maxReconnectAttempts: request.autoRecovery === false ? 0 : 5,
      reconnectBaseDelayMs: 500,
      injectDisconnectAfterFirstSessionReady: process.env.OPENDRSAI_E2E_DUPLEX_RECOVERY === "1"
        && process.env.OPENDRSAI_E2E_DUPLEX_DISCONNECT_ONCE === "1",
    });
  },
  emitBatch: (ownerId, events) => {
    const owner = owners.get(ownerId);
    if (!owner || owner.sender.isDestroyed()) return;
    owner.sender.send("desktop:voice-duplex-events", events);
  },
  onRemoved: (ownerId, sessionId) => {
    readySessions.delete(sessionId);
    ports.get(sessionId)?.close(); ports.delete(sessionId);
    prepared.delete(sessionId);
    const owner = owners.get(ownerId);
    if (owner) { owner.sender.removeListener("destroyed", owner.listener); owners.delete(ownerId); }
  },
  getCapabilities: (_ownerId, request) => prepared.get(request.sessionId)?.capabilities,
});

export function getDuplexVoiceCapabilities(): DesktopDuplexVoiceCapabilities {
  return { ...ZHIZENGZENG_REALTIME_CAPABILITIES, inputAudioEncodings: [...ZHIZENGZENG_REALTIME_CAPABILITIES.inputAudioEncodings], outputAudioEncodings: [...ZHIZENGZENG_REALTIME_CAPABILITIES.outputAudioEncodings], inputSampleRatesHz: [...ZHIZENGZENG_REALTIME_CAPABILITIES.inputSampleRatesHz], outputSampleRatesHz: [...ZHIZENGZENG_REALTIME_CAPABILITIES.outputSampleRatesHz] };
}

export async function getDuplexVoiceReadiness(): Promise<DesktopDuplexVoiceReadiness> {
  const checkedAt = new Date().toISOString();
  const rolloutReady = process.env.OPENDRSAI_ENABLE_DUPLEX_VOICE === "1" || process.env.OPENDRSAI_VOICE_RUNTIME === "fixture";

  let gatewayReady = false;
  try {
    gatewayReady = (await getGatewayStatus()).ready;
    if (!gatewayReady && await startGateway()) gatewayReady = (await getGatewayStatus()).ready;
  } catch { gatewayReady = false; }

  let credentialReady = false;
  if (gatewayReady) {
    try { credentialReady = Boolean((await getAuthenticatedGatewayRequestHeaders()).Authorization); } catch { credentialReady = false; }
  }

  let providerId: string | null = null;
  let modelId: string | null = null;
  let liveProbe: DesktopDuplexVoiceLiveProbe | null = null;
  if (gatewayReady) {
    try {
      const policy = await getMyDrSaiAgentModelPolicy();
      const ref = policy.effective_realtime_voice_ref ?? policy.realtime_voice_model?.ref;
      providerId = ref?.provider_id ?? null;
      modelId = ref?.model_id ?? null;
      if (providerId && modelId) liveProbe = await probeMyDrSaiAgentRealtimeVoice(policy.agent_id);
    } catch { /* represented by the model check below */ }
  }
  credentialReady = hasUsableDuplexCredential(credentialReady, liveProbe);
  return buildDuplexVoiceReadiness({ rolloutReady, gatewayReady, credentialReady, providerId, modelId, checkedAt, capabilities: getDuplexVoiceCapabilities(), liveProbe });
}

export async function startDuplexVoiceSession(sender: DuplexVoiceSender, request: DesktopDuplexVoiceSessionStartRequest): Promise<DesktopDuplexVoiceSessionStartResult> {
  return startOrTakeOverDuplexVoiceSession(sender, request);
}

export function getDuplexVoiceOccupancy(sender: DuplexVoiceSender): DesktopDuplexVoiceOccupancy {
  return registry.occupancy(String(sender.id));
}

export function isDuplexVoiceSessionReady(sender: DuplexVoiceSender): boolean {
  const ownerId = String(sender.id);
  const occupancy = registry.occupancy(ownerId);
  return Boolean(occupancy.sessionId && readySessions.has(occupancy.sessionId));
}

export async function takeOverDuplexVoiceSession(sender: DuplexVoiceSender, request: DesktopDuplexVoiceTakeoverRequest): Promise<DesktopDuplexVoiceSessionStartResult> {
  if (!request || typeof request.expectedSessionId !== "string" || !request.session) throw new Error("Realtime voice takeover request is invalid.");
  return startOrTakeOverDuplexVoiceSession(sender, request.session, request.expectedSessionId);
}

async function startOrTakeOverDuplexVoiceSession(sender: DuplexVoiceSender, request: DesktopDuplexVoiceSessionStartRequest, expectedOccupiedSessionId?: string): Promise<DesktopDuplexVoiceSessionStartResult> {
  const readiness = await getDuplexVoiceReadiness();
  if (!readiness.available || !readiness.capabilities) throw new Error(readiness.message);
  if (request.providerId !== readiness.providerId || request.modelId !== readiness.modelId) throw new Error("Realtime voice model binding changed. Check readiness again.");
  if (request.enableInputTranscription && !readiness.capabilities.supportsInputTranscription) throw new Error("Realtime input transcription was not verified.");
  if (request.enableOutputTranscription && !readiness.capabilities.supportsOutputTranscription) throw new Error("Realtime output transcription was not verified.");
  if (request.enableServerVad && !readiness.capabilities.supportsServerVad) throw new Error("Realtime server VAD was not verified.");
  if (request.enableToolCalling && !readiness.capabilities.supportsToolCalling) throw new Error("Realtime tool calling was not verified.");
  const ownerId = String(sender.id);
  if (owners.has(ownerId)) return registry.start(ownerId, request);
  const adapter = new ZhizengzengRealtimeAdapter({ transcriptionModel: "gpt-4o-mini-transcribe", tools: [
    { type: "function", name: "search_thread_messages", description: "Search stable text in the current OpenDrSai thread without modifying anything.", parameters: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string", minLength: 1, maxLength: 500 }, limit: { type: "integer", minimum: 1, maximum: 20 } } } },
    { type: "function", name: "get_voice_runtime_status", description: "Read the current voice runtime status without modifying anything.", parameters: { type: "object", additionalProperties: false, properties: {} } },
  ] });
  adapter.createSessionUpdate(request);
  let gateway = await getGatewayStatus();
  if (!gateway.ready && await startGateway()) gateway = await getGatewayStatus();
  if (!gateway.ready || !gateway.baseUrl) throw new Error("OpenDrSai Gateway is unavailable for Realtime voice.");
  const url = new URL(gateway.baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/audio/duplex`;
  if (!isSafeGatewayUrl(url)) throw new Error("Realtime Gateway URL is invalid.");
  const gatewayToken = getGatewayRequestHeaders()["X-OpenDrSai-Gateway-Token"];
  if (!gatewayToken) throw new Error("Realtime Gateway authentication is unavailable.");
  const authHeaders = await getAuthenticatedGatewayRequestHeaders();
  const startEvent = {
    type: "start", token: gatewayToken, protocolVersion: 2, sessionId: request.sessionId,
    providerId: request.providerId, modelId: request.modelId,
    ...(authHeaders.Authorization && authHeaders["X-OpenDrSai-Principal"] ? { authorization: authHeaders.Authorization, principalId: authHeaders["X-OpenDrSai-Principal"] } : {}),
  };
  const listener = (): void => { registry.disposeOwner(ownerId); };
  prepared.set(request.sessionId, { connectionUrl: url.toString(), startEvent, adapter, capabilities: readiness.capabilities });
  owners.set(ownerId, { sender, listener });
  sender.once("destroyed", listener);
  try {
    const result = expectedOccupiedSessionId
      ? registry.takeOver(ownerId, expectedOccupiedSessionId, request)
      : registry.start(ownerId, request);
    prepared.delete(request.sessionId);
    return result;
  }
  catch (error) { prepared.delete(request.sessionId); owners.delete(ownerId); sender.removeListener("destroyed", listener); throw error; }
}

export function attachDuplexVoiceAudioPort(sender: DuplexVoiceSender, sessionId: string, port: DuplexVoiceMessagePort): boolean {
  const runtime = registry.get(sessionId, String(sender.id));
  if (!runtime || ports.has(sessionId)) { port.close(); return false; }
  ports.set(sessionId, port);
  port.on("message", (message) => {
    const active = registry.get(sessionId, String(sender.id));
    if (!active) return;
    try {
      const data = message.data as (DesktopDuplexVoiceAudioChunk | (DesktopDuplexVoicePlaybackAck & { type?: string }));
      const accepted = data && typeof data === "object" && "type" in data && data.type === "playback_ack"
        ? active.acknowledgePlayback(data)
        : active.pushAudio(data as DesktopDuplexVoiceAudioChunk);
      if (!accepted) throw new Error("Duplex audio channel message was rejected.");
    }
    catch { active.cancel(); }
  });
  port.on("close", () => { if (ports.get(sessionId) === port) { ports.delete(sessionId); registry.get(sessionId, String(sender.id))?.cancel(); } });
  port.start();
  return true;
}

export function updateDuplexVoiceSession(sender: DuplexVoiceSender, request: DesktopDuplexVoiceSessionStartRequest): boolean { return registry.get(request.sessionId, String(sender.id))?.update(request) ?? false; }
export function interruptDuplexVoiceSession(sender: DuplexVoiceSender, request: DesktopDuplexVoiceInterruptRequest): boolean { return registry.get(request.sessionId, String(sender.id))?.interrupt(request.interruptId, request.responseId, request.itemId, request.contentIndex, request.playedAudioMs, request.reason) ?? false; }
export function submitDuplexVoiceToolResult(sender: DuplexVoiceSender, request: DesktopDuplexVoiceToolResultRequest): boolean { return registry.get(request.sessionId, String(sender.id))?.submitToolResult(request.callId, request.output) ?? false; }
export function submitDuplexVoiceTextInput(sender: DuplexVoiceSender, request: import("../../../api/desktopApi").DesktopDuplexVoiceTextInputRequest): boolean { return registry.get(request.sessionId, String(sender.id))?.submitTextInput(request.itemId, request.text) ?? false; }
export function stopDuplexVoiceSession(sender: DuplexVoiceSender, sessionId: string): boolean { return registry.get(sessionId, String(sender.id))?.stop() ?? false; }
export function finishDuplexVoiceTurn(sender: DuplexVoiceSender, sessionId: string): boolean { return registry.get(sessionId, String(sender.id))?.finishTurn() ?? false; }
export function cancelDuplexVoiceSession(sender: DuplexVoiceSender, sessionId: string): boolean { return registry.get(sessionId, String(sender.id))?.cancel() ?? false; }
export function disposeDuplexVoiceSession(sender: DuplexVoiceSender, sessionId: string): boolean { return registry.disposeSession(sessionId, String(sender.id)); }
export function disposeDuplexVoiceSessionsForSender(sender: DuplexVoiceSender): void { registry.disposeOwner(String(sender.id)); }
export function disposeAllDuplexVoiceSessions(): void { registry.disposeAll(); }

function createAuthenticatedSocket(url: string, startEvent: Record<string, unknown>): DuplexProviderSocket {
  const socket = new WebSocket(url) as unknown as DuplexProviderSocket;
  let pending: Record<string, unknown> | null = startEvent;
  const facade: DuplexProviderSocket = {
    get readyState() { return socket.readyState; },
    addEventListener(type, listener) {
      if (type !== "open") { socket.addEventListener(type, listener); return; }
      socket.addEventListener("open", (event) => {
        if (!pending) return;
        socket.send(JSON.stringify(pending)); pending = null;
        listener(event);
      });
    },
    send(data) { socket.send(data); },
    close(code, reason) { pending = null; socket.close(code, reason); },
  };
  return facade;
}

function isSafeGatewayUrl(url: URL): boolean { return (url.protocol === "ws:" || url.protocol === "wss:") && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash; }
