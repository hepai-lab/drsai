import { useCallback, useEffect, useMemo, useState } from "react";
import { PROVIDERS } from "../../../constants";
import { useI18n } from "../../../components/useI18n";
import type { ModelGroup, ModelItem } from "../types";

interface UseModelConfigResult {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  modelGroups: ModelGroup[];
  displayModel: string;
  reload: () => Promise<void>;
  selectModel: (
    provider: string,
    model: string,
    baseUrl: string,
  ) => Promise<void>;
}

function groupModelsByClientType(
  models: ModelItem[],
): ModelGroup[] {
  const groupMap = new Map<string, ModelGroup>();
  for (const m of models) {
    const key = m.client_type || "auto";
    if (!groupMap.has(key)) {
      const labelKey = key === "anthropic" ? "constants.anthropicName"
        : key === "openai" ? "constants.openaiName"
        : PROVIDERS.labels[key] || key;
      groupMap.set(key, {
        client_type: key,
        providerLabel: labelKey,
        models: [],
      });
    }
    groupMap.get(key)!.models.push(m);
  }
  return Array.from(groupMap.values());
}

export function useModelConfig(profile?: string): UseModelConfigResult {
  const { t } = useI18n();
  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("auto");
  const [currentBaseUrl, setCurrentBaseUrl] = useState("");
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [allModels, setAllModels] = useState<ModelItem[]>([]);

  const reload = useCallback(async (): Promise<void> => {
    const [mc, catalog] = await Promise.all([
      window.drsaiAPI.getModelConfig(profile),
      window.drsaiAPI.listModels(),
    ]);
    setCurrentModel(mc.model);
    setCurrentProvider(mc.provider);
    setCurrentBaseUrl(mc.baseUrl);
    setAllModels(catalog.models);
    setModelGroups(groupModelsByClientType(catalog.models));
  }, [profile]);

  useEffect(() => {
    reload();
  }, [reload]);

  const selectModel = useCallback(
    async (provider: string, model: string, baseUrl: string): Promise<void> => {
      await window.drsaiAPI.setModelConfig(provider, model, baseUrl, profile);
      setCurrentModel(model);
      setCurrentProvider(provider);
      setCurrentBaseUrl(baseUrl);
    },
    [profile],
  );

  const displayModel = useMemo(
    () => {
      if (!currentModel) {
        return currentProvider === "auto" ? t("chat.auto") : t("chat.noModel");
      }
      const found = allModels.find((m) => m.model === currentModel);
      if (found) return found.display_name;
      return currentModel.split("/").pop() || currentModel;
    },
    [currentModel, currentProvider, t, allModels],
  );

  return {
    currentModel,
    currentProvider,
    currentBaseUrl,
    modelGroups,
    displayModel,
    reload,
    selectModel,
  };
}