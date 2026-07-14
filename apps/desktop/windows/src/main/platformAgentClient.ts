import type { DesktopAgent, PlatformAgentStatus } from "../shared/desktopApi";

const AGENTS_PATH = "/api/native/v1/agents?refresh=false";

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
}

export interface PlatformAgentResult {
  agents: DesktopAgent[];
  status: PlatformAgentStatus;
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
  return {
    agents: extractAgentArray(body)
      .map(normalizePlatformAgent)
      .filter((agent): agent is DesktopAgent => agent !== null),
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
    return await fetchImpl(joinUrl(options.baseUrl, AGENTS_PATH), {
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

function normalizePlatformAgent(value: unknown): DesktopAgent | null {
  const agent = readRecord(value);
  const config = readRecord(agent.config);
  const rawId = firstString(agent.id, agent.agent_id, config.id);
  const name = firstString(agent.name, config.name, agent.worker_name, rawId);
  if (!rawId || !name || isModelLikeEntry(name, agent)) return null;
  const mode = firstString(agent.mode, agent.type, config.mode).toLowerCase();
  const available = agent.available !== false && agent.status !== "offline" && agent.status !== "disabled";
  return {
    id: `platform:${rawId}`,
    name,
    description: firstString(agent.description, config.description, "Platform agent."),
    owner: firstString(agent.owner, agent.author, "OpenDrSai"),
    source: "remote",
    status: available ? "running" : "unreachable",
    model: firstString(agent.model, config.model) || undefined,
    logo: firstString(agent.logo, agent.avatar) || undefined,
    examples: normalizeExamples(agent.examples ?? config.examples),
    error: available ? undefined : "This platform agent is currently unavailable.",
    ...(mode ? { mode } : {}),
  };
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
  return Object.entries(record)
    .filter(([, enabled]) => enabled === true || (typeof enabled === "number" && enabled > 0))
    .map(([name]) => name);
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
