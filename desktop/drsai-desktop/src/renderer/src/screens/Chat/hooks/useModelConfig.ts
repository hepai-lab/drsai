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

export function useModelConfig(_profile?: string): UseModelConfigResult {
  const { t } = useI18n();
  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("auto");
  const [currentBaseUrl, setCurrentBaseUrl] = useState("");
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [allModels, setAllModels] = useState<ModelItem[]>([]);

  const reload = useCallback(async (): Promise<void> => {
    // drsai backend: source of truth is the model catalog
    // (/v1/models/config). The "current" model is whichever alias the
    // catalog marks as default.
    const catalog = await window.drsaiAPI.listModels();
    setAllModels(catalog.models);
    setModelGroups(groupModelsByClientType(catalog.models));
    const def = catalog.models.find((m) => m.alias === catalog.default_alias)
      || catalog.models[0];
    if (def) {
      setCurrentModel(def.model);
      setCurrentProvider(def.client_type || "auto");
      setCurrentBaseUrl("");
    } else {
      setCurrentModel("");
      setCurrentProvider("auto");
      setCurrentBaseUrl("");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const selectModel = useCallback(
    async (provider: string, model: string, _baseUrl: string): Promise<void> => {
      // ModelPicker passes (provider, model, baseUrl); we need the catalog
      // alias to call /v1/models/config/default/{alias}.
      const item = allModels.find((m) => m.model === model);
      if (!item) {
        console.warn("[useModelConfig] no alias found for model:", model);
        return;
      }
      try {
        await window.drsaiAPI.setDefaultModel(item.alias);
        setCurrentModel(item.model);
        setCurrentProvider(provider || item.client_type || "auto");
        setCurrentBaseUrl("");
      } catch (err) {
        console.error("[useModelConfig] setDefaultModel failed:", err);
      }
    },
    [allModels],
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