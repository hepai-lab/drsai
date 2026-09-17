import type {
  DesktopWeChatChannelStatus,
  DesktopWeChatLoginCancelResult,
  DesktopWeChatLoginPollRequest,
  DesktopWeChatLoginPollResult,
  DesktopWeChatLoginStartResult,
  DesktopWeChatSessionSummary,
  DesktopWeChatReplyCapability,
  DesktopWeChatReplyCapabilityRequest,
  DesktopWeChatOutboundRequest,
  DesktopWeChatOutboundResult,
} from "../api/desktopApi";
import { getAuthenticatedGatewayRequestHeaders, getGatewayStatus, startGateway } from "./gateway";

const MAX_RESPONSE_BYTES = 64 * 1024;
const OPERATION_ID = /^wechat-login:[A-Za-z0-9_-]{20,128}$/;

interface RuntimeStatus {
  configured: boolean;
  credential_state: "missing" | "valid" | "expired" | "unavailable";
  runtime_state: "stopped" | "running" | "failed";
  account_label?: string | null;
  login_time?: string | null;
  expires_at?: string | null;
  started_at?: string | null;
  error_code?: string | null;
  model_policy?: Partial<Record<"primary" | "image_understanding" | "image_generation" | "text_to_speech" | "realtime_voice" | "speech_to_text", {
    provider_id: string;
    model_id: string;
  }>>;
  media_capabilities?: {
    image_understanding?: boolean;
    image_generation?: boolean;
  };
}

async function requestGateway<T>(method: string, path: string, options?: { body?: unknown; headers?: Record<string, string> }): Promise<T> {
  let gateway = await getGatewayStatus();
  if (!gateway.ready) {
    await startGateway();
    gateway = await getGatewayStatus();
  }
  if (!gateway.ready) throw new Error("OpenDrSai Runtime is not available.");
  const response = await fetch(new URL(path, gateway.baseUrl), {
    method,
    headers: { ...await getAuthenticatedGatewayRequestHeaders(), Accept: "application/json", ...(options?.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options?.headers ?? {}) },
    ...(options?.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("WeChat Runtime response is too large.");
  if (!response.ok) {
    let message = `WeChat Runtime request failed (${response.status}).`;
    try {
      const parsed = JSON.parse(text) as { detail?: { message?: string } | string };
      if (typeof parsed.detail === "string") message = parsed.detail;
      else if (parsed.detail?.message) message = parsed.detail.message;
    } catch { /* use stable fallback */ }
    throw new Error(message);
  }
  if (!text) return {} as T;
  try { return JSON.parse(text) as T; }
  catch { throw new Error("WeChat Runtime returned invalid JSON."); }
}

function mapStatus(value: RuntimeStatus): DesktopWeChatChannelStatus {
  const model = (role: keyof NonNullable<RuntimeStatus["model_policy"]>) => {
    const ref = value.model_policy?.[role];
    return ref ? { providerId: ref.provider_id, modelId: ref.model_id } : undefined;
  };
  return {
    configured: value.configured,
    credentialState: value.credential_state,
    runtimeState: value.runtime_state,
    ...(value.account_label ? { accountLabel: value.account_label } : {}),
    ...(value.login_time ? { loginTime: value.login_time } : {}),
    ...(value.expires_at ? { expiresAt: value.expires_at } : {}),
    ...(value.started_at ? { startedAt: value.started_at } : {}),
    ...(value.error_code ? { errorCode: value.error_code } : {}),
    modelPolicy: {
      ...(model("primary") ? { primary: model("primary") } : {}),
      ...(model("image_understanding") ? { imageUnderstanding: model("image_understanding") } : {}),
      ...(model("image_generation") ? { imageGeneration: model("image_generation") } : {}),
      ...(model("text_to_speech") ? { textToSpeech: model("text_to_speech") } : {}),
      ...(model("realtime_voice") ? { realtimeVoice: model("realtime_voice") } : {}),
      ...(model("speech_to_text") ? { speechToText: model("speech_to_text") } : {}),
    },
    mediaCapabilities: {
      imageUnderstanding: value.media_capabilities?.image_understanding === true,
      imageGeneration: value.media_capabilities?.image_generation === true,
    },
  };
}

function operationId(request: DesktopWeChatLoginPollRequest): string {
  const value = request?.operationId?.trim();
  if (!OPERATION_ID.test(value)) throw new Error("WeChat login operation id is invalid.");
  return encodeURIComponent(value);
}

export async function getWeChatChannelStatus(): Promise<DesktopWeChatChannelStatus> {
  return mapStatus(await requestGateway("GET", "/v1/channels/wechat/status"));
}
export async function startWeChatLogin(): Promise<DesktopWeChatLoginStartResult> {
  const value = await requestGateway<any>("POST", "/v1/channels/wechat/login");
  return { operationId: value.operation_id, qrContent: value.qr_content, status: value.status, expiresAt: value.expires_at, pollIntervalSeconds: value.poll_interval_seconds };
}
export async function pollWeChatLogin(request: DesktopWeChatLoginPollRequest): Promise<DesktopWeChatLoginPollResult> {
  const value = await requestGateway<any>("POST", `/v1/channels/wechat/login/${operationId(request)}/poll`);
  return { operationId: value.operation_id, status: value.status, ...(value.expires_at ? { expiresAt: value.expires_at } : {}), ...(value.poll_interval_seconds ? { pollIntervalSeconds: value.poll_interval_seconds } : {}), ...(value.retry_after_seconds ? { retryAfterSeconds: value.retry_after_seconds } : {}), ...(value.account_label ? { accountLabel: value.account_label } : {}) };
}
export async function cancelWeChatLogin(request: DesktopWeChatLoginPollRequest): Promise<DesktopWeChatLoginCancelResult> {
  const value = await requestGateway<any>("DELETE", `/v1/channels/wechat/login/${operationId(request)}`);
  return { operationId: value.operation_id, status: "cancelled", cancelled: value.cancelled === true };
}
export async function startWeChatChannel(): Promise<DesktopWeChatChannelStatus> { return mapStatus(await requestGateway("POST", "/v1/channels/wechat/start")); }
export async function stopWeChatChannel(): Promise<DesktopWeChatChannelStatus> { return mapStatus(await requestGateway("POST", "/v1/channels/wechat/stop")); }
export async function logoutWeChatChannel(): Promise<DesktopWeChatChannelStatus> { return mapStatus(await requestGateway("DELETE", "/v1/channels/wechat/credentials")); }
export function getWeChatSessionSummary(): Promise<DesktopWeChatSessionSummary> { return requestGateway("GET", "/v1/channels/wechat/sessions"); }
const SESSION_ID = /^session-[A-Za-z0-9-]{20,200}$/;
function sessionPath(request: DesktopWeChatReplyCapabilityRequest): string {
  const value = request?.sessionId?.trim();
  if (!SESSION_ID.test(value)) throw new Error("WeChat Runtime Session id is invalid.");
  return encodeURIComponent(value);
}
export function getWeChatReplyCapability(request: DesktopWeChatReplyCapabilityRequest): Promise<DesktopWeChatReplyCapability> {
  return requestGateway("GET", `/v1/channels/wechat/sessions/${sessionPath(request)}/reply-capability`);
}
export async function sendToWeChat(request: DesktopWeChatOutboundRequest): Promise<DesktopWeChatOutboundResult> {
  const text = request?.text?.trim();
  if (!text || text.length > 20_000) throw new Error("WeChat reply text is invalid.");
  if (request.confirmExternalSend !== true) throw new Error("Explicit external-send confirmation is required.");
  if (!/^[A-Za-z0-9_.:-]{16,200}$/.test(request.idempotencyKey)) throw new Error("WeChat outbound idempotency key is invalid.");
  const value = await requestGateway<any>("POST", `/v1/channels/wechat/sessions/${sessionPath(request)}/outbound-messages`, {
    body: { text, confirm_external_send: true }, headers: { "Idempotency-Key": request.idempotencyKey },
  });
  return { deliveryId: value.delivery_id, sessionId: value.session_id, status: value.status, attemptCount: value.attempt_count, ...(value.error_code ? { errorCode: value.error_code } : {}) };
}
