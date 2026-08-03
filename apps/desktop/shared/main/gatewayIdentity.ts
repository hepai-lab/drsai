import { getGatewayRequestHeaders, getGatewayStatus } from "./gateway";

const ANONYMOUS_USER_ID = "anonymous";
const MAX_USER_ID_CHARS = 200;

let identitySyncChain: Promise<void> = Promise.resolve();
let queuedUserId = ANONYMOUS_USER_ID;

/** Queue a best-effort cli_config.user_id sync (coalesces rapid session writes). */
export function scheduleCliConfigUserIdSync(rawUserId: string | null | undefined): void {
  queuedUserId = normalizeIdentityUserId(rawUserId);
  identitySyncChain = identitySyncChain
    .then(() => syncCliConfigUserId(queuedUserId))
    .then(() => undefined)
    .catch(() => undefined);
}

/** Push desktop auth identity into gateway cli_config.user_id when the gateway is ready. */
export async function syncCliConfigUserId(rawUserId: string | null | undefined): Promise<boolean> {
  const userId = normalizeIdentityUserId(rawUserId);
  const gateway = await getGatewayStatus();
  if (!gateway.ready) return false;
  // Always PUT so the gateway can migrate historical alias rows onto the canonical id.
  await gatewayRequest(gateway.baseUrl, "PUT", "/v1/config/cli/user_id", { value: userId });
  await syncGatewaySessionUserName(gateway.baseUrl, userId);
  return true;
}

async function syncGatewaySessionUserName(baseUrl: string, userId: string): Promise<void> {
  // In-memory override so /health and request defaults match without requiring a gateway restart.
  try {
    await gatewayRequest(baseUrl, "PUT", "/v1/config/user-name", { user_name: userId });
  } catch {
    // Optional on older gateways; cli_config sync is the durable source of truth.
  }
}

export function normalizeIdentityUserId(rawUserId: string | null | undefined): string {
  if (typeof rawUserId !== "string") return ANONYMOUS_USER_ID;
  const trimmed = rawUserId.trim();
  if (!trimmed || trimmed.length > MAX_USER_ID_CHARS || /[\r\n\0]/.test(trimmed)) {
    return ANONYMOUS_USER_ID;
  }
  return trimmed;
}

async function gatewayRequest<T>(
  baseUrl: string,
  method: "GET" | "PUT",
  path: string,
  body?: unknown,
): Promise<T> {
  if (!/^http:\/\/(?:127\.0\.0\.1|\[::1\]|localhost):\d+$/.test(baseUrl)) {
    throw new Error("Gateway identity endpoint must be loopback.");
  }
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      ...getGatewayRequestHeaders(),
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    body: payload,
    signal: AbortSignal.timeout(5_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(readError(text));
  }
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

function readError(text: string): string {
  try {
    const value = JSON.parse(text) as { detail?: unknown; message?: unknown };
    if (typeof value.detail === "string") return value.detail.slice(0, 1000);
    if (typeof value.message === "string") return value.message.slice(0, 1000);
  } catch {
    // Use bounded generic message.
  }
  return "Gateway identity sync failed.";
}
