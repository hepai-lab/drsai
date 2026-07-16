import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import type {
  DesktopAgent,
  DesktopAgentListOptions,
  DesktopAgentPreferenceResult,
  PlatformAgentStatus,
} from "../shared/desktopApi";
import {
  invalidateAuthSession,
  refreshAuthContextAfterUnauthorized,
  requireAuthContext,
} from "./auth";
import { getGatewayStatus } from "./gateway";
import { DRSAI_HOME } from "./paths";
import {
  fetchPlatformAgents,
  recordPlatformAgentUsage,
  respondPlatformAgentInput,
  setPlatformDefaultAgent,
  stopPlatformAgentThread,
  type PlatformAgentClientOptions,
} from "./platformAgentClient";
import {
  createPublicAgentCachePayload,
  mergeAndSortAgents,
  parsePublicAgentCachePayload,
  type PlatformAgentExecutionDescriptor,
} from "./agentCatalog";
import { recordAgentTelemetry } from "./agentTelemetry";
import { LocalRuntimeClient } from "./runtimeClient";

const LOCAL_AGENT_ID = "my-drsai";
const PLATFORM_BASE_URL =
  process.env.OPENDRSAI_PLATFORM_BASE_URL?.trim().replace(/\/+$/, "") ||
  (is.dev ? "https://ai-dev.ihep.ac.cn" : "https://ai.ihep.ac.cn");
const PLATFORM_AGENTS_ENABLED = !["0", "false", "off", "no"].includes((process.env.OPENDRSAI_PLATFORM_AGENTS_ENABLED || "true").toLowerCase());
const PLATFORM_CHAT_ENABLED = !["0", "false", "off", "no"].includes((process.env.OPENDRSAI_PLATFORM_AGENT_CHAT_ENABLED || "true").toLowerCase());
const PLATFORM_CACHE_PATH = join(DRSAI_HOME, "cache", "platform-agents.v1.json");
const PLATFORM_CACHE_TTL_MS = positiveIntegerEnv("OPENDRSAI_AGENT_CACHE_TTL_MS", 2 * 60 * 60 * 1000);

let platformExecutionDescriptors = new Map<string, PlatformAgentExecutionDescriptor>();

let platformStatus: PlatformAgentStatus = {
  state: "requires_login",
  apiVersion: null,
  capabilities: [],
  message: "Sign in with HepAI to load platform agents.",
  lastCheckedAt: null,
};

export async function listAgents(options: DesktopAgentListOptions = {}): Promise<DesktopAgent[]> {
  if (!PLATFORM_AGENTS_ENABLED) {
    platformStatus = {
      state: "native_api_unavailable",
      apiVersion: null,
      capabilities: [],
      message: "Platform agents are disabled by the Windows rollout flag.",
      lastCheckedAt: new Date().toISOString(),
    };
  }
  const [localAgents, platformAgents] = await Promise.all([
    listLocalAgents(),
    PLATFORM_AGENTS_ENABLED ? listPlatformAgents(options) : Promise.resolve([]),
  ]);
  // The Agent Square has exactly two authorities: this device owns My DrSai,
  // and HAI owns every other catalog entry. Do not merge legacy device-side
  // remote-agent records here; those records have no platform identity
  // or authorization context and previously made HAI agents look local.
  const agents = mergeAndSortAgents(localAgents, platformAgents);
  recordAgentTelemetry({ event: "catalog_refresh", source: "platform", status: platformStatus.state, count: agents.length });
  return agents;
}

export function getPlatformAgentStatus(): PlatformAgentStatus {
  return { ...platformStatus, capabilities: [...platformStatus.capabilities] };
}

export function getPlatformAgentExecutionDescriptor(
  agentId: string,
): PlatformAgentExecutionDescriptor | null {
  const descriptor = platformExecutionDescriptors.get(agentId);
  return descriptor ? { ...descriptor } : null;
}

export function getPlatformAgentChatUrl(platformId: string): string {
  return `${PLATFORM_BASE_URL}/api/native/v1/agents/${encodeURIComponent(platformId)}/chat`;
}

export function isPlatformAgentExecutionAvailable(): boolean {
  return PLATFORM_AGENTS_ENABLED && PLATFORM_CHAT_ENABLED && platformStatus.state === "ready" && platformStatus.capabilities.includes("agent-chat");
}

export async function setDefaultAgent(agentId: string): Promise<DesktopAgentPreferenceResult> {
  if (agentId === LOCAL_AGENT_ID) {
    recordAgentTelemetry({ event: "agent_selected", agentId, source: "local", status: "default" });
    return { agentId, saved: true, message: "Local agent selected as the Windows default." };
  }
  const descriptor = getPlatformAgentExecutionDescriptor(agentId);
  if (!descriptor) return { agentId, saved: false, message: "Agent not found in the platform catalog." };
  const result = await setPlatformDefaultAgent(platformClientOptions(), descriptor.platformId);
  if (result.ok) recordAgentTelemetry({ event: "agent_selected", agentId, mode: descriptor.mode, source: "platform", status: "default" });
  return { agentId, saved: result.ok, message: result.message };
}

export async function recordAgentUsage(agentId: string): Promise<DesktopAgentPreferenceResult> {
  if (agentId === LOCAL_AGENT_ID) {
    return { agentId, saved: true, message: "Local agent usage recorded on this device." };
  }
  const descriptor = getPlatformAgentExecutionDescriptor(agentId);
  if (!descriptor) return { agentId, saved: false, message: "Agent not found in the platform catalog." };
  const result = await recordPlatformAgentUsage(platformClientOptions(), descriptor.platformId);
  return { agentId, saved: result.ok, message: result.message };
}

export async function stopPlatformChat(agentId: string, threadId: string): Promise<boolean> {
  const descriptor = getPlatformAgentExecutionDescriptor(agentId);
  if (!descriptor) return false;
  return (await stopPlatformAgentThread(platformClientOptions(), descriptor.platformId, threadId)).ok;
}

export async function respondToPlatformChatInput(
  agentId: string,
  threadId: string,
  response: string | Record<string, unknown>,
): Promise<boolean> {
  const descriptor = getPlatformAgentExecutionDescriptor(agentId);
  if (!descriptor) return false;
  return (await respondPlatformAgentInput(platformClientOptions(), descriptor.platformId, threadId, response)).ok;
}

async function listLocalAgents(): Promise<DesktopAgent[]> {
  const gateway = await getGatewayStatus();
  const agents: DesktopAgent[] = [{
    id: LOCAL_AGENT_ID,
    name: "My DrSai",
    description: "An agent running on this computer.",
    owner: "Local",
    source: "local",
    status: gateway.ready ? "running" : "stopped",
    mode: "local",
    available: gateway.ready,
    capabilities: ["chat", "workspace", "tools"],
    catalogGroup: "local",
    url: gateway.baseUrl,
    error: gateway.ready
      ? undefined
      : gateway.externalConflict
        ? "The local port is already used by another service."
        : "The local DrSai gateway is not running.",
  }];
  try {
    const capability = (await (await LocalRuntimeClient.connect()).getCapabilities()).agent_backends?.codex;
    agents.push({
      id: "my-codex", name: "Codex", description: "Codex Agent Backend running in this Workspace Runtime.",
      owner: "Local", source: "local", status: capability?.available ? "running" : "stopped", mode: "local",
      available: capability?.available === true, capabilities: ["chat", "workspace", "tools"], catalogGroup: "local",
      model: "gpt-5.4", error: capability?.available ? undefined : capability?.reason ?? "Codex is unavailable.",
    });
  } catch {
    agents.push({ id: "my-codex", name: "Codex", description: "Codex Agent Backend is unavailable.", owner: "Local",
      source: "local", status: "unreachable", mode: "local", available: false, capabilities: ["chat", "workspace", "tools"], catalogGroup: "local", error: "Runtime capability could not be read." });
  }
  return agents;
}

async function listPlatformAgents(options: DesktopAgentListOptions): Promise<DesktopAgent[]> {
  try {
    const result = await fetchPlatformAgents(platformClientOptions(options.refresh === true));
    if (result.status.state === "ready") {
      platformExecutionDescriptors = new Map(
        result.executionDescriptors.map((descriptor) => [descriptor.publicId, descriptor]),
      );
      const syncedAt = result.status.lastCheckedAt ?? new Date().toISOString();
      writePlatformCache(result.agents, syncedAt);
      platformStatus = {
        ...result.status,
        lastSuccessfulSyncAt: syncedAt,
        cacheState: "fresh",
      };
      return result.agents;
    }
    const cached = readPlatformCache();
    if (cached) {
      platformExecutionDescriptors = new Map(
        cached.agents.map((agent) => [agent.id, cacheExecutionDescriptor(agent)]),
      );
      platformStatus = {
        ...result.status,
        message: `${result.status.message} Showing the last cached platform catalog.`,
        lastSuccessfulSyncAt: cached.savedAt,
        cacheState: cached.fresh ? "fresh" : "stale",
      };
      return cached.agents;
    }
    platformExecutionDescriptors.clear();
    platformStatus = { ...result.status, lastSuccessfulSyncAt: null, cacheState: "none" };
    return [];
  } catch (error) {
    const cached = readPlatformCache();
    platformExecutionDescriptors = new Map(
      (cached?.agents ?? []).map((agent) => [agent.id, cacheExecutionDescriptor(agent)]),
    );
    platformStatus = {
      state: "error",
      apiVersion: null,
      capabilities: [],
      message: error instanceof Error && error.name === "AbortError"
        ? "Platform capability detection timed out."
        : "Platform capability detection failed.",
      lastCheckedAt: new Date().toISOString(),
      lastSuccessfulSyncAt: cached?.savedAt ?? null,
      cacheState: cached ? (cached.fresh ? "fresh" : "stale") : "none",
    };
    if (cached) {
      platformStatus.message += " Showing the last cached platform catalog.";
      return cached.agents;
    }
    platformStatus.message += " Local agents remain available.";
    return [];
  }
}

function platformClientOptions(refresh = false): PlatformAgentClientOptions {
  return {
    baseUrl: PLATFORM_BASE_URL,
    refresh,
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
  };
}

function writePlatformCache(agents: DesktopAgent[], savedAt: string): void {
  const directory = join(DRSAI_HOME, "cache");
  const temporaryPath = `${PLATFORM_CACHE_PATH}.tmp`;
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      temporaryPath,
      `${JSON.stringify(createPublicAgentCachePayload(agents, savedAt), null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    renameSync(temporaryPath, PLATFORM_CACHE_PATH);
  } catch {
    // Catalog caching is best-effort; a read-only profile must not hide live agents.
  }
}

function readPlatformCache(): { agents: DesktopAgent[]; savedAt: string; fresh: boolean } | null {
  if (!existsSync(PLATFORM_CACHE_PATH)) return null;
  try {
    const payload = parsePublicAgentCachePayload(
      JSON.parse(readFileSync(PLATFORM_CACHE_PATH, "utf8")),
    );
    if (!payload) return null;
    const age = Date.now() - Date.parse(payload.savedAt);
    return {
      agents: payload.agents,
      savedAt: payload.savedAt,
      fresh: Number.isFinite(age) && age >= 0 && age <= PLATFORM_CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

function cacheExecutionDescriptor(agent: DesktopAgent): PlatformAgentExecutionDescriptor {
  return {
    publicId: agent.id,
    platformId: agent.id.replace(/^platform:/, ""),
    mode: agent.mode || "remote",
    name: agent.name,
    model: agent.model,
    available: agent.available !== false,
  };
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
