import type {
  MyDrSaiModelConfig,
  RuntimeModelAvailability,
  RuntimeModelCatalogState,
} from "../../api/desktopApi";

export type ModelCatalogRecoveryState = RuntimeModelCatalogState | RuntimeModelAvailability | "unconfigured" | "empty" | "timeout";

/** Retired product image models — must not appear in the image-generation picker. */
const RETIRED_IMAGE_GENERATION_MODEL_IDS = new Set([
  "gemini-3.1-flash-lite-image", // former display name: Nano Banana 2 Lite
]);

/** Full Agent Runtime primary models must declare chat + tool_calling (Gateway gate). */
export function supportsFullAgentPrimaryRuntime(model: Pick<MyDrSaiModelConfig, "operations" | "input_modalities" | "output_modalities">): boolean {
  const operations = model.operations ?? [];
  if (!operations.includes("chat") || !operations.includes("tool_calling")) return false;
  if (model.input_modalities && !model.input_modalities.includes("text")) return false;
  if (model.output_modalities && !model.output_modalities.includes("text")) return false;
  return true;
}

/** Image-generation catalog entries declare image output + image_generation operation. */
export function supportsImageGenerationModel(
  model: Pick<MyDrSaiModelConfig, "alias" | "model" | "operations" | "output_modalities">,
): boolean {
  const modelId = (model.alias || model.model || "").trim().toLowerCase();
  if (modelId && RETIRED_IMAGE_GENERATION_MODEL_IDS.has(modelId)) return false;
  return Boolean(model.operations?.includes("image_generation") && model.output_modalities?.includes("image"));
}

const COPY: Record<string, { zh: [string, string]; en: [string, string] }> = {
  unconfigured: { zh: ["尚未配置模型服务", "先在“模型提供方”中配置 Provider 和模型。"], en: ["Model service is not configured", "Configure a Provider and its models in Model providers."] },
  empty: { zh: ["Provider 没有返回模型", "当前连接有效，但目录确实为空；可刷新或手动添加模型。"], en: ["The Provider returned no models", "The connection is configured, but its catalog is empty. Refresh it or add a model manually."] },
  unauthorized: { zh: ["没有模型访问权限", "重新登录或请管理员为当前账号开通模型权限。"], en: ["Model access is not authorized", "Sign in again or ask an administrator to grant model access."] },
  offline: { zh: ["模型服务离线", "保留了当前选择；连接恢复后刷新模型。"], en: ["Model service is offline", "Your selection is preserved. Refresh models after connectivity returns."] },
  timeout: { zh: ["加载模型超时", "服务可能仍可用；请重试刷新，不会替换当前选择。"], en: ["Model loading timed out", "The service may still be available. Refresh again; the current selection will not be replaced."] },
  stale: { zh: ["模型目录需要刷新", "继续显示上次目录，但新任务前应刷新确认。"], en: ["Model catalog needs refresh", "The last catalog remains visible. Refresh it before starting a new task."] },
  unavailable: { zh: ["所选模型已下线", "当前选择已保留；请刷新模型目录或前往智能体配置选择可用模型。"], en: ["Selected model is unavailable", "The selection is preserved. Refresh the catalog or choose an available model in Agent settings."] },
  error: { zh: ["无法加载模型目录", "配置和当前选择已保留；修复服务后重试。"], en: ["Model catalog could not be loaded", "Configuration and selection are preserved. Retry after fixing the service."] },
};

export function modelCatalogRecoveryCopy(state: ModelCatalogRecoveryState | string, zh: boolean): { title: string; message: string } {
  const selected = COPY[state] ?? COPY.error;
  const [title, message] = zh ? selected.zh : selected.en;
  return { title, message };
}

export function isSelectableModelAvailability(availability?: RuntimeModelAvailability): boolean {
  return availability === undefined || availability === "available" || availability === "configured_unverified";
}
