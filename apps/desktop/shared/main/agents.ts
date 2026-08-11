import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import {
  LOCAL_OPENDRSAI_AGENT_NAME,
  type ConfiguredAgentDescriptor,
  type DesktopAgent,
  type DesktopAgentCatalogSnapshot,
  type DesktopAgentListOptions,
  type DesktopAgentPreferenceResult,
  type PlatformAgentStatus,
} from "../api/desktopApi";
import { getMyDrSaiAgentModelPolicy, listConfiguredAgents } from "./myDrSaiConfig";
import {
  invalidateAuthSession,
  getAuthSession,
  refreshAuthContextAfterUnauthorized,
  requireAuthContext,
} from "./auth";
import { getGatewaySnapshot } from "./gateway";
import { DRSAI_CONFIG_FILE, DRSAI_HOME } from "./paths";
import { getActivePlatformConfig } from "./platformConfig";
import {
  fetchPlatformAgents,
  respondPlatformAgentInput,
  respondDdfAgentInput,
  stopPlatformAgentThread,
  type PlatformAgentClientOptions,
} from "./platformAgentClient";
import {
  createPublicAgentCachePayload,
  createPlatformCatalogSubjectKey,
  getOrCreateCatalogFlight,
  markCachedPlatformAgents,
  mergeAndSortAgents,
  parsePublicAgentCachePayload,
  type PlatformAgentExecutionDescriptor,
} from "./agentCatalog";
import { recordAgentTelemetry } from "./agentTelemetry";
import { LocalRuntimeClient } from "./runtimeClient";

const ACTIVE_PLATFORM = getActivePlatformConfig();
const PLATFORM_BASE_URL = ACTIVE_PLATFORM.portalUrl;
const PLATFORM_AGENTS_ENABLED = !["0", "false", "off", "no"].includes((process.env.OPENDRSAI_PLATFORM_AGENTS_ENABLED || "true").toLowerCase());
const PLATFORM_CHAT_ENABLED = !["0", "false", "off", "no"].includes((process.env.OPENDRSAI_PLATFORM_AGENT_CHAT_ENABLED || "true").toLowerCase());
const PLATFORM_CACHE_ID = createHash("sha256").update(PLATFORM_BASE_URL).digest("hex").slice(0, 12);
const PLATFORM_CACHE_TTL_MS = positiveIntegerEnv("OPENDRSAI_AGENT_CACHE_TTL_MS", 2 * 60 * 60 * 1000);
const PLATFORM_MEMORY_TTL_MS = positiveIntegerEnv("OPENDRSAI_AGENT_MEMORY_TTL_MS", 5 * 60 * 1000);

let platformExecutionDescriptors = new Map<string, PlatformAgentExecutionDescriptor>();
let activePlatformSubjectKey: string | null = null;
const platformCatalogMemory = new Map<string, {
  at: number;
  agents: DesktopAgent[];
  executionDescriptors: PlatformAgentExecutionDescriptor[];
  status: PlatformAgentStatus;
}>();
const platformCatalogFlights = new Map<string, Promise<{
  agents: DesktopAgent[];
  executionDescriptors: PlatformAgentExecutionDescriptor[];
  status: PlatformAgentStatus;
}>>();
let localAgentFlight: Promise<DesktopAgent[]> | undefined;

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
      message: "Platform agents are disabled by the desktop rollout flag.",
      lastCheckedAt: new Date().toISOString(),
    };
  }
  const [localAgents, platformAgents] = await Promise.all([
    listLocalAgents(options),
    PLATFORM_AGENTS_ENABLED ? listPlatformAgents(options) : Promise.resolve([]),
  ]);
  // The Agent Square has exactly two authorities: this device owns OpenDrSai,
  // and HAI owns every other catalog entry. Do not merge legacy device-side
  // remote-agent records here; those records have no platform identity
  // or authorization context and previously made HAI agents look local.
  const agents = mergeAndSortAgents(localAgents, platformAgents);
  recordAgentTelemetry({ event: "catalog_refresh", source: "platform", status: platformStatus.state, count: agents.length });
  return agents;
}

export async function getAgentCatalogSnapshot(
  options: DesktopAgentListOptions = {},
): Promise<DesktopAgentCatalogSnapshot> {
  const agents = await listAgents(options);
  return {
    agents,
    platformStatus: getPlatformAgentStatus(),
    loadedAt: new Date().toISOString(),
  };
}

export function getPlatformAgentStatus(): PlatformAgentStatus {
  return { ...platformStatus, capabilities: [...platformStatus.capabilities] };
}

export function getPlatformAgentExecutionDescriptor(
  agentId: string,
): PlatformAgentExecutionDescriptor | null {
  const descriptor = platformExecutionDescriptors.get(agentId);
  return descriptor ? { ...descriptor, capabilities: [...descriptor.capabilities] } : null;
}

export function getPlatformAgentChatUrl(_platformId: string): string {
  // Agents discovered through HepAI's base_url are DDF runtime/model IDs.
  // Execute them through the matching OpenAI-compatible endpoint; the portal
  // Native API may expose a different catalog and cannot resolve these IDs.
  return `${ACTIVE_PLATFORM.baseUrl}/chat/completions`;
}

export function isPlatformAgentExecutionAvailable(agentId: string): boolean {
  const descriptor = platformExecutionDescriptors.get(agentId);
  if (!PLATFORM_AGENTS_ENABLED || !PLATFORM_CHAT_ENABLED || !descriptor?.available) return false;
  const capabilities = new Set(descriptor.capabilities.map((item) => item.toLowerCase()));
  return capabilities.has("chat") && capabilities.has("streaming");
}

export async function setDefaultAgent(agentId: string): Promise<DesktopAgentPreferenceResult> {
  if ((await listLocalAgents()).some((agent) => agent.id === agentId && agent.source === "local")) {
    recordAgentTelemetry({ event: "agent_selected", agentId, source: "local", status: "default" });
    return { agentId, saved: true, message: "Local agent selected as the desktop default." };
  }
  const descriptor = getPlatformAgentExecutionDescriptor(agentId);
  if (!descriptor) return { agentId, saved: false, message: "Agent not found in the platform catalog." };
  return { agentId, saved: false, message: "Platform default-agent preferences are not supported by the HAI catalog contract." };
}

export async function recordAgentUsage(agentId: string): Promise<DesktopAgentPreferenceResult> {
  if ((await listLocalAgents()).some((agent) => agent.id === agentId && agent.source === "local")) {
    return { agentId, saved: true, message: "Local agent usage recorded on this device." };
  }
  const descriptor = getPlatformAgentExecutionDescriptor(agentId);
  if (!descriptor) return { agentId, saved: false, message: "Agent not found in the platform catalog." };
  return { agentId, saved: false, message: "Platform usage mutation is not supported; Desktop records privacy-safe execution telemetry locally." };
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

export async function respondToDdfChatInput(
  agentId: string,
  chatId: string,
  runId: string,
  requestId: string,
  response: string | Record<string, unknown>,
): Promise<boolean> {
  const descriptor = getPlatformAgentExecutionDescriptor(agentId);
  if (!descriptor) return false;
  return (await respondDdfAgentInput(platformClientOptions(), {
    model: descriptor.model || descriptor.platformId,
    chatId,
    runId,
    requestId,
    response,
  })).ok;
}

async function listLocalAgents(options: DesktopAgentListOptions = {}): Promise<DesktopAgent[]> {
  if (localAgentFlight) return structuredClone(await localAgentFlight);
  localAgentFlight = loadLocalAgents(options);
  try {
    return await localAgentFlight;
  } finally {
    localAgentFlight = undefined;
  }
}

async function loadLocalAgents(options: DesktopAgentListOptions = {}): Promise<DesktopAgent[]> {
  // Catalog discovery is read-only. It must never start Python, Gateway, or
  // Codex merely because the user opened the Agent Square.
  const gateway = getGatewaySnapshot();
  const localSnapshot = readLocalAgentSnapshot();
  const configured = gateway.ready
    ? await listConfiguredAgents().catch(() => localSnapshot)
    : localSnapshot;
  const descriptors = configured.agents.length > 0
    ? configured.agents
    : [recoveryLocalAgentDescriptor()];
  const agents: DesktopAgent[] = descriptors.map((descriptor) => ({
    id: descriptor.agent_name,
    name: LOCAL_OPENDRSAI_AGENT_NAME,
    description: "An agent running on this computer.", owner: "Local", source: "local",
    status: gateway.ready ? "running" : "stopped", mode: "local", available: descriptor.enabled,
    capabilities: ["chat", "workspace", "tools"], catalogGroup: "local", url: gateway.baseUrl,
    error: gateway.externalConflict ? "The local Runtime port is already used by another service." : undefined,
  }));
  if (!gateway.ready) return agents;
  try {
    await Promise.all(agents.map(async (agent, index) => {
      const policy = await getMyDrSaiAgentModelPolicy(agent.id);
      agents[index] = { ...agent, model: policy.effective_ref?.model_id,
        error: policy.valid ? agent.error : policy.error || "The configured Agent model is unavailable." };
    }));
  } catch {
    // Keep local Agent discovery available while policy diagnostics recover.
  }
  try {
    const client = await LocalRuntimeClient.connect();
    const [modelCatalog, account] = await Promise.all([
      client.getBackendModels("codex", options.refresh === true),
      client.getBackendAccount("codex", options.refresh === true),
    ]);
    const capability = (await client.getCapabilities()).agent_backends?.codex;
    const visibleModels = modelCatalog.models?.filter((model) => !model.hidden) ?? [];
    const defaultModel = modelCatalog.default_model
      ?? visibleModels.find((model) => model.default)?.id;
    const executable = capability?.available === true && capability.contract_compatible !== false
      && account.state === "signed_in" && modelCatalog.stale !== true && visibleModels.length > 0;
    agents.push({
      id: "my-codex", name: "Codex", description: "Codex Agent Backend running in this Workspace Runtime.",
      owner: "Local", source: "local", status: executable ? "running" : "stopped", mode: "local",
      available: executable, capabilities: ["chat", "workspace", "tools"], catalogGroup: "local",
      model: defaultModel, models: visibleModels.map((model) => model.id),
      error: capability?.available
        ? account.state === "signed_out" ? "Codex needs you to sign in before sending a message."
          : account.state !== "signed_in" ? "Codex account status is temporarily unavailable."
          : visibleModels.length ? undefined : "Codex model information is unavailable. Start or reconnect Codex and refresh."
        : capability?.reason ?? "Codex is unavailable.",
    });
  } catch {
    // Codex is a backend choice, not a required Agent Square entry. If an
    // already-running Runtime cannot describe it, omit it instead of turning
    // catalog browsing into a Runtime recovery workflow.
  }
  return agents;
}

/**
 * Reconstruct the local Agent catalog without starting the Runtime. Installed
 * configuration is the identity authority; Runtime health only enriches the
 * card with live status and model details.
 */
function readLocalAgentSnapshot(): { current_agent: string; agents: ConfiguredAgentDescriptor[] } {
  try {
    const config = readFileSync(DRSAI_CONFIG_FILE, "utf8");
    const currentAgent = readTomlAgentId(config, "current_agent");
    if (!currentAgent) return { current_agent: "", agents: [] };
    const expectedRelativePath = `configs/agents/agent_${currentAgent}.toml`;
    const configuredPath = readTomlString(config, "agent_config_file")?.replace(/\\/g, "/");
    if (configuredPath !== expectedRelativePath) return { current_agent: "", agents: [] };
    const agentConfigPath = join(DRSAI_HOME, ...expectedRelativePath.split("/"));
    const agentConfig = readFileSync(agentConfigPath, "utf8");
    const configuredAgentName = readTomlAgentId(agentConfig, "agent_name");
    if (configuredAgentName !== currentAgent) return { current_agent: "", agents: [] };
    return {
      current_agent: currentAgent,
      agents: [{
        agent_name: currentAgent,
        display_name: readTomlString(agentConfig, "display_name") || LOCAL_OPENDRSAI_AGENT_NAME,
        enabled: readTomlBoolean(agentConfig, "enabled") !== false,
        config_file: expectedRelativePath,
        current: true,
      }],
    };
  } catch {
    return { current_agent: "", agents: [] };
  }
}

function recoveryLocalAgentDescriptor(): ConfiguredAgentDescriptor {
  return {
    agent_name: "opendrsai",
    display_name: LOCAL_OPENDRSAI_AGENT_NAME,
    enabled: true,
    config_file: "configs/agents/agent_opendrsai.toml",
    current: true,
  };
}

function readTomlAgentId(source: string, key: string): string | null {
  const value = readTomlString(source, key);
  return value && /^[a-z][a-z0-9_-]{0,63}$/.test(value) ? value : null;
}

function readTomlString(source: string, key: string): string | null {
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"\\r\\n]*)"\\s*(?:#.*)?$`, "m"));
  return match?.[1]?.trim() || null;
}

function readTomlBoolean(source: string, key: string): boolean | null {
  const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\s*(?:#.*)?$`, "mi"));
  return match ? match[1].toLowerCase() === "true" : null;
}

async function listPlatformAgents(options: DesktopAgentListOptions): Promise<DesktopAgent[]> {
  const subjectKey = await platformSubjectKey();
  if (!subjectKey) {
    activePlatformSubjectKey = null;
    platformExecutionDescriptors.clear();
    platformStatus = {
      state: "requires_login",
      apiVersion: null,
      capabilities: [],
      message: "Sign in with HepAI to load platform agents.",
      lastCheckedAt: new Date().toISOString(),
      lastSuccessfulSyncAt: null,
      cacheState: "none",
    };
    return [];
  }
  activePlatformSubjectKey = subjectKey;
  const memory = platformCatalogMemory.get(subjectKey);
  if (!options.refresh && memory && Date.now() - memory.at <= PLATFORM_MEMORY_TTL_MS) {
    activatePlatformCatalog(subjectKey, memory);
    return structuredClone(memory.agents);
  }
  if (options.preferCache && !options.refresh) {
    const cached = readPlatformCache(subjectKey);
    if (cached) {
      const catalog = cachedPlatformCatalog(cached);
      activatePlatformCatalog(subjectKey, catalog);
      return structuredClone(catalog.agents);
    }
    platformExecutionDescriptors.clear();
    platformStatus = {
      state: "loading",
      apiVersion: null,
      capabilities: [],
      message: "Loading platform agents from HepAI.",
      lastCheckedAt: null,
      lastSuccessfulSyncAt: null,
      cacheState: "none",
    };
    return [];
  }

  const flight = getOrCreateCatalogFlight(
    platformCatalogFlights,
    subjectKey,
    () => loadLivePlatformCatalog(subjectKey, options.refresh === true),
  );
  const catalog = await flight;
  activatePlatformCatalog(subjectKey, catalog);
  return structuredClone(catalog.agents);
}

async function loadLivePlatformCatalog(subjectKey: string, refresh: boolean): Promise<{
  at: number;
  agents: DesktopAgent[];
  executionDescriptors: PlatformAgentExecutionDescriptor[];
  status: PlatformAgentStatus;
}> {
  try {
    const result = await fetchPlatformAgents(platformClientOptions(refresh));
    if (result.status.state === "ready") {
      const syncedAt = result.status.lastCheckedAt ?? new Date().toISOString();
      const catalog = {
        at: Date.now(),
        agents: result.agents.map((agent) => ({ ...agent, catalogState: "live" as const })),
        executionDescriptors: result.executionDescriptors,
        status: {
          ...result.status,
          lastSuccessfulSyncAt: syncedAt,
          cacheState: "fresh" as const,
        },
      };
      platformCatalogMemory.set(subjectKey, catalog);
      writePlatformCache(subjectKey, catalog.agents, syncedAt);
      return catalog;
    }
    const cached = readPlatformCache(subjectKey);
    if (cached) {
      return cachedPlatformCatalog(cached, result.status);
    }
    return {
      at: 0,
      agents: [],
      executionDescriptors: [],
      status: { ...result.status, lastSuccessfulSyncAt: null, cacheState: "none" },
    };
  } catch (error) {
    const cached = readPlatformCache(subjectKey);
    const failureStatus: PlatformAgentStatus = {
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
      return cachedPlatformCatalog(cached, failureStatus);
    }
    failureStatus.message += " Local agents remain available.";
    return { at: 0, agents: [], executionDescriptors: [], status: failureStatus };
  }
}

function activatePlatformCatalog(
  subjectKey: string,
  catalog: { agents: DesktopAgent[]; executionDescriptors: PlatformAgentExecutionDescriptor[]; status: PlatformAgentStatus },
): void {
  if (activePlatformSubjectKey !== subjectKey) return;
  platformExecutionDescriptors = new Map(
    catalog.executionDescriptors.map((descriptor) => [descriptor.publicId, descriptor]),
  );
  platformStatus = { ...catalog.status, capabilities: [...catalog.status.capabilities] };
}

function cachedPlatformCatalog(
  cached: { agents: DesktopAgent[]; savedAt: string; fresh: boolean },
  failureStatus?: PlatformAgentStatus,
): {
  at: number;
  agents: DesktopAgent[];
  executionDescriptors: PlatformAgentExecutionDescriptor[];
  status: PlatformAgentStatus;
} {
  const agents = markCachedPlatformAgents(cached.agents);
  return {
    at: 0,
    agents,
    executionDescriptors: agents.map(cacheExecutionDescriptor),
    status: {
      ...(failureStatus ?? {
        state: "loading" as const,
        apiVersion: null,
        capabilities: [],
        message: "Showing the last cached platform catalog while HepAI refreshes.",
        lastCheckedAt: null,
      }),
      message: failureStatus
        ? `${failureStatus.message} Showing the last cached platform catalog.`
        : "Showing the last cached platform catalog while HepAI refreshes.",
      lastSuccessfulSyncAt: cached.savedAt,
      cacheState: cached.fresh ? "fresh" : "stale",
    },
  };
}

async function platformSubjectKey(): Promise<string | null> {
  const session = await getAuthSession();
  if (!session.authenticated || session.authMode !== "oidc" || !session.user?.id) return null;
  return createPlatformCatalogSubjectKey(ACTIVE_PLATFORM.name, PLATFORM_CACHE_ID, session.user.id);
}

function platformClientOptions(refresh = false): PlatformAgentClientOptions {
  return {
    baseUrl: PLATFORM_BASE_URL,
    catalogBaseUrl: ACTIVE_PLATFORM.baseUrl,
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

function platformCachePath(subjectKey: string): string {
  return join(
    DRSAI_HOME,
    "cache",
    `platform-agents.${ACTIVE_PLATFORM.name}.${PLATFORM_CACHE_ID}.${subjectKey}.v2.json`,
  );
}

function writePlatformCache(subjectKey: string, agents: DesktopAgent[], savedAt: string): void {
  const directory = join(DRSAI_HOME, "cache");
  const cachePath = platformCachePath(subjectKey);
  const temporaryPath = `${cachePath}.tmp`;
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      temporaryPath,
      `${JSON.stringify(createPublicAgentCachePayload(agents, savedAt), null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    renameSync(temporaryPath, cachePath);
  } catch {
    // Catalog caching is best-effort; a read-only profile must not hide live agents.
  }
}

function readPlatformCache(subjectKey: string): { agents: DesktopAgent[]; savedAt: string; fresh: boolean } | null {
  const cachePath = platformCachePath(subjectKey);
  if (!existsSync(cachePath)) return null;
  try {
    const payload = parsePublicAgentCachePayload(
      JSON.parse(readFileSync(cachePath, "utf8")),
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
    available: false,
    capabilities: agent.capabilities ? [...agent.capabilities] : [],
  };
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
