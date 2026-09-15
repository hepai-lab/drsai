import type { DesktopAgent, MyDrSaiModelConfig } from "@shared/desktopApi";
import { supportsFullAgentPrimaryRuntime, supportsImageGenerationModel } from "./modelCatalogRecovery";

export function getAgentModelOptions(
  catalog: MyDrSaiModelConfig[],
  agent: DesktopAgent | undefined,
  selectedModel: string | null,
  selectedModelRef?: { provider_id: string; model_id: string },
): MyDrSaiModelConfig[] {
  const isSelectedPrimary = (model: MyDrSaiModelConfig): boolean => {
    if (selectedModelRef?.provider_id && selectedModelRef.model_id) {
      return model.provider_id === selectedModelRef.provider_id
        && (model.alias === selectedModelRef.model_id || model.model === selectedModelRef.model_id);
    }
    if (!selectedModel?.trim()) return false;
    const normalized = selectedModel.trim().toLowerCase();
    return [model.alias, model.model, model.display_name]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.trim().toLowerCase() === normalized);
  };
  const allowAsPrimaryOption = (model: MyDrSaiModelConfig): boolean =>
    supportsFullAgentPrimaryRuntime(model) || isSelectedPrimary(model);

  if (agent?.source === "local" && agent.id !== "my-codex") {
    const providerAware = new Map<string, MyDrSaiModelConfig>();
    for (const model of catalog) {
      if (!model.provider_id || !model.alias || !allowAsPrimaryOption(model)) continue;
      providerAware.set(`${model.provider_id}\0${model.alias}`, model);
    }
    if (providerAware.size > 0) return [...providerAware.values()];
    if (selectedModelRef) return [{
      alias: selectedModelRef.model_id,
      display_name: selectedModelRef.model_id,
      model: selectedModelRef.model_id,
      provider_id: selectedModelRef.provider_id,
      availability: "unavailable",
      capability_source: "unknown",
    }];
    return [];
  }
  const byIdentity = new Map<string, MyDrSaiModelConfig>();
  for (const model of catalog) {
    for (const identity of [model.alias, model.model]) {
      if (identity?.trim()) byIdentity.set(identity.trim().toLowerCase(), model);
    }
  }

  const requested = agent?.models?.length
    ? agent.models
    : catalog.map((model) => model.alias || model.model || "").filter(Boolean);
  const fallbackIds = [agent?.model, selectedModel]
    .filter((value): value is string => Boolean(value?.trim()));
  const result: MyDrSaiModelConfig[] = [];
  const seen = new Set<string>();
  for (const id of [...requested, ...fallbackIds]) {
    const normalized = id.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    const configured = byIdentity.get(normalized);
    const model = configured ?? { alias: id.trim(), display_name: id.trim(), model: id.trim() };
    const identity = (model.alias || model.model || normalized).toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(normalized);
    seen.add(identity);
    result.push(model);
  }
  return result;
}

/** Image-generation options for Composer / Settings — from backend catalog only. */
export function getImageGenerationModelOptions(
  catalog: MyDrSaiModelConfig[],
  selectedRef?: { provider_id: string; model_id: string } | null,
): MyDrSaiModelConfig[] {
  const byKey = new Map<string, MyDrSaiModelConfig>();
  for (const model of catalog) {
    if (!model.provider_id || !model.alias || !supportsImageGenerationModel(model)) continue;
    byKey.set(`${model.provider_id}\0${model.alias}`, model);
  }
  if (selectedRef?.provider_id && selectedRef.model_id) {
    const key = `${selectedRef.provider_id}\0${selectedRef.model_id}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        alias: selectedRef.model_id,
        display_name: selectedRef.model_id,
        model: selectedRef.model_id,
        provider_id: selectedRef.provider_id,
        output_modalities: ["image"],
        operations: ["image_generation"],
        availability: "unavailable",
        capability_source: "unknown",
      });
    }
  }
  return [...byKey.values()];
}
