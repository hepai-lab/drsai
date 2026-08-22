export interface StreamingProviderCapability {
  id: string;
  available: boolean;
  protocolVersion: 2;
  encodings: readonly string[];
  languages: readonly string[];
  endpointing: boolean;
  resume: boolean;
  maxAudioMs: number;
  latencyMs: number;
  costTier: 0 | 1 | 2 | 3;
  privacyTier: "local" | "private" | "external";
}

export class StreamingProviderCapabilityRegistry {
  #providers = new Map<string, StreamingProviderCapability>();
  register(capability: StreamingProviderCapability): void {
    if (!/^[a-z0-9_.-]{1,64}$/i.test(capability.id) || capability.protocolVersion !== 2 || capability.maxAudioMs <= 0) throw new Error("Invalid streaming Provider capability.");
    this.#providers.set(capability.id, { ...capability, encodings: [...capability.encodings], languages: [...capability.languages] });
  }
  list(): StreamingProviderCapability[] { return [...this.#providers.values()].map((item) => ({ ...item, encodings: [...item.encodings], languages: [...item.languages] })); }
}

export function selectStreamingProvider(providers: readonly StreamingProviderCapability[], input: { preferredId?: string; encoding: string; language?: string; requireEndpointing?: boolean; requireResume?: boolean }): StreamingProviderCapability | null {
  const compatible = providers.filter((provider) => provider.available
    && provider.encodings.includes(input.encoding)
    && (!input.language || provider.languages.includes("*") || provider.languages.some((value) => input.language!.toLowerCase().startsWith(value.toLowerCase())))
    && (!input.requireEndpointing || provider.endpointing)
    && (!input.requireResume || provider.resume));
  compatible.sort((left, right) => Number(right.id === input.preferredId) - Number(left.id === input.preferredId)
    || left.latencyMs - right.latencyMs || left.costTier - right.costTier || left.id.localeCompare(right.id));
  return compatible[0] ?? null;
}

export type StreamingRecoveryDecision =
  | { action: "retry_same"; providerId: string }
  | { action: "switch_provider"; providerId: string }
  | { action: "fallback_serial" }
  | { action: "stop" };

export function decideStreamingRecovery(input: {
  current: StreamingProviderCapability;
  candidates: readonly StreamingProviderCapability[];
  retryable: boolean;
  attempt: number;
  maxSameProviderRetries: number;
  allowCrossProvider: boolean;
  serialAvailable: boolean;
}): StreamingRecoveryDecision {
  if (input.retryable && input.attempt < input.maxSameProviderRetries) return { action: "retry_same", providerId: input.current.id };
  if (input.allowCrossProvider) {
    const currentPrivacy = privacyRank(input.current.privacyTier);
    const alternative = input.candidates.filter((item) => item.id !== input.current.id && item.available && item.protocolVersion === input.current.protocolVersion && privacyRank(item.privacyTier) <= currentPrivacy)
      .sort((left, right) => left.latencyMs - right.latencyMs || left.costTier - right.costTier || left.id.localeCompare(right.id))[0];
    if (alternative) return { action: "switch_provider", providerId: alternative.id };
  }
  return input.serialAvailable ? { action: "fallback_serial" } : { action: "stop" };
}

function privacyRank(value: StreamingProviderCapability["privacyTier"]): number { return value === "local" ? 0 : value === "private" ? 1 : 2; }
