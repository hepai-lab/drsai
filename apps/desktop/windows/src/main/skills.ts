import { request as httpRequest } from "http";
import type {
  GatewaySkill,
  GatewayAvailableSkill,
  GatewaySkillInstallRequest,
} from "../shared/desktopApi";
import { getAuthSession } from "./auth";
import { getGatewayRequestHeaders } from "./gateway";
import { resolveGatewayPort } from "../../../shared/main/gatewayEnvironment";

const GATEWAY_BASE_URL = `http://127.0.0.1:${resolveGatewayPort()}`;

/**
 * Skills must use the same user_id as chat/agent creation.
 * When authenticated, gateway storage is keyed by OIDC subject — never email.
 */
async function resolveSkillsUserId(explicit?: string): Promise<string | undefined> {
  try {
    const session = await getAuthSession();
    const subject = session.user?.id?.trim();
    if (subject) return subject;
  } catch {
    /* fall through */
  }
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  try {
    const session = await getAuthSession();
    return session.user?.email?.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function gatewayFetch<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const json = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      ...getGatewayRequestHeaders(),
      Accept: "application/json",
    };
    if (json) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(json).toString();
    }
    const url = new URL(path, GATEWAY_BASE_URL);
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Gateway ${method} ${path} returned ${res.statusCode}: ${data}`));
            return;
          }
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error(`Gateway response not JSON: ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Gateway request timed out"));
    });
    req.on("error", reject);
    if (json) req.write(json);
    req.end();
  });
}

export async function listInstalledSkills(userId?: string): Promise<GatewaySkill[]> {
  const uid = await resolveSkillsUserId(userId);
  const qs = uid ? `?user_id=${encodeURIComponent(uid)}` : "";
  const res = await gatewayFetch<{ data: GatewaySkill[] }>("GET", `/v1/skills${qs}`);
  return res.data ?? [];
}

export async function listAvailableSkills(userId?: string, coreOnly?: boolean): Promise<GatewayAvailableSkill[]> {
  const uid = await resolveSkillsUserId(userId);
  const params = new URLSearchParams();
  if (uid) params.set("user_id", uid);
  if (coreOnly) params.set("core_only", "true");
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await gatewayFetch<{ data: GatewayAvailableSkill[] }>("GET", `/v1/skills/available${qs}`);
  return res.data ?? [];
}

export async function getSkillContent(
  skillPath: string,
): Promise<{ path: string; content: string }> {
  return gatewayFetch("GET", `/v1/skills/${encodeURIComponent(skillPath)}`);
}

export async function installSkill(
  req: GatewaySkillInstallRequest,
): Promise<{ status: string; name: string; path: string }> {
  const uid = await resolveSkillsUserId(req.userId);
  const qs = uid ? `?user_id=${encodeURIComponent(uid)}` : "";
  return gatewayFetch("POST", `/v1/skills/install${qs}`, {
    name: req.name,
    content: req.content,
    source: req.source,
  });
}

export async function uninstallSkill(
  name: string,
  userId?: string,
): Promise<{ status: string; name: string }> {
  const uid = await resolveSkillsUserId(userId);
  const qs = uid ? `?user_id=${encodeURIComponent(uid)}` : "";
  return gatewayFetch("DELETE", `/v1/skills/${encodeURIComponent(name)}${qs}`);
}

export async function updateSkill(
  name: string,
  content: string,
  userId?: string,
): Promise<{ status: string; name: string; path: string }> {
  const uid = await resolveSkillsUserId(userId);
  const qs = uid ? `?user_id=${encodeURIComponent(uid)}` : "";
  return gatewayFetch("PUT", `/v1/skills/${encodeURIComponent(name)}${qs}`, { name, content });
}

export async function reloadSkills(
  threadId?: string,
  userId?: string,
): Promise<{ ok: boolean; reloaded: boolean }> {
  const uid = await resolveSkillsUserId(userId);
  return gatewayFetch("POST", "/v1/skills/reload", {
    thread_id: threadId,
    user_id: uid,
  });
}
