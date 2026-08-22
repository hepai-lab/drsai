export type VoiceProviderRole = "speech_to_text" | "text_to_speech";

export type VoiceProviderReadiness =
  | { state: "ready"; providerId: string; modelId: string }
  | { state: "auth_required"; providerId: string; modelId: string }
  | { state: "unconfigured" };

interface ModelRefPayload {
  provider_id?: unknown;
  model_id?: unknown;
}

interface AgentModelsPayload {
  effective_speech_to_text_ref?: ModelRefPayload | null;
  effective_text_to_speech_ref?: ModelRefPayload | null;
}

interface ProviderPayload {
  name?: unknown;
  requires_api_key?: unknown;
  has_api_key?: unknown;
}

export async function getVoiceProviderReadiness(
  gatewayBaseUrl: string,
  headers: Record<string, string>,
  role: VoiceProviderRole,
  fetcher: typeof fetch = fetch,
): Promise<VoiceProviderReadiness> {
  const signal = AbortSignal.timeout(5_000);
  const [modelsResponse, providersResponse] = await Promise.all([
    fetcher(`${gatewayBaseUrl}/v1/config/agents/opendrsai/models`, { headers, signal }),
    fetcher(`${gatewayBaseUrl}/v1/config/model-providers`, { headers, signal }),
  ]);
  if (!modelsResponse.ok || !providersResponse.ok) return { state: "unconfigured" };

  const models = await modelsResponse.json() as AgentModelsPayload;
  const providers = await providersResponse.json() as { providers?: ProviderPayload[] };
  const ref = role === "speech_to_text"
    ? models.effective_speech_to_text_ref
    : models.effective_text_to_speech_ref;
  const providerId = typeof ref?.provider_id === "string" ? ref.provider_id : "";
  const modelId = typeof ref?.model_id === "string" ? ref.model_id : "";
  if (!providerId || !modelId) return { state: "unconfigured" };

  const provider = providers.providers?.find((item) => item.name === providerId);
  if (!provider) return { state: "unconfigured" };
  if (provider.requires_api_key === true && provider.has_api_key !== true) {
    return { state: "auth_required", providerId, modelId };
  }
  return { state: "ready", providerId, modelId };
}
