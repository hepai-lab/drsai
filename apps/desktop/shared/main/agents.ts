import { readFileSync } from "fs";
import { join } from "path";
import {
  LOCAL_OPENDRSAI_AGENT_NAME,
  type ConfiguredAgentDescriptor,
  type DesktopAgent,
  type DesktopAgentExample,
  type DesktopAgentCatalogSnapshot,
  type DesktopAgentListOptions,
  type DesktopAgentPreferenceResult,
  type PlatformAgentStatus,
} from "../api/desktopApi";
import { getMyDrSaiAgentModelPolicy, listConfiguredAgents } from "./myDrSaiConfig";
import { getGatewaySnapshot, getGatewayStatus } from "./gateway";
import { DRSAI_CONFIG_FILE, DRSAI_HOME } from "./paths";
import {
  mergeAndSortAgents,
  type PlatformAgentExecutionDescriptor,
} from "./agentCatalog";
import { recordAgentTelemetry } from "./agentTelemetry";
import { LocalRuntimeClient, type RuntimeRemoteWorkerCatalog } from "./runtimeClient";
import {
  getExternalAgentRuntimeDescriptor,
  listExternalAgentRuntimeAgents,
} from "./externalAgentRuntimes";
import {
  getAgentPreferences,
} from "./agentPreferences";
import {
  configureRemoteAgentCredentials,
  isDeviceRemoteAgentId,
  removeDeviceRemoteAgent,
  saveDeviceRemoteAgent,
  testDeviceRemoteAgent,
  type RemoteAgentSaveRequest,
  type RemoteAgentTestRequest,
} from "./remoteAgents";
export { configureRemoteAgentCredentials, isDeviceRemoteAgentId };

const PLATFORM_AGENTS_ENABLED = !["0", "false", "off", "no"].includes((process.env.OPENDRSAI_PLATFORM_AGENTS_ENABLED || "true").toLowerCase());
const PLATFORM_CHAT_ENABLED = !["0", "false", "off", "no"].includes((process.env.OPENDRSAI_PLATFORM_AGENT_CHAT_ENABLED || "true").toLowerCase());

let platformExecutionDescriptors = new Map<string, PlatformAgentExecutionDescriptor>();
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

export { getExternalAgentRuntimeDescriptor };

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
  const client = await LocalRuntimeClient.connect();
  try {
    const selection = await client.selectRemoteWorker(descriptor.platformId, {
      model: descriptor.model || descriptor.platformId,
    });
    if (!selection.agent_definition) {
      return { agentId, saved: false, message: "The Runtime did not return a worker-scoped Agent Definition." };
    }
    recordAgentTelemetry({ event: "agent_selected", agentId, source: "platform", status: selection.agent_definition });
    return { agentId, saved: true, message: "Remote worker compatibility validated by Runtime." };
  } finally {
    client.close();
  }
}

export async function readAgentPreferences(): Promise<{
  defaultAgentId: string | null;
  recentAgentIds: string[];
}> {
  const prefs = await getAgentPreferences();
  return {
    defaultAgentId: prefs.defaultAgentId,
    recentAgentIds: prefs.recentAgentIds,
  };
}

export async function testRemoteAgentConnection(
  request: RemoteAgentTestRequest,
): Promise<{ ok: boolean; message: string; agentInfo?: Record<string, unknown> }> {
  return testDeviceRemoteAgent(request);
}

export async function saveRemoteAgentConnection(
  request: RemoteAgentSaveRequest,
): Promise<DesktopAgent> {
  return saveDeviceRemoteAgent(request);
}

export async function removeRemoteAgentConnection(agentId: string): Promise<{ removed: boolean }> {
  if (!isDeviceRemoteAgentId(agentId)) {
    return { removed: false };
  }
  const removed = await removeDeviceRemoteAgent(agentId);
  return { removed };
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
  // The cache-first pass keeps initial paint cheap. Every normal/background
  // refresh probes the current Runtime so a startup transition cannot leave
  // the local OpenDrSai entry permanently labelled "stopped".
  const gateway = options.preferCache === true
    ? getGatewaySnapshot()
    : await getGatewayStatus();
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
  agents.push(...await listExternalAgentRuntimeAgents({ preferCache: options.preferCache }).catch(() => []));
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
    // Capabilities are authoritative. Do not probe optional Codex routes when
    // this Runtime does not register the backend; probing creates a noisy 404
    // on every Agent catalog refresh.
    const capability = (await client.getCapabilities()).agent_backends?.codex;
    if (!capability?.available) return agents;
    const [modelCatalog, account] = await Promise.all([
      client.getBackendModels("codex", options.refresh === true),
      client.getBackendAccount("codex", options.refresh === true),
    ]);
    const visibleModels = modelCatalog.models?.filter((model) => !model.hidden) ?? [];
    const defaultModel = modelCatalog.default_model
      ?? visibleModels.find((model) => model.default)?.id;
    const executable = capability?.available === true && capability.contract_compatible !== false
      && account.state === "signed_in" && modelCatalog.stale !== true && visibleModels.length > 0;
    agents.push({
      id: "my-codex", name: "Codex", description: "A coding agent integrated through the OpenDrSai Codex Adapter.",
      localizedDescription: { zh: "通过 OpenDrSai Codex Adapter 接入的编程智能体。", en: "A coding agent integrated through the OpenDrSai Codex Adapter." },
      owner: "OpenAI", source: "local", status: executable ? "running" : "stopped", mode: "local",
      available: executable, capabilities: ["chat", "streaming", "workspace", "tools"], catalogGroup: "local",
      catalogVisibility: "when_available",
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
  const gatewayCatalog = await loadGatewayRemoteWorkerCatalog(options.refresh === true, options.force === true);
  if (gatewayCatalog) {
    platformExecutionDescriptors = new Map(
      gatewayCatalog.executionDescriptors.map((descriptor) => [descriptor.publicId, descriptor]),
    );
    platformStatus = gatewayCatalog.status;
    return gatewayCatalog.agents;
  }

  platformExecutionDescriptors.clear();
  platformStatus = {
    state: "native_api_unavailable",
    apiVersion: null,
    capabilities: [],
    message: "The local Runtime remote-worker catalog is unavailable.",
    lastCheckedAt: new Date().toISOString(),
    lastSuccessfulSyncAt: null,
    cacheState: "none",
  };
  return [];
}

async function loadGatewayRemoteWorkerCatalog(refresh: boolean, force = false): Promise<{
  agents: DesktopAgent[];
  executionDescriptors: PlatformAgentExecutionDescriptor[];
  status: PlatformAgentStatus;
} | null> {
  let client: LocalRuntimeClient | null = null;
  try {
    client = await LocalRuntimeClient.connectIfAvailable();
    if (!client) return null;
    const catalog = await client.listRemoteWorkers(refresh, force);
    const agents = catalog.workers.map((worker): DesktopAgent => {
      const routableName = worker.worker?.trim() || worker.name.trim();
      const localized = (worker.description_zh || worker.description_en) ? {
        ...(worker.description_zh ? { zh: worker.description_zh } : {}),
        ...(worker.description_en ? { en: worker.description_en } : {}),
      } : undefined;
      // Mirror WebUI getLocalizedDescription: pick the localized text when
      // present, otherwise fall back to the plain description.
      const description = localized
        ? (localized.zh ?? localized.en ?? "")
        : worker.description?.trim() || "A hosted HepAI worker agent.";
      const rawExamples = worker.examples ?? {};
      // Some DDF workers emit per-example bilingual dicts as raw strings,
      // e.g. "{'en': '...', 'zh': '...'}". Split those into zh/en fields.
      const extractLocalizedExampleText = (value: string | undefined): { zh?: string; en?: string } | undefined => {
        const text = (value ?? "").trim();
        if (!text.startsWith("{") || !text.endsWith("}")) return undefined;
        const zh = text.match(/['"]zh['"]\s*:\s*['"]([^'"]+)['"]/)?.[1];
        const en = text.match(/['"]en['"]\s*:\s*['"]([^'"]+)['"]/)?.[1];
        return zh || en ? { ...(zh ? { zh } : {}), ...(en ? { en } : {}) } : undefined;
      };
      const sanitizeExampleValue = (value: string | undefined): string | undefined => {
        const text = (value ?? "").trim();
        if (!text) return undefined;
        if (text.startsWith("{")) return undefined; // dict residue, handled via extractLocalizedExampleText
        return text;
      };
      const exampleList: DesktopAgentExample[] = [];
      const zhExamples = Array.isArray(rawExamples.zh) ? rawExamples.zh : [];
      const enExamples = Array.isArray(rawExamples.en) ? rawExamples.en : [];
      for (let index = 0; index < Math.max(zhExamples.length, enExamples.length); index += 1) {
        const zhValue = sanitizeExampleValue(zhExamples[index]);
        const enValue = sanitizeExampleValue(enExamples[index]);
        const extracted = extractLocalizedExampleText(zhExamples[index])
          ?? extractLocalizedExampleText(enExamples[index]);
        const zh = zhValue ?? extracted?.zh;
        const en = enValue ?? extracted?.en;
        if (zh || en) {
          exampleList.push({
            ...(zh ? { zh } : {}),
            ...(en ? { en } : {}),
          });
        }
      }
      const capabilities = Array.isArray(worker.capabilities) && worker.capabilities.length
        ? worker.capabilities
        : ["chat", "streaming"];
      return {
        id: `platform:${routableName}`,
        name: worker.name.trim() || routableName,
        description,
        localizedDescription: localized,
        owner: worker.owner?.trim() || worker.author?.trim() || "HepAI",
        author: worker.author?.trim() || undefined,
        source: "remote",
        status: "running",
        mode: "ddf",
        available: worker.available !== false,
        capabilities,
        catalogGroup: "official",
        catalogState: "live",
        model: routableName,
        logo: worker.logo?.trim() || undefined,
        examples: exampleList.length ? exampleList : undefined,
      };
    });
    const executionDescriptors = catalog.workers.map((worker): PlatformAgentExecutionDescriptor => {
      const routableName = worker.worker?.trim() || worker.name.trim();
      const capabilities = Array.isArray(worker.capabilities) && worker.capabilities.length
        ? worker.capabilities
        : ["chat", "streaming"];
      return {
        publicId: `platform:${routableName}`,
        platformId: routableName,
        mode: "ddf",
        name: worker.name.trim() || routableName,
        model: routableName,
        available: worker.available !== false,
        capabilities,
      };
    });
    return {
      agents,
      executionDescriptors,
      status: remoteWorkerCatalogStatus(catalog),
    };
  } catch {
    return null;
  } finally {
    client?.close();
  }
}

function remoteWorkerCatalogStatus(catalog: RuntimeRemoteWorkerCatalog): PlatformAgentStatus {
  const checkedAt = new Date().toISOString();
  return {
    state: catalog.state === "ready"
      ? "ready"
      : catalog.state === "requires_login" ? "requires_login" : "native_api_unavailable",
    apiVersion: null,
    capabilities: catalog.state === "ready" ? ["chat", "streaming", "remote-worker"] : [],
    message: catalog.message || (catalog.state === "ready"
      ? `Loaded ${catalog.workers.length} remote worker(s) through the local Runtime.`
      : "Remote worker catalog is unavailable."),
    lastCheckedAt: checkedAt,
    lastSuccessfulSyncAt: catalog.state === "ready" ? checkedAt : null,
    cacheState: "none",
  };
}
