import type { Agent, AgentMode } from "@/types/common";
import { useModeConfigStore } from "@/store/modeConfig";

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
  "api_key",
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
  name: "Dr.Sai WebSurfer",
  mode: "magentic-one",
  description: "Dr.Sai网页浏览智能体，适用于自动操控网页、文件等任务。",
  config: {
    name: "Dr.Sai WebSurfer",
    mode: "magentic-one",
    url: "",
    api_key: "",
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

/**
 * Stable agent id for outbound WS payloads when `useAgentInfo` is briefly null (e.g. after many turns / rerenders).
 */
export function resolveOutboundAgentId(agentInfo?: Partial<Agent> | null): string {
  // Try multiple shapes. Session `agent_mode_config` is sometimes stored as a plain
  // config blob (e.g. { config: { agent_id } }) without top-level `id`.
  const candidates = [
    (agentInfo as any)?.id,
    (agentInfo as any)?.agent_id,
    (agentInfo as any)?.config?.agent_id,
    (agentInfo as any)?.config?.requested_agent_id,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim() !== "") {
      return String(c).trim();
    }
  }
  const persisted = useModeConfigStore.getState().agentId;
  if (persisted != null && String(persisted).trim() !== "") {
    return String(persisted).trim();
  }
  const sel = useModeConfigStore.getState().selectedAgent?.id;
  if (sel != null && String(sel).trim() !== "") {
    return String(sel).trim();
  }
  return "";
}


