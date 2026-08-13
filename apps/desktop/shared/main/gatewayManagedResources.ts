import type {
  GatewayAvailableSkill,
  GatewaySkill,
  GatewaySkillInstallRequest,
  GfsDownloadRequest,
  GfsListRequest,
  GfsListResult,
  GfsObjectInfo,
  GfsUploadRequest,
} from "../api/desktopApi";
import { getAuthSession } from "./auth";
import { getGatewayRequestHeaders } from "./gateway";
import { resolveGatewayPort } from "./gatewayEnvironment";

const gatewayBaseUrl = `http://127.0.0.1:${resolveGatewayPort()}`;
const maxResponseBytes = 8 * 1024 * 1024;

async function requestGateway<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  const session = await getAuthSession().catch(() => null);
  const userId = session?.user?.email?.trim() || session?.user?.id?.trim() || "";
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(new URL(path, gatewayBaseUrl), {
    method,
    headers: {
      ...getGatewayRequestHeaders(),
      Accept: "application/json",
      ...(userId ? { "X-OpenDrSai-User": userId } : {}),
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    body: payload,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (text.length > maxResponseBytes) throw new Error("Gateway resource response is too large.");
  if (!response.ok) throw new Error(`Gateway ${method} ${path} returned ${response.status}: ${text.slice(0, 300)}`);
  if (!text) return {} as T;
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`Gateway ${method} ${path} returned invalid JSON.`); }
}

async function skillsUserId(explicit?: string): Promise<string | undefined> {
  const value = explicit?.trim();
  if (value) return value;
  const session = await getAuthSession().catch(() => null);
  return session?.user?.id?.trim() || session?.user?.email?.trim() || undefined;
}

const userQuery = async (userId?: string) => {
  const resolved = await skillsUserId(userId);
  return resolved ? `?user_id=${encodeURIComponent(resolved)}` : "";
};

export async function listInstalledSkills(userId?: string): Promise<GatewaySkill[]> {
  return (await requestGateway<{ data: GatewaySkill[] }>("GET", `/v1/skills${await userQuery(userId)}`)).data ?? [];
}
export async function listAvailableSkills(userId?: string): Promise<GatewayAvailableSkill[]> {
  return (await requestGateway<{ data: GatewayAvailableSkill[] }>("GET", `/v1/skills/available${await userQuery(userId)}`)).data ?? [];
}
export const getSkillContent = (skillPath: string) => requestGateway<{ path: string; content: string }>("GET", `/v1/skills/${encodeURIComponent(skillPath)}`);
export async function installSkill(request: GatewaySkillInstallRequest) {
  return requestGateway<{ status: string; name: string; path: string }>("POST", `/v1/skills/install${await userQuery(request.userId)}`, { name: request.name, content: request.content, source: request.source });
}
export async function uninstallSkill(name: string, userId?: string) {
  return requestGateway<{ status: string; name: string }>("DELETE", `/v1/skills/${encodeURIComponent(name)}${await userQuery(userId)}`);
}
export async function updateSkill(name: string, content: string, userId?: string) {
  return requestGateway<{ status: string; name: string; path: string }>("PUT", `/v1/skills/${encodeURIComponent(name)}${await userQuery(userId)}`, { name, content });
}
export async function reloadSkills(threadId?: string, userId?: string) {
  return requestGateway<{ ok: boolean; reloaded: boolean }>("POST", "/v1/skills/reload", { thread_id: threadId, user_id: await skillsUserId(userId) });
}

export const gfsList = (request: GfsListRequest): Promise<GfsListResult> => requestGateway("POST", "/v1/gfs/list", request);
export const gfsStat = (path: string): Promise<GfsObjectInfo> => requestGateway("POST", "/v1/gfs/stat", { path });
export const gfsRead = (path: string): Promise<{ path: string; content: string }> => requestGateway("POST", "/v1/gfs/read", { path });
export const gfsWrite = (path: string, content: string, contentType?: string): Promise<{ path: string; etag: string }> => requestGateway("POST", "/v1/gfs/write", { path, content, ...(contentType ? { content_type: contentType, contentType } : {}) });
export const gfsUploadFile = (request: GfsUploadRequest): Promise<{ path: string; size: number }> => requestGateway("POST", "/v1/gfs/upload", request);
export const gfsDownloadFile = (request: GfsDownloadRequest): Promise<{ localPath: string; size: number }> => requestGateway("POST", "/v1/gfs/download", request);
export const gfsDelete = (path: string): Promise<{ path: string }> => requestGateway("POST", "/v1/gfs/delete", { path });
export const gfsShareUrl = (path: string, ttlMinutes?: number, responseContentType?: string): Promise<{ url: string; expiresAt: string }> => requestGateway("POST", "/v1/gfs/share-url", { path, ttl_minutes: ttlMinutes ?? 60, ...(responseContentType ? { response_content_type: responseContentType, responseContentType } : {}) });
export const gfsHealthcheck = (): Promise<{ ok: boolean; bucket?: string; mode?: string; reason?: string }> => requestGateway("GET", "/v1/gfs/health");
