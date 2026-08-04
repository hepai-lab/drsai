import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { DRSAI_HOME } from "./paths";

const CLI_CONFIG_FILE = join(DRSAI_HOME, "configs", "cli_config.json");
const DEFAULT_MODEL_ALIAS = "deepseek-v4-pro";
const LEGACY_MODEL_ALIASES: Record<string, string> = {
  "deepseek-ai/deepseek-v4-pro": DEFAULT_MODEL_ALIAS,
  "hepai/deepseek-v4-pro": DEFAULT_MODEL_ALIAS,
};
const MAX_MODEL_CHARS = 120;

export function normalizeModelAlias(rawModel: unknown): string | undefined {
  if (typeof rawModel !== "string") return undefined;
  const model = rawModel.trim();
  if (!model) return undefined;
  if (model.length > MAX_MODEL_CHARS || /[\r\n]/.test(model)) {
    throw new Error("Default model is invalid.");
  }
  return LEGACY_MODEL_ALIASES[model] || model;
}

export function getDefaultModelAlias(): string | undefined {
  const envAlias = normalizeModelAlias(process.env.LLM_DEFAULT_ALIAS);
  if (envAlias) return envAlias;

  const config = readCliConfig();
  const configured = normalizeModelAlias(config.defult_config_name);
  return configured || DEFAULT_MODEL_ALIAS;
}

export function saveDefaultModelAlias(rawModel: unknown): string | undefined {
  const model = normalizeModelAlias(rawModel);
  if (!model) return undefined;

  const config = readCliConfig();
  config.defult_config_name = model;
  writeCliConfig(config);
  return model;
}

export function getCliConfigUserId(): string | undefined {
  const value = readCliConfig().user_id;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "anonymous" || trimmed.length > 200 || /[\r\n\0]/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function setCliConfigUserId(userId: string): string {
  const trimmed = userId.trim();
  if (!trimmed || trimmed.length > 200 || /[\r\n\0]/.test(trimmed)) {
    throw new Error("My DrSai user_id is invalid.");
  }
  const config = readCliConfig();
  if (config.user_id === trimmed) return trimmed;
  config.user_id = trimmed;
  writeCliConfig(config);
  return trimmed;
}

function readCliConfig(): Record<string, unknown> {
  if (!existsSync(CLI_CONFIG_FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(CLI_CONFIG_FILE, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeCliConfig(config: Record<string, unknown>): void {
  mkdirSync(dirname(CLI_CONFIG_FILE), { recursive: true });
  writeFileSync(CLI_CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
