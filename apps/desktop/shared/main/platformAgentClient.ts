import type { DesktopAgent, PlatformAgentStatus } from "../api/desktopApi";
import type { PlatformAgentExecutionDescriptor } from "./agentCatalog";

const AGENTS_PATH = "/api/native/v1/agents";

export interface PlatformAgentAuthProvider {
  getAccessToken(): Promise<string>;
  refreshAfterUnauthorized(): Promise<string>;
  invalidate(): void;
}

export interface PlatformAgentClientOptions {
  baseUrl: string;
  auth: PlatformAgentAuthProvider;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  refresh?: boolean;
}

export interface PlatformAgentResult {
  agents: DesktopAgent[];
  executionDescriptors: PlatformAgentExecutionDescriptor[];
  status: PlatformAgentStatus;
}

export interface PlatformAgentMutationResult {
  ok: boolean;
  message: string;
}

export async function setPlatformDefaultAgent(
  options: PlatformAgentClientOptions,
  platformId: string,
): Promise<PlatformAgentMutationResult> {
  return mutatePlatformAgent(options, "/api/native/v1/agents/default", {
    method: "PUT",
    body: JSON.stringify({ agent_id: platformId }),
  });
}

export async function recordPlatformAgentUsage(
  options: PlatformAgentClientOptions,
  platformId: string,
): Promise<PlatformAgentMutationResult> {
  return mutatePlatformAgent(
    options,
    `/api/native/v1/agents/${encodeURIComponent(platformId)}/usage`,
    { method: "POST" },
  );
}

export async function stopPlatformAgentThread(
  options: PlatformAgentClientOptions,
  platformId: string,
  threadId: string,
): Promise<PlatformAgentMutationResult> {
  return mutatePlatformAgent(
    options,
    `/api/native/v1/agents/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}/stop`,
    { method: "POST" },
  );
}

export async function respondPlatformAgentInput(
  options: PlatformAgentClientOptions,
  platformId: string,
  threadId: string,
  response: string | Record<string, unknown>,
): Promise<PlatformAgentMutationResult> {
  return mutatePlatformAgent(
    options,
    `/api/native/v1/agents/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}/input`,
    { method: "POST", body: JSON.stringify({ response }) },
  );
}

export async function fetchPlatformAgents(
  options: PlatformAgentClientOptions,
): Promise<PlatformAgentResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  let accessToken: string;
  try {
    accessToken = await options.auth.getAccessToken();
  } catch {
    return emptyResult("requires_login", "Sign in with HepAI to load platform agents.", checkedAt);
  }

  let response = await requestAgents(fetchImpl, options, accessToken);
  if (response.status === 401) {
    try {
      accessToken = await options.auth.refreshAfterUnauthorized();
    } catch {
      options.auth.invalidate();
      return emptyResult("requires_login", "Your HepAI session expired. Sign in again.", checkedAt);
    }
    response = await requestAgents(fetchImpl, options, accessToken);
    if (response.status === 401) {
      options.auth.invalidate();
      return emptyResult("requires_login", "The refreshed HepAI session was rejected. Sign in again.", checkedAt);
    }
  }

  if (response.status === 404 || response.status === 405 || response.status === 501) {
    return emptyResult(
      "native_api_unavailable",
      "The platform Native API is not deployed in this environment. Local agents remain available.",
      checkedAt,
    );
  }
  if (response.status === 403) {
    return emptyResult("forbidden", "This account cannot access the platform agent catalog.", checkedAt);
  }
  if (!response.ok) {
    return emptyResult("error", `Platform catalog request failed (HTTP ${response.status}).`, checkedAt);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return emptyResult("error", "The platform catalog returned invalid JSON.", checkedAt);
  }
  const record = readRecord(body);
  const dataRecord = readRecord(record.data);
  const apiVersion = firstString(
    response.headers.get("x-opendrsai-api-version"),
    record.api_version,
    record.version,
    dataRecord.api_version,
    dataRecord.version,
  );
  const capabilities = normalizeCapabilities(record.capabilities ?? dataRecord.capabilities);
  const normalized = extractAgentArray(body)
    .map(normalizePlatformAgent)
    .filter((item): item is NonNullable<ReturnType<typeof normalizePlatformAgent>> => item !== null);
  return {
    agents: normalized.map((item) => item.agent),
    executionDescriptors: normalized.map((item) => item.executionDescriptor),
    status: {
      state: "ready",
      apiVersion: apiVersion || null,
      capabilities,
      message: apiVersion
        ? `Platform Native API ${apiVersion} is available.`
        : "Platform Native API is available; version was not advertised.",
      lastCheckedAt: checkedAt,
    },
  };
}

async function requestAgents(
  fetchImpl: typeof fetch,
  options: PlatformAgentClientOptions,
  accessToken: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 6000);
  try {
    const url = new URL(joinUrl(options.baseUrl, AGENTS_PATH));
    url.searchParams.set("refresh", options.refresh ? "true" : "false");
    return await fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function emptyResult(
  state: PlatformAgentStatus["state"],
  message: string,
  lastCheckedAt: string,
): PlatformAgentResult {
  return {
    agents: [],
    executionDescriptors: [],
    status: { state, apiVersion: null, capabilities: [], message, lastCheckedAt },
  };
}

function extractAgentArray(body: unknown): unknown[] {
  const record = readRecord(body);
  if (Array.isArray(record.data)) return record.data;
  const data = readRecord(record.data);
  if (Array.isArray(data.agents)) return data.agents;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(record.agents)) return record.agents;
  return [];
}

function normalizePlatformAgent(value: unknown): {
  agent: DesktopAgent;
  executionDescriptor: PlatformAgentExecutionDescriptor;
} | null {
  const agent = readRecord(value);
  const config = readRecord(agent.config);
  const rawId = firstString(agent.id, agent.agent_id, config.id);
  const name = firstString(agent.name, config.name, agent.worker_name, rawId);
  if (!rawId || !name || rawId.startsWith("hai.native.") || isModelLikeEntry(name, agent)) return null;
  const mode = firstString(agent.mode, agent.type, config.mode).toLowerCase();
  const available = normalizeAvailability(agent);
  const publicId = `platform:${rawId}`;
  const model = firstString(agent.model, config.model) || undefined;
  const models = normalizeModelIds(
    agent.models ?? agent.allowed_models ?? agent.available_models ??
    config.models ?? config.allowed_models ?? config.available_models,
  );
  const description = normalizeLocalizedDescription(
    agent.description ?? config.description,
    "Platform agent.",
  );
  return {
    agent: {
      id: publicId,
      name,
      description: description.fallback,
      localizedDescription: description.localized,
      owner: firstString(agent.owner, agent.author, "OpenDrSai"),
      source: "remote",
      status: available ? "running" : "unreachable",
      available,
      featured: agent.featured === true,
      isDefault: agent.is_default === true || agent.isDefault === true,
      capabilities: normalizeAgentCapabilities(agent.capabilities ?? config.capabilities),
      lastUsedAt: firstString(agent.last_used_at, agent.lastUsedAt) || undefined,
      catalogGroup: normalizeCatalogGroup(agent.catalog_group, agent.catalogGroup),
      model,
      models,
      logo: firstString(agent.logo, agent.avatar) || undefined,
      examples: normalizeExamples(agent.examples ?? config.examples),
      error: available ? undefined : "This platform agent is currently unavailable.",
      ...(mode ? { mode } : {}),
    },
    executionDescriptor: {
      publicId,
      platformId: rawId,
      mode: mode || "remote",
      name,
      model,
      available,
    },
  };
}

async function mutatePlatformAgent(
  options: PlatformAgentClientOptions,
  path: string,
  init: { method: "POST" | "PUT"; body?: string },
): Promise<PlatformAgentMutationResult> {
  let accessToken: string;
  try {
    accessToken = await options.auth.getAccessToken();
  } catch {
    return { ok: false, message: "Sign in with HepAI to update agent preferences." };
  }
  let response = await requestMutation(options, path, init, accessToken);
  if (response.status === 401) {
    try {
      accessToken = await options.auth.refreshAfterUnauthorized();
    } catch {
      options.auth.invalidate();
      return { ok: false, message: "Your HepAI session expired. Sign in again." };
    }
    response = await requestMutation(options, path, init, accessToken);
    if (response.status === 401) options.auth.invalidate();
  }
  if (response.ok) return { ok: true, message: "Agent preference saved." };
  if (response.status === 403) {
    return { ok: false, message: "This account cannot update that agent preference." };
  }
  if (response.status === 404) {
    return { ok: false, message: "The selected agent is no longer available." };
  }
  return { ok: false, message: `Agent preference request failed (HTTP ${response.status}).` };
}

async function requestMutation(
  options: PlatformAgentClientOptions,
  path: string,
  init: { method: "POST" | "PUT"; body?: string },
  accessToken: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 6000);
  try {
    return await (options.fetchImpl ?? fetch)(joinUrl(options.baseUrl, path), {
      method: init.method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body,
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isModelLikeEntry(name: string, agent: Record<string, unknown>): boolean {
  if (agent.object === "model") return true;
  if (agent.object === "agent") return false;
  return name.includes("/") && !agent.description && !agent.author && !agent.owner;
}

function normalizeExamples(value: unknown): DesktopAgent["examples"] | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!Array.isArray(value)) return undefined;
  const examples: Exclude<DesktopAgent["examples"], string | undefined> = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      examples.push(item.trim());
      continue;
    }
    const record = readRecord(item);
    const en = firstString(record.en);
    const zh = firstString(record.zh);
    if (en || zh) examples.push({ en, zh });
  }
  return examples.length > 0 ? examples : undefined;
}

function normalizeCapabilities(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  const record = readRecord(value);
  if (Array.isArray(record.features)) {
    return record.features.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  return Object.entries(record)
    .filter(([, enabled]) => enabled === true || (typeof enabled === "number" && enabled > 0))
    .map(([name]) => name);
}

function normalizeModelIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const models: string[] = [];
  for (const item of value) {
    const record = readRecord(item);
    const model = typeof item === "string"
      ? item.trim()
      : firstString(record.id, record.alias, record.model);
    if (model && !models.includes(model)) models.push(model);
  }
  return models.length > 0 ? models : undefined;
}

function normalizeLocalizedDescription(
  value: unknown,
  fallback: string,
): { fallback: string; localized?: { en?: string; zh?: string } } {
  let candidate = value;
  if (typeof candidate === "string") {
    const text = candidate.trim();
    if (!text) return { fallback };
    if (text.startsWith("{") && text.endsWith("}")) {
      try {
        candidate = JSON.parse(text);
      } catch {
        return { fallback: text };
      }
    } else {
      return { fallback: text };
    }
  }
  const record = readRecord(candidate);
  const en = firstString(record.en);
  const zh = firstString(record.zh);
  if (!en && !zh) return { fallback };
  return {
    fallback: en || zh || fallback,
    localized: {
      ...(en ? { en } : {}),
      ...(zh ? { zh } : {}),
    },
  };
}

function normalizeAvailability(agent: Record<string, unknown>): boolean {
  if (typeof agent.available === "boolean") return agent.available;
  const value = firstString(agent.availability, agent.status).toLowerCase();
  return !["disabled", "inactive", "offline", "stopped", "unavailable"].includes(value);
}

function normalizeAgentCapabilities(value: unknown): string[] | undefined {
  const capabilities = normalizeCapabilities(value);
  return capabilities.length ? capabilities : undefined;
}

function normalizeCatalogGroup(...values: unknown[]): "official" | "mine" {
  const value = firstString(...values).toLowerCase();
  return value === "mine" || value === "user" || value === "owned" ? "mine" : "official";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstString(...values: unknown[]): string {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
  return typeof value === "string" ? value.trim() : "";
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
