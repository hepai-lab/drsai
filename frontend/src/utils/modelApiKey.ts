import { parse } from "yaml";
import { settingsAPI } from "@/components/views/api";

/** 从 settings.config 解析 HepAI model API Key */
export function parseModelApiKeyFromSettingsConfig(
  settings: Record<string, unknown> | null | undefined,
): string | undefined {
  let parsed: Record<string, unknown> = {};
  try {
    if (settings?.model_configs) {
      parsed = parse(settings.model_configs as string) as Record<string, unknown>;
    }
  } catch {
    parsed = {};
  }
  const modelConfig =
    (parsed?.model_config as { config?: Record<string, unknown> } | undefined)
      ?.config || {};
  const apiKey = modelConfig.api_key;
  if (typeof apiKey !== "string") {
    return undefined;
  }
  const trimmed = apiKey.trim();
  return trimmed || undefined;
}

/** HepAI 平台模型 API Key（与 AgentSquare / settings 页 model_configs 一致） */
export async function getModelApiKeyFromSettings(
  userEmail: string,
): Promise<string | undefined> {
  const settings = await settingsAPI.getSettings(userEmail);
  return parseModelApiKeyFromSettingsConfig(settings);
}
