import type { Agent, AgentMode } from "@/types/common";

export type AgentModeConfig = Omit<Agent, "config" | "icon"> & {
  config: Record<string, any>;
};

const META_FIELDS: (keyof AgentModeConfig)[] = [
  "id",
  "name",
  "mode",
  "description",
  "tags",
  "logo",
  "owner",
  "url",
  "apiKey",
  "baseUrl",
  "type",
];

const pickMetaFields = (source: Record<string, any>): Partial<AgentModeConfig> => {
  return META_FIELDS.reduce<Partial<AgentModeConfig>>((acc, key) => {
    const value = source[key];
    if (value !== undefined) {
      (acc as Record<string, any>)[key as string] = value;
    }
    return acc;
  }, {});
};

const ensureIdentityInConfig = (
  config: Record<string, any>,
  name: string,
  mode: string
) => {
  const next = { ...config };
  if (!next.name) {
    next.name = name;
  }
  if (!next.mode) {
    next.mode = mode;
  }
  return next;
};

export const DEFAULT_AGENT_MODE_CONFIG: AgentModeConfig = {
  name: "Dr.Sai General",
  mode: "magentic-one",
  description: "Dr.Sai通用智能体，适用于多种任务",
  config: {
    name: "Dr.Sai General",
    mode: "magentic-one",
    url: "",
    apiKey: "",
    base_url: "",
    model_client: {
      model: "",
      base_url: "",
      api_key: "",
    },
    mcp_sse_list: [],
    ragflow_configs: [],
    system_message: "",
    description: "",
  },
};

const toRecord = (value: any): Record<string, any> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return {};
};


export const normalizeAgentModeConfig = (
  raw: any
): AgentModeConfig | null => {
  if (!raw) {
    return null;
  }

  const meta = pickMetaFields(raw);
  const hasNestedConfig =
    raw.config && typeof raw.config === "object" && !Array.isArray(raw.config);

  const resolvedName: string =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name
      : DEFAULT_AGENT_MODE_CONFIG.name;
  const resolvedMode: AgentMode =
    (typeof raw.mode === "string" && raw.mode.trim()
      ? raw.mode
      : DEFAULT_AGENT_MODE_CONFIG.mode) as AgentMode;

  if (hasNestedConfig) {
    return {
      ...DEFAULT_AGENT_MODE_CONFIG,
      ...meta,
      name: resolvedName,
      mode: resolvedMode,
      config: ensureIdentityInConfig(toRecord(raw.config), resolvedName, resolvedMode),
    };
  }

  const config: Record<string, any> = {};
  Object.keys(raw).forEach((key) => {
    if (key === "config" || key === "icon") return;
    if (!META_FIELDS.includes(key as keyof AgentModeConfig)) {
      config[key] = raw[key];
    }
  });

  return {
    ...DEFAULT_AGENT_MODE_CONFIG,
    ...meta,
    name: resolvedName,
    mode: resolvedMode,
    config: ensureIdentityInConfig(config, resolvedName, resolvedMode),
  };
};


