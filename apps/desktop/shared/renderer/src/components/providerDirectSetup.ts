import type { MyDrSaiModelProvider, MyDrSaiProviderModelConfig, RuntimeModelDescriptor } from "@shared/desktopApi";

export interface DirectModelEntry {
  key: string;
  providerId: string;
  modelId: string;
  provider: MyDrSaiModelProvider;
  config: MyDrSaiProviderModelConfig;
  runtime?: RuntimeModelDescriptor;
  agentEligibilityReason?: string;
}

export function directModelKey(providerId: string, modelId: string): string {
  return `${providerId}\u0000${modelId}`;
}

/** Flatten every user-owned model across providers without dropping disabled entries. */
export function aggregateDirectModels(providers: MyDrSaiModelProvider[], runtime: RuntimeModelDescriptor[] = []): DirectModelEntry[] {
  const runtimeByKey = new Map(runtime.map((entry) => [directModelKey(entry.ref.provider_id, entry.ref.model_id), entry]));
  const result: DirectModelEntry[] = [];
  for (const provider of providers) {
    for (const [modelId, config] of Object.entries(provider.model_configs ?? {})) {
      if (config.origin === "product") continue;
      const key = directModelKey(provider.name, modelId);
      const descriptor = runtimeByKey.get(key);
      result.push({ key, providerId: provider.name, modelId, provider, config, runtime: descriptor, agentEligibilityReason: directAgentEligibilityReason(config, descriptor) });
    }
  }
  return result.sort((a, b) => (a.config.alias || a.modelId).localeCompare(b.config.alias || b.modelId));
}

export function directAgentEligibilityReason(config: MyDrSaiProviderModelConfig, runtime?: RuntimeModelDescriptor): string | undefined {
  // Availability and enabled state are rendered independently. Eligibility is a
  // capability statement, so an offline/disabled entry must still explain every
  // capability that prevents it being selected for an Agent.
  const operations = new Set(runtime?.operations ?? config.capabilities ?? []);
  const input = new Set(runtime?.input_modalities ?? config.input_modalities ?? []);
  const output = new Set(runtime?.output_modalities ?? config.output_modalities ?? []);
  const reasons: string[] = [];
  if (!operations.has("chat")) reasons.push("missing chat capability");
  if (!operations.has("tool_calling")) reasons.push("missing tool_calling capability");
  if (!input.has("text")) reasons.push("missing text input modality");
  if (!output.has("text")) reasons.push("missing text output modality");
  return reasons.length ? reasons.join("; ") : undefined;
}

/** The provider id is internal UI routing state, not a field the user must pick. */
export function directModelRoute(entry: Pick<DirectModelEntry, "providerId" | "modelId">): { providerId: string; modelId: string } {
  return { providerId: entry.providerId, modelId: entry.modelId };
}

/** UI input budget reserves the full output allowance in a shared context window. */
export function directTokenBudget(input: string, output: string): { token_limit: number; max_tokens: number } {
  if (!/^\d+$/.test(input.trim()) || !/^\d+$/.test(output.trim())) throw new Error("最大输入预算和最大输出均必填 / Input budget and output are required integers");
  const i = Number(input), o = Number(output);
  if (!Number.isSafeInteger(i) || !Number.isSafeInteger(o) || i < 1 || o < 1 || i + o > 100_000_000) throw new Error("输入、输出须为正整数，合计 ≤ 100000000 / Positive budgets, total ≤ 100000000");
  return { token_limit: i + o, max_tokens: o };
}

export function replaceDirectModel(models: Record<string, MyDrSaiProviderModelConfig>, originalId: string, id: string, config: MyDrSaiProviderModelConfig): Record<string, MyDrSaiProviderModelConfig> {
  if (!id || id.length > 256 || /[\r\n\0]/.test(id)) throw new Error("请输入有效的模型 ID / Enter a valid model ID");
  if (Object.keys(models).some((key) => key !== originalId && key.toLowerCase() === id.toLowerCase())) throw new Error("模型 ID 重复 / Duplicate model ID");
  const result = { ...models };
  delete result[originalId];
  result[id] = config;
  return result;
}
