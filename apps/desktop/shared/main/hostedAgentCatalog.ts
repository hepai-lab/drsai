/**
 * WebUI-compatible hosted agent catalog.
 *
 * Mirrors `apps/webui/.../agent_mode_cofigs.py`:
 * - `get_user_agents` = DEFAULT_REMOTE_AGENTS + `get_ddf_agents` + user remotes
 * - `get_ddf_agents` = HepAI `client.agents.list()` (`GET /agents/list_agents`)
 *   then `HRModel.connect(...).get_info()` per id, keeping only dict results
 *   (skip `WorkerInfo` / errors), same as WebUI.
 *
 * Device remotes are merged separately in `agents.ts` (WebUI user remote/custom).
 */

import { createHash, randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { DesktopAgent, PlatformAgentStatus } from "../api/desktopApi";
import type { PlatformAgentExecutionDescriptor } from "./agentCatalog";
import {
  invalidateAuthSession,
  refreshAuthContextAfterUnauthorized,
  requireAuthContext,
  getAuthSession,
} from "./auth";
import { getActivePlatformConfig } from "./platformConfig";
import { readSavedApiKey } from "./settings";
import { DRSAI_HOME } from "./paths";

const LIST_AGENTS_TIMEOUT_MS = 12_000;
const INFO_TIMEOUT_MS = Number(process.env.DRSUI_DDF_AGENT_INFO_TIMEOUT || "5") * 1000;
const MAX_INFO_CONCURRENCY = Math.max(
  1,
  Number(process.env.DRSUI_DDF_AGENT_INFO_MAX_CONCURRENCY || "8") || 8,
);

export interface HostedAgentCatalogResult {
  agents: DesktopAgent[];
  executionDescriptors: PlatformAgentExecutionDescriptor[];
  status: PlatformAgentStatus;
}

interface HostedAgentRecord {
  id: string;
  name: string;
  description?: string;
  owner?: string;
  author?: string;
  mode?: string;
  url?: string;
  logo?: string;
  featured?: boolean;
  is_default?: boolean;
  capabilities?: string[];
  examples?: unknown;
  available?: boolean;
}

/** Match WebUI: HepAI client uses `get_active_platform().base_url` only. */
export function resolveDdfApiRoot(configuredBaseUrl: string): string {
  const override = process.env.OPENDRSAI_DDF_API_BASE_URL?.trim();
  let root = (override || configuredBaseUrl).trim().replace(/\/+$/, "");
  // Desktop launchers sometimes append `/v1` for OpenAI-compatible model routes;
  // HepAI agents.list / worker gates live on the `/apiv2` root (WebUI base_url).
  if (root.endsWith("/v1")) root = root.slice(0, -3);
  return root;
}

export async function fetchHostedAgentCatalog(options: {
  refresh?: boolean;
  catalogBaseUrl?: string;
} = {}): Promise<HostedAgentCatalogResult> {
  const checkedAt = new Date().toISOString();
  const credential = await resolveHostedCatalogCredential();
  if (!credential.bearer) {
    return emptyHostedResult(credential.state, credential.message, checkedAt);
  }

  const platform = getActivePlatformConfig();
  const ddfRoot = resolveDdfApiRoot(options.catalogBaseUrl ?? platform.baseUrl);
  const defaults = loadDefaultRemoteAgentRecords();
  const ddfAgents = await fetchDdfAgentsLikeWebUi(
    ddfRoot,
    credential.bearer,
    options.refresh === true,
  );
  const mergedRecords = mergeHostedRecords(defaults, ddfAgents);
  if (mergedRecords.length === 0) {
    return emptyHostedResult(
      "native_api_unavailable",
      `No hosted agents from ${ddfRoot}/agents/list_agents (same source as WebUI get_ddf_agents).`,
      checkedAt,
    );
  }

  const normalized = mergedRecords
    .map((record) => normalizeHostedAgent(record, ddfRoot))
    .filter((item): item is NonNullable<ReturnType<typeof normalizeHostedAgent>> => item !== null);

  return {
    agents: normalized.map((item) => item.agent),
    executionDescriptors: normalized.map((item) => item.executionDescriptor),
    status: {
      state: "ready",
      apiVersion: "ddf-v1",
      capabilities: ["agents", "chat", "streaming"],
      message: `Loaded ${normalized.length} hosted agent(s) via WebUI get_ddf_agents path (${ddfRoot}).`,
      lastCheckedAt: checkedAt,
      lastSuccessfulSyncAt: checkedAt,
      cacheState: "fresh",
    },
  };
}

async function resolveHostedCatalogCredential(): Promise<{
  bearer: string | null;
  state: PlatformAgentStatus["state"];
  message: string;
}> {
  // Desktop-dev keeps OIDC on ai-dev while DDF uses WebUI's HepAI aiapi.
  // Prefer a saved HepAI API key for that catalog path (same key WebUI uses).
  const apiKey = process.env.HEPAI_API_KEY?.trim()
    || process.env.OPENAI_API_KEY?.trim()
    || readSavedApiKey();
  if (apiKey) {
    return { bearer: apiKey, state: "ready", message: "Using saved HepAI API key." };
  }

  try {
    const auth = await requireAuthContext();
    if (auth.authMode === "oidc" && auth.accessToken) {
      return { bearer: auth.accessToken, state: "ready", message: "Using HepAI OIDC access token." };
    }
  } catch {
    // Fall through.
  }

  const session = await getAuthSession();
  if (!session.authenticated) {
    return {
      bearer: null,
      state: "requires_login",
      message: "Sign in with HepAI or save a HepAI API key to load hosted agents.",
    };
  }
  return {
    bearer: null,
    state: "requires_login",
    message: "Save a HepAI API key in settings to load the hosted agent catalog on this device.",
  };
}

/**
 * WebUI `get_ddf_agents`:
 *   models = HepAI(...).agents.list()  → GET /agents/list_agents
 *   for each id: HRModel.connect(...).get_info()
 *   keep only dict results (skip WorkerInfo / errors)
 */
async function fetchDdfAgentsLikeWebUi(
  ddfRoot: string,
  bearer: string,
  _refresh: boolean,
): Promise<HostedAgentRecord[]> {
  const listed = await listAgentsPage(ddfRoot, bearer);
  const modelIds = listed
    .map((row) => row.id)
    .filter((id) => id && id !== "hepai/custom-model");

  const previousByName = new Map<string, string>();
  const enriched = await mapWithConcurrency(modelIds, MAX_INFO_CONCURRENCY, async (modelId) => {
    const info = await fetchAgentGetInfo(ddfRoot, bearer, modelId);
    if (!info) return null;
    // WebUI: isinstance(agent_info, WorkerInfo) → skip
    if (isWorkerInfoPayload(info)) return null;

    const name = firstString(info.name, modelId);
    if (!name) return null;
    const stableId = previousByName.get(name) || randomUUID();
    previousByName.set(name, stableId);
    return {
      id: stableId,
      name,
      description: coerceDescriptionText(info.description, info.announcements) || undefined,
      owner: firstString(info.author, info.owner) || undefined,
      author: firstString(info.author) || undefined,
      mode: "ddf",
      url: ddfRoot,
      logo: firstString(info.logo) || undefined,
      examples: info.examples,
      capabilities: ["chat", "streaming"],
      available: true,
    } satisfies HostedAgentRecord;
  });

  return enriched.filter(Boolean) as HostedAgentRecord[];
}

async function listAgentsPage(
  ddfRoot: string,
  bearer: string,
): Promise<Array<{ id: string; owner?: string }>> {
  const payload = await requestHostedJson(
    `${ddfRoot}/agents/list_agents`,
    bearer,
    LIST_AGENTS_TIMEOUT_MS,
  );
  const record = readRecord(payload);
  const rows = Array.isArray(record.data) ? record.data : Array.isArray(payload) ? payload : [];
  return rows.flatMap((value) => {
    const row = readRecord(value);
    const id = firstString(row.id, row.name);
    if (!id) return [];
    if (row.available === false) return [];
    return [{
      id,
      owner: firstString(row.owner, row.owned_by) || undefined,
    }];
  });
}

/**
 * HRModel.connect(...).get_info() for agents that register a remote `get_info`
 * resolves through `POST /worker/unified_gate/?model=&function=get_info`.
 */
async function fetchAgentGetInfo(
  ddfRoot: string,
  bearer: string,
  modelId: string,
): Promise<Record<string, unknown> | null> {
  const url = `${ddfRoot}/worker/unified_gate/?model=${encodeURIComponent(modelId)}&function=get_info`;
  try {
    const payload = await requestHostedJson(url, bearer, INFO_TIMEOUT_MS, {
      method: "POST",
      body: "{}",
    });
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return payload as Record<string, unknown>;
  } catch {
    // WebUI `_fetch_model_info` returns None on any exception / timeout.
    return null;
  }
}

function isWorkerInfoPayload(info: Record<string, unknown>): boolean {
  // WorkerInfo from HepAI has worker routing fields; agent get_info returns
  // name/description/author/examples (see WebUI isinstance(..., WorkerInfo)).
  const hasWorkerShape = [
    "worker_address",
    "model_names",
    "host_name",
    "last_heartbeat",
    "queue_length",
  ].some((key) => key in info);
  const hasAgentShape = typeof info.name === "string" && info.name.trim().length > 0
    && ("description" in info || "author" in info || "examples" in info || "logo" in info);
  return hasWorkerShape && !hasAgentShape;
}

function loadDefaultRemoteAgentRecords(): HostedAgentRecord[] {
  const configuredPath = process.env.DEFAULT_REMOTE_AGENTS?.trim();
  const candidates = [
    configuredPath,
    join(DRSAI_HOME, "desktop", "default-remote-agents.json"),
    join(DRSAI_HOME, "default-remote-agents.json"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as unknown;
      if (!Array.isArray(parsed)) continue;
      const agents = parsed
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => normalizeDefaultRemoteRecord(item))
        .filter((item): item is HostedAgentRecord => Boolean(item));
      if (agents.length && !agents.some((item) => item.is_default)) {
        agents[0] = { ...agents[0], is_default: true };
      }
      return agents;
    } catch {
      // Try the next candidate path.
    }
  }
  return [];
}

function normalizeDefaultRemoteRecord(raw: Record<string, unknown>): HostedAgentRecord | null {
  const config = readRecord(raw.config);
  const name = firstString(raw.name, config.name);
  if (!name) return null;
  const id = firstString(raw.id) || randomUUID();
  return {
    id,
    name,
    description: coerceDescriptionText(raw.description, raw.announcements) || undefined,
    owner: firstString(raw.owner, raw.author) || undefined,
    mode: firstString(raw.mode) || "remote",
    url: firstString(raw.url, config.url, config.base_url) || undefined,
    logo: firstString(raw.logo) || undefined,
    featured: raw.featured === true || raw.is_default === true,
    is_default: raw.is_default === true,
    capabilities: normalizeCapabilities(raw.capabilities),
    examples: raw.examples,
  };
}

function mergeHostedRecords(...groups: HostedAgentRecord[][]): HostedAgentRecord[] {
  const byKey = new Map<string, HostedAgentRecord>();
  for (const record of groups.flat()) {
    const key = `${record.mode ?? "hosted"}:${record.id}:${record.name}`;
    if (!byKey.has(key)) byKey.set(key, record);
  }
  return [...byKey.values()];
}

function normalizeHostedAgent(record: HostedAgentRecord, ddfRoot: string): {
  agent: DesktopAgent;
  executionDescriptor: PlatformAgentExecutionDescriptor;
} | null {
  const name = record.name.trim();
  if (!name) return null;
  const mode = (record.mode || "ddf").toLowerCase();
  // DDF chat routes by worker/model name (WebUI config.name), not the UUID id.
  const platformId = mode === "ddf" ? name : (record.id.trim() || name);
  const publicId = `platform:${platformId}`;
  const available = record.available !== false;
  const fallback = mode === "remote"
    ? "A remote agent connected through the hosted catalog."
    : "A hosted HepAI worker agent.";
  const localizedDescription = localizeDescription(record.description, fallback);
  const capabilities = record.capabilities?.length
    ? record.capabilities
    : ["chat", "streaming"];
  return {
    agent: {
      id: publicId,
      name,
      description: localizedDescription.zh || localizedDescription.en || fallback,
      localizedDescription,
      owner: record.owner || record.author || "HepAI",
      author: record.author || undefined,
      source: "remote",
      status: available ? "running" : "unreachable",
      mode,
      available,
      featured: record.featured === true,
      isDefault: record.is_default === true,
      capabilities,
      catalogGroup: mode === "remote" ? "mine" : "official",
      catalogState: "live",
      url: record.url || ddfRoot,
      logo: record.logo,
      examples: record.examples as DesktopAgent["examples"],
      error: available ? undefined : "This hosted agent is currently unavailable.",
    },
    executionDescriptor: {
      publicId,
      platformId,
      mode,
      name,
      model: platformId,
      available,
      capabilities,
    },
  };
}

async function requestHostedJson(
  url: string,
  bearer: string,
  timeoutMs: number,
  init: { method?: string; body?: string } = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${bearer}`,
    };
    if (init.body) headers["Content-Type"] = "application/json";

    let response = await fetch(url, {
      method: init.method || "GET",
      headers,
      body: init.body,
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status === 401) {
      try {
        const auth = await refreshAuthContextAfterUnauthorized();
        if (auth.accessToken) {
          response = await fetch(url, {
            method: init.method || "GET",
            headers: {
              ...headers,
              Authorization: `Bearer ${auth.accessToken}`,
            },
            body: init.body,
            redirect: "error",
            signal: controller.signal,
          });
        }
      } catch {
        invalidateAuthSession();
      }
    }
    if (!response.ok) {
      throw new Error(`Hosted catalog request failed (HTTP ${response.status}).`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(`Hosted catalog returned non-JSON content (${contentType || "unknown"}).`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeCapabilities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const capabilities = value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim().toLowerCase());
  return capabilities.length ? capabilities : undefined;
}

function emptyHostedResult(
  state: PlatformAgentStatus["state"],
  message: string,
  checkedAt: string,
): HostedAgentCatalogResult {
  return {
    agents: [],
    executionDescriptors: [],
    status: {
      state,
      apiVersion: null,
      capabilities: [],
      message,
      lastCheckedAt: checkedAt,
      lastSuccessfulSyncAt: null,
      cacheState: "none",
    },
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Match WebUI `getLocalizedDescription`: accept plain text or `{"zh","en"}` JSON/object. */
function coerceDescriptionText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const zh = firstString(record.zh);
      const en = firstString(record.en);
      if (zh || en) return JSON.stringify({ ...(en ? { en } : {}), ...(zh ? { zh } : {}) });
    }
  }
  return null;
}

function localizeDescription(
  raw: string | undefined,
  fallback: string,
): { zh: string; en: string } {
  const text = (raw ?? "").trim();
  if (!text) return { zh: fallback, en: fallback };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const zh = firstString(record.zh) || firstString(record.en) || text;
      const en = firstString(record.en) || firstString(record.zh) || text;
      return { zh, en };
    }
  } catch {
    // Plain text description.
  }
  return { zh: text, en: text };
}

export function hostedCatalogSubjectSuffix(credential: string): string {
  return createHash("sha256").update(credential).digest("hex").slice(0, 20);
}
