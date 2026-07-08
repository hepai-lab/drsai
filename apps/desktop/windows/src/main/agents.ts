import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { DesktopAgent } from "../shared/desktopApi";
import { getGatewayStatus } from "./gateway";
import { DRSAI_ENV_FILE, DRSAI_HOME } from "./paths";

const LOCAL_AGENT_ID = "my-drsai";
const HEPAI_API_BASE_URL =
  process.env.HEPAI_API_BASE_URL?.trim().replace(/\/+$/, "") ||
  "https://aiapi.ihep.ac.cn/apiv2";
const REQUEST_TIMEOUT_MS = 6000;

interface RemoteAgentConfig {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  owner?: unknown;
  url?: unknown;
  api_key?: unknown;
  apiKey?: unknown;
  examples?: unknown;
}

interface AgentListResponse {
  data?: unknown;
}

export async function listAgents(): Promise<DesktopAgent[]> {
  const [localAgents, platformAgents, remoteAgents] = await Promise.all([
    listLocalAgents(),
    listPlatformAgents(),
    listRemoteAgents(),
  ]);
  return [...localAgents, ...platformAgents, ...remoteAgents];
}

async function listLocalAgents(): Promise<DesktopAgent[]> {
  const gateway = await getGatewayStatus();
  const base: DesktopAgent = {
    id: LOCAL_AGENT_ID,
    name: "My DrSai",
    description: "运行在本机的智能体。",
    owner: "运行在本机的智能体。",
    source: "local",
    status: gateway.ready ? "running" : "stopped",
    url: gateway.baseUrl,
    error: gateway.ready
      ? undefined
      : gateway.externalConflict
        ? "本机端口已被其他服务占用。"
        : "本机 DrSai gateway 未启动。",
  };
  return [base];
}

async function listPlatformAgents(): Promise<DesktopAgent[]> {
  const apiKey = readHepAiApiKey();
  if (!apiKey) return [];

  const response = await requestJson(joinUrl(HEPAI_API_BASE_URL, "/agents/list_agents"), {
    Authorization: `Bearer ${apiKey}`,
  });
  if (!response.ok) return [];

  const body = response.body as AgentListResponse;
  const rawAgents = extractAgentArray(body);
  return rawAgents
    .map((agent, index) => normalizePlatformAgent(agent, index))
    .filter((agent): agent is DesktopAgent => Boolean(agent));
}

async function listRemoteAgents(): Promise<DesktopAgent[]> {
  const configs = readRemoteAgentConfigs();
  return Promise.all(configs.map(checkRemoteAgent));
}

function readRemoteAgentConfigs(): RemoteAgentConfig[] {
  const filePath =
    process.env.OPENDRSAI_REMOTE_AGENTS_FILE ||
    process.env.DRSAI_REMOTE_AGENTS_FILE ||
    join(DRSAI_HOME, "remote_agents.json");
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function checkRemoteAgent(config: RemoteAgentConfig): Promise<DesktopAgent> {
  const url = typeof config.url === "string" ? config.url.trim() : "";
  const name = stringOr(config.name, "Remote Agent");
  const id = stringOr(config.id, `remote:${url || name}`);
  const description = stringOr(config.description, "远程连接的智能体。");
  const owner = stringOr(config.owner, "远程智能体");
  if (!url) {
    return {
      id,
      name,
      description,
      owner,
      source: "remote",
      status: "unreachable",
      error: "远程智能体缺少 URL。",
    };
  }

  const headers = createRemoteHeaders(config);
  const status = await checkRemoteBaseUrl(url, headers);
  return {
    id,
    name,
    description,
    owner,
    source: "remote",
    status: status.ok ? "running" : "unreachable",
    url,
    examples: normalizeExamples(config.examples),
    error: status.ok ? undefined : status.error,
  };
}

async function checkRemoteBaseUrl(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  const health = await requestJson(joinUrl(baseUrl, "/health"), headers);
  if (health.ok) return { ok: true };
  const agents = await requestJson(joinUrl(baseUrl, "/agents/list_agents"), headers);
  if (agents.ok) return { ok: true };
  return { ok: false, error: health.error || agents.error };
}

async function requestJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; body?: unknown; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const text = await response.text();
    return { ok: true, body: text ? JSON.parse(text) : {} };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function createRemoteHeaders(config: RemoteAgentConfig): Record<string, string> {
  const apiKey = stringOr(config.api_key, stringOr(config.apiKey, ""));
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function readHepAiApiKey(): string {
  const envKey = process.env.HEPAI_API_KEY?.trim();
  if (envKey) return envKey;
  if (!existsSync(DRSAI_ENV_FILE)) return "";
  try {
    const content = readFileSync(DRSAI_ENV_FILE, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*HEPAI_API_KEY\s*=\s*(.+?)\s*$/);
      if (match?.[1]?.trim()) return unquoteEnvValue(match[1].trim());
    }
  } catch {
    return "";
  }
  return "";
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function extractAgentArray(body: AgentListResponse): unknown[] {
  const data = body?.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.data)) return record.data;
    if (Array.isArray(record.agents)) return record.agents;
  }
  return [];
}

function normalizePlatformAgent(value: unknown, index: number): DesktopAgent | null {
  if (!value || typeof value !== "object") return null;
  const agent = value as Record<string, unknown>;
  const config = readRecord(agent.config);
  const id = stringOr(
    agent.id,
    stringOr(agent.agent_id, stringOr(config.id, `hepai-agent-${index}`)),
  );
  const name = stringOr(
    agent.name,
    stringOr(config.name, stringOr(agent.worker_name, id)),
  );
  if (!name || isModelLikePlatformEntry(name, agent)) return null;
  const url = stringOr(agent.url, stringOr(config.url, stringOr(config.base_url, HEPAI_API_BASE_URL)));
  return {
    id: `hepai:${id}`,
    name,
    description: stringOr(agent.description, "来自 HepAI 平台的在线智能体。"),
    owner: stringOr(agent.owner, stringOr(agent.author, "HepAI")),
    source: "remote",
    status: "running",
    url,
    model: stringOr(agent.model, stringOr(config.model, "")) || undefined,
    examples: normalizeExamples(agent.examples),
    logo: stringOr(agent.logo, ""),
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function isModelLikePlatformEntry(name: string, agent: Record<string, unknown>): boolean {
  if (agent.object === "model") return true;
  if (agent.object === "agent") return false;
  if (agent.mode === "ddf" || agent.mode === "remote" || agent.mode === "custom") return false;
  return name.includes("/") && !agent.description && !agent.author && !agent.owner;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeExamples(value: unknown): DesktopAgent["examples"] | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!Array.isArray(value)) return undefined;
  const examples = value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const en = stringOr(record.en, "");
        const zh = stringOr(record.zh, "");
        if (en || zh) return { en, zh };
      }
      return "";
    })
    .filter((item) => (typeof item === "string" ? item.length > 0 : item.en || item.zh));
  return examples.length > 0 ? examples : undefined;
}
