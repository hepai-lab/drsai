import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { DesktopAgent, PlatformAgentStatus } from "../shared/desktopApi";
import {
  invalidateAuthSession,
  refreshAuthContextAfterUnauthorized,
  requireAuthContext,
} from "./auth";
import { getGatewayStatus } from "./gateway";
import { DRSAI_HOME } from "./paths";
import { fetchPlatformAgents } from "./platformAgentClient";

const LOCAL_AGENT_ID = "my-drsai";
const PLATFORM_BASE_URL =
  process.env.OPENDRSAI_PLATFORM_BASE_URL?.trim().replace(/\/+$/, "") ||
  "https://ai-dev.ihep.ac.cn";
const REQUEST_TIMEOUT_MS = 6000;

let platformStatus: PlatformAgentStatus = {
  state: "requires_login",
  apiVersion: null,
  capabilities: [],
  message: "Sign in with HepAI to load platform agents.",
  lastCheckedAt: null,
};

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

export async function listAgents(): Promise<DesktopAgent[]> {
  const [localAgents, platformAgents, remoteAgents] = await Promise.all([
    listLocalAgents(),
    listPlatformAgents(),
    listRemoteAgents(),
  ]);
  return [...localAgents, ...platformAgents, ...remoteAgents];
}

export function getPlatformAgentStatus(): PlatformAgentStatus {
  return { ...platformStatus, capabilities: [...platformStatus.capabilities] };
}

async function listLocalAgents(): Promise<DesktopAgent[]> {
  const gateway = await getGatewayStatus();
  return [{
    id: LOCAL_AGENT_ID,
    name: "My DrSai",
    description: "An agent running on this computer.",
    owner: "Local",
    source: "local",
    status: gateway.ready ? "running" : "stopped",
    url: gateway.baseUrl,
    error: gateway.ready
      ? undefined
      : gateway.externalConflict
        ? "The local port is already used by another service."
        : "The local DrSai gateway is not running.",
  }];
}

async function listPlatformAgents(): Promise<DesktopAgent[]> {
  try {
    const result = await fetchPlatformAgents({
      baseUrl: PLATFORM_BASE_URL,
      auth: {
        getAccessToken: async () => {
          const auth = await requireAuthContext();
          if (auth.authMode !== "oidc" || !auth.accessToken) {
            throw new Error("HepAI OIDC sign-in is required.");
          }
          return auth.accessToken;
        },
        refreshAfterUnauthorized: async () => {
          const auth = await refreshAuthContextAfterUnauthorized();
          if (!auth.accessToken) throw new Error("The refreshed session has no access token.");
          return auth.accessToken;
        },
        invalidate: invalidateAuthSession,
      },
    });
    platformStatus = result.status;
    return result.agents;
  } catch (error) {
    platformStatus = {
      state: "error",
      apiVersion: null,
      capabilities: [],
      message: error instanceof Error && error.name === "AbortError"
        ? "Platform capability detection timed out. Local agents remain available."
        : "Platform capability detection failed. Local agents remain available.",
      lastCheckedAt: new Date().toISOString(),
    };
    return [];
  }
}

async function listRemoteAgents(): Promise<DesktopAgent[]> {
  return Promise.all(readRemoteAgentConfigs().map(checkRemoteAgent));
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
  const url = stringOr(config.url, "");
  const name = stringOr(config.name, "Remote Agent");
  const id = stringOr(config.id, `remote:${url || name}`);
  if (!url) {
    return {
      id,
      name,
      description: stringOr(config.description, "A remotely connected agent."),
      owner: stringOr(config.owner, "Remote"),
      source: "remote",
      status: "unreachable",
      error: "The remote agent has no URL.",
    };
  }
  const status = await checkRemoteBaseUrl(url, createRemoteHeaders(config));
  return {
    id,
    name,
    description: stringOr(config.description, "A remotely connected agent."),
    owner: stringOr(config.owner, "Remote"),
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
  return agents.ok ? { ok: true } : { ok: false, error: health.error || agents.error };
}

async function requestJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    return response.ok ? { ok: true } : { ok: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function createRemoteHeaders(config: RemoteAgentConfig): Record<string, string> {
  const apiKey = stringOr(config.api_key, stringOr(config.apiKey, ""));
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
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
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean);
  return examples.length > 0 ? examples : undefined;
}
