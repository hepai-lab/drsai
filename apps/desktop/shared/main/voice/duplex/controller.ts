import type {
  DesktopDuplexVoiceAudioChunk,
  DesktopDuplexVoiceCapabilities,
  DesktopDuplexVoiceInterruptRequest,
  DesktopDuplexVoiceSessionStartRequest,
  DesktopDuplexVoiceSessionStartResult,
  DesktopDuplexVoiceToolResultRequest,
} from "../../../api/desktopApi";
import { getAuthenticatedGatewayRequestHeaders, getGatewayRequestHeaders, getGatewayStatus } from "../../gateway";
import { DuplexVoiceRuntime, type DuplexProviderSocket } from "./runtime";
import { DuplexSessionRegistry } from "./sessionRegistry";
import { ZhizengzengRealtimeAdapter, ZHIZENGZENG_REALTIME_CAPABILITIES } from "./zhizengzengRealtimeAdapter";

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
}

const prepared = new Map<string, PreparedSession>();
const ports = new Map<string, DuplexVoiceMessagePort>();
const owners = new Map<string, { sender: DuplexVoiceSender; listener: () => void }>();

const registry = new DuplexSessionRegistry({
  maxGlobalSessions: 2,
  createRuntime: (_ownerId, request, emit) => {
    const setup = prepared.get(request.sessionId);
    if (!setup) throw new Error("Duplex Session was not securely prepared.");
    return new DuplexVoiceRuntime({
      request,
      connection: { url: setup.connectionUrl, headers: {} },
      adapter: setup.adapter,
      createSocket: (connection) => createAuthenticatedSocket(connection.url, setup.startEvent),
      emit,
      idleTimeoutMs: 5 * 60_000,
      maxSessionMs: 30 * 60_000,
      maxReconnectAttempts: 3,
      reconnectBaseDelayMs: 500,
    });
  },
  emitBatch: (ownerId, events) => {
    const owner = owners.get(ownerId);
    if (!owner || owner.sender.isDestroyed()) return;
    owner.sender.send("desktop:voice-duplex-events", events);
  },
  onRemoved: (ownerId, sessionId) => {
    ports.get(sessionId)?.close(); ports.delete(sessionId);
    prepared.delete(sessionId);
    const owner = owners.get(ownerId);
    if (owner) { owner.sender.removeListener("destroyed", owner.listener); owners.delete(ownerId); }
  },
});

export function getDuplexVoiceCapabilities(): DesktopDuplexVoiceCapabilities {
  return { ...ZHIZENGZENG_REALTIME_CAPABILITIES, inputAudioEncodings: [...ZHIZENGZENG_REALTIME_CAPABILITIES.inputAudioEncodings], outputAudioEncodings: [...ZHIZENGZENG_REALTIME_CAPABILITIES.outputAudioEncodings], inputSampleRatesHz: [...ZHIZENGZENG_REALTIME_CAPABILITIES.inputSampleRatesHz], outputSampleRatesHz: [...ZHIZENGZENG_REALTIME_CAPABILITIES.outputSampleRatesHz] };
}

export async function startDuplexVoiceSession(sender: DuplexVoiceSender, request: DesktopDuplexVoiceSessionStartRequest): Promise<DesktopDuplexVoiceSessionStartResult> {
  if (process.env.OPENDRSAI_ENABLE_DUPLEX_VOICE !== "1" && process.env.OPENDRSAI_VOICE_RUNTIME !== "fixture") throw new Error("Duplex voice is disabled by the rollout policy.");
  const ownerId = String(sender.id);
  if (owners.has(ownerId)) return registry.start(ownerId, request);
  const adapter = new ZhizengzengRealtimeAdapter({ transcriptionModel: "gpt-4o-mini-transcribe", tools: [
    { type: "function", name: "search_thread_messages", description: "Search stable text in the current OpenDrSai thread without modifying anything.", parameters: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string", minLength: 1, maxLength: 500 }, limit: { type: "integer", minimum: 1, maximum: 20 } } } },
    { type: "function", name: "get_voice_runtime_status", description: "Read the current voice runtime status without modifying anything.", parameters: { type: "object", additionalProperties: false, properties: {} } },
  ] });
  adapter.createSessionUpdate(request);
  const gateway = await getGatewayStatus();
  if (!gateway.ready || !gateway.baseUrl) throw new Error("OpenDrSai Gateway is unavailable for Realtime voice.");
  const url = new URL(gateway.baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/audio/duplex`;
  if (!isSafeGatewayUrl(url)) throw new Error("Realtime Gateway URL is invalid.");
  const gatewayToken = getGatewayRequestHeaders()["X-OpenDrSai-Gateway-Token"];
  if (!gatewayToken) throw new Error("Realtime Gateway authentication is unavailable.");
  const authHeaders = await getAuthenticatedGatewayRequestHeaders();
  const startEvent = {
    type: "start", token: gatewayToken, protocolVersion: 1, sessionId: request.sessionId,
    providerId: request.providerId, modelId: request.modelId,
    ...(authHeaders.Authorization && authHeaders["X-OpenDrSai-Principal"] ? { authorization: authHeaders.Authorization, principalId: authHeaders["X-OpenDrSai-Principal"] } : {}),
  };
  const listener = (): void => { registry.disposeOwner(ownerId); };
  prepared.set(request.sessionId, { connectionUrl: url.toString(), startEvent, adapter });
  owners.set(ownerId, { sender, listener });
  sender.once("destroyed", listener);
  try { const result = registry.start(ownerId, request); prepared.delete(request.sessionId); return result; }
  catch (error) { prepared.delete(request.sessionId); owners.delete(ownerId); sender.removeListener("destroyed", listener); throw error; }
}

export function attachDuplexVoiceAudioPort(sender: DuplexVoiceSender, sessionId: string, port: DuplexVoiceMessagePort): boolean {
  const runtime = registry.get(sessionId, String(sender.id));
  if (!runtime || ports.has(sessionId)) { port.close(); return false; }
  ports.set(sessionId, port);
  port.on("message", (message) => {
    const active = registry.get(sessionId, String(sender.id));
    if (!active) return;
    try { if (!active.pushAudio(message.data as DesktopDuplexVoiceAudioChunk)) throw new Error("Duplex audio frame was rejected."); }
    catch { active.cancel(); }
  });
  port.on("close", () => { if (ports.get(sessionId) === port) { ports.delete(sessionId); registry.get(sessionId, String(sender.id))?.cancel(); } });
  port.start();
  return true;
}

export function updateDuplexVoiceSession(sender: DuplexVoiceSender, request: DesktopDuplexVoiceSessionStartRequest): boolean { return registry.get(request.sessionId, String(sender.id))?.update(request) ?? false; }
export function interruptDuplexVoiceSession(sender: DuplexVoiceSender, request: DesktopDuplexVoiceInterruptRequest): boolean { return registry.get(request.sessionId, String(sender.id))?.interrupt(request.responseId, request.itemId, request.contentIndex, request.playedAudioMs, request.reason) ?? false; }
export function submitDuplexVoiceToolResult(sender: DuplexVoiceSender, request: DesktopDuplexVoiceToolResultRequest): boolean { return registry.get(request.sessionId, String(sender.id))?.submitToolResult(request.callId, request.output) ?? false; }
export function stopDuplexVoiceSession(sender: DuplexVoiceSender, sessionId: string): boolean { return registry.get(sessionId, String(sender.id))?.stop() ?? false; }
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
