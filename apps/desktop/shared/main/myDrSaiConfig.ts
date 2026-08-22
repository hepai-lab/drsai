import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AgentKnowledgePolicy, AgentKnowledgePreview, AgentModelCapabilityStatus, AgentModelPolicy, AgentSkillPolicy, AgentSkillPreview, AgentToolPolicy, AgentToolPreview, ConfiguredAgentDescriptor, KnowledgeBaseResource, KnowledgeSearchEvidence, MyDrSaiAgentModelPolicy, MyDrSaiCliConfig, MyDrSaiConfig, MyDrSaiModelConfig, MyDrSaiModelConfigPreview, MyDrSaiModelConnection, MyDrSaiModelDiscoveryResult, MyDrSaiModelDoctorResult, MyDrSaiModelProvider, MyDrSaiModelProviderDraft, MyDrSaiProviderDeletePreflight, MyDrSaiProviderModelConfig, MyDrSaiProviderPreset, MyDrSaiProviderTestResult, PerceptorResource, RuntimeModelCatalog, SaveKnowledgeBaseRequest, SaveMyDrSaiModelProviderRequest, SavePerceptorRequest, UpdateMyDrSaiConfigRequest, UpdateMyDrSaiModelConnectionRequest } from "../api/desktopApi";
import { requireAuthContext } from "./auth";
import { getGatewayRequestHeaders, getGatewayStatus, startGateway } from "./gateway";

const WRITABLE_KEYS = ["plan_mode", "workspace_enabled", "dangerous_allowed"] as const;
const CALIBRATION_FILE = ".drsai/tokenizer-calibration.json";

export async function getMyDrSaiConfig(workspacePath?: string): Promise<MyDrSaiConfig> {
  const gateway = await getRecoverableGatewayStatus();
  if (!gateway.ready) return { ready: false, baseUrl: gateway.baseUrl, config: {}, models: [], modelCatalog: { state: "offline", message: "OpenDrSai is not running." }, error: "OpenDrSai is not running. Start it before reading configuration." };
  try {
    const [cli, modelConnection, modelProviders] = await Promise.all([
      gatewayRequest<{ path?: string; config?: Record<string, unknown> }>(gateway.baseUrl, "GET", "/v1/config/cli"),
      readModelConnection(gateway.baseUrl).catch(() => undefined),
      readModelProviders(gateway.baseUrl).catch(() => []),
    ]);
    let runtimeCatalog: RuntimeModelCatalog;
    try {
      runtimeCatalog = await readRuntimeModelCatalog(gateway.baseUrl);
    } catch (error) {
      const message = safeMessage(error);
      return {
        ready: true,
        baseUrl: gateway.baseUrl,
        ...(typeof cli.path === "string" ? { cliPath: cli.path } : {}),
        config: normalizeCli(cli.config),
        models: [],
        modelProviders,
        modelCatalog: { state: catalogFailureState(message), message },
        ...(modelConnection ? { modelConnection } : {}),
      };
    }
    const models = await applyCalibration(runtimeCatalog.models.map((descriptor) => ({
      alias: descriptor.ref.model_id,
      provider_id: descriptor.ref.provider_id,
      display_name: descriptor.display_name,
      model: descriptor.ref.model_id,
      token_limit: descriptor.token_limit ?? undefined,
      max_tokens: descriptor.max_output_tokens ?? undefined,
      vision: descriptor.input_modalities.includes("image"),
      input_modalities: descriptor.input_modalities,
      output_modalities: descriptor.output_modalities,
      operations: descriptor.operations,
      reasoning_efforts: descriptor.reasoning_efforts,
      availability: descriptor.availability,
      capability_source: descriptor.capability_source,
    })), workspacePath);
    const catalogState = runtimeCatalog.models.length > 0
      ? runtimeCatalog.state
      : runtimeCatalog.state !== "fresh"
        ? runtimeCatalog.state
        : modelConnection ? "empty" : "unconfigured";
    return { ready: true, baseUrl: gateway.baseUrl, ...(typeof cli.path === "string" ? { cliPath: cli.path } : {}), config: normalizeCli(cli.config), models, modelProviders, modelCatalog: { state: catalogState, revision: runtimeCatalog.revision }, ...(modelConnection ? { modelConnection } : {}) };
  } catch (error) {
    const message = safeMessage(error);
    return { ready: false, baseUrl: gateway.baseUrl, config: {}, models: [], modelCatalog: { state: catalogFailureState(message), message }, error: message };
  }
}

export async function updateMyDrSaiConfig(raw: unknown): Promise<MyDrSaiConfig> {
  const request = validateMyDrSaiConfigUpdate(raw); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running. Configuration cannot be saved.");
  for (const key of WRITABLE_KEYS) if (request[key] !== undefined) await gatewayRequest(gateway.baseUrl, "PUT", `/v1/config/cli/${key}`, { value: request[key] });
  return getMyDrSaiConfig();
}

export async function updateMyDrSaiModelConnection(raw: unknown): Promise<MyDrSaiModelConnection> {
  const request = validateModelConnectionUpdate(raw); const gateway = await getGatewayStatus();
  if (!gateway.ready) throw new Error("OpenDrSai is not running. Model configuration cannot be saved.");
  await gatewayRequest<MyDrSaiModelConnection>(gateway.baseUrl, "PUT", "/v1/config/model", request);
  return readModelConnection(gateway.baseUrl);
}

export async function previewMyDrSaiModelConnection(raw: unknown): Promise<MyDrSaiModelConfigPreview> {
  const request = validateModelConnectionUpdate(raw);
  const gateway = await getGatewayStatus();
  if (!gateway.ready) throw new Error("OpenDrSai is not running. Model configuration cannot be previewed.");
  return gatewayRequest(gateway.baseUrl, "POST", "/v1/config/model/preview", request);
}

export async function diagnoseMyDrSaiModelConnection(online = false): Promise<MyDrSaiModelDoctorResult> {
  if (typeof online !== "boolean") throw new Error("Model Doctor request is invalid.");
  const gateway = await getGatewayStatus();
  if (!gateway.ready) throw new Error("OpenDrSai is not running. Model Doctor cannot run.");
  return gatewayRequest(gateway.baseUrl, "POST", "/v1/config/model/doctor", { online });
}

export async function restoreMyDrSaiModelConnection(expectedRevision?: string): Promise<MyDrSaiModelConnection> {
  if (expectedRevision !== undefined && !/^[a-f0-9]{64}$/.test(expectedRevision)) {
    throw new Error("Model configuration revision is invalid.");
  }
  const gateway = await getGatewayStatus();
  if (!gateway.ready) throw new Error("OpenDrSai is not running. Model configuration cannot be restored.");
  await gatewayRequest(gateway.baseUrl, "POST", "/v1/config/model/restore", {
    ...(expectedRevision ? { expected_revision: expectedRevision } : {}),
  });
  return readModelConnection(gateway.baseUrl);
}

export async function saveMyDrSaiModelProvider(provider: string, raw: unknown): Promise<MyDrSaiModelConnection> {
  validateProviderName(provider);
  const request = validateProviderSave(raw);
  const gateway = await getGatewayStatus();
  if (!gateway.ready) throw new Error("OpenDrSai is not running. Model provider cannot be saved.");
  const committed = await gatewayRequest<{
    provider: MyDrSaiModelProvider;
    revision?: string;
    warnings?: string[];
  }>(gateway.baseUrl, "PUT", `/v1/config/model-providers/${encodeURIComponent(provider)}`, request);
  // Provider creation must precede an Agent policy that references it. Do not
  // read /v1/config/model-state here: that endpoint intentionally fails while
  // the Agent has no explicit primary model, which otherwise makes first-time
  // setup circular and impossible.
  const listed = await gatewayRequest<{ providers: MyDrSaiModelProvider[] }>(gateway.baseUrl, "GET", "/v1/config/model-providers");
  const saved = listed.providers.find((candidate) => candidate.name === provider) ?? committed.provider;
  return {
    model: "",
    model_provider: provider,
    provider: saved,
    providers: listed.providers,
    ...(committed.revision ? { revision: committed.revision.replace(/^sha256:/, "") } : {}),
    ...(committed.warnings?.length ? { warnings: committed.warnings } : {}),
  };
}

export async function testMyDrSaiModelProvider(provider: string, model?: string): Promise<MyDrSaiProviderTestResult> { validateProviderName(provider); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "POST", `/v1/config/model-providers/${encodeURIComponent(provider)}/test`, model ? { model } : {}, provider === "hepai" ? await oidcGatewayHeaders() : undefined); }
export async function probeMyDrSaiProviderModel(provider: string, request: { model: string; operation: import("../api/desktopApi").ModelCapabilityProbeOperation; protocol?: string }): Promise<import("../api/desktopApi").ModelCapabilityProbeResult> {
  validateProviderName(provider); if (!request.model.trim()) throw new Error("Model is required.");
  const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running.");
  const role = request.operation === "image_generation" || request.operation === "image_edit" ? "image_generation_model" : request.operation === "text_to_speech" ? "text_to_speech_model" : request.operation === "speech_to_text" ? "speech_to_text_model" : "primary_model";
  const response = await gatewayRequest<{ result: import("../api/desktopApi").ModelCapabilityProbeResult }>(gateway.baseUrl, "POST", `/v1/config/model-providers/${encodeURIComponent(provider)}/capability-probes`, { model: request.model.trim(), operation: request.operation, protocol: request.protocol ?? "auto", role }, provider === "hepai" ? await oidcGatewayHeaders() : undefined, 180_000);
  return response.result;
}
export async function testMyDrSaiModelDraft(raw: unknown, mode: "basic" | "model" = "basic"): Promise<MyDrSaiProviderTestResult> { const request = validateModelConnectionUpdate(raw); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "POST", "/v1/config/model-providers/test", { name: request.model_provider, model: request.model, base_url: request.base_url, api_key: request.api_key, wire_api: request.wire_api ?? "openai", requires_api_key: request.requires_api_key ?? true, mode }, request.model_provider === "hepai" ? await oidcGatewayHeaders() : undefined); }
export async function listMyDrSaiModelProviderPresets(): Promise<MyDrSaiProviderPreset[]> { const gateway = await getRecoverableGatewayStatus(); if (!gateway.ready) return []; const result = await gatewayRequest<{ presets: MyDrSaiProviderPreset[] }>(gateway.baseUrl, "GET", "/v1/config/model-providers/presets"); return result.presets; }
export async function discoverMyDrSaiProviderModels(provider: string, refresh = false, rawDraft?: unknown): Promise<MyDrSaiModelDiscoveryResult> { validateProviderName(provider); const draft = validateProviderDraft(rawDraft); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "POST", "/v1/config/model-providers/models", { provider, refresh, ...draft }, provider === "hepai" ? await oidcGatewayHeaders() : undefined); }
export async function getMyDrSaiRuntimeModelCatalog(): Promise<RuntimeModelCatalog> { const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return readRuntimeModelCatalog(gateway.baseUrl); }
export async function listConfiguredAgents(): Promise<{ current_agent: string; agents: ConfiguredAgentDescriptor[] }> { const gateway = await getRecoverableGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "GET", "/v1/config/agents"); }
export async function getCurrentAgentName(): Promise<string> { return (await listConfiguredAgents()).current_agent; }
export async function getMyDrSaiAgentModelPolicy(agentId?: string): Promise<MyDrSaiAgentModelPolicy> { const resolved = agentId ?? await getCurrentAgentName(); validateAgentPolicyId(resolved); const gateway = await getRecoverableGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "GET", `/v1/config/agents/${encodeURIComponent(resolved)}/models`); }
export async function getMyDrSaiAgentToolPolicy(agentId: string): Promise<AgentToolPolicy> { validateAgentPolicyId(agentId); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "GET", `/v1/config/agents/${encodeURIComponent(agentId)}/tools`); }
export async function updateMyDrSaiAgentToolPolicy(agentId: string, policy: AgentToolPolicy): Promise<AgentToolPolicy> { validateAgentPolicyId(agentId); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "PUT", `/v1/config/agents/${encodeURIComponent(agentId)}/tools`, { mode: policy.mode, enabled: policy.enabled, disabled: policy.disabled, require_approval: policy.require_approval, expected_revision: policy.expected_revision }); }
export async function previewMyDrSaiAgentTools(agentId: string): Promise<AgentToolPreview> { validateAgentPolicyId(agentId); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "POST", `/v1/config/agents/${encodeURIComponent(agentId)}/tools/preview`); }
export async function testAgentTool(toolId: string): Promise<{ ok: boolean; tool_id: string; status: string; tested: string; error?: string }> { if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(toolId)) throw new Error("Tool ID is invalid."); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "POST", `/v1/config/tools/${encodeURIComponent(toolId)}/test`); }
export async function getMyDrSaiAgentSkillPolicy(agentId: string): Promise<AgentSkillPolicy> { validateAgentPolicyId(agentId); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "GET", `/v1/config/agents/${encodeURIComponent(agentId)}/skills`); }
export async function updateMyDrSaiAgentSkillPolicy(agentId: string, policy: AgentSkillPolicy): Promise<AgentSkillPolicy> { validateAgentPolicyId(agentId); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "PUT", `/v1/config/agents/${encodeURIComponent(agentId)}/skills`, { mode: policy.mode, enabled: policy.enabled, disabled: policy.disabled, allow_thread_override: policy.allow_thread_override, expected_revision: policy.expected_revision }); }
export async function previewMyDrSaiAgentSkills(agentId: string): Promise<AgentSkillPreview> { validateAgentPolicyId(agentId); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "POST", `/v1/config/agents/${encodeURIComponent(agentId)}/skills/preview`); }
export async function getMyDrSaiAgentKnowledgePolicy(agentId: string): Promise<AgentKnowledgePolicy> { validateAgentPolicyId(agentId); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "GET", `/v1/config/agents/${encodeURIComponent(agentId)}/knowledge`); }
export async function updateMyDrSaiAgentKnowledgePolicy(agentId: string, policy: AgentKnowledgePolicy): Promise<AgentKnowledgePolicy> { validateAgentPolicyId(agentId); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "PUT", `/v1/config/agents/${encodeURIComponent(agentId)}/knowledge`, { mode: policy.mode, sources: policy.sources, retrieval_policy: policy.retrieval_policy, top_k: policy.top_k, score_threshold: policy.score_threshold, require_citations: policy.require_citations, expected_revision: policy.expected_revision }); }
export async function previewMyDrSaiAgentKnowledge(agentId: string): Promise<AgentKnowledgePreview> { validateAgentPolicyId(agentId); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "POST", `/v1/config/agents/${encodeURIComponent(agentId)}/knowledge/preview`); }
export async function indexKnowledgeBase(knowledgeId: string): Promise<{ knowledge_id: string; status: string; document_count: number; chunk_count: number }> { if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(knowledgeId)) throw new Error("Knowledge Base ID is invalid."); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "POST", `/v1/config/knowledge-bases/${encodeURIComponent(knowledgeId)}/index`); }
export async function testKnowledgeBase(knowledgeId: string): Promise<{ ok: boolean; knowledge_id: string; type: string; status?: string; dataset_count?: number }> { if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(knowledgeId)) throw new Error("Knowledge Base ID is invalid."); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "POST", `/v1/config/knowledge-bases/${encodeURIComponent(knowledgeId)}/test`); }
export async function searchKnowledgeBase(knowledgeId: string, query: string): Promise<{ knowledge_id: string; query: string; evidence: KnowledgeSearchEvidence[] }> { if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(knowledgeId)) throw new Error("Knowledge Base ID is invalid."); const normalized = query.trim(); if (!normalized || normalized.length > 8000) throw new Error("Knowledge search query is invalid."); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "POST", `/v1/config/knowledge-bases/${encodeURIComponent(knowledgeId)}/search-preview`, { query: normalized, top_k: 6, score_threshold: 0 }); }
export async function listKnowledgeBases(): Promise<KnowledgeBaseResource[]> { const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return (await gatewayRequest<{ data: KnowledgeBaseResource[] }>(gateway.baseUrl, "GET", "/v1/config/knowledge-bases")).data; }
export async function createKnowledgeBase(request: SaveKnowledgeBaseRequest): Promise<KnowledgeBaseResource> { const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "POST", "/v1/config/knowledge-bases", request); }
export async function deleteKnowledgeBase(knowledgeId: string): Promise<{ status: string }> { if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(knowledgeId)) throw new Error("Knowledge Base ID is invalid."); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "DELETE", `/v1/config/knowledge-bases/${encodeURIComponent(knowledgeId)}`); }
export async function listPerceptors(): Promise<PerceptorResource[]> { const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return (await gatewayRequest<{ data: PerceptorResource[] }>(gateway.baseUrl, "GET", "/v1/config/perceptors")).data; }
function validatePerceptorRequest(raw: unknown): SavePerceptorRequest { if (!raw || typeof raw !== "object") throw new Error("Perceptor request is invalid."); const request = raw as SavePerceptorRequest; const validPair = (request.adapter === "tavily" && request.kind === "public_web") || (request.adapter === "facility_gateway" && request.kind === "large_facility_data"); if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(request.perceptor_id) || !validPair || !request.config || typeof request.config !== "object" || !Array.isArray(request.capabilities)) throw new Error("Perceptor request is invalid."); return request; }
export async function savePerceptor(raw: unknown): Promise<PerceptorResource> { const request = validatePerceptorRequest(raw); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "POST", "/v1/config/perceptors", request); }
export async function updatePerceptor(rawPerceptorId: unknown, raw: unknown): Promise<PerceptorResource> { const request = validatePerceptorRequest(raw); const perceptorId = typeof rawPerceptorId === "string" ? rawPerceptorId : ""; if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(perceptorId)) throw new Error("Perceptor ID is invalid."); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "PUT", `/v1/config/perceptors/${encodeURIComponent(perceptorId)}`, request); }
export async function testPerceptor(raw: unknown, rawCapability: unknown = "search"): Promise<{ ok: boolean; perceptor_id: string; status: string; tested?: string; result_count?: number; error?: string }> { const perceptorId = typeof raw === "string" ? raw : ""; const capability = rawCapability === "extract" ? "extract" : "search"; if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(perceptorId)) throw new Error("Perceptor ID is invalid."); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "POST", `/v1/config/perceptors/${encodeURIComponent(perceptorId)}/test?capability=${capability}`); }
export async function deletePerceptor(raw: unknown): Promise<{ status: string; perceptor_id: string }> { const perceptorId = typeof raw === "string" ? raw : ""; if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(perceptorId)) throw new Error("Perceptor ID is invalid."); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "DELETE", `/v1/config/perceptors/${encodeURIComponent(perceptorId)}`); }
export async function getMyDrSaiAgentModelCapabilityStatus(agentId?: string): Promise<AgentModelCapabilityStatus> { const resolved = agentId ?? await getCurrentAgentName(); validateAgentPolicyId(resolved); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "GET", `/v1/config/agents/${encodeURIComponent(resolved)}/model-capability-status`); }
export async function updateMyDrSaiAgentModelPolicy(agentId: string, raw: unknown): Promise<MyDrSaiAgentModelPolicy> { validateAgentPolicyId(agentId); const policy = validateAgentModelPolicy(raw); if (policy.agent_id !== agentId) throw new Error("Agent model policy identity is invalid."); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "PUT", `/v1/config/agents/${encodeURIComponent(agentId)}/models`, { primary_model: policy.primary_model, image_understanding_model: policy.image_understanding_model, image_generation_model: policy.image_generation_model, text_to_speech_model: policy.text_to_speech_model, realtime_voice_model: policy.realtime_voice_model, speech_to_text_model: policy.speech_to_text_model, reasoning_effort: policy.reasoning_effort, expected_revision: policy.expected_revision }); }
export async function migrateMyDrSaiAgentModelPolicy(agentId: string, legacyModel: string, expectedRevision?: string): Promise<MyDrSaiAgentModelPolicy> { validateAgentPolicyId(agentId); if (!legacyModel.trim() || legacyModel.length > 240) throw new Error("Legacy model preference is invalid."); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "POST", `/v1/config/agents/${encodeURIComponent(agentId)}/models/migrate`, { legacy_model: legacyModel.trim(), expected_revision: expectedRevision }); }
export async function preflightMyDrSaiModelProviderDeletion(provider: string): Promise<MyDrSaiProviderDeletePreflight> { validateProviderName(provider); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "GET", `/v1/config/model-providers/${encodeURIComponent(provider)}/references`); }
export async function deleteMyDrSaiModelProvider(provider: string, deleteCredential = true): Promise<{ ok: boolean; active?: string }> { validateProviderName(provider); const gateway = await getGatewayStatus(); if (!gateway.ready) throw new Error("OpenDrSai is not running."); return gatewayRequest(gateway.baseUrl, "DELETE", `/v1/config/model-providers/${encodeURIComponent(provider)}?delete_credential=${deleteCredential ? "true" : "false"}`); }

function validateModelConnectionUpdate(raw: unknown): UpdateMyDrSaiModelConnectionRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Model configuration update is invalid."); const value = raw as Record<string, unknown>; const allowed = new Set(["model", "model_provider", "base_url", "anthropic_base_url", "google_base_url", "api_key", "api_key_env", "api_key_credential", "wire_api", "requires_api_key", "models", "model_aliases", "model_upstream_ids", "model_operations", "expected_revision"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("Model configuration contains an unsupported key.");
  for (const key of ["model", "model_provider"] as const) if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > 256 || /[\r\n\0]/.test(value[key])) throw new Error(`${key} is invalid.`);
  validateProviderName(String(value.model_provider));
  for (const key of ["base_url", "anthropic_base_url", "google_base_url", "api_key", "api_key_env", "api_key_credential"] as const) if (value[key] !== undefined && (typeof value[key] !== "string" || !value[key].trim() || value[key].length > 8192 || /[\r\n\0]/.test(value[key]))) throw new Error(`${key} is invalid.`);
  for (const key of ["base_url", "anthropic_base_url", "google_base_url"] as const) if (value[key] !== undefined && !/^https?:\/\/[^\s]+$/i.test(String(value[key]))) throw new Error(`${key} must be an absolute HTTP(S) URL.`);
  if (value.wire_api !== undefined && !["openai", "anthropic", "gemini"].includes(String(value.wire_api))) throw new Error("wire_api is invalid.");
  if (value.requires_api_key !== undefined && typeof value.requires_api_key !== "boolean") throw new Error("requires_api_key is invalid.");
  value.models = normalizeProviderModels(value.models);
  validateModelAliases(value.model_aliases, value.models);
  validateModelAliases(value.model_upstream_ids, value.models);
  validateModelOperations(value.model_operations, value.models);
  if (value.expected_revision !== undefined && (typeof value.expected_revision !== "string" || !/^[a-f0-9]{64}$/.test(value.expected_revision))) throw new Error("expected_revision is invalid.");
  if ([value.api_key, value.api_key_env, value.api_key_credential].filter(Boolean).length > 1) throw new Error("Only one API-key source may be set.");
  return value as unknown as UpdateMyDrSaiModelConnectionRequest;
}
function validateProviderName(provider: string): void { if (!/^[A-Za-z0-9_-]+$/.test(provider)) throw new Error("Model provider name is invalid."); }
function validateAgentPolicyId(agentId: string): void { if (!/^[a-z][a-z0-9_-]{0,63}$/.test(agentId)) throw new Error("Agent name is invalid."); }
function validateAgentModelPolicy(raw: unknown): AgentModelPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Agent model policy is invalid.");
  const value = raw as Record<string, unknown>;
  const capabilityKeys = ["image_understanding_model", "image_generation_model", "text_to_speech_model", "realtime_voice_model", "speech_to_text_model"] as const;
  if (Object.keys(value).some((key) => !["agent_id", "primary_model", ...capabilityKeys, "reasoning_effort", "expected_revision"].includes(key))) throw new Error("Agent model policy contains an unsupported key.");
  if (typeof value.agent_id !== "string") throw new Error("Agent model policy identity is invalid.");
  if (value.reasoning_effort !== undefined && value.reasoning_effort !== null && !["none", "low", "medium", "high", "xhigh", "max"].includes(String(value.reasoning_effort))) throw new Error("Agent reasoning effort is invalid.");
  for (const key of capabilityKeys) if (value[key] !== undefined && value[key] !== null) {
    if (typeof value[key] !== "object" || Array.isArray(value[key])) throw new Error(`${key} selection is invalid.`);
    const capability = value[key] as Record<string, unknown>;
    if (capability.mode !== "explicit" || !capability.ref || typeof capability.ref !== "object" || Array.isArray(capability.ref)) throw new Error(`${key} selection must be explicit.`);
    const ref = capability.ref as Record<string, unknown>;
    if (typeof ref.provider_id !== "string" || typeof ref.model_id !== "string" || !ref.provider_id || !ref.model_id) throw new Error(`${key} reference is invalid.`);
  }
  if (!value.primary_model || typeof value.primary_model !== "object" || Array.isArray(value.primary_model)) throw new Error("Primary model selection is invalid.");
  const selection = value.primary_model as Record<string, unknown>;
  if (Object.keys(selection).some((key) => !["mode", "ref"].includes(key))) throw new Error("Primary model selection contains an unsupported key.");
  if (selection.mode === "explicit") {
    if (!selection.ref || typeof selection.ref !== "object" || Array.isArray(selection.ref)) throw new Error("Explicit model selection requires a model reference.");
    const ref = selection.ref as Record<string, unknown>;
    if (Object.keys(ref).some((key) => !["provider_id", "model_id", "catalog_revision"].includes(key)) || typeof ref.provider_id !== "string" || typeof ref.model_id !== "string" || !ref.provider_id || !ref.model_id) throw new Error("Model reference is invalid.");
  } else throw new Error("Primary model selection mode is invalid.");
  if (value.expected_revision !== undefined && (typeof value.expected_revision !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.expected_revision))) throw new Error("Agent model policy revision is invalid.");
  return value as unknown as AgentModelPolicy;
}
function validateProviderDraft(raw: unknown): MyDrSaiModelProviderDraft | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Model provider draft is invalid.");
  const value = raw as Record<string, unknown>;
  const allowed = new Set(["base_url", "anthropic_base_url", "google_base_url", "api_key", "wire_api", "requires_api_key"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("Model provider draft contains an unsupported key.");
  if (typeof value.base_url !== "string" || !/^https?:\/\/[^\s]+$/i.test(value.base_url) || value.base_url.length > 2048 || /[\r\n\0]/.test(value.base_url)) throw new Error("base_url is invalid.");
  for (const key of ["anthropic_base_url", "google_base_url"] as const) if (value[key] !== undefined && (typeof value[key] !== "string" || !/^https?:\/\/[^\s]+$/i.test(value[key]) || value[key].length > 2048 || /[\r\n\0]/.test(value[key]))) throw new Error(`${key} is invalid.`);
  if (value.api_key !== undefined && (typeof value.api_key !== "string" || !value.api_key.trim() || value.api_key.length > 8192 || /[\r\n\0]/.test(value.api_key))) throw new Error("api_key is invalid.");
  if (!["openai", "anthropic", "gemini"].includes(String(value.wire_api))) throw new Error("wire_api is invalid.");
  if (typeof value.requires_api_key !== "boolean") throw new Error("requires_api_key is invalid.");
  return value as unknown as MyDrSaiModelProviderDraft;
}

function validateProviderSave(raw: unknown): SaveMyDrSaiModelProviderRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Model provider configuration is invalid.");
  const value = raw as Record<string, unknown>;
  const allowed = new Set(["base_url", "anthropic_base_url", "google_base_url", "api_key", "wire_api", "requires_api_key", "models", "model_aliases", "model_upstream_ids", "model_operations", "expected_revision"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("Model provider configuration contains an unsupported key.");
  if (typeof value.base_url !== "string" || !/^https?:\/\/[^\s]+$/i.test(value.base_url) || value.base_url.length > 2048 || /[\r\n\0]/.test(value.base_url)) throw new Error("base_url is invalid.");
  for (const key of ["anthropic_base_url", "google_base_url"] as const) if (value[key] !== undefined && (typeof value[key] !== "string" || !/^https?:\/\/[^\s]+$/i.test(value[key]) || value[key].length > 2048 || /[\r\n\0]/.test(value[key]))) throw new Error(`${key} is invalid.`);
  if (value.api_key !== undefined && (typeof value.api_key !== "string" || !value.api_key.trim() || value.api_key.length > 8192 || /[\r\n\0]/.test(value.api_key))) throw new Error("api_key is invalid.");
  if (!["openai", "anthropic", "gemini"].includes(String(value.wire_api))) throw new Error("wire_api is invalid.");
  if (typeof value.requires_api_key !== "boolean") throw new Error("requires_api_key is invalid.");
  value.models = normalizeProviderModels(value.models);
  validateModelAliases(value.model_aliases, value.models);
  validateModelAliases(value.model_upstream_ids, value.models);
  validateModelOperations(value.model_operations, value.models);
  if (value.expected_revision !== undefined && (typeof value.expected_revision !== "string" || !/^[a-f0-9]{64}$/.test(value.expected_revision))) throw new Error("expected_revision is invalid.");
  return value as unknown as SaveMyDrSaiModelProviderRequest;
}

function validateModelAliases(raw: unknown, rawModels: unknown): void {
  if (raw === undefined) return;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("model_aliases is invalid.");
  const entries = Object.entries(raw as Record<string, unknown>);
  const models = new Set(Array.isArray(rawModels) ? rawModels.filter((model): model is string => typeof model === "string") : rawModels && typeof rawModels === "object" ? Object.keys(rawModels) : []);
  if (entries.length > 500 || entries.some(([model, alias]) => !models.has(model) || !model.trim() || model.length > 256 || /[\r\n\0]/.test(model) || typeof alias !== "string" || !alias.trim() || alias.length > 256 || /[\r\n\0]/.test(alias))) throw new Error("model_aliases is invalid.");
}

function validateModelOperations(raw: unknown, rawModels: unknown): void {
  if (raw === undefined) return;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("model_operations is invalid.");
  const entries = Object.entries(raw as Record<string, unknown>);
  const models = new Set(Array.isArray(rawModels) ? rawModels.filter((model): model is string => typeof model === "string") : rawModels && typeof rawModels === "object" ? Object.keys(rawModels) : []);
  const allowed = new Set(["image_generation", "image_edit"]);
  if (entries.length > 500 || entries.some(([model, operations]) =>
    !models.has(model) || !Array.isArray(operations) || operations.length === 0
    || new Set(operations).size !== operations.length
    || operations.some((operation) => typeof operation !== "string" || !allowed.has(operation)))) {
    throw new Error("model_operations is invalid.");
  }
}

function normalizeProviderModels(raw: unknown): SaveMyDrSaiModelProviderRequest["models"] {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) {
    if (raw.length > 500 || raw.some((model) => typeof model !== "string" || !model.trim() || model.length > 256 || /[\r\n\0]/.test(model))) throw new Error("models is invalid.");
    return raw as string[];
  }
  if (!raw || typeof raw !== "object") throw new Error("models is invalid.");
  const entries = Object.entries(raw as Record<string, unknown>);
  const modalities = new Set(["text", "image", "audio", "video"]);
  const protocols = new Set(["openai", "anthropic", "gemini"]);
  const capabilities = new Set(["chat", "tool_calling", "reasoning", "image_generation", "image_edit", "speech_to_text", "text_to_speech", "video_generation"]);
  if (entries.length > 500) throw new Error("models contains too many entries.");
  return Object.fromEntries(entries.map(([model, config]) => {
    if (!model.trim() || model.length > 256 || /[\r\n\0]/.test(model)) throw new Error(`Model ID "${model.slice(0, 80)}" is invalid.`);
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(`Model "${model}" configuration is invalid.`);
    const item = config as Record<string, unknown>;
    const unsupportedKey = Object.keys(item).find((key) => !["alias", "modalities", "input_modalities", "output_modalities", "api_protocol", "enabled", "capabilities", "upstream_id"].includes(key));
    if (unsupportedKey) throw new Error(`Model "${model}" contains unsupported field "${unsupportedKey}".`);
    const capabilityValues = Array.isArray(item.capabilities) ? item.capabilities.filter((entry): entry is string => typeof entry === "string") : [];
    const capabilitySet = new Set(capabilityValues);
    const legacyModalities = Array.isArray(item.modalities) ? item.modalities : undefined;
    let inputValues = Array.isArray(item.input_modalities) ? item.input_modalities : legacyModalities;
    let outputValues = Array.isArray(item.output_modalities) ? item.output_modalities : undefined;
    if (legacyModalities && (item.input_modalities !== undefined || item.output_modalities !== undefined)) throw new Error(`Model "${model}" cannot mix legacy and input/output modalities.`);
    if (legacyModalities && outputValues === undefined) {
      outputValues = capabilitySet.size === 0 || ["chat", "tool_calling", "reasoning", "speech_to_text"].some((capability) => capabilitySet.has(capability)) ? ["text"] : [];
      if (["image_generation", "image_edit"].some((capability) => capabilitySet.has(capability))) outputValues.push("image");
      if (capabilitySet.has("text_to_speech")) outputValues.push("audio");
      if (capabilitySet.has("video_generation")) outputValues.push("video");
    }
    const inputSet = new Set(inputValues);
    const outputSet = new Set(outputValues);
    const protocol = item.api_protocol === "google" ? "gemini" : item.api_protocol;
    if (item.alias !== undefined && (typeof item.alias !== "string" || !item.alias.trim() || item.alias.length > 256 || /[\r\n\0]/.test(item.alias))) throw new Error(`Model "${model}" alias is invalid.`);
    if (!Array.isArray(inputValues) || inputValues.length === 0 || new Set(inputValues).size !== inputValues.length || inputValues.some((entry) => typeof entry !== "string" || !modalities.has(entry))) throw new Error(`Model "${model}" input modalities are invalid.`);
    if (!Array.isArray(outputValues) || outputValues.length === 0 || new Set(outputValues).size !== outputValues.length || outputValues.some((entry) => typeof entry !== "string" || !modalities.has(entry))) throw new Error(`Model "${model}" output modalities are invalid.`);
    if (typeof protocol !== "string" || !protocols.has(protocol)) throw new Error(`Model "${model}" API protocol is invalid.`);
    if (typeof item.enabled !== "boolean") throw new Error(`Model "${model}" enabled state is invalid.`);
    if (!Array.isArray(item.capabilities) || new Set(item.capabilities).size !== item.capabilities.length || item.capabilities.some((entry) => typeof entry !== "string" || !capabilities.has(entry))) throw new Error(`Model "${model}" capabilities are invalid.`);
    if (["tool_calling", "reasoning"].some((capability) => capabilitySet.has(capability)) && !capabilitySet.has("chat")) throw new Error(`Model "${model}" tool calling or reasoning requires chat capability.`);
    if (capabilitySet.has("image_generation") && !outputSet.has("image")) throw new Error(`Model "${model}" image generation requires image output.`);
    if (capabilitySet.has("image_edit") && !(inputSet.has("image") && outputSet.has("image"))) throw new Error(`Model "${model}" image editing requires image input and output.`);
    if (capabilitySet.has("speech_to_text") && !(inputSet.has("audio") && outputSet.has("text"))) throw new Error(`Model "${model}" speech recognition requires audio input and text output.`);
    if (capabilitySet.has("text_to_speech") && !(inputSet.has("text") && outputSet.has("audio"))) throw new Error(`Model "${model}" speech synthesis requires text input and audio output.`);
    if (capabilitySet.has("video_generation") && !outputSet.has("video")) throw new Error(`Model "${model}" video generation requires video output.`);
    if (item.upstream_id !== undefined && (typeof item.upstream_id !== "string" || !item.upstream_id.trim() || item.upstream_id.length > 256 || /[\r\n\0]/.test(item.upstream_id))) throw new Error(`Model "${model}" upstream ID is invalid.`);
    const { modalities: _legacyModalities, ...normalized } = item;
    return [model, { ...normalized, input_modalities: inputValues, output_modalities: outputValues, api_protocol: protocol }];
  })) as Record<string, MyDrSaiProviderModelConfig>;
}

export function validateMyDrSaiConfigUpdate(raw: unknown): UpdateMyDrSaiConfigRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("OpenDrSai configuration update is invalid."); const value = raw as Record<string, unknown>; const allowed = new Set<string>(WRITABLE_KEYS);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("OpenDrSai configuration contains a non-writable key.");
  for (const key of ["plan_mode", "workspace_enabled", "dangerous_allowed"] as const) if (value[key] !== undefined && typeof value[key] !== "boolean") throw new Error(`OpenDrSai ${key} is invalid.`);
  if (!Object.keys(value).length) throw new Error("OpenDrSai configuration update is empty."); return value as UpdateMyDrSaiConfigRequest;
}

function normalizeCli(value: Record<string, unknown> | undefined): MyDrSaiCliConfig { if (!value || typeof value !== "object") return {}; const { user_id: _legacyCliProfileId, ...desktopConfig } = value; return desktopConfig; }
function samples(value: unknown): NonNullable<MyDrSaiModelConfig["tokenizer_calibration"]> | undefined { if (!Array.isArray(value)) return undefined; const result = value.flatMap((item) => { if (!item || typeof item !== "object") return []; const row = item as Record<string, unknown>; return typeof row.sample === "string" && row.sample.trim() && typeof row.tokens === "number" && Number.isFinite(row.tokens) && row.tokens > 0 ? [{ sample: row.sample.slice(0, 4000), tokens: Math.floor(row.tokens) }] : []; }).slice(0, 12); return result.length ? result : undefined; }
async function applyCalibration(models: MyDrSaiModelConfig[], workspacePath?: string): Promise<MyDrSaiModelConfig[]> { const calibration = await readCalibration(workspacePath); if (!calibration.size) return models; return models.map((model) => { const extra = [model.alias, model.model, model.display_name].filter(Boolean).flatMap((id) => calibration.get(String(id).toLowerCase()) ?? []); const merged = samples([...(model.tokenizer_calibration ?? []), ...extra]); return merged ? { ...model, tokenizer_calibration: merged } : model; }); }
async function readCalibration(workspacePath?: string): Promise<Map<string, NonNullable<MyDrSaiModelConfig["tokenizer_calibration"]>>> { const result = new Map<string, NonNullable<MyDrSaiModelConfig["tokenizer_calibration"]>>(); if (!workspacePath || /[\r\n\0]/.test(workspacePath)) return result; try { const root = await realpath(resolve(workspacePath)); const file = await realpath(join(root, CALIBRATION_FILE)); const rel = relative(root, file); if (rel.startsWith("..") || isAbsolute(rel) || (await stat(file)).size > 1_048_576) return result; const parsed = JSON.parse(await readFile(file, "utf8")) as { models?: unknown }; if (!Array.isArray(parsed.models)) return result; for (const item of parsed.models.slice(0, 500)) { if (!item || typeof item !== "object") continue; const row = item as Record<string, unknown>; const normalized = samples(row.samples ?? row.tokenizer_calibration); if (!normalized) continue; for (const id of [row.alias, row.model, row.display_name]) if (typeof id === "string" && id.trim()) result.set(id.trim().toLowerCase(), normalized); } } catch { /* Missing or invalid workspace calibration is optional. */ } return result; }
async function oidcGatewayHeaders(): Promise<Record<string, string> | undefined> { try { const auth = await requireAuthContext(); return auth.authMode === "oidc" && auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}`, "X-OpenDrSai-Auth-Mode": "oidc", "X-OpenDrSai-Principal": auth.userId } : undefined; } catch { return undefined; } }
async function gatewayRequest<T>(baseUrl: string, method: "GET" | "PUT" | "POST" | "DELETE", path: string, body?: unknown, extraHeaders?: Record<string, string>, timeoutMs = 15_000): Promise<T> { if (!/^http:\/\/(?:127\.0\.0\.1|\[::1\]|localhost):\d+$/.test(baseUrl)) throw new Error("OpenDrSai configuration endpoint must be loopback."); const payload = body === undefined ? undefined : JSON.stringify(body); const response = await fetch(new URL(path, baseUrl), { method, headers: { ...getGatewayRequestHeaders(), ...extraHeaders, ...(payload ? { "Content-Type": "application/json" } : {}) }, body: payload, signal: AbortSignal.timeout(timeoutMs) }); const text = await response.text(); if (!response.ok) throw new Error(readError(text, response.status)); if (!text) return {} as T; if (text.length > 2 * 1024 * 1024) throw new Error("OpenDrSai configuration response is too large."); return JSON.parse(text) as T; }
function readError(text: string, status?: number): string { try { const value = JSON.parse(text) as { detail?: unknown; error?: unknown; message?: unknown }; if (value.error && typeof value.error === "object" && !Array.isArray(value.error)) { const error = value.error as { message?: unknown; code?: unknown }; if (typeof error.message === "string") return error.message.slice(0, 1000); if (typeof error.code === "string") return error.code.slice(0, 1000); } if (typeof value.detail === "string") return value.detail.slice(0, 1000); if (Array.isArray(value.detail)) { const issues = value.detail.flatMap((item) => { if (!item || typeof item !== "object") return []; const issue = item as { loc?: unknown; msg?: unknown }; if (typeof issue.msg !== "string") return []; const location = Array.isArray(issue.loc) ? issue.loc.filter((part) => typeof part === "string" || typeof part === "number").join(".") : ""; return [`${location ? `${location}: ` : ""}${issue.msg}`]; }).slice(0, 3); if (issues.length) return issues.join(" / ").slice(0, 1000); } if (value.detail && typeof value.detail === "object") { const detail = value.detail as { title?: unknown; message?: unknown; actions?: unknown }; const message = typeof detail.message === "string" ? detail.message : typeof detail.title === "string" ? detail.title : "Configuration request failed"; const actions = Array.isArray(detail.actions) ? detail.actions.filter(item => typeof item === "string").slice(0, 3).join(" / ") : ""; return `${message}${actions ? ` — ${actions}` : ""}`.slice(0, 1000); } if (typeof value.message === "string") return value.message.slice(0, 1000); } catch { /* Use bounded generic message. */ } return `OpenDrSai configuration request failed${status ? ` (HTTP ${status})` : ""}.`; }
function safeMessage(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/(token|password|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 1000); }
function catalogFailureState(message: string): "unauthorized" | "offline" | "timeout" | "error" { if (/401|403|unauthorized|forbidden|permission|sign in|login/i.test(message)) return "unauthorized"; if (/timeout|timed out|aborted/i.test(message)) return "timeout"; if (/not running|offline|connection refused|failed to fetch|network/i.test(message)) return "offline"; return "error"; }

async function readModelConnection(baseUrl: string): Promise<MyDrSaiModelConnection> { const state = await gatewayRequest<{ effective: MyDrSaiModelConnection; providers?: MyDrSaiModelProvider[]; path?: string; revision?: string; runtime?: MyDrSaiModelConnection["runtime"]; last_test?: MyDrSaiModelConnection["last_test"] }>(baseUrl, "GET", "/v1/config/model-state"); return { ...state.effective, ...(state.providers ? { providers: state.providers } : {}), ...(state.path ? { path: state.path } : {}), ...(state.revision ? { revision: state.revision } : {}), ...(state.runtime ? { runtime: state.runtime } : {}), ...(state.last_test !== undefined ? { last_test: state.last_test } : {}) }; }
async function readModelProviders(baseUrl: string): Promise<MyDrSaiModelProvider[]> { const result = await gatewayRequest<{ providers?: MyDrSaiModelProvider[] }>(baseUrl, "GET", "/v1/config/model-providers"); return Array.isArray(result.providers) ? result.providers : []; }
async function readRuntimeModelCatalog(baseUrl: string): Promise<RuntimeModelCatalog> { return gatewayRequest(baseUrl, "GET", "/v1/config/runtime-models", undefined, await oidcGatewayHeaders()); }
async function getRecoverableGatewayStatus(): Promise<Awaited<ReturnType<typeof getGatewayStatus>>> { const current = await getGatewayStatus(); if (current.ready) return current; if (!await startGateway()) return current; return getGatewayStatus(); }
