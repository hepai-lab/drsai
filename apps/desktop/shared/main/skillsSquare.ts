/**
 * Skills Square — public skill marketplace backed by the WebUI backend.
 *
 * The desktop gateway only knows about locally-installed skills (`GET /v1/skills`).
 * Public skills are served by the WebUI backend at `{portalUrl}/api/skills?type=public`.
 *
 * This module bridges the two:
 *  - `listPublicSkillsSquare`  → WebUI `GET /api/skills?type=public` + gateway `/v1/skills` for installed status
 *  - `installPublicSkillSquare` → WebUI `GET /api/skills/{slug}/skill-md` → gateway `POST /v1/skills/install`
 */

import { request as httpRequest } from "http";
import type {
  DesktopPublicSkill,
  DesktopPublicSkillsPage,
  DesktopPublicSkillsListRequest,
  DesktopPublicSkillInstallRequest,
  GatewaySkill,
} from "../api/desktopApi";
import { getAuthSession, requireAuthContext } from "./auth";
import { getGatewayRequestHeaders } from "./gateway";
import { resolveGatewayPort } from "./gatewayEnvironment";
import { getActivePlatformConfig } from "./platformConfig";
import { readSavedApiKey } from "./settings";

const GATEWAY_BASE_URL = `http://127.0.0.1:${resolveGatewayPort()}`;

// ─── Gateway helpers (same pattern as skills.ts) ───────────────────────────

/**
 * Skills must use the same user_id as chat/agent creation.
 * Chat sends authContext.userId (OIDC sub / email); skills previously
 * omitted user_id so the gateway fell back to the OS username and wrote
 * under a different WORKDIR/<user>/configs/skills tree — making Skills UI
 * and the agent disagree about what is installed.
 */
async function resolveSkillsUserId(explicit?: string): Promise<string | undefined> {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  try {
    const session = await getAuthSession();
    const userId = session.user?.id || session.user?.email;
    return userId?.trim() || undefined;
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

// ─── Platform (WebUI) helpers ───────────────────────────────────────────────

/**
 * Resolve a bearer token for the WebUI public-square API.
 * Prefers the OIDC access token from the current auth session;
 * falls back to HEPAI_API_KEY / OPENAI_API_KEY / saved API key.
 */
async function resolvePlatformBearerToken(): Promise<string | null> {
  try {
    const auth = await requireAuthContext();
    if (auth.accessToken) return auth.accessToken;
  } catch {
    // Not signed in via OIDC — fall through to API key.
  }
  return (
    process.env.HEPAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    readSavedApiKey() ||
    null
  );
}

/** Shape returned by the WebUI `GET /api/skills?type=public` endpoint. */
interface WebuiSkillItem {
  slug: string;
  name: string;
  icon?: string;
  version?: string;
  description?: string;
  owner?: string;
  owner_id?: string;
  author?: string;
  visibility?: string;
  source?: string;
  tags?: string[];
  downloads?: number;
  created_at?: string;
  updated_at?: string;
}

interface WebuiSkillsResponse {
  status: boolean;
  data: WebuiSkillItem[];
  pagination?: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
  };
}

/** Shape returned by the WebUI `GET /api/skills/{slug}/skill-md` endpoint. */
interface WebuiSkillMdResponse {
  status: boolean;
  data: { content: string };
}

async function platformFetch<T>(
  path: string,
  token: string,
  timeoutMs = 15_000,
): Promise<T> {
  const { portalUrl } = getActivePlatformConfig();
  const response = await fetch(`${portalUrl}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `WebUI ${path} returned ${response.status}: ${text.slice(0, 200)}`,
    );
  }
  return JSON.parse(text) as T;
}

// ─── Public API ─────────────────────────────────────────────────────────────

function emptyPage(page: number, pageSize: number): DesktopPublicSkillsPage {
  return {
    items: [],
    page,
    pageSize,
    total: 0,
    hasNext: false,
    installedCount: 0,
    notInstalledCount: 0,
  };
}

/**
 * List public skills from the WebUI Skills Square, enriched with local
 * installed status from the desktop gateway.
 */
export async function listPublicSkillsSquare(
  request?: DesktopPublicSkillsListRequest,
): Promise<DesktopPublicSkillsPage> {
  const page = Math.max(1, request?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, request?.pageSize ?? 20));

  // Build query string for WebUI API
  const params = new URLSearchParams({
    type: "public",
    page: String(page),
    page_size: String(pageSize),
  });
  if (request?.q?.trim()) params.set("q", request.q.trim());
  if (request?.tags?.trim()) params.set("tags", request.tags.trim());
  if (request?.sort) params.set("sort", request.sort);

  // Resolve auth token for WebUI backend
  const token = await resolvePlatformBearerToken();
  if (!token) {
    return emptyPage(page, pageSize);
  }

  // Fetch public skills from WebUI backend
  let webuiRes: WebuiSkillsResponse;
  try {
    webuiRes = await platformFetch<WebuiSkillsResponse>(
      `/api/skills?${params.toString()}`,
      token,
    );
  } catch {
    // WebUI unreachable — return empty page so UI stays functional.
    return emptyPage(page, pageSize);
  }

  // Fetch installed skills from local gateway to check `installed` status
  const uid = await resolveSkillsUserId(request?.userId);
  let installedNames = new Set<string>();
  try {
    const qs = uid ? `?user_id=${encodeURIComponent(uid)}` : "";
    const installed = await gatewayFetch<{ data: GatewaySkill[] }>(
      "GET",
      `/v1/skills${qs}`,
    );
    installedNames = new Set((installed.data ?? []).map((s) => s.name));
  } catch {
    // Gateway unavailable — leave all `installed: false`.
  }

  // Map WebUI items to DesktopPublicSkill
  const items: DesktopPublicSkill[] = (webuiRes.data ?? []).map((item) => ({
    slug: item.slug,
    name: item.name,
    description: item.description ?? "",
    owner: item.owner,
    version: item.version,
    downloads: item.downloads,
    tags: item.tags,
    source: item.source,
    updatedAt: item.updated_at,
    installed: installedNames.has(item.name) || installedNames.has(item.slug),
  }));

  // Apply local installFilter (after computing installed status)
  let filtered = items;
  if (request?.installFilter === "installed") {
    filtered = items.filter((i) => i.installed);
  } else if (request?.installFilter === "not_installed") {
    filtered = items.filter((i) => !i.installed);
  }

  const installedCount = items.filter((i) => i.installed).length;
  const notInstalledCount = items.length - installedCount;

  return {
    items: filtered,
    page: webuiRes.pagination?.page ?? page,
    pageSize: webuiRes.pagination?.page_size ?? pageSize,
    total: webuiRes.pagination?.total ?? filtered.length,
    hasNext: webuiRes.pagination?.has_next ?? false,
    installedCount,
    notInstalledCount,
  };
}

/**
 * Install a public skill from the WebUI Skills Square into the local gateway.
 *
 * Flow: WebUI `GET /api/skills/{slug}/skill-md` → gateway `POST /v1/skills/install`
 */
export async function installPublicSkillSquare(
  request: DesktopPublicSkillInstallRequest,
): Promise<{ status: string; name: string; path: string; files: number }> {
  const slug = request.slug?.trim();
  if (!slug) throw new Error("Skill slug is required.");

  // 1. Fetch SKILL.md content from WebUI backend
  const token = await resolvePlatformBearerToken();
  if (!token) {
    throw new Error("Authentication required to install public skills.");
  }

  let skillMdContent: string;
  try {
    const res = await platformFetch<WebuiSkillMdResponse>(
      `/api/skills/${encodeURIComponent(slug)}/skill-md`,
      token,
      30_000, // skill-md may need to download/extract ZIP, allow more time
    );
    skillMdContent = res.data?.content ?? "";
  } catch (err) {
    throw new Error(
      `Failed to fetch skill content: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!skillMdContent) {
    throw new Error(`Skill '${slug}' has no SKILL.md content.`);
  }

  // 2. Install via local gateway
  const name = request.name?.trim() || slug;
  const uid = await resolveSkillsUserId(request.userId);
  const qs = uid ? `?user_id=${encodeURIComponent(uid)}` : "";

  const result = await gatewayFetch<{
    status: string;
    name: string;
    path: string;
    installed_files?: string[];
  }>("POST", `/v1/skills/install${qs}`, {
    name,
    content: skillMdContent,
    source: "public_square",
  });

  const files = Array.isArray(result.installed_files)
    ? result.installed_files.length
    : 1;

  return {
    status: result.status ?? "ok",
    name: result.name ?? name,
    path: result.path ?? "",
    files,
  };
}
