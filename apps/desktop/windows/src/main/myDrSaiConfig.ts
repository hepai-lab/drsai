import { request as httpRequest } from "http";
import { existsSync, realpathSync } from "fs";
import { readFile } from "fs/promises";
import { isAbsolute, join, relative, resolve } from "path";
import type {
  MyDrSaiCliConfig,
  MyDrSaiConfig,
  MyDrSaiModelConfig,
  UpdateMyDrSaiConfigRequest,
} from "../shared/desktopApi";
import { getGatewayStatus } from "./gateway";
import { getDefaultModelAlias } from "./modelDefaults";

const TOKENIZER_CALIBRATION_FILE = ".drsai/tokenizer-calibration.json";
const WRITABLE_CLI_KEYS: Array<keyof UpdateMyDrSaiConfigRequest> = [
  "user_id",
  "defult_config_name",
  "plan_mode",
  "workspace_enabled",
  "dangerous_allowed",
];
const MAX_TOKENIZER_CALIBRATION_SAMPLES = 12;
const MAX_TOKENIZER_CALIBRATION_SAMPLE_CHARS = 4000;

export async function getMyDrSaiConfig(workspacePath?: string): Promise<MyDrSaiConfig> {
  const gateway = await getGatewayStatus();
  if (!gateway.ready) {
    return {
      ready: false,
      baseUrl: gateway.baseUrl,
      config: {},
      models: [],
      defaultModelAlias: getDefaultModelAlias(),
      error: "My DrSai 尚未运行，启动后可读取配置。",
    };
  }

  try {
    const [cli, catalog] = await Promise.all([
      gatewayRequest<CliConfigResponse>(gateway.baseUrl, "GET", "/v1/config/cli"),
      gatewayRequest<ModelCatalogResponse>(gateway.baseUrl, "GET", "/v1/models/config"),
    ]);

    const models = await applyWorkspaceTokenizerCalibration(
      normalizeModels(catalog.models),
      workspacePath,
    );

    return {
      ready: true,
      baseUrl: gateway.baseUrl,
      cliPath: cli.path,
      config: normalizeCliConfig(cli.config),
      models,
      defaultModelAlias: catalog.default_alias || getDefaultModelAlias(),
    };
  } catch (error) {
    return {
      ready: false,
      baseUrl: gateway.baseUrl,
      config: {},
      models: [],
      defaultModelAlias: getDefaultModelAlias(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function updateMyDrSaiConfig(
  request: UpdateMyDrSaiConfigRequest,
): Promise<MyDrSaiConfig> {
  const gateway = await getGatewayStatus();
  if (!gateway.ready) {
    throw new Error("My DrSai 尚未运行，无法保存配置。");
  }

  for (const key of WRITABLE_CLI_KEYS) {
    const value = request[key];
    if (value !== undefined) {
      await gatewayRequest(gateway.baseUrl, "PUT", `/v1/config/cli/${key}`, { value });
    }
  }

  return getMyDrSaiConfig();
}

interface CliConfigResponse {
  path?: string;
  config?: Record<string, unknown>;
}

interface ModelCatalogResponse {
  default_alias?: string;
  models?: unknown;
}

function normalizeCliConfig(config: Record<string, unknown> | undefined): MyDrSaiCliConfig {
  return { ...(config || {}) };
}

function normalizeModels(models: unknown): MyDrSaiModelConfig[] {
  if (!Array.isArray(models)) return [];
  return models
    .map((entry) => normalizeModel(entry))
    .filter((entry): entry is MyDrSaiModelConfig => Boolean(entry));
}

function normalizeModel(entry: unknown): MyDrSaiModelConfig | null {
  if (!entry || typeof entry !== "object") return null;
  const model = entry as Record<string, unknown>;
  const alias = typeof model.alias === "string" ? model.alias : "";
  if (!alias) return null;
  return {
    alias,
    display_name: typeof model.display_name === "string" ? model.display_name : undefined,
    client_type: typeof model.client_type === "string" ? model.client_type : undefined,
    model: typeof model.model === "string" ? model.model : undefined,
    token_limit: typeof model.token_limit === "number" ? model.token_limit : undefined,
    max_tokens: typeof model.max_tokens === "number" ? model.max_tokens : undefined,
    tokenizer_calibration: normalizeTokenizerCalibration(model.tokenizer_calibration),
    vision: typeof model.vision === "boolean" ? model.vision : undefined,
    reasoning:
      model.reasoning && typeof model.reasoning === "object"
        ? (model.reasoning as MyDrSaiModelConfig["reasoning"])
        : undefined,
  };
}

function normalizeTokenizerCalibration(value: unknown): MyDrSaiModelConfig["tokenizer_calibration"] {
  if (!Array.isArray(value)) return undefined;
  const samples = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const sample = (item as Record<string, unknown>).sample;
      const tokens = (item as Record<string, unknown>).tokens;
      if (typeof sample !== "string" || !sample.trim()) return null;
      if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return null;
      return {
        sample: sample.slice(0, MAX_TOKENIZER_CALIBRATION_SAMPLE_CHARS),
        tokens: Math.floor(tokens),
      };
    })
    .filter((item): item is NonNullable<MyDrSaiModelConfig["tokenizer_calibration"]>[number] => Boolean(item))
    .slice(0, MAX_TOKENIZER_CALIBRATION_SAMPLES);
  return samples.length > 0 ? samples : undefined;
}

async function applyWorkspaceTokenizerCalibration(
  models: MyDrSaiModelConfig[],
  workspacePath?: string,
): Promise<MyDrSaiModelConfig[]> {
  const workspaceSamples = await readWorkspaceTokenizerCalibration(workspacePath);
  if (!workspaceSamples.size) return models;
  return models.map((model) => {
    const keys = [model.alias, model.model, model.display_name]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => value.trim().toLowerCase());
    const extra = keys.flatMap((key) => workspaceSamples.get(key) ?? []);
    if (!extra.length) return model;
    const merged = normalizeTokenizerCalibration([
      ...(model.tokenizer_calibration ?? []),
      ...extra,
    ]);
    return {
      ...model,
      tokenizer_calibration: merged,
    };
  });
}

async function readWorkspaceTokenizerCalibration(
  workspacePath?: string,
): Promise<Map<string, NonNullable<MyDrSaiModelConfig["tokenizer_calibration"]>>> {
  if (!workspacePath || !isWorkspaceLocalPath(workspacePath)) return new Map();
  const filePath = join(resolve(workspacePath), TOKENIZER_CALIBRATION_FILE);
  if (!isWorkspaceLocalPath(filePath, workspacePath) || !existsSync(filePath)) return new Map();
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeWorkspaceTokenizerCalibration(parsed);
  } catch {
    return new Map();
  }
}

function normalizeWorkspaceTokenizerCalibration(
  value: unknown,
): Map<string, NonNullable<MyDrSaiModelConfig["tokenizer_calibration"]>> {
  const entries = new Map<string, NonNullable<MyDrSaiModelConfig["tokenizer_calibration"]>>();
  if (!value || typeof value !== "object") return entries;
  const record = value as Record<string, unknown>;
  const models = Array.isArray(record.models) ? record.models : [];
  for (const item of models) {
    if (!item || typeof item !== "object") continue;
    const model = item as Record<string, unknown>;
    const keys = [model.alias, model.model, model.display_name]
      .filter((key): key is string => typeof key === "string" && Boolean(key.trim()))
      .map((key) => key.trim().toLowerCase());
    const samples = normalizeTokenizerCalibration(model.samples ?? model.tokenizer_calibration);
    if (!keys.length || !samples?.length) continue;
    for (const key of keys) {
      const current = entries.get(key) ?? [];
      entries.set(key, normalizeTokenizerCalibration([...current, ...samples]) ?? current);
    }
  }
  return entries;
}

function isWorkspaceLocalPath(path: string, workspacePath?: string): boolean {
  if (!path || /[\r\n]/.test(path) || !existsSync(path)) return false;
  const root = realpathSync.native(resolve(workspacePath || path));
  const target = realpathSync.native(resolve(path));
  const relativePath = relative(root, target);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function gatewayRequest<T>(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const bodyString = body !== undefined ? JSON.stringify(body) : undefined;
    const request = httpRequest(
      url,
      {
        method,
        timeout: 5000,
        headers: bodyString
          ? {
              "Content-Type": "application/json",
              "Content-Length": String(Buffer.byteLength(bodyString)),
            }
          : {},
      },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          data = `${data}${chunk}`;
        });
        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 400) {
            reject(new Error(readErrorMessage(data)));
            return;
          }
          try {
            resolve(data ? (JSON.parse(data) as T) : ({} as T));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("读取 My DrSai 配置超时。"));
    });
    if (bodyString) request.write(bodyString);
    request.end();
  });
}

function readErrorMessage(data: string): string {
  if (!data) return "My DrSai 配置请求失败。";
  try {
    const parsed = JSON.parse(data) as { detail?: unknown; message?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // Keep raw response below.
  }
  return data;
}
