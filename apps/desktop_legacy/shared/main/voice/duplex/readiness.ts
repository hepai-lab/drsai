import type { DesktopDuplexVoiceCapabilities, DesktopDuplexVoiceLiveProbe, DesktopDuplexVoiceReadiness } from "../../../api/desktopApi";

export interface DuplexVoiceReadinessInputs {
  rolloutReady: boolean;
  gatewayReady: boolean;
  credentialReady: boolean;
  providerId: string | null;
  modelId: string | null;
  capabilities: DesktopDuplexVoiceCapabilities;
  liveProbe?: DesktopDuplexVoiceLiveProbe | null;
  checkedAt?: string;
}

export function hasUsableDuplexCredential(
  hasAuthenticatedGatewaySession: boolean,
  liveProbe?: DesktopDuplexVoiceLiveProbe | null,
): boolean {
  // OIDC providers prove credential availability through the authenticated
  // Gateway session. Locally configured providers prove it through a fresh,
  // successful real-provider probe; they intentionally have no bearer token.
  return hasAuthenticatedGatewaySession || liveProbe?.status === "verified";
}

export function buildDuplexVoiceReadiness(input: DuplexVoiceReadinessInputs): DesktopDuplexVoiceReadiness {
  const realtimeFamily = Boolean(input.modelId?.toLowerCase().split("/").at(-1)?.startsWith("gpt-realtime"));
  const liveProbeReady = input.liveProbe?.status === "verified"
    && input.liveProbe.evidence_kind === "real_provider"
    && input.liveProbe.provider_id === input.providerId
    && input.liveProbe.model_id === input.modelId
    && Date.parse(input.liveProbe.expires_at) > Date.parse(input.checkedAt ?? new Date().toISOString());
  const checks: DesktopDuplexVoiceReadiness["checks"] = [
    { id: "rollout", ready: input.rolloutReady, reasonCode: input.rolloutReady ? "ready" : "rollout_disabled", message: input.rolloutReady ? "Realtime voice rollout is enabled." : "Realtime voice is disabled by rollout policy." },
    { id: "gateway", ready: input.gatewayReady, reasonCode: input.gatewayReady ? "ready" : "gateway_unavailable", message: input.gatewayReady ? "OpenDrSai Gateway is ready." : "OpenDrSai Gateway is unavailable." },
    { id: "model", ready: Boolean(input.providerId && input.modelId), reasonCode: input.providerId && input.modelId ? "ready" : "model_unconfigured", message: input.providerId && input.modelId ? "An explicit Realtime voice model is configured." : "The current Agent has no explicit Realtime voice model." },
    { id: "provider", ready: input.providerId === "zhizengzeng", reasonCode: input.providerId === "zhizengzeng" ? "ready" : "provider_unsupported", message: input.providerId === "zhizengzeng" ? "The configured Realtime Provider is supported." : "The configured Realtime Provider is not supported by this release." },
    { id: "credential", ready: input.credentialReady, reasonCode: input.credentialReady ? "ready" : "credential_unavailable", message: input.credentialReady ? "Realtime voice credentials are available." : "Realtime voice credentials are unavailable." },
    { id: "capability", ready: realtimeFamily && liveProbeReady, reasonCode: !realtimeFamily ? "model_unsupported" : liveProbeReady ? "ready" : "capability_unverified", message: !realtimeFamily ? "The configured model is not a supported Realtime model." : liveProbeReady ? "The configured Realtime capabilities were verified against the live Provider." : "The configured Realtime model has no fresh live Provider capability evidence." },
  ];
  const failed = checks.find((check) => !check.ready);
  const evidence = input.liveProbe?.capabilities ?? {};
  const negotiated = failed ? null : {
    ...input.capabilities,
    supportsInputTranscription: input.capabilities.supportsInputTranscription && evidence.input_transcription === true,
    supportsOutputTranscription: input.capabilities.supportsOutputTranscription && evidence.output_transcription === true,
    supportsServerVad: input.capabilities.supportsServerVad && evidence.server_vad === true,
    supportsResponseCancel: input.capabilities.supportsResponseCancel && evidence.response_cancel === true,
    supportsConversationTruncation: input.capabilities.supportsConversationTruncation && evidence.conversation_truncation === true,
    supportsToolCalling: input.capabilities.supportsToolCalling && evidence.tool_calling === true,
  };
  return { available: !failed, reasonCode: failed?.reasonCode ?? "ready", message: failed?.message ?? "Realtime voice is ready.", providerId: input.providerId, modelId: input.modelId, checkedAt: input.checkedAt ?? new Date().toISOString(), checks, capabilities: negotiated };
}
